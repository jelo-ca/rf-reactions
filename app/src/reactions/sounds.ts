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

// ---- tiers (reworked by the owner 2026-09-28) ----

let room: AudioBuffer | null = null;

/** A small room: stereo decaying noise impulse (generated, no files) for crowds and the slow-mo voice. */
function reverb(c: AudioContext, seconds: number, wet: number, out: AudioNode): AudioNode {
  if (!room || room.sampleRate !== c.sampleRate) {
    const n = Math.floor(c.sampleRate * 2.5);
    room = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = room.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
  }
  const input = c.createGain();
  const conv = c.createConvolver();
  conv.buffer = room;
  const wetG = c.createGain();
  wetG.gain.value = wet;
  const tail = c.createGain(); // shorten the room by fading the wet tail
  tail.gain.setValueAtTime(1, c.currentTime + seconds);
  tail.gain.linearRampToValueAtTime(0, c.currentTime + seconds + 1.5);
  input.connect(out);
  input.connect(conv).connect(wetG).connect(tail).connect(out);
  return input;
}

/** One hand clap: two quick noise transients through a palm-sized resonance. */
function clap(c: AudioContext, out: AudioNode, t: number, vol: number, tone: number) {
  for (const flam of [0, 0.004 + Math.random() * 0.006]) {
    noiseSrc(c, t + flam, 0.09)
      .connect(filter(c, "bandpass", tone, 0.9))
      .connect(filter(c, "highpass", 500))
      .connect(env(c, t + flam, vol * (flam ? 0.6 : 1), 0.0015, 0.003, 0.05 + Math.random() * 0.03))
      .connect(out);
  }
}

/** Tier 0 — golf clap: 5 spectators, polite, unhurried, slightly out of sync, fading after ~2 s. */
const golfClap: Synth = (c, out, t0) => {
  const bus = reverb(c, 1.2, 0.35, out);
  for (let p = 0; p < 5; p++) {
    const rate = 0.34 + Math.random() * 0.12; // seconds between claps: polite, not enthusiastic
    const tone = 1100 + Math.random() * 1300; // each person's hands sound different
    const vol = 0.22 + Math.random() * 0.14;
    const start = Math.random() * 0.25;
    const n = 4 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const t = t0 + start + k * rate + (Math.random() - 0.5) * 0.05;
      clap(c, bus, t, vol * (1 - k / (n + 1)), tone); // each person tails off
    }
  }
};

/**
 * Tier 1 — crowd "OOOOOH": ~18 voices (low and high), staggered, each with its own vibrato,
 * gliding up then settling, through "oo"→"oh" formants, plus breath, in a room.
 */
const crowdOoh: Synth = (c, out, t0) => {
  const bus = reverb(c, 2.0, 0.5, out);
  const mix = env(c, t0, 0.42, 0.35, 0.9, 0.9);
  // Formants for "oo" (F1 ~320, F2 ~800) opening toward "oh" (F1 ~450, F2 ~850).
  const f1 = filter(c, "bandpass", 320, 5);
  f1.frequency.linearRampToValueAtTime(450, t0 + 0.8);
  const f2 = filter(c, "bandpass", 800, 6);
  f2.frequency.linearRampToValueAtTime(870, t0 + 0.8);
  const f3 = filter(c, "bandpass", 2500, 8);
  const f3g = c.createGain();
  f3g.gain.value = 0.25;
  f1.connect(mix);
  f2.connect(mix);
  f3.connect(f3g).connect(mix);
  mix.connect(bus);
  for (let v = 0; v < 18; v++) {
    const low = v % 2 === 0;
    const base = low ? 95 + Math.random() * 55 : 190 + Math.random() * 80;
    const t = t0 + Math.random() * 0.18; // people react at slightly different times
    const o = osc(c, "sawtooth", base, t, 2.3);
    o.frequency.exponentialRampToValueAtTime(base * (1.18 + Math.random() * 0.1), t + 0.7); // oooOO
    o.frequency.exponentialRampToValueAtTime(base * (1.02 + Math.random() * 0.05), t + 1.9); // ...oh
    wobble(c, o.frequency, "sine", 4.5 + Math.random() * 2, base * 0.012, t, 2.3);
    const g = c.createGain();
    g.gain.value = 0.35 + Math.random() * 0.3;
    o.connect(g);
    g.connect(f1);
    g.connect(f2);
    g.connect(f3);
  }
  noiseSrc(c, t0, 2.2).connect(filter(c, "bandpass", 700, 1.2)).connect(env(c, t0, 0.05, 0.3, 0.9, 0.8)).connect(bus);
};

/**
 * Tier 2 — "wow" mogging slow-mo replay: a deep boom, then a slowed-down, pitched-down "woooow"
 * (a vowel glide u → a → u) drenched in reverb, over slow heartbeat thumps.
 */
const slowMoWow: Synth = (c, out, t0) => {
  const bus = reverb(c, 3.0, 0.8, out);
  // boom + rewind-ish swell
  const boom = osc(c, "sine", 70, t0, 1.4);
  boom.frequency.exponentialRampToValueAtTime(34, t0 + 1.0);
  boom.connect(env(c, t0, 0.8, 0.005, 0.15, 1.1)).connect(bus);
  // slowed "wooooow": low voice, formants sweep u(300/870) → a(700/1150) → u
  const t = t0 + 0.35;
  const v = osc(c, "sawtooth", 82, t, 2.8);
  v.frequency.linearRampToValueAtTime(96, t + 1.0);
  v.frequency.linearRampToValueAtTime(70, t + 2.6);
  wobble(c, v.frequency, "sine", 3, 1.5, t, 2.8);
  const a = filter(c, "bandpass", 300, 6);
  a.frequency.linearRampToValueAtTime(700, t + 0.9);
  a.frequency.linearRampToValueAtTime(320, t + 2.4);
  const b = filter(c, "bandpass", 870, 7);
  b.frequency.linearRampToValueAtTime(1150, t + 0.9);
  b.frequency.linearRampToValueAtTime(900, t + 2.4);
  const voice = env(c, t, 0.9, 0.25, 1.6, 0.9);
  v.connect(a).connect(voice);
  v.connect(b).connect(voice);
  voice.connect(bus);
  // slow heartbeat underneath (lub-dub)
  for (const beat of [0.2, 1.3, 2.4, 3.5]) {
    for (const [dt, vol] of [[0, 0.5], [0.16, 0.35]] as const) {
      const bt = t0 + beat + dt;
      const h = osc(c, "sine", 55, bt, 0.25);
      h.frequency.exponentialRampToValueAtTime(38, bt + 0.2);
      h.connect(env(c, bt, vol, 0.01, 0.03, 0.18)).connect(out);
    }
  }
};

/** One classic air horn blast: detuned stacked saws, overdriven, with the pitch sagging at the end. */
function horn(c: AudioContext, out: AudioNode, t: number, dur: number, vol = 0.45) {
  const chain = distortion(c, 20);
  chain.connect(filter(c, "lowpass", 3200)).connect(env(c, t, vol, 0.012, dur, 0.07)).connect(out);
  for (const f of [415, 421, 622, 830]) {
    const o = osc(c, "sawtooth", f, t, dur + 0.1);
    o.frequency.setValueAtTime(f, t + dur * 0.7);
    o.frequency.linearRampToValueAtTime(f * 0.94, t + dur + 0.05); // horn running out of air
    o.connect(chain);
  }
}

/** Tier 3 — classic air horns: BWAA BWAA BWAAAAAA. */
const airHorn: Synth = (c, out, t0) => {
  for (const [at, dur] of [[0, 0.17], [0.24, 0.17], [0.48, 0.95]]) horn(c, out, t0 + at, dur);
};

/**
 * Tier 4 — soyjak air horns: a longer horn remix building up to EPIC_IMPACT_MS, then a bass-boosted
 * drop, a horn barrage and a rising siren, all louder and dumber.
 */
const soyHorns: Synth = (c, out, t0) => {
  const hit = t0 + CFG.EPIC_IMPACT_MS / 1000;
  // build-up: horn rhythm getting faster
  const pattern = [0, 0.3, 0.55, 0.78, 0.98, 1.15, 1.3, 1.42, 1.53, 1.62, 1.7];
  pattern.forEach((at, i) => horn(c, out, t0 + at, i < 3 ? 0.18 : 0.07, 0.35 + i * 0.01));
  // riser into the drop
  const r = osc(c, "sawtooth", 200, t0 + 0.6, hit - t0 - 0.6);
  r.frequency.exponentialRampToValueAtTime(1600, hit);
  r.connect(filter(c, "lowpass", 2500)).connect(env(c, t0 + 0.6, 0.12, hit - t0 - 0.65, 0.01, 0.03)).connect(out);
  // the drop: distorted sub thump + crack
  const boom = osc(c, "sine", 95, hit, 1.6);
  boom.frequency.exponentialRampToValueAtTime(30, hit + 0.9);
  boom.connect(distortion(c, 60)).connect(filter(c, "lowpass", 600)).connect(env(c, hit, 0.95, 0.005, 0.3, 1.2)).connect(out);
  noiseSrc(c, hit, 0.6).connect(filter(c, "lowpass", 2500)).connect(env(c, hit, 0.55, 0.003, 0.02, 0.4)).connect(out);
  // after the drop: horn barrage in a stupid rhythm + a wailing siren
  for (const [at, dur] of [[0.25, 0.14], [0.45, 0.14], [0.65, 0.5], [1.35, 0.14], [1.55, 0.14], [1.75, 1.1]]) {
    horn(c, out, hit + at, dur, 0.42);
  }
  const siren = osc(c, "square", 700, hit + 0.2, 2.8);
  wobble(c, siren.frequency, "sine", 1.6, 220, hit + 0.2, 2.8);
  siren.connect(filter(c, "lowpass", 1800)).connect(env(c, hit + 0.2, 0.06, 0.3, 2.0, 0.4)).connect(out);
};

const SYNTHS: Synth[] = [golfClap, crowdOoh, slowMoWow, airHorn, soyHorns];
