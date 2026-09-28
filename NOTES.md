# NOTES — decisions, deviations, results

## Phase 0 — Fetch & cache

### Testing (`cd pipeline && .venv/Scripts/python -m pytest tests -q` → 27 pass)
- Offline always: `conftest.py` makes `requests.Session.get` fail for every test.
- Unit tests: parsing, pool filter, matching cascade, overrides, pHash grouping (trimmed real fixtures in `tests/fixtures/`, regenerate with `tests/make_fixtures.py`).
- E2E (`test_fetch_e2e.py`): a fake HTTP server serves the fixtures + generated images; all `config` paths point at a temp dir (real `data/` untouched). Covers HTTP retry/403/cache/User-Agent, `fetch_raw` paging/resume/budget, and `fetch_cards` / `fetch_prices` `main()` including 0-request re-runs, frozen prices, and the override → `--rematch` loop.
- Bug caught by E2E: after narrowing `DEMO_SETS`, a fresh fetch skipped OPP (Nexus Night). Fixed in `RiftcodexSource.fetch_raw`.

### Cache location
- Everything under `data/` (gitignored), kept inside OneDrive by choice. Raw API responses: `data/raw/<source>/<UTC timestamp>/` with `_complete` marker; images `data/cards/images/` (~1.1GB).

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

## Phase 1 — Offline pipeline

### Environment / versions
- CPU only: i7-1255U (10 cores), 16GB RAM, Intel Iris Xe (no CUDA). torch CPU wheels.
- Pinned: torch 2.14.0+cpu, torchvision 0.29.0+cpu, timm 1.0.30, onnx 1.23.0, onnxscript 0.7.2, onnxruntime 1.30.0, albumentations 2.0.8, opencv-python-headless 5.0.0.93, numpy 2.5.3.
- `config.py` switches stdout/stderr to UTF-8 on import: torch.onnx prints emoji and the Windows console (cp1252) crashes.

### Deviations
| Deviation | Why |
|---|---|
| ONNX **opset 18** (PLAN: 17) | torch 2.14 uses the torch.export-based exporter; it upgraded 17→18. Ops: Conv, HardSwish, HardSigmoid, ReduceMean, Relu, Add, Mul, Div, Sub, Reshape, ReduceL2, Clip, Expand — all supported by ORT web (wasm + webgpu). |
| Layout signature: float64 math, mean **floor** 1e-3 instead of `+1e-6`; empty tiles (norm < 1e-3) in both maps score 1 | Float noise on near-blank images was amplified to non-zero signatures; identical cards with plain areas scored only ~0.2. TS port must copy these rules. |
| UI images are 372×520 JPEG q85 (67MB) instead of copied PNGs (1.1GB) | Price card only needs ~370px. |
| Only non-foil printings are embedded; `layout.bin` only covers printings of look-alike names | Foils share the image; decide reaches them via cards.json + imageHash. Layout only runs across differently-pictured siblings. |
| `meta.json` has extra `rowsPerPrinting` | sanity/eval need row layout (row % 9 == 0 is the clean image). |
| Augmentation at 448×640 then bilinear to 224×320 | Blur/noise at camera-like scale; final resize identical to clean refs (§4.5). |

### Results
- ONNX vs PyTorch: worst cosine **1.000000** over 5 images ✅. `embedder.onnx` 17.1MB, input `[1,3,320,224]` → `embedding [1,1280]`.
- ingest: 1797 printings, 947 names, UI images 67MB.
- embed: 1287 printings × 9 rows = **11,583 × 1280 = 59.3MB** in 27.6 min (0.8 printings/s on CPU, augmentation-bound). Over the 25MB warning → revisit in Phase 3 (PCA 1280→256 baked into ONNX if load time or searchMs p95 > 20ms).
- layout.bin: 461 printings (look-alike names), 8.3MB. prices.json: 1797, median $0.28, max $3,624.82.
- parity fixtures: OGN-007 (look-alike group), OGN-001, OGN-232, SFD-054, UNL-026.
- **Leave-one-out: 98.7% ✅** (target 95%). Top misses are signature ↔ normal twins (OGN-301→301S, OGN-306S→306, OGN-303→303S): same art, different frame → layout check's job. Rest are single cross-card misses.

### Look-alike acceptance — bar changed (human decision 2026-09-25)
PLAN's bar ("layout alone beats every sibling ≥ 95% in every group") **failed: 88.4%, 57/180 groups**. Diagnosis: two kinds of group —
1. *Different art, same frame* (e.g. Veteran Poro SFD-099 vs UNL-223): layout can't separate by design; the embedding does.
2. *Same art, tiny overlay* (signature showcase vs overnumbered, e.g. Lee Sin OGN-304 vs 304S — a thin gold autograph; pHash distance 6): hard for anything.

The app never uses layout alone; §6.4 combines them. Human approved the new bar: **combined (0.5·embed + 0.5·layout) ≥ 95% overall**. Embed scores use the clean reference row only (conservative vs the app's best-of-9 rows).

| Score | Overall (3688 aug images) | Groups ≥ 95% |
|---|---|---|
| layout only | 88.4% | 57/180 |
| embed only | 98.3% | 159/180 |
| **combined 0.5/0.5** | **98.8% ✅** | 161/180 |

**19 weak groups → Phase 3 calibration** (`pipeline/out/sanity_groups.json`):
- Base vs alt art where layout is right but embed is weak (Poppy - Paragon C69 L94 E69, Lillia - Fae Fawn C75, Viktor - Innovator C81 L100 E62, Jhin - Murderous Artist C81 L100, Rumble, Azir): a higher LAYOUT_WEIGHT should fix these — tune on real photos.
- Signature vs overnumbered showcase (Lee Sin, Yasuo, Volibear, Leona, Irelia, Aphelios): expect `ask` (chooser) on stage.
- `config.EMBED_W/LAYOUT_W` renamed **`EMBED_WEIGHT/LAYOUT_WEIGHT`** (LAYOUT_W already = edge-map width 56; the clash broke the layout code). App `config.ts` should use the same names.

### Phase 1 accepted ✅
- pytest 58 pass · ONNX parity 1.000000 · leave-one-out 98.7% · look-alike combined 98.8% · aug_preview approved by human.
- Open for later: embeddings 59MB (> 25MB warn) → measure load + searchMs in Phase 3 before PCA.

## Phase 2 — App shell (2026-09-26)
- Stack: Vite 8.3, React 19.2, TypeScript 6.0 (`strict: true` added — template omits it), vitest 5.0, oxlint. Deps: onnxruntime-web 1.30, comlink 4.4, canvas-confetti 1.9; dev `@types/canvas-confetti` (types only). `jsdom` tried and removed (all tested logic is DOM-free).
- `npm create vite` refuses non-empty dirs and `app/public` already had pipeline output → scaffolded in scratchpad, copied in with `cp -rn`.
- Generated `app/public/{data,models,fixtures}` gitignored (except `data/tiers.json`). `vite build` copies ~175MB of public data into `dist/` — delete after local builds (OneDrive).
- Keys: D debug, N pack mode, B capture background, M mirror (CSS only; crops use the raw frame).
- Guide box colours: grey idle, yellow hold still, blue recognizing, green flash on reaction.
- Browser check (Chrome, "720p HD Camera" 1280×720, element 1920×808, object-fit cover): 30–31 fps; overlay centred ±1px, aspect 0.699 vs 0.700; empty-box presence ~1.0 (threshold 18); IDLE→CANDIDATE→RECOGNIZING→COOLDOWN observed with the stub.
- Fix: background auto-capture after 15 frames (0.5s) grabbed the frame mid auto-exposure → presence stuck at 57–86. Now 60 frames (~2s). `B` recaptures any time.
- `RecognitionResult` gains `packMode` (logged per result, §6.4b).
- Human live check 2026-09-26: real card held in the box runs the full flow. Still→recognize latency not reported; Phase 3 metrics will record it. **Phase 2 accepted.**

## Phase 3 — Vision worker (2026-09-26, in progress)
### onnxruntime-web setup (1.30.0) — what worked
- `import * as ort from "onnxruntime-web/webgpu"` (default bundle build finds its `.wasm` via `import.meta.url`); `optimizeDeps.exclude: ["onnxruntime-web"]` in vite.config.
- Session: try `executionProviders: ["webgpu"]` when `navigator.gpu` exists, else `["wasm"]`. This laptop: **webgpu** (Iris Xe), 4 wasm threads (COOP/COEP headers set → `crossOriginIsolated`).
- Pitfalls hit: (1) React StrictMode's double effect → two concurrent `InferenceSession.create` → `RuntimeError: memory access out of bounds` ⇒ `init()` memoized. (2) Overlapping `session.run` calls hang on WebGPU ⇒ runs serialized in the worker. (3) Output tensors may view ORT's SharedArrayBuffer memory ⇒ copied before returning/transferring.

### Parity page ✅ PASS
- webgpu: embedding cosine **1.000000** and layout cosine **1.000000** on all 5 fixtures. TS layout also matches Python fixtures in vitest (`layout_parity.json`, max err < 1e-4).

### Search moved into the model (deviation, PLAN §6.3 fallback #2 done first)
- JS brute-force in the browser worker: **70–80 ms/query** (p95 91 ms) vs budget p95 ≤ 20 ms. (Node: 17–39 ms; the page was a hidden automation tab, likely efficiency-throttled, but even 5× PCA savings would leave it borderline.)
- Skipped PCA (fallback #1: accuracy cost + still ~15 ms) and went to fallback #2: `export_search.py` appends `scores = embedding @ E^T` → `recognizer.onnx` (76.5 MB; numpy max err 5.6e-8). App no longer downloads `embeddings.bin`; pipeline/eval still use it.
- Result (webgpu, hidden tab, 40 runs): **search p50 0.5 / p95 1.4 ms**, infer+matmul p50 30 / p95 40 ms, whole recognize call p50 35 / p95 49 ms. Load 1.8 s + warm-up 0.45 s.

### Behaviour notes
- Reprints with identical art share a canonical hash, e.g. Fury Rune OGN-007 = VEN-R01 = OPP-007B (NN). They form one same-picture group; layout only separates them from the alt art OGN-007A. Booster mode → cheapest of the group (VEN-R01 here), Nexus Night mode → OPP-007B. Correct per §6.4/§6.4b; reason is reported as `layout_resolved` because the group was chosen by layout first.

## Detection trigger: change-based (human decision, 2026-09-26)
- Symptom (live): after each card the app stayed in COOLDOWN ("Remove card") until B was pressed.
- Cause: presence = difference from an empty-box snapshot; with a user-facing webcam the "empty" box is the user's face/room, which moves and auto-exposure shifts, so presence stayed > 18 after the card left.
- Fix: `change` = difference from the view last sent to recognition. Still + sharp + changed (or retrying) → recognize; the recognized view is snapshotted so the same card held still never re-triggers; a changed view (removed or swapped) leaves COOLDOWN. B = rescan. Warm-up 60 frames before the first check.
- Risk: empty views (the user's face) now get checked too; the 0.42 threshold should reject them, unproven (no empty-box eval photos). Add an empty-box guard (card border / edge check) if false answers appear.

## Card detection anywhere in the frame (owner request, 2026-09-27) — PLAN §5.7
- **Owner choices:** trained ML detector (over a classical edge/quad finder), guide box kept as fallback.
- **Model:** corner keypoints, not YOLO — one card per frame, and 4 corners give the perspective warp directly. `mobilenetv3_large_100` (only backbone cached offline) features at strides 8/16/32 → 64-ch top-down fusion → 4 heatmaps (48×28) → in-graph soft-argmax; present head from pooled stride-32 + fused features. Loss BCE + 10·L1 (x scaled by map aspect) + JS to a σ=1-cell Gaussian. ONNX 13.3 MB, parity 3.6e-7.
- **Input:** full raw frame *stretched* to 384×224 (no letterbox) in both training and the app, so 0–1 corners map straight back to video pixels. 4:3 cameras are covered by 20% 4:3 synthetic frames.
- **Speed (i7-1255U CPU):** synth was 425 ms/sample (numpy at 2× res) → 56 ms after generating at output res, building smooth fields/glare small, float32 noise. Freezing stem + blocks 0–2 halves backward (6.4 → 3.5 s per 24). Measured ~4 s/step at batch 16 with 2 workers → 2000 steps ≈ 2¼ h.
- **Smoke run** (50 steps, synthetic only): synthetic val present 100%, corner error 8.5% of card height. Not meaningful for real frames (Phase 3 lesson) — needs the human's frames.
- **App:** detector loads after the recognizer; a missing `detector.onnx` (Vite serves index.html for it → content-type check) means guide box only. Detect every 100 ms on a 384×224 `createImageBitmap` resize; skipped while one is in flight. Region = detected card if p ≥ 0.5 and ≤ 400 ms old, else guide box. Signals on the warped card (640-wide frame downscale → `warpGray`); corner jitter > 3% of card height forces "moving" (the warped card looks identical while it slides). Recognition warps the *full-res* frame in the worker (`warpRgba`, OpenCV-matched).
- **Open question:** the embedder was fine-tuned on guide-box crops (card + margin) but references are tight card images; detector crops are tight. Acceptance item "top-1 not worse than guide box" checks this on the human's labelled frames (they carry `printingId`).
- **Test flake fixed:** `search.test.ts` perf check used the mean of 5 runs; with more test files in parallel it hit 107 ms > 100. Now best-of-5 (the JS search isn't on the live path since Phase 3).
- **Guide box removed (owner, 2026-09-28)** when the detector is loaded: nothing drawn, no fallback region; status pill instead; nothing watched while the detector loads. Guide box (drawn + watched) only if `detector.onnx` is missing. The green debug quad stays (owner liked it).
- **Double reactions (owner report, 2026-09-28):** likely causes (a) detector dips while the card is held → old path fell back to the guide box (checked an empty view) and then saw the card as new; the first no-fallback version forgot it after 0.5 s; fixed with hysteresis (start ≥ 0.5, keep ≥ 0.3) + `DETECT_LOST_MS` 1500; debug counts "card lost → forgotten". (b) Claude's automation Chrome tab was running a second copy of the app on the same camera at that moment (reactions play in both tabs) — closed. Confirm live.
- **Git note:** `main` contains Phase 4 twice (squash `05a7735` + the old `--no-ff` merge `951de36`) because the owner merged origin instead of force-pushing; trees identical, left as is.

## Phase 5 — Reactions (2026-09-27)
- **Theme (owner): comedic tiers**, PLAN §8.2 marked revised. 0 golf clap (3 slow claps, "nice.") · 1 participation trophy (kazoo "doo-doot", tiny confetti) · 2 sitcom (studio-audience "OHHH" caption, zoomed price, small shake) · 3 instant replay (broadcast banner, ref whistle + stadium roar, slow zoom, confetti) · 4 air horn / MLG (x3 horn, SHEEEESH, hitmarkers, flame edges, 🔥💯 confetti, strong shake) · 5 over-edited epic (black + letterbox + spotlight + spinning card, "wait for it…", then at `EPIC_IMPACT_MS` white flash, zoom punches, lens flare, deep-fry, glitchy LEGENDARY PULL, price count-up, emoji storm, "MLG PRO EDIT™" watermark; then settles into a gold frame + banner until the next card or a click).
- **H5 (owner):** Common 0 · Uncommon 1 · Rare 2 · Epic 3 · Promo 4 · Showcase 5 · foil +1 (capped at 5). Price tiers unchanged from PLAN §8.1 (≤1/5/20/75/200/above); on the booster pool that is 1242/205/80/54/61/51 printings, so ~69% of pulls get the golf clap — which is the joke.
- **Firing:** the state machine's `react` effect (once per hold; existing machine tests) → `onReact` → tier from the shown printing's price. `onReact` runs synchronously right after `recognize()`/`choose()`, before React commits `shownId`, so `useRecognizer` exposes a synchronous `shownRef`. Missing price → rarity tier (never silent).
- **Deviations:** (1) tier 5's deep-fry uses `backdrop-filter` (saturate/contrast/hue), not only transform/opacity — brief, one layer. (2) Stage shakes/zooms use the Web Animations API on `<main class="stage">` instead of CSS classes, so they replay without re-rendering the stage (it holds the `<video>`); `.app` got `overflow: hidden` because the transformed stage caused a page scrollbar. (3) "Click to start" unlocks audio and starts the stability loop, but the recognizer worker still loads on page load (faster first card) rather than on the click. No PixiJS.
- **Sounds:** all Web Audio (noise bursts, detuned saws through formant bandpasses, waveshaper distortion, compressor on the master). Override per tier with `tiers.json` → `"sounds": { "5": "/sounds/tier5.mp3" }`; a failed load falls back to the synth with a console warning. Volume `CFG.REACTION_VOLUME`.
- **Automation quirk:** in the Claude-in-Chrome tab (`visibilityState: hidden`) rAF never fires and timers are throttled, so the tier 5 count-up shows $0.00 and screenshots lag the timeline. Verified via computed styles instead (overlay fully visible at 2.6 s). Not an app bug.

## Phase 4 — Price card (2026-09-26)
- `ui/PriceCard.tsx` is the user-facing result; `ResultChip` kept as a **debug-only** view (owner request): shown with the debug panel (D), bottom-right, only right after an accept (Phase 3 gating), now with printing id + decision reason. Logic in `prices/priceCard.ts` (`formatUsd`, `formatAsOf`, `variantLabel`, `findFoilSibling`, `priceCardView`), 14 unit tests.
- **Persistence:** App shows `rec.shownId` whenever it's set (was: only in COOLDOWN + accepted). `shownId` changes only on an accept or a chooser pick — the same moment the reaction fires — so the card stays through the next card's CANDIDATE/RECOGNIZING and through "not sure" results. Recognition/state-machine behaviour unchanged.
- **Deviation — foil hint trigger:** shown whenever the displayed non-foil printing has a same-picture foil sibling, not only when `reason === "same_image_cheapest"`. `layout_resolved` and chooser picks also go through `pickSamePicture` (cheapest in the group), so the same ambiguity applies; with reason `ok` there is no sibling, so nothing changes there. The card therefore no longer depends on `rec.last` (which later rejected results overwrite).
- **Missing price never crashes:** `formatUsd` returns "—" for undefined/NaN/Infinity/negative; the card shows "No price" and hides the as-of line. Foil sibling without a price → "could be foil" (no amount).
- **Dates:** `asOf` shown in UTC ("Sep 25, 2026") so it can't shift a day with the viewer's time zone.
- **Build gate:** `prices/pricesData.test.ts` loads `public/data/{cards,prices}.json` (via `import.meta.glob` — keeps node types out of the app tsconfig) and asserts one finite price ≥ 0 per printing, no extras/duplicates, parsable `asOf`. `npm run build` runs it before `vite build`. If `public/data` is absent (fresh clone) it skips with a warning. Verified it fails on a dropped row and on a null price.
- **Set name (optional item, done):** `ingest.py` adds `setName` from the cached Riftcodex `sets.json` (falls back to the code, with a WARN). Nexus Night's set is "Riftbound Organized Play Promotional Cards" (long; the card wraps). The chooser now uses the same labels/price formatting.

## Nexus Night pack mode switched OFF (owner decision, 2026-09-27)
- Live check: in Nexus Night mode, Lee Sin - Centered showed $0.20 (OGN-151). TCGCSV's OPP group has *Lee Sin, Centered* 151b/298 (product 693156, foil $57.45) but Riftcodex — the pool source — doesn't list it, so it never entered the pool.
- Not a one-off: 118 TCGCSV OPP products aren't in the pool; after dropping Metal / Top 8 / Champion prizes, 39 remain (22 Vendetta /166 promos incl. Mel 069b $231, Lee Sin 151b, Mystic Poro 171, Teemo GG EZ 197b $1,430, Poppy alt 178a, 12 runes, a token). TCGCSV rarity doesn't mark them as Promo (Lee Sin 151b = "Rare"), so the data can't say which come from Nexus Night packs.
- Owner: "it should state promo, if not then we can remove the Nexus Night feature for now and keep it as a backlog" → `CFG.NEXUS_NIGHT_ENABLED = false` in `app/src/config.ts`: pack mode is always `booster` (NN printings filtered out), N key + toolbar button + footer hint hidden. `pool`, `packMode.ts`, `packmode.py`, the saved localStorage value and the 104 NN printings stay for later. `pipeline/eval.py` still evaluates NN photos in NN mode (offline only).

## Pack mode (human request, 2026-09-25) — PLAN §6.4b added
- Setting `booster` (default) | `nexus_night`. Booster: Nexus Night printings excluded from candidates. Nexus Night: inside a same-picture group, Nexus Night printings win (cheapest of them); others still match normally.
- `cards.json` gains `pool` (booster 1693, nexus_night 104). Reference logic `pipeline/packmode.py` (tested); `fetch_cards.is_nexus_night` now uses the same `pool_of` rule. TS port `vision/packMode.ts` must match; UI toggle `N` comes with Phase 2/3.
- Impact: 85 same-picture groups resolve differently; median +$0.54, max Ahri - Nine-Tailed Fox $1.58 (OGN-255) → $317.31 (OPP-255). The other 19 Nexus Night promos have their own picture.
- Cosmetic: some OPP ids get `X`/`X2` suffixes (e.g. `OPP-193X`, `OPP-009X2`) — several untagged OPP records share one riftbound_id. Harmless; revisit if ids are shown to users.

## Phase 0 — final pool

### Final pool (after booster-only rule, 2026-09-25) — Phase 0 accepted
- **1287 base printings + 510 foil rows = 1797**, 947 names. OGN 516, SFD 411, UNL 403, VEN 363, OPP (Nexus Night) 104 (counts incl. foil rows).
- Variants: normal 976, alt_art 207, promo 104, foil 510.
- Prices: **1797 / 1797 = 100% auto** (tcgplayer_id 1610, set_and_number 187; marketPrice 1793, midPrice 4). 0 unmatched, no manual overrides needed (all 28 no-price items were excluded promos).
- Look-alike groups: 180.
- **Reused-image variants: 104 = every Nexus Night promo** — source serves the base card art. Until real images are supplied (H7, `data/cards/image_overrides/<printing_id>.png`), a Nexus Night promo is treated as "same picture" as its base → app shows the cheaper printing with a hint. The 19 VEN alt arts flagged earlier dropped out: their `AA` twins were tagged duplicates now excluded.
