// Capture mode (PLAN.md §6.5): pick a printing, press Space to save the exact 224×320 crop the
// recognizer would see as `<printing_id>__<timestamp>.png`. Builds the real-camera eval set (H4).
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bitmapToPngBlob, captureFileName, cropForModel } from "../camera/crop";
import { searchCards } from "../data/loaders";
import type { Card } from "../types";
import { FrameLabeler } from "./FrameLabeler";

interface Props {
  cards: readonly Card[];
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function CaptureMode({ cards, videoRef }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Card | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [last, setLast] = useState<{ file: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labeling, setLabeling] = useState(false);
  const [frames, setFrames] = useState({ card: 0, empty: 0 });
  const onLabeled = useCallback((saved: "card" | "empty" | null) => {
    setLabeling(false);
    if (saved) setFrames((f) => ({ ...f, [saved]: f[saved] + 1 }));
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCards(cards, query, 12), [cards, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (labeling || e.target instanceof HTMLInputElement) return;
      if (e.code === "KeyF") {
        e.preventDefault();
        setLabeling(true);
        return;
      }
      if (e.code !== "Space") return;
      e.preventDefault();
      const video = videoRef.current;
      if (!selected || !video || !video.videoWidth) return;
      const file = captureFileName(selected.printingId);
      cropForModel(video)
        .then(bitmapToPngBlob)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = file;
          a.click();
          setLast((prev) => {
            if (prev) URL.revokeObjectURL(prev.url);
            return { file, url };
          });
          setCounts((c) => ({ ...c, [selected.printingId]: (c[selected.printingId] ?? 0) + 1 }));
          setError(null);
        })
        .catch((err: unknown) => setError(String(err)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, videoRef, labeling]);

  const choose = (c: Card) => {
    setSelected(c);
    setQuery("");
    inputRef.current?.blur();
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <aside className="capture" aria-label="Capture mode">
      <h2>Capture mode</h2>
      <input
        ref={inputRef}
        value={query}
        placeholder="Search card name or id…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) choose(results[0]);
          if (e.key === "Escape") inputRef.current?.blur();
        }}
      />
      {results.length > 0 && (
        <ul className="results">
          {results.map((c) => (
            <li key={c.printingId}>
              <button type="button" onClick={() => choose(c)}>
                <b>{c.printingId}</b> {c.name} <i>{c.variant}{c.pool === "nexus_night" ? " · NN" : ""}</i>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <div className="selected">
          <img src={selected.imageUrl} alt={selected.name} />
          <div>
            <b>{selected.printingId}</b>
            <div>{selected.name}</div>
            <div className="muted">
              {selected.variant} · {counts[selected.printingId] ?? 0} captured
            </div>
            <div className="hint">Hold it in the box · <kbd>Space</kbd> to save</div>
          </div>
        </div>
      ) : (
        <p className="muted">Pick the printing you're holding, then press Space.</p>
      )}
      {last && (
        <div className="last">
          <img src={last.url} alt="last capture" />
          <span>{last.file}</span>
        </div>
      )}
      {error && <p className="error-inline">{error}</p>}
      <p className="muted">
        <kbd>F</kbd> detector frame: freeze + click 4 corners · {frames.card} card / {frames.empty} empty frames · file with{" "}
        <code>python sort_detect.py</code>
      </p>
      {labeling && <FrameLabeler videoRef={videoRef} printingId={selected?.printingId ?? null} onDone={onLabeled} />}
      <p className="muted">
        {total} photos this session · {Object.keys(counts).length} printings · move downloads with{" "}
        <code>python sort_eval.py</code>
      </p>
    </aside>
  );
}
