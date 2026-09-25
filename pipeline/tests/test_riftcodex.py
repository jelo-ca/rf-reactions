from conftest import FIXTURES
from sources.riftcodex import (
    RiftcodexSource, base_name, number_segment, safe_segment, unique_id, variant_tag,
)


def parsed():
    return {r.printing_id: r for r in RiftcodexSource().parse(FIXTURES / "riftcodex")}


def test_helpers():
    assert base_name("Teemo - Swift Scout (Alternate Art)") == "Teemo - Swift Scout"
    assert base_name("Get Excited!") == "Get Excited!"
    assert variant_tag("Annie - Dark Child (Metal)") == "Metal"
    assert variant_tag("Annie - Dark Child") is None
    assert number_segment("ogn-007a-298") == "007a"
    assert number_segment("sfd-t03") == "t03"
    assert safe_segment("299*") == "299S"
    assert unique_id("OPP-017", "Metal", {"OPP-017"}) == "OPP-017M"
    assert unique_id("OPP-017", "Metal", {"OPP-017", "OPP-017M"}) == "OPP-017M2"


def test_parse_ids_and_variants():
    r = parsed()
    assert set(r) == {"OGN-001", "OGN-007", "OGN-007A", "OGN-299S", "OGN-275",
                      "OPP-017", "OPP-017M", "SFD-T03", "VEN-R01"}
    assert r["OGN-001"].variant == "normal"
    assert r["OGN-007A"].variant == "alt_art" and r["OGN-007A"].name == "Fury Rune"
    assert r["OGN-299S"].variant == "alt_art" and r["OGN-299S"].collector_number == "299*"
    assert r["OPP-017"].variant == "promo" and r["OPP-017M"].name == "Annie - Dark Child"
    assert r["OGN-275"].orientation == "landscape"


def test_metal_duplicate_keeps_untagged_as_base():
    r = parsed()
    assert r["OPP-017"].tcgplayer_id == "680247"   # plain promo
    assert r["OPP-017M"].tcgplayer_id == "669265"  # (Metal)


def test_stale_duplicate_dropped():
    r = parsed()
    assert r["VEN-R01"].tcgplayer_id == "706028"
    assert sum(1 for pid in r if pid.startswith("VEN-R01")) == 1
