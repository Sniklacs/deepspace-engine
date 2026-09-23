// THE FALL — ACT I FRONT (opening-prologue-spec §3 Act I, §4 the full-power
// state, §12.1 "the tutorial is Act I's first battle").
//
// This module is the ONE thing that stands between the shipped battle engine
// and a player: it seeds Act I's first front on the REAL engine — `createBattle`
// + `openBattle` from war/battle-engine.ts, the same pure functions the battle
// harness and the server resolve with. Nothing here is stubbed: the force
// powers, the duration curve, the casualties, the decision windows, the state
// chip and the odds line are all engine output.
//
// WHAT IT SEEDS (the §12.3 shape — the "pummeled" moment taught SURVIVABLE):
//   • The colony at the height takes the field as the DEFENDER: its own
//     seeded squad (PROLOGUE_SQUAD), its own full-tier armory families, its
//     Citadel FOB, and the vanguard of its war supply (ACT1_CONFIG.ourTroops —
//     deliberately under the Citadel's field ceiling, so the player's own
//     reinforcement order has real, engine-computed teeth).
//   • The Chorus opens the assault as the ATTACKER: a mirrored force — one
//     warform *cell* per mirrored role (its stats are the champion's own stats
//     × `chorusCellStrength`; a cell is a swarm fighting as one entity, which
//     is what the Chorus is), one kit per family at the same tier, and its own
//     staging.
//   • The realized numbers land just past the engine's rout-risk threshold:
//     the weaker side gets the deterministic EDGE window (battle-engine
//     `buildWindows`), which opens 30 s after commit — the player's first
//     decision window, on their first battle, surviving-while-pushed-back.
//     One full reinforcement chips the gap back under the threshold, so the
//     lesson lands as "orders change this fight" and not as a wall.
//
// Discipline (all asserted by prologue-tests/act1-entry-verify.ts):
//   • PURE + DETERMINISTIC — same (state, now) → byte-identical battle. Zero
//     Math.random on the path. No wall-clock read (time arrives as `now`).
//   • IDEMPOTENT — at most ONE live front at a time; re-entering resumes, it
//     never stacks a second seed. Resolved fronts stay in the ledger forever.
//   • NORMAL COLONIES ARE UNTOUCHED — the seed no-ops unless the save is at the
//     height, so `state.battles = []` still means "nothing on your fronts" for
//     every non-Act-I colony.
//   • NO PURCHASE SURFACE — no wallet/currency/store vocabulary is reachable
//     from here, and nothing about the fight can be bought.
import type { GameState } from "../types";
import { WEAPON_TYPES } from "../armory";
import { heroLevel } from "../hero-xp";
import { HERO_BY_ID } from "../heroes-data";
import type { HeroUnit } from "../hero-xp";
import type { PrologueHeroRecord } from "./prologue-state";
import {
  BATTLES_CONFIG,
  type Battle,
  type BattleHeroSnapshot,
  type CommittedForce,
  type CommittedWeapon,
  type FobStage,
} from "../war/war-types";
import { createBattle, openBattle, battleEndAt } from "../war/battle-engine";
// ============================================================================
// §1 CONFIG — ONE place for every tunable number. Calibration may move these
// numbers; the harness re-derives the realized fight from them, so a change
// that breaks the §12.3 shape (an unwinnable or boring opening) fails loudly.
// ============================================================================
export const ACT1_CONFIG = {
  /** The Act I slot id — this colony is its own save slot in the account, so
   *  the player's real colonies are never touched and leaving is a plain
   *  switch back. Fixed (not generated): entering twice resumes the same slot,
   *  which is what makes the entry idempotent by construction. */
  gameId: "the-fall",
  /** The Fall is the WATCHERS' chapter (owner: "Watchers version first"); the
   *  debug/beta world is race-locked to the Watchers. */
  race: "watchers",
  /** The front this opening stands on. */
  frontId: "front-the-ashline",
  frontName: "The Ashline",
  /** Chronicle line written when the front opens (in-universe; no UI copy). */
  frontLine: "The Chorus opens on The Ashline. The Last Academy takes the field.",
  /** The colony's committed vanguard. Under the Citadel's field ceiling on
   *  purpose: what queues behind the front is what the player sends when they
   *  reinforce — and the engine prices it like everything else. */
  ourTroops: 300,
  /** The Chorus's warform CELL strength — one cell per mirrored role, its
   *  statistics a fixed multiple of the champion it mirrors (a cell is many
   *  warforms fighting as one entity; the roster layer's analogue of a single
   *  champion). 6.5 puts the opening just past the engine's rout-risk
   *  threshold — the edge window exists — while staying close enough that one
   *  full reinforcement closes it. */
  chorusCellStrength: 6.5,
  /** Chorus kits per family (the same five families at the same tier). */
  chorusKitsPerFamily: 1,
  /** The Chorus's own staging — it arrives with its mass and its ceiling. */
  chorusTroops: 600,
  chorusFobStage: 4 as FobStage,
  chorusName: "The Chorus",
  chorusColonyId: "chorus-front-the-ashline",
} as const;
/** One mirror of the colony's champion as a Chorus warform cell. */
function chorusCell(hero: BattleHeroSnapshot): BattleHeroSnapshot {
  const s = ACT1_CONFIG.chorusCellStrength;
  const scale = (n: number) => Math.max(1, Math.round(n * s));
  return {
    ...hero,
    id: `${ACT1_CONFIG.chorusColonyId}:${hero.id}`,
    name: "Chorus cell",
    attributes: {
      power: scale(hero.attributes.power),
      guard: scale(hero.attributes.guard),
      craft: scale(hero.attributes.craft),
      presence: scale(hero.attributes.presence),
    },
    // Skills ride the mirror: a cell fires the weapon it was taught.
    skills: hero.skills.map((k) => ({ ...k })),
  };
}
// ============================================================================
// §2 THE FLATTEN — HeroUnit → BattleHeroSnapshot
// ============================================================================
/** Flatten one roster hero into the battle engine's commit-time snapshot — the
 *  §15 B4 input set, by value (the engine never reads the roster). Level is the
 *  hero's EARNED level, not a stored field; skills fold their published
 *  `values` into the flat numbers the formula reads. */
export function snapshotHero(hero: HeroUnit & { fate?: unknown }): BattleHeroSnapshot {
  const def = HERO_BY_ID[hero.id];
  return {
    id: hero.id,
    name: hero.name,
    role: hero.role,
    level: heroLevel(hero),
    attributes: {
      power: hero.attributes.power,
      guard: hero.attributes.guard,
      craft: hero.attributes.craft,
      presence: hero.attributes.presence,
    },
    specialization: hero.specialization,
    skills: (def?.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      strength: s.values?.strength,
      guardPenalty: s.values?.guardPenalty,
      damageReduction: s.values?.damageReduction,
      scoring: s.values?.scoring,
    })),
  };
}
/** The colony's committed squad, in the seed's own squad order. */
export function act1Squad(state: GameState): BattleHeroSnapshot[] {
  const squad = state.prologue?.squad ?? [];
  const roster: PrologueHeroRecord[] = state.prologue?.heroes ?? [];
  return squad
    .map((id) => roster.find((h) => h.id === id))
    .filter((h): h is PrologueHeroRecord => !!h)
    .map((h) => snapshotHero(h));
}
/** The colony's committed kits: one per armory family it has built, at the
 *  tier it reached (the height's tier 4 — taken from the state, never
 *  hard-coded here). */
export function act1Weapons(state: GameState): CommittedWeapon[] {
  return WEAPON_TYPES.filter((family) => !!state.armory?.[family]).map((family) => ({
    family,
    tier: (state.armory[family]?.tier ?? 1) as CommittedWeapon["tier"],
    count: 1,
  }));
}
// ============================================================================
// §3 THE FRONT
// ============================================================================
/** Is this battle Act I's front? (The zone is the front's identity.) */
export function isAct1Battle(battle: Battle | null | undefined): boolean {
  return !!battle && battle.zoneId === ACT1_CONFIG.frontId;
}
/** The Act I front still being fought, or null. */
export function act1LiveBattle(state: GameState): Battle | null {
  const list = state.battles ?? [];
  return list.find((b) => isAct1Battle(b) && b.status === "active") ?? null;
}
/** Both committed forces for the opening front — pure. Null when the save is
 *  not at the height or the seed carries no squad (a height with nobody in it
 *  is not a battle). */
export function act1Forces(state: GameState): { attacker: CommittedForce; defender: CommittedForce } | null {
  if (state.prologue?.stage !== "height") return null;
  const squad = act1Squad(state);
  if (squad.length === 0) return null;
  const colonyId = state.gameId || ACT1_CONFIG.gameId;
  const defender: CommittedForce = {
    side: "defender",
    colonyId,
    colonyName: state.playerName,
    heroSquad: squad,
    weapons: act1Weapons(state),
    troops: ACT1_CONFIG.ourTroops,
    fobStage: (state.prologue.height?.fobStage ?? 0) as FobStage,
  };
  const attacker: CommittedForce = {
    side: "attacker",
    colonyId: ACT1_CONFIG.chorusColonyId,
    colonyName: ACT1_CONFIG.chorusName,
    heroSquad: squad.map(chorusCell),
    weapons: squad.length > 0 ? act1Weapons(state).map((k) => ({ ...k, count: ACT1_CONFIG.chorusKitsPerFamily })) : [],
    troops: ACT1_CONFIG.chorusTroops,
    fobStage: ACT1_CONFIG.chorusFobStage,
  };
  return { attacker, defender };
}
/**
 * Open Act I's front on the real engine. Returns the battle it created, or null
 * when there is nothing to open: the save is not at the height, the seed has no
 * squad, or a front is ALREADY being fought (idempotent — entering Act I twice
 * never stacks a second battle, and a reload never re-rolls the fight).
 *
 * The caller owns the save; this only mutates `state.battles` / `state.log`
 * through the engine's own `openBattle`.
 */
export function seedAct1Battle(state: GameState, now: number): Battle | null {
  if (act1LiveBattle(state)) return null;
  const forces = act1Forces(state);
  if (!forces) return null;
  const battle = createBattle(
    {
      zoneId: ACT1_CONFIG.frontId,
      zoneName: ACT1_CONFIG.frontName,
      attacker: forces.attacker,
      defender: forces.defender,
    },
    now,
  );
  openBattle(state, battle);
  state.log.push(ACT1_CONFIG.frontLine);
  state.log = state.log.slice(-60);
  return battle;
}
/**
 * THE ENTRY — what happens to Act I's save slot when the player takes the
 * field. Pure over (slot, now): the server's entry handler calls exactly this,
 * so the harness tests the entry itself and not a copy of it.
 *
 *   • a slot already at the height → RESUMED (advanced, never re-seeded; the
 *     live front is left exactly as it stands);
 *   • a slot at the height whose front has resolved → a fresh front opens (the
 *     resolved battle keeps its ledger entry — a finished fight is history,
 *     not a dead end);
 *   • no slot / any other stage → the full-power seed is built and the front
 *     opens.
 *
 * Returns the state to store plus whether this call seeded a new height.
 */
export function openAct1Front(slot: GameState | null | undefined, now: number, makeSeed: (now: number) => GameState): { state: GameState; seeded: boolean } {
  if (slot && slot.prologue?.stage === "height") {
    seedAct1Battle(slot, now);
    return { state: slot, seeded: false };
  }
  const fresh = makeSeed(now);
  fresh.gameId = ACT1_CONFIG.gameId;
  seedAct1Battle(fresh, now);
  return { state: fresh, seeded: true };
}
/** The front's remaining window schedule, for reporting/tests: the exact ms
 *  until the first decision window opens (-1 when one is already open). */
export function msUntilFirstWindow(battle: Battle, now: number): number {
  const open = battle.windows.filter((w) => now >= w.opensAt && now < w.closesAt);
  if (open.length > 0) return -1;
  const next = battle.windows
    .filter((w) => w.opensAt > now)
    .sort((a, b) => a.opensAt - b.opensAt)[0];
  return next ? next.opensAt - now : -1;
}
/** The engine constants this module leans on — re-exported so the harness and
 *  any later slice read the SAME numbers the fight was built against. */
export const ACT1_ENGINE = {
  edgeWindowGap: BATTLES_CONFIG.edgeWindowGap,
  edgeWindowDelayMs: BATTLES_CONFIG.edgeWindowDelayMs,
  fobTroopCapByStage: BATTLES_CONFIG.fobTroopCapByStage,
  minDurationMs: BATTLES_CONFIG.minDurationMs,
  maxDurationMs: BATTLES_CONFIG.maxDurationMs,
  windowMinMs: BATTLES_CONFIG.windowMinMs,
  windowMaxMs: BATTLES_CONFIG.windowMaxMs,
  battleEndAt,
} as const;
