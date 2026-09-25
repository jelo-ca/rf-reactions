"""End-to-end tests for the fetch layer. Fully offline.

A fake `requests.Session.get` serves the trimmed real fixtures (Riftcodex pages,
TCGCSV snapshot) and generated images, and every path in `config` points into
a temp dir, so the real data/ folder is never touched.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest
import requests
from PIL import Image

import config
import fetch_cards
import fetch_prices
import rawcache
from httpclient import ForbiddenError, HttpClient, cache_key
from sources.prices_tcgcsv import BudgetExceeded, TcgcsvSource
from sources.riftcodex import RiftcodexSource

from conftest import FIXTURES

RC_FIX = FIXTURES / "riftcodex"
TC_FIX = FIXTURES / "tcgcsv"


# --- fake network ------------------------------------------------------------
class FakeResponse:
    def __init__(self, status=200, body=None, content=b"", headers=None):
        self.status_code = status
        self._body = body
        self.content = content
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.headers = headers or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeServer:
    """Routes URLs to fixture data. Records every call."""

    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.rc_sets = json.loads((RC_FIX / "sets.json").read_text(encoding="utf-8"))
        self.rc_cards = {p.stem.split("_", 1)[1]: json.loads(p.read_text(encoding="utf-8"))
                         for p in RC_FIX.glob("cards_*.json")}
        self.landscape_urls = {c["media"]["image_url"] for cs in self.rc_cards.values()
                               for c in cs if c["orientation"] == "landscape"}
        self.tc_http = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in (TC_FIX / "http").glob("*.json")}
        self.tc_manifest = json.loads((TC_FIX / "manifest.json").read_text(encoding="utf-8"))
        self.overrides: dict[str, list[FakeResponse]] = {}  # url → queued responses

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        if url in self.overrides and self.overrides[url]:
            return self.overrides[url].pop(0)
        u = urlparse(url)
        if u.netloc == "api.riftcodex.com":
            return self._riftcodex(u.path, params or {})
        if u.netloc == "tcgcsv.com":
            return self._tcgcsv(url, u.path)
        if u.netloc == "cmsassets.rgpub.io":
            return FakeResponse(content=fake_png(url, landscape=url in self.landscape_urls))
        return FakeResponse(404, {"error": "not found"})

    def _riftcodex(self, path, params):
        if path == "/sets":
            return FakeResponse(body=self.rc_sets)
        if path == "/cards":
            items = self.rc_cards.get(params["set_id"], [])
            size, page = int(params["size"]), int(params["page"])
            pages = max(1, -(-len(items) // size))
            return FakeResponse(body={"items": items[(page - 1) * size: page * size],
                                      "total": len(items), "page": page, "size": size, "pages": pages})
        return FakeResponse(404, {})

    def _tcgcsv(self, url, path):
        if path == "/last-updated.txt":
            return FakeResponse(body=self.tc_manifest["last_updated"])
        if path == "/tcgplayer/categories":
            return FakeResponse(body={"results": [{"categoryId": 89, "name": "Riftbound"}]})
        if path == "/tcgplayer/89/groups":
            return FakeResponse(body={"results": [
                {"groupId": 24344, "abbreviation": "OGN"}, {"groupId": 24519, "abbreviation": "SFD"},
                {"groupId": 24560, "abbreviation": "UNL"}, {"groupId": 24698, "abbreviation": "VEN"},
                {"groupId": 24528, "abbreviation": "OPP"}]})
        key = cache_key(url)
        if key in self.tc_http:
            return FakeResponse(body=self.tc_http[key])
        return FakeResponse(body={"results": []})  # other groups: empty

    def count(self, host: str) -> int:
        return sum(1 for u, _ in self.calls if urlparse(u).netloc == host)


def fake_png(seed: str, landscape: bool = False) -> bytes:
    """Deterministic, distinct-per-URL test image (random blocks → distinct pHash)."""
    w, h = (1039, 744) if landscape else (744, 1039)
    rnd = hashlib.sha256(seed.encode()).digest()
    small = Image.frombytes("L", (8, 4), rnd).resize((w, h), Image.NEAREST).convert("RGB")
    buf = io.BytesIO()
    small.save(buf, "PNG")
    return buf.getvalue()


# --- fixtures ----------------------------------------------------------------
@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Point every data path into tmp_path, disable sleeps, install the fake server."""
    data = tmp_path / "data"
    paths = {
        "DATA": data, "RAW_DIR": data / "raw",
        "CARDS_DIR": data / "cards", "CARDS_CSV": data / "cards" / "cards.csv",
        "IMAGES_DIR": data / "cards" / "images", "IMAGE_OVERRIDES_DIR": data / "cards" / "image_overrides",
        "LOOKALIKE_REPORT": data / "cards" / "lookalikes.json",
        "PRICES_DIR": data / "prices", "PRICES_CSV": data / "prices" / "prices.csv",
        "UNMATCHED_CSV": data / "prices" / "unmatched.csv",
        "MANUAL_OVERRIDES_CSV": data / "prices" / "manual_overrides.csv",
    }
    for k, v in paths.items():
        monkeypatch.setattr(config, k, v)
    monkeypatch.setattr(config, "MIN_REQUEST_INTERVAL_S", 0)
    monkeypatch.setattr(config, "BACKOFF_BASE_S", 0)
    server = FakeServer()
    monkeypatch.setattr(requests.Session, "get", lambda self, url, **kw: server.get(url, **kw))
    return server


def run(module, monkeypatch, *args):
    monkeypatch.setattr(sys, "argv", [module.__name__, *args])
    module.main()


def read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# --- HTTP client -------------------------------------------------------------
def test_http_retries_5xx_and_429_then_succeeds(sandbox):
    url = "https://api.riftcodex.com/sets"
    sandbox.overrides[url] = [FakeResponse(503, {}), FakeResponse(429, {}, headers={"Retry-After": "0"})]
    assert HttpClient().get_json(url)["total"] == 8
    assert sandbox.count("api.riftcodex.com") == 3


def test_http_403_is_not_retried(sandbox):
    url = "https://api.riftcodex.com/sets"
    sandbox.overrides[url] = [FakeResponse(403, "blocked by gateway")]
    with pytest.raises(ForbiddenError, match="blocked by gateway"):
        HttpClient().get_json(url)
    assert sandbox.count("api.riftcodex.com") == 1


def test_http_gives_up_after_max_retries(sandbox):
    url = "https://api.riftcodex.com/sets"
    sandbox.overrides[url] = [FakeResponse(500, {}) for _ in range(config.MAX_RETRIES)]
    with pytest.raises(requests.HTTPError):
        HttpClient().get_json(url)
    assert sandbox.count("api.riftcodex.com") == config.MAX_RETRIES


def test_http_sets_user_agent_with_contact():
    ua = HttpClient().session.headers["User-Agent"]
    assert ua.startswith(config.USER_AGENT) and config.CONTACT in ua


def test_http_disk_cache(sandbox, tmp_path):
    http = HttpClient(cache_dir=tmp_path / "c")
    http.get_json("https://api.riftcodex.com/sets")
    http.get_json("https://api.riftcodex.com/sets")
    assert http.request_count == 1 and http.cache_hits == 1


# --- source adapters: fetch_raw ----------------------------------------------
def test_riftcodex_fetch_raw_paginates_and_includes_nexus_night(sandbox, monkeypatch):
    monkeypatch.setattr(config, "RIFTCODEX_PAGE_SIZE", 2)  # OGN fixture has 5 cards → 3 pages
    raw = RiftcodexSource().fetch_raw(["OGN", "SFD", "UNL", "VEN"])
    assert (raw / rawcache.COMPLETE_MARKER).exists()
    assert len(json.loads((raw / "cards_OGN.json").read_text(encoding="utf-8"))) == 5
    # Nexus Night promos live in OPP, so OPP must be fetched even though it isn't a booster set.
    assert (raw / f"cards_{config.NEXUS_NIGHT_SET}.json").exists()
    ogn_pages = [p for u, p in sandbox.calls if u.endswith("/cards") and p["set_id"] == "OGN"]
    assert [p["page"] for p in ogn_pages] == [1, 2, 3]


def test_riftcodex_fetch_raw_resumes_incomplete_dir(sandbox):
    first = rawcache.new_dir("riftcodex")  # simulate a crashed run: dir without _complete
    raw = RiftcodexSource().fetch_raw(["OGN"])
    assert raw == first


def test_tcgcsv_fetch_raw_within_budget(sandbox):
    cards = [{"set_code": s} for s in ("OGN", "SFD", "UNL", "VEN", "OPP")]
    raw = TcgcsvSource().fetch_raw(cards, {})
    manifest = json.loads((raw / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["requests"] == 3 + 2 * 5 <= config.PRICE_MAX_REQUESTS
    assert manifest["set_to_group"]["OPP"] == 24528
    assert (raw / rawcache.COMPLETE_MARKER).exists()


def test_tcgcsv_fetch_raw_aborts_over_budget(sandbox, monkeypatch):
    monkeypatch.setattr(config, "PRICE_MAX_REQUESTS", 6)
    with pytest.raises(BudgetExceeded):
        TcgcsvSource().fetch_raw([{"set_code": s} for s in ("OGN", "SFD")], {})
    assert sandbox.count("tcgcsv.com") == 3  # only the discovery requests, no per-group fetches


# --- scripts end to end ------------------------------------------------------
EXPECTED_POOL = {"OGN-001", "OGN-007", "OGN-007A", "OGN-299S", "OGN-275", "OPP-017", "SFD-T03", "VEN-R01"}


def test_fetch_cards_end_to_end(sandbox, monkeypatch):
    run(fetch_cards, monkeypatch)
    rows = {r["printing_id"]: r for r in read(config.CARDS_CSV)}
    assert set(rows) == EXPECTED_POOL                     # OPP-017M (Metal) excluded
    assert rows["OGN-007A"]["variant"] == "alt_art" and rows["OPP-017"]["variant"] == "promo"
    for r in rows.values():
        with Image.open(config.IMAGES_DIR / r["image_file"]) as img:
            assert img.height > img.width                  # battlefield rotated to portrait
        assert len(r["image_hash"]) == 16
    report = json.loads(config.LOOKALIKE_REPORT.read_text(encoding="utf-8"))
    assert "Fury Rune" in report["lookalike_groups"]      # OGN-007 vs OGN-007A (+ VEN-R01)

    # Second run: cached raw + existing images → zero network requests.
    before = len(sandbox.calls)
    run(fetch_cards, monkeypatch)
    assert len(sandbox.calls) == before
    assert {r["printing_id"] for r in read(config.CARDS_CSV)} == EXPECTED_POOL


def test_fetch_cards_uses_image_override(sandbox, monkeypatch):
    config.IMAGE_OVERRIDES_DIR.mkdir(parents=True)
    (config.IMAGE_OVERRIDES_DIR / "OPP-017.png").write_bytes(fake_png("human-supplied promo"))
    run(fetch_cards, monkeypatch)
    rows = {r["printing_id"]: r for r in read(config.CARDS_CSV)}
    with Image.open(config.IMAGES_DIR / "OPP-017.png") as a, \
         Image.open(config.IMAGE_OVERRIDES_DIR / "OPP-017.png") as b:
        assert a.tobytes() == b.convert("RGB").tobytes()
    assert rows["OPP-017"]["image_hash"]


def seed_tcgcsv_cache():
    """Install the trimmed snapshot as the newest complete raw dir (OGN only)."""
    dest = config.RAW_DIR / "tcgcsv" / "20260101T000000Z"
    shutil.copytree(TC_FIX, dest)
    rawcache.mark_complete(dest)


def test_fetch_prices_end_to_end(sandbox, monkeypatch):
    run(fetch_cards, monkeypatch)
    seed_tcgcsv_cache()
    run(fetch_prices, monkeypatch)
    assert sandbox.count("tcgcsv.com") == 0                 # cached snapshot reused

    cards = {r["printing_id"]: r for r in read(config.CARDS_CSV)}
    prices = {r["printing_id"]: r for r in read(config.PRICES_CSV)}
    unmatched = {r["printing_id"]: r["reason"] for r in read(config.UNMATCHED_CSV)}
    assert {"OGN-001", "OGN-007", "OGN-007A", "OGN-299S"} <= set(prices)
    assert prices["OGN-001"]["match_method"] == "tcgplayer_id"
    assert prices["OGN-001"]["as_of"] == "2026-09-25T20:05:42Z"
    foils = {pid for pid, c in cards.items() if c["variant"] == "foil"}
    assert foils and foils <= set(prices)
    assert all(cards[f[:-1]]["image_hash"] == cards[f]["image_hash"] for f in foils)
    assert unmatched.keys() == {"OGN-275", "OPP-017", "SFD-T03", "VEN-R01"}  # not in the OGN-only fixture
    assert set(prices) | set(unmatched) == set(cards)       # every printing accounted for

    # Frozen: a plain re-run changes nothing.
    snapshot = config.PRICES_CSV.read_bytes()
    run(fetch_prices, monkeypatch)
    assert config.PRICES_CSV.read_bytes() == snapshot

    # H3 loop: overrides + --rematch → 100% coverage, still offline.
    with config.MANUAL_OVERRIDES_CSV.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for pid in unmatched:
            w.writerow([pid, "1.23", "manual", "manual", "2026-09-25T20:05:42Z", "manual"])
    run(fetch_prices, monkeypatch, "--rematch")
    prices = {r["printing_id"]: r for r in read(config.PRICES_CSV)}
    assert set(prices) == set(read_ids(config.CARDS_CSV))
    assert prices["OPP-017"]["match_method"] == "manual" and float(prices["OPP-017"]["price_usd"]) == 1.23
    assert read(config.UNMATCHED_CSV) == []
    assert sandbox.count("tcgcsv.com") == 0


def test_fetch_cards_keeps_foil_rows_after_prices(sandbox, monkeypatch):
    run(fetch_cards, monkeypatch)
    seed_tcgcsv_cache()
    run(fetch_prices, monkeypatch)
    foils = {r["printing_id"] for r in read(config.CARDS_CSV) if r["variant"] == "foil"}
    run(fetch_cards, monkeypatch)  # prices are frozen, so foil rows must survive a card re-run
    assert foils and foils == {r["printing_id"] for r in read(config.CARDS_CSV) if r["variant"] == "foil"}


def read_ids(path: Path) -> list[str]:
    return [r["printing_id"] for r in read(path)]
