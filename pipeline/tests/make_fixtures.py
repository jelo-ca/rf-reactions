"""Regenerate trimmed fixtures from the newest cached raw dirs. Run manually; tests never fetch."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import rawcache  # noqa: E402
from httpclient import cache_key  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"

# Chosen to cover: plain card, alt art, overnumbered, Metal duplicate id, stale VEN rune dup, token, landscape battlefield.
KEEP_RC = {
    "OGN": {"ogn-001-298", "ogn-007-298", "ogn-007a-298", "ogn-299*-298"},
    "OPP": {"opp-017-024"},
    "VEN": {"ven-r01"},
    "SFD": {"sfd-t03"},
}


def main() -> None:
    rc = rawcache.newest_dir("riftcodex")
    out = FIX / "riftcodex"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copy(rc / "sets.json", out / "sets.json")
    battlefield = None
    for set_id, keep in KEEP_RC.items():
        items = json.loads((rc / f"cards_{set_id}.json").read_text(encoding="utf-8"))
        sel = [i for i in items if i["riftbound_id"] in keep]
        if set_id == "OGN":
            battlefield = next(i for i in items if i["orientation"] == "landscape")
            sel.append(battlefield)
        (out / f"cards_{set_id}.json").write_text(json.dumps(sel, indent=1), encoding="utf-8")

    tc = rawcache.newest_dir("tcgcsv")
    if tc is None:
        print("no tcgcsv raw dir yet; skipped price fixture")
        return
    manifest = json.loads((tc / "manifest.json").read_text(encoding="utf-8"))
    out = FIX / "tcgcsv"
    shutil.rmtree(out, ignore_errors=True)
    (out / "http").mkdir(parents=True)
    gid = manifest["set_to_group"]["OGN"]
    base = f"{config.TCGCSV_BASE}/{config.TCGCSV_CATEGORY_ID}/{gid}"
    products = json.loads((tc / "http" / (cache_key(f"{base}/products") + ".json")).read_text(encoding="utf-8"))
    prices = json.loads((tc / "http" / (cache_key(f"{base}/prices") + ".json")).read_text(encoding="utf-8"))
    nums = {"001/298", "007/298", "007a/298", "299*/298"}
    keep_ids = {p["productId"] for p in products["results"]
                if any(e["name"] == "Number" and e["value"] in nums for e in p["extendedData"])}
    keep_ids.add(next(p["productId"] for p in products["results"] if not p["extendedData"]))  # one sealed product
    products["results"] = [p for p in products["results"] if p["productId"] in keep_ids]
    prices["results"] = [p for p in prices["results"] if p["productId"] in keep_ids]
    (out / "http" / (cache_key(f"{base}/products") + ".json")).write_text(json.dumps(products, indent=1), encoding="utf-8")
    (out / "http" / (cache_key(f"{base}/prices") + ".json")).write_text(json.dumps(prices, indent=1), encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps({**manifest, "set_to_group": {"OGN": gid}}, indent=1), encoding="utf-8")
    print("fixtures written:", FIX)


if __name__ == "__main__":
    main()
