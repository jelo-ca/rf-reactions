import pytest

from packmode import allowed, filter_candidates, pick_same_picture, pool_of


def card(pid, pool="booster"):
    return {"printingId": pid, "pool": pool}


# Same picture: booster base + its foil + the Nexus Night promo that reuses the art.
BASE, FOIL, NN = card("OGN-066"), card("OGN-066F"), card("OPP-066", "nexus_night")
PRICES = {"OGN-066": 0.50, "OGN-066F": 2.00, "OPP-066": 4.00}


def test_pool_of():
    assert pool_of("OPP") == "nexus_night"
    assert pool_of("OPP", "Metal") == "booster"   # tagged OPP printings are not Nexus Night
    assert pool_of("OGN") == "booster"


def test_booster_mode_excludes_nexus_night():
    assert not allowed(NN, "booster") and allowed(BASE, "booster")
    assert filter_candidates([BASE, FOIL, NN], "booster") == [BASE, FOIL]


def test_nexus_night_mode_keeps_everything():
    assert filter_candidates([BASE, FOIL, NN], "nexus_night") == [BASE, FOIL, NN]


def test_booster_mode_picks_cheapest_booster_printing():
    assert pick_same_picture([BASE, FOIL, NN], PRICES, "booster") == BASE


def test_nexus_night_mode_prefers_promo_even_if_pricier():
    assert pick_same_picture([BASE, FOIL, NN], PRICES, "nexus_night") == NN


def test_nexus_night_mode_falls_back_when_group_has_no_promo():
    assert pick_same_picture([BASE, FOIL], PRICES, "nexus_night") == BASE


def test_booster_mode_with_only_promo_raises():
    with pytest.raises(ValueError, match="no allowed printing"):
        pick_same_picture([NN], PRICES, "booster")


def test_unknown_mode_rejected():
    with pytest.raises(ValueError, match="unknown pack mode"):
        allowed(BASE, "prerelease")


def test_ties_broken_by_id_for_determinism():
    a, b = card("A-1"), card("A-2")
    assert pick_same_picture([b, a], {"A-1": 1.0, "A-2": 1.0}, "booster") == a
