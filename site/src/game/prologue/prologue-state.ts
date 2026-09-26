// PROLOGUE STATE — "The Fall" state spine (opening-prologue-spec §4–§8, Step 2).
//
// The pure, deterministic, engine-side ledger for the voiced opening: the
// prologue block lives on every GameState (`state.prologue`), and this module
// owns its shape, its defaults (`freshPrologue`), its V11 migration
// (`ensurePrologue`), and the sealed height data (the five named Leaders, the
// Watcher roster, the ash echoes). The state TRANSITIONS (the full-power seed,
// the scripted cataclysm, the single-Cradle reset) live in prologue-engine.ts
// — this module stays import-free of the engine so `engine.ts` can import it
// with no cycle.
//
// Hard rules (each asserted by prologue-tests/prologue-verify.ts):
//   • DETERMINISTIC — the seed and every transition are pure functions of
//     (state, now); zero Math.random anywhere in the prologue modules the
//     runtime path can reach (comment-aware scan).
//   • NO PURCHASE SURFACE — the final choice ("what the ash remembers") is
//     never a purchase: no storefront term exists in executable code here, the
//     cataclysm never touches the monetization block, and nothing in the
//     prologue is payable (static + behavioral assertions).
//   • ADDITIVE MIGRATION — legacy saves (pre-V11) advance cleanly and gain a
//     default block: stage "rebuilt" (a colony that never ran the prologue is
//     already past the Fall), completed false, no echoes. Idempotent.
//   • THE LEDGER IS NEVER DELETED — the sealed height records (the five named
//     Leaders, the eight Watcher heroes) survive the Fall as records: they are
//     marked fallen/unfound, not removed (spec §6: "the Leaders/heroes are
//     marked fallen/unfound, not deleted from the ledger").
//
// Design anchors (owner-locked 2026-09-14/15):
//   • Leader names: Kael ("the Steward" — a generalist TITLE, never a path),
//     Serev (Marshal), Vyra (Scholar), Miren (Quartermaster), Delen
//     (Purifier — mechanics DEFERRED; name/title stub only).
//   • The final choice = "what the ash remembers": The Archive (knowledge) /
//     The Names (people) / The Light (purity) — three rebuild seeds, none
//     correct, none purchasable, recorded as a ONE-TIME account-level echo.
import type { GameState, Leader, RaceId, Specialty } from "../types";
import type { FobStage } from "../war/war-types";
import type { HeroUnit, HeroSpecialization } from "../hero-xp";
import type { HeroRole } from "../heroes-data";
import { RACE_WAVE_STATE } from "../heroes-data";
import { xpForLevel } from "../leader-xp";
import { MAX_DOMAIN_LEVEL } from "../zones";
// (hero-xp / research are runtime-imported by prologue-engine.ts, which owns
// the actual seed construction; this module only declares shapes + defaults.)
import type { Specialization } from "../leader-xp";

// ============================================================================
// §1 TYPES — the prologue block on GameState
// ============================================================================

/** Act tracker: "height" (Act I — full power) → "fallen" (Act II — the
 *  scripted loss) → "rebuilt" (Act III — single Cradle, the real game). */
export type PrologueStage = "height" | "fallen" | "rebuilt";
/** The final order's rebuild seed — "what the ash remembers" (script §7).
 *  Recorded exactly once per prologue, never purchasable, none "correct". */
export type AshMemory = "archive" | "names" | "light";
/** Post-Fall disposition of a sealed record. "unfound" is the Leaders' fate
 *  (last seen holding the line; never recovered — the climb back to known
 *  people); "fallen" is the heroes' fate (their deaths were witnessed). */
export type PrologueFate = "fallen" | "unfound";

/** Sealed height record of one named Leader (never deleted — only fated). */
export interface PrologueLeaderRecord {
  id: string;
  name: string;
  /** Kael's title is "the Steward" — a generalist caretaker label, NEVER a
   *  specialization. Delen's "the Purifier" is a stub (mechanics deferred). */
  title: string;
  specialty: Specialty;
  specialization: Specialization | null;
  level: number; // the height is L10 for all five
  fate: PrologueFate | null; // null = standing at the height
}

/** Sealed height record of one hero — the full HeroUnit ledger plus fate. */
export interface PrologueHeroRecord extends HeroUnit {
  fate: PrologueFate | null;
}

/** The height's war-posture snapshot (opening-prologue-spec §4 "War posture").
 *  FOB at Citadel stage; deep war supply; a high contribution score. */
export interface PrologueHeightSnapshot {
  fobStage: FobStage; // 4 = Citadel/Arsenal (battle-side §12.4)
  troops: number; // warReserve supply-weighted troops at the height
  energy: number; // warReserve energy pool at the height
  cycleId: string; // the war week the height belongs to
  armoryTiers: Record<string, number>; // familyId -> tier (all four at the height)
  contribution: number; // engine.contributionScore at the height
}

/** The record of the final stand — the §6 "odds are SHOWN, not hidden" rule
 *  expressed as DATA (the UI/flow slice renders it; nothing here is a prompt).
 *  Deterministic: the chorus force is a fixed multiple of the colony's own
 *  full-power strength, so the win chance is honest, unwinnable-by-design
 *  math — and never a paywall (the loss cannot be survived). */
export interface PrologueFinalStand {
  at: number; // epoch ms the stand fell
  colonyPower: number;
  chorusPower: number; // finalStandChorusMultiple × colonyPower
  /** Shown odds 0..1 — colony / (colony + chorus). Data only. */
  winChance: number;
  line: string; // the narrator's framing — mourning, never humiliation
}

/** The prologue block — the per-colony ledger for "The Fall". */
export interface PrologueBlock {
  stage: PrologueStage;
  completed: boolean; // true only after resetToCradle (the Act III handoff)
  ashMemory: AshMemory | null; // the one-time echo, recorded at the cataclysm
  /** Sealed height records — NEVER deleted; fate-marked post-Fall. */
  leaders: PrologueLeaderRecord[];
  heroes: PrologueHeroRecord[];
  /** Active war loadout at the height (3–5 hero ids — the squad). */
  squad: string[];
  height: PrologueHeightSnapshot | null; // null = never ran the prologue
  finalStand: PrologueFinalStand | null; // set by resolveCataclysm
  /** The ash ledger — History-Book raw lines pre-seeded by the final choice. */
  historyBook: string[];
  /** The Archive echo: the single remembered Codex (its recalled line). */
  codexEcho: string | null;
  /** The Light echo: Delen's remembered near-riddle. */
  riddleEcho: string | null;
  /** The Light echo: the small starting devotion amount (0 unless chosen). */
  devotionEcho: number;
}

// ============================================================================
// §2 CONFIG — ONE place for every tunable number (calibration may change the
// numbers, never the rules; the rules are asserted by the harness).
// ============================================================================
export const PROLOGUE_CONFIG = {
  /** The height: every domain maxed at the ladder's top rung (deterministic
   *  seed). Not a second literal 10 — the ONE ceiling constant. */
  maxDomainLevel: MAX_DOMAIN_LEVEL,
  /** The height: L10 for every Leader and hero (xpForLevel(10) = 5000). */
  maxXp: xpForLevel(10),
  maxLevel: 10,
  /** FOB at Citadel/Arsenal stage 4 — the §12.4 ceiling (battle-side spec). */
  fobStageAtHeight: 4 as FobStage,
  warReserveTroops: 4000,
  warReserveEnergy: 600,
  warCycleId: "prologue-height",
  /** Every weapon family at its max tier 4 (all 5 roles × 4 tiers). */
  armoryTierAtHeight: 4,
  /** The active squad size at the height (war loadout 3–5; we field 5). */
  squadSize: 5,
  // ---- the three ash echoes (final choice — spec §6.2 / script §7) ----
  /** The Archive — exactly ONE remembered Codex + Vyra "lost, not found". */
  archiveCodices: 1,
  codexEchoLine: "The First Lesson — 'The archive burns; the knowing does not. Carry the knowing.'",
  vyraBookLine: "Vyra — the Scholar — lost, not found.",
  /** The Names — the five Leaders' names pre-seeded in the History Book. */
  namesBookLines: [
    "Kael — the Steward — fell covering the Commander's escape.",
    "Serev — the Marshal — fell holding the last line.",
    "Vyra — the Scholar — lost with the Academy's knowing.",
    "Miren — the Quartermaster — fell with the ledgers unclosed.",
    "Delen — the Purifier — fell with the gold light.",
  ] as const,
  /** The Light — a SMALL devotion head-start + Delen's near-riddle remembered. */
  devotionEcho: 3, // ≈ half a day's 4-item list (TD2: +7/day max) — deliberately small
  delenBookLine: "Delen — the Purifier — the gold burns low. Keep what is clean, clean.",
  delenRiddle:
    "The gold burns low. Keep what is clean, clean. Do not let the shadow be you. Go now — while there is still a you to go.",
  // ---- the final stand (cataclysm; §6 fair-by-design) ----
  /** The Chorus force is a fixed multiple of the colony's own full power:
  unwinnable BY CONSTRUCTION, odds shown, never a purchase prompt. */
  finalStandColonyPower: 6000,
  finalStandChorusMultiple: 8,
  finalStandLine: "You were winning. You were always going to lose.",
  fallenHistoryLine: "Fell in the Fall, holding the line while the Commander escaped.",
  /** Default name for a seeded height colony (Act I; Act III renames through
  the normal flow). */
  heightColonyName: "The Last Academy",
} as const;

// ============================================================================
// §3 THE FIVE NAMED LEADERS (owner-locked 2026-09-14) and the Watcher roster.
// ============================================================================

/** The five named Leaders — the emotional engine of the opening (script §2).
 *  Attributes are the 13-point base pool (engine standard); the nine free
 *  L10 points are allocated deterministically into the strongest base
 *  attribute (see prologue-engine.ts allocateInto). */
export const PROLOGUE_LEADERS: readonly {
  id: string;
  name: string;
  title: string;
  specialty: Specialty;
  specialization: Specialization | null;
  attributes: Leader["attributes"];
  history: string[];
}[] = [
  {
    id: "ld-kael",
    name: "Kael",
    title: "the Steward",
    specialty: "logistician",
    specialization: null, // generalist/starter — the TITLE is the point, never a path
    attributes: { research: 3, economy: 3, combat: 3, engineering: 4 },
    history: ["Held the Cradle through the Ninth Siege.", "Refused to leave the last supply run to anyone else."],
  },
  {
    id: "ld-serev",
    name: "Serev",
    title: "the Marshal",
    specialty: "tactician",
    specialization: "marshal",
    attributes: { research: 2, economy: 2, combat: 6, engineering: 3 },
    history: ["Broke the Chorus line at the Ravine with two squads.", "Walked the front alone to bring a wounded company home."],
  },
  {
    id: "ld-vyra",
    name: "Vyra",
    title: "the Scholar",
    specialty: "engineer",
    specialization: "scholar",
    attributes: { research: 4, economy: 2, combat: 2, engineering: 5 },
    history: ["Recovered the Academy's founding ledger from a burning archive.", "Turned three Chorus interrogations into lectures."],
  },
  {
    id: "ld-miren",
    name: "Miren",
    title: "the Quartermaster",
    specialty: "economist",
    specialization: "quartermaster",
    attributes: { research: 2, economy: 5, combat: 2, engineering: 4 },
    history: ["Balanced a season's books during a siege; nothing was short.", "Cut the Cradle's waste by a third without cutting a ration."],
  },
  {
    id: "ld-delen",
    name: "Delen",
    title: "the Purifier",
    specialty: "horticulturist",
    specialization: null, // Purifier path DEFERRED to the corruption/Oracle layer — stub/name only
    attributes: { research: 3, economy: 2, combat: 3, engineering: 5 },
    history: ["Kept the gold light lit through five corruption storms.", "Spoke one sentence at the funeral that made the city breathe."],
  },
];

/** Deterministic L3 specialization per hero ROLE (sidegraded; calibration may
 *  change numbers, never the mapping rule). */
export const HERO_SPEC_BY_ROLE: Record<HeroRole, HeroSpecialization> = {
  tank: "hearthward",
  damage: "vanguard",
  support: "hearthward",
  utility: "courser",
  econwar: "courser",
};

/** The active war loadout at the height: one champion per role (5 of 8).
 *  The other three stand in reserve — the full roster is still theirs. */
export const PROLOGUE_SQUAD: readonly string[] = [
  "azazel-3", // tank
  "last-lecturer", // damage
  "semira-revealer", // support
  "vesper-syllabus", // utility
  "keeper-mend", // econwar
];

/** Hero ids published for the given race (beta = Watchers Wave 1). */
export function heroesForRace(race: RaceId): readonly string[] {
  return RACE_WAVE_STATE[race]?.wave1HeroIds ?? [];
}

// ============================================================================
// §4 DEFAULTS + MIGRATION (V11 — additive, idempotent, never corrupts)
// ============================================================================

/** The default block every save carries when it never ran the prologue:
 *  stage "rebuilt" (a legacy/new colony is by definition past the Fall),
 *  completed false, no echoes, no sealed records. This is also what
 *  ensurePrologue backfills onto pre-V11 saves. */
export function freshPrologue(): PrologueBlock {
  return {
    stage: "rebuilt",
    completed: false,
    ashMemory: null,
    leaders: [],
    heroes: [],
    squad: [],
    height: null,
    finalStand: null,
    historyBook: [],
    codexEcho: null,
    riddleEcho: null,
    devotionEcho: 0,
  };
}

/**
 * V11 migration: the prologue block. Old saves get the default block (stage
 * "rebuilt", completed false, no echoes — a legacy colony is already past the
 * Fall and never ran the prologue). Partial/garbled blocks are repaired
 * field-by-field; existing valid state is never rewritten. Idempotent.
 * engine.advance() calls this alongside the other ensure* pass.
 */
export function ensurePrologue(state: GameState): void {
  const s = state as unknown as Record<string, unknown>;
  const p = s.prologue as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    s.prologue = freshPrologue();
    return;
  }
  if (p.stage !== "height" && p.stage !== "fallen" && p.stage !== "rebuilt") p.stage = "rebuilt";
  if (typeof p.completed !== "boolean") p.completed = false;
  if (p.ashMemory !== "archive" && p.ashMemory !== "names" && p.ashMemory !== "light") p.ashMemory = null;
  if (!Array.isArray(p.leaders)) p.leaders = [];
  if (!Array.isArray(p.heroes)) p.heroes = [];
  if (!Array.isArray(p.squad)) p.squad = [];
  if (!p.height || typeof p.height !== "object" || Array.isArray(p.height)) p.height = null;
  if (!p.finalStand || typeof p.finalStand !== "object" || Array.isArray(p.finalStand)) p.finalStand = null;
  if (!Array.isArray(p.historyBook)) p.historyBook = [];
  if (typeof p.codexEcho !== "string") p.codexEcho = null;
  if (typeof p.riddleEcho !== "string") p.riddleEcho = null;
  if (typeof p.devotionEcho !== "number" || !isFinite(p.devotionEcho as number) || (p.devotionEcho as number) < 0) {
    p.devotionEcho = 0;
  }
}