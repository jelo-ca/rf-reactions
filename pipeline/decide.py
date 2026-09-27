"""Decision rule (PLAN.md §6.4 + §6.4b). Python mirror of app/src/vision/decide.ts for eval.py.

Keep the two in sync: tests/test_decide.py mirrors app/src/vision/decide.test.ts case for case.
Cards are cards.json dicts (camelCase).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

from packmode import allowed, pick_same_picture


@dataclass(frozen=True)
class DecideConfig:
    ACCEPT_T: float = 0.75
    MARGIN_T: float = 0.05
    EMBED_WEIGHT: float = 0.5
    LAYOUT_WEIGHT: float = 0.5
    LAYOUT_MARGIN_T: float = 0.03


@dataclass
class Decision:
    status: str                      # accepted | rejected | ask
    reason: str
    best: str | None = None          # printing id
    ask_options: list[str] = field(default_factory=list)
    top: list[tuple[str, float]] = field(default_factory=list)


def index_cards(cards: list[dict]) -> tuple[dict[str, dict], dict[str, list[dict]]]:
    by_id = {c["printingId"]: c for c in cards}
    by_name: dict[str, list[dict]] = defaultdict(list)
    for c in cards:
        by_name[c["name"]].append(c)
    return by_id, by_name


def decide(scores: dict[str, float], by_id: dict[str, dict], by_name: dict[str, list[dict]],
           prices: dict[str, float], pack_mode: str, layout_score_for: Callable[[str], float | None],
           cfg: DecideConfig = DecideConfig(), top_n: int = 5) -> Decision:
    ranked = sorted(((pid, s) for pid, s in scores.items() if pid in by_id and allowed(by_id[pid], pack_mode)),
                    key=lambda x: (-x[1], x[0]))
    top = ranked[:top_n]
    if not ranked:
        return Decision("rejected", "low_score", top=top)

    # Step A: which card
    best_id, best_score = ranked[0]
    best_name = by_id[best_id]["name"]
    runner = next((s for pid, s in ranked if by_id[pid]["name"] != best_name), None)
    if best_score < cfg.ACCEPT_T:
        return Decision("rejected", "low_score", best_id, top=top)
    if runner is not None and best_score - runner < cfg.MARGIN_T:
        return Decision("rejected", "low_margin", best_id, top=top)

    # Step B: which printing
    siblings = [c for c in by_name[best_name] if allowed(c, pack_mode)]
    if len(siblings) <= 1:
        return Decision("accepted", "ok", best_id, top=top)
    groups: dict[str, list[dict]] = defaultdict(list)
    for c in siblings:
        groups[c["imageHash"]].append(c)
    if len(groups) == 1:
        return Decision("accepted", "same_image_cheapest", pick_same_picture(siblings, prices, pack_mode)["printingId"], top=top)

    scored = []
    for group in groups.values():
        embed = max(scores.get(c["printingId"], float("-inf")) for c in group)
        ref = next((c for c in group if layout_score_for(c["printingId"]) is not None), None)
        layout = layout_score_for(ref["printingId"]) if ref else 0.0
        scored.append((cfg.EMBED_WEIGHT * embed + cfg.LAYOUT_WEIGHT * layout, group))
    scored.sort(key=lambda x: -x[0])
    (c1, g1), (c2, g2) = scored[0], scored[1]
    pick = lambda g: pick_same_picture(g, prices, pack_mode)["printingId"]  # noqa: E731
    if c1 - c2 >= cfg.LAYOUT_MARGIN_T:
        return Decision("accepted", "layout_resolved", pick(g1), top=top)
    return Decision("ask", "layout_ambiguous", best_id, ask_options=[pick(g1), pick(g2)], top=top)
