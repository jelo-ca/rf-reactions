# Task Plan: Rift Pulls — Demo Prototype

## Goal
Build local web app that identifies a held-up Riftbound card (exact printing) in <300ms p95, shows its price, and fires a value-scaled reaction — per `PLAN.md` (source of truth).

## Current Phase
Phase 2 (next — branch `feat/phase-2-app-shell`)

## Phases
Full specs + acceptance criteria live in `PLAN.md`. Do not start next phase until acceptance passes.

### Phase 0: Fetch & cache (PLAN.md §4.0)
- [x] H1: ALL sets; CONTACT = anjoelocalderon@gmail.com
- [x] Scaffold `pipeline/` (requirements, config.py, httpclient.py, sources/base.py)
- [x] Verify Riftcodex + TCGCSV with one test request each (log in findings.md)
- [x] `sources/riftcodex.py` + `fetch_cards.py` (1356 printings, 0-request rerun)
- [x] pHash, look-alike groups (182), reused-image variants (164) → NOTES.md
- [x] `sources/prices_tcgcsv.py` + `fetch_prices.py` (19/20 req, 510 foil rows, 98.5% auto)
- [x] Fixture-based tests, no network (13 pass)
- [x] Pool narrowed (human): booster sets OGN/SFD/UNL/VEN + Nexus Night (untagged OPP); OGS/PR/JDG/Metal out
- [x] H3: not needed — 100% auto price coverage after narrowing (1797/1797)
- [ ] H7 (optional, carry forward): real images for Nexus Night promos (all 104 reuse base art)
- [x] Merge `feat/phase-0-fetch-cache` → main `--no-ff`
- **Status:** complete

### Phase 1: Offline pipeline (§4) — branch `feat/phase-1-offline-pipeline`
- [x] Install torch (CPU), timm, onnx, onnxruntime, albumentations; pin in requirements
- [x] layout.py, ingest.py, prices.py, augment.py, model.py, export_onnx.py (cos 1.000000, opset 18)
- [x] embed.py: 11,583 × 1280 = 59MB (27.6 min)
- [x] parity.py, scripts/build_data.sh
- [x] tests: 58 pass
- [x] sanity: leave-one-out 98.7%; look-alike combined 98.8% (bar changed by human from layout-only per group)
- [x] H: aug_preview approved
- **Status:** complete
- Carry to Phase 3: 19 weak look-alike groups (tune EMBED_WEIGHT/LAYOUT_WEIGHT on real photos); 59MB embeddings (measure before PCA); H7 Nexus Night images

### Pack mode (§6.4b, human request) — branch `feat/pack-mode`
- [x] PLAN.md spec + `pool` in cards.json + pipeline/packmode.py + tests (68 pass)
- [ ] TS port `vision/packMode.ts` + `N` toggle + badge + localStorage (Phase 2/3)
- [ ] eval.py uses packmode (Phase 3)

### Phase 2: App shell, camera, guide box, stability (§5)
- [ ] Vite React-TS app, camera + device picker, guide box mapping, signals, state machine, debug panel, vitest
- [ ] Pack mode toggle (`N`) + badge + localStorage
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
| ~~DEMO_SETS = all 8 sets~~ → booster sets OGN/SFD/UNL/VEN + Nexus Night (untagged OPP), OGS excluded | User: booster packs only, NN only promo exception. 1287 base printings; embeddings ≈ 59MB → PCA 1280→256 likely in Phase 1 |
| Rename `pipeline/http.py` → `httpclient.py` | `http.py` shadows stdlib `http` → breaks `requests` when run from pipeline/ |
| Pipeline venv at `pipeline/.venv` (py 3.13) | Isolate deps |
| TCGCSV group match: abbreviation first, rc tcgplayer_id fallback | rc id wrong for OPP, null for VEN |
| Foil row only when Normal+Foil both priced; Foil-only card → base row takes Foil price | Many TCGCSV cards Foil-only |
| Keep `data/` inside OneDrive (1.1GB images, more in Phase 1) | User choice 2026-09-25 (option 3). Watch for sync file-lock errors on large writes |
| Hardware: i7-1255U, 16GB, Iris Xe, no CUDA → CPU torch | Only inference/export, no training needed yet |
| UI images = 372×520 JPEG q85 in app/public/data/images (not PNG copies) | 1.1GB PNG → ~50MB |
| Embed only non-foil printings | Foil = same image; decide finds foil siblings via cards.json + imageHash |
| layout.bin only for printings in look-alike names | decide only calls layoutScore across different-picture siblings; keeps file small |
| E2E fetch tests with fake HTTP server + temp `config` paths | User asked to close gap: scripts' main() were untested. Caught real bug (OPP not fetched on fresh run) |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `python` / `python3` not found (catchup script) | 1 | Used `py` launcher — works |

## Git Workflow (user request 2026-09-25)
- One branch per phase/feature off `main`: `feat/phase-N-<slug>` (e.g. `feat/phase-0-fetch-cache`), `fix/<slug>` for fixes.
- Small logical commits, Conventional Commits (`feat(pipeline): ...`, `test: ...`, `docs: ...`, `chore: ...`).
- Phase done + acceptance passes → merge to `main` with `--no-ff`, merge message `phase-N: <summary + key numbers>` (PLAN §12).
- Never commit data/, .venv, .env.

## Notes
- Deviations, calibration results, library quirks → `NOTES.md` (per PLAN.md §12). Research/web content → `findings.md` only.
- Commit at end of each phase: `phase-N: <summary + key numbers>`.
