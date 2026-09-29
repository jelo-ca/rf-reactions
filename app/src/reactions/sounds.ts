// Reaction sounds (PLAN.md §8.2): real recordings in public/memes/ (credits in public/memes/CREDITS.md),
// trimmed to their first sound and faded out. Only the soyjak tier's bass drop is still synthesized.
// tiers.json `sounds` can point a tier at a different file.
import { CFG } from "../config";
import { firstSoundIndex } from "./helpers";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let current: GainNode | null = null; // bus of the sound playing now (faded out when the next starts)
let noise: AudioBuffer | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

const MEME = {
  golfClap: "/memes/golf-clap.mp3",
  crowdOoh: "/memes/crowd-ooh.mp3",
  crowdWow: "/memes/crowd-wow.mp3",
  airHorn: "/memes/mlg-airhorn.mp3",
};

/** Create/resume the AudioContext and preload the clips. Call from a user gesture (browser autoplay rules). */
export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(); // keeps stacked horns from clipping
    master = ctx.createGain();
    master.gain.value = CFG.REACTION_VOLUME;
    master.connect(comp).connect(ctx.destination);
    for (const url of Object.values(MEME)) void load(ctx, url);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Play a tier's sound; an override URL (tiers.json) wins, falling back to the tier's own clip if it fails. */
export async function playTier(tier: number, overrideUrl?: string): Promise<void> {
  if (!ctx || !master) return;
  const c = ctx;
  if (current) {
    const old = current;
    old.gain.setTargetAtTime(0, c.currentTime, 0.03);
    setTimeout(() => old.disconnect(), 300);
  }
  const bus = c.createGain();
  bus.connect(master);
  current = bus;

  const file = overrideUrl ? await load(c, overrideUrl) : null;
  if (file) {
    clip(c, bus, file, c.currentTime + 0.02);
    return;
  }
  await TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))](c, bus);
}

function load(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => c.decodeAudioData(b))
      .catch((e: unknown) => {
        console.warn(`[reactions] sound ${url} failed to load:`, e);
        return null;
      });
    buffers.set(url, p);
  }
  return p;
}

/**
 * Play `buf` at `t` from its first audible sample (+ `skip` s), for at most `dur` s, then fade out
 * over `fade` s. `rate` < 1 slows it down (and lowers the pitch).
 */
function clip(
  c: AudioContext,
  out: AudioNode,
  buf: AudioBuffer,
  t: number,
  { dur = buf.duration, fade = 0.25, gain = 1, rate = 1, skip = 0 } = {},
) {
  const offset = Math.min(buf.duration, firstSoundIndex(buf.getChannelData(0)) / buf.sampleRate + skip);
  const len = Math.min(dur, (buf.duration - offset) / rate);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.setValueAtTime(gain, t + Math.max(0, len - fade));
  g.gain.linearRampToValueAtTime(0, t + len);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(g).connect(out);
  src.start(t, offset);
  src.stop(t + len + 0.05);
}

type Tier = (c: AudioContext, out: AudioNode) => Promise<void>;

/** A tier that plays one clip (skipped with a warning if the file is missing). */
const single =
  (url: string, opts?: Parameters<typeof clip>[4]): Tier =>
  async (c, out) => {
    const buf = await load(c, url);
    if (buf) clip(c, out, buf, c.currentTime + 0.02, opts);
  };

// ---- synth building blocks (the soyjak drop only) ----

function noiseSrc(c: AudioContext, t0: number, dur: number): AudioBufferSourceNode {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  s.start(t0, Math.random() * 2);
  s.stop(t0 + dur);
  return s;
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  return f;
}

/** Gain with attack → hold → exponential release. */
function env(c: AudioContext, t0: number, peak: number, attack: number, hold: number, release: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  return g;
}

function distortion(c: AudioContext, amount: number): WaveShaperNode {
  const w = c.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  w.curve = curve;
  return w;
}

// ---- tiers ----

/**
 * Tier 4 — soyjak air horns: MLG horn stabs getting faster up to EPIC_IMPACT_MS, a bass-boosted
 * drop, then the full horn twice, the second one slowed down.
 */
const soyHorns: Tier = async (c, out) => {
  const horn = await load(c, MEME.airHorn);
  const t0 = c.currentTime + 0.02;
  const hit = t0 + CFG.EPIC_IMPACT_MS / 1000;
  if (horn) {
    const pattern = [0, 0.3, 0.55, 0.78, 0.98, 1.15, 1.3, 1.42, 1.53, 1.62, 1.7];
    pattern.forEach((at, i) => clip(c, out, horn, t0 + at, { dur: i < 3 ? 0.2 : 0.08, fade: 0.03, gain: 0.7 }));
    clip(c, out, horn, hit + 0.15, { gain: 0.9 });
    clip(c, out, horn, hit + 0.15 + horn.duration * 0.9, { gain: 0.9, rate: 0.8 });
  }
  // the drop: distorted sub thump + crack
  const boom = c.createOscillator();
  boom.frequency.setValueAtTime(95, hit);
  boom.frequency.exponentialRampToValueAtTime(30, hit + 0.9);
  boom.start(hit);
  boom.stop(hit + 1.6);
  boom.connect(distortion(c, 60)).connect(filter(c, "lowpass", 600)).connect(env(c, hit, 0.95, 0.005, 0.3, 1.2)).connect(out);
  noiseSrc(c, hit, 0.6).connect(filter(c, "lowpass", 2500)).connect(env(c, hit, 0.55, 0.003, 0.02, 0.4)).connect(out);
};

const TIERS: Tier[] = [
  single(MEME.golfClap, { dur: CFG.REACTION_MS[0] / 1000, fade: 0.8 }), // 0 — a few people, clearly unimpressed
  single(MEME.crowdOoh), // 1 — crowd "OOOOH"
  single(MEME.crowdWow), // 2 — crowd "wooow" for the mogging replay
  single(MEME.airHorn), // 3 — the MLG air horn
  soyHorns, // 4
];
