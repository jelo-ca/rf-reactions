# Task Plan: Rift Pulls — Demo Prototype

## Goal
Build local web app that identifies a held-up Riftbound card (exact printing) in <300ms p95, shows its price, and fires a value-scaled reaction — per `PLAN.md` (source of truth).

## Current Phase
**Phase 5 — Reactions** (next; branch `feat/phase-5-reactions` off `main`). First: H5 rarity → tier mapping.
Phase 4 (price card) merged to `main` (2026-09-27, `--no-ff`) after the owner's live check. Nexus Night pack mode is OFF (backlog).
Phase 3 accepted as-is by the owner (2026-09-26): 77.8% top-1 / 0 wrong accepts on 18 in-sample photos is "acceptable right now"; accuracy items moved to the Phase 3 backlog below.
Retrospective: `docs/retrospective.md` · Learning doc: "Rift Pulls — How We Taught the Model to Recognize Cards" (Claude Doc).

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

### Phase 3: Vision worker, recognition, eval (§6) — squash-merged to main (`234037d`); **accepted as-is by the owner** (2026-09-26)
**Built**
- [x] Capture mode (C) + `sort_eval.py`
- [x] search.ts, layout.ts (matches Python fixtures), decide.ts, worker (ORT WebGPU→wasm), parity page PASS (cos 1.000000)
- [x] Search baked into the model (`export_search.py` → `recognizer.onnx`): search p95 1.4 ms (JS loop was 91 ms)
- [x] Live recognition: chooser, result chip, debug top-5 + timings + p50/p95
- [x] `decide.py` (Python mirror, 10 tests) + `eval.py` (report + calibrate, thresholds from `pipeline/config.py`)
- [x] Ring light: on/off switch (toolbar + L), thin white frame (clamp 32–80 px) + white page; human: "it works"
- [x] Change-based detection (human choice) replaces the background snapshot; B = rescan; PLAN §5.5 marked revised

**Accuracy work (real photos: 18 photos / 3 printings, in-sample)**
- [x] Pretrained: top-1 0%, median rank 16 → diagnosis: domain gap (framing, backlight/cast/haze, hand, tilt) + frame > art
- [x] augment v2 + per-image channel standardization in the model
- [x] Fine-tune run 2 (SupCon + hard negatives): step 250 → 61%; killed by low-memory guard at 275
- [x] Resumed run (online hard-negative mining, lr 5e-5), run by the human in their own terminal: **77.8% at step 500, held to 1,000**; margin 0.33 → 0.41
- [x] Clean references only (`REFERENCE_AUG_ROWS = 0`): 77.8% vs 66.7% with augmented refs; recognizer 76.5 → 23.7 MB
- [x] Thresholds ACCEPT_T 0.42 / MARGIN_T 0.03 (7/18 accepted, 0 wrong) — provisional

**Backlog (deferred by the owner; revisit before the demo)**
- [ ] HUMAN: live check of auto-detect (several cards in a row, one card held 10 s, empty box — any false answer?)
- [ ] HUMAN (H4): fresh eval set — ≥ 20 printings × 3, hard pairs × 5, varied lighting, never used for training or checkpoint selection
- [ ] HUMAN: re-approve aug preview v2 (`pipeline/out/aug_preview.png`)
- [ ] `eval.py --calibrate` on the fresh set → `app/src/config.ts` + `pipeline/config.py`
- [ ] If fresh top-1 < 90%: more fine-tuning (run in own terminal), stronger backbone, or real photos in training
- [ ] If empty-box false answers appear: add a card-present guard (border/edge check)
- [ ] Acceptance: top-1 ≥ 90%, 0 wrong accepts, 0 wrong-printing on hard pairs, ask ≤ 20%, searchMs p95 ≤ 20, layoutMs p95 ≤ 5
- [x] Squash-merged `feat/finetune-embedder` (incl. `feat/phase-3-vision`, 30 commits) into `main` as `234037d` — owner's request, before acceptance; tree identical, 79 + 58 tests pass
- **Status:** complete (accepted as-is; backlog above)

**How to run things** (the low-memory guard stops long jobs started from Claude Code's background shells)
- Dev server: `cd app && node node_modules/vite/bin/vite.js --port 5173`
- Training: in your own PowerShell, `cd pipeline; $env:PYTHONUTF8="1"; .\.venv\Scripts\python -u finetune.py --resume --steps 1000 --lr 5e-5 --workers 2 --log out\finetune_resumeN.log`
- Rebuild app data after training: `export_onnx.py` → `embed.py` → `export_search.py` → `parity.py` (≈ 3 min with clean refs), then `eval.py --calibrate`

### Phase 4: Prices + result card (§7) — merged to main (2026-09-27)
- [x] `pipeline/prices.py` → `prices.json` (built in Phase 1; fails loudly on a missing/duplicate/bad price)
- [x] `ui/PriceCard.tsx` replaces the Phase 3 `ResultChip`: image, name, set name + number, variant badge, USD price, "as of <date>", "could be foil: $X" hint (any same-picture foil sibling — see NOTES), Nexus Night marker
- [x] Appears when the reaction starts (accepted / chooser pick), stays until the next card is shown
- [x] Pure logic in `prices/priceCard.ts` + 14 tests; chooser reuses it
- [x] `setName` in `cards.json` (ingest + test)
- [x] Acceptance: every printing in the pool shows a price (1797/1797); `prices/pricesData.test.ts` runs in `npm run build`, so a missing price fails the build; UI shows "No price" instead of crashing
- [x] Live check found a Nexus Night pool gap (Lee Sin - Centered 151b missing) → owner: Nexus Night pack mode OFF for now (`CFG.NEXUS_NIGHT_ENABLED`), moved to backlog
- [x] Owner live check done; merged to `main` (`--no-ff`)
- **Status:** complete — 80 pipeline + 74 app tests pass, `tsc` / `oxlint` clean, `npm run build` green

### Backlog: Nexus Night pack mode (switched off 2026-09-27, owner)
- [ ] Find a source that says which printings come out of Nexus Night packs (Riftcodex misses some; TCGCSV doesn't mark them Promo) — 39 TCGCSV-only OPP candidates listed in NOTES.md
- [ ] Add missing printings (manual printings CSV or new source) + real images (H7), then set `NEXUS_NIGHT_ENABLED: true`

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
| Nexus Night pack mode OFF for now | Owner (2026-09-27): pool misses NN printings Riftcodex doesn't list (Lee Sin Centered 151b); data can't identify them → backlog |
| Search baked into ONNX (recognizer.onnx) instead of PCA first | JS search 70–90 ms in browser; matmul on WebGPU 1.4 ms p95 |
| Fine-tune the embedder (was "no training needed") | Real photos 0% top-1 with ImageNet features |
| augment v2 + per-image standardization in model | Match real framing/lighting; cancel colour casts identically for refs and queries |
| Checkpoint selected on real photos | Synthetic metrics weren't predictive; caveat: in-sample, needs fresh eval set |
| Use step-250 checkpoint after memory kill | Human choice; 61% real top-1 already |
| Long jobs run in the human's own terminal | Claude Code's low-memory guard stopped training twice |
| Clean reference rows only (`REFERENCE_AUG_ROWS = 0`) | After fine-tuning, augmented refs of other cards became false neighbours (77.8% vs 66.7%) |
| Phase 3 accepted as-is, accuracy deferred | Owner: current accuracy acceptable for now; move on to Phase 4 |
| Squash-merge Phase 3 to main before acceptance | Owner's request: keep a working snapshot on main before continuing |
| Change-based detection, no background snapshot | Human choice; the empty box behind a user-facing webcam is their face/room, so the snapshot went stale after every card |
| Ring light = on/off toggle, thin frame | Human request |

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
- **No `Co-Authored-By` / `Claude-Session` trailers** (human request 2026-09-26). All existing ones were stripped from every branch with `git filter-branch --msg-filter` (file trees verified identical); originals kept locally in `backup/pre-trailer-cleanup/*`.
- Remote `origin` = `git@github.com-personal:jelo-ca/rf-reactions.git` (SSH host alias). GitHub has `main` only up to the old Phase 0 merge.
- Pushes run from the human's own terminal (Claude Code's shell has no access to the SSH key: `Permission denied (publickey)`).
- [x] `feat/finetune-embedder` pushed by the human (origin at `b23742f`)
- [x] `main` force-pushed by the human (cleaned history `30f5a6e`), then the squash commit `234037d` pushed
- [ ] HUMAN: `git push` main (planning commits after `234037d` + the Phase 4 merge)
- Optional: `feat/phase-3-vision` / `feat/finetune-embedder` are now fully in `main`; delete them locally/remotely when you like
- [ ] After a successful push: delete the local `backup/pre-trailer-cleanup/*` branches (`git branch -D ...`) once you're happy

## Notes
- Deviations, calibration results, library quirks → `NOTES.md`. Research/external content → `findings.md`. Session log + error log → `progress.md`.
