import pytest

from conftest import FIXTURES
from fetch_prices import merge
from sources.base import PriceRecord
from sources.prices_tcgcsv import (
    MatchResult, TcgcsvSource, as_of_iso, match_cards, norm_name, norm_number, resolve_groups,
)

AS_OF = "2026-09-25T20:05:42Z"


def card(pid, name="X", set_code="OGN", num="001", tid="", variant="normal"):
    return {"printing_id": pid, "name": name, "set_code": set_code, "collector_number": num,
            "variant": variant, "tcgplayer_id": tid}


def product(pid, name, number=None, sealed=False):
    ext = [] if sealed else [{"name": "Rarity", "value": "Common"}] + (
        [{"name": "Number", "value": number}] if number else [])
    return {"productId": pid, "name": name, "cleanName": name, "extendedData": ext}


def price(pid, sub, market=None, mid=None, low=None):
    return {"productId": pid, "subTypeName": sub, "marketPrice": market, "midPrice": mid, "lowPrice": low}


def test_helpers():
    assert as_of_iso("2026-09-25T20:05:42+0000") == AS_OF
    assert norm_number("007a/298") == norm_number("007a") == "7a"
    assert norm_number("299*/298") == "299*"
    assert norm_name("Kai'Sa -  Daughter!") == "kai sa daughter"


def test_resolve_groups_prefers_abbreviation():
    groups = [{"groupId": 24528, "abbreviation": "OPP"}, {"groupId": 24343, "abbreviation": "PR"},
              {"groupId": 24698, "abbreviation": "VEN"}]
    # Riftcodex gives OPP the wrong id (PR's) and VEN none.
    out = resolve_groups(["OPP", "VEN", "XYZ"], groups, {"OPP": "24343"})
    assert out == {"OPP": 24528, "VEN": 24698}


def test_cascade_and_foil_rules():
    products = {1: [product(10, "A", "001/298"), product(11, "B", "002/298"),
                    product(12, "C Card"), product(13, "Box", sealed=True),
                    product(14, "D", "004/298")]}
    prices = [
        price(10, "Normal", market=0.25), price(10, "Foil", market=1.5),  # both → foil row
        price(11, "Foil", market=None, mid=3.0),                           # foil-only → base, midPrice
        price(12, "Normal", market=None, mid=None, low=0.1),
        price(14, "Normal"),                                                # no values → unmatched
    ]
    cards = [
        card("OGN-001", tid="10"),                  # tcgplayer_id
        card("OGN-002", num="002"),                 # set_and_number
        card("OGN-003", name="C Card", num="003"),  # name_and_set
        card("OGN-004", num="004"),                 # no_price
        card("OGN-005", num="005", name="Nope"),    # no_product
        card("SFD-001", set_code="SFD"),            # no_group
    ]
    res = match_cards(cards, {"OGN": 1}, products, prices, AS_OF)
    got = {p.printing_id: p for p in res.prices}
    assert got["OGN-001"].price_usd == 0.25 and got["OGN-001"].match_method == "tcgplayer_id"
    assert got["OGN-001F"].price_usd == 1.5 and res.foil_of == {"OGN-001F": "OGN-001"}
    assert got["OGN-002"].price_usd == 3.0 and got["OGN-002"].price_field == "midPrice"
    assert got["OGN-002"].match_method == "set_and_number"
    assert got["OGN-003"].match_method == "name_and_set" and got["OGN-003"].price_field == "lowPrice"
    reasons = {u["printing_id"]: u["reason"].split("(")[0] for u in res.unmatched}
    assert reasons == {"OGN-004": "no_price", "OGN-005": "no_product", "SFD-001": "no_group"}


def test_ambiguous_number_falls_through():
    products = {1: [product(10, "A", "007/298"), product(11, "A Promo", "007/298")]}
    res = match_cards([card("OGN-007", name="Zed", num="007")], {"OGN": 1}, products,
                      [price(10, "Normal", 1.0), price(11, "Normal", 2.0)], AS_OF)
    assert res.prices == [] and res.unmatched[0]["reason"] == "no_product"


def test_merge_overrides_win_and_create_foil():
    base = [card("OGN-001"), card("OGN-002")]
    res = MatchResult(prices=[PriceRecord("OGN-001", 0.25, "marketPrice", "tcgcsv", AS_OF, "tcgplayer_id")])
    overrides = [
        {"printing_id": "OGN-001", "price_usd": "0.5", "price_field": "", "source": "manual", "as_of": AS_OF},
        {"printing_id": "OGN-002F", "price_usd": "9", "price_field": "manual", "source": "manual", "as_of": AS_OF},
        {"printing_id": "NOPE-1", "price_usd": "1", "price_field": "", "source": "manual", "as_of": AS_OF},
    ]
    cards, prices = merge(base, res, overrides)
    by = {p["printing_id"]: p for p in prices}
    assert by["OGN-001"]["price_usd"] == 0.5 and by["OGN-001"]["match_method"] == "manual"
    assert by["OGN-002F"]["price_usd"] == 9.0
    assert [c["printing_id"] for c in cards] == ["OGN-001", "OGN-002", "OGN-002F"]
    assert cards[-1]["variant"] == "foil" and "NOPE-1" not in by


def test_foil_id_clash_fails_loudly():
    res = MatchResult(foil_of={"OGN-001F": "OGN-001"})
    with pytest.raises(SystemExit):
        merge([card("OGN-001"), card("OGN-001F")], res, [])


@pytest.mark.skipif(not (FIXTURES / "tcgcsv" / "manifest.json").exists(), reason="run tests/make_fixtures.py")
def test_fixture_snapshot_matches_real_cards():
    cards = [card("OGN-001", "Blazing Scorcher", tid="652771"), card("OGN-007", "Fury Rune", num="007"),
             card("OGN-007A", "Fury Rune", num="007a"), card("OGN-299S", "Kai'Sa - Daughter of the Void", num="299*")]
    res = TcgcsvSource().match(FIXTURES / "tcgcsv", cards)
    assert {p.printing_id for p in res.prices} >= {"OGN-001", "OGN-007", "OGN-007A", "OGN-299S"}
    assert not res.unmatched
