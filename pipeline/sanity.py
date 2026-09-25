"""Phase 1 acceptance checks (PLAN.md §4 acceptance). Offline, reads app/public/data.

1. Leave-one-out retrieval: each augmented row, searched against all *other* rows,
   must find its own printing (or one with the same image_hash) >= 95% of the time.
2. Layout sanity: for each look-alike group, a printing's augmented images must score
   higher against its own reference signature than against every differently-pictured
   sibling >= 95% of the time.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import numpy as np

import config
from augment import load_rgb
from augment import augment as make_aug
from cardsio import read_csv
from layout import layout_score, signature

TARGET = 0.95


def load():
    meta = json.loads((config.APP_DATA / "meta.json").read_text(encoding="utf-8"))
    emb = np.fromfile(config.APP_DATA / "embeddings.bin", dtype="<f4").reshape(meta["rows"], meta["dim"])
    ids = json.loads((config.APP_DATA / "embedding_ids.json").read_text(encoding="utf-8"))
    return meta, emb, ids


def leave_one_out(emb: np.ndarray, ids: list[str], per: int, hash_of: dict[str, str]):
    """Best-scoring other row per printing, exact brute force (same as the browser search)."""
    ids_arr = np.array(ids)
    uniq, inv = np.unique(ids_arr, return_inverse=True)
    aug_rows = [i for i in range(len(ids)) if i % per != 0]
    hits, misses = 0, Counter()
    for start in range(0, len(aug_rows), 512):
        rows = aug_rows[start: start + 512]
        scores = emb[rows] @ emb.T
        scores[np.arange(len(rows)), rows] = -np.inf           # leave this row out
        best = np.full((len(rows), len(uniq)), -np.inf, dtype=np.float32)
        np.maximum.at(best.T, inv, scores.T)                    # best row per printing
        top = uniq[best.argmax(axis=1)]
        for r, t in zip(rows, top):
            if hash_of[t] == hash_of[ids[r]]:
                hits += 1
            else:
                misses[(ids[r], t)] += 1
    return hits / len(aug_rows), misses


def layout_sanity(cards: list[dict]):
    base = [c for c in cards if c["variant"] != "foil"]
    by_name = defaultdict(list)
    for c in base:
        by_name[c["name"]].append(c)
    groups = {n: g for n, g in by_name.items() if len({c["image_hash"] for c in g}) > 1}
    results = {}
    for name, group in groups.items():
        # One reference signature per distinct picture in the group.
        refs = {}
        for c in group:
            refs.setdefault(c["image_hash"], signature(to_model(load_rgb(config.IMAGES_DIR / c["image_file"]))))
        ok = total = 0
        for c in group:
            clean = load_rgb(config.IMAGES_DIR / c["image_file"])
            for k in range(config.AUG_PER_IMAGE):
                s = signature(make_aug(clean, c["printing_id"], k))
                own = layout_score(s, refs[c["image_hash"]])
                others = [layout_score(s, v) for h, v in refs.items() if h != c["image_hash"]]
                ok += own > max(others)
                total += 1
        results[name] = (ok, total)
    return results


def to_model(rgb):
    from augment import to_model_size
    return to_model_size(rgb)


def main() -> None:
    cards = read_csv(config.CARDS_CSV)
    hash_of = {c["printing_id"]: c["image_hash"] for c in cards}
    meta, emb, ids = load()
    rate, misses = leave_one_out(emb, ids, meta["rowsPerPrinting"], hash_of)
    print(f"Leave-one-out: {rate:.1%} ({'PASS' if rate >= TARGET else 'FAIL'}, target {TARGET:.0%})")
    for (a, b), n in misses.most_common(10):
        print(f"  {a} -> {b}  x{n}")

    res = layout_sanity(cards)
    ok = sum(o for o, _ in res.values())
    total = sum(t for _, t in res.values())
    failing = {n: o / t for n, (o, t) in res.items() if o / t < TARGET}
    print(f"Layout sanity: {len(res)} groups, overall {ok / total:.1%}, "
          f"{len(res) - len(failing)}/{len(res)} groups >= {TARGET:.0%}")
    for n, r in sorted(failing.items(), key=lambda x: x[1])[:15]:
        print(f"  {r:.0%}  {n}")


if __name__ == "__main__":
    main()
