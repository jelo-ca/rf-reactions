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

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 0, not started |
| Where am I going? | Phases 0–7 per PLAN.md |
| What's the goal? | Card-recognition reaction demo, <300ms, ≥90% acc |
| What have I learned? | See findings.md |
| What have I done? | Planning files created |
