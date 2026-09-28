"""Real labelled frames for the card detector (PLAN.md §5.7).

Each frame is `frame__<printing_id|none>__<ts>.png` + `.json` written by the app's capture tool (F):
{"corners": [[x, y] x 4] | null, "width", "height", "printingId", "capturedAt"}; corners are raw
(unmirrored) frame pixels, TL, TR, BR, BL in the card's own orientation.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

FRAME_RE = re.compile(r"^frame__(?P<pid>[A-Za-z0-9-]+)__(?P<ts>\d{8}T\d{6}Z)(?: \(\d+\))?\.(?P<ext>png|json)$")


@dataclass(frozen=True)
class RealFrame:
    png: Path
    corners: list[tuple[float, float]] | None  # None = no card in the frame
    width: int
    height: int
    printing_id: str | None


def label_problem(label: dict) -> str | None:
    """Why a sidecar label is unusable, or None."""
    w, h = label.get("width"), label.get("height")
    if not (isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0):
        return "bad width/height"
    corners = label.get("corners", "missing")
    if corners is None:
        return None
    if not (isinstance(corners, list) and len(corners) == 4 and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        return "corners must be null or 4 [x, y] points"
    if any(not (0 <= x <= w and 0 <= y <= h) for x, y in corners):
        return "corner outside the frame"
    area2 = sum(corners[i][0] * corners[(i + 1) % 4][1] - corners[(i + 1) % 4][0] * corners[i][1] for i in range(4))
    if area2 <= 0:
        return "corners not clockwise (TL, TR, BR, BL)"
    return None


def load_frame(png: Path) -> RealFrame:
    label = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
    problem = label_problem(label)
    if problem:
        raise ValueError(f"{png.name}: {problem}")
    corners = label["corners"]
    return RealFrame(png, [tuple(p) for p in corners] if corners else None, label["width"], label["height"],
                     label.get("printingId"))


def load_real(folder: Path) -> list[RealFrame]:
    """Every labelled frame in `folder`, oldest first; fails loudly on a bad label.

    Sorted by capture time, not path: Windows path order is case-insensitive ("none" < "OGN").
    """
    pngs = [p for p in folder.glob("frame__*.png") if FRAME_RE.match(p.name)]
    return [load_frame(p) for p in sorted(pngs, key=lambda p: (FRAME_RE.match(p.name)["ts"], p.name))]
