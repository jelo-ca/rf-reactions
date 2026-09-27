"""File capture-mode downloads into data/eval/<printing_id>/ (PLAN.md §6.6).

Usage: python sort_eval.py [--src ~/Downloads] [--dry-run]
Moves every `<printing_id>__<timestamp>.png` whose printing exists in cards.csv;
anything else is left where it is and reported.
"""
from __future__ import annotations

import argparse
import re
import shutil
from collections import Counter
from pathlib import Path

import config
from cardsio import read_csv

NAME_RE = re.compile(r"^(?P<pid>[A-Z0-9]+-[A-Z0-9]+)__(?P<ts>\d{8}T\d{6}Z)(?: \(\d+\))?\.png$")


def plan_moves(files: list[Path], known: set[str]) -> tuple[list[tuple[Path, Path]], list[tuple[Path, str]]]:
    moves, skipped = [], []
    for f in files:
        m = NAME_RE.match(f.name)
        if not m:
            continue  # not a capture file
        pid = m["pid"]
        if pid not in known:
            skipped.append((f, f"unknown printing {pid}"))
            continue
        dest = config.EVAL_DIR / pid / f"{pid}__{m['ts']}.png"
        if dest.exists():
            skipped.append((f, "already filed"))
            continue
        moves.append((f, dest))
    return moves, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path.home() / "Downloads")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    known = {c["printing_id"] for c in read_csv(config.CARDS_CSV)}
    moves, skipped = plan_moves(sorted(args.src.glob("*.png")), known)
    for src, dest in moves:
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), dest)
    for f, why in skipped:
        print(f"  skipped {f.name}: {why}")

    per = Counter(p.parent.name for p in config.EVAL_DIR.glob("*/*.png"))
    print(f"{'Would move' if args.dry_run else 'Moved'} {len(moves)} photos from {args.src}")
    print(f"Eval set: {sum(per.values())} photos, {len(per)} printings "
          f"({sum(1 for n in per.values() if n >= 3)} with >= 3 photos). Target: >= 60 photos, >= 20 printings x 3.")


if __name__ == "__main__":
    main()
