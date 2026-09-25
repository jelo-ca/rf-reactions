"""Timestamped raw-response dirs: data/raw/<source>/<ts>/, with a _complete marker."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import config

COMPLETE_MARKER = "_complete"


def newest_dir(source: str, complete_only: bool = True) -> Path | None:
    root = config.RAW_DIR / source
    if not root.exists():
        return None
    dirs = sorted(d for d in root.iterdir() if d.is_dir())
    if complete_only:
        dirs = [d for d in dirs if (d / COMPLETE_MARKER).exists()]
    return dirs[-1] if dirs else None


def new_dir(source: str) -> Path:
    """Resume the newest incomplete dir if there is one, else start a fresh one."""
    newest = newest_dir(source, complete_only=False)
    if newest is not None and not (newest / COMPLETE_MARKER).exists():
        return newest
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    d = config.RAW_DIR / source / ts
    d.mkdir(parents=True, exist_ok=True)
    return d


def mark_complete(d: Path) -> None:
    (d / COMPLETE_MARKER).write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
