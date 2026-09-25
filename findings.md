# Findings & Decisions

## Requirements (from PLAN.md)
- Accuracy ≥90% top-1 (stretch 95%), 0 wrong accepts on eval set
- Latency p95 <300ms held-still → reaction start
- 6 reaction tiers, synthesized sounds only
- Debug panel: state, top matches, scores, timings
- No runtime network, no servers/DB/PWA, brute-force search in worker

## Environment
| Tool | Version | Note |
|------|---------|------|
| Python | 3.13.7 | via `py` launcher only; `python` not on PATH |
| Node | v22.18.0 | |
| npm | 11.13.0 | |
| git | 2.37.0.windows.1 | |
| OS | Windows 11 | OneDrive-synced project dir — watch for file-lock issues with large data/ |

## Research Findings

### Riftcodex (verified 2026-09-25, HTTP 200, no key)
- `GET /sets` → `{items,total,page,size,pages}`; 8 sets:
  | set_id | name | cards | rc tcgplayer_id |
  |---|---|---|---|
  | OGN | Origins | 352 | 24344 |
  | OGS | Origins: Proving Grounds | 24 | 24439 |
  | SFD | Spiritforged | 288 | 24519 |
  | UNL | Unleashed | 280 | 24560 |
  | VEN | Vendetta | 358 | **null** |
  | PR | Promotional Cards | 13 | 24343 |
  | JDG | Judge Promo | 3 | 24552 |
  | OPP | Organized Play Promo | 133 | **24343 (wrong — TCGCSV says 24528)** |
  → ~1451 printings total.
- `GET /cards?set_id=OGN&page=1&size=2&sort=collector_number` works as documented.
- Card record fields actually present: `id, name, riftbound_id ("ogn-001-298"), tcgplayer_id (string), collector_number (int!), attributes{energy,might,power}, classification{type,supertype,rarity,domain[]}, text{rich,plain,flavour}, set{set_id,label}, media{image_url,artist,accessibility_text}, tags[], orientation ("portrait"|…), metadata{clean_name,updated_on,alternate_art,overnumbered,signature}, new`.
- **No `public_code` field** (PLAN mentions it). Use `riftbound_id` / set+collector_number.
- `collector_number` is int → zero-pad to 3 for printing_id.
- Extra flag `metadata.signature` (signed variants) — map to `alt_art`? decide at parse.
- `orientation` field exists → some cards (battlefields?) landscape. Guide box is portrait — must handle (rotate ref image to portrait).
- Images: Riot CDN `cmsassets.rgpub.io/...-744x1039.png` (744×1039, >600px OK).

### Riftcodex full fetch (2026-09-25, raw dir `data/raw/riftcodex/20260925T203217Z`, 20 requests)
- 1451 cards, 1197 distinct `name`s (212 names with >1 printing).
- `riftbound_id` segment carries variant suffix: `ogn-007a-298` (alt art), `ogn-299*-298` (overnumbered/sig star), `pr-246a` / `pr-246b`. `collector_number` int drops it → **derive collector_number from riftbound_id segment**.
- **Duplicate riftbound_ids (294 rows, all OPP)**: "Annie - Dark Child" + "Annie - Dark Child (Metal)" share id AND image URL, different tcgplayer_id. Metal = physical metal card, same picture → separate printing, suffix `M`, same image hash (→ `same_image_cheapest`).
- `name` embeds variant tags: `(Alternate Art)` 100, `(Overnumbered)` 72, `(Signature)` 36, `(Metal)` 28, `(Starter)` 4, `(271..274)`, `(GG EZ)`, `(Launch Exclusive)`, `(Ultimate)`. → **strip trailing `(...)` for base name** so siblings group correctly (§6.4).
- `metadata.clean_name` = punctuation-stripped name incl. tag ("Annie Dark Child Metal") — not useful for grouping.
- Flags: alt_art 100, overnumbered 72, signature 36 (mutually exclusive).
- Rarities: Common, Uncommon, Rare, Epic, Showcase (120), Promo (148). → H5 tier mapping needs Showcase + Promo.
- Types: Unit, Spell, Legend, Gear, Battlefield (71, all **landscape**), Rune.
- 227 VEN cards have no tcgplayer_id → price match via set+number.
- `pr-036a-298` has collector_number 167 (inconsistent) — trust riftbound_id segment.
- Same tcgplayer_id on pr-246a and pr-246b (Viktor) → one price feeds two printings.

### TCGCSV (verified 2026-09-25)
- `last-updated.txt` → `2026-09-25T20:05:42+0000`
- Riftbound categoryId = **89** ✅
- Groups (groupId abbr name): 24344 OGN, 24439 OGS, 24519 SFD, 24560 UNL, 24698 VEN, 24343 PR, 24528 OPP, 24552 JDG, plus 24832 LGC Legacy, 24819 RAD Radiance, 24797 SGN Secret Garden (not in Riftcodex — likely unreleased), 24861 RBUN / 24502 RWB bundles (sealed).
- **Group match must verify abbreviation**: Riftcodex tcgplayer_id wrong for OPP, null for VEN. Rule: match by abbreviation == set_id first; use rc tcgplayer_id only if abbreviation missing.
- Budget all 8 sets: 3 + 2×8 = 19 ≤ 20 ✅ (tight).
- OGN group: 365 products, 529 price rows. Sealed products have `extendedData: []`.
- **subTypeName values: `Normal`, `Foil`** (OGN: 186 Normal, 343 Foil). Many cards have **Foil-only** price (rares+ likely foil-only printings) → such a card's base row must take the Foil price (no separate foil row); add `F` row only when BOTH Normal and Foil exist.
- extendedData keys: Rarity, Number, Card Type, Energy Cost, Power Cost, Might, Domain, Description, Flavor Text, Tag.
- `Number` format `"001/298"`; variants: `"007a/298"` (alt art), `"306*/298"` (signature/overnumbered star). Parse number = part before `/`, keep suffix.
- Riftcodex `tcgplayer_id` == TCGCSV `productId` (e.g. 652771 Blazing Scorcher) ✅ — cascade step 1 works.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| | |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| | |

## Resources
- Riftcodex docs: https://riftcodex.com/docs/endpoints/cards/ , /docs/endpoints/sets/
- TCGCSV: https://tcgcsv.com/tcgplayer/categories
- onnxruntime-web docs (check WebGPU import path + wasmPaths before Phase 3)

## Open Risks
- Python 3.13: torch/timm/onnx/albumentations wheel availability — check at Phase 1 setup; may need 3.11/3.12 venv.
- OneDrive sync on `data/` (images, embeddings) may slow/lock files — consider excluding.
