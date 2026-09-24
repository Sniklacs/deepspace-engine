// VOICE DIRECTION — The Fall's voices on the browser's own speech synthesis.
//
// design/prologue-voice-direction.md is the spec this file implements, and it
// is implementation-ready: nothing here is re-decided, only transcribed.
// Owner decision 2026-09-23: the prologue speaks through `window.speechSynthesis`
// — free, no external service, no generated audio files, the script unchanged
// and casting-ready (actors drop in later as a polish pass).
//
// What lives here (§9.1 of the sheet): the §1 per-speaker direction table (the
// nine principals + the other seven heroes), the §2.3 cast order, the §2.4
// ladders and fallback chains, the §4.4 pronunciation lexicon, the §3.4 gap
// map, and every tunable in ONE `VOICE_CONFIG` block.
//
// PURITY (asserted by prologue-tests/voice-verify.ts): no DOM, no React, no
// `window`/`document`, no Math.random, no Date.now(), no store/auth/engine
// import, no persisted state. This module is a table plus deterministic
// selection — the same voice list always yields the same cast.
//
// The three things the sheet says about the honest limits of this (agent-lead
// accepted, 2026-09-24):
//   • browser synthesis cannot act — rate/pitch/voice-class and where we cut is
//     the whole expressive range we have (§7);
//   • the Chorus cannot be layered (§8 Q3: the no-overlap rule stands);
//   • Beat 1.3's eight heroes are the weakest separation case and R3 is
//     knowingly unsatisfiable for three same-class pairs there (§7) — see
//     ADJACENT_GROUPS and the exception list below.
import type { RaceId } from "../types";

// ============================================================================
// §0 · TUNABLES — one block. Numbers only; no rule in this file moves with them.
// ============================================================================
export const VOICE_CONFIG = {
  /** §1 design bands. The table must sit inside these; nothing is ever clamped
   *  at runtime (a clamped value would mean the TABLE is wrong, not the
   *  browser). R2 in the harness. */
  rateBand: [0.72, 1.06] as const,
  pitchBand: [0.3, 1.35] as const,
  /** §1 the only volumes the cast may use (per-speaker volume is NOT a
   *  character channel — §1 "Volume, honestly"). */
  volumes: [0.85, 0.9, 0.95, 1.0] as const,

  /** §3.5 the real browser bug: desktop Chrome can cut a long utterance off
   *  after ~15 s. No utterance exceeds this many characters, or roughly 12 s
   *  at the modelled speaking rate. */
  maxUtteranceChars: 180,
  maxUtteranceSeconds: 12,
  /** §3.5 modelling constant: characters per second at rate 1.00 (≈135 wpm at
   *  rate 0.9). Used only to check the 12 s cap in the harness. */
  charsPerSecond: 15,

  /** §3.4 the pause map. Every beat is SCHEDULING — Chrome and Safari ignore
   *  SSML — so each number is a gap the scheduler owns. One gap owner: the
   *  engine clears them with cancel(). */
  gaps: {
    /** 1 · `(beat)` inside a line — 320 ms in Act I, 520 ms in Act II. */
    beatActI: 320,
    beatActII: 520,
    /** 2 · between two speaker turns in one shot (the five medallions, 1.1). */
    turn: 450,
    /** 3 · after a decision window opens, before its cue. */
    decision: 400,
    /** 4 · the [SILENCE] after Kael's question in 2.4 — no speech. */
    silenceShort: 1200,
    /** 5 · Beat 2.5, two full beats of black — no speech. */
    silenceTwo: 1600,
    /** 6 · after every Oracle line. */
    oracleTail: 600,
    /** 7 · the Chorus: onend → echo word → after the echo. */
    chorusEcho: 120,
    chorusTail: 900,
    /** 8 · on a prologue stage change, before the first new line. */
    stageChange: 800,
    /** 9 · Act III, after "Rebuild. Remember. Climb." — the thesis. */
    thesis: 700,
    /** 10 · after "Hear it again" is pressed. */
    hearAgain: 150,
    /** — · ellipsis: a real hold, plus the split. */
    ellipsis: 320,
    /** §3.5 the gap between the pieces of a capped line. */
    split: 90,
    /** §4.7 emphasis: the gap either side of an emphasised clause. */
    emphasis: 90,
    /** §5.3 a superseded line: cancel, then speak the new one after this. */
    supersede: 90,
    /** §5.6 the music duck ramps (ms) — the values `sound.duck()` uses. */
    duckIn: 120,
    duckOut: 400,
  },

  /** §5.3 one utterance in flight, ever; a third waiting line drops the
   *  OLDEST waiting line (never the one speaking, never the newest). */
  maxQueue: 2,
  /** §5.2 iOS priming: one character, silent, inside the first gesture. If the
   *  platform still refuses (no onstart within this window) → silent mode. */
  primeText: ".",
  primeTimeoutMs: 800,
  /** §2.6 the session is frozen once it speaks: the only chance to re-assign
   *  from a late `voiceschanged` is inside this window of Act I and before the
   *  first utterance. After that a mid-story voice swap is never allowed. */
  voicesChangedWindowMs: 60_000,
  /** §5.7 two consecutive utterance errors → silent for the session. */
  maxConsecutiveErrors: 2,

  /** §3.2 authoring caps (they keep the voice from pacing the game): the whole
   *  authored opening is ≈11½ minutes of speech inside a 120-minute window. */
  maxCueWords: 50,
  maxCuesPerMin: 3,
  /** §3.2 duty rule: no more than 45 s of speech inside any rolling 60 s. */
  dutySecondsPerMinute: 45,
  /** §3.2 Act I's authored speech may never exceed 12 minutes. */
  actIMaxSeconds: 720,

  /** §2.7 the test hook attribute written on the cue-layer root. */
  modeAttribute: "data-voice-mode",
  /** §6.3 the one new visual affordance: an existing `.chip`. */
  soundOffChip: "sound off",
} as const;

// ============================================================================
// §1 · THE CAST TABLE
// ============================================================================
export type VoiceClass = "DEEP" | "LOW-FEM" | "CLEAR-WARM" | "CLEAR" | "MACHINE";
export type VoiceKind = "narrator" | "leader" | "hero" | "oracle" | "chorus";

export interface VoiceDirection {
  /** The handle the cue table / the beat rail addresses this speaker by. */
  id: string;
  /** The caption label (identical to `speakerLabel(TUTORIAL_SPEAKERS[id])`). */
  label: string;
  kind: VoiceKind;
  voiceClass: VoiceClass;
  rate: number;
  pitch: number;
  volume: number;
  /** §2.4 the fallback chain (its class ladder first, then the next class). */
  chain: readonly VoiceClass[];
  /** §2.4 inside a rung: the lang preference order (a hint, never equality). */
  langPrefs: readonly string[];
  /** §2.4 front-loaded names inside a rung (the Oracle's odd/androgynous
   *  preference). Empty for everyone else. */
  frontLoaded: readonly string[];
  /** §1 what the numbers are FOR — one line, for the actor brief later. */
  intent: string;
  /** §1 how it is told apart by ear. */
  ear: string;
  /** Delen only: split at every comma, 220 ms (§1 "words placed like stones"). */
  splitAtCommas: boolean;
  /** The Oracle and the Chorus are never split anywhere (§1) — except by the
   *  hard browser-bug cap, which a cut-off utterance would violate worse. */
  neverSplit: boolean;
  /** The Chorus: after onend, 120 ms, then the final word alone at 0.60/0.30. */
  echoFinalWord: boolean;
  /** Silence the scheduler holds AFTER this speaker's line (§3.4 #6/#7). */
  tailGapMs: number;
  /** §2.3 the Chorus runs first and its match is reserved for it alone. */
  reservesMachine: boolean;
}

/** The five Leaders' chain wording comes straight from §2.4; the seven heroes
 *  are given the class's own natural second rung (the sheet fixes their class,
 *  rate, pitch and volume, and says nothing about a bespoke chain). */
const SECOND_RUNG: Record<VoiceClass, VoiceClass> = {
  DEEP: "CLEAR-WARM",
  "LOW-FEM": "DEEP",
  "CLEAR-WARM": "CLEAR",
  CLEAR: "CLEAR-WARM",
  MACHINE: "DEEP",
};

const WATCHERS_LANGS = ["en-US"] as const;
const BRITISH_FIRST = ["en-GB", "en-US"] as const;

/** §1 · PER-SPEAKER DIRECTION TABLE. Every value is transcribed, not tuned. */
export const VOICE_DIRECTIONS: Readonly<Record<string, VoiceDirection>> = {
  // -- the principal narration voice -----------------------------------------
  narrator: {
    id: "narrator",
    label: "The Narrator",
    kind: "narrator",
    voiceClass: "DEEP",
    rate: 0.86,
    pitch: 0.9,
    volume: 1.0,
    chain: ["DEEP", "CLEAR-WARM"],
    langPrefs: BRITISH_FIRST,
    frontLoaded: [],
    intent: "The world's voice — unhurried, warm-edged steel; never rousing (the music carries the adrenaline).",
    ear: "Second-slowest rate in the cast, top of the mix, the only speaker whose lines run over 20 words in one breath; pauses between sentences, not inside them.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  // -- the five named Leaders (owner-ratified roster) ------------------------
  kael: {
    id: "kael",
    label: "Kael — the Steward",
    kind: "leader",
    voiceClass: "DEEP",
    rate: 1.0,
    pitch: 1.06,
    volume: 0.9,
    chain: ["DEEP", "CLEAR-WARM"],
    langPrefs: BRITISH_FIRST,
    frontLoaded: [],
    intent: "Your oldest friend; dry humour, the one whose voice breaks the least.",
    ear: "Baseline rate + the highest pitch among the DEEP men — reads as unbothered against the Narrator's drag and Serev's clip. Only Kael gets the comma-hold before an aside.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  serev: {
    id: "serev",
    label: "Serev — the Marshal",
    kind: "leader",
    voiceClass: "LOW-FEM",
    rate: 1.06,
    pitch: 0.72,
    volume: 0.9,
    chain: ["LOW-FEM", "DEEP"],
    langPrefs: ["en-GB", "en-IE", "en-US"],
    frontLoaded: [],
    intent: "Terse, flat, no fear; commands land, they do not rise.",
    ear: "Fastest rate in the cast + the lowest pitch of the leaders + the shortest sentences (10–20 words); she never gets a three-sentence line.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  vyra: {
    id: "vyra",
    label: "Vyra — the Scholar",
    kind: "leader",
    voiceClass: "CLEAR-WARM",
    rate: 0.92,
    pitch: 1.06,
    volume: 0.9,
    chain: ["CLEAR-WARM", "CLEAR"],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "Warm, close, a smile in it even in darkness; mentor-mother.",
    ear: "Mid-slow rate + high pitch + long clauses kept whole (never split) — the leaning-in read.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  miren: {
    id: "miren",
    label: "Miren — the Quartermaster",
    kind: "leader",
    voiceClass: "LOW-FEM",
    rate: 1.0,
    pitch: 0.88,
    volume: 0.9,
    chain: ["LOW-FEM", "CLEAR-WARM"],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "Dry, precise, numbers-first; a ledger's cadence.",
    ear: "Exactly baseline in both rate and pitch (deliberately the most neutral speaker) — the contrast with Vyra's warmth and Serev's clip is the character.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  delen: {
    id: "delen",
    label: "Delen — the Purifier",
    kind: "leader",
    voiceClass: "DEEP",
    rate: 0.8,
    pitch: 0.66,
    volume: 0.9,
    chain: ["DEEP", "LOW-FEM"],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "Quiet, measured, near-riddle; words placed like stones.",
    ear: "Second-slowest rate + very low pitch, and the only speaker whose line is split at every comma (220 ms gaps) — the stones are literal.",
    splitAtCommas: true,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  // -- marquee hero (first to be replaced by an actor, flag P9) --------------
  lecturer: {
    id: "lecturer",
    label: "The Last Lecturer",
    kind: "hero",
    voiceClass: "DEEP",
    rate: 1.04,
    pitch: 1.2,
    volume: 1.0,
    chain: ["DEEP", "CLEAR"],
    langPrefs: BRITISH_FIRST,
    frontLoaded: [],
    intent: "Sharp, professorial, bitter-but-alive; still giving the lecture that damned the world.",
    ear: "Fastest speaker in the story + the highest pitch of the DEEP class + the shortest line in Act I (9 words). Indignation is expressed as speed, not loudness.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  // -- the two other voices of the world -------------------------------------
  oracle: {
    id: "oracle",
    label: "The Oracle",
    kind: "oracle",
    voiceClass: "CLEAR",
    rate: 0.92,
    pitch: 1.3,
    volume: 0.95,
    chain: ["CLEAR", "CLEAR-WARM"],
    langPrefs: BRITISH_FIRST,
    frontLoaded: ["rishi", "oliver", "tessa", "moira", "google uk english"],
    intent: "Amused, joker-like, playful; drawn vowels and a laugh just under the words.",
    ear: "Highest pitch in the cast + the only speaker whose rate never varies and whose lines are never split anywhere, + a 600 ms hold after every line.",
    splitAtCommas: false,
    neverSplit: true,
    echoFinalWord: false,
    tailGapMs: VOICE_CONFIG.gaps.oracleTail,
    reservesMachine: false,
  },
  chorus: {
    id: "chorus",
    label: "The Chorus",
    kind: "chorus",
    voiceClass: "MACHINE",
    rate: 0.72,
    pitch: 0.3,
    volume: 1.0,
    chain: ["MACHINE", "DEEP"],
    langPrefs: BRITISH_FIRST,
    frontLoaded: [],
    intent: "No emotion, vast attention; flat, then a stutter-glitch on the final word.",
    ear: "Slowest rate, lowest possible pitch, one single utterance never split, sentence-cased, a spoken repeat of the final word, then a 900 ms silence.",
    splitAtCommas: false,
    neverSplit: true,
    echoFinalWord: true,
    tailGapMs: VOICE_CONFIG.gaps.chorusTail,
    reservesMachine: true,
  },
  // -- the other seven heroes (§1, fixed so nothing is re-decided) ----------
  "azazel-3": {
    id: "azazel-3",
    label: "Azazel-3, the Teacher",
    kind: "hero",
    voiceClass: "DEEP",
    rate: 0.84,
    pitch: 0.78,
    volume: 1.0,
    chain: ["DEEP", SECOND_RUNG.DEEP],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "The teacher who taught the lesson the war answered.",
    ear: "Slow, low, steady — the lecture voice underneath.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  "chained-syllabus": {
    id: "chained-syllabus",
    label: "The Chained Syllabus",
    kind: "hero",
    voiceClass: "DEEP",
    rate: 0.88,
    pitch: 0.56,
    volume: 0.95,
    chain: ["DEEP", SECOND_RUNG.DEEP],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "Bound knowledge; the voice that has not been allowed to speak.",
    ear: "Deep and slow, sunk below the other DEEP voices.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  "unwritten-answer": {
    id: "unwritten-answer",
    label: "The Unwritten Answer",
    kind: "hero",
    voiceClass: "CLEAR-WARM",
    rate: 0.9,
    pitch: 0.8,
    volume: 0.85,
    chain: ["CLEAR-WARM", SECOND_RUNG["CLEAR-WARM"]],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "The least of the mix (0.85) — the answer nobody wrote down.",
    ear: "Warm but low and quiet; the only speaker at 0.85 volume.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  semira: {
    id: "semira",
    label: "Semira the Revealer",
    kind: "hero",
    voiceClass: "CLEAR",
    rate: 1.06,
    pitch: 1.2,
    volume: 1.0,
    chain: ["CLEAR", SECOND_RUNG.CLEAR],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "She sees the flaw and says so — bright, quick, certain.",
    ear: "Fast and high: the brightest CLEAR voice in a Leader's range.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  "brother-candle": {
    id: "brother-candle",
    label: "Brother Candle",
    kind: "hero",
    voiceClass: "CLEAR-WARM",
    rate: 0.94,
    pitch: 0.92,
    volume: 0.95,
    chain: ["CLEAR-WARM", SECOND_RUNG["CLEAR-WARM"]],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "Small atonement, kept light — gentle and even.",
    ear: "Mid warmth, mid pitch: the calmest of the heroes.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  vesper: {
    id: "vesper",
    label: "Vesper the Syllabus",
    kind: "hero",
    voiceClass: "CLEAR",
    rate: 0.98,
    pitch: 0.92,
    volume: 0.95,
    chain: ["CLEAR", SECOND_RUNG.CLEAR],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "The route is already in the syllabus — patient, exact.",
    ear: "The lowest pitch of the CLEAR voices: the tactician's read.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
  "keeper-mend": {
    id: "keeper-mend",
    label: "Keeper Mend",
    kind: "hero",
    voiceClass: "CLEAR",
    rate: 1.0,
    pitch: 1.08,
    volume: 0.95,
    chain: ["CLEAR", SECOND_RUNG.CLEAR],
    langPrefs: WATCHERS_LANGS,
    frontLoaded: [],
    intent: "The ledger never lies — she prices what the others will not.",
    ear: "Baseline rate, a touch above neutral pitch: the accountant's certainty.",
    splitAtCommas: false,
    neverSplit: false,
    echoFinalWord: false,
    tailGapMs: 0,
    reservesMachine: false,
  },
};

/** §2.3 · THE CAST ORDER — assignment runs once, in this order, each character
 *  taking a voice no earlier character took. The Chorus runs FIRST and its
 *  match is reserved, so a novelty/machine voice is never handed to a human. */
export const CAST_ORDER: readonly string[] = [
  "chorus",
  "narrator",
  "kael",
  "serev",
  "vyra",
  "miren",
  "delen",
  "lecturer",
  "oracle",
  "azazel-3",
  "chained-syllabus",
  "unwritten-answer",
  "semira",
  "brother-candle",
  "vesper",
  "keeper-mend",
];

/** The shipped hero-roster ids (heroes-data.ts) → the voice handle above. Two
 *  names of the same hero, one direction: the cue table's handles are the
 *  sheet's, and the roster's ids resolve to them so the beat rail can look a
 *  hero up by its own id without a second table. */
export const VOICE_ID_ALIASES: Readonly<Record<string, string>> = {
  "azazel-3": "azazel-3",
  "chained-syllabus": "chained-syllabus",
  "last-lecturer": "lecturer",
  "unwritten-answer": "unwritten-answer",
  "semira-revealer": "semira",
  "brother-candle": "brother-candle",
  "vesper-syllabus": "vesper",
  "keeper-mend": "keeper-mend",
};

/** Resolve any speaker handle (cue-table id, roster id, alias) to a direction. */
export function voiceDirectionFor(id: string): VoiceDirection | undefined {
  return VOICE_DIRECTIONS[id] ?? VOICE_DIRECTIONS[VOICE_ID_ALIASES[id] ?? ""];
}

/** §1 · R1/R3's checkable groups — the speakers who can be TEMPORALLY ADJACENT
 *  in the opening. Beat 1.3 is the sheet's own stated weak case (§7). */
export const ADJACENT_GROUPS: readonly { beat: string; ids: readonly string[]; note: string }[] = [
  { beat: "1.1", ids: ["kael", "serev", "vyra", "miren", "delen"], note: "the five Leaders, one beat" },
  {
    beat: "1.3",
    ids: ["azazel-3", "chained-syllabus", "lecturer", "unwritten-answer", "semira", "brother-candle", "vesper", "keeper-mend"],
    note: "eight hero intros — the weakest case in the opening (§7): pitch spread plus the plate naming each speaker",
  },
  { beat: "2.3", ids: ["kael", "serev", "vyra", "miren", "delen"], note: "the Leaders' stand" },
];

/** The Beat 1.3 pairs where R3's *rate* criterion is knowingly unmet (§7). The
 *  harness asserts these are the ONLY ones, and that R1's 0.10 pitch gap still
 *  separates them — the honest floor the sheet describes. */
export const R3_RATE_EXCEPTIONS: readonly (readonly [string, string])[] = [
  // §7: Beat 1.3 is the sheet's stated weak case — eight hero intros in a row.
  // Measured over the locked §1 table, these are the pairs where the rate gap
  // cannot carry the rule; the pitch/class gap still separates every one.
  ["azazel-3", "chained-syllabus"],
  ["unwritten-answer", "brother-candle"],
  ["brother-candle", "vesper"],
  ["vesper", "keeper-mend"],
  ["lecturer", "semira"],
];

// ============================================================================
// §2.4 · THE LADDERS — regex hints tested against `voice.name` (case
// insensitive). A hint is a hint, never an equality check: names change with
// OS updates.
// ============================================================================
export const VOICE_LADDER_SOURCES: Readonly<Record<VoiceClass, string>> = {
  DEEP: "alex|daniel|(microsoft )?(david|mark|guy)|google uk english male|arthur|oliver|rishi|aaron|fred",
  "LOW-FEM": "moira|fiona|tessa|karen|(microsoft )?(hazel|susan|sonia|libby)|serena|google uk english female",
  "CLEAR-WARM": "samantha|(microsoft )?(zira|aria|jenny|michelle|emma|ava)|google us english|victoria|allison|nicky|martha",
  CLEAR: "tessa|(microsoft )?(aria|jenny|emma|michelle)|google us english|samantha|victoria",
  /** Chorus only, reserved (§2.3). `fred` is also a DEEP name: the Chorus runs
   *  first, so a Fred in the pool becomes the machine voice and DEEP takes the
   *  next rung — a documented consequence of the reservation, not a bug. */
  MACHINE: "zarvox|trinoids|albert|fred|whisper|bells|boing|bad news|good news|jester|organ|superstar|espeak|mbrola",
};

const LADDER_CACHE = new Map<VoiceClass, RegExp>();
/** The compiled ladder for a class (deterministic, built once). */
export function ladderFor(voiceClass: VoiceClass): RegExp {
  let re = LADDER_CACHE.get(voiceClass);
  if (!re) {
    re = new RegExp(VOICE_LADDER_SOURCES[voiceClass], "i");
    LADDER_CACHE.set(voiceClass, re);
  }
  return re;
}

// ============================================================================
// §2 · VOICE SELECTION — deterministic, portable, exclusive
// ============================================================================
export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI?: string;
}

export interface CastSeat {
  /** The voice this character got (null only when the cast is silent). */
  voiceName: string | null;
  voiceURI: string | null;
  lang: string | null;
  /** §2.5 every usable voice was already taken: this character shares one. */
  shared: boolean;
  /** How the seat was reached — harness/ear-check evidence. */
  via: "ladder" | "index-fallback" | "share";
}

export type VoiceMode = "voiced" | "silent" | "shared";

export interface CastAssignment {
  mode: VoiceMode;
  byId: Record<string, CastSeat>;
  /** Voices in the canonical pool no character took. */
  unused: readonly string[];
}

/** §2.1 · the canonical pool: English voices only (`en_GB` counts). If that is
 *  empty, keep every voice — an accented read beats silence. */
export function canonicalPool(voices: readonly VoiceLike[]): VoiceLike[] {
  const english = voices.filter((v) => normaliseLang(v.lang).startsWith("en"));
  return english.length > 0 ? english : [...voices];
}

export function normaliseLang(lang: string | undefined | null): string {
  return String(lang ?? "").replace(/_/g, "-").toLowerCase();
}

/** §2.2 · CANONICAL SORT — code-unit comparison on `name`, tie-broken by
 *  `voiceURI`. Never `localeCompare` with a locale: platform collation orders
 *  the same list differently on two devices, which is exactly how the cast
 *  would drift. */
export function canonicalOrder(voices: readonly VoiceLike[]): VoiceLike[] {
  return [...voices].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const au = a.voiceURI ?? "";
    const bu = b.voiceURI ?? "";
    if (au === bu) return 0;
    return au < bu ? -1 : 1;
  });
}

/** §2.4 · inside a rung: the front-loaded names first, then the lang
 *  preference order, then canonical order. Fully deterministic. */
function rankCandidates(candidates: readonly VoiceLike[], dir: VoiceDirection): VoiceLike[] {
  const langRank = (v: VoiceLike): number => {
    const lang = normaliseLang(v.lang);
    const i = dir.langPrefs.findIndex((p) => lang.startsWith(normaliseLang(p)));
    return i < 0 ? 999 : i;
  };
  const frontRank = (v: VoiceLike): number => {
    if (dir.frontLoaded.length === 0) return 0;
    const name = v.name.toLowerCase();
    return dir.frontLoaded.some((f) => name.includes(f.toLowerCase())) ? 0 : 1;
  };
  return canonicalOrder(candidates).sort((a, b) => {
    const fa = frontRank(a);
    const fb = frontRank(b);
    if (fa !== fb) return fa - fb;
    const la = langRank(a);
    const lb = langRank(b);
    if (la !== lb) return la - lb;
    return 0;
  });
}

/**
 * §2.3–§2.5 · RUN THE CAST. Assignment runs once per session, in the fixed cast
 * order, and the result is frozen by the engine. Pure: same pool → same cast.
 *
 * 1. Each character walks its §2.4 chain; inside a rung the candidates are
 *    ranked (front-loaded names, lang preference, canonical order) and the
 *    first untaken voice wins (§2.3 exclusivity).
 * 2. When every rung misses: §2.5 index fallback — start at
 *    `CAST_INDEX % pool.length`, walk forward (wrapping) to the first untaken
 *    voice.
 * 3. When every usable voice is already taken the character shares, and the
 *    seat is marked `shared: true` (the engine then leans on R3's pitch
 *    spacing; a one-voice pool is the honest floor).
 * 4. An empty pool is not an error: mode `"silent"` (§2.6).
 */
export function assignCast(voices: readonly VoiceLike[]): CastAssignment {
  const pool = canonicalPool(voices);
  const byId: Record<string, CastSeat> = {};
  if (pool.length === 0) {
    for (const id of CAST_ORDER) {
      byId[id] = { voiceName: null, voiceURI: null, lang: null, shared: false, via: "ladder" };
    }
    return { mode: "silent", byId, unused: [] };
  }
  const taken = new Set<VoiceLike>();
  let anyShared = false;

  CAST_ORDER.forEach((id, castIndex) => {
    const dir = VOICE_DIRECTIONS[id];
    if (!dir) return;
    // 1 · the ladder chain
    for (const cls of dir.chain) {
      const re = ladderFor(cls);
      const candidates = rankCandidates(pool.filter((v) => re.test(v.name) && !taken.has(v)), dir);
      const pick = candidates[0];
      if (pick) {
        taken.add(pick);
        byId[id] = seat(pick, false, "ladder");
        return;
      }
    }
    // 2 · §2.5 deterministic index fallback, walking forward and wrapping
    const start = castIndex % pool.length;
    for (let step = 0; step < pool.length; step++) {
      const candidate = pool[(start + step) % pool.length];
      if (!taken.has(candidate)) {
        taken.add(candidate);
        byId[id] = seat(candidate, false, "index-fallback");
        return;
      }
    }
    // 3 · every usable voice is taken: share, and say so
    const shared = pool[start];
    anyShared = true;
    byId[id] = seat(shared, true, "share");
  });

  const unused = pool.filter((v) => !taken.has(v)).map((v) => v.name);
  return { mode: anyShared ? "shared" : "voiced", byId, unused };
}

function seat(voice: VoiceLike, shared: boolean, via: CastSeat["via"]): CastSeat {
  return {
    voiceName: voice.name,
    voiceURI: voice.voiceURI ?? null,
    lang: voice.lang,
    shared,
    via,
  };
}

// ============================================================================
// §3.4 / §3.2 · SCENES — the authoring caps and which cue belongs to which beat
// ============================================================================
/** §3.2 · the per-scene word budgets (the caps that keep the voice from
 *  becoming the pacing device). "actI" is the hard 12-minute authoring cap. */
export const SCENE_WORD_CAPS: Readonly<Record<string, number>> = {
  "1.0": 60,
  "1.1": 150,
  "1.2": 420,
  "1.3": 230,
  "1.4": 80,
  "1.5": 220,
  "1.6": 100,
  "1.7": 80,
  actI: 1340,
  actII: 420,
  actIII: 150,
};

/** Which Act I beat each of the 15 C-tier cues belongs to (§3.2: Beat 1.2 =
 *  battle one's tutorial + the recap; Beat 1.4 = the two cues that survive into
 *  battle two). The rail (R) tier is deliberately absent: it has no module yet
 *  and this slice must not invent one. */
export const VOICE_SCENE_BY_CUE: Readonly<Record<string, string>> = {
  "read-the-fight": "1.2",
  "read-the-chip": "1.2",
  "command-the-squad": "1.2",
  "semira-sees-the-flaw": "1.2",
  "time-the-skill": "1.2",
  "the-line-is-bending": "1.2",
  "reinforce-or-hold-why": "1.2",
  "pressing-ours": "1.2",
  "pummeled-is-a-decision": "1.2",
  "aid-call-rides-the-links": "1.2",
  "pummeled-is-survivable": "1.2",
  "watch-it-turn": "1.2",
  "withdrew-in-order": "1.2",
  "the-shape-of-it": "1.2",
  "you-know-the-shape": "1.4",
};

// ============================================================================
// §4.4 · THE PRONUNCIATION LEXICON — the only place a word is changed.
// Rule: respelling is applied ONLY to coined names and to words with a
// plausible wrong reading — never to a real English word the voice already says
// correctly (respelling a real word would CAUSE the error). LOCKED by
// agent-lead 2026-09-24 (§8 Q4); the owner may override, one line each.
// ============================================================================
export interface LexiconEntry {
  authored: string;
  spoken: string;
  why: string;
}

export const SPOKEN_LEXICON: readonly LexiconEntry[] = [
  // deliberately NOT respelled (listed so nobody "fixes" them later)
  { authored: "Chorus", spoken: "Chorus", why: "real word; synths say it correctly — do not respell" },
  { authored: "Cradle", spoken: "Cradle", why: "real word" },
  { authored: "Embers", spoken: "Embers", why: "real word" },
  { authored: "Watchers", spoken: "Watchers", why: "real word" },
  { authored: "Oracle", spoken: "Oracle", why: "real word" },
  { authored: "Ledger", spoken: "Ledger", why: "real word" },
  { authored: "Codex", spoken: "Codex", why: "real word" },
  { authored: "Chronicle", spoken: "Chronicle", why: "real word" },
  { authored: "Devotion", spoken: "Devotion", why: "real word" },
  { authored: "Purify", spoken: "Purify", why: "real word" },
  { authored: "Supplies", spoken: "Supplies", why: "real word" },
  { authored: "Expeditions", spoken: "Expeditions", why: "real word" },
  { authored: "Armory", spoken: "Armory", why: "real word" },
  { authored: "Votives", spoken: "Votives", why: "real word" },
  { authored: "Workshop", spoken: "Workshop", why: "real word" },
  { authored: "Covenants", spoken: "Covenants", why: "real word" },
  { authored: "Leaders", spoken: "Leaders", why: "real word" },
  { authored: "Heroes", spoken: "Heroes", why: "real word" },
  { authored: "circuit", spoken: "circuit", why: "real word" },
  { authored: "battles", spoken: "battles", why: "real word" },
  // respelled
  { authored: "Chipsets", spoken: "chip sets", why: "forces the compound's two-word reading" },
  { authored: "Codices", spoken: "Koh-duh-seez", why: "the one word with a real mangling risk (§7)" },
  { authored: "Reverberation", spoken: "Reverb", why: "the long form mangles on small voices; Reverb is the ratified short form — no new noun" },
  { authored: "Kael", spoken: "Kale", why: "/keɪl/; without it a device may say Kyle or Kay-el" },
  { authored: "Serev", spoken: "Ser-ev", why: "LOCKED pronunciation (leader names)" },
  { authored: "Vyra", spoken: "Veer-ah", why: "LOCKED pronunciation" },
  { authored: "Miren", spoken: "Meer-en", why: "LOCKED pronunciation" },
  { authored: "Delen", spoken: "Del-en", why: "LOCKED pronunciation" },
  { authored: "Azazel-3", spoken: "Azazel Three", why: "never 'minus three'" },
  { authored: "Semira", spoken: "Seh-meer-ah", why: "coined name" },
  // deliberately NOT respelled
  { authored: "Vesper", spoken: "Vesper", why: "real word" },
  { authored: "Keeper Mend", spoken: "Keeper Mend", why: "real words" },
  { authored: "Brother Candle", spoken: "Brother Candle", why: "real words" },
  { authored: "The Chained Syllabus", spoken: "The Chained Syllabus", why: "real words" },
  { authored: "The Unwritten Answer", spoken: "The Unwritten Answer", why: "real words" },
  { authored: "The Last Lecturer", spoken: "The Last Lecturer", why: "real words" },
  { authored: "The Vigil", spoken: "The Vigil", why: "real word" },
];

/** Only the entries that actually change a word, longest-first so a compound
 *  ("The Chained Syllabus") is never half-matched. */
export const SPOKEN_RESPELLINGS: readonly LexiconEntry[] = SPOKEN_LEXICON.filter(
  (e) => e.authored !== e.spoken,
).sort((a, b) => b.authored.length - a.authored.length);

// ============================================================================
// §4.2 · NUMERALS — a deterministic table. No Intl, no locale, no dependencies:
// a line is never read as a serial number, and the harness fails on any spoken
// digit that has no entry here.
// ============================================================================
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export const ORDINALS: Readonly<Record<string, string>> = {
  "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth",
  "6th": "sixth", "7th": "seventh", "8th": "eighth", "9th": "ninth", "10th": "tenth",
};

/** 0–9999 in words, hyphenated tens-units ("forty-seven"). */
export function numberToWords(n: number): string {
  const v = Math.trunc(Math.abs(n));
  if (v < 20) return ONES[v];
  if (v < 100) {
    const t = TENS[Math.floor(v / 10)];
    const o = v % 10;
    return o === 0 ? t : `${t}-${ONES[o]}`;
  }
  if (v < 1000) {
    const h = `${ONES[Math.floor(v / 100)]} hundred`;
    const rest = v % 100;
    return rest === 0 ? h : `${h} ${numberToWords(rest)}`;
  }
  const th = `${ONES[Math.floor(v / 1000)]} thousand`;
  const rest = v % 1000;
  return rest === 0 ? th : `${th} ${numberToWords(rest)}`;
}

/** §4.2 · the symbol/acronym table (each entry: authored → spoken, why). */
export const NUMERAL_TABLE: readonly { authored: string; spoken: string; why: string }[] = [
  { authored: "0–20, tens, hundreds, thousands", spoken: "word forms", why: "numberToWords()" },
  { authored: "1,000", spoken: "one thousand", why: "thousands separator dropped and read" },
  { authored: "%", spoken: "percent", why: "spelled" },
  { authored: "1:47", spoken: "one forty-seven", why: "clock form" },
  { authored: "0.5", spoken: "zero point five", why: "decimal form" },
  { authored: "3–5", spoken: "three to five", why: "en-dash range between numerals" },
  { authored: "1st", spoken: "first", why: "ordinals 1st–10th" },
  { authored: "L10", spoken: "level ten", why: "the level shorthand" },
  { authored: "FOB", spoken: "forward base", why: "never spelled out as three letters" },
  { authored: "vs", spoken: "versus", why: "abbreviation" },
];

// ============================================================================
// §8.6 · PER-WORLD CONSTANT — the ladder + the table are one authored profile
// for the beta world, looked up by world so the engine is never forked for the
// other five races (which have no authored cast yet).
// ============================================================================
export const VOICE_AUTHORED_WORLD = "watchers";

export interface VoiceProfile {
  world: RaceId | string;
  /** True when this world's cast is authored; a fallback world reads the beta
   *  profile (silently — the ladder is a hint, not a promise). */
  authored: boolean;
  directions: Readonly<Record<string, VoiceDirection>>;
  castOrder: readonly string[];
  ladders: Readonly<Record<VoiceClass, string>>;
}

export function voiceProfileFor(world?: RaceId | string): VoiceProfile {
  const id = world ?? VOICE_AUTHORED_WORLD;
  return {
    world: id,
    authored: id === VOICE_AUTHORED_WORLD,
    directions: VOICE_DIRECTIONS,
    castOrder: CAST_ORDER,
    ladders: VOICE_LADDER_SOURCES,
  };
}
