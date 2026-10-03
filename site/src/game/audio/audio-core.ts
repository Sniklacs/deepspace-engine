// Shared Web Audio core for the star map — DOLBY-level low end.
// One AudioContext, one master chain: sources → master gain → compressor →
// destination, with a generated cathedral impulse convolver on a send bus.
//
// Browser autoplay rule: the context is only created/resumed on the first
// user gesture. Respects the game's global mute (game/sound.ts).

import { sound } from "../sound";

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let verb: ConvolverNode | null = null;
let wetGain: GainNode | null = null;

/** Cathedral-like impulse response, generated — no audio files. */
function makeImpulse(c: Ctx, seconds = 4.2, decay = 2.6): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // slightly lowpassed noise: average with previous for warmth
      const n = Math.random() * 2 - 1;
      const prev = i > 0 ? d[i - 1] : 0;
      d[i] = (n * 0.6 + prev * 0.4) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function ensure(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (sound.muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    // master → compressor → destination (glues the big low end, prevents clipping)
    master = ctx.createGain();
    master.gain.value = 0.9;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    master.connect(comp);
    comp.connect(ctx.destination);

    // cathedral send
    verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx);
    wetGain = ctx.createGain();
    wetGain.gain.value = 0.5;
    verb.connect(wetGain);
    wetGain.connect(master);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** The raw context (null when muted/unavailable). */
export function ac(): Ctx | null {
  return ensure();
}

/** Dry master bus — connect sources here. */
export function out(): GainNode | null {
  ensure();
  return master;
}

/** Wet reverb send — connect a source here too for spaciousness. */
export function reverbBus(): ConvolverNode | null {
  ensure();
  return verb;
}

export function now(): number {
  const c = ensure();
  return c ? c.currentTime : 0;
}

export interface ToneOpts {
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
  slideTo?: number;
  /** 0..1 — how much of this tone goes to the cathedral reverb */
  wet?: number;
  /** frequency for a lowpass filter on this tone */
  lowpass?: number;
}

/** Enveloped oscillator with optional pitch sweep, filter, and reverb send. */
export function tone(freq: number, opts: ToneOpts = {}): void {
  const c = ensure();
  const m = master;
  if (!c || !m) return;
  const {
    type = "sine", dur = 0.08, gain = 0.1, delay = 0,
    slideTo, wet = 0, lowpass,
  } = opts;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);

  let head: AudioNode = osc;
  if (lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    osc.connect(lp);
    head = lp;
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  head.connect(g);
  g.connect(m);
  if (wet > 0 && verb) {
    const wg = c.createGain();
    wg.gain.value = wet;
    g.connect(wg);
    wg.connect(verb);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export interface NoiseOpts {
  dur?: number;
  gain?: number;
  delay?: number;
  /** filter type + frequency for shaping */
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterQ?: number;
  /** sweep the filter frequency */
  sweepTo?: number;
  wet?: number;
}

/** Shaped noise burst with envelope, filter, and reverb send. */
export function noiseBurst(opts: NoiseOpts = {}): void {
  const c = ensure();
  const m = master;
  if (!c || !m) return;
  const {
    dur = 0.1, gain = 0.1, delay = 0,
    filterType = "highpass", filterFreq = 1500, filterQ = 0.8,
    sweepTo, wet = 0,
  } = opts;
  const t = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = filterType;
  flt.frequency.setValueAtTime(filterFreq, t);
  flt.Q.value = filterQ;
  if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(m);
  if (wet > 0 && verb) {
    const wg = c.createGain();
    wg.gain.value = wet;
    g.connect(wg);
    wg.connect(verb);
  }
  src.start(t);
}

export interface DropOpts {
  /** start frequency (Hz) */
  from?: number;
  /** end frequency (Hz) */
  to?: number;
  dur?: number;
  gain?: number;
  delay?: number;
  wet?: number;
}

/**
 * Sub-bass drop — the speaker-rattler. A sine sweeping 60→30Hz with a
 * waveshaped harmonic layer so it's felt on small speakers too, plus a
 * touch of cathedral.
 */
export function subDrop(opts: DropOpts = {}): void {
  const c = ensure();
  const m = master;
  if (!c || !m) return;
  const { from = 62, to = 30, dur = 1.4, gain = 0.55, delay = 0, wet = 0.25 } = opts;
  const t = c.currentTime + delay;

  // pure sub sine
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(m);

  // harmonic layer (2x) through gentle saturation so phones feel it too
  const osc2 = c.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(from * 2, t);
  osc2.frequency.exponentialRampToValueAtTime(to * 2, t + dur);
  const shaper = c.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  shaper.curve = curve;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.03);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
  osc2.connect(shaper);
  shaper.connect(g2);
  g2.connect(m);

  if (wet > 0 && verb) {
    const wg = c.createGain();
    wg.gain.value = wet;
    g.connect(wg);
    wg.connect(verb);
  }

  osc.start(t);
  osc.stop(t + dur + 0.05);
  osc2.start(t);
  osc2.stop(t + dur + 0.05);
}

/** Deep impact boom — sub drop + lowpassed noise thump + reverb tail. */
export function boom(delay = 0, size = 1): void {
  subDrop({ from: 58, to: 28, dur: 1.6 * size, gain: 0.6 * size, delay, wet: 0.35 });
  noiseBurst({
    dur: 0.5 * size, gain: 0.22 * size, delay,
    filterType: "lowpass", filterFreq: 320, filterQ: 0.6,
    sweepTo: 70, wet: 0.5,
  });
  // metallic shimmer tail
  tone(1244, { type: "sine", dur: 1.8, gain: 0.03, delay: delay + 0.05, wet: 0.8 });
  tone(1866, { type: "sine", dur: 2.2, gain: 0.02, delay: delay + 0.12, wet: 0.8 });
}
