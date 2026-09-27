// Synthesized reaction sounds (PLAN.md §8.2): Web Audio oscillators, noise and gain envelopes only.
// No meme audio is bundled; tiers.json `sounds` can point a tier at a licensed file in public/sounds/.
import { CFG } from "../config";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let current: GainNode | null = null; // bus of the sound playing now (faded out when the next starts)
let noise: AudioBuffer | null = null;
const overrides = new Map<string, Promise<AudioBuffer | null>>();

/** Create/resume the AudioContext. Call from a user gesture (browser autoplay rules). */
export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(); // keeps stacked voices (air horn, choir) from clipping
    master = ctx.createGain();
    master.gain.value = CFG.REACTION_VOLUME;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Play a tier's sound; an override URL (tiers.json) wins, falling back to the synth if it fails. */
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

  const file = overrideUrl ? await loadOverride(c, overrideUrl) : null;
  const t0 = c.currentTime + 0.02;
  if (file) {
    const src = c.createBufferSource();
    src.buffer = file;
    src.connect(bus);
    src.start(t0);
    return;
  }
  SYNTHS[Math.max(0, Math.min(SYNTHS.length - 1, tier))](c, bus, t0);
}

function loadOverride(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = overrides.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => c.decodeAudioData(b))
      .catch((e: unknown) => {
        console.warn(`[reactions] sound override ${url} failed, using the synth:`, e);
        return null;
      });
    overrides.set(url, p);
  }
  return p;
}

type Synth = (c: AudioContext, out: AudioNode, t0: number) => void;

// ---- building blocks ----

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function noiseSrc(c: AudioContext, t0: number, dur: number): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  s.loop = true;
  s.start(t0, Math.random() * 2);
  s.stop(t0 + dur);
  return s;
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
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

function osc(c: AudioContext, type: OscillatorType, freq: number, t0: number, dur: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t0 + dur);
  return o;
}

/** Frequency modulation: `lfo` wobbles `target` by ±depth Hz. */
function wobble(c: AudioContext, target: AudioParam, type: OscillatorType, rate: number, depth: number, t0: number, dur: number) {
  const g = c.createGain();
  g.gain.value = depth;
  osc(c, type, rate, t0, dur).connect(g).connect(target);
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

/** Tier 0 — golf clap: three slow, polite, fading claps. */
const golfClap: Synth = (c, out, t0) => {
  [0, 0.62, 1.24].forEach((at, i) => {
    const vol = 0.55 - i * 0.12;
    for (const flam of [0, 0.009, 0.02]) {
      // one clap = a few transients a few ms apart
      const t = t0 + at + flam;
      noiseSrc(c, t, 0.12)
        .connect(filter(c, "bandpass", 1400, 1.1))
        .connect(filter(c, "highpass", 700))
        .connect(env(c, t, vol, 0.002, 0.004, 0.07))
        .connect(out);
    }
  });
};

/** Tier 1 — participation trophy: kazoo "doo-doot". */
const kazoo: Synth = (c, out, t0) => {
  const notes: [number, number, number][] = [[0, 0.16, 349.2], [0.2, 0.34, 440]];
  for (const [at, dur, f] of notes) {
    const t = t0 + at;
    const o = osc(c, "sawtooth", f, t, dur + 0.1);
    wobble(c, o.frequency, "sine", 7, 9, t, dur + 0.1);
    o.connect(distortion(c, 8))
      .connect(filter(c, "bandpass", 1300, 2.5))
      .connect(env(c, t, 0.5, 0.02, dur - 0.06, 0.06))
      .connect(out);
  }
};

/** Tier 2 — sitcom studio audience "OHHHH": detuned voices gliding up through "oh" formants. */
const sitcomOh: Synth = (c, out, t0) => {
  const bus = env(c, t0, 0.35, 0.25, 0.7, 0.7);
  const f1 = filter(c, "bandpass", 480, 4);
  const f2 = filter(c, "bandpass", 820, 5);
  f1.connect(bus);
  f2.connect(bus);
  bus.connect(out);
  for (let i = 0; i < 10; i++) {
    const base = 140 + Math.random() * 150;
    const o = osc(c, "sawtooth", base, t0, 1.8);
    o.frequency.exponentialRampToValueAtTime(base * 1.22, t0 + 0.9);
    o.frequency.exponentialRampToValueAtTime(base * 1.1, t0 + 1.6);
    o.connect(f1);
    o.connect(f2);
  }
  noiseSrc(c, t0, 1.8).connect(filter(c, "lowpass", 1100)).connect(env(c, t0, 0.08, 0.3, 0.6, 0.7)).connect(out);
};

/** Tier 3 — instant replay: ref whistle "tweet-tweeeet" + stadium roar. */
const stadium: Synth = (c, out, t0) => {
  for (const [at, dur] of [[0, 0.12], [0.18, 0.45]]) {
    const t = t0 + at;
    const o = osc(c, "sine", 2900, t, dur + 0.05);
    wobble(c, o.frequency, "square", 28, 180, t, dur + 0.05);
    o.connect(env(c, t, 0.22, 0.01, dur - 0.03, 0.04)).connect(out);
  }
  const t = t0 + 0.35;
  noiseSrc(c, t, 2.6)
    .connect(filter(c, "lowpass", 900))
    .connect(filter(c, "peaking", 400, 0.8))
    .connect(env(c, t, 0.6, 0.5, 0.8, 1.1))
    .connect(out);
};

/** Tier 4 — air horn x3 (short, short, looong). */
const airHorn: Synth = (c, out, t0) => {
  for (const [at, dur] of [[0, 0.17], [0.24, 0.17], [0.48, 0.95]]) {
    const t = t0 + at;
    const chain = distortion(c, 20);
    chain.connect(filter(c, "lowpass", 3200)).connect(env(c, t, 0.45, 0.012, dur, 0.06)).connect(out);
    for (const f of [415, 421, 622, 830]) osc(c, "sawtooth", f, t, dur + 0.1).connect(chain);
  }
};

/** Tier 5 — over-edited epic: riser → bass-boosted impact → choir pad. */
const epic: Synth = (c, out, t0) => {
  const hit = t0 + CFG.EPIC_IMPACT_MS / 1000;
  // riser: noise sweeping up + a sine sliding up ~3 octaves
  const bp = filter(c, "bandpass", 300, 2);
  bp.frequency.exponentialRampToValueAtTime(7000, hit);
  const rise = c.createGain();
  rise.gain.setValueAtTime(0.0001, t0);
  rise.gain.exponentialRampToValueAtTime(0.5, hit - 0.02);
  rise.gain.linearRampToValueAtTime(0, hit);
  noiseSrc(c, t0, hit - t0).connect(bp).connect(rise).connect(out);
  const s = osc(c, "sine", 110, t0, hit - t0);
  s.frequency.exponentialRampToValueAtTime(1100, hit);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t0);
  sg.gain.exponentialRampToValueAtTime(0.18, hit - 0.02);
  sg.gain.linearRampToValueAtTime(0, hit);
  s.connect(sg).connect(out);
  // impact: pitched-down sine thump through heavy distortion ("bass boosted") + a noise crack
  const boom = osc(c, "sine", 95, hit, 1.6);
  boom.frequency.exponentialRampToValueAtTime(32, hit + 0.8);
  boom.connect(distortion(c, 60))
    .connect(filter(c, "lowpass", 600))
    .connect(env(c, hit, 0.9, 0.005, 0.25, 1.2))
    .connect(out);
  noiseSrc(c, hit, 0.8).connect(filter(c, "lowpass", 2500)).connect(env(c, hit, 0.6, 0.003, 0.02, 0.5)).connect(out);
  // choir-ish pad: A minor add9, detuned saw pairs, slow attack
  const lp = filter(c, "lowpass", 1500, 0.7);
  lp.connect(env(c, hit + 0.05, 0.16, 0.5, 2.6, 1.6)).connect(out);
  for (const f of [110, 220, 261.6, 329.6, 493.9]) {
    for (const d of [-6, 6]) {
      const o = osc(c, "sawtooth", f, hit, 5);
      o.detune.value = d;
      o.connect(lp);
    }
  }
};

const SYNTHS: Synth[] = [golfClap, kazoo, sitcomOh, stadium, airHorn, epic];
