// Star map ambient music — Hans Zimmer-level. Deep sub-bass drone, massive
// brass swells, a slow tectonic pulse. Hans will provide his own tracks later;
// this is the placeholder bed: overwhelming, low, endless.
//
// Built on game/audio/audio-core (shared context, cathedral reverb,
// compressor). Respects the game's global mute.

import { ac, out, reverbBus, tone, now } from "./audio-core";
import { sound } from "../sound";

let playing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let pulseTimer: ReturnType<typeof setInterval> | null = null;

// D minor epic: i – VI – III – VII, ~9s per chord, 36s loop
const PROGRESSION: number[][] = [
  [73.42, 146.83, 174.61, 220.0],   // Dm (root doubled down)
  [58.27, 116.54, 146.83, 174.61],  // Bb
  [65.41, 130.81, 164.81, 196.0],   // F
  [65.41, 130.81, 155.56, 196.0],   // C
];
const CHORD_MS = 9000;

/** Endless tectonic drone: D1/A1/D2 saws through a breathing lowpass. */
function startDrone(): void {
  const c = ac();
  const m = out();
  if (!c || !m) return;
  const t = c.currentTime;

  const droneBus = c.createGain();
  droneBus.gain.value = 0.16;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 160;
  lp.Q.value = 0.7;

  // slow breathing
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  const lfoG = c.createGain();
  lfoG.gain.value = 70;
  lfo.connect(lfoG);
  lfoG.connect(lp.frequency);
  lfo.start(t);

  for (const f of [36.71, 55.0, 73.42]) { // D1 A1 D2
    for (const det of [-5, 4]) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.detune.value = det;
      osc.connect(lp);
      osc.start(t);
    }
  }
  // pure sub sine for chest feel
  const sub = c.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 36.71;
  const subG = c.createGain();
  subG.gain.value = 0.5;
  sub.connect(subG);
  subG.connect(droneBus);
  sub.start(t);

  lp.connect(droneBus);
  droneBus.connect(m);
  const verb = reverbBus();
  if (verb) {
    const wg = c.createGain();
    wg.gain.value = 0.35;
    droneBus.connect(wg);
    wg.connect(verb);
  }
}

/** One massive brass swell: layered saws + sub root, slow attack, long tail. */
function swell(freqs: number[], when: number, dur: number): void {
  const c = ac();
  const m = out();
  if (!c || !m) return;
  const attack = 3.4;

  for (const f of freqs) {
    for (const det of [-6, 0, 6]) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.detune.value = det;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(320, when);
      lp.frequency.linearRampToValueAtTime(1900, when + attack);
      lp.frequency.linearRampToValueAtTime(420, when + dur);
      lp.Q.value = 1.0;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.035, when + attack);
      g.gain.setValueAtTime(0.035, when + dur - 2);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      osc.connect(lp);
      lp.connect(g);
      g.connect(m);
      const verb = reverbBus();
      if (verb) {
        const wg = c.createGain();
        wg.gain.value = 0.9;
        g.connect(wg);
        wg.connect(verb);
      }
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
  }

  // sub root under the chord — felt more than heard
  const root = c.createOscillator();
  root.type = "sine";
  root.frequency.value = freqs[0] / 2;
  const rg = c.createGain();
  rg.gain.setValueAtTime(0.0001, when);
  rg.gain.linearRampToValueAtTime(0.14, when + attack);
  rg.gain.linearRampToValueAtTime(0.0001, when + dur);
  root.connect(rg);
  rg.connect(m);
  root.start(when);
  root.stop(when + dur + 0.1);

  // distant high shimmer
  tone(freqs[2] * 4, { type: "sine", dur, gain: 0.008, delay: when - now(), wet: 0.9 });
}

/** Slow tectonic pulse — a deep heartbeat under everything (~50 BPM). */
function startPulse(): void {
  stopPulse();
  const beat = () => {
    if (!playing) return;
    tone(48, { type: "sine", dur: 0.5, gain: 0.22, slideTo: 34, wet: 0.35, lowpass: 200 });
    tone(48, { type: "sine", dur: 0.4, gain: 0.13, delay: 0.32, slideTo: 36, wet: 0.3, lowpass: 200 });
  };
  beat();
  pulseTimer = setInterval(beat, 1200);
}

function stopPulse(): void {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
}

function scheduleLoop(): void {
  const c = ac();
  const m = out();
  if (!c || !m) return;
  let idx = 0;
  // fade the bed in slowly
  m.gain.setTargetAtTime(0.85, c.currentTime, 4.0);
  const playChord = () => {
    if (!playing) return;
    const t = now() + 0.15;
    swell(PROGRESSION[idx % PROGRESSION.length], t, CHORD_MS / 1000 + 3.5);
    idx++;
  };
  playChord();
  timer = setInterval(playChord, CHORD_MS);
}

/** Begin the ambient bed. Safe to call repeatedly; no-ops if already playing. */
export function startMusic(): void {
  if (playing) return;
  if (sound.muted) return;
  if (!ac()) return;
  playing = true;
  startDrone();
  startPulse();
  scheduleLoop();
}

/** Stop the music bed. */
export function stopMusic(): void {
  playing = false;
  stopPulse();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const c = ac();
  const m = out();
  if (c && m) {
    m.gain.setTargetAtTime(0.0, c.currentTime, 0.5);
  }
}

export function isMusicPlaying(): boolean {
  return playing;
}

// Re-export for tree-shaken direct imports elsewhere.
export { sound };
