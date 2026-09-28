// Detector data tool (PLAN.md §5.7), opened with F in capture mode: freezes the full raw frame,
// click the card's 4 corners (TL, TR, BR, BL as the card reads) or press 0 for "no card".
// Saves `frame__<printing|none>__<ts>.png` + `.json`; pipeline/sort_detect.py files them.
import { type RefObject, useCallback, useEffect, useState } from "react";
import { bitmapToPngBlob } from "../camera/crop";
import {
  clickToFrame, cornerProblem, frameFileStem, frameToDisplay, makeLabel, type Point,
} from "../camera/frameLabel";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  printingId: string | null;
  onDone: (saved: "card" | "empty" | null) => void;
}

const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FrameLabeler({ videoRef, printingId, onDone }: Props) {
  const [frame, setFrame] = useState<{ png: Blob; url: string; w: number; h: number } | null>(null);
  const [pts, setPts] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null); // displayed image rect, for drawing the dots

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      onDone(null);
      return;
    }
    let url = "";
    createImageBitmap(video) // raw, unmirrored frame at full resolution
      .then(async (bmp) => {
        const png = await bitmapToPngBlob(bmp);
        url = URL.createObjectURL(png);
        setFrame({ png, url, w: bmp.width, h: bmp.height });
        bmp.close();
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoRef, onDone]);

  useEffect(() => {
    if (!img) return;
    const update = () => setBox(img.getBoundingClientRect());
    const ro = new ResizeObserver(update);
    ro.observe(img);
    update();
    return () => ro.disconnect();
  }, [img]);

  const save = useCallback(
    (corners: Point[] | null) => {
      if (!frame) return;
      const stem = frameFileStem(corners ? printingId : null);
      const label = makeLabel(corners, frame.w, frame.h, corners ? printingId : null);
      download(frame.png, `${stem}.png`);
      download(new Blob([JSON.stringify(label, null, 1)], { type: "application/json" }), `${stem}.json`);
      onDone(corners ? "card" : "empty");
    },
    [frame, printingId, onDone],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone(null);
      else if (e.key === "Backspace") setPts((p) => p.slice(0, -1));
      else if (e.key === "0") save(null);
      else if (e.key === "Enter" && pts.length === 4) {
        const problem = cornerProblem(pts);
        if (problem) setError(problem);
        else save(pts);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pts, save, onDone]);

  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!frame || pts.length >= 4) return;
    const p = clickToFrame(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), frame.w, frame.h);
    const next = [...pts, p];
    setPts(next);
    setError(next.length === 4 ? cornerProblem(next) : null);
  };

  const shown = box && frame ? pts.map((p) => frameToDisplay(p, box, frame.w, frame.h)) : [];

  return (
    <div className="labeler" role="dialog" aria-label="Label card corners">
      {frame && <img ref={setImg} src={frame.url} alt="frozen frame" onClick={onClick} draggable={false} />}
      {box && (
        <svg className="labeler-marks" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          {shown.length > 1 && (
            <polygon points={shown.map((p) => p.join(",")).join(" ")} className={shown.length === 4 ? "closed" : ""} />
          )}
          {shown.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={6} />
              <text x={x + 9} y={y - 9}>{i + 1}</text>
            </g>
          ))}
        </svg>
      )}
      <div className="labeler-help">
        {pts.length < 4 ? (
          <>Click the card's <b>{CORNER_NAMES[pts.length]}</b> corner ({pts.length + 1}/4)</>
        ) : (
          <><kbd>Enter</kbd> save</>
        )}
        {" · "}<kbd>0</kbd> no card (empty scene) · <kbd>Backspace</kbd> undo · <kbd>Esc</kbd> cancel
        {printingId ? <> · card: <b>{printingId}</b></> : <> · no printing picked</>}
        {error && <div className="error-inline">{error}</div>}
      </div>
    </div>
  );
}
