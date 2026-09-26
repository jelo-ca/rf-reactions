# Rift Pulls — Retrospective (Phases 0–3, 2026-09-25 → 26)

A candid look at what was built, what the numbers said, where they misled us, and what to carry forward. Written mid-Phase 3, while the fine-tuned model is being rebuilt.

---

## 1. Summary

In two days we built the full pipeline: fetching and pricing every booster-pack printing, an offline embedding pipeline, a browser app with a camera loop, and an in-browser recognizer on WebGPU. Engineering quality is high. Browser and Python agree to six decimal places, search runs in 1.4 ms, and there are 137 automated tests across pipeline and app.

**The recognizer did not work on real cards.** Every offline check passed: leave-one-out 98.7%, look-alike 98.8%, parity 1.000000. Yet the first 18 real photos scored **0% top-1**. The reason: every check up to that point measured the model against images *we generated ourselves*. The single most important lesson of this project is **get real data into the loop on day one**.

After diagnosing the gap (framing, lighting, hands, and a backbone that looks at card frames rather than art), a fine-tuned model reached **61% top-1 on real photos after 250 steps**. That number is optimistic because the same photos picked the checkpoint. Phase 3 is not done.

---

## 2. Timeline

| When | What | Key number |
|---|---|---|
| Day 1 | Planning files; Phase 0 fetch (Riftcodex, TCGCSV) | 1451 → 1797 printings, 100% priced, 19/20 requests |
| Day 1 | Git workflow set (human request) | branch per feature, `--no-ff` merges |
| Day 1 | End-to-end fetch tests (human request) | caught a real bug: Nexus Night set not fetched |
| Day 1 | Phase 1 pipeline: augment, ONNX, embed, layout | ONNX parity 1.000000; embed 27.6 min on CPU |
| Day 1 | Look-alike check failed (layout-only 88.4%) → diagnosed → bar changed by human | combined 98.8% |
| Day 1 | Pack mode (human request) | Ahri: $1.58 booster vs $317.31 Nexus Night |
| Day 2 | Phase 2 app shell; human confirmed the hold-still flow | 30 fps, overlay aligned ±1 px |
| Day 2 | Phase 3 worker, parity page, decision rule | parity PASS on WebGPU |
| Day 2 | JS search measured in browser → too slow → baked into ONNX | 91 ms → 1.4 ms p95 |
| Day 2 | **Human: "Discipline ranks 3rd–5th"** | first real-world signal |
| Day 2 | 18 real photos evaluated | **top-1 0%, median rank 16** |
| Day 2 | Augment v2 + standardization + fine-tune | step 250: **61% real top-1** |
| Day 2 | Low-memory guard killed training and dev server | step 250 checkpoint kept |

---

## 3. What went well

### 3.1 Verification between languages and runtimes
Every place where two implementations must agree got a mechanical check:
- ONNX vs PyTorch (cosine 1.000000).
- Browser vs Python: the parity page, 1.000000 on both embedding and layout.
- TypeScript layout vs Python layout: generated fixtures in vitest, error below 1e-4.
- `decide.py` vs `decide.ts`: mirrored test suites.
- `packmode.py` vs `packMode.ts`: mirrored tests.

Any drift is now caught by a test instead of a confusing demo failure.

### 3.2 Diagnosing before changing the bar
When the layout check failed in Phase 1, we measured three alternatives per group (layout, embed, combined) and looked at the actual images before proposing anything. The human then made an informed decision. The same pattern repeated three more times:
- The "OGN-007 → VEN-R01" scare turned out to be an identical-art reprint, which the rule handles correctly.
- Slow search was measured before any fix was chosen.
- The Discipline miss was traced through reference-space neighbours before anyone touched the model.

### 3.3 Measure in the environment that matters
Node said search took 17–39 ms; the browser said 70–91 ms. Had we trusted Node, we would have shipped a 4× budget overrun. Moving search into the ONNX graph (fallback #2 in the plan) instead of PCA (fallback #1) was a decision based on measurements, and it paid off: 1.4 ms p95 with no accuracy cost.

### 3.4 Tests that found real bugs
- The end-to-end fetch test caught that a fresh `--refresh` would silently drop all Nexus Night promos. The bug was invisible because the on-disk cache predated the pool change.
- Layout unit tests caught two real bugs: float-noise amplification on blank images, and empty tiles scoring 0 instead of 1.

### 3.5 Human-in-the-loop decisions were clean
Every scope change was asked, answered and logged in `NOTES.md` with the reason: booster-only pool, Nexus Night rule, OGS exclusion, look-alike bar, pack mode, OneDrive, and using the step-250 checkpoint. There are no silent deviations.

---

## 4. What went wrong, and why

### 4.1 The big one: validating on synthetic data only
| Metric | Value | Measured on |
|---|---|---|
| Leave-one-out retrieval | 98.7% | our own augmentations of our own reference images |
| Look-alike combined | 98.8% | same |
| Parity | 1.000000 | the same clean image through two runtimes |
| **Real photos, top-1** | **0%** | a webcam in a real room |

**Root cause.** The augmentations were designed from imagination ("slight tilt, some glare"), not from looking at real crops. Real crops differed in three ways the augmentations barely covered:
1. **Framing**: the card filled only 65–85% of the guide box, off-centre, with hand, face and room visible.
2. **Lighting**: backlit by a window, so the card was dark and washed out with a strong blue/purple cast and haze from the sleeve.
3. **Hands**: thumbs over the card edges.

The metrics were not wrong; they answered a different question from the one we cared about. The augmentation preview was approved by eye (it looked like "a card photo"), but nobody put it *side by side* with a real capture. That comparison took 30 seconds once we did it, and made the gap obvious.

**Compounding factor.** The ImageNet MobileNetV3 features encode the card-type *frame* more strongly than the art. Clean Discipline was closer to other Spells (0.77–0.81) than to its own camera shots (0.52–0.71). Synthetic retrieval still looked fine because augmentations were mild enough to stay near the clean image.

**What would have caught it earlier.** Capture mode existed in the plan for Phase 3. Pulling 10 real photos forward into Phase 1, before building the app, would have cost 10 minutes and saved most of a day.

### 4.2 Acceptance criteria that could pass while the product failed
Phase 1's acceptance criteria were all synthetic, so Phase 1 "passed". The plan put real-photo evaluation in Phase 3, after the app was built. Acceptance criteria should include at least one check against the real input distribution as early as possible, even a tiny one.

### 4.3 Misreading "it recognizes it"
In Phase 2 the human said "it recognizes it" about the *stubbed* recognizer, which accepts anything held still. I clarified that nothing was identified yet, but the phase was accepted without the requested latency number. Harmless here, but a sign to be precise about what a manual check actually verifies.

### 4.4 My own slips
| Slip | Effect | Lesson |
|---|---|---|
| Added `EMBED_W, LAYOUT_W = 0.5, 0.5` to config, where `LAYOUT_W` already meant the edge-map width (56) | broke layout code, 7 failing tests | grep for a name before adding it; prefer unambiguous names (`*_WEIGHT`) |
| `sed` to replace an emoji under Git Bash | silent no-op, second crash | use a real editor/parser for non-ASCII edits |
| Node patch scripts assumed LF | "missing" errors (worktree is CRLF via `autocrlf`) | normalize line endings in any patch script |
| A 60 s polling loop inside a 45 s browser-tool call | tool timeout, looked like a frozen page | keep in-page scripts short; poll from outside |
| Stopping `npx vite` via the task left the node child on port 5173 | restart failed | stop by port / run node directly |
| Planning files drifted (stale "Current Phase", reboot table saying "Phase 0") | the plan stopped being a reliable reboot source | update `task_plan.md` at every phase transition, not just `progress.md` |

### 4.5 Resource limits discovered late
This is a 16 GB, CPU-only laptop, with the data in OneDrive. The training run (4 data workers, 48-image batches) plus Chrome running the app plus the dev server tripped the low-memory guard. It was lucky the checkpoint saved at step 250, 25 steps before the kill. Heavy jobs need a budget: fewer workers, no co-running app, and checkpoints saved often.

---

## 5. Technical lessons

### 5.1 Recognition / ML
1. **The domain gap matters more than the model.** A realistic augmentation of *where the card sits in the crop* and *how it is lit* mattered more than anything else we tried.
2. **Pretrained features are generic.** For fine-grained retrieval among near-identical layouts (1,149 pictures, many sharing frames), expect to fine-tune. Metric learning with hard negatives from the model's own neighbours worked quickly: 0% → 61% in 250 steps, about 30 minutes on CPU.
3. **Put invariances in the model when you can.** Per-image channel standardization in the ONNX graph cancels colour casts identically for references and live crops, with no browser code to keep in sync.
4. **Choose checkpoints on real data, but keep a separate test set.** Our 18 photos both chose and scored the checkpoint, so 61% is optimistic. The next eval set must be fresh.
5. **Identical pictures are a product question, not a model question.** Reprints, foils and Nexus Night promos with reused art can't be separated visually. The pack-mode setting and the "cheapest in a same-picture group" rule are the right tools; better models won't fix them.

### 5.2 Browser ML (onnxruntime-web 1.30)
1. Import `onnxruntime-web/webgpu` and exclude it from Vite's `optimizeDeps`.
2. Set COOP/COEP headers for threaded wasm.
3. Make `init()` idempotent: React StrictMode's double effects create two sessions at once, which crashes ORT's wasm.
4. Serialize `session.run`: overlapping runs hang on WebGPU.
5. Copy outputs before transferring them; they can be views into ORT's `SharedArrayBuffer`.
6. A matmul in the graph beats a JS loop by about 60×. Move data-parallel work into the model.

### 5.3 Data pipeline
1. **Sources lie a little.** Riftcodex had wrong or missing group ids, 131 stale duplicate records, tags embedded in names, no collector-number suffixes, and a promo reusing base art. TCGCSV has Foil-only products. Verifying with real requests before writing parsers (a rule in the plan) saved a lot of rework.
2. **Cache raw responses, parse separately.** This made every parser fix free to re-run (0 network requests) and made fixtures trivial.
3. **Test the entry points, not just the helpers.** The E2E fetch test with a fake server and a temp data directory found the one bug the unit tests couldn't.

### 5.4 Windows specifics
UTF-8 stdout, CRLF worktrees, `py` launcher, port-bound orphan processes, OneDrive sync of gigabyte folders, and efficiency-mode throttling of background browser tabs, which distorts benchmarks.

---

## 6. Process lessons

1. **Front-load a thin end-to-end slice with real inputs.** Build the smallest path from real camera → match → answer first, even if ugly, then harden. We built each layer to high quality before the first real input flowed through all of them.
2. **Every "passed" number should state its population.** "98.7% on synthetic augmentations of reference images" is honest; "98.7%" invites over-confidence.
3. **Compare generated data to real data side by side** before approving it: a contact sheet of real crops next to synthetic ones.
4. **Keep the plan file current at transitions.** `progress.md` stayed good; `task_plan.md` drifted. The reboot test only works if the plan is true.
5. **Ask the human when the bar should move; never move it quietly.** This worked well every time and should continue.
6. **Budget compute and memory up front** on constrained hardware, and save checkpoints early and often.

---

## 7. Where we stand (numbers)

| Area | Status |
|---|---|
| Data | 1797 printings, 100% priced, 0-request re-runs |
| Tests | 79 pipeline + 58 app |
| Browser runtime | WebGPU; load ~1.8 s; recognize p95 ~49 ms; search p95 1.4 ms |
| Real-photo accuracy | pretrained 0% → fine-tuned (step 250) **61% top-1** on 18 photos / 3 cards (in-sample) |
| Phase 3 acceptance | **not met**: needs ≥ 90% top-1 on a fresh set, 0 wrong accepts, calibrated thresholds |

---

## 8. Next actions

1. Finish the rebuild with the fine-tuned weights; run `eval.py`; restart the dev server; live-retest Discipline.
2. **Human:** capture a *fresh* eval set: ≥ 20 printings × 3, hard pairs × 5, varied light including the ring light. Not to be used for checkpoint selection.
3. If fresh top-1 is below 90%: resume fine-tuning (2 workers, app closed) with online hard-negative mining and more steps; consider a stronger backbone if it plateaus.
4. Calibrate `ACCEPT_T`, `MARGIN_T`, weights and layout margin with `eval.py --calibrate`; target 0 wrong accepts.
5. Re-approve the v2 augmentation preview (human).
6. Only then move to Phase 4.
