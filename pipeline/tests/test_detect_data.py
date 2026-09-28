import json

import pytest

import config
from detect_data import label_problem, load_real
from sort_detect import plan_moves

CARD = [[100, 100], [300, 110], [290, 400], [95, 390]]


def label(corners=CARD, w=1280, h=720, pid="OGN-151"):
    return {"corners": corners, "width": w, "height": h, "printingId": pid, "capturedAt": "2026-09-27T10:00:00Z"}


def write(folder, stem, lab, png=True):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{stem}.json").write_text(json.dumps(lab), encoding="utf-8")
    if png:
        (folder / f"{stem}.png").write_bytes(b"png")


def test_label_ok():
    assert label_problem(label()) is None
    assert label_problem(label(corners=None, pid=None)) is None


@pytest.mark.parametrize("lab, msg", [
    (label(w=0), "width"),
    (label(corners=CARD[:3]), "4"),
    (label(corners=[[100, 100], [300, 110], [290, 900], [95, 390]]), "outside"),
    (label(corners=CARD[::-1]), "clockwise"),
    ({"width": 10, "height": 10}, "corners"),
])
def test_label_problems(lab, msg):
    assert msg in label_problem(lab)


def test_plan_moves_pairs_and_validates(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DETECT_REAL_DIR", tmp_path / "real")
    dl = tmp_path / "dl"
    write(dl, "frame__OGN-151__20260927T100000Z", label())
    write(dl, "frame__none__20260927T100001Z", label(corners=None, pid=None))
    write(dl, "frame__none__20260927T100002Z", label(), png=False)  # json without png
    write(dl, "frame__OGN-151__20260927T100003Z", label(corners=CARD[::-1]))  # bad label
    (dl / "holiday.png").write_bytes(b"x")
    moves, skipped = plan_moves(sorted(dl.iterdir()))
    assert sorted(d.name for _, d in moves) == [
        "frame__OGN-151__20260927T100000Z.json", "frame__OGN-151__20260927T100000Z.png",
        "frame__none__20260927T100001Z.json", "frame__none__20260927T100001Z.png",
    ]
    reasons = {f.name: why for f, why in skipped}
    assert reasons["frame__none__20260927T100002Z.json"] == "no matching .png"
    assert "clockwise" in reasons["frame__OGN-151__20260927T100003Z.json"]


def test_load_real(tmp_path):
    write(tmp_path, "frame__OGN-151__20260927T100000Z", label())
    write(tmp_path, "frame__none__20260927T100001Z", label(corners=None, pid=None))
    frames = load_real(tmp_path)
    assert [f.printing_id for f in frames] == ["OGN-151", None]
    assert frames[0].corners[0] == (100, 100) and frames[1].corners is None
    write(tmp_path, "frame__none__20260927T100002Z", label(w=-1))
    with pytest.raises(ValueError, match="width"):
        load_real(tmp_path)
