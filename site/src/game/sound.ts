// Deepspace Engine sound layer — entirely WebAudio-synthesized, no audio asset
// files (keeps memory/disk low). Two parts:
//   1. Short UI blips for clicks / tabs / launch / study / deploy / purify / error.
//   2. An ambient background drone (slowly evolving sci-fi pad) for the game page.
//
// Browser autoplay rule: the AudioContext is only created/resumed on the first
// user gesture (see start()) — the manager is inert until then, so nothing plays
// without interaction. A single mute toggle controls both music and SFX.

type Ctx = AudioContext;

class SoundManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private musicStarted = false;
  muted = false;

  // Resume/create the AudioContext on a user gesture. Safe to call repeatedly.
  start(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.0; // ramped up when music starts
      this.music.connect(this.master);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  private tone(
    freq: number,
    { type = "sine", dur = 0.09, gain = 0.12, delay = 0, ramp = "exp" }:
      { type?: OscillatorType; dur?: number; gain?: number; delay?: number; ramp?: "exp" | "lin" }
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    if (ramp === "exp") g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    else g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // --- UI blips (subtle sci-fi) ---
  click(): void { this.start(); this.tone(660, { type: "triangle", dur: 0.06, gain: 0.07 }); }

  tab(): void {
    this.start();
    this.tone(520, { type: "triangle", dur: 0.09, gain: 0.09, ramp: "lin" });
    this.tone(780, { type: "sine", dur: 0.1, gain: 0.06, delay: 0.035 });
  }

  launch(): void {
    this.start();
    this.tone(300, { type: "sawtooth", dur: 0.28, gain: 0.06, ramp: "lin" });
    this.tone(150, { type: "sine", dur: 0.3, gain: 0.08 });
    this.tone(880, { type: "triangle", dur: 0.08, gain: 0.05, delay: 0.12 });
  }

  success(): void {
    this.start();
    this.tone(660, { type: "triangle", dur: 0.1, gain: 0.08 });
    this.tone(880, { type: "triangle", dur: 0.12, gain: 0.07, delay: 0.09 });
    this.tone(1100, { type: "sine", dur: 0.16, gain: 0.05, delay: 0.18 });
  }

  deploy(): void {
    this.start();
    this.tone(440, { type: "sawtooth", dur: 0.12, gain: 0.05 });
    this.tone(660, { type: "triangle", dur: 0.12, gain: 0.07, delay: 0.05 });
    this.tone(990, { type: "triangle", dur: 0.2, gain: 0.08, delay: 0.1 });
  }

  error(): void {
    this.start();
    this.tone(220, { type: "square", dur: 0.12, gain: 0.05 });
    this.tone(180, { type: "square", dur: 0.16, gain: 0.05, delay: 0.1 });
  }

  purify(): void {
    this.start();
    this.tone(520, { type: "sine", dur: 0.14, gain: 0.07 });
    this.tone(700, { type: "sine", dur: 0.2, gain: 0.06, delay: 0.08 });
  }

  // Wait for a sound to be audible before reporting — used during early start.
  prime(): void { this.start(); this.click(); }

  // --- ambient drone ---
  startMusic(): void {
    this.start();
    if (!this.ctx || !this.music || this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.ctx;

    // Dark, desolate pad. Low fundamentals give depth; mid partials carry the
    // body on phone speakers (which roll off below ~300 Hz) so it is genuinely
    // audible on mobile while still sitting under the UI as ambient background.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 950;
    filter.Q.value = 0.5;
    filter.connect(this.music);

    // A1 · E2 · A2 · E3 (depth) + A3 · E4 · A4 (phone-audible body).
    const baseFreqs = [55, 82.4, 110, 164.8, 220, 329.63, 440];
    const gains = [0.055, 0.045, 0.05, 0.04, 0.035, 0.03, 0.02];

    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < baseFreqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = baseFreqs[i];
      const g = ctx.createGain();
      g.gain.value = gains[i];

      // Slow amplitude breathing so the drone evolves and is perceptible.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.015; // 0.05–0.14 Hz
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = g.gain.value * 0.5;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();

      osc.connect(g);
      g.connect(filter);
      osc.start();
      oscs.push(osc);
    }

    // Slow filter sweep adds an evolving, "ruined wind" character.
    const filterLfo = ctx.createOscillator();
    filterLfo.frequency.value = 0.05;
    const filterLfoGain = ctx.createGain();
    filterLfoGain.gain.value = 90;
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(filter.frequency);
    filterLfo.start();

    // Fade the pad in over 3s. Owner direction (2026-09-14): the music must be
    // LOUD — loud enough the player reaches to turn it down — so it sits well
    // forward, not tucked under the UI. Still below clipping (partials sum ≪ 1).
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.music.gain.exponentialRampToValueAtTime(0.7, ctx.currentTime + 3);
    // (No need to hold node references: everything is connected to the
    // destination through this.music, so the graph stays alive while running.)
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    // A soft click lets the user confirm the toggle state.
    this.click();
    return this.muted;
  }
}

export const sound = new SoundManager();
