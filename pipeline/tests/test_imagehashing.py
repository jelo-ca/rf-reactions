from imagehashing import canonicalize, report


def row(pid, name, h, variant="normal"):
    return {"printing_id": pid, "name": name, "image_hash": h, "variant": variant}


def test_canonicalize_snaps_near_identical_within_name():
    rows = [row("A-1", "A", "ffffffffffffffff"),
            row("A-1M", "A", "fffffffffffffffe", "promo"),   # 1 bit off → same picture
            row("A-2", "A", "0000000000000000", "alt_art"),  # different picture
            row("B-1", "B", "fffffffffffffffe")]             # other name untouched
    canonicalize(rows)
    assert rows[1]["image_hash"] == "ffffffffffffffff"
    assert rows[2]["image_hash"] == "0000000000000000"
    assert rows[3]["image_hash"] == "fffffffffffffffe"


def test_report_lookalikes_and_reused():
    rows = [row("A-1", "A", "aa"), row("A-2", "A", "bb", "alt_art"),
            row("B-1", "B", "cc"), row("B-P", "B", "cc", "promo")]
    rep = report(rows)
    assert rep["lookalike_groups"] == {"A": [["A-1"], ["A-2"]]}
    assert rep["reused_image_variants"] == [{"printing_id": "B-P", "same_picture_as": ["B-1"]}]
