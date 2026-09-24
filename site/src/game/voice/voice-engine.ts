// VOICE ENGINE — the DOM adapter for The Fall's spoken prologue.
//
// §5 of design/prologue-voice-direction.md, as code. The three rules it obeys:
//   1 · THE PLATE IS THE SCORE. This layer never decides content, never invents
//       a line, and never speaks text the plate is not showing: it is handed the
//       SAME `cue` object `TutorialCueLayer` renders, and a null cue is silence.
//   2 · NO NEW SURFACE. No new noun, no colour, no persisted state — everything
//       here is session-local (no GameState field, no migration, no V12).
//   3 · VOICE IS AN ENHANCEMENT, NEVER A GATE. Every spoken line has its caption
//       by construction; with no synthesis, no gesture or a muted device the
//       game is 100% playable and NOTHING throws, toasts or delays an order.
//
// What is here: assignment once and frozen (§2), the bounded queue with
// cancel-and-replace (§5.3), gap scheduling (§3.4 — every pause is a timer,
// because Chrome and Safari ignore SSML), the two mute gates (§5.1), gesture
// arming with the iOS priming utterance (§5.2), tab/surface/stage-change rules
// (§5.5), silent degrade (§5.7) and the `data-voice-mode` test hook (§2.7).
//
// SCOPE: the C tier only — the 15 cues in `tutorial-cues.ts` (the diegetic
// tutorial) — plus the plumbing the R (rail) tier will need later. The beat-rail
// module is the NEXT slice and is deliberately NOT built here: there is no rail
// trigger, no rail table and no second observer of the battle log. One cue in,
// speech out.
//
// The engine is safe on the server: no `window`/`document` access at module
// scope, and every platform call is guarded. In a runtime with no
// `speechSynthesis` at all (SSR, jsdom, a stripped-down webview) it reports
// mode `"silent"` and the plate renders exactly as before.
import { sound } from "../sound";
import {
  VOICE_CONFIG,
  VOICE_DIRECTIONS,
  VOICE_SCENE_BY_CUE,
  assignCast,
  voiceDirectionFor,
} from "./voice-direction";
import type { CastAssignment, VoiceDirection, VoiceLike } from "./voice-direction";
import { speakable } from "./speakable";
import type { SpokenPiece } from "./speakable";

export type VoiceMode = "voiced" | "silent" | "shared";

/** Where a line belongs (§5.5): narration never follows the player to the Lab. */
export type VoiceSurface = "battles" | "home" | "rail";

/** The plate's cue, as far as the voice layer is concerned — it is the same
 *  object `TutorialCueLayer` renders, narrowed to what speech needs. */
export interface VoiceCue {
  id: string;
  line: string;
  speaker: { id: string };
  /** §5.4: how the plate retires this line. A decision-bearing line is
   *  cancelled the moment the player acts; a colour line finishes. */
  retireOn?: "supersede" | "decision" | "resolve";
}

// ---------------------------------------------------------------------------
// The platform surface we depend on. Narrow on purpose: everything the browser
// gives us beyond this is ignored, so a partial implementation degrades instead
// of throwing.
// ---------------------------------------------------------------------------
export interface UtteranceLike {
  text: string;
  voice: VoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: unknown) => void) | null;
}

export interface SynthLike {
  getVoices(): VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
}

/** Injected seams (tests drive the engine through these; the app uses the real
 *  ones). Everything is optional: the defaults are the platform. */
export interface VoiceHost {
  /** undefined = read the platform; null = "this device has no synthesis". */
  synth?: SynthLike | null;
  isMuted?: () => boolean;
  duck?: (on: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  makeUtterance?: (text: string) => UtteranceLike | null;
  debug?: (message: string) => void;
}

function platformSynth(): SynthLike | null {
  if (typeof window === "undefined") return null;
  const s = (window as unknown as { speechSynthesis?: SynthLike }).speechSynthesis;
  return s ?? null;
}

function defaultUtterance(text: string): UtteranceLike | null {
  const Ctor = typeof window === "undefined"
    ? undefined
    : (window as unknown as { SpeechSynthesisUtterance?: new (t: string) => UtteranceLike }).SpeechSynthesisUtterance;
  if (!Ctor) return null;
  return new Ctor(text);
}

export interface VoiceStats {
  mode: VoiceMode;
  armed: boolean;
  speaking: string | null;
  waiting: number;
  spoken: string[];
  assignment: CastAssignment | null;
  muted: boolean;
  suppressed: boolean;
}

export class VoiceEngine {
  private host: VoiceHost;
  private synth: SynthLike | null;
  private assignment: CastAssignment | null = null;
  private listeners = new Set<() => void>();
  private timers = new Set<unknown>();
  private generation = 0;

  private modeValue: VoiceMode = "voiced";
  private armedValue = false;
  private muted = false;
  private suppressed = false;
  private completed = false;
  private surfaceValue: VoiceSurface = "battles";
  /** §2: assignment is frozen for the session once it has spoken. */
  private frozen = false;
  private hasSpoken = false;
  private primed = false;
  private retriedVoices = false;
  private sessionStart = 0;
  private errors = 0;
  private disposed = false;

  private current: VoiceCue | null = null;
  private held: VoiceCue | null = null;
  private speaking: VoiceCue | null = null;
  private queue: VoiceCue[] = [];
  /** §5.5 the prologue stage we last saw, and any pending stage-change hold. */
  private stageValue: string | null = null;
  private stageBoundary = 0;
  /** §5.4 the gap the next line owes after a cancel (the turn gap). */
  private nextLineGap = 0;
  private spokenIds = new Set<string>();
  private battleId: string | null = null;

  constructor(host: VoiceHost = {}) {
    this.host = host;
    this.synth = host.synth !== undefined ? host.synth : platformSynth();
    this.sessionStart = this.now();
    if (!this.synth) this.modeValue = "silent";
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  // -------------------------------------------------------------------------
  // reading state (the plate renders `mode()`; the harness reads stats())
  // -------------------------------------------------------------------------
  mode(): VoiceMode {
    return this.modeValue;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  stats(): VoiceStats {
    return {
      mode: this.modeValue,
      armed: this.armedValue,
      speaking: this.speaking?.id ?? null,
      waiting: this.queue.length,
      spoken: [...this.spokenIds],
      assignment: this.assignment,
      muted: this.muted || this.isMuted(),
      suppressed: this.suppressed,
    };
  }

  // -------------------------------------------------------------------------
  // §5.2 nothing speaks before a gesture
  // -------------------------------------------------------------------------
  /** Called from the SAME first user gesture that resumes the AudioContext
   *  (`sound.prime()` in play.tsx). Fires the 1-character priming utterance that
   *  unlocks iOS Safari, then releases the single held line — if its cue is
   *  still the plate's, and not otherwise. */
  arm(): void {
    if (this.disposed || this.armedValue) return;
    this.ensureAssignment();
    this.armedValue = true;
    this.prime();
    const held = this.held;
    this.held = null;
    if (held && held.id === this.current?.id) {
      this.spokenIds.delete(held.id);
      this.enqueue(held, true);
    }
    this.changed();
  }

  private prime(): void {
    const synth = this.synth;
    if (!synth) return;
    try {
      const u = this.makeUtterance(".");
      if (!u) return;
      u.text = VOICE_CONFIG.primeText;
      u.volume = 0;
      u.onstart = () => {
        this.primed = true;
      };
      u.onend = () => {
        this.primed = true;
      };
      u.onerror = () => {
        /* the platform refused the primer: captions carry (§5.7) */
      };
      synth.speak(u);
      // if the platform still refuses (no onstart in time) → silent, no retry
      this.timer(() => {
        if (!this.primed && !this.hasSpoken) this.setMode("silent");
      }, VOICE_CONFIG.primeTimeoutMs);
    } catch {
      /* never throw out of a gesture handler */
    }
  }

  // -------------------------------------------------------------------------
  // §5.1 the two gates
  // -------------------------------------------------------------------------
  /** The Cradle sheet's Sound row is authoritative. A mute press must be silent
   *  within one frame — play.tsx calls this in the same tick as toggleMute().
   *  Unmuting never resumes a cancelled line (synthesis has no seek); "Hear it
   *  again" replays it from the top instead. */
  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = !!muted;
    if (this.muted) this.silence();
    this.changed();
  }

  /** The plate's own "Quiet the voices" (§12.4), the second gate. */
  quiet(suppressed: boolean): void {
    if (this.disposed) return;
    this.suppressed = !!suppressed;
    if (this.suppressed) this.silence();
    this.changed();
  }

  private isMuted(): boolean {
    return this.host.isMuted ? !!this.host.isMuted() : sound.muted;
  }

  /** Everything that stops speech, in one place. */
  private blocked(): boolean {
    return (
      this.disposed ||
      this.modeValue === "silent" ||
      !this.armedValue ||
      this.muted ||
      this.suppressed ||
      this.completed ||
      this.surfaceValue !== "battles" ||
      !this.synth
    );
  }

  // -------------------------------------------------------------------------
  // §5.3 / §5.4 the plate's cue in, speech out
  // -------------------------------------------------------------------------
  /** THE WIRE. Called with exactly the `cue` prop the plate renders (and with
   *  null when the plate has no cue). No second observer, no invented line. */
  cue(next: VoiceCue | null): void {
    if (this.disposed) return;
    this.ensureAssignment();
    const previous = this.current;
    this.current = next ?? null;

    if (!next) {
      // The plate retired its line. A decision-bearing cue is cancelled the
      // moment the player acts (§5.4); a colour line finishes what it started.
      if (previous && previous.retireOn === "decision") {
        this.silence();
        this.nextLineGap = VOICE_CONFIG.gaps.turn;
      }
      this.changed();
      return;
    }

    if (this.blocked()) {
      this.silence();
      this.changed();
      return;
    }
    if (next.id === this.speaking?.id) {
      this.changed();
      return;
    }
    if (this.spokenIds.has(next.id)) {
      this.changed();
      return;
    }
    if (!this.armedValue) {
      // §5.2 at most ONE line is held until the first gesture
      this.held = next;
      this.changed();
      return;
    }
    if (this.speaking) {
      // §5.3 supersede = cancel-and-replace: two voices, or one voice trailing
      // behind the screen, both read as broken.
      const gap = VOICE_CONFIG.gaps.supersede;
      this.silence();
      this.timer(() => this.start(next), gap);
      this.changed();
      return;
    }
    this.enqueue(next, true);
    this.changed();
  }

  /** §5.3 the bounded FIFO. `MAX_QUEUE = 2`; a third arriving line drops the
   *  OLDEST waiting line — never the one speaking, never the newest. The plate
   *  path (`cue`) only ever holds one line, so this door exists for the rail
   *  tier and for re-entrant scheduling. */
  enqueue(cue: VoiceCue, immediate = false): void {
    if (this.disposed) return;
    this.ensureAssignment();
    if (this.blocked()) return;
    if (this.spokenIds.has(cue.id) && !immediate) return;
    this.queue.push(cue);
    while (this.queue.length > VOICE_CONFIG.maxQueue) this.queue.shift();
    if (!this.speaking) this.pump();
  }

  private pump(): void {
    if (this.disposed || this.blocked() || this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    const delay = Math.max(this.nextLineGap, Math.max(0, this.stageBoundary - this.now()));
    this.nextLineGap = 0;
    this.stageBoundary = 0;
    if (delay > 0) {
      this.speaking = next;
      this.timer(() => {
        if (this.speaking === next) this.startSpeaking(next);
      }, delay);
      return;
    }
    this.start(next);
  }

  private start(cue: VoiceCue): void {
    if (this.disposed || this.blocked()) return;
    this.speaking = cue;
    this.startSpeaking(cue);
  }

  private startSpeaking(cue: VoiceCue): void {
    const dir = voiceDirectionFor(cue.speaker.id) ?? VOICE_DIRECTIONS.narrator;
    const pieces = speakable(cue.line, { direction: dir, scene: VOICE_SCENE_BY_CUE[cue.id] });
    if (pieces.length === 0) {
      this.finish();
      return;
    }
    this.spokenIds.add(cue.id);
    const gen = this.generation;
    this.speakPieces(cue, dir, pieces, 0, gen);
  }

  private speakPieces(cue: VoiceCue, dir: VoiceDirection, pieces: readonly SpokenPiece[], index: number, gen: number): void {
    if (gen !== this.generation) return;
    if (index >= pieces.length) {
      this.afterLine(dir, pieces, gen);
      return;
    }
    const piece = pieces[index];
    // the Chorus's tail hold comes AFTER its spoken echo, not before it
    const gap = index === pieces.length - 1 && dir.echoFinalWord ? 0 : piece.gapAfterMs;
    this.say(piece.text, dir, dir.rate * piece.rateScale, dir.pitch * piece.pitchScale, () => {
      this.timer(() => this.speakPieces(cue, dir, pieces, index + 1, gen), gap);
    });
  }

  /** §1 the Chorus only: 120 ms after the line, the final word alone, slow and
   *  low, then the 900 ms that is the last syllable bleeding through the cut. */
  private afterLine(dir: VoiceDirection, pieces: readonly SpokenPiece[], gen: number): void {
    if (dir.echoFinalWord) {
      const last = pieces[pieces.length - 1]?.text ?? "";
      const word = last.split(/\s+/).filter(Boolean).pop() ?? "";
      this.timer(
        () => {
          if (gen !== this.generation) return;
          this.say(word, dir, 0.6, 0.3, () => this.timer(() => this.finish(), dir.tailGapMs));
        },
        VOICE_CONFIG.gaps.chorusEcho,
      );
      return;
    }
    this.finish();
  }

  /** One utterance, with the speaker's seat and the duck around it. */
  private say(text: string, dir: VoiceDirection, rate: number, pitch: number, done: () => void): void {
    const synth = this.synth;
    if (!synth || this.blocked() || text.trim().length === 0) {
      done();
      return;
    }
    try {
      const u = this.makeUtterance(text);
      if (!u) {
        done();
        return;
      }
      u.text = text;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = dir.volume;
      const seat = this.assignment?.byId[dir.id];
      if (seat?.voiceName) {
        const voice = this.findVoice(seat.voiceName, seat.voiceURI);
        if (voice) u.voice = voice;
      }
      u.lang = seat?.lang ?? dir.langPrefs[0] ?? "en-GB";
      u.onstart = () => {
        this.errors = 0;
        this.hasSpoken = true;
        this.frozen = true;
        this.duck(true);
      };
      u.onend = () => {
        this.duck(false);
        done();
      };
      // §5.7 an error is not an event: swallow it, and after two in a row go
      // silent for the session (no retry loop, no console noise, no toast).
      u.onerror = () => {
        this.duck(false);
        this.errors += 1;
        if (this.errors >= VOICE_CONFIG.maxConsecutiveErrors) this.setMode("silent");
        done();
      };
      synth.speak(u);
    } catch {
      // §5.4 a failed speak() never delays, disables or reorders an order
      done();
    }
  }

  private findVoice(name: string, uri: string | null): VoiceLike | null {
    const synth = this.synth;
    if (!synth) return null;
    try {
      const voices = synth.getVoices() ?? [];
      return voices.find((v) => v.name === name && (!uri || !v.voiceURI || v.voiceURI === uri))
        ?? voices.find((v) => v.name === name)
        ?? null;
    } catch {
      return null;
    }
  }

  private finish(): void {
    this.speaking = null;
    this.pump();
    this.changed();
  }

  // -------------------------------------------------------------------------
  // §5.5 tab switch, backgrounding, stage change, exit
  // -------------------------------------------------------------------------
  /** The surface a line belongs to. Leaving `battles` cancels and drops it —
   *  narration never follows the player to the Lab; returning re-speaks the
   *  still-active cue once (it was cut, not finished). */
  surface(surface: VoiceSurface): void {
    if (this.disposed || surface === this.surfaceValue) return;
    const leaving = this.surfaceValue;
    this.surfaceValue = surface;
    if (surface !== "battles") this.silence();
    else if (leaving !== "battles" && this.current) {
      this.spokenIds.delete(this.current.id);
      this.enqueue(this.current, true);
    }
    this.changed();
  }

  /** `visibilitychange → hidden`: cancel and clear the queue. `pause()` is never
   *  used (it is unreliable on Android/iOS and can strand the session). */
  private onVisibility = (): void => {
    if (this.disposed) return;
    const hidden = typeof document !== "undefined" ? !!document.hidden : false;
    this.visibility(hidden);
  };

  visibility(hidden: boolean): void {
    if (this.disposed) return;
    if (hidden) {
      this.silence();
      return;
    }
    // back again: re-speak the active cue once, from the top, if the plate is
    // still showing it (its battle is open) and the opening is not over
    if (this.current && !this.blocked()) {
      this.spokenIds.delete(this.current.id);
      this.enqueue(this.current, true);
    }
  }

  /** §5.5 a prologue stage change always beats a queued Act I line: cancel,
   *  clear, reset the per-battle ids, then hold 800 ms before the first new one.
   *  A stage change is not a line to be deferred — it is the Fall. */
  stage(stage: string | null): void {
    if (this.disposed) return;
    const first = this.stageValue === null;
    const changed = !first && stage !== this.stageValue;
    this.stageValue = stage ?? null;
    if (!changed) return;
    this.silence();
    this.spokenIds.clear();
    this.stageBoundary = this.now() + VOICE_CONFIG.gaps.stageChange;
  }

  /** §5.5 the Act III handoff: the opening is over, so the engine disarms for
   *  the session. The rebuild screens are silent apart from the UI blips. */
  complete(done: boolean): void {
    if (this.disposed) return;
    const next = !!done;
    if (next === this.completed) return;
    this.completed = next;
    if (this.completed) this.silence();
    this.changed();
  }

  /** The battle the plate is showing — "never speak the same cue twice" is a
   *  PER-BATTLE rule, so a new front resets the ids. */
  battle(battleId: string | null): void {
    if (this.disposed) return;
    const next = battleId ?? null;
    if (next === this.battleId) return;
    this.battleId = next;
    this.silence();
    this.spokenIds.clear();
    this.held = null;
  }

  /** "Hear it again": replay that line from the top (§5.1 — the mute still
   *  wins; the plate keeps showing the caption either way). */
  replay(cueId: string | null): void {
    if (this.disposed) return;
    const id = cueId ?? this.current?.id ?? null;
    if (!id) return;
    this.spokenIds.delete(id);
    const cue = this.current && this.current.id === id ? this.current : null;
    if (!cue || this.blocked()) {
      this.changed();
      return;
    }
    this.silence();
    // §3.4 #10: it must feel like a reply
    this.timer(() => this.enqueue(cue, true), VOICE_CONFIG.gaps.hearAgain);
    this.changed();
  }

  /** Unmount / route change: no dangling timer, no queue across a remount. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.silence();
    this.clearTimers();
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------
  /** Stop everything, now, and invalidate every scheduled continuation. */
  private silence(): void {
    this.generation += 1;
    this.speaking = null;
    this.queue = [];
    this.clearTimers();
    this.duck(false);
    try {
      this.synth?.cancel();
    } catch {
      /* a platform that throws on cancel is a platform we stop asking */
    }
  }

  /** §2.6 the session never speaks again unless a `voiceschanged` arrives inside
   *  the first 60 s of Act I and before the first utterance. */
  private setMode(mode: VoiceMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.host.debug?.(`voice: ${mode}`);
    this.changed();
  }

  /** Assignment runs once, in the §2.3 cast order, and is then frozen. */
  private ensureAssignment(): void {
    if (this.assignment) return;
    const synth = this.synth;
    if (!synth) {
      this.setMode("silent");
      return;
    }
    let voices: VoiceLike[] = [];
    try {
      voices = synth.getVoices() ?? [];
    } catch {
      voices = [];
    }
    this.assignment = assignCast(voices);
    if (this.assignment.mode === "silent") {
      this.setMode("silent");
      this.retryOnVoicesChanged();
    } else {
      this.setMode(this.assignment.mode);
    }
  }

  private retryOnVoicesChanged(): void {
    const synth = this.synth;
    if (!synth || this.retriedVoices || !synth.addEventListener) return;
    this.retriedVoices = true;
    const deadline = this.now() + 2_000; // §2.1: re-try ONCE, 2 s cap
    const onChanged = () => {
      if (this.frozen || this.hasSpoken) return;
      if (this.now() > deadline) return;
      // §2.6: the only chance to re-cast is inside the first 60 s of Act I
      if (this.now() - this.sessionStart > VOICE_CONFIG.voicesChangedWindowMs) return;
      let voices: VoiceLike[] = [];
      try {
        voices = synth.getVoices() ?? [];
      } catch {
        voices = [];
      }
      if (voices.length === 0) return;
      this.assignment = assignCast(voices);
      this.setMode(this.assignment.mode);
      synth.removeEventListener?.("voiceschanged", onChanged);
    };
    try {
      synth.addEventListener("voiceschanged", onChanged);
      // the 2 s cap: stop waiting, quietly, and stay silent for the session
      this.timer(() => synth.removeEventListener?.("voiceschanged", onChanged), 2_000);
    } catch {
      /* no event target: the one retry is simply unavailable */
    }
  }

  private makeUtterance(text: string): UtteranceLike | null {
    const make = this.host.makeUtterance ?? defaultUtterance;
    try {
      return make(text);
    } catch {
      return null;
    }
  }

  private duck(on: boolean): void {
    const fn = this.host.duck ?? ((v: boolean) => sound.duck(v));
    try {
      fn(on);
    } catch {
      /* audio is an enhancement too */
    }
  }

  private now(): number {
    return this.host.now ? this.host.now() : Date.now();
  }

  private timer(fn: () => void, ms: number): void {
    if (ms <= 0) {
      fn();
      return;
    }
    const set = this.host.setTimer ?? ((f: () => void, delay: number) => setTimeout(f, delay) as unknown);
    let id: unknown = null;
    id = set(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    const clear = this.host.clearTimer ?? ((id: unknown) => clearTimeout(id as number));
    for (const id of this.timers) {
      try {
        clear(id);
      } catch {
        /* nothing to clear */
      }
    }
    this.timers.clear();
  }

  private changed(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* a broken listener must never stop the plate rendering */
      }
    }
  }

  /** Test/app seam: the assignment, forced (never called by the UI). */
  ensureAssigned(): void {
    this.ensureAssignment();
  }
}

export function createVoiceEngine(host: VoiceHost = {}): VoiceEngine {
  return new VoiceEngine(host);
}

/** THE session engine. One instance for the whole app session: §2 freezes the
 *  assignment for the session, so a remount must not re-cast the story. */
export const voiceEngine = createVoiceEngine();

/** The §2.7 hook the plate renders on its root — the value always comes from the
 *  engine, so the attribute can never disagree with what is actually speaking. */
export const VOICE_MODE_ATTRIBUTE = VOICE_CONFIG.modeAttribute;
