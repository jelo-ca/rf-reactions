"""Riftcodex adapter — default card source. Public, no key."""
from __future__ import annotations

import json
import re
from pathlib import Path

import config
import rawcache
from httpclient import HttpClient
from sources.base import CardRecord

SETS_FILE = "sets.json"
CARDS_FILE = "cards_{set_id}.json"


class RiftcodexSource:
    name = "riftcodex"

    def fetch_raw(self, sets: list[str]) -> Path:
        """Fetch /sets and every card page of `sets` into a timestamped raw dir.

        `sets` may contain "ALL". Every set is fetched regardless when
        INCLUDE_ALL_PRINTINGS is on, so other printings of pool names are found.
        """
        raw = rawcache.new_dir(self.name)
        http = HttpClient(cache_dir=raw / "http")
        set_list = http.get_json(f"{config.RIFTCODEX_BASE}/sets", {"size": 100})
        (raw / SETS_FILE).write_text(json.dumps(set_list, indent=1), encoding="utf-8")

        all_ids = [s["set_id"] for s in set_list["items"]]
        if "ALL" in sets or config.INCLUDE_ALL_PRINTINGS:
            wanted = all_ids
        else:  # Nexus Night promos live in a non-booster set
            wanted = [s for s in all_ids if s in sets or s == config.NEXUS_NIGHT_SET]
        for set_id in wanted:
            items: list[dict] = []
            page = 1
            while True:
                resp = http.get_json(
                    f"{config.RIFTCODEX_BASE}/cards",
                    {"set_id": set_id, "page": page, "size": config.RIFTCODEX_PAGE_SIZE, "sort": "collector_number"},
                )
                items.extend(resp["items"])
                if page >= resp["pages"]:
                    break
                page += 1
            (raw / CARDS_FILE.format(set_id=set_id)).write_text(json.dumps(items, indent=1), encoding="utf-8")
            print(f"  {set_id}: {len(items)} cards")
        rawcache.mark_complete(raw)
        print(f"  {http.summary()}")
        return raw

    def parse(self, raw_dir: Path) -> list[CardRecord]:
        """Pure: raw dir → CardRecords for every set present. No network."""
        records: list[CardRecord] = []
        taken: set[str] = set()
        for path in sorted(raw_dir.glob(CARDS_FILE.format(set_id="*"))):
            items = dedupe(json.loads(path.read_text(encoding="utf-8")))
            # Untagged printing claims the base id; '(Metal)' etc. get a suffix.
            items.sort(key=lambda it: (it["riftbound_id"], variant_tag(it["name"]) is not None, it["name"]))
            for item in items:
                rec = parse_card(item)
                rec.printing_id = unique_id(rec.printing_id, variant_tag(item["name"]), taken)
                taken.add(rec.printing_id)
                records.append(rec)
        return records


# --- pure helpers (unit tested) ---------------------------------------------
_TAG_RE = re.compile(r"\s*\(([^)]*)\)\s*$")


def base_name(name: str) -> str:
    """'Teemo - Swift Scout (Alternate Art)' → 'Teemo - Swift Scout'."""
    return _TAG_RE.sub("", name).strip()


def variant_tag(name: str) -> str | None:
    m = _TAG_RE.search(name)
    return m.group(1) if m else None


def dedupe(items: list[dict]) -> list[dict]:
    """Drop stale duplicate records (same id, name and picture — seen for VEN runes).

    Keeps the record that has a tcgplayer_id, then the most recently updated.
    """
    best: dict[tuple, dict] = {}
    for it in items:
        key = (it["riftbound_id"], it["name"], it["media"]["image_url"])
        rank = (bool(it.get("tcgplayer_id")), (it.get("metadata") or {}).get("updated_on") or "")
        prev = best.get(key)
        if prev is None or rank > (bool(prev.get("tcgplayer_id")), (prev.get("metadata") or {}).get("updated_on") or ""):
            best[key] = it
    return list(best.values())


def number_segment(riftbound_id: str) -> str:
    """'ogn-007a-298' → '007a'; 'ogn-299*-298' → '299*'; tokens/runes 'sfd-t03' → 't03'."""
    parts = riftbound_id.split("-")
    if len(parts) not in (2, 3):
        raise ValueError(f"unexpected riftbound_id: {riftbound_id!r}")
    return parts[1]


def safe_segment(seg: str) -> str:
    """Filename-safe, upper-case: '007a' → '007A', '299*' → '299S'."""
    return re.sub(r"[^A-Z0-9]", "", seg.upper().replace("*", "S"))


def unique_id(pid: str, tag: str | None, taken: set[str]) -> str:
    """Disambiguate printings that share a riftbound_id (e.g. '(Metal)' → suffix M)."""
    if pid not in taken:
        return pid
    suffix = re.sub(r"[^A-Z0-9]", "", (tag or "X").upper())[:1] or "X"
    candidate, n = pid + suffix, 2
    while candidate in taken:
        candidate, n = f"{pid}{suffix}{n}", n + 1
    return candidate


def classify_variant(item: dict) -> str:
    meta = item.get("metadata") or {}
    set_id = item["set"]["set_id"]
    if set_id in config.PROMO_SETS or item["classification"].get("rarity") == "Promo":
        return "promo"
    if meta.get("alternate_art") or meta.get("overnumbered") or meta.get("signature"):
        return "alt_art"
    return "normal"


def parse_card(item: dict) -> CardRecord:
    set_id = item["set"]["set_id"]
    seg = number_segment(item["riftbound_id"])
    return CardRecord(
        printing_id=f"{set_id}-{safe_segment(seg)}",
        name=base_name(item["name"]),
        set_code=set_id,
        collector_number=seg,
        rarity=item["classification"].get("rarity") or "",
        variant=classify_variant(item),
        image_url=item["media"]["image_url"],
        source="riftcodex",
        source_id=item["id"],
        tcgplayer_id=str(item["tcgplayer_id"]) if item.get("tcgplayer_id") else None,
        orientation=item.get("orientation") or "portrait",
        variant_tag=variant_tag(item["name"]),
    )
