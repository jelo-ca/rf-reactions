"""Phase 1 acceptance checks. Offline, reads app/public/data.

1. Leave-one-out retrieval: each augmented row, searched against all *other* rows,
   must find its own printing (or one with the same image_hash) >= 95% of the time.
2. Look-alike groups (card names with >1 distinct picture): each printing's augmented
   images must pick their own picture over every sibling picture. Scored three ways:
   layout alone, embedding alone, and combined EMBED_WEIGHT*embed + LAYOUT_WEIGHT*layout
   (the §6.4 decision rule). **Acceptance = combined >= 95% overall** (human decision
   2026-09-25; PLAN's layout-only bar fails by design on different-art/same-frame
   groups). Per-group results are reported; weak groups carry to Phase 3 calibration.

Embedding scores compare against each picture's *clean* row only, so they are a
conservative estimate of the app (which takes the best of all rows per printing).
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import numpy as np

import config
from augment import augment as make_aug
from augment import load_rgb, to_model_size
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


def lookalike_groups(cards: list[dict]) -> dict[str, list[dict]]:
    by_name = defaultdict(list)
    for c in cards:
        if c["variant"] != "foil":
            by_name[c["name"]].append(c)
    return {n: g for n, g in by_name.items() if len({c["image_hash"] for c in g}) > 1}


def score_groups(cards, emb, ids, per) -> list[dict]:
    row0 = {pid: i for i, pid in enumerate(ids) if i % per == 0}
    results = []
    for name, group in lookalike_groups(cards).items():
        reps = {}
        for c in group:
            reps.setdefault(c["image_hash"], c)
        ref_sig = {h: signature(to_model_size(load_rgb(config.IMAGES_DIR / c["image_file"]))) for h, c in reps.items()}
        ref_emb = {h: emb[row0[c["printing_id"]]] for h, c in reps.items()}
        hits = Counter()
        n = 0
        for c in group:
            base = row0[c["printing_id"]]
            clean = load_rgb(config.IMAGES_DIR / c["image_file"])
            for k in range(config.AUG_PER_IMAGE):
                sig = signature(make_aug(clean, c["printing_id"], k))
                q = emb[base + 1 + k]  # embedding of this same augmented image
                ls = {h: layout_score(sig, v) for h, v in ref_sig.items()}
                es = {h: float(q @ v) for h, v in ref_emb.items()}
                cs = {h: config.EMBED_WEIGHT * es[h] + config.LAYOUT_WEIGHT * ls[h] for h in reps}
                for label, s in (("layout", ls), ("embed", es), ("combined", cs)):
                    hits[label] += max(s, key=s.get) == c["image_hash"]
                n += 1
        results.append({"name": name, "printings": [c["printing_id"] for c in group],
                        **{k: hits[k] / n for k in ("layout", "embed", "combined")}, "n": n})
    return results


def main() -> None:
    cards = read_csv(config.CARDS_CSV)
    hash_of = {c["printing_id"]: c["image_hash"] for c in cards}
    meta, emb, ids = load()
    per = meta["rowsPerPrinting"]

    if per < 2:
        print("Leave-one-out: skipped (clean reference rows only; real-photo eval.py is the check that matters)")
        rate, misses = None, Counter()
    else:
        rate, misses = leave_one_out(emb, ids, per, hash_of)
    if rate is not None:
        print(f"Leave-one-out: {rate:.1%} ({'PASS' if rate >= TARGET else 'FAIL'}, target {TARGET:.0%})")
    for (a, b), n in misses.most_common(10):
        print(f"  {a} -> {b}  x{n}")

    if per < 2:
        print("Look-alike groups: skipped (needs augmented reference rows; use eval.py hard pairs)")
        return
    res = score_groups(cards, emb, ids, per)
    total = sum(r["n"] for r in res)
    overall = {k: sum(r[k] * r["n"] for r in res) / total for k in ("layout", "embed", "combined")}
    print(f"\nLook-alike groups: {len(res)} ({total} augmented images)")
    for k, v in overall.items():
        print(f"  {k:9s} {v:.1%}   groups >= {TARGET:.0%}: {sum(r[k] >= TARGET for r in res)}/{len(res)}")
    verdict = "PASS" if overall["combined"] >= TARGET else "FAIL"
    print(f"Acceptance (combined >= {TARGET:.0%} overall): {verdict}")
    weak = sorted((r for r in res if r["combined"] < TARGET), key=lambda r: r["combined"])
    print(f"Weak groups (carry to Phase 3 calibration): {len(weak)}")
    for r in weak:
        print(f"  C{r['combined']:.0%} L{r['layout']:.0%} E{r['embed']:.0%}  {r['name']}  {r['printings']}")
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (config.OUT_DIR / "sanity_groups.json").write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
