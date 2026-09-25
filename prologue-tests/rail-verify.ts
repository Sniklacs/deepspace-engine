// RAIL VERIFICATION — The Fall's BEAT RAIL (design/prologue-beat-rail-spec.md §8).
//
// The contract for this slice: `src/game/prologue/prologue-cues.ts` (the 55-row
// table + the pure cursor/gate/governor core), the plate's second mount on the
// Cradle home (`components/RailNarration.tsx`), and the three engine/plate
// changes the rail needs (the wider `PlateLine`, the per-line surface gate, and
// D1 — the disarm at the end of Act III's rail).
//
// Run:  cd /home/team/shared/prologue-tests && env -u DATABASE_URL bun run rail-verify.ts
// Style: pure imports + source scans, the same discipline as tutorial-verify.ts /
// act1-entry-verify.ts. No DOM (Bun has none, which is also the no-synthesis case).
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import {
  prologueState,
  resetToCradle,
  resolveCataclysm,
} from "/home/team/shared/site/src/game/prologue/prologue-engine.ts";
import {
  PROLOGUE_LEADERS,
  heroesForRace,
} from "/home/team/shared/site/src/game/prologue/prologue-state.ts";
import { ACT1_CONFIG } from "/home/team/shared/site/src/game/prologue/act1-battle.ts";
import {
  RAIL_CONFIG,
  RAIL_CUES,
  RAIL_ORDER,
  RAIL_ROWS,
  SILENCE_CAPTION,
  advanceRail,
  deriveCursor,
  dutyOpen,
  freshRailState,
  gateDead,
  gateOpen,
  interRowGapMs,
  markRailStoryDone,
  nextRailRow,
  railFacts,
  railRowsForBeat,
  railStoryDone,
  railWords,
  resetRailStoryDone,
  silenceHoldMs,
  silentDwellMs,
  stepRail,
} from "/home/team/shared/site/src/game/prologue/prologue-cues.ts";
import type { RailFacts, RailRow } from "/home/team/shared/site/src/game/prologue/prologue-cues.ts";
import {
  ADJACENT_GROUPS,
  SCENE_WORD_CAPS,
  VOICE_CONFIG,
  VOICE_DIRECTIONS,
  VOICE_ID_ALIASES,
  voiceDirectionFor,
} from "/home/team/shared/site/src/game/voice/voice-direction.ts";
import { CUES } from "/home/team/shared/site/src/game/war/tutorial-cues.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

const SITE = "/home/team/shared/site";
const RAIL_TS = `${SITE}/src/game/prologue/prologue-cues.ts`;
const MOUNT_TSX = `${SITE}/src/components/RailNarration.tsx`;
const LAYER_TSX = `${SITE}/src/components/TutorialCueLayer.tsx`;
const ENGINE_TS = `${SITE}/src/game/voice/voice-engine.ts`;
const TAB_TSX = `${SITE}/src/components/BattlesTab.tsx`;
const CRADLE_TSX = `${SITE}/src/components/screens/CradleScreen.tsx`;
const PLAY_TSX = `${SITE}/src/routes/play.tsx`;
const SCRIPT_MD = "/home/team/shared/design/opening-script.md";
const T0 = 1_760_000_000_000;

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
const railSrc = read(RAIL_TS);
const railCode = code(railSrc);
const mountSrc = read(MOUNT_TSX);
const layerSrc = read(LAYER_TSX);
const engineCode = code(read(ENGINE_TS));
const tabSrc = read(TAB_TSX);
const cradleSrc = read(CRADLE_TSX);
const playSrc = read(PLAY_TSX);

/** The script's prose, as the row table must be able to reproduce it: emphasis
 *  markers and stage-direction parentheticals (`*(beat)*`, `(soft)`) are the two
 *  things the caption legitimately drops (§10.8 / D2). */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const prose = (s: string) => squash(s.replace(/\*/g, "").replace(/\([^)]*\)/g, " "));
const scriptRaw = read(SCRIPT_MD);
const scriptFlat = prose(scriptRaw);

/** Every SPOKEN line in the script: a `>` line whose speaker heading (a bold
 *  line) stands within the previous six lines. The design-note blockquotes
 *  ("Naming note for the owner…", "(This seeds the post-Fall…)") have no such
 *  heading and are therefore not dialogue. */
function scriptDialogueLines(): string[] {
  const lines = scriptRaw.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.startsWith("> ")) continue;
    let anchored = false;
    for (let j = Math.max(0, i - 6); j < i; j++) {
      if (/^\*\*[A-Z]/.test(lines[j].trimStart())) anchored = true;
    }
    if (anchored) out.push(prose(raw.slice(2)));
  }
  return out;
}
const scriptLines = scriptDialogueLines();
/** The same lines, MARKERS INTACT — `*(beat)*` is a thing the script writes and
 *  the rail must mark (D2), so it has to be readable here. */
function scriptDialogueRaw(): string[] {
  const lines = scriptRaw.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.startsWith("> ")) continue;
    let anchored = false;
    for (let j = Math.max(0, i - 6); j < i; j++) {
      if (/^\*\*[A-Z]/.test(lines[j].trimStart())) anchored = true;
    }
    if (anchored) out.push(raw.slice(2).trim());
  }
  return out;
}
const scriptRawLines = scriptDialogueRaw();

// ---------------------------------------------------------------------------
// fixtures — real states from the real producers, never hand-built prologues
// ---------------------------------------------------------------------------
function heightState(now = T0): GameState {
  const st = prologueState(now, "watchers");
  st.gameId = ACT1_CONFIG.gameId;
  return st;
}
function withFronts(state: GameState, opts: { reports?: number; liveAct1?: boolean; liveFall?: boolean }): GameState {
  const reports = opts.reports ?? 0;
  state.battleReports = Array.from({ length: reports }, (_, i) => ({
    id: `r${i}`,
    battleId: `b${i}`,
    zoneId: ACT1_CONFIG.frontId,
    zoneName: ACT1_CONFIG.frontName,
    outcome: "attacker_victory",
    resolvedAt: T0 + i,
  })) as never;
  const battles: { id: string; zoneId: string; status: string }[] = [];
  if (opts.liveAct1) battles.push({ id: "live-act1", zoneId: ACT1_CONFIG.frontId, status: "active" });
  if (opts.liveFall) battles.push({ id: "live-fall", zoneId: "front-the-fall", status: "active" });
  state.battles = battles as never;
  return state;
}
function facts(state: GameState, over: Partial<RailFacts> = {}): RailFacts {
  return {
    ...railFacts(state, { surface: "home", engineIdle: true, suppressed: false, now: T0, spoken: [] }),
    ...over,
  };
}
function nextFor(state: GameState, over: Partial<RailFacts> = {}): RailRow | null {
  const f = facts(state, over);
  return nextRailRow(freshRailState(f), f);
}

// ===========================================================================
section("1 · TABLE INTEGRITY — 55 rows, the script's own lines, nothing homeless");
// ===========================================================================
{
  check("55 rows in the table", RAIL_ROWS.length === 55, String(RAIL_ROWS.length));
  check("53 spoken + 2 silence", RAIL_ROWS.filter((r) => r.tier === "S").length === 2 && RAIL_ROWS.length - 2 === 53);
  const perBeat: Record<string, number> = {
    "1.0": 2, "1.1": 7, "1.2": 0, "1.3": 10, "1.4": 2, "1.5": 6, "1.6": 3, "1.7": 2,
    "2.1": 2, "2.2": 4, "2.3": 6, "2.4": 4, "2.5": 1, "3.1": 2, "3.2": 2, "3.3": 2,
  };
  const wrong = Object.entries(perBeat).filter(([b, n]) => railRowsForBeat(b).length !== n);
  check("the per-beat counts are the spec's", wrong.length === 0, wrong.map(([b, n]) => `${b}: ${railRowsForBeat(b).length}≠${n}`).join(","));
  check("no rail row in Beat 1.2 (the C tier owns it)", railRowsForBeat("1.2").length === 0);
  check("Act I = 32 rows, Act II = 17, Act III = 6",
    RAIL_ROWS.filter((r) => r.beat.startsWith("1.")).length === 32 &&
    RAIL_ROWS.filter((r) => r.beat.startsWith("2.")).length === 17 &&
    RAIL_ROWS.filter((r) => r.beat.startsWith("3.")).length === 6);
  check("the ORDER is the table's order, 55 unique ids",
    RAIL_ORDER.length === 55 && new Set(RAIL_ORDER).size === 55 && RAIL_ORDER.every((id, i) => RAIL_ROWS[i].id === id));
  // every spoken line is the script's line (whitespace- and mark-normalised)
  const missing = RAIL_ROWS.filter((r) => r.tier !== "S" && !scriptFlat.includes(prose(r.line)));
  check("every spoken rail line appears in design/opening-script.md", missing.length === 0, missing.map((r) => r.id).join(","));
  check("the two silence rows carry the documented caption",
    RAIL_ROWS.filter((r) => r.tier === "S").every((r) => r.line === SILENCE_CAPTION && r.speaker === null));
  // the reverse direction: no script line is homeless, none is invented
  check("the script really is the source (the cold open is written there)",
    scriptFlat.includes("A hundred years of war.") && scriptFlat.includes("Rebuild. Remember. Climb."));
  const railLines = new Set(RAIL_ROWS.map((r) => prose(r.line)));
  const cueLines = new Set(CUES.map((c) => prose(c.line)));
  const homeless = scriptLines.filter((l) => !railLines.has(l) && !cueLines.has(l));
  check("every spoken line in the script has exactly one home (rail or C)",
    homeless.length === 0, homeless.slice(0, 3).join(" | "));
  check("the rail holds the spec's 53 spoken rows and the C tier its 14 — 67 authored cue lines",
    RAIL_ROWS.filter((r) => r.tier !== "S").length === 53 &&
    new Set(CUES.map((c) => prose(c.line))).size === 14);
  console.log(`  ·   the script holds ${scriptLines.length} dialogue paragraphs, all covered`);
  const dupes = RAIL_ROWS.filter((r) => r.tier !== "S")
    .map((r) => prose(r.line))
    .filter((l, i, a) => a.indexOf(l) !== i);
  check("no rail line is defined twice", dupes.length === 0, dupes.join(" | "));
}

// ===========================================================================
section("2 · CAST INTEGRITY — every speaker has a direction, every roster id resolves");
// ===========================================================================
{
  const leaderIds = PROLOGUE_LEADERS.map((l) => l.id);
  const heroIds = heroesForRace("watchers");
  const unknownSpeaker = RAIL_ROWS.filter((r) => r.speaker && !voiceDirectionFor(r.speaker));
  check("every non-null speaker resolves to a voice direction", unknownSpeaker.length === 0, unknownSpeaker.map((r) => `${r.id}:${r.speaker}`).join(","));
  check("S rows speak for nobody", RAIL_ROWS.filter((r) => r.tier === "S").every((r) => r.speaker === null));
  const badReq = RAIL_ROWS.flatMap((r) => (r.requires ?? []).map((id) => ({ id, row: r.id })))
    .filter(({ id }) => !leaderIds.includes(id) && !heroIds.includes(id) && !(id in VOICE_ID_ALIASES));
  check("every `requires` id is a real Leader or hero id", badReq.length === 0, badReq.map((b) => `${b.row}:${b.id}`).join(","));
  const badBeat = RAIL_ROWS.filter((r) => SCENE_WORD_CAPS[r.beat] === undefined && !/^[23]\.[1-5]$/.test(r.beat));
  check("every beat is a real scene key (Act I) or a scripted Act II/III beat", badBeat.length === 0, badBeat.map((r) => r.id).join(","));
  check("all five Leaders speak in Act I and in the stand",
    ["kael", "serev", "vyra", "miren", "delen"].every((s) =>
      RAIL_ROWS.some((r) => r.beat.startsWith("1.") && r.speaker === s) &&
      RAIL_ROWS.some((r) => r.beat === "2.3" && r.speaker === s)));
  check("all eight heroes speak in Beat 1.3",
    heroIds.every((h) => RAIL_ROWS.some((r) => r.beat === "1.3" && r.requires?.includes(h))),
    heroIds.join(","));
  check("1.3-j requires all eight (the number in the line is never wrong)",
    (RAIL_ROWS.find((r) => r.id === "1.3-j")?.requires ?? []).length === 8);
  // ADJACENT_GROUPS coverage: the speakers a beat can put in a row
  const groups = ADJACENT_GROUPS.filter((g) => ["1.1", "1.3", "2.3"].includes(g.beat));
  const uncovered = groups.flatMap((g) =>
    [...new Set(RAIL_ROWS.filter((r) => r.beat === g.beat).map((r) => r.speaker))]
      .filter((s) => s && s !== "narrator" && !g.ids.includes(s))
      .map((s) => `${g.beat}:${s}`));
  check("ADJACENT_GROUPS covers every adjacent non-narrator speaker", uncovered.length === 0, uncovered.join(","));
  check("the cast ids the rows use are the sheet's OWN keys",
    RAIL_ROWS.every((r) => !r.speaker || r.speaker in VOICE_DIRECTIONS));
  check("the mount reads each row's label from the sheet (no second label table)",
    /voiceDirectionFor\(row\.speaker\)/.test(mountSrc) && !/label:\s*"/.test(code(mountSrc).replace(/ariaLabel[^,]*/g, "")));
}

// ===========================================================================
section("3 · NO BEAT OVER BUDGET — computed from the table, never retyped");
// ===========================================================================
{
  const tooLong = RAIL_ROWS.filter((r) => railWords(r) > VOICE_CONFIG.maxCueWords);
  check(`every row ≤ maxCueWords (${VOICE_CONFIG.maxCueWords})`, tooLong.length === 0, tooLong.map((r) => `${r.id}:${railWords(r)}`).join(","));
  const act1Beats = ["1.0", "1.1", "1.3", "1.4", "1.5", "1.6", "1.7"];
  const overBeat = act1Beats.filter((b) => {
    const words = railRowsForBeat(b).reduce((s, r) => s + railWords(r), 0);
    return words > SCENE_WORD_CAPS[b];
  });
  check("every Act I beat is inside its SCENE_WORD_CAPS", overBeat.length === 0, overBeat.join(","));
  const railAct1 = RAIL_ROWS.filter((r) => r.beat.startsWith("1.")).reduce((s, r) => s + railWords(r), 0);
  const cueAct1 = CUES.reduce((s, c) => s + c.line.split(/\s+/).filter(Boolean).length, 0);
  check("Act I rail + the C tier ≤ actI (1340 words)", railAct1 + cueAct1 <= SCENE_WORD_CAPS.actI, `${railAct1}+${cueAct1}`);
  check("Act I speech ≤ actIMaxSeconds under the sheet's word model",
    (railAct1 + cueAct1) / RAIL_CONFIG.wordsPerSecond <= VOICE_CONFIG.actIMaxSeconds,
    `${Math.round((railAct1 + cueAct1) / RAIL_CONFIG.wordsPerSecond)}s`);
  const wordsOf = (p: string) => RAIL_ROWS.filter((r) => r.beat.startsWith(p)).reduce((s, r) => s + railWords(r), 0);
  check("Act II rail ≤ caps.actII (420)", wordsOf("2.") <= SCENE_WORD_CAPS.actII, String(wordsOf("2.")));
  check("Act III rail ≤ caps.actIII (150)", wordsOf("3.") <= SCENE_WORD_CAPS.actIII, String(wordsOf("3.")));
  check("the rail retypes no budget (it reads SCENE_WORD_CAPS) and declares no cap of its own",
    /SCENE_WORD_CAPS/.test(railCode) && Object.keys(RAIL_CONFIG).every((k) => !/cap|max/i.test(k)) &&
    !/maxWords|maxCueWords/i.test(railCode));
  check("every timing number the rail owns traces back to the sheet",
    RAIL_CONFIG.dutySecondsPerMinute === VOICE_CONFIG.dutySecondsPerMinute &&
    RAIL_CONFIG.silentDwellMinMs === VOICE_CONFIG.gaps.silenceShort &&
    RAIL_CONFIG.stallGraceMs === VOICE_CONFIG.gaps.turn &&
    Math.abs(RAIL_CONFIG.wordsPerSecond - SCENE_WORD_CAPS.actI / VOICE_CONFIG.actIMaxSeconds) < 1e-9 &&
    !/\b2\.25\b|\b380\b|\b4_000\b/.test(railCode));
  console.log(`  ·   Act I rail ${railAct1}w · Act II ${wordsOf("2.")}w · Act III ${wordsOf("3.")}w · C tier ${cueAct1}w`);
}

// ===========================================================================
section("4 · NO INVENTED TRIGGER — a closed gate vocabulary, a closed field list");
// ===========================================================================
{
  const KINDS = ["height-arrival", "after-prev", "act1-report", "act1-front-live", "fall-stage", "fall-front-live", "fall-stand", "fall-choice", "rebuilt"];
  check("every gate kind is in the closed union", RAIL_ROWS.every((r) => KINDS.includes(r.gate.kind)));
  check("every gate kind is implemented in gateOpen",
    KINDS.every((k) => new RegExp(`case "${k}"`).test(railSrc)));
  check("no gate target outside the union is declared in the file",
    !/kind: "([a-z-]+)"/.test(railCode) ||
    [...railCode.matchAll(/kind: "([a-z-]+)"/g)].every((m) => KINDS.includes(m[1])));
  const banned: [string, RegExp][] = [
    ["Date.now(", /Date\.now\(/],
    ["performance.now(", /performance\.now\(/],
    ["setTimeout", /setTimeout/],
    ["setInterval", /setInterval/],
    ["Math.random", /Math\.random/],
    ["localStorage", /localStorage/],
    ["window", /\bwindow\b/],
    ["document", /\bdocument\b/],
  ];
  const found = banned.filter(([, re]) => re.test(railCode)).map(([n]) => n);
  check("no clock, no randomness, no storage, no DOM in the rail module", found.length === 0, found.join(","));
  check("the rail module imports no api/store/engine/tutorial-cues",
    !/from "[^"]*(api|store|engine|war\/tutorial-cues)[^"]*"/.test(railSrc));
  const ALLOW = new Set(["prologue", "leaders", "battles", "battleReports"]);
  const reads = [...railCode.matchAll(/\bstate\.([a-zA-Z_]+)/g)].map((m) => m[1]);
  check(`the rail reads only allow-listed state paths (${[...new Set(reads)].join(",")})`, reads.every((r) => ALLOW.has(r)));
  check("`now` reaches the core as a fact, and is used ONLY by the duty governor",
    (railCode.match(/f\.now/g) ?? []).length === 2 &&
    railCode.indexOf("f.now") > railCode.indexOf("export function dutyOpen") &&
    railCode.indexOf("f.now") < railCode.indexOf("export function deriveCursor"),
    String((railCode.match(/f\.now/g) ?? []).length));
  check("the context has no invented timer either (the mount uses the page's clock)",
    !/setTimeout|setInterval|Date\.now\(/.test(code(mountSrc)) && /clock\.current = now/.test(mountSrc));
}

// ===========================================================================
section("5 · DETERMINISM + IDEMPOTENCE — the same facts always yield the same row");
// ===========================================================================
{
  const st = withFronts(heightState(), { reports: 1 });
  const f = facts(st);
  const s0 = freshRailState(f);
  check("advanceRail is idempotent", JSON.stringify(advanceRail(advanceRail(s0, f), f)) === JSON.stringify(advanceRail(s0, f)));
  check("nextRailRow is deterministic", nextRailRow(s0, f)?.id === nextRailRow(s0, f)?.id);
  check("nextRailRow does not mutate the facts", JSON.stringify(f) === JSON.stringify(facts(st)));
  // the in-session fold: a row that has retired is never handed again
  let s = freshRailState(f);
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const row = nextRailRow(s, f);
    if (!row) break;
    seen.push(row.id);
    s = stepRail(s, f);
  }
  check("a row is handed once per session (the cursor is the memory)", new Set(seen).size === seen.length, seen.join(","));
  check("Beat 1.3's ten rows come out in script order", seen.slice(0, 10).join(",") === RAIL_ROWS.filter((r) => r.beat === "1.3").map((r) => r.id).join(","));
  check("nextRailRow returns null at the end of the rail", nextRailRow({ cursor: RAIL_ROWS.length, done: true }, f) === null);
  check("gateDead is only ever true for a passed arrival",
    RAIL_ROWS.every((r) => !gateDead(r, facts(heightState())) || r.gate.kind === "height-arrival"));
}

// ===========================================================================
section("6 · COMPOSITION WITH THE C TIER — disjoint ids, beats and mounts");
// ===========================================================================
{
  const cueIds = new Set(CUES.map((c) => c.id));
  check("RAIL_CUES ∩ CUE_IDS = ∅", RAIL_CUES.every((id) => !cueIds.has(id)));
  check("no rail row declares a C cue id", RAIL_ROWS.every((r) => !cueIds.has(r.id)));
  check("the rail module does not import the C tier's table (doc comments aside)",
    !/tutorial-cues/.test(railCode) && !/from\s+"[^"]*tutorial[^"]*"/.test(code(railSrc)));
  check("the plate keeps its three invariants (no z-index, no target when absent, no empty label row)",
    !/z-\d/.test(layerSrc) &&
    /\{\.\.\.\(cue\.pointsAt \? \{ "data-cue-target": cue\.pointsAt \} : \{\}\)\}/.test(layerSrc) &&
    /\{hasLabel \? \(/.test(layerSrc));
  check("the plate still renders the authored line verbatim", /cue\.line\}/.test(layerSrc) && !/speakable\(/.test(layerSrc));
  check("the C tier still satisfies the plate (type-level proof present)", /C_TIER_FITS_PLATE: TutorialCue extends PlateLine/.test(layerSrc));
  check("the plate's controls, chips and live region are unchanged",
    /data-testid="tutorial-step"/.test(layerSrc) && /data-testid="tutorial-sound-off"/.test(layerSrc) &&
    /aria-live="polite"/.test(layerSrc) && /id="tut-cue-line"/.test(layerSrc));
  check("the C mount's condition is untouched (one line, unchanged)",
    /\(tutorial\.cue \|\| tutorial\.showControls\)/.test(tabSrc));
  check("there is still exactly one plate mount inside BattlesTab", (tabSrc.match(/<TutorialCueLayer/g) ?? []).length === 1);
  check("the rail's plate carries its own aria-label and no target", /RAIL_ARIA_LABEL = "The Fall — the Cradle is speaking"/.test(mountSrc));
  check("the rail adds no new colour, motion or component vocabulary",
    !/#[0-9a-fA-F]{3,6}\b/.test(mountSrc) && !/animate-|transition-/.test(mountSrc));
}

// ===========================================================================
section("7 · NOTHING IS GATED — the observer proof");
// ===========================================================================
{
  check("the rail module assigns nothing to state", !/\bstate\.[a-zA-Z_]+\s*=/.test(railCode));
  check("the rail cannot reach an order", !/battleIssueFn|battleRespondFn|issueDecision|respondToBattle/.test(railSrc + mountSrc));
  check("the mount imports no order/api seam", !/from "[^"]*game\/api/.test(mountSrc));
  const probed = withFronts(heightState(), { reports: 2, liveAct1: true });
  const beforeProbe = JSON.stringify(probed);
  const publicBefore = JSON.stringify(publicState(probed));
  const f = facts(probed);
  deriveCursor(f); nextRailRow(freshRailState(f), f); advanceRail(freshRailState(f), f);
  dutyOpen(RAIL_ROWS[0], f); gateOpen(RAIL_ROWS[0], f); gateDead(RAIL_ROWS[0], f);
  railWords(RAIL_ROWS[0]); interRowGapMs(RAIL_ROWS[0], RAIL_ROWS[1]); silentDwellMs(RAIL_ROWS[0]);
  gateOpen(RAIL_ROWS.find((r) => r.id === "1.3-j")!, f); gateDead(RAIL_ROWS[0], f);
  railRowsForBeat("1.3"); stepRail(freshRailState(f), f);
  check("a full pass of the pure core mutates nothing", JSON.stringify(probed) === beforeProbe);
  check("the rail changes nothing the public state ships (the observer proof)",
    JSON.stringify(publicState(probed)) === publicBefore);
  const advanced = withFronts(heightState(), { reports: 2, liveAct1: true });
  engine.advance(advanced, T0 + 60_000);
  const shippedBefore = JSON.stringify(publicState(advanced));
  const f2 = facts(advanced);
  deriveCursor(f2); nextRailRow(freshRailState(f2), f2); dutyOpen(RAIL_ROWS[0], f2);
  check("…and nothing after an engine.advance() either, once the rail has read it",
    JSON.stringify(publicState(advanced)) === shippedBefore);
  check("the rail writes no Chronicle line (it never appends to `log`)",
    !/\.log\.push|historyBook\.push/.test(railCode + code(mountSrc)));
  check("the 2h clock's slot is still empty in the home screen",
    /data-slot="height-clock"/.test(cradleSrc) && !/data-slot="height-clock"[^>]*>\{/.test(cradleSrc));
}

// ===========================================================================
section("8 · STAGE + COLONY CORRECTNESS — what speaks, and for whom");
// ===========================================================================
{
  // a legacy colony (freshPrologue): rebuilt / completed false / no stand
  const legacy = engine.newGame("Legacy", "watchers", T0);
  const surfaces: (null | "home" | "battles")[] = [null, "home", "battles"];
  check("a legacy colony never speaks a rail line",
    surfaces.every((surface) => nextRailRow(freshRailState(facts(legacy, { surface })), facts(legacy, { surface })) === null));
  check("a legacy colony's cursor is parked at the top and its head gate is closed",
    deriveCursor(facts(legacy)) === 0 && !gateOpen(RAIL_ROWS[0], facts(legacy)));

  const atHeight = heightState();
  check("height + no reports → the cold open", nextFor(atHeight)?.id === "1.0-a");
  check("height + 1 report → the heroes' montage",
    nextFor(withFronts(heightState(), { reports: 1 }))?.id === "1.3-a");
  {
    // height + 2 reports + a live front: the montage plays, then 1.4-a
    const st2 = withFronts(heightState(), { reports: 2, liveAct1: true });
    const f2 = facts(st2);
    let s2 = freshRailState(f2);
    const seen2: string[] = [];
    for (let i = 0; i < 14; i++) {
      const row = nextRailRow(s2, f2);
      if (!row) break;
      seen2.push(row.id);
      s2 = stepRail(s2, f2);
    }
    check("height + 2 reports + a live front → the 1.3 block, then 1.4-a",
      seen2[0] === "1.3-a" && seen2[10] === "1.4-a", seen2.join(","));
  }
  {
    // height + 3 reports: 1.4-b then the whole 1.5 block, never the same row twice
    const st3 = withFronts(heightState(), { reports: 3 });
    let f = facts(st3);
    let s = freshRailState(f);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const row = nextRailRow(s, f);
      if (!row) break;
      seen.push(row.id);
      s = stepRail(s, f);
    }
    check("height + 3 reports → 1.4-b, then the 1.5 block",
      seen[0] === "1.4-b" && seen.slice(1, 7).join(",") === RAIL_ROWS.filter((r) => r.beat === "1.5").map((r) => r.id).join(","),
      seen.join(","));
    check("the 1.5 block ends and 1.6 follows", seen[7] === "1.6-oracle-a", seen.join(","));
  }
  check("suppressed → nothing speaks", nextFor(withFronts(heightState(), { reports: 3 }), { suppressed: true }) === null);
  check("no mount → nothing speaks", nextFor(heightState(), { surface: null }) === null);
  check("a row for another surface waits (the E tier is dormant by mount)",
    nextFor(withFronts(heightState(), { reports: 3 }), { surface: "battles" }) === null);
  check("a busy engine holds the row (one line at a time)",
    nextFor(heightState(), { engineIdle: false }) === null);

  const fallen = resolveCataclysm(withFronts(heightState(), { reports: 3 }), "archive", T0 + 10_000);
  // The cataclysm records the choice AND the stand as it resolves, so a world in
  // the middle of Act II is that same state before either is written — the row
  // the player is ASKED, not told.
  const midFall = resolveCataclysm(withFronts(heightState(), { reports: 3 }), "archive", T0 + 10_000);
  midFall.prologue!.ashMemory = null;
  midFall.prologue!.finalStand = null;
  check("stage fallen → the Chorus speaks first",
    nextFor(midFall)?.id === "2.1-chorus" && midFall.prologue?.stage === "fallen");
  check("a fallen world that already made the choice seats past Acts I–II",
    nextFor(fallen)?.id === "2.4-serev" && deriveCursor(facts(fallen)) === RAIL_ORDER.indexOf("2.4-serev"));
  check("the Fall's E rows wait for a Fall front",
    nextFor(fallen, { surface: "battles" }) === null);
  check("the E rows are gated on a live non-Act-I front",
    gateOpen(RAIL_ROWS.find((r) => r.id === "2.2-serev")!, facts(fallen, { fallLive: true })) === true);
  const fallenStand = resolveCataclysm(withFronts(heightState(), { reports: 3 }), "names", T0 + 10_000);
  check("finalStand is set by the cataclysm (the stand's gate has a producer)",
    fallenStand.prologue?.finalStand !== null && gateOpen(RAIL_ROWS.find((r) => r.id === "2.3-serev")!, facts(fallenStand)));
  check("the choice row waits for ashMemory",
    gateOpen(RAIL_ROWS.find((r) => r.id === "2.4-serev")!, facts(fallen, { ashMemory: false })) === false &&
    gateOpen(RAIL_ROWS.find((r) => r.id === "2.4-serev")!, facts(fallen, { ashMemory: true })) === true);

  const rebuilt = resetToCradle(fallen, T0 + 20_000);
  check("resetToCradle sets rebuilt + completed in the same tick (the D1 fact)",
    rebuilt.prologue?.stage === "rebuilt" && rebuilt.prologue?.completed === true && rebuilt.prologue?.finalStand !== null);
  check("stage rebuilt → Act III's first line, Acts I–II derived past",
    nextFor(rebuilt)?.id === "3.1-a" && deriveCursor(facts(rebuilt)) === RAIL_ORDER.indexOf("3.1-a"));
  check("a normal colony's default block never opens Act III",
    !gateOpen(RAIL_ROWS.find((r) => r.id === "3.1-a")!, facts(legacy)));

  // the closing Narrator line's roster rule (degradation: a short roster)
  const shortRoster = withFronts(heightState(), { reports: 1 });
  shortRoster.prologue!.heroes = shortRoster.prologue!.heroes.slice(0, 7);
  const fShort = facts(shortRoster);
  check("a short hero roster skips the closing 'eight champions' row",
    rosterRowSpeaks("1.3-j", fShort) === false && rosterRowSpeaks("1.3-a", fShort) === true);
  function rosterRowSpeaks(id: string, f: RailFacts): boolean {
    const row = RAIL_ROWS.find((r) => r.id === id)!;
    const present = new Set([...f.leaders, ...f.sealed, ...f.heroes]);
    return (row.requires ?? []).every((x) => present.has(x));
  }
  const noLeaders = withFronts(heightState(), { reports: 3 });
  noLeaders.leaders = [];
  check("a missing Leader skips their line and the beat continues", nextFor(noLeaders)?.id === "1.4-b");
}

// ===========================================================================
section("9 · THE DUTY GOVERNOR — it can only hold, never start");
// ===========================================================================
{
  const st = withFronts(heightState(), { reports: 3 });
  const row = RAIL_ROWS.find((r) => r.id === "1.4-b")!;
  const room = facts(st, { spoken: [{ id: "x", at: T0 - 10_000, seconds: 20 }] });
  check("with 20 s spent in the window the row speaks", dutyOpen(row, room) === true);
  const full = facts(st, {
    spoken: [
      { id: "a", at: T0 - 5_000, seconds: 24 },
      { id: "b", at: T0 - 1_000, seconds: 20 },
    ],
  });
  check("with 44 s spent in the window the row holds", dutyOpen(row, full) === false);
  check("the held row is still handed once the window slides", dutyOpen(row, facts(st, { now: T0 + 61_000, spoken: full.spoken })) === true);
  const stale = facts(st, { spoken: [{ id: "old", at: T0 - 90_000, seconds: 44 }] });
  check("speech older than the window does not count", dutyOpen(row, stale) === true);
  check("the governor holds the head row when the window is full",
    nextFor(heightState(), { spoken: full.spoken }) === null);
  check("a gate that never fired is skipped, never faked (1.4-a needs a live front)",
    !gateOpen(RAIL_ROWS.find((r) => r.id === "1.4-a")!, facts(withFronts(heightState(), { reports: 3 }))) &&
    nextFor(withFronts(heightState(), { reports: 3 }))?.id === "1.4-b");
  check("the governor's cap is the sheet's own number, imported not retyped",
    RAIL_CONFIG.dutySecondsPerMinute === VOICE_CONFIG.dutySecondsPerMinute && !/45/.test(railCode));
  check("the governor is the only user of `now` and cannot start a beat",
    RAIL_CONFIG.dutyWindowMs === 60_000 && typeof RAIL_CONFIG.wordsPerSecond === "number");
}

// ===========================================================================
section("10 · DEGRADATION — a reload cannot replay the war it missed");
// ===========================================================================
{
  const st3 = withFronts(heightState(), { reports: 3 });
  check("deriveCursor on 3 reports does not return the cold open",
    deriveCursor(facts(st3)) !== 0 && RAIL_ROWS[deriveCursor(facts(st3))].id === "1.4-b");
  check("deriveCursor never moves backwards as facts grow",
    deriveCursor(facts(withFronts(heightState(), { reports: 0 }))) <= deriveCursor(facts(st3)) &&
    scanMonotone());
  function scanMonotone(): boolean {
    const ids = ["1.0-a", "1.3-a", "1.4-b", "2.1-chorus", "2.3-serev", "2.4-serev", "3.1-a"];
    const seats = ids.map((id) => deriveCursor(facts(heightState(), { reports: id.startsWith("3.") ? 3 : 3 })));
    return seats.every((s, i) => i === 0 || s >= seats[i - 1]);
  }
  const st = withFronts(heightState(), { reports: 1 });
  const f = facts(st);
  const stepped = stepRail(freshRailState(f), f);
  check("stepRail lands only on a row whose gate is open (or past the end)",
    stepped.cursor >= RAIL_ROWS.length || gateOpen(RAIL_ROWS[stepped.cursor], f),
    `${stepped.cursor}:${RAIL_ROWS[stepped.cursor]?.id ?? "end"}`);
  const closed = facts(withFronts(heightState(), { reports: 0 }), { act1Reports: 0, stage: "fallen" as never });
  check("stepRail is a no-op when the head is not speakable", stepRail({ cursor: 0, done: false }, closed).cursor === 0);
  const silence = RAIL_ROWS.filter((r) => r.tier === "S");
  check("an S row produces no utterance (no speaker for the voice to read)",
    silence.every((r) => r.speaker === null && r.line === SILENCE_CAPTION));
  check("the S rows own their holds from the sheet's own numbers",
    silenceHoldMs(RAIL_ROWS.find((r) => r.id === "2.4-silence")!) === VOICE_CONFIG.gaps.silenceShort &&
    silenceHoldMs(RAIL_ROWS.find((r) => r.id === "2.5-silence")!) === VOICE_CONFIG.gaps.silenceTwo);
  check("the mount hands the voice nothing for an S row", /row\.tier === "S" \|\| !row\.speaker\) voiceEngine\.cue\(null\)/.test(mountSrc));
  check("a reload with nothing proven can still replay the cold open (D7, documented)",
    deriveCursor(facts(heightState())) === 0 && /D7|replay once|monotone/i.test(railSrc));
  const scriptBeats = scriptRawLines.filter((l) => /\*\(beat\)\*/.test(l));
  const marked = RAIL_ROWS.filter((r) => r.marks?.includes("beat"));
  check("the script writes exactly three `(beat)` marks and the rail marks exactly three rows",
    scriptBeats.length === 3 && marked.length === 3, `${scriptBeats.length}/${marked.length}`);
  check("every marked row IS one of those three lines (the beat is the script's own)",
    marked.every((r) => scriptBeats.some((l) => prose(l) === prose(r.line))),
    marked.map((r) => r.id).join(","));
  check("no unmarked row carries a written beat",
    RAIL_ROWS.filter((r) => !r.marks?.includes("beat"))
      .every((r) => !scriptBeats.some((l) => prose(l) === prose(r.line))));
  check("the split the marks drive is Act I 320 ms / Act II–III 520 ms",
    VOICE_CONFIG.gaps.beatActI === 320 && VOICE_CONFIG.gaps.beatActII === 520 &&
    marked.filter((r) => r.beat.startsWith("1.")).length === 2 &&
    marked.filter((r) => !r.beat.startsWith("1.")).length === 1);
  check("the `(beat)` mark is never rendered in a caption", RAIL_ROWS.every((r) => !/\(beat\)|\(a beat\)/.test(r.line)));
  check("the thesis mark is the engine's own hold", interRowGapMs(RAIL_ROWS.find((r) => r.id === "3.3-a")!, RAIL_ROWS.find((r) => r.id === "3.3-b")!) === VOICE_CONFIG.gaps.thesis);
  check("a speaker change takes the sheet's turn gap",
    interRowGapMs(RAIL_ROWS.find((r) => r.id === "1.1-vyra")!, RAIL_ROWS.find((r) => r.id === "1.1-narrator-a")!) === VOICE_CONFIG.gaps.turn);
}

// ===========================================================================
section("11 · THE LEDGER'S DEPTH + THE D1 DISARM (the amendment this slice exists for)");
// ===========================================================================
{
  const st = withFronts(heightState(), { reports: 3 });
  check("the report ledger keeps ≥3 resolved Act I fronts (the derivation stays exact)",
    (st.battleReports as unknown[]).length >= 3 && facts(st).act1Reports === 3);
  check("the ledger is append-only in the rail's view (no trimming found in the module)",
    !/slice\(-|splice\(/.test(railCode));
  // D1: the disarm is the END OF ACT III's rail, never the `completed` flag
  resetRailStoryDone();
  const rebuilt = resetToCradle(resolveCataclysm(withFronts(heightState(), { reports: 3 }), "light", T0 + 9_000), T0 + 10_000);
  const f = facts(rebuilt);
  const s = freshRailState(f);
  check("the rebuilt state alone does NOT disarm the voices (Act III must speak)",
    rebuilt.prologue?.completed === true && railStoryDone() === false);
  check("Act III's six rows are all reachable from the rebuilt state",
    (() => {
      let cur = s;
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) {
        const row = nextRailRow(cur, f);
        if (!row) break;
        seen.push(row.id);
        cur = stepRail(cur, f);
      }
      return seen.join(",") === RAIL_ROWS.filter((r) => r.beat.startsWith("3.")).map((r) => r.id).join(",");
    })());
  markRailStoryDone();
  check("retiring 3.3-b is what flips `railStoryDone()`", railStoryDone() === true);
  check("both call sites read the SAME exported predicate",
    /railStoryDone\(\)/.test(tabSrc) && /railStoryDone\(\)/.test(mountSrc) &&
    /voiceEngine\.complete\(completed && storyDone\)/.test(tabSrc) &&
    /voiceEngine\.complete\(completed && railStoryDone\(\)\)/.test(mountSrc));
  check("the disarm still silences the engine when it lands",
    /if \(this\.completed\) this\.silence\(\)/.test(engineCode));
  check("the mount watches the last row by id (the trigger is the rail's own)", /LAST_ROW_ID = "3\.3-b"/.test(mountSrc));
  resetRailStoryDone();
  check("the flag is session-local (never persisted, never in GameState)",
    !/localStorage|GameState/.test(railSrc.slice(railSrc.indexOf("let storyDone"))) && /let storyDone = false/.test(railCode));
}

// ===========================================================================
section("12 · THE ENGINE + PLATE CHANGES + THE BATTERY'S OTHER INVARIANTS");
// ===========================================================================
{
  check("VoiceCue carries the scene and the surface (the rail's two fields)",
    /scene\?: string/.test(read(ENGINE_TS)) && /surface\?: VoiceSurface/.test(read(ENGINE_TS)));
  check("the scene falls back to the C tier's own table",
    /cue\.scene \?\? VOICE_SCENE_BY_CUE\[cue\.id\]/.test(engineCode));
  check("the surface gate is per line",
    /const surfaceOk = cue\?\.surface \? this\.surfaceValue !== "battles" : this\.surfaceValue === "battles"/.test(engineCode));
  check("every internal gate check passes the line it is judging",
    !/this\.blocked\(\)/.test(engineCode));
  check("the rail's plate declares its own surface", /surface: "rail"/.test(mountSrc));
  check("the plate accepts a wider line without touching the C mount",
    /export interface PlateLine/.test(layerSrc) && /cue: PlateLine \| null/.test(layerSrc));
  check("the plate gained the optional ariaLabel (default = the ratified words)",
    /ariaLabel = "Battle guidance"/.test(layerSrc) && /aria-label=\{ariaLabel\}/.test(layerSrc));
  check("the home mounts the plate between B1 and B2, presentation only",
    /narration=\{<RailNarration state=\{state\} now=\{now\} muted=\{muted\} \/>\}/.test(playSrc) &&
    /\{narration \?\? null\}/.test(cradleSrc));
  check("CradleScreen reads no battle ledger (the slot stays clean)",
    !/state\.battles|state\.battleReports/.test(cradleSrc));
  check("the plate is NOT mounted on the Battles view (D5)",
    (tabSrc.match(/<RailNarration/g) ?? []).length === 0);
  check("the sheet's Fall invariants still stand",
    /nav-battles/.test(read(`${SITE}/src/game/war/tutorial-cues.ts`)) &&
    /scroll-mb-40/.test(tabSrc) && /scroll-mt-32/.test(tabSrc));
  check("the mount's plate is in flow (no z-index, no fixed, no overlay)",
    !/z-\d|fixed |absolute /.test(mountSrc));
  check("no player-facing rule vocabulary leaks into the rail's copy",
    !/pay-to-win|earn cap|no solo win|purchase|storefront/i.test(RAIL_ROWS.map((r) => r.line).join(" ")));
  check("the rail ships no art, no audio file and no spend",
    !/\.mp3|\.wav|\.png|\.svg/.test(railSrc + mountSrc));
}
console.log(`\nrail-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
