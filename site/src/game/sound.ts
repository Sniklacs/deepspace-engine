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
  // Battle SFX sub-mix (owner 2026-10-05): the battle soundscape runs through
  // this bus — a gain + gentle compressor under master, so the global mute
  // and master level govern it. One AudioContext for the whole game.
  private battleBus: GainNode | null = null;
  private battleBusBase = 0.9;
  // Action-feedback sub-mix (owner 2026-10-14, the Click Law's audible half):
  // every press/receipt/refusal in the game answers through this bus. Its
  // recipes live in game/audio/action-sounds.ts (the data-driven sound map).
  private actionBus: GainNode | null = null;
  // Ducking (owner 2026-10-14): while a receipt/order/voice line speaks, the
  // battle bed dips so the answer cuts through. Refcounted — overlapping
  // ducks nest, the bed restores when the last one releases.
  private duckCount = 0;
  private muteListeners = new Set<(muted: boolean) => void>();

  // Resume/create the AudioContext on a user gesture. Safe to call repeatedly.
  start(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      // Limiter (2026-10-14): the action layer runs HOT by the owner's order
      // ("turn them up") — master now feeds a gentle compressor before the
      // destination so stacked receipts glue instead of clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 18;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.24;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
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

  // --- UI blips (sci-fi) ---
  // LEVELS (owner field report 2026-10-14): "the sounds ARE there — just turn
  // them up." The original recipes peaked at 0.05–0.09 (−26…−21 dBFS) — a
  // whisper under any music on a phone speaker. These now peak ≈0.15, and the
  // master limiter keeps the lift clean. The rich action recipes live in
  // game/audio/action-sounds.ts and peak higher still.
  click(): void { this.start(); this.tone(660, { type: "triangle", dur: 0.06, gain: 0.15 }); }

  tab(): void {
    this.start();
    this.tone(520, { type: "triangle", dur: 0.09, gain: 0.15, ramp: "lin" });
    this.tone(780, { type: "sine", dur: 0.1, gain: 0.1, delay: 0.035 });
  }

  launch(): void {
    this.start();
    this.tone(300, { type: "sawtooth", dur: 0.28, gain: 0.11, ramp: "lin" });
    this.tone(150, { type: "sine", dur: 0.3, gain: 0.14 });
    this.tone(880, { type: "triangle", dur: 0.08, gain: 0.09, delay: 0.12 });
  }

  success(): void {
    this.start();
    this.tone(660, { type: "triangle", dur: 0.1, gain: 0.15 });
    this.tone(880, { type: "triangle", dur: 0.12, gain: 0.13, delay: 0.09 });
    this.tone(1100, { type: "sine", dur: 0.16, gain: 0.09, delay: 0.18 });
  }

  deploy(): void {
    this.start();
    this.tone(440, { type: "sawtooth", dur: 0.12, gain: 0.1 });
    this.tone(660, { type: "triangle", dur: 0.12, gain: 0.13, delay: 0.05 });
    this.tone(990, { type: "triangle", dur: 0.2, gain: 0.15, delay: 0.1 });
  }

  error(): void {
    this.start();
    this.tone(220, { type: "square", dur: 0.12, gain: 0.11 });
    this.tone(180, { type: "square", dur: 0.16, gain: 0.11, delay: 0.1 });
  }

  purify(): void {
    this.start();
    this.tone(520, { type: "sine", dur: 0.14, gain: 0.12 });
    this.tone(700, { type: "sine", dur: 0.2, gain: 0.11, delay: 0.08 });
  }

  /** A new chat message landed: two sine notes, warm and unmissable. */
  chime(): void {
    this.start();
    this.tone(880, { type: "sine", dur: 0.16, gain: 0.15 });
    this.tone(1174.66, { type: "sine", dur: 0.22, gain: 0.13, delay: 0.11 });
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
    g.gain.value = 0.085; // an alarm is meant to be heard (lifted 2026-10-14)
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

  /** Duck the beds under something that must be heard — a spoken line (the
   *  voice engine calls this), a receipt, a refusal, an accepted order.
   *  (2026-10-14: this was a no-op stub — "no music bus anymore." The battle
   *  bed IS a bus, and it now dips for real: see duckBed.) */
  duck(on: boolean): void { this.duckBed(on); }

  /** Dip the battle bed to ACTION_DUCK_DEPTH of its base gain (action-sounds
   *  owns the numbers; this owns the nodes). Refcounted so a receipt landing
   *  inside a voice line doesn't restore the bed early. No-op until the
   *  battle bus exists — ducking a silent bed is free. */
  duckBed(on: boolean): void {
    this.duckCount = Math.max(0, this.duckCount + (on ? 1 : -1));
    if (!this.ctx || !this.battleBus) return;
    const target = this.duckCount > 0 ? this.battleBusBase * 0.42 : this.battleBusBase;
    this.battleBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
  }

  // --- Action-feedback primitives (the sound map's instrument) --------------
  // Recipes in game/audio/action-sounds.ts are DATA (layers); these two
  // players render a layer each onto the action bus. Both are gesture-safe
  // (start() creates/resumes the context inside the press handler) and
  // mute-governed (private tone() already refuses when muted; the bus hangs
  // under master, which the mute toggle zeroes).

  /** The action bus, created lazily like the battle bus. */
  private ensureActionBus(): GainNode | null {
    this.start();
    if (!this.ctx || !this.master) return null;
    if (!this.actionBus) {
      this.actionBus = this.ctx.createGain();
      this.actionBus.gain.value = 1;
      this.actionBus.connect(this.master);
    }
    return this.actionBus;
  }

  /** One enveloped tone layer on the action bus, with optional pitch slide
   *  and lowpass — the anvil partials, knocks and chirps of the sound map. */
  toneFx(
    freq: number,
    { type = "sine", dur = 0.09, gain = 0.15, delay = 0, slideTo, lowpass }:
      { type?: OscillatorType; dur?: number; gain?: number; delay?: number; slideTo?: number; lowpass?: number }
  ): void {
    const bus = this.ensureActionBus();
    if (!this.ctx || !bus || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    let head: AudioNode = osc;
    if (lowpass) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = lowpass;
      osc.connect(lp);
      head = lp;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** One shaped noise layer on the action bus — strikes, thocks, latches.
   *  Noise carries the transient that makes a sound READ on a phone speaker
   *  whose woofer can't reproduce the low fundamentals. */
  noiseFx(
    { dur = 0.06, gain = 0.12, delay = 0, filterType = "highpass", filterFreq = 2000, filterQ = 0.8, sweepTo }:
      { dur?: number; gain?: number; delay?: number; filterType?: BiquadFilterType; filterFreq?: number; filterQ?: number; sweepTo?: number }
  ): void {
    const bus = this.ensureActionBus();
    if (!this.ctx || !bus || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(filterFreq, t);
    flt.Q.value = filterQ;
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(Math.max(10, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    // Muting kills the klaxon immediately — the alarm stays visible, silent.
    if (this.muted) this.sirenStop();
    for (const fn of this.muteListeners) {
      try { fn(this.muted); } catch { /* listener error must not break the toggle */ }
    }
    // A soft click lets the user confirm the toggle state.
    this.click();
    return this.muted;
  }

  /** Subscribe to mute changes (e.g. a battle-scene speaker button). Returns
   *  an unsubscribe function. */
  onMuteChange(fn: (muted: boolean) => void): () => void {
    this.muteListeners.add(fn);
    return () => { this.muteListeners.delete(fn); };
  }

  /** The battle soundscape's sub-mix: { ctx, bus }. Creates the context on a
   *  user gesture via start() — call only from a gesture handler. The bus
   *  runs through a gentle compressor so layered battle noise glues instead
   *  of clipping, and sits under master so global mute governs it. */
  getBattleBus(): { ctx: Ctx; bus: GainNode } | null {
    this.start();
    if (!this.ctx || !this.master) return null;
    if (!this.battleBus) {
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.24;
      comp.connect(this.master);
      const bus = this.ctx.createGain();
      bus.gain.value = this.battleBusBase;
      bus.connect(comp);
      this.battleBus = bus;
    }
    return { ctx: this.ctx, bus: this.battleBus };
  }
}

export const sound = new SoundManager();
