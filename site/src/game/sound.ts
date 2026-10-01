// Deepspace Engine sound layer — entirely WebAudio-synthesized, no audio asset
// files (keeps memory/disk low). Two parts:
//   1. Short UI blips for clicks / tabs / launch / study / deploy / purify / error.
//   2. A generative music engine for the game page: two moods that never loop
//      the same way twice —
//        drift  — upbeat explorer energy: a driving 122 BPM groove (four on
//                 the floor, rolling bass, bright 16th-note plucks, backbeat
//                 claps) over the A-minor i–VI–III–VII drift, with echoing
//                 bells on the grid. Exciting the moment you land.
//        battle — upbeat and driving: ~112 BPM pulse, kick thump, rolling bass,
//                 16th-note arps, offbeat hats, tenser harmony.
//      The game switches moods (battles tab / replay = battle, everything else
//      = drift) with a ~2s crossfade. A single mute toggle controls both music
//      and SFX.
//
// Browser autoplay rule: the AudioContext is only created/resumed on the first
// user gesture (see start()) — the manager is inert until then, so nothing plays
// without interaction.

type Ctx = AudioContext;

/** The music bus's authored gain (owner direction 2026-09-14: loud enough the
 *  player reaches to turn it down). */
const MUSIC_GAIN = 0.7;
/** Speech ducking (design/prologue-voice-direction.md §5.6): the voice loses a
 *  fight with a 0.7 pad on a phone speaker, so the music drops to ×0.45 while a
 *  line is speaking and comes back when it ends. */
const MUSIC_DUCK = 0.45;

export type MusicMood = "drift" | "battle";

// ---- drift: upbeat explorer groove, 122 BPM (owner direction 2026-10-01:
// the sleepy ambient drift was putting him to sleep — the music has to give
// people energy the moment they land). Same A-minor harmonic DNA as before
// (Am – F – Cmaj7 – G, the i–VI–III–VII drift), but now it *moves*: four on
// the floor, driving bass, bright 16th-note plucks, backbeat claps. The
// battle mood keeps its own 112 BPM pulse for combat; drift is the
// excited-explorer energy everywhere else.
const DRIFT_BPM = 122;
const DRIFT_STEP = 60 / DRIFT_BPM / 4; // 16th note
const DRIFT_BARS_PER_CHORD = 4;
const DRIFT_CHORDS: number[][] = [
  [110.0, 164.81, 246.94, 293.66],   // Am(add9)
  [87.31, 110.0, 130.81, 164.81],    // Fmaj7
  [130.81, 196.0, 246.94, 329.63],   // Cmaj7
  [98.0, 146.83, 220.0, 246.94],     // G(add9/A)
];
const DRIFT_BASS = [110.0, 87.31, 130.81, 98.0]; // bass roots (audible octave — small speakers)
const DRIFT_BELLS = [880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0]; // A-minor pentatonic, high

// ---- battle: driving minor pulse, 112 BPM
const BATTLE_BPM = 112;
const BATTLE_STEP = 60 / BATTLE_BPM / 4; // 16th note
const BATTLE_BARS_PER_CHORD = 4;
const BATTLE_ROOTS = [73.42, 58.27, 87.31, 65.41]; // D2 Bb1 F2 C2
// chord tones (root, minor 3rd, 5th) per root, for arps
const BATTLE_TONES = [
  [293.66, 349.23, 440.0],  // Dm
  [233.08, 293.66, 349.23], // Bbm
  [349.23, 415.3, 523.25],  // F
  [261.63, 329.63, 392.0],  // C
];

class SoundManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private musicStarted = false;
  muted = false;

  // --- generative engine state ---
  private mood: MusicMood = "drift";
  private driftBus: GainNode | null = null;
  private battleBus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noiseBuf: AudioBuffer | null = null;
  // drift schedule
  private driftStep = 0;
  // battle schedule
  private nextStepAt = 0;
  private battleStep = 0;
  private echoIn: GainNode | null = null;

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

  /** A new chat message landed: two soft sine notes, warm and unmissable. */
  chime(): void {
    this.start();
    this.tone(880, { type: "sine", dur: 0.16, gain: 0.09 });
    this.tone(1174.66, { type: "sine", dur: 0.22, gain: 0.08, delay: 0.11 });
  }

  // Wait for a sound to be audible before reporting — used during early start.
  prime(): void { this.start(); this.click(); }

  // --- generative music engine ---
  startMusic(): void {
    this.start();
    if (!this.ctx || !this.music || this.musicStarted) return;
    this.musicStarted = true;
    const ctx = this.ctx;

    // Two mood buses; setMood() crossfades between them.
    this.driftBus = ctx.createGain();
    this.driftBus.gain.value = 0.55;
    this.driftBus.connect(this.music);
    this.battleBus = ctx.createGain();
    this.battleBus.gain.value = 0.0001;
    this.battleBus.connect(this.music);

    // The space-echo: a long feedback delay the drift bells bloom through.
    const echo = ctx.createDelay(2.0);
    echo.delayTime.value = 0.45;
    const echoFb = ctx.createGain();
    echoFb.gain.value = 0.45;
    const echoWet = ctx.createGain();
    echoWet.gain.value = 0.5;
    echo.connect(echoFb);
    echoFb.connect(echo);
    echo.connect(echoWet);
    echoWet.connect(this.driftBus);
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 1;
    this.echoIn.connect(this.driftBus);
    this.echoIn.connect(echo);

    // (No constant pedal drone — the sequenced bass below carries the roots,
    // and a fixed drone would clash with the chord changes.)

    // 1s of white noise, reused for battle hats.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const now = ctx.currentTime;
    this.nextStepAt = now + 0.1;
    this.driftStep = 0;
    this.battleStep = 0;

    // Lookahead scheduler: every 200ms, schedule events up to 0.8s ahead.
    this.timer = setInterval(() => this.schedule(), 200);

    // Fade the music bus in over 3s (owner direction 2026-09-14: LOUD — loud
    // enough the player reaches to turn it down).
    this.music.gain.cancelScheduledValues(now);
    this.music.gain.setValueAtTime(0.0001, now);
    this.music.gain.exponentialRampToValueAtTime(MUSIC_GAIN, now + 3);
  }

  /** Stop the generative engine (clears the scheduler). The bus fade-out keeps
   *  it musical rather than a hard cut. */
  stopMusic(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx && this.music) {
      const t = this.ctx.currentTime;
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setTargetAtTime(0.0001, t, 0.4);
    }
    this.musicStarted = false;
  }

  /** Switch the musical mood; crossfades over ~2s. Safe to call before
   *  startMusic() — it just records the target. */
  setMood(mood: MusicMood): void {
    this.mood = mood;
    if (!this.ctx || !this.driftBus || !this.battleBus) return;
    const t = this.ctx.currentTime;
    const driftTarget = mood === "drift" ? 0.55 : 0.0001;
    const battleTarget = mood === "battle" ? 0.5 : 0.0001;
    this.driftBus.gain.cancelScheduledValues(t);
    this.battleBus.gain.cancelScheduledValues(t);
    this.driftBus.gain.setTargetAtTime(driftTarget, t, 0.7);
    this.battleBus.gain.setTargetAtTime(battleTarget, t, 0.7);
  }

  private schedule(): void {
    if (!this.ctx) return;
    const horizon = this.ctx.currentTime + 0.8;
    if (this.mood === "drift") {
      while (this.nextStepAt < horizon) {
        this.scheduleDriftStep(this.driftStep, this.nextStepAt);
        this.driftStep++;
        this.nextStepAt += DRIFT_STEP;
      }
      // Keep the battle clock parked so switching moods never jumps the beat.
      this.battleStep = 0;
    } else {
      while (this.nextStepAt < horizon) {
        this.scheduleBattleStep(this.battleStep, this.nextStepAt);
        this.battleStep++;
        this.nextStepAt += BATTLE_STEP;
      }
      // Keep the drift clock parked so a return never stacks missed steps.
      this.driftStep = 0;
    }
    // this.nextStepAt is shared: after a mood switch it keeps counting from
    // now, so neither groove ever schedules a burst of catch-up steps.
    if (this.nextStepAt < this.ctx.currentTime - 1) {
      this.nextStepAt = this.ctx.currentTime + 0.1;
    }
  }

  // --- drift: upbeat 122 BPM explorer groove (step sequencer) ---
  private scheduleDriftStep(step: number, t: number): void {
    const ctx = this.ctx, bus = this.driftBus, echo = this.echoIn;
    if (!ctx || !bus || !echo) return;
    const s16 = step % 16;                       // position in bar
    const bar = Math.floor(step / 16);
    const chordIdx = Math.floor(bar / DRIFT_BARS_PER_CHORD) % DRIFT_CHORDS.length;
    const chord = DRIFT_CHORDS[chordIdx];
    const bassRoot = DRIFT_BASS[chordIdx];

    // Four-on-the-floor kick — the heartbeat of the groove. Pitched so it
    // thumps on phone/tablet drivers, not just big speakers.
    if (s16 % 4 === 0) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(130, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.22);
    }
    // Backbeat clap on 2 & 4 — the excitement.
    if (s16 % 8 === 4 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      src.connect(bp);
      bp.connect(g);
      g.connect(bus);
      g.connect(echo);
      src.start(t);
      src.stop(t + 0.16);
    }
    // Driving 8th-note bass, root with octave/fifth pops for motion.
    if (s16 % 2 === 0) {
      const mult = s16 === 6 ? 1.5 : s16 % 8 === 4 ? 2 : 1;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = bassRoot * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.24);
    }
    // Bright 16th-note plucks cycling the chord tones — the melodic engine.
    {
      const seq = [chord[0] * 4, chord[1] * 4, chord[2] * 4, chord[3] * 4, chord[2] * 4, chord[1] * 4];
      const f = seq[s16 % seq.length];
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = ctx.createGain();
      const accented = s16 % 4 === 0;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(accented ? 0.075 : 0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g);
      g.connect(bus);   // dry — the rhythm has to be crisp
      g.connect(echo);  // a touch of space on top
      osc.start(t);
      osc.stop(t + 0.14);
    }
    // Chord stab at every chord change — a little fanfare as the harmony turns.
    if (step % (16 * DRIFT_BARS_PER_CHORD) === 0) {
      for (const f of chord) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f * 2;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(lp);
        lp.connect(g);
        g.connect(bus);
        g.connect(echo);
        osc.start(t);
        osc.stop(t + 0.55);
      }
    }
    // Sparkle bell on beat 1 every 2 bars — the old drift's signature, now on the grid.
    if (step % 32 === 0) {
      const f = DRIFT_BELLS[Math.floor(Math.random() * DRIFT_BELLS.length)];
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc.connect(g);
      g.connect(bus);
      g.connect(echo);
      osc.start(t);
      osc.stop(t + 1.8);
    }
    // Offbeat hats keep the top end shimmering.
    if (s16 % 4 === 2 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(hp);
      hp.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + 0.06);
    }
  }


  // --- battle: driving 112 BPM pulse ---
  private scheduleBattleStep(step: number, t: number): void {
    const ctx = this.ctx, bus = this.battleBus;
    if (!ctx || !bus) return;
    const s16 = step % 16;                       // position in bar
    const bar = Math.floor(step / 16);
    const chordIdx = Math.floor(bar / BATTLE_BARS_PER_CHORD) % BATTLE_ROOTS.length;
    const root = BATTLE_ROOTS[chordIdx];
    const tones = BATTLE_TONES[chordIdx];

    // Kick thump on every beat.
    if (s16 % 4 === 0) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    // Rolling bass, 8th notes.
    if (s16 % 2 === 0) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = root * 2 * (s16 % 8 === 6 ? 1.5 : 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.25);
    }
    // 16th-note arp, cycling chord tones two octaves up.
    {
      const seq = [tones[0] * 2, tones[1] * 2, tones[2] * 2, tones[0] * 4, tones[2] * 2, tones[1] * 2];
      const f = seq[s16 % seq.length];
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(lp);
      lp.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.15);
    }
    // Offbeat hats from the noise buffer.
    if ((s16 % 4 === 2) && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.035, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(hp);
      hp.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + 0.06);
    }
    // Tense pad swell under each chord change.
    if (step % (16 * BATTLE_BARS_PER_CHORD) === 0) {
      const dur = 16 * BATTLE_BARS_PER_CHORD * BATTLE_STEP;
      for (const f of tones) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 14;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 850;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 1.6);
        g.gain.setValueAtTime(0.035, t + dur - 2);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(lp);
        lp.connect(g);
        g.connect(bus);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
    }
  }

  /** Duck the music under a spoken line: ×0.45 over ~120 ms while the line
   *  speaks, back over ~400 ms when it ends (design/prologue-voice-direction
   *  §5.6 — the one change the voice slice makes to this file). No state, no
   *  asset, no new noun; the speech engine calls it on every utterance. */
  duck(on: boolean): void {
    if (!this.ctx || !this.music || !this.musicStarted) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    // setTargetAtTime is an exponential approach: τ ≈ ramp/3, so 0.04 ≈ 120 ms
    // down and 0.13 ≈ 400 ms back up.
    this.music.gain.setTargetAtTime(on ? MUSIC_GAIN * MUSIC_DUCK : MUSIC_GAIN, t, on ? 0.04 : 0.13);
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
