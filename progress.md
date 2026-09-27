# Progress Log

## Session: 2026-09-25

### Setup
- **Status:** complete
- Actions taken:
  - Read PLAN.md (full build plan, 8 phases)
  - Ran session catchup — no prior context
  - Checked toolchain (py 3.13.7, node 22.18, npm 11.13, git 2.37)
  - Created task_plan.md, findings.md, progress.md
- Files created/modified:
  - task_plan.md, findings.md, progress.md

### Caveman statusline
- Added `statusLine` to `~/.claude/settings.json` → caveman-statusline.ps1 (takes effect next session/refresh)

### Phase 0: Fetch & cache
- **Status:** in_progress
- H1 answered: ALL sets, contact anjoelocalderon@gmail.com
- Verified Riftcodex + TCGCSV endpoints (findings.md)
- Created: .gitignore, pipeline/{requirements.txt,.env.example,config.py,httpclient.py,rawcache.py,cardsio.py,imagehashing.py,fetch_cards.py}, pipeline/sources/{__init__,base,riftcodex}.py
- venv pipeline/.venv (py3.13) with Phase 0 deps
- Raw fetch: 20 requests → data/raw/riftcodex/20260925T203217Z (1451 cards)
- fetch_cards --limit 20: OK (20 images, csv valid)
- Full fetch_cards running in background (~1.5 img/s)
- Written: sources/prices_tcgcsv.py, fetch_prices.py (merge() pure), tests/{conftest,make_fixtures,test_riftcodex,test_prices,test_imagehashing}.py
- pytest: 12 passed, 1 skipped (tcgcsv fixture pending real snapshot)
- Full fetch_cards: 1356 printings, 1336 images; VEN 263 (131 stale dup pairs in source) — verified correct
- Reused-image check: 164 variants with pHash dist 0 to base → source reuses base image (H7)
- User asked for feature branches: created `feat/phase-0-fetch-cache`, 6 logical commits; workflow in task_plan.md + memory
- fetch_prices: 19 requests, 98.5% auto, 28 OPP promos no_price → H3
- Rerun fetch_cards: 0 network requests; integrity OK; tcgcsv fixture generated; pytest 13 passed
- User: booster packs only + Nexus Night. Asked how to ID NN (no label in data) → "all plain OPP promos"; OGS excluded
- Pool rebuilt offline: 1797 printings, prices 100% auto, 0 unmatched; pytest 14 passed
- Phase 0 COMPLETE → merged to main
- User: keep data in OneDrive; add fetch E2E tests before Phase 1
- Branch `test/fetch-e2e`: tests/test_fetch_e2e.py (13 tests: HTTP retry/403/cache/UA, fetch_raw paging/resume/budget, fetch_cards + fetch_prices main() end to end in tmp sandbox)
- Found + fixed bug: fetch_raw skipped OPP (Nexus Night) on a fresh fetch once DEMO_SETS narrowed
- pytest: 27 passed

### Phase 1: Offline pipeline
- **Status:** in_progress (branch feat/phase-1-offline-pipeline)
- CPU torch etc installed + pinned; written layout, ingest, prices, model, augment, export_onnx, embed, parity, sanity, build_data.sh; tests 57 pass
- Fixed: layout float noise amplification; empty-tile scoring bug; cp1252 crash from torch.onnx emoji
- ONNX parity cos 1.000000; opset 18; embed 11583x1280 = 59MB (27.6 min)
- Leave-one-out 98.7% PASS
- Layout sanity 88.4%, 57/180 groups FAIL → diagnosing (findings.md)
- diag_layout.py attempt 1 crashed at json.dump (numpy int64) after full run; fixed, re-running
- Diag: layout 89.0% (57/180), embed 98.1% (159), combined 98.7% (161)
- User: Phase 1 bar = combined >= 95% overall; aug_preview APPROVED
- sanity.py rewritten to official combined check; config name clash (LAYOUT_W weight vs width) broke 7 tests → renamed EMBED_WEIGHT/LAYOUT_WEIGHT; 58 tests pass
- Final sanity: LOO 98.7%, combined 98.8% (161/180 groups), 19 weak groups → Phase 3
- Phase 1 COMPLETE → merged to main

## Session: 2026-09-26
- Pack mode data+logic merged (PLAN §6.4b); Phase 2 app shell built, browser-checked, human-confirmed, merged
- Phase 3 branch: capture mode + sort_eval.py done; browser-checked picker (no Space pressed — would download)
- Note: git autocrlf=true → worktree CRLF; normalize \r\n in node/python patch scripts
- search.ts/layout.ts/decide.ts + tests (54 app tests); layout TS matches Python fixtures
- Search in node: 17–39 ms/query (noisy, memory-bound) → measure in browser
- Worker + parity page: **PARITY PASS** webgpu, embed/layout cos 1.000000 ×5, load ~0.8s, warm-up ~85ms, 24–92 ms/image

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-09-25 | `python`/`python3` not found | 1 | Use `py` launcher |
| 2026-09-25 | `ValueError: unexpected riftbound_id: 'sfd-t03'` | 1 | Accept 2-part ids (tokens/runes) |
| 2026-09-25 | VEN runes duplicated in source (stale records) | 1 | `dedupe()` keeps record w/ tcgplayer_id |
| 2026-09-25 | `UnicodeEncodeError` cp1252 printing `→`/🧑 | 1 | sed missed emoji |
| 2026-09-25 | same | 2 | Edit tool → ASCII-only prints |
| 2026-09-25 | E2E test: fresh fetch missed OPP → Nexus Night pool empty | 1 | fetch_raw adds NEXUS_NIGHT_SET |
| 2026-09-25 | torch.onnx emoji → cp1252 UnicodeEncodeError | 1 | config.py reconfigures stdout UTF-8 |
| 2026-09-25 | diag json.dump numpy int64 | 1 | int() cast |
| 2026-09-25 | `EMBED_W, LAYOUT_W = 0.5, 0.5` overwrote LAYOUT_W (map width) | 1 | renamed to *_WEIGHT |
| 2026-09-26 | node patch script "missing" match | 1 | worktree CRLF (autocrlf) → normalize \r\n |
| 2026-09-26 | vite restart failed: port 5173 in use | 1 | TaskStop killed npx wrapper only; stopped node PID by port; run `node node_modules/vite/bin/vite.js` directly |
| 2026-09-26 | parity page: `RuntimeError: memory access out of bounds` | 1 | StrictMode double init → concurrent InferenceSession.create; init() memoized |
| 2026-09-26 | parity page hung on signatures() | 1 | copy ORT output (SAB view not transferable) — not enough |
| 2026-09-26 | same | 2 | serialize session.run (overlapping runs hang on WebGPU) — fixed |
| 2026-09-26 | parity rows doubled, no verdict | 1 | cancelled flag for StrictMode's discarded effect |
| 2026-09-26 | fine-tune #2 + dev server killed by low-memory guard at step 275 | 1 | kept step-250 best.pt; if resuming: 2 workers, close Chrome tabs |
| 2026-09-26 | resumed fine-tune + dev server killed again at step 325 (2 workers) | 2 | guard reaps idle-session background shells; next: run in user's own terminal |
| 2026-09-26 | Python heredoc turned `outinetune` into form-feed (``) in task_plan | 1 | raw string fix; check backslashes in generated Windows paths |
| 2026-09-26 | trailer count 81 after rewrite (false alarm) | 1 | `--exclude` must precede `--branches`; recount per branch = 0 |
| 2026-09-26 | `git push` → Permission denied (publickey) | 1 | SSH key for `github.com-personal` not in this shell; human pushes from own terminal |

- Browser fixture run found JS search 82/91 ms (p50/p95) → baked search into recognizer.onnx → 0.5/1.4 ms; recognize call p95 49 ms
- "OGN-007 → VEN-R01" investigated: identical-art reprint in same picture group, correct per rule (documented)
- Live recognition wired into App (chooser, result chip, debug timings); 58 app tests
- Human: OGN-058 Discipline ranks 3–5 live; asked for ring light → added (L)
- Diagnosis: pretrained embeds frame > art; real eval photos (18) top-1 0%, median rank 16 → big domain gap (framing, backlight/cast/haze, hand)
- Fine-tune #1 (weak augments) stopped; augment v2 + per-image standardization + real-photo validation; fine-tune #2 running (out/finetune_run.log)
- decide.py (Python mirror, 10 tests) + eval.py (report + calibrate); pipeline tests 79
- Fine-tune #2: step 0 real top-1 0% (median rank 101, standardization w/o training), synth 39%; **step 250: real top-1 61% (median rank 1), synth 97.5%, margin +0.33**; loss 0.004 (batches getting easy)
- Low-memory guard killed training at step 275 + dev server (free RAM 6.8/15.7 GB after). best.pt = step 250 kept.
- Human chose: use step-250 checkpoint now → rebuild (export, embed, export_search, parity) running → out/rebuild.log; then restart dev server for live test
- Rebuild done (fine-tuned): eval 18 photos top-1 61.1%, top-5 83.3%, median rank 1; provisional ACCEPT_T 0.44 / MARGIN_T 0.04 (8/18 accepted, 0 wrong); dev server restarted
- Resumed fine-tune killed by low-memory guard at step 325 (+ dev server again); step-250 check real 55.6% (not saved), synth 97.7%, margin 0.38. Learning doc written (Claude Doc)
- Human ran resumed fine-tune in own terminal: real top-1 61.1% → 55.6% (250) → **77.8% (500, 750, 1000)**, margin 0.33 → 0.41; rebuild #2 running
- Rebuild #2: all 9 rows/card → 66.7%; clean-only → 77.8% (augmented refs = false neighbours after fine-tune); REFERENCE_AUG_ROWS=0; recognizer 23.7 MB; thresholds 0.42/0.03 (7/18 accepted, 0 wrong)

## Session: 2026-09-26 (evening)
- Resumed fine-tune run by the human in their own terminal → 77.8% real top-1 (step 500–1000)
- Rebuild #2 + clean-reference finding (77.8% vs 66.7%); recognizer 23.7 MB; thresholds 0.42 / 0.03
- Opset set to 18 (silences a harmless down-conversion traceback)
- Ring light: on/off toggle, whole page white, then made thinner (human)
- Human: "it works" but B needed per card → cause: stale background snapshot behind a user-facing webcam → change-based detection (human choice); 58 app tests
- Learning doc kept current (timeline rows, headline 78%)
- Dev server stopped (human request); planning files refreshed
- Human: remove Co-Authored-By lines → found 14 of them already on GitHub (origin/main = Phase 0 merge); human chose rewrite all + force-push main
- Backups `backup/pre-trailer-cleanup/*` → filter-branch on 8 branches (68 commits): 0 trailers left, every branch tree identical to its backup
- Push failed: `Permission denied (publickey)` (SSH alias key not available to Claude Code's shell) → nothing changed on GitHub; human to push from own terminal
- Memory saved: never add commit trailers
- Human pushed `feat/finetune-embedder` from own terminal (origin = b23742f). `main` (force-push) and `feat/phase-3-vision` still pending
- /planning-with-files:plan → files already existed; refreshed push status
- Squash-merged `feat/finetune-embedder` (30 commits, incl. phase-3-vision) into `main` as `234037d` (owner's request, before acceptance); tree identical; 79 + 58 tests pass on main
- origin/main reflog: human force-pushed cleaned main (30f5a6e) and pushed the squash (234037d) from own terminal

## 5-Question Reboot Check (updated 2026-09-26, evening)
| Question | Answer |
|----------|--------|
| Where am I? | Phase 3 working system squash-merged to `main` (`234037d`); `main` pushed by the human; next work on a new branch off main. Dev server off |
| Where am I going? | New branch off main → live check of auto-detect → fresh eval set → calibrate → Phase 3 acceptance → merge → Phases 4–7 |
| What's the goal? | Identify held-up card printing in < 300 ms p95 with ≥ 90% top-1 and 0 wrong accepts; show price; react |
| What have I learned? | Test on real inputs early; fine-tuning + realistic augmentation fixed a 0% start; after fine-tuning, clean refs beat augmented refs; triggers must not depend on a static background with a user-facing webcam |
| What have I done? | Phases 0–2 + pack mode merged; Phase 3 app complete; 77.8% real top-1 (in-sample); auto-detect without B |
