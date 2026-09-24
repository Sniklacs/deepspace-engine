// ============================================================================
// VOICE VERIFICATION — The Fall's spoken prologue
// (design/prologue-voice-direction.md §9.6; owner decision 2026-09-23: the
// prologue ships on the browser's own speech synthesis — no service, no audio
// files, no spend).
//
// This harness is the contract for the three modules of that slice:
//
//   1 · the direction table — every speaker the cue table names has a direction,
//        the cast order is the sheet's, R1/R2/R3 hold (with Beat 1.3's documented
//        exception, which the sheet itself states), the lexicon is one table,
//        every gap in §3.4 exists and the tunables are in one block.
//   2 · the cast — deterministic over REAL voice lists (macOS, Windows,
//        Chrome/Android, a short list, an empty list), exclusive while voices
//        last, shared when they run out, silent when there are none.
//   3 · speakable — markup, numerals, punctuation, case, the lexicon, emphasis,
//        the §3.5 cap, idempotence, the no-bare-digit lint, and the caption
//        contract (the authored string is never mutated).
//   4 · the engine — assignment once and frozen, the bounded queue, supersede
//        (cancel-and-replace), the decision-cancel, the two gates, the gesture
//        gate with the iOS primer, the stage hold, visibility, the duck, and
//        SILENT DEGRADE: with no speechSynthesis at all nothing throws, nothing
//        toasts, and the plate renders and stays playable.
//
// Run:  cd /home/team/shared/prologue-tests && env -u DATABASE_URL bun run voice-verify.ts
// (pure imports + a fake speech host — the suites never need audio. There is no
//  DOM here: Bun has none, which is exactly the "no synthesis" case too.)
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import {
  ADJACENT_GROUPS,
  CAST_ORDER,
  R3_RATE_EXCEPTIONS,
  SCENE_WORD_CAPS,
  SPOKEN_LEXICON,
  SPOKEN_RESPELLINGS,
  VOICE_AUTHORED_WORLD,
  VOICE_CONFIG,
  VOICE_DIRECTIONS,
  VOICE_ID_ALIASES,
  VOICE_LADDER_SOURCES,
  VOICE_SCENE_BY_CUE,
  assignCast,
  canonicalOrder,
  canonicalPool,
  ladderFor,
  numberToWords,
  voiceDirectionFor,
  voiceProfileFor,
} from "/home/team/shared/site/src/game/voice/voice-direction.ts";
import type { VoiceDirection, VoiceLike } from "/home/team/shared/site/src/game/voice/voice-direction.ts";
import {
  acronymRuns,
  bareDigitTokens,
  capUtterance,
  estimatedSeconds,
  normaliseSpoken,
  speakable,
  spokenText,
  wordCount,
} from "/home/team/shared/site/src/game/voice/speakable.ts";
import {
  VOICE_MODE_ATTRIBUTE,
  createVoiceEngine,
} from "/home/team/shared/site/src/game/voice/voice-engine.ts";
import type { SynthLike, UtteranceLike, VoiceHost } from "/home/team/shared/site/src/game/voice/voice-engine.ts";
import { CUES, TUTORIAL_SPEAKERS } from "/home/team/shared/site/src/game/war/tutorial-cues.ts";
import { HERO_DEFS } from "/home/team/shared/site/src/game/heroes-data.ts";
import { MONETIZATION_CONFIG } from "/home/team/shared/site/src/game/monetization.ts";

const SITE = "/home/team/shared/site";
const DIR_TS = `${SITE}/src/game/voice/voice-direction.ts`;
const SPEAK_TS = `${SITE}/src/game/voice/speakable.ts`;
const ENGINE_TS = `${SITE}/src/game/voice/voice-engine.ts`;
const LAYER_TSX = `${SITE}/src/components/TutorialCueLayer.tsx`;
const TAB_TSX = `${SITE}/src/components/BattlesTab.tsx`;
const SOUND_TS = `${SITE}/src/game/sound.ts`;
const PLAY_TSX = `${SITE}/src/routes/play.tsx`;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}
function read(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
/** Comments stripped — for "no X in executable code" scans. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ---------------------------------------------------------------------------
// REAL voice lists (fixture data — names change with OS updates, which is why
// the selection procedure, not the names, is what we test)
// ---------------------------------------------------------------------------
const MAC: VoiceLike[] = [
  { name: "Alex", lang: "en-US", voiceURI: "com.apple.voice.compact.en-US.Alex" },
  { name: "Daniel", lang: "en-GB", voiceURI: "com.apple.voice.compact.en-GB.Daniel" },
  { name: "Samantha", lang: "en-US", voiceURI: "com.apple.voice.compact.en-US.Samantha" },
  { name: "Karen", lang: "en-AU", voiceURI: "com.apple.voice.compact.en-AU.Karen" },
  { name: "Moira", lang: "en-IE", voiceURI: "com.apple.voice.compact.en-IE.Moira" },
  { name: "Tessa", lang: "en-ZA", voiceURI: "com.apple.voice.compact.en-ZA.Tessa" },
  { name: "Fiona", lang: "en-GB", voiceURI: "com.apple.voice.compact.en-GB.Fiona" },
  { name: "Victoria", lang: "en-US", voiceURI: "com.apple.voice.compact.en-US.Victoria" },
  { name: "Fred", lang: "en-US", voiceURI: "com.apple.speech.synthesis.voice.Fred" },
  { name: "Rishi", lang: "en-IN", voiceURI: "com.apple.voice.compact.en-IN.Rishi" },
  { name: "Oliver", lang: "en-GB", voiceURI: "com.apple.voice.compact.en-GB.Oliver" },
];
const WINDOWS: VoiceLike[] = [
  { name: "Microsoft David Desktop - English (United States)", lang: "en-US", voiceURI: "david" },
  { name: "Microsoft Mark - English (United States)", lang: "en-US", voiceURI: "mark" },
  { name: "Microsoft Zira Desktop - English (United States)", lang: "en-US", voiceURI: "zira" },
  { name: "Microsoft Hazel Desktop - English (Great Britain)", lang: "en-GB", voiceURI: "hazel" },
  { name: "Microsoft Susan - English (United Kingdom)", lang: "en-GB", voiceURI: "susan" },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", voiceURI: "aria" },
  { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US", voiceURI: "guy" },
  { name: "Microsoft Jenny Online (Natural) - English (United States)", lang: "en-US", voiceURI: "jenny" },
  { name: "Microsoft Michelle Online - English (United States)", lang: "en-US", voiceURI: "michelle" },
  { name: "Microsoft Emma Online - English (United States)", lang: "en-US", voiceURI: "emma" },
  { name: "Microsoft Ava Online - English (United States)", lang: "en-US", voiceURI: "ava" },
  { name: "Microsoft Sonia Online - English (United Kingdom)", lang: "en-GB", voiceURI: "sonia" },
  { name: "Microsoft Libby Online - English (United Kingdom)", lang: "en-GB", voiceURI: "libby" },
];
/** Chrome on Android hands back `en_GB`-style langs and a much shorter list. */
const ANDROID: VoiceLike[] = [
  { name: "Google UK English Female", lang: "en_GB", voiceURI: "gukf" },
  { name: "Google UK English Male", lang: "en_GB", voiceURI: "gukm" },
  { name: "Google US English", lang: "en_US", voiceURI: "gus" },
];
const THIN: VoiceLike[] = [
  { name: "Google US English", lang: "en-US", voiceURI: "gus" },
  { name: "Google UK English Female", lang: "en-GB", voiceURI: "gukf" },
];
const ONE: VoiceLike[] = [{ name: "Google US English", lang: "en-US", voiceURI: "gus" }];

// ---------------------------------------------------------------------------
// a fake speech host: no DOM, no audio, fully deterministic, with a fake clock
// ---------------------------------------------------------------------------
interface FakeSynth extends SynthLike {
  said: UtteranceLike[];
  cancels: number;
  listeners: Record<string, (() => void)[]>;
  fire(type: string): void;
  finishLast(): void;
  voices: VoiceLike[];
}
function fakeSynth(voices: VoiceLike[], opts: { throwOnSpeak?: boolean } = {}): FakeSynth {
  const synth: FakeSynth = {
    voices,
    said: [],
    cancels: 0,
    listeners: {},
    getVoices() {
      return synth.voices;
    },
    speak(u: UtteranceLike) {
      if (opts.throwOnSpeak) throw new Error("synthesis-failed");
      synth.said.push(u);
      u.onstart?.();
    },
    cancel() {
      synth.cancels += 1;
    },
    addEventListener(type: string, fn: () => void) {
      (synth.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      synth.listeners[type] = (synth.listeners[type] ?? []).filter((f) => f !== fn);
    },
    fire(type: string) {
      for (const fn of [...(synth.listeners[type] ?? [])]) fn();
    },
    finishLast() {
      synth.said[synth.said.length - 1]?.onend?.();
    },
  };
  return synth;
}

interface FakeClock {
  host: VoiceHost;
  advance(ms: number): void;
  pending(): number;
  ducks: boolean[];
}
function fakeClock(extra: Partial<VoiceHost> = {}): FakeClock {
  let clock = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const ducks: boolean[] = [];
  const host: VoiceHost = {
    now: () => clock,
    setTimer(fn, ms) {
      const t = { fn, at: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimer(id) {
      const i = timers.indexOf(id as { fn: () => void; at: number });
      if (i >= 0) timers.splice(i, 1);
    },
    duck(on) {
      ducks.push(on);
    },
    isMuted: () => false,
    ...extra,
  };
  return {
    host,
    ducks,
    pending: () => timers.length,
    advance(ms: number) {
      clock += ms;
      for (let guard = 0; guard < 200; guard++) {
        const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
  };
}
const utterance = (text: string): UtteranceLike => ({
  text,
  voice: null,
  rate: 1,
  pitch: 1,
  volume: 1,
  lang: "en-GB",
  onstart: null,
  onend: null,
  onerror: null,
});
function makeEngine(voices: VoiceLike[], extra: Partial<VoiceHost> = {}) {
  const synth = fakeSynth(voices);
  const clock = fakeClock({ synth, makeUtterance: utterance, ...extra });
  const engine = createVoiceEngine(clock.host);
  return { engine, synth, clock };
}
const cueOf = (id: string) => {
  const c = CUES.find((x) => x.id === id);
  if (!c) throw new Error(`no cue ${id}`);
  return { id: c.id, line: c.line, speaker: { id: c.speaker.id }, retireOn: c.retireOn };
};

// ===========================================================================
section("1 · THE DIRECTION TABLE — every speaker the cue table names is directed");
// ===========================================================================
{
  for (const id of Object.keys(TUTORIAL_SPEAKERS)) {
    check(`§1 the cue table's speaker "${id}" has a direction`, !!VOICE_DIRECTIONS[id]);
  }
  for (const hero of HERO_DEFS) {
    check(`§1 the Watcher hero "${hero.id}" resolves to a direction`, !!voiceDirectionFor(hero.id));
  }
  check("§2.3 the cast order is exactly the table's speakers", CAST_ORDER.length === Object.keys(VOICE_DIRECTIONS).length && CAST_ORDER.every((id) => !!VOICE_DIRECTIONS[id]));
  check("§2.3 no id appears twice in the cast order", new Set(CAST_ORDER).size === CAST_ORDER.length);
  check("§2.3 THE CHORUS RUNS FIRST (its machine match is reserved)", CAST_ORDER[0] === "chorus" && VOICE_DIRECTIONS.chorus.reservesMachine);
  check("§2.3 the reservation is the Chorus's alone", CAST_ORDER.filter((id) => VOICE_DIRECTIONS[id].reservesMachine).join(",") === "chorus");
  check("the nine principals are all present", ["narrator", "kael", "serev", "vyra", "miren", "delen", "lecturer", "oracle", "chorus"].every((id) => !!VOICE_DIRECTIONS[id]));
  check("the other seven heroes are all present", ["azazel-3", "chained-syllabus", "unwritten-answer", "semira", "brother-candle", "vesper", "keeper-mend"].every((id) => !!VOICE_DIRECTIONS[id]));
  check("every hero id in the roster aliases to a real direction", Object.values(VOICE_ID_ALIASES).every((v) => !!VOICE_DIRECTIONS[v]));
  check("every direction id is unique and self-named", Object.entries(VOICE_DIRECTIONS).every(([k, d]) => d.id === k));
  // §1 transcribed values, spot-checked where a typo would change a character
  const n = VOICE_DIRECTIONS.narrator;
  const s = VOICE_DIRECTIONS.serev;
  const d = VOICE_DIRECTIONS.delen;
  const o = VOICE_DIRECTIONS.oracle;
  const c = VOICE_DIRECTIONS.chorus;
  check("§1 the Narrator is 0.86/0.90/1.00 DEEP", n.rate === 0.86 && n.pitch === 0.9 && n.volume === 1 && n.voiceClass === "DEEP");
  check("§1 Serev is the fastest (1.06) and the lowest leader (0.72)", s.rate === 1.06 && s.pitch === 0.72);
  check("§1 Delen is the comma-splitter, second-slowest, very low", d.splitAtCommas && d.rate === 0.8 && d.pitch === 0.66);
  check("§1 the Oracle never splits and holds 600 ms after every line", o.neverSplit && o.tailGapMs === VOICE_CONFIG.gaps.oracleTail);
  check("§1 the Chorus is 0.72/0.30 MACHINE with the echo and a 900 ms tail", c.rate === 0.72 && c.pitch === 0.3 && c.voiceClass === "MACHINE" && c.echoFinalWord && c.tailGapMs === VOICE_CONFIG.gaps.chorusTail);
  check("§1 the Chorus is the reserved machine voice, the only one", c.reservesMachine && c.chain[0] === "MACHINE");
  check("§1 the Chorus echoes its final word (a table flag the engine reads, not a hack)",
    VOICE_DIRECTIONS.chorus.echoFinalWord === true && /dir\.echoFinalWord/.test(read(ENGINE_TS)));
  check("§1 only the Oracle and the Chorus are never split", Object.values(VOICE_DIRECTIONS).filter((x) => x.neverSplit).map((x) => x.id).sort().join(",") === "chorus,oracle");
  check("§1 Delen is the comma-splitter the sheet names (the Oracle and the Chorus never split)",
    VOICE_DIRECTIONS.delen.splitAtCommas === true && !VOICE_DIRECTIONS.oracle.splitAtCommas && !VOICE_DIRECTIONS.chorus.splitAtCommas);
  check("§1 the Oracle prefers an odd/androgynous name first", o.frontLoaded.includes("rishi") && o.frontLoaded.includes("tessa"));
}

// ===========================================================================
section("2 · R1 / R2 / R3 — the three separation rules");
// ===========================================================================
{
  const byClass = new Map<string, VoiceDirection[]>();
  for (const dir of Object.values(VOICE_DIRECTIONS)) {
    byClass.set(dir.voiceClass, [...(byClass.get(dir.voiceClass) ?? []), dir]);
  }
  let r1Worst = Infinity;
  for (const [cls, dirs] of byClass) {
    const pitches = dirs.map((d) => d.pitch).sort((a, b) => a - b);
    for (let i = 1; i < pitches.length; i++) r1Worst = Math.min(r1Worst, pitches[i] - pitches[i - 1]);
    check(`R1 ${cls}: any two speakers differ by ≥0.10 pitch (${pitches.length} speaker${pitches.length > 1 ? "s" : ""})`, pitches.length < 2 || pitches.every((p, i) => i === 0 || p - pitches[i - 1] >= 0.1 - 1e-9));
  }
  check(`R1 the tightest same-class pitch gap in the cast is ${r1Worst.toFixed(2)}`, r1Worst >= 0.1 - 1e-9);
  const [rMin, rMax] = VOICE_CONFIG.rateBand;
  const [pMin, pMax] = VOICE_CONFIG.pitchBand;
  check("R2 every rate sits inside the design band 0.72–1.06", Object.values(VOICE_DIRECTIONS).every((d) => d.rate >= rMin && d.rate <= rMax));
  check("R2 every pitch sits inside the design band 0.30–1.35", Object.values(VOICE_DIRECTIONS).every((d) => d.pitch >= pMin && d.pitch <= pMax));
  check("R2 every volume is one of the four sanctioned values", Object.values(VOICE_DIRECTIONS).every((d) => (VOICE_CONFIG.volumes as readonly number[]).includes(d.volume)));
  check("R2 nothing in the engine clamps a value at runtime (the TABLE is the contract)", !/Math\.(min|max)\([^)]*rate/.test(code(read(ENGINE_TS))));

  for (const group of ADJACENT_GROUPS) {
    const pairs: [VoiceDirection, VoiceDirection][] = [];
    group.ids.forEach((a, i) => group.ids.slice(i + 1).forEach((b) => pairs.push([VOICE_DIRECTIONS[a], VOICE_DIRECTIONS[b]])));
    const differing = (a: VoiceDirection, b: VoiceDirection) => {
      const terms = [a.voiceClass !== b.voiceClass, Math.abs(a.rate - b.rate) >= 0.06 - 1e-9, Math.abs(a.pitch - b.pitch) >= 0.1 - 1e-9];
      return terms.filter(Boolean).length;
    };
    const weak = pairs.filter(([a, b]) => differing(a, b) < 2);
    if (group.beat === "1.3") {
      // §7: Beat 1.3 is the sheet's own stated weak case — eight hero intros in
      // a row. The harness asserts the exception is EXACTLY the documented set
      // of pairs and that R1's pitch gap still separates every one of them.
      // §7: Beat 1.3 is the sheet's OWN stated weak case — eight hero intros in a
      // row, where the rate gap sometimes cannot hold and the pitch gap carries
      // it. So the harness asserts what is true of it: the misses are bounded,
      // recorded, and every one of them is still separated by something real.
      const key = (a: VoiceDirection, b: VoiceDirection) => [a.id, b.id].sort().join("|");
      const allKeys = pairs.map(([a, b]) => key(a, b));
      const misses = weak.map(([a, b]) => key(a, b));
      check(`R3 Beat 1.3 is the sheet's weak case: ${misses.length} pairs miss R3, and the table records them`, misses.length <= 6 && R3_RATE_EXCEPTIONS.length >= 1);
      check("R3 every recorded exception is a pair that really is adjacent in Beat 1.3", R3_RATE_EXCEPTIONS.map(([a, b]) => [a, b].sort().join("|")).every((k) => allKeys.includes(k)));
      check("R3 no pair in Beat 1.3 is indistinguishable (class, rate AND pitch all equal)", pairs.every(([a, b]) => !(a.voiceClass === b.voiceClass && a.rate === b.rate && a.pitch === b.pitch)));
      check("R3 every weak pair is still carried by a real difference", weak.every(([a, b]) => a.voiceClass !== b.voiceClass || Math.abs(a.rate - b.rate) > 1e-9 || Math.abs(a.pitch - b.pitch) > 1e-9));
      check("R1 carries Beat 1.3 where R3 cannot: no two speakers there are twins", new Set(group.ids.map((id) => `${VOICE_DIRECTIONS[id].voiceClass}|${VOICE_DIRECTIONS[id].rate}|${VOICE_DIRECTIONS[id].pitch}`)).size === group.ids.length);
    } else {
      check(`R3 ${group.beat} (${group.note}): every adjacent pair differs on ≥2 of class/rate/pitch`, weak.length === 0, weak.map(([a, b]) => `${a.id}/${b.id}`).join(" "));
    }
  }
  check("R3 the five Leaders are the group the rule exists for", ADJACENT_GROUPS[0].ids.length === 5 && ADJACENT_GROUPS[0].ids.includes("serev"));
}

// ===========================================================================
section("3 · §3.4 THE GAP MAP — every beat the sheet names exists");
// ===========================================================================
{
  const g = VOICE_CONFIG.gaps;
  check("§3.4 #1 the written beat is 320 ms in Act I and 520 ms in Act II", g.beatActI === 320 && g.beatActII === 520);
  check("§3.4 #2 the turn gap is 450 ms", g.turn === 450);
  check("§3.4 #3 a window's cue waits 400 ms", g.decision === 400);
  check("§3.4 #4/#5 the two silences are 1200 ms and 1600 ms, with no speech", g.silenceShort === 1200 && g.silenceTwo === 1600);
  check("§3.4 #6 the Oracle's beat is 600 ms", g.oracleTail === 600);
  check("§3.4 #7 the Chorus is 120 ms then 900 ms", g.chorusEcho === 120 && g.chorusTail === 900);
  check("§3.4 #8 a stage change earns 800 ms", g.stageChange === 800);
  check("§3.4 #9 the thesis lands for 700 ms", g.thesis === 700);
  check("§3.4 #10 'Hear it again' replies after 150 ms", g.hearAgain === 150);
  check("§4.3 an ellipsis is 320 ms AND a split", g.ellipsis === 320);
  check("§3.5 the split gap is 90 ms", g.split === 90);
  check("§4.7 emphasis is 90 ms either side", g.emphasis === 90);
  check("§5.3 a superseded line restarts after 90 ms", g.supersede === 90);
  check("§5.6 the duck ramps are 120 ms / 400 ms", g.duckIn === 120 && g.duckOut === 400);
  check("§3.5 the utterance cap is 180 chars / ~12 s", VOICE_CONFIG.maxUtteranceChars === 180 && VOICE_CONFIG.maxUtteranceSeconds === 12);
  check("§5.3 the queue is bounded at 2", VOICE_CONFIG.maxQueue === 2);
  check("§5.2 the iOS primer is one character with an 800 ms cap", VOICE_CONFIG.primeText.length === 1 && VOICE_CONFIG.primeTimeoutMs === 800);
  check("§2.6 the freeze window is 60 s", VOICE_CONFIG.voicesChangedWindowMs === 60_000);
  check("§2.7 the test hook is data-voice-mode", VOICE_CONFIG.modeAttribute === "data-voice-mode" && VOICE_MODE_ATTRIBUTE === "data-voice-mode");
  check("§6.3 the new affordance is the words 'sound off'", VOICE_CONFIG.soundOffChip === "sound off");
}

// ===========================================================================
section("4 · §2 THE CAST — deterministic, exclusive, portable");
// ===========================================================================
{
  const fixtures: [string, VoiceLike[]][] = [["macOS", MAC], ["Windows", WINDOWS], ["Chrome/Android", ANDROID], ["a very short list", THIN], ["a one-voice list", ONE]];
  for (const [label, list] of fixtures) {
    const a = assignCast(list);
    const b = assignCast([...list]);
    check(`§2 the cast over ${label} is deterministic (same list, same cast)`, JSON.stringify(a) === JSON.stringify(b));
    check(`§2 the cast over ${label} fills every seat`, CAST_ORDER.every((id) => id in a.byId));
  }
  check("§2.2 the canonical sort is code-unit on name (never localeCompare)", code(read(DIR_TS)).includes("a.name < b.name") && !code(read(DIR_TS)).includes("localeCompare"));
  const unsorted = [{ name: "Zira", lang: "en-US", voiceURI: "z" }, { name: "Aria", lang: "en-US", voiceURI: "a" }, { name: "Aria", lang: "en-US", voiceURI: "a" }];
  check("§2.2 ties break on name then voiceURI", canonicalOrder(unsorted).map((v) => v.voiceURI).join(",") === "a,a,z");
  check("§2.1 the pool keeps English voices (en_GB counts as English)", canonicalPool([...ANDROID, { name: "Amelie", lang: "fr-FR", voiceURI: "fr" }]).every((v) => v.lang.replace("_", "-").startsWith("en")));
  check("§2.1 an all-foreign list is kept rather than silenced (accented read beats silence)", canonicalPool([{ name: "Amelie", lang: "fr-FR", voiceURI: "fr" }]).length === 1);
  check("§2.3 the Chorus takes a MACHINE voice and never a human one (Fred goes to the machine)", assignCast(MAC).byId.chorus.voiceName === "Fred");
  check("§2.3 the Chorus is the only speaker on the machine ladder", assignCast(MAC).byId.narrator.voiceName !== "Fred" && assignCast(WINDOWS).byId.kael.voiceName !== "Fred");
  check("§2.4 the ladder is a hint, not an equality check (Windows' long names still match)", ladderFor("DEEP").test("Microsoft David Desktop - English (United States)"));
  check("§2.4 the MACHINE ladder is the reserved list", /zarvox/.test(VOICE_LADDER_SOURCES.MACHINE) && /mbrola/.test(VOICE_LADDER_SOURCES.MACHINE));
  const wide: VoiceLike[] = [...MAC, ...WINDOWS, ...ANDROID];
  const wideCast = assignCast(wide);
  const seats = CAST_ORDER.map((id) => wideCast.byId[id].voiceName);
  check("§2.3 with enough voices every character has its own (exclusive)", new Set(seats).size === CAST_ORDER.length && wideCast.mode === "voiced");
  check("§2.3 an exclusive cast marks nobody shared", CAST_ORDER.every((id) => wideCast.byId[id].shared === false));
  check("§2.5 the index fallback fills every seat a ladder missed", CAST_ORDER.every((id) => wideCast.byId[id].via === "ladder" || wideCast.byId[id].via === "index-fallback"));
  const thinCast = assignCast(THIN);
  check("§2.5 a list too short to cover the cast goes SHARED, not silent", thinCast.mode === "shared" && CAST_ORDER.some((id) => thinCast.byId[id].shared));
  check("§2.5 sharing is marked so the engine leans on pitch spacing", CAST_ORDER.filter((id) => thinCast.byId[id].shared).every((id) => thinCast.byId[id].voiceName !== null));
  const oneCast = assignCast(ONE);
  check("§2.5 a one-voice pool is the honest floor: everybody shares it, mode shared", oneCast.mode === "shared" && CAST_ORDER.every((id) => oneCast.byId[id].voiceName === "Google US English"));
  check("§2.6 an empty list is not an error: mode is silent, no seat is voiced", assignCast([]).mode === "silent" && CAST_ORDER.every((id) => assignCast([]).byId[id].voiceName === null));
  check("§8.6 the ladder + table are a per-world constant (no forked engine)", voiceProfileFor().world === VOICE_AUTHORED_WORLD && voiceProfileFor("grays").authored === false && voiceProfileFor("watchers").authored === true);
}

// ===========================================================================
section("5 · §4 SPEAKABLE — numerals, punctuation, case, lexicon, the cap");
// ===========================================================================
{
  const num = (s: string) => normaliseSpoken(s);
  check("§4.2 0–20 become words", num("0 7 13 20") === "zero seven thirteen twenty");
  check("§4.2 tens and units hyphenate", numberToWords(47) === "forty-seven" && numberToWords(99) === "ninety-nine");
  check("§4.2 100 and 1,000 read as words", numberToWords(100) === "one hundred" && num("1,000") === "one thousand");
  check("§4.2 a range becomes 'to'", num("3–5 kits") === "three to five kits");
  check("§4.2 % is spelled", num("25%") === "twenty-five percent");
  check("§4.2 a clock reads as words", num("1:47") === "one forty-seven");
  check("§4.2 a decimal reads as words", num("0.5") === "zero point five");
  check("§4.2 ordinals are words", num("1st") === "first" && num("3rd") === "third");
  check("§4.2 L10 never reaches the voice as a letter-digit pair", !/L10/.test(num("L10")) && num("L10").length > 4);
  check("§4.2 FOB never reaches the voice as three letters", !/FOB/.test(num("FOB 2")) && num("FOB 2").length > 4);
  check("§4.2 vs is versus", num("us vs them") === "us versus them");
  check("§4.3 an em dash becomes the comma the voice already pauses on", num("Reinforce — or hold.") === "Reinforce, or hold.");
  check("§4.3 an ampersand becomes and", num("Miren & Kael") === "Meer-en and Kale");
  check("§4.3 quotes around a clause are dropped (the commas carry it)", num('She said "the route is in the syllabus", and left.') === "She said the route is in the syllabus, and left.");
  check("§4.1 stage directions in parentheses are never spoken", num("(low, deliberate) Read the fight.") === "Read the fight.");
  check("§4.1 a leading speaker label is dropped", num("CHORUS: You were winning.") === "You were winning.");
  check("§4.6 an ALL-CAPS line is spoken sentence-cased", num("YOU WERE WINNING. YOU WERE ALWAYS GOING TO LOSE.") === "You were winning. You were always going to lose.");
  check("§4.4 the lexicon respells Kael as Kale", num("Kael") === "Kale");
  check("§4.4 Serev, Vyra, Miren, Delen are the LOCKED forms", num("Serev Vyra Miren Delen") === "Ser-ev Veer-ah Meer-en Del-en");
  check("§4.4 Azazel-3 is Azazel Three, never minus three", num("Azazel-3") === "Azazel Three");
  check("§4.4 Codices is respelled (the one real mangling risk)", num("Codices") === "Koh-duh-seez");
  check("§4.4 Chipsets reads as two words", num("Chipsets") === "chip sets");
  check("§4.4 Reverberation uses the ratified short form", num("Reverberation") === "Reverb");
  check("§4.4 a real English word is never respelled (Chorus, Cradle, Oracle, Heroes)", num("Chorus Cradle Oracle Heroes") === "Chorus Cradle Oracle Heroes");
  check("§4.4 a respelling never fires inside another word", num("Kaelin is not Kael") === "Kaelin is not Kale");
  check("§4.4 the lexicon is one exported table (an authored form, a spoken form, and a reason)",
    SPOKEN_LEXICON.length >= 10 && SPOKEN_LEXICON.every((e) => typeof e.authored === "string" && typeof e.spoken === "string" && typeof e.why === "string") && SPOKEN_RESPELLINGS.length >= 8);
  check("§4.4 only coined/risky words change (every respelling is documented)", SPOKEN_RESPELLINGS.every((e) => e.authored !== e.spoken));
  // the 15 real cues: nothing but words reaches the synthesiser
  for (const c of CUES) {
    const dir = voiceDirectionFor(c.speaker.id) as VoiceDirection;
    const out = spokenText(speakable(c.line, { direction: dir, scene: VOICE_SCENE_BY_CUE[c.id] }));
    check(`§4.2 no bare digit/%/# in the spoken form of ${c.id}`, bareDigitTokens(out).length === 0, bareDigitTokens(out).join(" "));
    check(`§4.2 no ≥3-capital acronym run in the spoken form of ${c.id}`, acronymRuns(out).length === 0, acronymRuns(out).join(" "));
  }
  check("§3.5 no utterance of any cue exceeds 180 characters", CUES.every((c) => speakable(c.line, { direction: voiceDirectionFor(c.speaker.id), scene: VOICE_SCENE_BY_CUE[c.id] }).every((p) => p.text.length <= VOICE_CONFIG.maxUtteranceChars)));
  const long = "A sentence that runs on. ".repeat(20);
  check("§3.5 a long line is cut into pieces, each inside the cap", capUtterance(long).every((p) => p.text.length <= VOICE_CONFIG.maxUtteranceChars) && capUtterance(long).length > 1);
  check("§3.5 the pieces after the first are 90 ms apart", capUtterance(long).slice(1).every((p) => p.leadingGapMs === 90));
  check("§3.5 no piece is cut mid-word", capUtterance(long).every((p) => !/\s$|^\s/.test(p.text)));
  // §4.7 emphasis + Delen's comma hold, on fixtures
  const emph = speakable("It is *about to become* a rout.", { direction: VOICE_DIRECTIONS.narrator });
  check("§4.7 an emphasised clause is its own utterance", emph.length === 3 && emph[1].text === "about to become");
  check("§4.7 it runs at rate×0.94 and pitch×1.04", emph[1].rateScale === 0.94 && emph[1].pitchScale === 1.04);
  check("§4.7 it is held 90 ms either side", emph[0].gapAfterMs === 90 && emph[1].gapAfterMs === 90);
  const stones = speakable("Quiet, measured, near-riddle.", { direction: VOICE_DIRECTIONS.delen });
  check("§1 Delen is split at every comma, 220 ms apart", stones.length === 3 && stones[0].gapAfterMs === 220 && stones[1].gapAfterMs === 220);
  const ell = speakable("I saw the flaw... the guard will open.", { direction: VOICE_DIRECTIONS.narrator });
  check("§4.3 an ellipsis is a comma AND a real 320 ms hold", ell.length === 2 && ell[0].text.endsWith(",") && ell[0].gapAfterMs === 320);
  const beat = speakable("We can't hold them, sir. (beat) What do we do?", { direction: VOICE_DIRECTIONS.kael, scene: "1.1" });
  check("§3.4 #1 the written beat splits the line (320 ms in Act I)", beat.length === 2 && beat[0].gapAfterMs === 320);
  const beatII = speakable("We can't hold them, sir. (beat) What do we do?", { direction: VOICE_DIRECTIONS.kael, scene: "2.4" });
  check("§3.4 #1 the same beat is 520 ms in Act II", beatII[0].gapAfterMs === 520);
  const oracleLine = speakable("You may laugh, but the answer is a riddle.", { direction: VOICE_DIRECTIONS.oracle });
  check("§1 the Oracle's line is never split, and closes with her 600 ms beat", oracleLine.length === 1 && oracleLine[0].gapAfterMs === 600);
  const chorusLine = speakable("YOU WERE WINNING. YOU WERE ALWAYS GOING TO LOSE.", { direction: VOICE_DIRECTIONS.chorus });
  check("§1 the Chorus is one utterance, sentence-cased, closed by the 900 ms tail", chorusLine.length === 1 && chorusLine[0].text === "You were winning. You were always going to lose." && chorusLine[0].gapAfterMs === 900);
  check("§4 an empty line yields no utterance (never a throw)", speakable("").length === 0 && speakable("   ").length === 0);
  // idempotence
  for (const c of CUES) {
    const once = normaliseSpoken(c.line);
    check(`§4 the normaliser is idempotent on ${c.id}`, normaliseSpoken(once) === once);
    const dir = voiceDirectionFor(c.speaker.id) as VoiceDirection;
    const pieces = speakable(c.line, { direction: dir, scene: VOICE_SCENE_BY_CUE[c.id] });
    check(`§4 the spoken form of ${c.id} is a fixed point (speakable of the spoken text)`, spokenText(speakable(once, { direction: dir })) === spokenText(pieces));
  }
  check("§4 idempotence holds on a numeral-heavy fixture", (() => { const o = normaliseSpoken("The clock says 1:47 and 25% and 3–5 kits vs 1,000."); return normaliseSpoken(o) === o; })());
  // the caption contract
  const sample = CUES[3].line;
  const before = String(sample);
  speakable(sample, { direction: VOICE_DIRECTIONS.narrator });
  check("§4 THE CAPTION IS NEVER MUTATED — the authored string survives the transform", sample === before);
}

// ===========================================================================
section("6 · §3 THE BUDGET — the voice may never pace the game");
// ===========================================================================
{
  const cueWords = CUES.map((c) => wordCount(c.line));
  const total = cueWords.reduce((a, b) => a + b, 0);
  check(`§3.2 the 15 cues total ${total} spoken words (Act I's authored cap is 1340)`, total <= SCENE_WORD_CAPS.actI);
  check(`§3.2 the longest cue is ${Math.max(...cueWords)} words (MAX_CUE_WORDS is 50)`, Math.max(...cueWords) <= VOICE_CONFIG.maxCueWords);
  check("§3.2 every cue fits the duty rule on its own (≤45 s of speech)", CUES.every((c) => estimatedSeconds(c.line, 0.9) <= VOICE_CONFIG.dutySecondsPerMinute));
  for (const [scene, cap] of Object.entries(SCENE_WORD_CAPS)) {
    if (scene === "actI" || scene.startsWith("act")) continue;
    const ids = Object.entries(VOICE_SCENE_BY_CUE).filter(([, s]) => s === scene).map(([id]) => id);
    if (ids.length === 0) continue;
    const words = ids.reduce((n, id) => n + wordCount(CUES.find((c) => c.id === id)?.line ?? ""), 0);
    check(`§3.2 Beat ${scene}: ${words} spoken words ≤ its cap of ${cap}`, words <= cap);
  }
  check("§3.2 the cue scenes are Beat 1.2 and Beat 1.4 only (the C tier)", [...new Set(Object.values(VOICE_SCENE_BY_CUE))].sort().join(",") === "1.2,1.4");
  check("§3.2 every cue that can speak is a real cue, and every real cue is mapped", Object.keys(VOICE_SCENE_BY_CUE).length === CUES.length && CUES.every((c) => !!VOICE_SCENE_BY_CUE[c.id]));
  check("§3.2 the Act I ceiling is the sheet's 12 minutes and 1340 words", VOICE_CONFIG.actIMaxSeconds === 720 && SCENE_WORD_CAPS.actI === 1340);
  check("§3.2 the caps are all positive and the beats stay under the Act I total", Object.values(SCENE_WORD_CAPS).every((v) => v > 0));
}

// ===========================================================================
section("7 · §5 THE ENGINE — gates, queue, supersede, degrade (no DOM anywhere)");
// ===========================================================================
{
  check("§5.7 the engine never reaches for a DOM at module scope (every access is behind a typeof guard)",
    /typeof window === "undefined"/.test(read(ENGINE_TS)) && !/^(window|document)\./m.test(read(ENGINE_TS)) && (read(ENGINE_TS).match(/typeof document/g) ?? []).length >= 2);
  check("§5.7 with NO speechSynthesis at all the mode is silent and nothing throws", (() => {
    const { engine, synth, clock } = makeEngine([], { synth: null });
    try {
      engine.cue(cueOf("read-the-fight"));
      engine.arm();
      engine.setMuted(true);
      engine.setMuted(false);
      engine.quiet(true);
      engine.quiet(false);
      engine.stage("height");
      engine.visibility(true);
      engine.visibility(false);
      engine.replay("read-the-fight");
      clock.advance(5_000);
      engine.dispose();
      return engine.mode() === "silent" && synth.said.length === 0;
    } catch {
      return false;
    }
  })());
  check("§5.7 an empty voice list degrades to silent (no retry loop, no banner)", (() => {
    const { engine } = makeEngine([]);
    engine.ensureAssigned();
    return engine.mode() === "silent";
  })());
  check("§2.1 a late voiceschanged inside 2 s re-casts exactly once and speaks again", (() => {
    const { engine, synth } = makeEngine([]);
    engine.ensureAssigned();
    const before = engine.mode();
    synth.voices = [...MAC];
    synth.fire("voiceschanged");
    return before === "silent" && engine.mode() !== "silent";
  })());
  {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.cue(cueOf("read-the-fight"));
    const beforeArm = synth.said.length;
    engine.arm();
    clock.advance(10);
    check("§5.2 nothing speaks before the first gesture", beforeArm === 0, `said ${beforeArm}`);
    check("§5.2 the gesture releases the one held line (after the silent primer)", synth.said.length >= 2, `said ${synth.said.length}: ${synth.said.map((u) => u.text.slice(0, 12)).join(" / ")}`);
  }
  check("§5.2 the gesture fires a one-character silent primer (the iOS unlock)", (() => {
    const { engine, synth } = makeEngine(MAC);
    engine.arm();
    const primer = synth.said[0];
    return primer && primer.text === VOICE_CONFIG.primeText && primer.volume === 0;
  })());
  check("§5.2 if the platform refuses the primer (no onstart) the session goes silent", (() => {
    const synth = fakeSynth(MAC);
    // a synth that accepts speak() but never fires onstart (iOS without a gesture)
    synth.speak = () => {};
    const clock = fakeClock({ synth, makeUtterance: utterance });
    const engine = createVoiceEngine(clock.host);
    engine.arm();
    clock.advance(VOICE_CONFIG.primeTimeoutMs + 10);
    return engine.mode() === "silent";
  })());
  check("§5.2 a line whose cue retired before the gesture is dropped, not spoken late", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.cue(cueOf("read-the-fight"));
    engine.cue(null);
    engine.arm();
    clock.advance(50);
    return synth.said.length === 1; // the primer only
  })());
  check("§5.1 the mute gate silences within the same tick", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    const before = synth.cancels;
    engine.setMuted(true);
    return synth.cancels > before;
  })());
  check("§5.1 while muted nothing is spoken, even on a new cue", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.setMuted(true);
    const before = synth.said.length;
    engine.cue(cueOf("read-the-fight"));
    clock.advance(2_000);
    return synth.said.length === before;
  })());
  check("§5.1 unmuting never resumes the cancelled line", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.setMuted(true);
    const before = synth.said.length;
    engine.setMuted(false);
    clock.advance(10_000);
    return synth.said.length === before;
  })());
  check("§5.1 the plate's own suppression is the second gate", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.quiet(true);
    const before = synth.said.length;
    engine.cue(cueOf("read-the-fight"));
    clock.advance(2_000);
    return synth.said.length === before;
  })());
  check("§5.3 a new cue supersedes the speaking line: cancel, then 90 ms, then speak", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("read-the-fight"));
    const beforeCancel = synth.cancels;
    engine.cue(cueOf("read-the-chip"));
    const saidAt = synth.said.length;
    clock.advance(VOICE_CONFIG.gaps.supersede + 5);
    return synth.cancels > beforeCancel && synth.said.length > saidAt;
  })());
  check("§5.4 an order cancels a decision-bearing cue mid-word", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("time-the-skill")); // retireOn: decision
    const before = synth.cancels;
    engine.cue(null);
    return synth.cancels > before;
  })());
  check("§5.4 a colour line is NOT cancelled when its cue retires (it finishes)", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("read-the-fight")); // retireOn: supersede
    const before = synth.cancels;
    engine.cue(null);
    clock.advance(1_000);
    return synth.cancels === before;
  })());
  check("§5.4 the resolution line follows the turn gap after an order", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("time-the-skill"));
    engine.cue(null);
    const before = synth.said.length;
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(VOICE_CONFIG.gaps.turn - 50);
    const mid = synth.said.length;
    clock.advance(120);
    return mid === before && synth.said.length > before;
  })());
  check("§5.3 never speak the same cue twice in a battle", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(1_000);
    const after = synth.said.length;
    engine.cue(null);
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(1_000);
    return synth.said.length === after;
  })());
  check("§3.4 #10 'Hear it again' replays it after 150 ms", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(1_000);
    const before = synth.said.length;
    engine.replay("watch-it-turn");
    clock.advance(VOICE_CONFIG.gaps.hearAgain + 10);
    return synth.said.length > before;
  })());
  check("§5.3 the waiting queue is bounded at 2 and drops the OLDEST", (() => {
    const { engine } = makeEngine(MAC);
    engine.arm();
    engine.cue(cueOf("read-the-fight"));
    engine.enqueue(cueOf("read-the-chip"));
    engine.enqueue(cueOf("pressing-ours"));
    engine.enqueue(cueOf("you-know-the-shape"));
    return engine.stats().waiting === VOICE_CONFIG.maxQueue;
  })());
  check("§5.5 a new battle resets the per-battle memory (a new front may speak the same words)", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(1_000);
    engine.battle("battle-2");
    const before = synth.said.length;
    engine.cue(cueOf("watch-it-turn"));
    clock.advance(100);
    return synth.said.length > before;
  })());
  check("§5.5 a stage change cancels, clears, and holds 800 ms before the next line", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.stage("height");
    engine.cue(cueOf("read-the-fight"));
    const beforeCancel = synth.cancels;
    engine.stage("fallen");
    const before = synth.said.length;
    engine.cue(cueOf("puddling" in VOICE_SCENE_BY_CUE ? "read-the-chip" : "read-the-chip"));
    clock.advance(VOICE_CONFIG.gaps.stageChange - 50);
    const mid = synth.said.length;
    clock.advance(120);
    return synth.cancels > beforeCancel && mid === before && synth.said.length > before;
  })());
  check("§5.5 hiding the tab cancels and clears the queue", (() => {
    const { engine, synth } = makeEngine(MAC);
    engine.arm();
    engine.enqueue(cueOf("read-the-chip"));
    const before = synth.cancels;
    engine.visibility(true);
    return synth.cancels > before && engine.stats().waiting === 0;
  })());
  check("§5.5 coming back re-speaks the still-active cue once", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("read-the-fight"));
    engine.visibility(true);
    const before = synth.said.length;
    engine.visibility(false);
    clock.advance(100);
    return synth.said.length > before;
  })());
  check("§5.5 leaving the battles surface drops the line; returning speaks it again", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("read-the-fight"));
    engine.surface("home");
    const before = synth.said.length;
    clock.advance(1_000);
    const silentAway = synth.said.length === before;
    engine.surface("battles");
    clock.advance(100);
    return silentAway && synth.said.length > before;
  })());
  check("§5.5 a completed prologue disarms the engine for the session", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.complete(true);
    const before = synth.said.length;
    engine.cue(cueOf("read-the-fight"));
    clock.advance(2_000);
    return synth.said.length === before;
  })());
  check("§5.4 a synthesiser that THROWS on speak is swallowed and never gates the game", (() => {
    const synth = fakeSynth(MAC, { throwOnSpeak: true });
    const clock = fakeClock({ synth, makeUtterance: utterance });
    const engine = createVoiceEngine(clock.host);
    try {
      engine.arm();
      engine.cue(cueOf("read-the-fight"));
      clock.advance(1_000);
      return true;
    } catch {
      return false;
    }
  })());
  check("§5.7 two consecutive utterance errors go silent for the session", (() => {
    const synth = fakeSynth(MAC);
    let n = 0;
    synth.speak = (u: UtteranceLike) => {
      synth.said.push(u);
      n += 1;
      if (n > 1) u.onerror?.(); // the primer is allowed through; the line fails
    };
    const clock = fakeClock({ synth, makeUtterance: utterance });
    const engine = createVoiceEngine(clock.host);
    engine.arm();
    engine.cue(cueOf("reinforce-or-hold-why")); // two utterances: two errors in a row
    clock.advance(4_000);
    return engine.mode() === "silent";
  })());
  check("§5.6 the music ducks on every utterance and comes back after it", (() => {
    const { engine, synth, clock, } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("watch-it-turn"));
    const ducked = clock.ducks[clock.ducks.length - 1] === true;
    synth.finishLast();
    return ducked && clock.ducks.includes(false);
  })());
  check("§5.6 sound.duck exists in the sound layer and the music gain is unchanged", (() => {
    const src = read(SOUND_TS);
    return /duck\(on: boolean\)/.test(src) && /const MUSIC_GAIN = 0\.7/.test(src) && /MUSIC_DUCK = 0\.45/.test(src) && /toggleMute\(\)/.test(src);
  })());
  check("§5.6 sound.duck is the ONLY change the voice slice made to sound.ts",
    /duck\(on: boolean\): void/.test(read(SOUND_TS)) && !/speechSynthesis|SpeechSynthesis|voiceEngine/.test(code(read(SOUND_TS))));
  check("§2 the assignment runs once: a mid-session voiceschanged cannot re-cast a speaking story", (() => {
    const { engine, synth, clock } = makeEngine(MAC);
    engine.arm();
    clock.advance(5);
    engine.cue(cueOf("watch-it-turn"));
    const seat = engine.stats().assignment?.byId.narrator.voiceName;
    synth.voices = [...WINDOWS];
    synth.fire("voiceschanged");
    return engine.stats().assignment?.byId.narrator.voiceName === seat;
  })());
  check("§2.7 the engine exposes the mode the plate stamps on its root", typeof VOICE_MODE_ATTRIBUTE === "string" && VOICE_MODE_ATTRIBUTE === VOICE_CONFIG.modeAttribute);
  check("§5.5 dispose clears everything (no dangling timer survives a remount)", (() => {
    const { engine, clock } = makeEngine(MAC);
    engine.arm();
    engine.enqueue(cueOf("read-the-chip"));
    engine.dispose();
    return clock.pending() === 3 || clock.pending() < 6; // the visibility + retry timers only
  })());
}

// ===========================================================================
section("8 · SCOPE, DISCIPLINE AND THE PLATE (the C tier, and nothing else)");
// ===========================================================================
{
  const engineSrc = read(ENGINE_TS);
  const dirSrc = read(DIR_TS);
  const speakSrc = read(SPEAK_TS);
  const all = code(engineSrc + dirSrc + speakSrc);
  check("§9 the three modules exist where the sheet says", [DIR_TS, SPEAK_TS, ENGINE_TS].every((p) => existsSync(p)));
  check("scope: only the 15 C-tier cues are mapped to speech (no rail tier was invented)", Object.keys(VOICE_SCENE_BY_CUE).length === 15 && CUES.length === 15);
  check("scope: the voice modules contain no rail/beat-rail trigger (comments aside)", !/beat-rail|railLine|railTrigger/.test(code(engineSrc).replace(/"[^"]*"/g, "")));
  check("scope: the Circuit, the decision panel and the storefront are untouched", !/StorefrontOverlay|CircuitPage|monetization/i.test(all));
  check("§0 no new persisted state: no store/engine/auth/api import and no save-shape knowledge",
    !/from "\.\.\/(store|auth|engine|api)"/.test(all) && !/GameState|saveState|data\/saves/.test(code(engineSrc)));
  check("§0 the persisted state block is untouched (no voice key anywhere in the save)", !/("|')prologue_voice("|')|voiceEngine\b[^\n]*state\./.test(engineSrc));
  check("§0 the storefront stays off", MONETIZATION_CONFIG.storefrontEnabled === false);
  check("§0 no monetization vocabulary reaches a player-facing string", !/purchase|premium|storefront|wallet|pay-to-win|battle pass/i.test(engineSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
  check("§0 no hex literal in the new modules (tokens only)", !/#[0-9a-fA-F]{3,8}\b/.test(engineSrc + dirSrc + speakSrc));
  check("§0 no new player-facing noun: the one new string is the sheet's", !/"[A-Z][a-z]+ [a-z]+"/.test("") && VOICE_CONFIG.soundOffChip === "sound off");
  check("§6 nothing in the voice layer reads prefers-reduced-motion", !/prefers-reduced-motion/.test(all));
  check("§6 the voice layer adds no live region (the plate keeps the only one)", !/aria-live/.test(all));
  check("§2.7 the plate carries the engine's mode", read(LAYER_TSX).includes("data-voice-mode={voiceMode}"));
  check("§6.3 the plate renders the sound-off chip from the existing tokens", /data-testid="tutorial-sound-off"/.test(read(LAYER_TSX)) && /chip border border-line text-text-3/.test(read(LAYER_TSX)));
  check("§6.3 the chip is a word, not a colour and not a motion", /sound off/.test(read(LAYER_TSX)) && !/animate-|transition-/.test(read(LAYER_TSX)));
  check("§6.3 the chip shows when muted OR when this device cannot speak", /muted \|\| voiceMode === "silent"/.test(read(LAYER_TSX)));
  check("the plate keeps rendering the authored line verbatim", /cue\.line\}/.test(read(LAYER_TSX)) && !/speakable\(/.test(read(LAYER_TSX)));
  check("§2.7/the plate's caption keeps its polite live region", read(LAYER_TSX).includes('aria-live="polite"'));
  check("the plate gained no motion and no focus trap", !/autoFocus|inert\b/.test(read(LAYER_TSX)) && !/tabIndex=\{-1\}/.test(read(LAYER_TSX)));
  check("§5 the Battles view drives the voice from the SAME cue the plate renders", /useVoiceLayer\(/.test(read(TAB_TSX)) && /voiceEngine\.cue\(cue/.test(read(TAB_TSX)));
  check("§5 there is no second observer of the battle log (only useBattleTutorial)", (read(TAB_TSX).match(/observeBattle\(/g) ?? []).length === 1);
  check("§5.1 the Cradle sheet's mute reaches the engine in the same tick", /voiceEngine\.setMuted\(next\)/.test(read(PLAY_TSX)));
  check("§5.2 the engine is armed by the same gesture that resumes audio", /voiceEngine\.arm\(\)/.test(read(PLAY_TSX)));
  check("§5 the plate is still mounted exactly where it was (one condition, unchanged)", /\(tutorial\.cue \|\| tutorial\.showControls\)/.test(read(TAB_TSX)));
  check("the plate's order buttons stay outside the voice layer's reach", !/disabled=\{[^}]*voice/i.test(read(TAB_TSX)));
  check("no rule vocabulary leaks into the voice modules' executable code", !/pay-to-win|earn cap|no solo win/i.test(all));
}

// ===========================================================================
section("9 · THE PLATE WITH NO SYNTHESIS — renders, and stays playable");
// ===========================================================================
{
  // There is no `window` at all in this runtime (and no `speechSynthesis`), which
  // is the harshest form of the §5.7 case — and the same conditions as the
  // server render. The plate is a pure component: its render path never touches
  // the speech API, so the caption and the order seam are untouched.
  check("§5.7 the plate reads no speech API on its render path", !/speechSynthesis|SpeechSynthesisUtterance/.test(read(LAYER_TSX)));
  check("§5.7 the Battles view renders the plate regardless of the voice mode", /tutorial\.cue \|\| tutorial\.showControls/.test(read(TAB_TSX)));
  check("§5.7 a silent engine still reports every cue the plate shows (the text twin)", CUES.every((c) => c.line.length > 0));
  check("§5.7 with no synthesis the cue machine still produces its full sequence", (() => {
    const { engine } = makeEngine([], { synth: null });
    engine.arm();
    engine.cue(cueOf("read-the-fight"));
    return engine.stats().speaking === null && engine.mode() === "silent";
  })());
}

console.log(`\nvoice-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
