// Stage-level effects: shakes and zoom punches via the Web Animations API (replayable without
// toggling classes on the stage, which also holds the <video>), plus canvas-confetti bursts.
import confetti from "canvas-confetti";
import { CFG } from "../config";

export const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function shake(el: HTMLElement, px: number, ms: number, delay = 0): Animation {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 10; i++) {
    const k = i === 10 ? 0 : px * (1 - i / 10);
    frames.push({ transform: `translate(${(Math.random() * 2 - 1) * k}px, ${(Math.random() * 2 - 1) * k}px) rotate(${(Math.random() * 2 - 1) * k * 0.08}deg)` });
  }
  return el.animate(frames, { duration: ms, delay, easing: "linear" });
}

/** Snap in to `scale` (~90 ms), hold, ease back out over the last third. Uses the CSS `scale`
 *  property, not `transform`, so a mirrored video (transform: scaleX(-1)) stays mirrored. */
function zoomPunch(el: HTMLElement, scale: number, ms: number): Animation {
  const zoomed = { scale: String(scale) };
  return el.animate([{ scale: "1" }, { ...zoomed, offset: 90 / ms }, { ...zoomed, offset: 0.65 }, { scale: "1" }], {
    duration: ms,
    easing: "linear",
  });
}

/** Tier 5 "over-edited" punch-ins: three hard zooms in a row, a bit crooked. */
function punches(el: HTMLElement, delay: number): Animation {
  return el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.18) rotate(-2deg)", offset: 0.08 },
      { transform: "scale(1.05)", offset: 0.25 },
      { transform: "scale(1.3) rotate(3deg)", offset: 0.33 },
      { transform: "scale(1.08)", offset: 0.5 },
      { transform: "scale(1.45) rotate(-4deg)", offset: 0.58 },
      { transform: "scale(1)" },
    ],
    { duration: 1400, delay, easing: "ease-out" },
  );
}

const emoji = (text: string) => confetti.shapeFromText({ text, scalar: 3 });

/**
 * Run the stage part of a tier. Reduced motion: no shaking/zooming, no confetti.
 * Returns a cancel function (the next card's reaction stops this one's leftovers).
 */
export function stageFx(tier: number, stage: HTMLElement | null): () => void {
  const calm = reducedMotion();
  const anims: Animation[] = [];
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => void timers.push(window.setTimeout(fn, ms));
  const cancel = () => {
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    anims.forEach((a) => a.cancel());
  };
  const base = { disableForReducedMotion: true, zIndex: 60 };
  switch (tier) {
    case 0: // golf clap: nothing moves, that's the joke
    case 1: // crowd OOOH: the caption does the work
      break;
    case 2: {
      // The Rock's eyebrow: a hard zoom punch on the vine boom, held, then eased back. Only the camera
      // video zooms; zooming the stage would push the Rock and the caption off screen.
      const video = stage?.querySelector("video");
      if (video && !calm) anims.push(zoomPunch(video, 1.2, CFG.REACTION_MS[2]));
      break;
    }
    case 3: {
      // classic air horns: a jolt per blast + fire confetti
      if (stage && !calm) anims.push(shake(stage, 14, 260), shake(stage, 14, 260, 240), shake(stage, 20, 800, 480));
      const shapes = [emoji("🔥"), emoji("💯")];
      for (const [at, x] of [[0, 0.2], [240, 0.8], [480, 0.5]]) {
        later(at, () => {
          void confetti({ ...base, particleCount: 70, spread: 360, startVelocity: 38, origin: { x, y: 0.4 } });
          void confetti({ ...base, particleCount: 10, spread: 120, shapes, scalar: 2.4, origin: { x, y: 0.5 } });
        });
      }
      break;
    }
    case 4: {
      // soyjak air horns: jolts on the build-up horns, then the drop: punches, big shake, emoji storm
      const hit = CFG.EPIC_IMPACT_MS;
      if (stage && !calm) {
        for (const at of [0, 300, 550, 780, 980, 1150, 1300, 1420, 1530, 1620, 1700]) anims.push(shake(stage, 6, 120, at));
        anims.push(punches(stage, hit), shake(stage, 26, 1000, hit));
      }
      const shapes = ["😱", "🔥", "💯", "‼️", "🤯", "📈"].map(emoji);
      later(hit, () => {
        void confetti({ ...base, particleCount: 250, spread: 180, startVelocity: 60, origin: { y: 0.55 } });
        let n = 0;
        const storm = window.setInterval(() => {
          void confetti({ ...base, particleCount: 6, angle: 60, spread: 70, shapes, scalar: 2.6, origin: { x: 0, y: 0.7 } });
          void confetti({ ...base, particleCount: 6, angle: 120, spread: 70, shapes, scalar: 2.6, origin: { x: 1, y: 0.7 } });
          if (++n > 30) clearInterval(storm);
        }, 110);
        timers.push(storm);
      });
      break;
    }
  }
  return cancel;
}
