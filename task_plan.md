# Task Plan: Rift Pulls — Demo Prototype

## Goal
Build local web app that identifies a held-up Riftbound card (exact printing) in <300ms p95, shows its price, and fires a value-scaled reaction — per `PLAN.md` (source of truth).

## Current Phase
**Phase 3 — recognition accuracy on real photos** (branch `feat/finetune-embedder`, off `feat/phase-3-vision`).
Step-1000 fine-tuned model built into the app (77.8% top-1 on 18 in-sample photos) → human live retest → fresh eval set.
Retrospective of everything so far: `docs/retrospective.md`.

## Phases
Full specs + acceptance criteria live in `PLAN.md`. Do not start next phase until acceptance passes.

### Phase 0: Fetch & cache (§4.0) — merged to main
- [x] Riftcodex + TCGCSV adapters, cached raw responses, 0-request re-runs
- [x] Pool (human): booster sets OGN/SFD/UNL/VEN + Nexus Night (untagged OPP) → 1287 base + 510 foil = 1797 printings
- [x] Prices 1797/1797 automatic (19/20 requests)
- [x] Offline tests incl. end-to-end fetch tests (fake HTTP server) — caught Nexus Night fetch bug
- [ ] H7 (optional, carry): real images for Nexus Night promos (all 104 reuse base art)
- **Status:** complete

### Phase 1: Offline pipeline (§4) — merged to main
- [x] ingest, layout, prices, augment, model, export_onnx (cos 1.000000, opset 18), embed (11,583 × 1280), parity, build_data.sh
- [x] Synthetic checks: leave-one-out 98.7%; look-alike combined 98.8% (bar changed by human from layout-only)
- [x] aug_preview approved (v1) — **v2 preview needs re-approval** (see Phase 3)
- **Status:** complete (but synthetic checks proved not predictive of real photos — see retrospective)

### Pack mode (§6.4b, human request) — merged to main
- [x] Spec, `pool` field, `packmode.py` + `packMode.ts` (mirrored tests), N toggle + badge + localStorage
- [x] `decide.py` / `eval.py` evaluate each photo in the pack mode matching its pool
- **Status:** complete

### Phase 2: App shell, camera, guide box, stability (§5) — merged to main
- [x] Camera + picker, guide box mapping, signals, state machine, debug panel, 33 tests, human live check
- **Status:** complete

### Phase 3: Vision worker, recognition, eval (§6) — branches `feat/phase-3-vision` → `feat/finetune-embedder`
- [x] Capture mode (C) + `sort_eval.py`
- [x] search.ts, layout.ts (matches Python fixtures), decide.ts, worker (ORT WebGPU→wasm), parity page PASS (cos 1.000000)
- [x] Search baked into `recognizer.onnx`: search p95 1.4 ms (JS loop was 91 ms)
- [x] Live recognition in app: chooser, result chip, debug top-5 + timings + p50/p95
- [x] Ring light (L) — human request; not yet verified live
- [x] `decide.py` (Python mirror, 10 tests) + `eval.py` (report + calibrate)
- [x] Human eval photos v1: 18 photos / 3 printings → **pretrained model: top-1 0%, median rank 16**
- [x] Diagnosis: domain gap (framing 65–85%, backlight/cast/haze, hand, tilt) + backbone embeds frame > art
- [x] augment v2 (realistic webcam crops) + per-image channel standardization in the model
- [x] Fine-tune (SupCon + hard negatives, real-photo validation): **step 250 → real top-1 61%, median rank 1**; killed at step 275 by low-memory guard; human chose to use step 250
- [x] Rebuild with fine-tuned weights: export cos 1.000000, embed 26.8 min, recognizer 76.5 MB, parity fixtures
- [x] `eval.py` (18 in-sample photos): **top-1 61.1%, top-5 83.3%, median rank 1**; scores now ~0.35–0.45 → provisional calibration ACCEPT_T 0.44 / MARGIN_T 0.04 (8/18 accepted, 0 wrong) applied to config.ts; weakest: SFD-042 Brutalizer
- [x] Dev server restarted
- [x] HUMAN live retest: "pretty accurate" → resume training
- [~] Resume fine-tune (--resume, 1000 steps, lr 5e-5, 2 workers, online hard-negative mining every 250 steps) → `pipeline/out/finetune_resume.log`; backup of step-250 weights kept in `out/finetune/`
    - Killed by low-memory guard at step 325 (with dev server). Step-250 check: real 55.6% (10/18 vs 11/18), synth 97.7%, margin 0.33→0.38 → not saved; best.pt unchanged
    - Human ran it in own terminal (`--log out/finetune_resume2.log`): **step 500 → real top-1 77.8% (14/18)**, flat at 750/1000; margin 0.33 → 0.41; best.pt = step 1000
- [x] Rebuild with step-1000 weights: with 8 augmented reference rows/card real top-1 only 66.7% → **clean references only: 77.8% top-1, 88.9% top-5**; recognizer 76.5 → 23.7 MB
- [x] Thresholds ACCEPT_T 0.42 / MARGIN_T 0.03 (7/18 accepted, 0 wrong; in-sample, provisional)
- [ ] Restart dev server when human asks → live retest
- [ ] HUMAN: fresh eval set (not used for training/selection)
- [ ] If improved: rebuild (export → embed → export_search → parity), re-eval, recalibrate
- [ ] HUMAN: live retest (Discipline first); re-approve aug preview v2
- [ ] HUMAN (H4): fresh eval set — ≥ 20 printings × 3, hard pairs × 5, varied lighting, **not** used for checkpoint selection
- [ ] Optional: resume fine-tuning (2 workers, close Chrome) with online hard-negative mining if real top-1 plateaus
- [ ] eval.py calibration → `app/src/config.ts` + `pipeline/config.py`
- [ ] Acceptance: top-1 ≥ 90%, 0 wrong accepts, 0 wrong-printing on hard pairs, ask ≤ 20%, searchMs p95 ≤ 20, layoutMs p95 ≤ 5
- [ ] Merge `feat/finetune-embedder` → `feat/phase-3-vision` → main
- **Status:** in_progress

### Phase 4: Prices + result card (§7)
- **Status:** pending (ResultChip is a Phase 3 stand-in)

### Phase 5: Reactions (§8)
- [ ] H5: confirm rarity → tier mapping (rarities: Common, Uncommon, Rare, Epic, Showcase, Promo)
- **Status:** pending

### Phase 6: Optional OCR tie-breaker (§9) — only if Phase 3 needs it (H6)
- **Status:** pending

### Phase 7: Metrics, polish, README, demo readiness (§10)
- **Status:** pending

## Open Questions
1. Will the fine-tuned model reach ≥ 90% on a *fresh* eval set, or does it need more steps / online hard-negative mining / a stronger backbone?
2. Is the in-browser matmul model (76.5 MB) acceptable for cold start (< 10 s target)? Measured load ~1.8 s on localhost.
3. Signature-vs-normal showcase pairs (thin gold autograph): will they need the chooser on stage? (expected yes)

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Repo root = current dir (`rf-reaction`) | PLAN.md name `rift-pulls/` is illustrative |
| `py` launcher / venv `pipeline/.venv` (3.13) | `python` not on PATH |
| Pool = booster sets + Nexus Night (untagged OPP), OGS/PR/JDG/Metal out | Human: booster packs only; NN only promo exception |
| `httpclient.py` not `http.py` | `http.py` shadows stdlib `http` |
| TCGCSV group match by abbreviation first | Riftcodex id wrong for OPP, null for VEN |
| Foil row only when Normal+Foil both priced | Many cards Foil-only |
| Keep `data/` inside OneDrive | Human choice |
| Look-alike acceptance = combined embed+layout ≥ 95% overall | Human; layout-only fails by design on different-art/same-frame groups |
| Pack mode setting (booster / Nexus Night) | Human; NN promos reuse base art, price differs up to $316 |
| Search baked into ONNX (recognizer.onnx) instead of PCA first | JS search 70–90 ms in browser; matmul on WebGPU 1.4 ms p95 |
| Fine-tune the embedder (was "no training needed") | Real photos 0% top-1 with ImageNet features |
| augment v2 + per-image standardization in model | Match real framing/lighting; cancel colour casts identically for refs and queries |
| Checkpoint selected on real photos | Synthetic metrics weren't predictive; caveat: in-sample, needs fresh eval set |
| Use step-250 checkpoint after memory kill | Human choice; 61% real top-1 already |

## Errors Encountered
Full log with attempts: `progress.md` → Error Log. Recurring themes:
| Theme | Examples | Prevention |
|-------|----------|------------|
| Windows console / encoding | cp1252 crashes on `→`, emoji, torch.onnx ✅ | `config.py` forces UTF-8 stdout; ASCII in own prints |
| Line endings | node patch scripts failed on CRLF (autocrlf) | normalize `\r\n` in patch scripts |
| Name collisions | `LAYOUT_W` weight overwrote map width | grep config for a name before adding it |
| Concurrency in ORT web | StrictMode double init crash; overlapping runs hang | memoized init, serialized runs |
| Process lifetime on Windows | TaskStop left vite node process on port 5173 | stop by port / run node directly |
| Memory | training + dev server killed by low-memory guard | 2 data workers, close Chrome, don't co-run heavy jobs |

## Git Workflow (human request 2026-09-25)
- One branch per phase/feature (`feat/...`, `fix/...`, `test/...`); small Conventional Commits; `--no-ff` merge to main when acceptance passes; never commit data/, .venv, .env.

## Notes
- Deviations, calibration results, library quirks → `NOTES.md`. Research/external content → `findings.md`. Session log + error log → `progress.md`.
