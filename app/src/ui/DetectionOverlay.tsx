// Debug (D): the detected card outline + score over the video (PLAN.md §5.7).
import { type StageTransform, videoPointToStage } from "../camera/guideBox";
import type { DetectionStats } from "../stability/useStability";

interface Props {
  detection: DetectionStats;
  xf: StageTransform | null;
  mirrored: boolean;
}

export function DetectionOverlay({ detection, xf, mirrored }: Props) {
  if (!detection.enabled || !xf) return null;
  const { quad, present, ms, source, moving } = detection;
  const label = `card ${present === null ? "—" : present.toFixed(2)}${ms === null ? "" : ` · ${ms.toFixed(0)} ms`}${moving ? " · moving" : ""}`;
  if (!quad) {
    return (
      <div className="detect-none" aria-hidden="true">
        no card found{present === null ? "" : ` (p=${present.toFixed(2)})`} → guide box
      </div>
    );
  }
  const pts = quad.map((p) => videoPointToStage(p, xf, mirrored));
  // Label above the corner that is highest on screen.
  const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  return (
    <svg className={`detect-overlay ${source}`} aria-hidden="true">
      <polygon points={pts.map((p) => p.join(",")).join(" ")} />
      <circle cx={pts[0][0]} cy={pts[0][1]} r={5} />
      <text x={top[0]} y={top[1] - 10}>{label}</text>
    </svg>
  );
}
