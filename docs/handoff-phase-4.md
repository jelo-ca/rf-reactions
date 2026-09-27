# Handoff prompt — Phase 4 (Prices + result card)

Paste everything below the line into a new Claude Code session opened in the repo root.

---

You're picking up **Rift Pulls**, a local web app that recognises a Riftbound card held up to a webcam, shows its price, and (in Phase 5) fires a reaction scaled to its value. Phases 0–3 are done and on `main`. Your job is **Phase 4: the price card**.

## Read first (in this order)
1. `task_plan.md` — current state, decisions, Git rules, how to run things
2. `PLAN.md` §3.3 (data contracts), §6.4 + §6.4b (decision rule, pack mode), **§7 (Phase 4 spec)**, §12 (working rules)
3. `progress.md` (bottom: error log + reboot table) and `NOTES.md` (Phase 2–3 sections)
4. `docs/retrospective.md` — skim sections 4–6 for lessons

## What already exists for Phase 4
- `pipeline/prices.py` → `app/public/data/prices.json`: `[{printingId, priceUsd, source, asOf}]` for all 1,797 printings. It already fails loudly on a missing, duplicate or invalid price. `asOf` is the TCGCSV snapshot time (`2026-09-25T20:05:42Z`).
- `app/public/data/cards.json`: `[{printingId, name, setCode, collectorNumber, rarity, variant ("normal"|"foil"|"alt_art"|"promo"), imageHash, imageUrl, pool ("booster"|"nexus_night")}]`. Images are 372×520 JPEGs under `/data/images/`.
- `app/src/ui/ResultChip.tsx` is the **Phase 3 stand-in** you are replacing: name, set + number, variant, price, and a "could be foil: $X" hint when the result reason is `same_image_cheapest` (it finds the foil sibling by same `name` + `imageHash` + `variant === "foil"`).
- `app/src/App.tsx` shows the chip when `phase === "COOLDOWN" && stats.state.outcome === "accepted"`, using `rec.shownId` (set on accept, or by the "which one?" chooser). `rec.last.reason` holds the decision reason. Prices are loaded in App via `loadPrices()` into a `Map<printingId, priceUsd>`.
- Recognition, pack mode, the chooser, capture mode, the ring light and change-based detection all work — **don't change their behaviour** in this phase.

## Phase 4 scope (PLAN §7)
1. `app/src/ui/PriceCard.tsx` replaces `ResultChip`: card image, name, set, **variant badge**, price in USD, **"as of <date>"** (from `asOf`), and the **"could be foil: $X"** hint for `same_image_cheapest`. Show a Nexus Night marker when `pool === "nexus_night"`.
2. It appears at the moment the reaction starts (accept, or the chooser pick) and **stays until the next card is shown** (today the chip disappears when the view changes; the card should persist until a new result replaces it).
3. Acceptance: **every printing in the pool shows a price; a missing price fails the build, not the demo.** `prices.py` covers the pipeline side; add an app-side check (a vitest that loads `cards.json` + `prices.json` and asserts every `printingId` has a finite price ≥ 0), and make the UI degrade gracefully (never crash) if a price is somehow absent.
4. Pull the pure logic out of the component and unit-test it (format price, format as-of date, find the foil sibling, pick badge text). Components stay thin (PLAN §12).
5. Optional, if cheap: show the set's **name** (e.g. "Origins") instead of just the code. The names are in the Riftcodex raw cache (`data/raw/riftcodex/<ts>/sets.json`); `pipeline/ingest.py` would add a `setName` to `cards.json` (update `types.ts` + the ingest test).

Out of scope: reactions/tiers (Phase 5), price refreshes (prices are a frozen snapshot — never fetch), accuracy work (Phase 3 backlog, deferred by the owner).

## Working rules (important)
- **Branch** `feat/phase-4-price-card` off `main`. Small Conventional Commits. Merge to `main` when acceptance passes (the owner has also asked for squash merges before).
- **Never add `Co-Authored-By` or `Claude-Session` trailers** to commits, and no generated-with footer on PRs — the owner had them stripped from history.
- **Pushing:** Claude Code's shell can't reach the owner's SSH key (`Permission denied (publickey)`). Commit locally and ask the owner to push from their own terminal.
- **Update the planning files** (`task_plan.md`, `progress.md`, `findings.md`) as you go, and log deviations/quirks in `NOTES.md` (PLAN §12). Keep `task_plan.md`'s "Current Phase" line true.
- Ask the owner before changing any acceptance bar or scope.

## Environment quirks (Windows 11, i7-1255U, 16 GB, no CUDA)
- Python via the `py` launcher; pipeline venv: `pipeline/.venv/Scripts/python`. Tests: `cd pipeline && .venv/Scripts/python -m pytest tests -q` (79 pass).
- App: `cd app && npx vitest run` (58 pass), `npx tsc -b`, `npx oxlint src`. TypeScript is strict with `erasableSyntaxOnly` (no enums, no constructor parameter properties).
- Dev server: `cd app && node node_modules/vite/bin/vite.js --port 5173` (not `npx vite` — stopping it can leave an orphan node process on the port). It's currently **off**; start it only when needed. COOP/COEP headers are set in `vite.config.ts` (needed for threaded wasm).
- `git config core.autocrlf=true`: the working tree has CRLF. Scripts that patch files must normalise `\r\n`.
- The Windows console is cp1252: keep printed output ASCII (pipeline `config.py` already forces UTF-8 stdout).
- A low-memory guard can kill long background jobs started from Claude Code; heavy jobs (training) run in the owner's own terminal.
- Don't commit `data/`, `app/public/data/*` (except `tiers.json`), `app/public/models/`, `.venv`, `.env`.

## Definition of done
- `PriceCard` live in the app, persistent until the next card, with image, name, set, variant badge, price, as-of date, foil hint and Nexus Night marker.
- New unit tests for the extracted logic + the every-printing-has-a-price test; all existing tests still pass; `tsc` and `oxlint` clean.
- Owner has seen it live (restart the dev server when they're ready) and it's merged to `main`.
- Planning files and `NOTES.md` updated; `task_plan.md` points to Phase 5.
