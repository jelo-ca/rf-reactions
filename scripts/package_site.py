"""Zip the site build (app/dist from `npm run build:site`) for upload to imajello.com (Hostinger).

Usage (repo root):
  cd app && npm run build:site && cd ..
  py scripts/package_site.py            -> out/rift-pulls-site.zip

Unzip it into the folder RIFT_PULLS_DIR points at (next to the site's nodejs/ folder), so that
<RIFT_PULLS_DIR>/index.html exists. Files the app never loads at runtime are left out.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "app" / "dist"
OUT = ROOT / "out" / "rift-pulls-site.zip"

# Not loaded by the app: audition candidates, the v1 detector backup, the plain embedder (search is
# baked into recognizer.onnx) and its raw embeddings (only used by the offline pipeline).
SKIP_PREFIXES = ("memes/_audition/",)
SKIP_FILES = {"models/detector_v1.onnx", "models/embedder.onnx", "data/embeddings.bin"}
# Already compressed: store them instead of deflating again.
STORED = {".jpg", ".png", ".mp3", ".webm", ".onnx", ".wasm"}


def main() -> None:
    index = DIST / "index.html"
    if not index.exists():
        sys.exit("app/dist/index.html missing - run `npm run build:site` in app/ first")
    if "/projects/rift-pulls/" not in index.read_text(encoding="utf-8"):
        sys.exit("app/dist was not built for /projects/rift-pulls/ - use `npm run build:site`, not `npm run build`")
    OUT.parent.mkdir(exist_ok=True)
    n = size = 0
    with zipfile.ZipFile(OUT, "w") as z:
        for p in sorted(DIST.rglob("*")):
            rel = p.relative_to(DIST).as_posix()
            if p.is_dir() or rel in SKIP_FILES or rel.startswith(SKIP_PREFIXES):
                continue
            method = zipfile.ZIP_STORED if p.suffix.lower() in STORED else zipfile.ZIP_DEFLATED
            z.write(p, rel, compress_type=method)
            n += 1
            size += p.stat().st_size
    print(f"{OUT.relative_to(ROOT)}: {n} files, {size / 1e6:.0f} MB unpacked, {OUT.stat().st_size / 1e6:.0f} MB zipped")


if __name__ == "__main__":
    main()
