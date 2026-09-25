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

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-09-25 | `python`/`python3` not found | 1 | Use `py` launcher |
| 2026-09-25 | `ValueError: unexpected riftbound_id: 'sfd-t03'` | 1 | Accept 2-part ids (tokens/runes) |
| 2026-09-25 | VEN runes duplicated in source (stale records) | 1 | `dedupe()` keeps record w/ tcgplayer_id |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 0, not started |
| Where am I going? | Phases 0–7 per PLAN.md |
| What's the goal? | Card-recognition reaction demo, <300ms, ≥90% acc |
| What have I learned? | See findings.md |
| What have I done? | Planning files created |
