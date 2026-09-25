# NOTES — decisions, deviations, results

## Phase 0 — Fetch & cache

### Environment
- Windows 11, Python 3.13.7 via `py` launcher (venv: `pipeline/.venv`), Node 22.18, npm 11.13.
- Pinned Phase 0 deps: see `pipeline/requirements.txt`.

### Deviations from PLAN.md
| Deviation | Why |
|---|---|
| Pool = booster sets `OGN, SFD, UNL, VEN` + Nexus Night promos (untagged `OPP` printings) | Human (2026-09-25): app is for standard booster packs only; Nexus Night is the one promo exception. Excluded: OGS (starter), PR, JDG, tagged OPP (`(Metal)`, etc.). Nexus Night isn't labelled in either source → rule "untagged OPP" (human-approved, may include a few non-NN promos). |
| `INCLUDE_ALL_PRINTINGS = False` | Other printings of pool names (metal, judge, starter) can't be pulled from boosters. Holding one will match its base card — accepted. |
| Pool size ~1.3k base printings (vs ~350 for OGN) | Bigger embeddings (~1287 × 9 × 1280 × 4B ≈ 59MB) and harder accuracy; expect PCA (§6.3) in Phase 1. |
| `pipeline/http.py` → `pipeline/httpclient.py` | `http.py` shadows stdlib `http`, breaking `requests`. |
| Extra helpers `rawcache.py`, `cardsio.py`, `imagehashing.py` | Keep fetch scripts thin, logic testable. |
| `PriceSource` takes cards.csv rows (dicts), not `CardRecord`s | Matching happens after image/hash columns exist. |
| `fetch_prices.py --rematch` flag | Re-apply `manual_overrides.csv` on the cached snapshot with 0 requests (H3 loop). `--force` still = new snapshot. |
| Landscape cards (71 battlefields) are rotated 90° to portrait at download | Guide box is portrait; card is held sideways. Phase 1 augment should also add the 180° rotation (either sideways direction). |
| Images are `pHash`-canonicalized per name (Hamming ≤ 4 → same hash) | Contract “same hash = same picture”; re-encodes differ by a few bits. |

### Card source: Riftcodex
- Endpoints: `GET /sets?size=100`, `GET /cards?set_id=<S>&page=<n>&size=100&sort=collector_number`. 20 requests total for all sets.
- Raw: `data/raw/riftcodex/20260925T203217Z`.
- Sets: OGN 352, OGS 24, SFD 288, UNL 280, VEN 358, PR 13, JDG 3, OPP 133 → 1451 records.
- `printing_id` = `<SET>-<riftbound_id number segment>` upper-cased, `*`→`S` (e.g. `OGN-007A`, `OGN-299S`, `SFD-T03`).
- Source quirks handled:
  - No `public_code` field; `collector_number` is an int without the variant suffix → use `riftbound_id` segment.
  - 28 OPP `(Metal)` cards share `riftbound_id` + image with the plain promo → suffix `M` (e.g. `OPP-017M`).
  - 6 VEN runes duplicated (stale record without tcgplayer_id) → deduped.
  - Names carry tags `(Alternate Art)`, `(Overnumbered)`, `(Signature)`, `(Metal)`, … → stripped to base name so printings group by card.
  - Variant: set in {PR, JDG, OPP} or rarity `Promo` → `promo`; alternate_art/overnumbered/signature → `alt_art`; else `normal`.

### Price source: TCGCSV
- Category 89 verified. Group match by abbreviation first — Riftcodex's OPP id (24343) is actually PR's group; VEN has none (TCGCSV 24698).
- `subTypeName` values: `Normal`, `Foil`. Many cards are Foil-only → base printing takes the Foil price; `F` foil row only when both exist.

- VEN: Riftcodex `card_count` 358 includes 131 stale duplicate pairs (same id + image, one without tcgplayer_id) → 263 real printings after dedupe.

### Results (2026-09-25)
**Cards** (`fetch_cards.py`, raw `20260925T203217Z`)
- 1356 base printings, 954 card names. Sets: OGN 352, OGS 24, SFD 288, UNL 280, VEN 263, PR 13, JDG 3, OPP 133.
- Variants: normal 1000, alt_art 207, promo 149 (+ 510 foil rows from prices → 1866 total).
- Images: 1336 downloaded in 1157 requests (shared URLs fetched once); 67 landscape rotated; 0 unreadable; 0 duplicate ids.
- Re-run without `--refresh`: **0 network requests** ✅.
- Look-alike groups (same name, >1 distinct picture): **182** → need the layout check (full list: `data/cards/lookalikes.json`).
- **Reused-image variants (H7): 164** — the source serves the *base card's* image for these, raw pHash distance 0 (3 at distance 2):
  | Kind | Count | Example |
  |---|---|---|
  | OPP promos (incl. Metal) | 130 | `OPP-255` → same image as `OGN-255` |
  | PR promos | 12 | `PR-066` → `OGN-066` |
  | JDG promos | 3 | `JDG-111` → `OGN-111` |
  | VEN alt arts | 19 | `VEN-021AA` → `VEN-021A` |
  Until a real photo/scan is placed in `data/cards/image_overrides/<printing_id>.png`, these are "same picture" as their base → the app would pick the cheaper printing (`same_image_cheapest`). **Realistic plan:** supply overrides only for promos you actually own/demo; accept the rest.

**Prices** (`fetch_prices.py`, raw `20260925T204211Z`)
- TCGCSV `as_of` **2026-09-25T20:05:42Z**, category 89. Groups: OGN 24344, OGS 24439, SFD 24519, UNL 24560, VEN 24698, PR 24343, OPP 24528, JDG 24552.
- **19 / 20 requests** ✅.
- subTypeName values: `Normal`, `Foil`. 510 cards have both → 510 foil rows.
- Auto-matched: **1838 / 1866 = 98.5%** ✅ (≥ 95%). Methods: tcgplayer_id 1651, set_and_number 187. Fields: marketPrice 1834, midPrice 4.
- Unmatched: **28, all OPP promos** (24 `(Metal)` + OPP-181…205 odd numbers) — product exists on TCGplayer, but TCGCSV has no price rows. → H3.

### Final pool (after booster-only rule, 2026-09-25) — Phase 0 accepted
- **1287 base printings + 510 foil rows = 1797**, 947 names. OGN 516, SFD 411, UNL 403, VEN 363, OPP (Nexus Night) 104 (counts incl. foil rows).
- Variants: normal 976, alt_art 207, promo 104, foil 510.
- Prices: **1797 / 1797 = 100% auto** (tcgplayer_id 1610, set_and_number 187; marketPrice 1793, midPrice 4). 0 unmatched, no manual overrides needed (all 28 no-price items were excluded promos).
- Look-alike groups: 180.
- **Reused-image variants: 104 = every Nexus Night promo** — source serves the base card art. Until real images are supplied (H7, `data/cards/image_overrides/<printing_id>.png`), a Nexus Night promo is treated as "same picture" as its base → app shows the cheaper printing with a hint. The 19 VEN alt arts flagged earlier dropped out: their `AA` twins were tagged duplicates now excluded.
