"""File detector-frame downloads (F in capture mode) into data/detect/real/  (PLAN.md §5.7).

Usage: python sort_detect.py [--src ~/Downloads] [--dry-run]
Moves every `frame__<printing|none>__<ts>.png` that has a valid `.json` label next to it.
Unpaired or badly labelled files are left where they are and reported.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import config
from detect_data import FRAME_RE, label_problem, load_real


def plan_moves(files: list[Path]) -> tuple[list[tuple[Path, Path]], list[tuple[Path, str]]]:
    by_stem: dict[str, dict[str, Path]] = {}
    for f in files:
        m = FRAME_RE.match(f.name)
        if m:
            by_stem.setdefault(f"frame__{m['pid']}__{m['ts']}", {})[m["ext"]] = f
    moves, skipped = [], []
    for stem, pair in sorted(by_stem.items()):
        if set(pair) != {"png", "json"}:
            only = next(iter(pair.values()))
            skipped.append((only, f"no matching .{'json' if 'png' in pair else 'png'}"))
            continue
        try:
            problem = label_problem(json.loads(pair["json"].read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            problem = f"unreadable label ({e})"
        if problem:
            skipped.append((pair["json"], problem))
            continue
        for ext in ("png", "json"):
            dest = config.DETECT_REAL_DIR / f"{stem}.{ext}"
            if dest.exists():
                skipped.append((pair[ext], "already filed"))
            else:
                moves.append((pair[ext], dest))
    return moves, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path.home() / "Downloads")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    moves, skipped = plan_moves(sorted(args.src.glob("frame__*")))
    for src, dest in moves:
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), dest)
    for f, why in skipped:
        print(f"  skipped {f.name}: {why}")

    frames = load_real(config.DETECT_REAL_DIR) if config.DETECT_REAL_DIR.exists() else []
    cards = sum(1 for f in frames if f.corners)
    print(f"{'Would move' if args.dry_run else 'Moved'} {len(moves)} files from {args.src}")
    print(f"Detector frames: {cards} with a card, {len(frames) - cards} empty. Target: >= 60 card, >= 40 empty.")


if __name__ == "__main__":
    main()
