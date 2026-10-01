// Deepspace Engine sound layer — entirely WebAudio-synthesized, no audio asset
// files (keeps memory/disk low). Two parts:
//   1. Short UI blips for clicks / tabs / launch / study / deploy / purify / error.
//   2. A generative music engine for the game page: two moods that never loop
//      the same way twice —
//        drift  — "Below the Asteroids" energy: vast, lonely, ancient. A slow
//                 D-minor pad that changes chords every ~18s, sparse bell notes
//                 blooming through a long space-echo, a deep sub swell.
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

// ---- drift: A-minor progression, ~18s per chord (Below-the-Asteroids space).
// Harmonic DNA drawn from the reference track's own analysis (A minor, A
// pedal, i–VI–III–VII drift) — buried as inspiration, never quoted.
const DRIFT_CHORDS: number[][] = [
  [110.0, 164.81, 246.94, 293.66],   // Am(add9)
  [87.31, 110.0, 130.81, 164.81],    // Fmaj7
  [130.81, 196.0, 246.94, 329.63],   // Cmaj7
  [98.0, 146.83, 220.0, 246.94],     // G(add9/A)
];
const DRIFT_SUBS = [55.0, 43.65, 65.41, 49.0]; // roots, one octave down
const DRIFT_BELLS = [880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0]; // A-minor pentatonic, high
const DRIFT_PEDAL = 110.0; // the A pedal that sits under the whole track
const DRIFT_CHORD_SECS = 18;

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
  private driftChordIdx = 0;
  private nextChordAt = 0;
  private nextBellAt = 0;
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

    // The A pedal: a barely-there root tone sitting under the whole drift,
    // the way the reference track holds its center. Felt more than heard.
    const pedal = ctx.createOscillator();
    pedal.type = "sine";
    pedal.frequency.value = DRIFT_PEDAL;
    const pedalG = ctx.createGain();
    pedalG.gain.value = 0.022;
    pedal.connect(pedalG);
    pedalG.connect(this.driftBus);
    pedal.start();
    // 220 Hz harmonic so the pedal survives small speakers — 110 Hz alone
    // vanishes on phone/tablet drivers.
    const pedalHi = ctx.createOscillator();
    pedalHi.type = "sine";
    pedalHi.frequency.value = DRIFT_PEDAL * 2;
    const pedalHiG = ctx.createGain();
    pedalHiG.gain.value = 0.014;
    pedalHi.connect(pedalHiG);
    pedalHiG.connect(this.driftBus);
    pedalHi.start();

    // 1s of white noise, reused for battle hats.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const now = ctx.currentTime;
    this.nextChordAt = now + 0.1;
    this.nextBellAt = now + 3;
    this.nextStepAt = now + 0.1;
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
      while (this.nextChordAt < horizon) {
        this.scheduleDriftChord(this.nextChordAt, this.driftChordIdx);
        this.driftChordIdx = (this.driftChordIdx + 1) % DRIFT_CHORDS.length;
        this.nextChordAt += DRIFT_CHORD_SECS;
      }
      while (this.nextBellAt < horizon) {
        this.scheduleBell(this.nextBellAt);
        this.nextBellAt += 4 + Math.random() * 7;
      }
      // Keep the battle clock parked so switching moods never jumps the beat.
      this.nextStepAt = this.ctx.currentTime + 0.1;
    } else {
      while (this.nextStepAt < horizon) {
        this.scheduleBattleStep(this.battleStep, this.nextStepAt);
        this.battleStep++;
        this.nextStepAt += BATTLE_STEP;
      }
      // Keep the drift clock parked so a return never stacks missed chords.
      this.nextChordAt = this.ctx.currentTime + 0.1;
      this.nextBellAt = this.ctx.currentTime + 3;
    }
  }

  // --- drift: slow chord swells + sparse echoing bells ---
  private scheduleDriftChord(t: number, idx: number): void {
    const ctx = this.ctx, bus = this.driftBus;
    if (!ctx || !bus) return;
    const dur = DRIFT_CHORD_SECS + 4; // 4s overlap into the next chord
    for (const f of DRIFT_CHORDS[idx]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.065, t + 5);
      g.gain.setValueAtTime(0.065, t + dur - 6);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      // Gentle breathing so the pad feels alive, not frozen.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06 + Math.random() * 0.05;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.02;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.1);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
      // Octave-up shimmer: the same tone one octave higher, much quieter.
      // Phone/tablet drivers can't reproduce the low chord tones, so this
      // carries the harmony where small speakers actually work.
      const hi = ctx.createOscillator();
      hi.type = "sine";
      hi.frequency.value = f * 2;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.linearRampToValueAtTime(0.028, t + 5);
      hg.gain.setValueAtTime(0.028, t + dur - 6);
      hg.gain.linearRampToValueAtTime(0.0001, t + dur);
      lfoG.connect(hg.gain);
      hi.connect(hg);
      hg.connect(bus);
      hi.start(t);
      hi.stop(t + dur + 0.1);
    }
    // Low root underneath, one octave up from the original sub: 43–65 Hz is
    // silence on small speakers, so the root sits where it can be felt.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = DRIFT_SUBS[idx] * 2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.06, t + 6);
    sg.gain.setValueAtTime(0.06, t + dur - 6);
    sg.gain.linearRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg);
    sg.connect(bus);
    sub.start(t);
    sub.stop(t + dur + 0.1);
  }

  private scheduleBell(t: number): void {
    const ctx = this.ctx, bus = this.driftBus, echo = this.echoIn;
    if (!ctx || !bus || !echo) return;
    // Pick a bell tone; sometimes a soft fifth above for harmony.
    const f = DRIFT_BELLS[Math.floor(Math.random() * DRIFT_BELLS.length)];
    const tones = Math.random() < 0.3 ? [f, f * 1.5] : [f];
    for (const tone of tones) {
      for (const [mult, peak] of [[1, 0.055], [2, 0.018]] as const) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tone * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
        osc.connect(g);
        g.connect(bus);   // dry
        g.connect(echo);  // blooms through the space-echo
        osc.start(t);
        osc.stop(t + 3);
      }
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
