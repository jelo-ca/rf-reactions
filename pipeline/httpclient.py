"""Shared HTTP client: disk cache, per-host rate limit, retries.

Named httpclient.py (not http.py as in PLAN.md) so it doesn't shadow the
stdlib `http` package that `requests` imports.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import requests

import config


class ForbiddenError(RuntimeError):
    """403 from a gateway/bot filter. Never retried."""


def cache_key(url: str, params: dict | None = None) -> str:
    """Readable, filename-safe key for URL + params."""
    full = url + ("?" + urlencode(sorted(params.items())) if params else "")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", urlparse(full).path + "_" + (urlencode(sorted(params.items())) if params else ""))
    digest = hashlib.sha1(full.encode()).hexdigest()[:10]
    return f"{slug.strip('_')[:80]}__{digest}"


class HttpClient:
    def __init__(self, cache_dir: Path | None = None):
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers["User-Agent"] = f"{config.USER_AGENT} (+{config.CONTACT})"
        self.request_count = 0
        self.cache_hits = 0
        self._last_by_host: dict[str, float] = {}

    # --- public ----------------------------------------------------------
    def get_json(self, url: str, params: dict | None = None) -> Any:
        path = self._cache_path(url, params, ".json")
        if path and path.exists():
            self.cache_hits += 1
            return json.loads(path.read_text(encoding="utf-8"))
        data = self._request(url, params).json()
        if path:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        return data

    def get_text(self, url: str, params: dict | None = None) -> str:
        path = self._cache_path(url, params, ".txt")
        if path and path.exists():
            self.cache_hits += 1
            return path.read_text(encoding="utf-8")
        text = self._request(url, params).text
        if path:
            path.write_text(text, encoding="utf-8")
        return text

    def get_bytes(self, url: str) -> bytes:
        """Uncached; callers (image download) persist the result themselves."""
        return self._request(url, None).content

    def summary(self) -> str:
        return f"HTTP requests: {self.request_count} network, {self.cache_hits} cache hits"

    # --- internals -------------------------------------------------------
    def _cache_path(self, url: str, params: dict | None, ext: str) -> Path | None:
        if self.cache_dir is None:
            return None
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        return self.cache_dir / (cache_key(url, params) + ext)

    def _throttle(self, host: str) -> None:
        last = self._last_by_host.get(host)
        if last is not None:
            wait = config.MIN_REQUEST_INTERVAL_S - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_by_host[host] = time.monotonic()

    def _request(self, url: str, params: dict | None) -> requests.Response:
        host = urlparse(url).netloc
        for attempt in range(1, config.MAX_RETRIES + 1):
            self._throttle(host)
            self.request_count += 1
            try:
                resp = self.session.get(url, params=params, timeout=config.REQUEST_TIMEOUT_S)
            except requests.RequestException as e:
                if attempt == config.MAX_RETRIES:
                    raise
                self._sleep_backoff(attempt, None, f"{type(e).__name__} for {url}")
                continue
            if resp.status_code == 403:
                raise ForbiddenError(
                    f"403 from {url} — not an auth error (gateway/bot filter). "
                    f"Body: {resp.text[:500]!r}. Stopping; report to human."
                )
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == config.MAX_RETRIES:
                    resp.raise_for_status()
                self._sleep_backoff(attempt, resp.headers.get("Retry-After"), f"HTTP {resp.status_code} for {url}")
                continue
            resp.raise_for_status()
            return resp
        raise RuntimeError("unreachable")

    @staticmethod
    def _sleep_backoff(attempt: int, retry_after: str | None, why: str) -> None:
        delay = config.BACKOFF_BASE_S * 2 ** (attempt - 1)
        if retry_after and retry_after.isdigit():
            delay = max(delay, float(retry_after))
        print(f"  retry {attempt}/{config.MAX_RETRIES} in {delay:.1f}s: {why}")
        time.sleep(delay)
