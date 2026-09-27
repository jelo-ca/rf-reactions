import config
from sort_eval import plan_moves


def test_plan_moves(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "EVAL_DIR", tmp_path / "eval")
    src = tmp_path / "dl"
    src.mkdir()
    names = ["OGN-001__20260926T101500Z.png", "OGN-001__20260926T101500Z (1).png",
             "ZZZ-999__20260926T101500Z.png", "holiday.png"]
    files = [src / n for n in names]
    moves, skipped = plan_moves(files, {"OGN-001"})
    assert [m[0].name for m in moves] == names[:2]
    assert moves[0][1] == config.EVAL_DIR / "OGN-001" / "OGN-001__20260926T101500Z.png"
    assert [(f.name, why) for f, why in skipped] == [("ZZZ-999__20260926T101500Z.png", "unknown printing ZZZ-999")]
