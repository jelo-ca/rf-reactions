import pytest
from PIL import Image

from ingest import ValidationError, to_card_json, validate
from prices import PriceError, build


def card(pid, variant="normal", image="x.png", h="abcd"):
    return {"printing_id": pid, "name": "N", "set_code": "OGN", "collector_number": "001", "rarity": "Common",
            "variant": variant, "image_file": image, "image_hash": h}


def price(pid, usd="1.0"):
    return {"printing_id": pid, "price_usd": usd, "source": "tcgcsv", "as_of": "2026-09-25T20:05:42Z"}


@pytest.fixture
def images(tmp_path):
    Image.new("RGB", (10, 14)).save(tmp_path / "x.png")
    return tmp_path


def test_validate_ok(images):
    validate([card("OGN-001"), card("OGN-001F", "foil")], images)


@pytest.mark.parametrize("cards, msg", [
    ([card("A"), card("A")], "duplicate"),
    ([card("A", "shiny")], "bad variant"),
    ([card("AF", "foil")], "without base"),
    ([card("A", image="missing.png")], "image missing"),
    ([card("A", h="")], "missing image_hash"),
])
def test_validate_fails_loudly(images, cards, msg):
    with pytest.raises(ValidationError, match=msg):
        validate(cards, images)


def test_card_json_contract():
    j = to_card_json(card("OGN-001", image="OGN-001.png"))
    assert j == {"printingId": "OGN-001", "name": "N", "setCode": "OGN", "collectorNumber": "001",
                 "rarity": "Common", "variant": "normal", "imageHash": "abcd",
                 "imageUrl": "/data/images/OGN-001.jpg"}


def test_prices_build_ok():
    out = build([card("A"), card("AF", "foil")], [price("A", "0.25"), price("AF", "3")])
    assert out[0] == {"printingId": "A", "priceUsd": 0.25, "source": "tcgcsv", "asOf": "2026-09-25T20:05:42Z"}


@pytest.mark.parametrize("prices, msg", [
    ([], "no price"),
    ([price("A"), price("A")], "2 price rows"),
    ([price("A"), price("Z")], "unknown printing"),
    ([price("A", "-1")], "bad price"),
    ([price("A", "abc")], "bad price"),
])
def test_prices_fail_loudly(prices, msg):
    with pytest.raises(PriceError, match=msg):
        build([card("A")], prices)
