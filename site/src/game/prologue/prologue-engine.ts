// PROLOGUE ENGINE — "The Fall" state transitions (opening-prologue-spec §4–§8,
// Step 2 — the state spine; NO UI, NO route wiring; the tutorial/flow slice is
// a separate follow-up).
//
// Three pure, deterministic transitions over GameState:
//   • prologueState(now, race)  — the full-power seed at the height of the war
//     (Act I): maxed colony, the five named Leaders at L10 with their locked
//     titles/specializations, a Citadel-stage FOB, deep war supply, all four
//     armory tiers, the full Watcher roster + active squad. A configuration,
//     not a progression system (spec §4): the same state shape the real game
//     builds toward, pre-filled.
//   • resolveCataclysm(state, ash) — the scripted, FAIR, deterministic loss
//     (Act II): strips the height to "fallen". The colony is lost; the
//     Leaders/heroes are marked unfound/fallen in the sealed ledger — never
//     deleted. The odds/no-win framing ships as DATA (prologue.finalStand),
//     never a prompt and never a purchase.
//   • resetToCradle(state) — Act III: a single fresh Cradle handed off to the
//     normal new-colony defaults, then the ONE-TIME ash echo is applied:
//     Archive → exactly one Codex + Vyra "lost, not found"; Names → the five
//     Leaders' names pre-seeded in the History Book; Light → a small starting
//     devotion + Delen's near-riddle remembered. Sets prologue.completed.
//
// Determinism & fairness rules (asserted by prologue-tests):
//   • Zero Math.random anywhere on the runtime path.
//   • The cataclysm's loss is never survivable and never payable — this module
//     references no monetization state and ships no wallet vocabulary in
//     executable code.
//   • resetToCradle is guarded (only from "fallen") so the echo can never be
//     double-applied — idempotent by construction.
import type { GameState, Leader, RaceId } from "../types";
import { newGame, contributionScore } from "../engine";
import { freshWarReserve } from "../war/battle-engine";
import {
  PROLOGUE_CONFIG,
  PROLOGUE_LEADERS,
  PROLOGUE_SQUAD,
  HERO_SPEC_BY_ROLE,
  heroesForRace,
  freshPrologue,
  type PrologueHeroRecord,
} from "./prologue-state";
import { newHeroUnit, applyHeroLevelUps, allocateHeroPoint, chooseHeroSpec } from "../hero-xp";
import { HERO_BY_ID } from "../heroes-data";
import { freshLeaderXpState } from "../leader-xp";
import { ARMORY_TREE, TECH_TREE } from "../research";
import { WEAPON_TYPES } from "../armory";

// ============================================================================
// §1 SEED DATA — deterministic "everything" numbers for the height.
// ============================================================================
const HEIGHT_RESOURCES = {
  embers: 5000,
  chipsets: 40,
  supplies: 20_000,
  hazmat: 200,
  shots: 200,
  alloys: 100,
  medkit: 100,
  mechkit: 100,
  armorkit: 100,
  skmech: 80,
  gas: 1000,
  battery: 800,
  plasma: 60,
} as const;
const HEIGHT_MATS: Record<RaceId, number> = { grays: 25, nephilim: 25, draconians: 25, anunnaki: 25, ashtar: 25, watchers: 25 };
/** All 20 tree techs + the 7 armory nodes — "all research complete". */
const HEIGHT_TECHS: readonly string[] = [...TECH_TREE.map((t) => t.id), ...ARMORY_TREE.map((t) => t.id)];
/** Deterministic deed ledger at the height (contribution's recognition term). */
const HEIGHT_DEEDS: readonly string[] = [
  "deed_first_recovery",
  "deed_ten_codices",
  "deed_deep_clean_return",
  "deed_five_clean_streak",
  "deed_first_weapon_built",
  "deed_weapon_tier4",
  "deed_leader_l5",
  "deed_daily_week",
  "deed_research_20",
  "deed_chipset_chief",
  "deed_plasma_refined",
  "deed_steward_watch",
  "deed_oracle_riddle",
  "deed_last_stand",
];

/** +9 into the strongest base attribute (deterministic; ties go research,
 *  economy, combat, engineering — the canonical Leader attribute order). */
function allocateInto(attrs: Leader["attributes"]): Leader["attributes"] {
  const order: (keyof Leader["attributes"])[] = ["research", "economy", "combat", "engineering"];
  const key = order.reduce((best, k) => (attrs[k] > attrs[best] ? k : best), "research" as const);
  return { ...attrs, [key]: attrs[key] + (PROLOGUE_CONFIG.maxLevel - 1) };
}

/** Build one named Leader at L10 with title/specialization/history seeded. */
function buildLeader(def: (typeof PROLOGUE_LEADERS)[number], now: number): Leader {
  const xp = freshLeaderXpState(now);
  return {
    id: def.id,
    name: def.name,
    title: def.title,
    specialty: def.specialty,
    attributes: allocateInto(def.attributes),
    joinedAt: now,
    assignment: null,
    history: def.history.slice(),
    status: "active",
    breakthroughs: 12,
    codicesEarned: 40,
    xp: PROLOGUE_CONFIG.maxXp,
    unspentPoints: 0,
    xpPointsGranted: PROLOGUE_CONFIG.maxLevel - 1,
    specialization: def.specialization,
    day: xp.day,
    dayXp: xp.dayXp,
  };
}

/** Build one hero at L10 with all nine free points into its dominant base
 *  attribute and the deterministic L3 role specialization. */
function buildHero(defId: string, now: number): PrologueHeroRecord {
  const def = HERO_BY_ID[defId];
  if (!def) throw new Error(`Prologue roster references unknown hero "${defId}".`);
  const hero = newHeroUnit(def, def.signatureDeed, now);
  hero.xp = PROLOGUE_CONFIG.maxXp;
  applyHeroLevelUps(hero); // grants the 9 free L10 points (level − 1)
  const order: ("power" | "guard" | "craft" | "presence")[] = ["power", "guard", "craft", "presence"];
  const key = order.reduce((best, k) => (hero.attributes[k] > hero.attributes[best] ? k : best), "power" as const);
  for (let i = 0; i < PROLOGUE_CONFIG.maxLevel - 1; i++) allocateHeroPoint(hero, key);
  chooseHeroSpec(hero, HERO_SPEC_BY_ROLE[def.role]);
  hero.energyWeek = { cycleId: PROLOGUE_CONFIG.warCycleId, spent: 0 };
  return { ...hero, fate: null };
}

// ============================================================================
// §2 prologueState — the full-power seed (Act I, "had it all").
// ============================================================================
/** A full-power GameState at the height of the final war — deterministic
 *  (pure in `now`; zero randomness in the shape). Beta runs the Watchers cut;
 *  per-race prologues reuse this factory with their world's constants. */
export function prologueState(now = Date.now(), race: RaceId = "watchers"): GameState {
  const st = newGame(PROLOGUE_CONFIG.heightColonyName, race, now);
  st.gameId = "prologue";

  // ---- colony: everything a maxed Cradle holds (spec §4) ----
  const r = st.resources;
  r.embers = HEIGHT_RESOURCES.embers;
  r.chipsets = HEIGHT_RESOURCES.chipsets;
  r.supplies = HEIGHT_RESOURCES.supplies;
  r.hazmat = HEIGHT_RESOURCES.hazmat;
  r.shots = HEIGHT_RESOURCES.shots;
  r.alloys = HEIGHT_RESOURCES.alloys;
  r.medkit = HEIGHT_RESOURCES.medkit;
  r.mechkit = HEIGHT_RESOURCES.mechkit;
  r.armorkit = HEIGHT_RESOURCES.armorkit;
  r.skmech = HEIGHT_RESOURCES.skmech;
  r.gas = HEIGHT_RESOURCES.gas;
  r.battery = HEIGHT_RESOURCES.battery;
  r.plasma = HEIGHT_RESOURCES.plasma;
  r.mats = { ...HEIGHT_MATS };

  st.scientists = 60;
  st.totalScientists = 60;
  st.insight = 5000;
  for (const d of ["weaponry", "agriculture", "economy", "industry", "logistics"] as const) {
    st.deployedDomains[d] = PROLOGUE_CONFIG.maxDomainLevel;
  }
  st.deployablePrograms = Array.from({ length: 24 }, (_, i) => `program-${i + 1}`);
  st.codices = 0;
  st.totalCodicesEarned = 520;
  st.techsResearched = HEIGHT_TECHS.slice();
  st.deedsCompleted = HEIGHT_DEEDS.slice();
  st.completedExpeditions = 350;
  st.totalEmbersLooted = 12_000;
  st.totalChipsetsLooted = 120;
  st.totalBreakthroughs = 90;

  // ---- the five named Leaders (owner-locked names/titles/specializations ----
  st.leaders = PROLOGUE_LEADERS.map((def) => buildLeader(def, now));

  // ---- the war posture (spec §4): all 5 families × all 4 tiers ----
  for (const fam of WEAPON_TYPES) st.armory[fam] = { tier: PROLOGUE_CONFIG.armoryTierAtHeight, everBuilt: true };
  st.weaponsBuilt = 24;
  st.warReserve = freshWarReserve(PROLOGUE_CONFIG.warCycleId);
  st.warReserve.troops = PROLOGUE_CONFIG.warReserveTroops;
  st.warReserve.energy = PROLOGUE_CONFIG.warReserveEnergy;
  st.warReserve.aidCredits = 25;

  // ---- seal the height into the prologue ledger ----
  const heroes = heroesForRace(race).map((id) => buildHero(id, now));
  st.prologue = {
    ...freshPrologue(),
    stage: "height",
    completed: false,
    ashMemory: null,
    leaders: PROLOGUE_LEADERS.map((def) => ({
      id: def.id,
      name: def.name,
      title: def.title,
      specialty: def.specialty,
      specialization: def.specialization,
      level: PROLOGUE_CONFIG.maxLevel,
      fate: null,
    })),
    heroes,
    squad: PROLOGUE_SQUAD.filter((id) => heroes.some((h) => h.id === id)).slice(0, PROLOGUE_CONFIG.squadSize),
    height: {
      fobStage: PROLOGUE_CONFIG.fobStageAtHeight,
      troops: PROLOGUE_CONFIG.warReserveTroops,
      energy: PROLOGUE_CONFIG.warReserveEnergy,
      cycleId: PROLOGUE_CONFIG.warCycleId,
      armoryTiers: Object.fromEntries(WEAPON_TYPES.map((f) => [f, PROLOGUE_CONFIG.armoryTierAtHeight])),
      contribution: contributionScore(st),
    },
    finalStand: null,
    historyBook: [],
    codexEcho: null,
    riddleEcho: null,
    devotionEcho: 0,
  };
  st.log.push("The height of the final war. Everything is yours. Remember this.");
  return st;
}

// ============================================================================
// §3 resolveCataclysm — the scripted, fair, deterministic loss (Act II).
// ============================================================================
/**
 * The Fall. Strips the full-power state back to "fallen": the colony is lost —
 * resources, arsenal, research and deployed AI are gone; the Chorus sits at its
 * world-ending height; the Leaders are marked UNFOUND and the heroes FALLEN in
 * the sealed ledger (never deleted). The ashMemory (the player's final order —
 * "what the ash remembers") is recorded exactly once. Deterministic: no
 * randomness, no purchase surface, no softlock — the fallen state advances
 * cleanly and hands straight to resetToCradle.
 *
 * No-op (returns the state unchanged) unless the prologue is at "height" and
 * the choice is one of the three seeds — so it can never corrupt a live save
 * or double-run.
 */
export function resolveCataclysm(state: GameState, ashMemory: "archive" | "names" | "light", now = Date.now()): GameState {
  const p = state.prologue;
  if (!p || p.stage !== "height") return state;
  if (ashMemory !== "archive" && ashMemory !== "names" && ashMemory !== "light") return state;

  // The war is over; active battle entities are cleared, the report ledger
  // (the History Book's raw material) is never deleted.
  state.battles = [];
  state.warReserve = freshWarReserve(null);

  // The colony is lost: resources, gear, arsenal, research, deployed AI.
  const zero = { grays: 0, nephilim: 0, draconians: 0, anunnaki: 0, ashtar: 0, watchers: 0 };
  state.resources = {
    embers: 0, chipsets: 0, supplies: 0,
    hazmat: 0, shots: 0, alloys: 0,
    medkit: 0, mechkit: 0, armorkit: 0,
    skmech: 0, gas: 0, battery: 0,
    mats: zero,
    plasma: 0,
    // THE FORGE's ingredient: the cataclysm empties the crucible too.
    warplate: 0,
  };
  state.scientists = 0;
  state.totalScientists = 0;
  state.insight = 0;
  state.deployedDomains = { weaponry: 0, agriculture: 0, economy: 0, industry: 0, logistics: 0 };
  state.deployablePrograms = [];
  state.codices = 0;
  state.techsResearched = [];
  state.researchJobs = [];
  state.expeditions = [];
  state.studies = [];
  state.armory = {};
  state.armoryBuilds = {};
  // The Chorus at 100% attention scaled to a world-ending event (spec §6) —
  // the ratchet's worst tier, told as history.
  state.chorusAttention = 100;
  state.corruption = 100;

  // The Leaders are marked UNFOUND — never deleted from the ledger (spec
  // §6.1/6.2: they covered the escape; the climb back re-earns KNOWN people).
  for (const l of state.leaders) {
    l.status = "lost";
    l.assignment = null;
    l.history.push(PROLOGUE_CONFIG.fallenHistoryLine);
  }

  // Seal the fall into the ledger + record the final order's seed.
  p.stage = "fallen";
  p.completed = false;
  p.ashMemory = ashMemory;
  for (const rec of p.leaders) rec.fate = "unfound";
  for (const rec of p.heroes) rec.fate = "fallen";
  const colonyPower = PROLOGUE_CONFIG.finalStandColonyPower;
  const chorusPower = colonyPower * PROLOGUE_CONFIG.finalStandChorusMultiple;
  p.finalStand = {
    at: now,
    colonyPower,
    chorusPower,
    winChance: Math.round((colonyPower / (colonyPower + chorusPower)) * 1000) / 1000,
    line: PROLOGUE_CONFIG.finalStandLine,
  };
  state.log.push(`THE FALL — ${p.finalStand.line} The colony is lost. What the ash remembers: ${ashMemory}.`);
  return state;
}

// ============================================================================
// §4 resetToCradle — Act III: one fresh Cradle + the one-time ash echo.
// ============================================================================
/**
 * The Wake. Reduces the fallen state to a SINGLE fresh Cradle handed off to
 * the normal new-colony defaults (`engine.newGame`), preserving identity
 * (gameId / race / playerName), then applies the chosen ashMemory echo EXACTLY
 * once and sets prologue.completed = true. The sealed height records + the
 * final stand ride forward (memory is not deleted). Idempotent by guard: only
 * runs from "fallen", so the echo can never be applied twice; re-running on
 * the rebuilt state is a no-op.
 *
 * Echoes (script §7 — each grants exactly its stated seed and nothing else):
 *   archive — codices +1 (the one remembered Codex), codexEcho recorded,
 *             Vyra "lost, not found" in the History Book.
 *   names   — the five Leaders' names pre-seeded in the History Book.
 *             No numeric bonus.
 *   light   — a small starting devotion (PROLOGUE_CONFIG.devotionEcho) +
 *             Delen's near-riddle remembered (riddleEcho + History Book).
 */
export function resetToCradle(state: GameState, now = Date.now()): GameState {
  const p = state.prologue;
  if (!p || p.stage !== "fallen") return state;

  const choice = p.ashMemory;
  const race = state.race ?? "watchers";
  const fresh = newGame(state.playerName || PROLOGUE_CONFIG.heightColonyName, race, now);
  fresh.gameId = state.gameId;

  // The ash ledger — what the final choice seeds into the History Book.
  let historyBook: string[] = [];
  let codexEcho: string | null = null;
  let riddleEcho: string | null = null;
  let devotionEcho = 0;
  if (choice === "archive") {
    fresh.codices = PROLOGUE_CONFIG.archiveCodices;
    fresh.totalCodicesEarned = PROLOGUE_CONFIG.archiveCodices;
    codexEcho = PROLOGUE_CONFIG.codexEchoLine;
    historyBook = [PROLOGUE_CONFIG.vyraBookLine];
  } else if (choice === "names") {
    historyBook = PROLOGUE_CONFIG.namesBookLines.slice();
  } else if (choice === "light") {
    fresh.devotion = PROLOGUE_CONFIG.devotionEcho;
    devotionEcho = PROLOGUE_CONFIG.devotionEcho;
    riddleEcho = PROLOGUE_CONFIG.delenRiddle;
    historyBook = [PROLOGUE_CONFIG.delenBookLine];
  }

  fresh.prologue = {
    stage: "rebuilt",
    completed: true,
    ashMemory: choice,
    leaders: p.leaders,
    heroes: p.heroes,
    squad: p.squad,
    height: p.height,
    finalStand: p.finalStand,
    historyBook,
    codexEcho,
    riddleEcho,
    devotionEcho,
  };
  fresh.log.push(`You wake in the ash. The Cradle is new. What the ash remembers: ${choice}.`);
  return fresh;
}