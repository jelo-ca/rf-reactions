#!/usr/bin/env bash
# Build everything the app needs from the cached Phase 0 output (PLAN.md §4.9).
# Never fetches: run pipeline/fetch_cards.py and fetch_prices.py first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/pipeline"

if [[ -x .venv/Scripts/python ]]; then PY=.venv/Scripts/python      # Windows venv
elif [[ -x .venv/bin/python ]]; then PY=.venv/bin/python             # POSIX venv
else echo "No pipeline/.venv found. Create it and pip install -r requirements.txt" >&2; exit 1; fi

for f in ../data/cards/cards.csv ../data/prices/prices.csv; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f - run the Phase 0 fetch scripts first:" >&2
    echo "  $PY fetch_cards.py && $PY fetch_prices.py" >&2
    exit 1
  fi
done

export PYTHONUTF8=1
step() { echo; echo "=== $1"; shift; "$PY" "$@"; }
step "ingest"  ingest.py
step "export"  export_onnx.py
step "embed"   embed.py
step "layout"  layout.py
step "search"  export_search.py
step "prices"  prices.py
step "parity"  parity.py
echo; echo "Done. App data in app/public/{data,models,fixtures}."
