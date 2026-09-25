"""TCGCSV adapter — one-time USD price snapshot (daily mirror of TCGplayer)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import config
import rawcache
from cardsio import FOIL_SUFFIX
from httpclient import HttpClient
from sources.base import PriceRecord

MANIFEST = "manifest.json"


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class MatchResult:
    prices: list[PriceRecord] = field(default_factory=list)
    foil_of: dict[str, str] = field(default_factory=dict)       # foil printing_id → base printing_id
    unmatched: list[dict] = field(default_factory=list)          # {printing_id, ..., reason}


class TcgcsvSource:
    name = "tcgcsv"

    def fetch_raw(self, cards: list[dict], rc_group_ids: dict[str, str] | None = None) -> Path:
        """Fetch the snapshot for every set in `cards`. Aborts if over PRICE_MAX_REQUESTS."""
        raw = rawcache.new_dir(self.name)
        http = HttpClient(cache_dir=raw / "http")
        cat = config.TCGCSV_CATEGORY_ID
        last_updated = http.get_text(f"{config.TCGCSV_ROOT}/last-updated.txt").strip()
        categories = http.get_json(f"{config.TCGCSV_BASE}/categories")["results"]
        if not any(c["categoryId"] == cat for c in categories):
            raise SystemExit(f"TCGCSV category {cat} not found — update config.TCGCSV_CATEGORY_ID")
        groups = http.get_json(f"{config.TCGCSV_BASE}/{cat}/groups")["results"]

        set_to_group = resolve_groups(sorted({c["set_code"] for c in cards}), groups, rc_group_ids or {})
        group_ids = sorted(set(set_to_group.values()))
        estimate = 3 + 2 * len(group_ids)
        if estimate > config.PRICE_MAX_REQUESTS:
            raise BudgetExceeded(f"price fetch needs ~{estimate} requests > PRICE_MAX_REQUESTS={config.PRICE_MAX_REQUESTS}")
        for gid in group_ids:
            http.get_json(f"{config.TCGCSV_BASE}/{cat}/{gid}/products")
            http.get_json(f"{config.TCGCSV_BASE}/{cat}/{gid}/prices")

        manifest = {"last_updated": last_updated, "set_to_group": set_to_group, "requests": http.request_count}
        (raw / MANIFEST).write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        rawcache.mark_complete(raw)
        print(f"  {http.summary()}")
        return raw

    def parse(self, raw_dir: Path, cards: list[dict]) -> list[PriceRecord]:
        return self.match(raw_dir, cards).prices

    def match(self, raw_dir: Path, cards: list[dict]) -> MatchResult:
        """Pure: cached responses + cards → prices, foil printings, unmatched. No network."""
        manifest = json.loads((raw_dir / MANIFEST).read_text(encoding="utf-8"))
        http = HttpClient(cache_dir=raw_dir / "http")  # cache-only reads
        cat = config.TCGCSV_CATEGORY_ID
        products_by_group, price_rows = {}, []
        for gid in sorted(set(manifest["set_to_group"].values())):
            products_by_group[gid] = http.get_json(f"{config.TCGCSV_BASE}/{cat}/{gid}/products")["results"]
            price_rows += http.get_json(f"{config.TCGCSV_BASE}/{cat}/{gid}/prices")["results"]
        if http.request_count:
            raise RuntimeError("match() hit the network — raw cache incomplete")
        return match_cards(cards, manifest["set_to_group"], products_by_group, price_rows,
                           as_of_iso(manifest["last_updated"]))


# --- pure helpers (unit tested) ---------------------------------------------
def as_of_iso(last_updated: str) -> str:
    """'2026-09-25T20:05:42+0000' → '2026-09-25T20:05:42Z'."""
    dt = datetime.strptime(last_updated.strip(), "%Y-%m-%dT%H:%M:%S%z")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_groups(set_codes: list[str], groups: list[dict], rc_group_ids: dict[str, str]) -> dict[str, int]:
    """Set code → TCGCSV groupId. Abbreviation first (Riftcodex ids are wrong/missing for some sets)."""
    by_abbr = {(g.get("abbreviation") or "").upper(): g["groupId"] for g in groups}
    valid = {g["groupId"] for g in groups}
    out = {}
    for s in set_codes:
        if s.upper() in by_abbr:
            out[s] = by_abbr[s.upper()]
        elif rc_group_ids.get(s) and int(rc_group_ids[s]) in valid:
            out[s] = int(rc_group_ids[s])
        else:
            print(f"  WARN no TCGCSV group for set {s}")
    return out


def norm_number(n: str) -> str:
    """'007a/298' → '7a'; '007A' → '7a'; '299*' → '299*'."""
    n = n.split("/")[0].strip().lower()
    return n.lstrip("0") or "0"


def norm_name(n: str) -> str:
    n = n.casefold()
    n = re.sub(r"[^\w\s]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def is_card(product: dict) -> bool:
    return any(e["name"] in ("Number", "Rarity") for e in product.get("extendedData") or [])


def ext(product: dict, key: str) -> str | None:
    return next((e["value"] for e in product.get("extendedData") or [] if e["name"] == key), None)


def pick_price(row: dict) -> tuple[float, str] | None:
    for f in config.PRICE_FIELDS:
        if row.get(f) is not None:
            return float(row[f]), f
    return None


def match_cards(cards: list[dict], set_to_group: dict[str, int], products_by_group: dict,
                price_rows: list[dict], as_of: str) -> MatchResult:
    res = MatchResult()
    products = {p["productId"]: p for ps in products_by_group.values() for p in ps if is_card(p)}
    by_number: dict[tuple[int, str], list[int]] = {}
    by_name: dict[tuple[int, str], list[int]] = {}
    for gid, ps in products_by_group.items():
        for p in ps:
            if not is_card(p):
                continue
            if (num := ext(p, "Number")):
                by_number.setdefault((int(gid), norm_number(num)), []).append(p["productId"])
            by_name.setdefault((int(gid), norm_name(p.get("cleanName") or p["name"])), []).append(p["productId"])
    prices: dict[int, dict[str, dict]] = {}
    for r in price_rows:
        prices.setdefault(r["productId"], {})[r["subTypeName"]] = r

    for c in cards:
        if c["variant"] == "foil":
            continue
        pid, method = None, None
        tid = int(c["tcgplayer_id"]) if c.get("tcgplayer_id") else None
        gid = set_to_group.get(c["set_code"])
        if tid in products:
            pid, method = tid, "tcgplayer_id"
        elif gid is not None and len(cands := by_number.get((gid, norm_number(c["collector_number"])), [])) == 1:
            pid, method = cands[0], "set_and_number"
        elif gid is not None and len(cands := by_name.get((gid, norm_name(c["name"])), [])) == 1:
            pid, method = cands[0], "name_and_set"
        if pid is None:
            res.unmatched.append({**c, "reason": "no_product" if gid is not None else "no_group"})
            continue

        subs = prices.get(pid, {})
        normal = pick_price(subs[config.TCGCSV_NORMAL_SUBTYPE]) if config.TCGCSV_NORMAL_SUBTYPE in subs else None
        foil = pick_price(subs[config.TCGCSV_FOIL_SUBTYPE]) if config.TCGCSV_FOIL_SUBTYPE in subs else None
        others = [pick_price(r) for k, r in subs.items() if k not in (config.TCGCSV_NORMAL_SUBTYPE, config.TCGCSV_FOIL_SUBTYPE)]
        base = normal or foil or next((o for o in others if o), None)
        if base is None:
            res.unmatched.append({**c, "reason": f"no_price(product {pid})"})
            continue
        res.prices.append(PriceRecord(c["printing_id"], base[0], base[1], "tcgcsv", as_of, method))
        if normal and foil:  # separate foil price → separate foil printing
            fid = c["printing_id"] + FOIL_SUFFIX
            res.foil_of[fid] = c["printing_id"]
            res.prices.append(PriceRecord(fid, foil[0], foil[1], "tcgcsv", as_of, method))
    return res
