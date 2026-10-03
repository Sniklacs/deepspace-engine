// Deepspace Engine sound layer — entirely WebAudio-synthesized, no audio asset
// files (keeps memory/disk low). Short UI blips for clicks / tabs / launch /
// study / deploy / purify / error, plus the chat chime. (The generative music
// engine was removed 2026-10-01 on the owner's order — "kill all the music";
// he'll put his own music together. This file is SFX only now.)
//
// Browser autoplay rule: the AudioContext is only created/resumed on the first
// user gesture (see start()) — the manager is inert until then, so nothing plays
// without interaction.

type Ctx = AudioContext;

class SoundManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  muted = false;
  // Raid-alarm siren nodes (started/stopped as a unit).
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

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

  /** A new chat message landed: two soft sine notes, warm and unmissable. */
  chime(): void {
    this.start();
    this.tone(880, { type: "sine", dur: 0.16, gain: 0.09 });
    this.tone(1174.66, { type: "sine", dur: 0.22, gain: 0.08, delay: 0.11 });
  }

  /** RAID KLAXON (owner 2026-10-03): a wailing siren — sawtooth carrier swept
   *  by a slow LFO, looping until sirenStop(). No audio files; pure WebAudio.
   *  Silent when muted (never starts). Safe to call repeatedly. */
  sirenStart(): void {
    if (this.siren) return;
    this.start();
    if (!this.ctx || !this.master || this.muted) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 750;
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.6; // one wail ≈ 1.7s
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 320; // sweep ±320 Hz around the carrier
    const g = this.ctx.createGain();
    g.gain.value = 0.055; // loud but not ear-bleeding
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    lfo.start();
    this.siren = { osc, lfo, gain: g };
  }

  /** Stop the raid klaxon. Safe to call when not sounding. */
  sirenStop(): void {
    const s = this.siren;
    this.siren = null;
    if (!s || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      s.gain.gain.setTargetAtTime(0.0001, t, 0.05);
      s.osc.stop(t + 0.3);
      s.lfo.stop(t + 0.3);
    } catch {
      /* already stopped */
    }
  }

  /** True while the klaxon is sounding. */
  get sirenOn(): boolean {
    return this.siren !== null;
  }

  // Wait for a sound to be audible before reporting — used during early start.
  prime(): void { this.start(); this.click(); }

  /** Duck under a spoken line — kept for the voice engine's API. There is no
   *  music bus anymore (removed 2026-10-01), so this is a no-op. */
  duck(_on: boolean): void {}

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    // Muting kills the klaxon immediately — the alarm stays visible, silent.
    if (this.muted) this.sirenStop();
    // A soft click lets the user confirm the toggle state.
    this.click();
    return this.muted;
  }
}

export const sound = new SoundManager();
