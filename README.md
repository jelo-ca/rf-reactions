# Rift Pulls

Real-time trading card recognition in the browser. Hold a *Riftbound* card up to a webcam and Rift
Pulls locates it anywhere in the frame, identifies the exact printing (including foil, showcase and
signature variants that share artwork), shows its market price, and plays a reaction scaled to the
card's value.

All inference runs on the user's device with ONNX Runtime Web (WebGPU, with a WebAssembly
fallback). There is no backend and no network traffic at runtime beyond loading the static files.

## How it works

```
Offline (Python)                                     Browser (on-device)
────────────────                                     ───────────────────
card data + images ─┐                                camera frame
price snapshot ─────┤                                   │
                    ▼                                   ▼
        augment → fine-tune embedder            card detector (4 corners)
                    │                                   │ perspective warp
                    ▼                                   ▼
   recognizer.onnx (embedder + search)  ──────▶  stability check → recognizer
   detector.onnx, cards / prices JSON                   │ top match + layout check
                                                        ▼
                                                 price card + reaction
```

1. **Detection.** A keypoint model (MobileNetV3 features, soft-argmax heatmaps) predicts the card's
   four corners and whether a card is present, ten times a second. The card is warped upright from
   the full-resolution frame, so it can be held anywhere, at an angle.
2. **Stability.** Frame differencing, corner jitter and a sharpness check wait until the card is
   held still before recognising, and skip views that were already checked.
3. **Recognition.** A MobileNetV3 embedder, fine-tuned with supervised contrastive loss and hard
   negatives on augmented card images, maps the crop to an embedding. The nearest-neighbour search
   over all printings is compiled into the same ONNX graph (≈1.4 ms p95 on WebGPU).
4. **Disambiguation.** Printings that share artwork are separated by a layout signature (tiled
   edge-map similarity) and confidence/margin thresholds; when the match is still ambiguous the user
   picks from a short list instead of the app guessing.
5. **Reaction.** The price (a one-time TCGplayer snapshot) maps the card to one of five reaction
   tiers. A "hype" mode maps by rarity instead.

The vision work runs in a Web Worker; the UI thread only handles the camera loop, overlays and
effects.

## Results

Measured on a Windows laptop (Intel Core i7-1255U) with a 720p webcam in Chrome, WebGPU backend.

| Metric | Result | Target |
|---|---|---|
| Wrong reactions, live session (32 pulls) | 0 | 0 |
| Accepted on the first hold, same session | 72% (23/32); the rest asked for a re-hold | — |
| Recognition top-1, in-sample photos | 77.8% (0 wrong accepts) | ≥ 90% on a fresh set |
| Card present / absent | 100% on held-out frames | ≥ 95% |
| Corner error, held-out frames | 6.0% of card height | ≤ 3% (accepted conditionally) |
| Card still → result, p95 | 398 ms | < 300 ms |
| Cold start, cached | 4.5 s | < 10 s |

Recognition takes ~120 ms (p50) of the end-to-end time; most of the rest is the wait for the card to
be still, which depends on the camera frame rate. See [NOTES.md](NOTES.md) for the full measurement
log, including approaches that were tried and dropped.

## Tech stack

- **App:** React 19, TypeScript, Vite, ONNX Runtime Web (WebGPU / wasm), Comlink, Web Audio
- **Pipeline:** Python 3.13, PyTorch, timm, OpenCV, ONNX
- **Data:** [Riftcodex](https://riftcodex.com) (cards), TCGplayer prices via [TCGCSV](https://tcgcsv.com)

## Repository layout

```
app/        Vite + React app (camera, stability, vision worker, UI, reactions)
pipeline/   data fetching, augmentation, training, ONNX export, evaluation
scripts/    build_data.sh (pipeline → app/public), package_site.py (deploy zip)
docs/       demo checklist, retrospective, phase hand-off notes
PLAN.md     specification and acceptance criteria
NOTES.md    decisions, deviations and measured results
```

## Getting started

**Requirements:** Node 20+, Python 3.13, a webcam, and a WebGPU-capable browser (Chrome or Edge)
for best performance.

### 1. Build the data and models

Generated files go to `app/public/{data,models,fixtures}` and are not committed.

```bash
cd pipeline
py -3.13 -m venv .venv
.venv/Scripts/python -m pip install torch==2.14.0 torchvision==0.29.0 --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install -r requirements.txt

.venv/Scripts/python fetch_cards.py     # card data + images (cached; re-runs make no requests)
.venv/Scripts/python fetch_prices.py    # price snapshot

cd ..
bash scripts/build_data.sh              # cards.json, recognizer, embeddings, prices, parity fixtures
pipeline/.venv/Scripts/python pipeline/export_detector.py   # optional: card detector
```

On macOS/Linux use `.venv/bin/python`. Without a detector the app falls back to a fixed guide box.

### 2. Run the app

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

Wait for the start screen to show every component loaded, then click **Click to start** (browsers
require a click before playing audio). Hold a card up and keep it still for a moment. Press **?** for
keyboard shortcuts; **D** opens the debug panel with live scores, per-stage timings and a session
export.

## Testing

```bash
cd app && npm test && npm run lint                   # 150+ unit tests (Vitest), oxlint
cd pipeline && .venv/Scripts/python -m pytest        # pipeline tests
```

`#parity` (e.g. <http://localhost:5173/#parity>) runs reference images through the browser model
and compares the output with the Python pipeline (cosine ≈ 1.0). `npm run build` fails if any card in
the pool is missing a price.

## Deployment

The app is a static site. To serve it under a sub-path:

```bash
cd app && npm run build:site                        # builds for /projects/rift-pulls/
cd .. && pipeline/.venv/Scripts/python scripts/package_site.py   # → out/rift-pulls-site.zip
```

Any static host works. Serving the page with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` enables multi-threaded WebAssembly. A first visit
downloads about 65 MB (runtime and models); the browser cache serves repeat visits.

## Status and limitations

- Recognition accuracy has only been measured on in-sample photos; a fresh evaluation set is the
  next step.
- The p95 latency target is missed because the camera loop runs at 10–16 fps on the test machine;
  the debug panel now separates camera frame rate from per-frame processing time to locate the cause.
- Nexus Night promotional printings are disabled until a reliable data source lists them.

## Credits

Card data from [Riftcodex](https://riftcodex.com); prices from TCGplayer via
[TCGCSV](https://tcgcsv.com). Sound and image sources are listed in
[app/public/memes/CREDITS.md](app/public/memes/CREDITS.md).

Rift Pulls isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
