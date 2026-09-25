# Task Plan: Rift Pulls — Demo Prototype

## Goal
Build local web app that identifies a held-up Riftbound card (exact printing) in <300ms p95, shows its price, and fires a value-scaled reaction — per `PLAN.md` (source of truth).

## Current Phase
Phase 0 (in progress)

## Phases
Full specs + acceptance criteria live in `PLAN.md`. Do not start next phase until acceptance passes.

### Phase 0: Fetch & cache (PLAN.md §4.0)
- [x] H1: ALL sets; CONTACT = anjoelocalderon@gmail.com
- [ ] Scaffold `pipeline/` (requirements, config.py, httpclient.py, sources/base.py)
- [x] Verify Riftcodex + TCGCSV with one test request each (log in findings.md)
- [ ] `sources/riftcodex.py` + `fetch_cards.py` (`--limit 20` first, then full)
- [ ] pHash, look-alike groups, reused-image promos → NOTES.md (H7)
- [ ] `sources/prices_tcgcsv.py` + `fetch_prices.py` (≤20 requests, foil rows)
- [ ] Fixture-based tests, no network
- [ ] H3: human fills `manual_overrides.csv` → 100% price coverage
- [ ] NOTES.md records + commit `phase-0: ...`
- **Status:** pending

### Phase 1: Offline pipeline (§4)
- [ ] config, ingest, model, augment, export_onnx, embed, layout, prices, parity, build_data.sh
- [ ] pytest, ONNX parity ≥0.999, leave-one-out ≥95%, layout sanity ≥95%
- [ ] H: approve `aug_preview.png`
- **Status:** pending

### Phase 2: App shell, camera, guide box, stability (§5)
- [ ] Vite React-TS app, camera + device picker, guide box mapping, signals, state machine, debug panel, vitest
- **Status:** pending

### Phase 3: Vision worker, recognition, eval (§6)
- [ ] Worker + ORT, crop/tensor, search, decide, chooser, capture mode, parity page
- [ ] H4: human eval photos
- [ ] eval.py calibration: top-1 ≥90%, 0 wrong accepts, 0 wrong-printing, ask ≤20%
- **Status:** pending

### Phase 4: Prices + result card (§7)
- **Status:** pending

### Phase 5: Reactions (§8)
- [ ] H5: confirm rarity → tier mapping
- **Status:** pending

### Phase 6: Optional OCR tie-breaker (§9) — only if Phase 3 needs it (H6)
- **Status:** pending

### Phase 7: Metrics, polish, README, demo readiness (§10)
- **Status:** pending

## Key Questions
1. Which sets form demo pool? Contact string for User-Agent? (H1)
2. Riot API key available? (H2 — optional, default no)
3. Repo root is `rf-reaction/` but PLAN.md layout says `rift-pulls/` — treat current dir as repo root.

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Repo root = current dir (`rf-reaction`) | PLAN.md name `rift-pulls/` is illustrative |
| Use `py` launcher for Python on this machine | `python` not on PATH; `py` → 3.13.7 |
| DEMO_SETS = all 8 Riftcodex sets (~1451 printings) | User choice (H1). Deviation: PLAN default OGN. Risks: accuracy (bigger pool), embeddings.bin ≈ 1.45k×9×1280×4B ≈ 67MB > 25MB warn → PCA 1280→256 likely needed in Phase 1 |
| Rename `pipeline/http.py` → `httpclient.py` | `http.py` shadows stdlib `http` → breaks `requests` when run from pipeline/ |
| Pipeline venv at `pipeline/.venv` (py 3.13) | Isolate deps |
| TCGCSV group match: abbreviation first, rc tcgplayer_id fallback | rc id wrong for OPP, null for VEN |
| Foil row only when Normal+Foil both priced; Foil-only card → base row takes Foil price | Many TCGCSV cards Foil-only |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `python` / `python3` not found (catchup script) | 1 | Used `py` launcher — works |

## Notes
- Deviations, calibration results, library quirks → `NOTES.md` (per PLAN.md §12). Research/web content → `findings.md` only.
- Commit at end of each phase: `phase-N: <summary + key numbers>`.
