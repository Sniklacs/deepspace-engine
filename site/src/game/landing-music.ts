// "Last light" — the landing-page music for The Unbound.
//
// Owner direction 2026-10-01: he made a reference track ("Pulse & R" — an
// upbeat pop song about chasing the last light of summer, built on MyTunes)
// and said THAT is what "upbeat" means: bright summer pop energy on the
// landing screen. He can't download the file, so this is the same idea
// rebuilt as synthesis: a 122 BPM I–V–vi–IV summer-pop loop (C–G–Am–F),
// four on the floor, driving bass, bright stabs, and a singable hook.
//
// Entirely WebAudio-synthesized — zero asset bytes, so the downloadable app
// stays lean. Phone-speaker lesson applied throughout: the energy lives in
// the midrange (lead ~500–1500 Hz, octave-up bass harmonic), not the sub.
//
// Autoplay: the context is created on the first user gesture (the landing
// page calls startLandingMusic() from its first-tap handler). This module is
// landing-only — the game page never imports it.

const BPM = 122;
const STEP = 60 / BPM / 4; // 16th note, ~0.123s
const BARS = 8;
const STEPS = BARS * 16;

// ---- note table ----
const SEMI: Record<string, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};
function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) return 440;
  const midi = SEMI[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---- the song: C – G – Am – F, one chord per bar ----
const CHORDS: string[][] = [
  ["C4", "E4", "G4"], // C
  ["G3", "B3", "D4"], // G
  ["A3", "C4", "E4"], // Am
  ["F3", "A3", "C4"], // F
];
const STAB_VOICE: string[][] = [
  ["E4", "G4", "C5"],
  ["D4", "G4", "B4"],
  ["E4", "A4", "C5"],
  ["C4", "F4", "A4"],
];
const BASS_ROOT = ["C3", "G2", "A2", "F2"];

// Chorus hook — singable, C-major pentatonic-ish. [note, startStep, lenSteps]
const HOOK: Array<[string, number, number]> = [
  ["E5", 64, 2], ["G5", 66, 2], ["A5", 68, 2], ["G5", 70, 2], ["E5", 72, 4], ["D5", 76, 2], ["C5", 78, 2],
  ["D5", 80, 4], ["B4", 84, 2], ["D5", 86, 2], ["G5", 88, 4], ["A5", 92, 2], ["G5", 94, 2],
  ["A5", 96, 4], ["G5", 100, 2], ["E5", 102, 2], ["C5", 104, 4], ["D5", 108, 2], ["E5", 110, 2],
  ["F5", 112, 8], ["E5", 120, 2], ["D5", 122, 2], ["C5", 124, 4],
];

// Verse pluck motif — sparse, leaves room for the hook later.
const VERSE_PLUCK: Array<[string, number]> = [
  ["G4", 2], ["E4", 6], ["A4", 18], ["G4", 22], ["C5", 34], ["A4", 38], ["D5", 50], ["C5", 54],
];

class LandingMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private delay: DelayNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private step = 0;
  private nextAt = 0;
  private running = false;
  muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem("unbound-landing-muted") === "1";
      } catch { /* private mode */ }
    }
  }

  private ensure(): boolean {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 0.0;
      this.bus.connect(this.master);
      // a short bright echo for the lead/plucks — the summer shimmer
      this.delay = this.ctx.createDelay(1);
      this.delay.delayTime.value = STEP * 3; // dotted 8th
      const fb = this.ctx.createGain(); fb.gain.value = 0.32;
      const wet = this.ctx.createGain(); wet.gain.value = 0.35;
      this.delay.connect(fb); fb.connect(this.delay);
      this.delay.connect(wet); wet.connect(this.bus);
      // shared noise buffer for hats/claps/shaker
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return true;
  }

  start(): void {
    if (this.running) return;
    if (!this.ensure() || !this.ctx || !this.bus) return;
    this.running = true;
    this.step = 0;
    this.nextAt = this.ctx.currentTime + 0.06;
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bus.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.8); // gentle fade-in
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.ctx && this.bus) {
      this.bus.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.25);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { window.localStorage.setItem("unbound-landing-muted", m ? "1" : "0"); } catch { /* ignore */ }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  private tick(): void {
    if (!this.ctx || !this.running) return;
    while (this.nextAt < this.ctx.currentTime + 0.18) {
      this.scheduleStep(this.step, this.nextAt);
      this.step = (this.step + 1) % STEPS;
      this.nextAt += STEP;
    }
  }

  // ---- instruments ----
  private kick(t: number): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 0.26);
    // click so it cuts through phone speakers
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(hp); hp.connect(ng); ng.connect(this.bus!);
    n.start(t); n.stop(t + 0.05);
  }

  private clap(t: number): void {
    const c = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.2;
      const g = c.createGain();
      const tt = t + i * 0.012;
      g.gain.setValueAtTime(0.5, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.09);
      n.connect(bp); bp.connect(g); g.connect(this.bus!);
      n.start(tt); n.stop(tt + 0.12);
    }
  }

  private hat(t: number, open: boolean): void {
    const c = this.ctx!;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7500;
    const g = c.createGain();
    const dur = open ? 0.28 : 0.05;
    g.gain.setValueAtTime(open ? 0.22 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(this.bus!);
    n.start(t); n.stop(t + dur + 0.02);
  }

  private bass(t: number, note: string, dur: number): void {
    const c = this.ctx!, f = freq(note);
    const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + dur + 0.02);
    // octave-up harmonic — the part small speakers actually reproduce
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.16, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o2.connect(g2); g2.connect(this.bus!);
    o2.start(t); o2.stop(t + dur + 0.02);
  }

  private stab(t: number, notes: string[], vol: number): void {
    const c = this.ctx!;
    for (const n of notes) {
      for (const det of [-4, 4]) {
        const o = c.createOscillator(); o.type = "sawtooth";
        o.frequency.value = freq(n); o.detune.value = det;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.connect(lp); lp.connect(g); g.connect(this.bus!);
        o.start(t); o.stop(t + 0.3);
      }
    }
  }

  private pad(t: number, notes: string[], dur: number): void {
    const c = this.ctx!;
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = "sawtooth";
        o.frequency.value = freq(n); o.detune.value = det;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(this.bus!);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  private lead(t: number, note: string, dur: number, vol: number): void {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = "square"; o.frequency.value = freq(note);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp); lp.connect(g);
    g.connect(this.bus!); g.connect(this.delay!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private sparkle(t: number, note: string): void {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq(note) * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.delay!);
    o.start(t); o.stop(t + 0.25);
  }

  // ---- arrangement ----
  private scheduleStep(s: number, t: number): void {
    const bar = Math.floor(s / 16);
    const beat = s % 16;
    const chorus = bar >= 4;
    const chord = CHORDS[bar % 4];
    const stabN = STAB_VOICE[bar % 4];
    const root = BASS_ROOT[bar % 4];

    // drums — four on the floor, always
    if (beat % 4 === 0) this.kick(t);
    if (beat === 4 || beat === 12) this.clap(t);
    if (beat % 4 === 2) this.hat(t, false); // offbeat 8ths
    if (chorus && beat % 2 === 1) this.hat(t, false); // 16th shaker layer
    if (chorus && beat === 0 && bar === 4) this.hat(t, true); // crash-ish on the chorus downbeat

    // bass — driving 8ths, octave pops on the offbeats in the chorus
    if (beat % 2 === 0) this.bass(t, root, STEP * 1.8);
    if (chorus && beat % 4 === 2) this.bass(t, root.replace(/(\d)/, (_, d) => String(parseInt(d, 10) + 1)), STEP * 1.5);

    // harmony
    if (beat === 0) this.pad(t, chord, STEP * 16);
    if (beat === 2 || beat === 7 || beat === 10) this.stab(t, stabN, chorus ? 0.11 : 0.07);
    if (chorus && beat === 14) this.stab(t, stabN, 0.09);

    // verse pluck motif (global steps — bars 0-3)
    if (!chorus) {
      for (const [n, at] of VERSE_PLUCK) {
        if (s === at) this.lead(t, n, STEP * 2.5, 0.1);
      }
    }

    // chorus hook
    if (chorus) {
      for (const [n, at, len] of HOOK) {
        if (s === at) this.lead(t, n, len * STEP, 0.16);
      }
      // sparkle arp on 8ths, chord tones up high
      if (beat % 2 === 0) this.sparkle(t, stabN[(beat >> 1) % 3]);
    }
  }
}

export const landingMusic = new LandingMusic();
export const startLandingMusic = (): void => landingMusic.start();
export const stopLandingMusic = (): void => landingMusic.stop();
export const setLandingMuted = (m: boolean): void => landingMusic.setMuted(m);
export const isLandingMuted = (): boolean => landingMusic.muted;
