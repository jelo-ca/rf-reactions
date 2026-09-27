# Mirrors app/src/vision/decide.test.ts — keep the two in sync.
from decide import DecideConfig, decide, index_cards


def card(pid, name, h, variant="normal", pool="booster"):
    return {"printingId": pid, "name": name, "imageHash": h, "variant": variant, "pool": pool}


ALL = [
    card("OGN-001", "Solo", "s1"),
    card("OGN-002", "Other", "o1"),
    card("OGN-066", "Ahri", "a1"),
    card("OGN-066F", "Ahri", "a1", "foil"),
    card("OPP-066", "Ahri", "a1", "promo", "nexus_night"),
    card("OGN-117", "Viktor", "v1"),
    card("OGN-117A", "Viktor", "v2", "alt_art"),
]
BY_ID, BY_NAME = index_cards(ALL)
PRICES = {"OGN-001": 1, "OGN-002": 1, "OGN-066": 0.5, "OGN-066F": 2, "OPP-066": 300, "OGN-117": 0.3, "OGN-117A": 40}


def run(scores, layout=None, mode="booster"):
    layout = layout or {}
    return decide(scores, BY_ID, BY_NAME, PRICES, mode, lambda i: layout.get(i), DecideConfig())


def test_low_score():
    assert run({"OGN-001": 0.6, "OGN-002": 0.2}).reason == "low_score"


def test_low_margin():
    r = run({"OGN-001": 0.9, "OGN-002": 0.88})
    assert (r.status, r.reason) == ("rejected", "low_margin")


def test_same_name_ignored_for_margin():
    assert run({"OGN-117": 0.9, "OGN-117A": 0.89, "OGN-002": 0.5}, {"OGN-117": 0.9, "OGN-117A": 0.5}).status == "accepted"


def test_single_printing_ok():
    r = run({"OGN-001": 0.9, "OGN-002": 0.5})
    assert (r.status, r.reason, r.best) == ("accepted", "ok", "OGN-001")
    assert [p for p, _ in r.top] == ["OGN-001", "OGN-002"]


def test_nothing_allowed():
    assert (run({}).status, run({}).reason) == ("rejected", "low_score")


def test_same_picture_cheapest_booster():
    r = run({"OGN-066": 0.9, "OPP-066": 0.9, "OGN-002": 0.4})
    assert (r.status, r.reason, r.best) == ("accepted", "same_image_cheapest", "OGN-066")
    assert "OPP-066" not in [p for p, _ in r.top]


def test_nexus_night_mode_prefers_promo():
    assert run({"OGN-066": 0.9, "OPP-066": 0.9, "OGN-002": 0.4}, mode="nexus_night").best == "OPP-066"


def test_layout_resolves():
    r = run({"OGN-117": 0.85, "OGN-117A": 0.84, "OGN-002": 0.3}, {"OGN-117": 0.4, "OGN-117A": 0.9})
    assert (r.status, r.reason, r.best) == ("accepted", "layout_resolved", "OGN-117A")


def test_ask_when_close():
    r = run({"OGN-117": 0.85, "OGN-117A": 0.85, "OGN-002": 0.3}, {"OGN-117": 0.7, "OGN-117A": 0.71})
    assert (r.status, r.reason) == ("ask", "layout_ambiguous")
    assert sorted(r.ask_options) == ["OGN-117", "OGN-117A"]


def test_never_cheapest_across_pictures():
    assert run({"OGN-117": 0.8, "OGN-117A": 0.82, "OGN-002": 0.3}, {"OGN-117": 0.2, "OGN-117A": 0.95}).best == "OGN-117A"
