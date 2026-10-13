// HERO EARN ENGINE — the earn side of the Heroes Hall (heroes-design-brief
// §3/§4; owner approval 2026-10-12: "go ahead and build it, put it in").
//
// The Hall (heroes-hall.ts) DISPLAYS heroes, deeds, tiers and XP tables;
// this module is what makes them TRUE in live play:
//
//   • THE DEED LEDGER — `state.heroDeeds`, append-only HeroDeedRecords:
//     every deed completion and every hero grant, stamped with its evidence
//     ref (a battle id, a request id). A deed completes exactly once; a
//     completion whose pool holds more than one hero waits for the colony
//     to NAME its champion (claimHeroFromDeed — R2: player choice, never
//     a roll); a single-hero pool grants automatically on completion.
//   • DEED EVALUATION — the §3.1 conditions read monotonic counters
//     (`state.heroDeedProgress`), the engine's contributionScore (injected
//     by the caller — this module never imports engine.ts), and the
//     revelation codex counters. Conditions whose event streams don't
//     exist yet (hauls, shield assists, escorts, purifies, climax windows,
//     History firsts) read counters that sit at zero until the war layer
//     feeds them via noteWarEvent — the evaluator is already complete.
//   • HERO XP — battle participation pays the published HERO_XP_SOURCES
//     through hero-xp.ts's grantHeroXpTo (per-hero + colony day caps).
//   • LEADER BATTLE XP — Hans's ladder (locked 2026-10-06): Arena practice
//     least, Chorus raids scaled by defense grade (the G1 0.6× → G5 1.5×
//     doctrine ratios), PvP most; underdog scaling by leader-level
//     differential (win or lose), favorite dampening, losses pay a
//     participation share. This module computes the grants; engine.ts
//     applies them through its own grantXpTo so the 40/day cap, the
//     level-up invariant and the Chronicle lines stay single-sourced.
//   • ORACLE VOUCH — the alternate earn route: the hero's race Oracle,
//     met + favor ≥ FAVOR_THRESHOLDS.vouchEligible (daily.ts), grants the
//     hero on the colony's claim (claimHeroVouch). Favor is read, never
//     written — oracles.ts remains the only favor writer.
//
// THE NEVER-LIST holds structurally: there is no cost, price, currency or
// shop field anywhere in this module. Every grant traces to a deed, a
// battle, or earned Oracle favor. No Math.random — all math is a pure
// function of recorded state.
//
// IDEMPOTENCY: battle-driven grants are stamped per battle id
// (`state.heroBattleGrants`); deed completions latch in the ledger;
// claims/vouches dedupe on the caller's request id (the evidence ref).
import {
  DEED_BY_ID,
  DEED_CATALOG,
  HERO_BY_ID,
  HEROES_CONFIG,
  type HeroDeed,
  type HeroDeedProgress,
  type HeroDef,
} from "./heroes-data";
import {
  HERO_XP_SOURCES,
  grantHeroXpTo,
  newHeroUnit,
  type HeroUnit,
} from "./hero-xp";
import { leaderLevel } from "./leader-xp";
import { FAVOR_THRESHOLDS } from "./daily";
import { ensureOracles, oracleForRace, type OraclesState } from "./oracles";
import type { GameState, Leader } from "./types";
import type { Battle, BattleSide } from "./war/war-types";
import { DUEL_CONFIG } from "./war/duels";

// ============================================================================
// §1 CONFIG — every tunable number of the battle-XP ladder in one place.
// Base amounts sit UNDER the shared 40 XP/day leader cap (leader-xp.ts):
// a day of pure practice can't out-earn a day of real war, and even a
// capped underdog PvP win (15 × 2.5 = 38) fits inside one day's budget.
// ============================================================================
export type BattleXpKind = "arena-practice" | "arena-stakes" | "chorus-raid" | "pvp";

export const LEADER_BATTLE_XP = {
  /** Base XP by battle kind — the ladder's ordering IS the doctrine:
   *  Arena practice (bloodless, repeatable) < Chorus raid < PvP. */
  base: {
    "arena-practice": 3,
    "arena-stakes": 5,
    "chorus-raid": 10,
    pvp: 15,
  } as Record<BattleXpKind, number>,
  /** Chorus defense-grade scaling — the chorus-doctrine template ratios
   *  (G1 Screen 0.6× → G5 Bastion 1.5×): harder garrisons teach more. */
  chorusGradeMult: { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.25, 5: 1.5 } as Record<number, number>,
  /** Underdog scaling: +25% per level the foe's leader out-levels yours,
   *  capped at ×2.5 — a lower-level leader learns much more from facing a
   *  stronger leader, even in defeat (the multiplier applies to losses
   *  too; the loss share below is what shrinks). */
  underdogPerLevel: 0.25,
  underdogCap: 2.5,
  /** Favorite dampening: −15% per level you out-level the foe, floored at
   *  ×0.4 — the stronger favorite earns comparatively little. */
  favoritePerLevel: 0.15,
  favoriteFloor: 0.4,
  /** Losses (and standoffs) pay this share of the computed XP: losing
   *  still teaches, winning teaches more. */
  lossShare: 0.5,
} as const;

/** The underdog/favorite multiplier for a leader-level differential. */
export function underdogMult(myLevel: number, foeLevel: number): number {
  const diff = Math.trunc(foeLevel) - Math.trunc(myLevel);
  if (diff > 0) return Math.min(LEADER_BATTLE_XP.underdogCap, 1 + LEADER_BATTLE_XP.underdogPerLevel * diff);
  if (diff < 0) return Math.max(LEADER_BATTLE_XP.favoriteFloor, 1 + LEADER_BATTLE_XP.favoritePerLevel * diff);
  return 1;
}

/**
 * Leader battle XP for one resolved battle — pure. `grade` is the Chorus
 * defense grade (1–5) for chorus-raid kind, null for the other kinds
 * (they carry no grade axis). `won` is the commanding side's result;
 * standoffs pay the loss share.
 */
export function leaderBattleXp(input: {
  kind: BattleXpKind;
  grade?: number | null;
  myLevel: number;
  foeLevel: number;
  won: boolean;
}): number {
  let xp = LEADER_BATTLE_XP.base[input.kind];
  if (input.kind === "chorus-raid" && input.grade != null) {
    xp *= LEADER_BATTLE_XP.chorusGradeMult[input.grade] ?? 1;
  }
  xp *= underdogMult(input.myLevel, input.foeLevel);
  if (!input.won) xp *= LEADER_BATTLE_XP.lossShare;
  return Math.max(1, Math.round(xp));
}

// ============================================================================
// §2 STATE — ensure/backfill, following the codebase's legacy-save pattern.
// ============================================================================
export function freshHeroDeedProgress(): HeroDeedProgress {
  return {
    marches: 0,
    captures: 0,
    breach: false,
    cleanMarch: false,
    hauls: 0,
    shieldAssists: 0,
    escorts: 0,
    purifies: 0,
    comebackActions: 0,
    climaxWindows: 0,
    historyFirsts: 0,
    warWeeks: [],
  };
}

/** Backfill every hero-earn field on a (possibly legacy) save. Idempotent. */
export function ensureHeroEarn(state: GameState): void {
  if (!Array.isArray(state.heroDeeds)) state.heroDeeds = [];
  if (!Array.isArray(state.earnedHeroes)) state.earnedHeroes = [];
  if (!state.heroXpCaps || typeof state.heroXpCaps !== "object") state.heroXpCaps = {};
  if (!state.heroBattleGrants || typeof state.heroBattleGrants !== "object") state.heroBattleGrants = {};
  if (!state.heroEventIds || typeof state.heroEventIds !== "object") state.heroEventIds = {};
  if (!state.heroDeedProgress || typeof state.heroDeedProgress !== "object") {
    state.heroDeedProgress = freshHeroDeedProgress();
  } else {
    const p = state.heroDeedProgress as unknown as Record<string, unknown>;
    const fresh = freshHeroDeedProgress() as unknown as Record<string, unknown>;
    for (const k of Object.keys(fresh)) {
      if (typeof p[k] !== typeof fresh[k]) p[k] = fresh[k];
    }
    if (!Array.isArray(state.heroDeedProgress.warWeeks)) state.heroDeedProgress.warWeeks = [];
  }
}

/** Chronicle line, battle-engine style (state.log is the colony's feed). */
function logLine(state: GameState, line: string): void {
  if (!Array.isArray(state.log)) state.log = [];
  state.log.unshift(line);
  state.log = state.log.slice(0, 60);
}

// ============================================================================
// §3 THE LEDGER — completions, claims, vouches, grants.
// ============================================================================
/** Has this deed's condition ever latched for this colony? */
export function deedCompleted(state: GameState, deedId: string): boolean {
  ensureHeroEarn(state);
  return state.heroDeeds!.some((r) => r.deedId === deedId && !r.grant);
}

/** Has this deed's champion already been named (or auto-granted)? */
export function deedClaimed(state: GameState, deedId: string): boolean {
  ensureHeroEarn(state);
  return state.heroDeeds!.some((r) => r.deedId === deedId && r.grant);
}

/** The colony's live-earned instance of a hero, if it stands in the roster. */
export function earnedHero(state: GameState, heroId: string): HeroUnit | null {
  ensureHeroEarn(state);
  return state.earnedHeroes!.find((h) => h.id === heroId) ?? null;
}

/** Grant a hero into the roster + ledger. The ONLY door heroes enter by:
 *  `earnedBy` is the deed id or the `oracle_vouch:<oracleId>` stamp (R1). */
function grantHero(
  state: GameState,
  def: HeroDef,
  earnedBy: string,
  deedId: string,
  evidence: string,
  now: number,
): HeroUnit {
  const unit = newHeroUnit(def, earnedBy, now);
  state.earnedHeroes!.push(unit);
  state.heroDeeds!.push({ deedId, heroId: def.id, grant: true, at: now, evidence });
  logLine(state, `🌟 ${def.name} answers the call — earned by ${earnedBy.startsWith(HEROES_CONFIG.oracleVouchPrefix) ? "an Oracle's vouch" : "deed"}, never bought.`);
  return unit;
}

/**
 * Latch a deed completion. Single-hero pools grant their hero immediately
 * (no choice exists to make); multi-hero pools wait for claimHeroFromDeed;
 * empty pools are milestones. Participant heroes earn the published
 * heroDeedOrFirst XP — a deed witnessed is a lesson.
 */
function completeDeed(
  state: GameState,
  deed: HeroDeed,
  now: number,
  evidence: string,
  participantHeroIds: readonly string[],
): { grantedHeroId: string | null } {
  state.heroDeeds!.push({ deedId: deed.id, heroId: null, grant: false, at: now, evidence });
  for (const id of participantHeroIds) {
    const unit = earnedHero(state, id);
    if (unit) grantHeroXpTo(unit, HERO_XP_SOURCES.heroDeedOrFirst, now, state.heroXpCaps!);
  }
  let grantedHeroId: string | null = null;
  if (deed.unlocks.length === 1) {
    const def = HERO_BY_ID[deed.unlocks[0]!];
    if (def && !earnedHero(state, def.id)) {
      grantHero(state, def, deed.id, deed.id, evidence, now);
      grantedHeroId = def.id;
    }
  }
  logLine(
    state,
    grantedHeroId
      ? `🏅 Deed won: ${deed.name}.`
      : `🏅 Deed won: ${deed.name}${deed.unlocks.length > 1 ? " — name your champion in the Heroes Hall." : ""}`,
  );
  return { grantedHeroId };
}

// ============================================================================
// §4 DEED EVALUATION — every §3.1 condition, read off recorded state.
// ============================================================================
function deedConditionMet(state: GameState, deedId: string, contributionScore: number | undefined): boolean {
  const p = state.heroDeedProgress!;
  switch (deedId) {
    case "hero_first_breach":
      return p.breach;
    case "hero_march_5":
      return p.marches >= 5;
    case "hero_clean_march":
      return p.cleanMarch;
    case "hero_haul_10":
      return p.hauls >= 10;
    case "hero_contribution_50":
      return contributionScore !== undefined && contributionScore >= 50;
    case "hero_weeks_4":
      return p.warWeeks.length >= 4;
    case "hero_capture_1":
      return p.captures >= 1;
    case "hero_shield_15":
      return p.shieldAssists >= 15;
    case "hero_escort_10":
      return p.escorts >= 10;
    case "hero_comeback_1":
      return p.comebackActions >= 1;
    case "hero_contribution_150":
      return contributionScore !== undefined && contributionScore >= 150;
    case "hero_codex_scholar":
      return (state.revelationCounters?.codicesEarnedByDeeds ?? 0) >= 20;
    case "hero_purify_5":
      return p.purifies >= 5;
    case "hero_first_of_cycle":
      return p.historyFirsts >= 1;
    case "hero_climax_3":
      return p.climaxWindows >= 3;
    case "hero_contribution_400":
      return contributionScore !== undefined && contributionScore >= 400;
    case "hero_legend_codex":
      return (state.revelationCounters?.codicesEarnedByDeeds ?? 0) >= 40;
    default:
      return false;
  }
}

export interface DeedEvaluation {
  completed: string[];
  granted: string[];
}

/**
 * Evaluate every unlatched deed against the colony's recorded state,
 * completing (and where the pool is a single hero, granting) what the
 * record now proves. Idempotent — completions latch in the ledger, so a
 * second pass over the same record completes nothing. `contributionScore`
 * is injected by the caller (engine.ts owns the formula; this module
 * never imports it): without it, the contribution deeds simply wait.
 */
export function evaluateHeroDeeds(
  state: GameState,
  now: number,
  opts?: { contributionScore?: number; participantHeroIds?: readonly string[]; evidence?: string },
): DeedEvaluation {
  ensureHeroEarn(state);
  const out: DeedEvaluation = { completed: [], granted: [] };
  for (const deed of DEED_CATALOG) {
    if (deed.tier === "vouch") continue; // the vouch is a claim, not a latch
    if (deedCompleted(state, deed.id)) continue;
    if (!deedConditionMet(state, deed.id, opts?.contributionScore)) continue;
    const { grantedHeroId } = completeDeed(state, deed, now, opts?.evidence ?? "evaluation", opts?.participantHeroIds ?? []);
    out.completed.push(deed.id);
    if (grantedHeroId) out.granted.push(grantedHeroId);
  }
  return out;
}

/**
 * Name the champion of a completed deed — the colony's choice from the
 * deed's pool (R2). Validated server-side (the api claim fn calls this):
 * the deed must be complete and unclaimed, the hero must stand in its
 * pool, and the hero must not already be earned. `requestId` is the
 * caller's idempotency key: a retried claim returns the original grant.
 */
export function claimHeroFromDeed(
  state: GameState,
  args: { deedId: string; heroId: string; requestId: string; now: number },
): { ok: true; heroId: string; idempotent?: boolean } | { ok: false; error: string } {
  ensureHeroEarn(state);
  const prior = state.heroDeeds!.find((r) => r.grant && r.evidence === args.requestId);
  if (prior && prior.heroId) return { ok: true, heroId: prior.heroId, idempotent: true };
  const deed = DEED_BY_ID[args.deedId];
  if (!deed) return { ok: false, error: "That deed isn't in the catalog." };
  if (deed.tier === "vouch") return { ok: false, error: "The Oracle's vouch is claimed at the Oracle, not from a deed." };
  if (!deedCompleted(state, deed.id)) return { ok: false, error: "That deed hasn't been completed yet." };
  if (deedClaimed(state, deed.id)) return { ok: false, error: "That deed's champion has already been named." };
  if (!deed.unlocks.includes(args.heroId)) return { ok: false, error: "That hero isn't in this deed's pool." };
  const def = HERO_BY_ID[args.heroId];
  if (!def) return { ok: false, error: "That hero isn't in the catalog." };
  if (earnedHero(state, def.id)) return { ok: false, error: `${def.name} already stands in your roster.` };
  grantHero(state, def, deed.id, deed.id, args.requestId, args.now);
  return { ok: true, heroId: def.id };
}

// ============================================================================
// §5 ORACLE VOUCH — favor earned, never bought; read here, written only by
// oracles.ts. The "attention engaged" half of the catalog condition is the
// Oracle's `met` introduction gate (noteCrossServerBattle in oracles.ts);
// the favor half is FAVOR_THRESHOLDS.vouchEligible from daily.ts.
// ============================================================================
export function heroVouchStatus(state: GameState, def: HeroDef): {
  oracleId: string;
  met: boolean;
  favor: number;
  threshold: number;
  eligible: boolean;
} {
  ensureOracles(state);
  const oracleId = oracleForRace(def.race);
  const oracles = (state as unknown as { oracles: OraclesState }).oracles;
  const fav = oracles.oracles[oracleId];
  const threshold = FAVOR_THRESHOLDS.vouchEligible;
  const met = fav?.met === true;
  const favor = typeof fav?.favor === "number" ? fav.favor : 0;
  return { oracleId, met, favor, threshold, eligible: met && favor >= threshold };
}

/** Claim a hero by their race Oracle's vouch. One hero per claim; the
 *  favor is NOT spent (trust isn't a currency) — each hero still needs
 *  the standing to be vouched for. `requestId` dedupes retries. */
export function claimHeroVouch(
  state: GameState,
  args: { heroId: string; requestId: string; now: number },
): { ok: true; heroId: string; idempotent?: boolean } | { ok: false; error: string } {
  ensureHeroEarn(state);
  const prior = state.heroDeeds!.find((r) => r.grant && r.evidence === args.requestId);
  if (prior && prior.heroId) return { ok: true, heroId: prior.heroId, idempotent: true };
  const def = HERO_BY_ID[args.heroId];
  if (!def) return { ok: false, error: "That hero isn't in the catalog." };
  if (earnedHero(state, def.id)) return { ok: false, error: `${def.name} already stands in your roster.` };
  const status = heroVouchStatus(state, def);
  if (!status.met) return { ok: false, error: `Your colony hasn't met ${def.race}' Oracle yet — introductions are earned in cross-server battle.` };
  if (!status.eligible) return { ok: false, error: `The Oracle's favor isn't deep enough to vouch yet (${Math.floor(status.favor)}/${status.threshold}).` };
  const deedId = `${HEROES_CONFIG.oracleVouchPrefix}${def.race}`;
  grantHero(state, def, `${HEROES_CONFIG.oracleVouchPrefix}${status.oracleId}`, deedId, args.requestId, args.now);
  return { ok: true, heroId: def.id };
}

// ============================================================================
// §6 WAR-EVENT FACTS — the non-battle streams (noteWarEvent) and the
// battle-resolution fold (processHeroEarn). Counters are monotonic; every
// fold is idempotent on its event id.
// ============================================================================
/** ISO war-week key (the deed catalog's weekly-participation window). */
export function warWeekKey(atMs: number): string {
  const d = new Date(atMs);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Counts a war-layer event source reports (hauls delivered, shield
 *  assists, escorts, purifies, climax-window actions, History firsts). */
export interface WarEventCounts {
  hauls?: number;
  shieldAssists?: number;
  escorts?: number;
  purifies?: number;
  climaxWindows?: number;
  historyFirsts?: number;
}

/**
 * Fold a non-battle war event into the deed counters, then evaluate.
 * Idempotent on `eventId`: a re-delivered event folds nothing twice.
 * (No live source emits these yet — the war layer calls this when its
 * haul/shield/escort/purify streams land; the deed side is ready.)
 */
export function noteWarEvent(
  state: GameState,
  eventId: string,
  counts: WarEventCounts,
  now: number,
  opts?: { contributionScore?: number },
): DeedEvaluation {
  ensureHeroEarn(state);
  if (state.heroEventIds![eventId]) return { completed: [], granted: [] };
  state.heroEventIds![eventId] = true;
  const p = state.heroDeedProgress!;
  const add = (key: keyof HeroDeedProgress, n: number | undefined) => {
    if (typeof n === "number" && n > 0) (p[key] as number) += Math.trunc(n);
  };
  add("hauls", counts.hauls);
  add("shieldAssists", counts.shieldAssists);
  add("escorts", counts.escorts);
  add("purifies", counts.purifies);
  add("climaxWindows", counts.climaxWindows);
  add("historyFirsts", counts.historyFirsts);
  return evaluateHeroDeeds(state, now, { contributionScore: opts?.contributionScore, evidence: eventId });
}

// ============================================================================
// §7 BATTLE RESOLUTION — facts, hero XP, leader-XP grant intents.
// ============================================================================
export interface BattleEarnFacts {
  battleId: string;
  kind: BattleXpKind;
  mySide: BattleSide;
  won: boolean;
  /** Chorus defense grade 1–5 (the garrison's FOB stage + 1) or null. */
  grade: number | null;
  myLeaderLevel: number;
  foeLeaderLevel: number;
  /** My earned heroes who fought (snapshot ids ∩ the earned roster). */
  heroIds: string[];
  isMarch: boolean;
  isBreach: boolean;
  isCapture: boolean;
  isComeback: boolean;
  endedAt: number;
}

/**
 * The colony's commanding leader for battle XP: the senior ACTIVE leader
 * (highest level; roster order breaks ties) — the same convention the
 * Arena UI already uses for the colony's command strength
 * (ArenaPanel's myLeaderLevel). Battles record no per-battle Councillor;
 * the senior active leader is the colony's commander of record.
 */
export function commandingLeader(state: GameState): Leader | null {
  let best: Leader | null = null;
  for (const l of state.leaders ?? []) {
    if (!l || l.status !== "active") continue;
    if (!best || leaderLevel(l) > leaderLevel(best)) best = l;
  }
  return best;
}

/**
 * Derive the earn facts of a resolved battle for THIS colony's state, or
 * null when the colony isn't a side in it. Pure read of the battle's
 * §15 B4 snapshot + result — the same record the report ledger keeps.
 */
export function battleEarnFacts(state: GameState, battle: Battle): BattleEarnFacts | null {
  ensureHeroEarn(state);
  const gameId = state.gameId;
  if (!gameId || !battle.result) return null;
  let mySide: BattleSide | null = null;
  if (battle.attacker.colonyId === gameId) mySide = "attacker";
  else if (battle.defender.colonyId === gameId) mySide = "defender";
  else if (battle.attacker.colonyId.startsWith("rally:")) {
    // Rally battles pool the war band under `rally:<id>`; in the CALLER's
    // state (where the battle lives) the caller commands the pool.
    const rallies = (state as unknown as { rallies?: Record<string, { battleId?: string; callerId?: string }> }).rallies ?? {};
    const rally = Object.values(rallies).find((r) => r && r.battleId === battle.id);
    if (rally && rally.callerId === gameId) mySide = "attacker";
  }
  if (!mySide) return null;

  const foeSide: BattleSide = mySide === "attacker" ? "defender" : "attacker";
  const mine = battle[mySide];
  const foe = battle[foeSide];

  let kind: BattleXpKind;
  if (battle.arena) {
    kind = battle.zoneId === DUEL_CONFIG.zoneId ? "pvp" : battle.arena.stakes ? "arena-stakes" : "arena-practice";
  } else if (
    battle.defender.colonyId === "chorus-site" ||
    battle.attacker.colonyId === "chorus-site" ||
    battle.defender.colonyId.startsWith("chorus-")
  ) {
    kind = "chorus-raid";
  } else {
    kind = "pvp";
  }

  const won =
    battle.result.outcome === (mySide === "attacker" ? "attacker_victory" : "defender_victory");
  // The Chorus defense grade IS the garrison's FOB stage (chorus-sites.ts:
  // grade 1 ↔ stage 0 … grade 5 ↔ stage 4), so the grade reads off the
  // Chorus force's own stamp. Rally scratch garrisons (stage 0) price as
  // grade 1 — the lightest defense there is.
  const chorusForce = battle.attacker.colonyId.startsWith("chorus-")
    ? battle.attacker
    : battle.defender.colonyId.startsWith("chorus-")
      ? battle.defender
      : null;
  const grade = kind === "chorus-raid" && chorusForce ? chorusForce.fobStage + 1 : null;

  const leader = commandingLeader(state);
  const myLeaderLevel = leader ? leaderLevel(leader) : 1;
  // The Chorus fields warform cells, not a leader — its difficulty axis is
  // the GRADE (already multiplied into the XP), so the level differential
  // stays neutral on raids. Against a real colony, the foe's command
  // strength is their best fielded hero's level; a hero-less foe is
  // likewise neutral (no leader to learn from or look down on).
  const foeHeroLevels = foe.heroSquad.map((h) => (typeof h.level === "number" ? h.level : 1));
  const foeLeaderLevel =
    kind === "chorus-raid" || foeHeroLevels.length === 0 ? myLeaderLevel : Math.max(...foeHeroLevels);

  const earnedIds = new Set(state.earnedHeroes!.map((h) => h.id));
  const heroIds = mine.heroSquad.map((h) => h.id).filter((id) => earnedIds.has(id));

  const myPower = battle.forcePower[mySide];
  const foePower = battle.forcePower[foeSide];
  return {
    battleId: battle.id,
    kind,
    mySide,
    won,
    grade,
    myLeaderLevel,
    foeLeaderLevel,
    heroIds,
    isMarch: mySide === "attacker" && !battle.arena,
    isBreach: won && mySide === "attacker" && (kind === "chorus-raid" || kind === "pvp"),
    isCapture: won && kind === "chorus-raid" && mySide === "attacker",
    isComeback: won && myPower > 0 && foePower > myPower * (4 / 3),
    endedAt: battle.result.endedAt ?? battle.startedAt,
  };
}

/** Fold battle facts into the monotonic deed counters. */
function foldBattleFacts(state: GameState, facts: BattleEarnFacts): void {
  const p = state.heroDeedProgress!;
  if (facts.isMarch) {
    p.marches += 1;
    // A march that WINS moves no corruption in this engine — it comes home
    // clean (the deed reads the warLedger + corruption diff, and the diff
    // is zero by construction here). A lost march is no one's clean march.
    if (facts.won) p.cleanMarch = true;
  }
  if (facts.isCapture) p.captures += 1;
  if (facts.isBreach) p.breach = true;
  if (facts.isComeback) p.comebackActions += 1;
  if (facts.kind !== "arena-practice" && facts.kind !== "arena-stakes") {
    const wk = warWeekKey(facts.endedAt);
    if (!p.warWeeks.includes(wk)) p.warWeeks.push(wk);
  }
}

/** Pay participating earned heroes the published battle XP sources. */
function grantBattleHeroXp(state: GameState, facts: BattleEarnFacts, now: number): void {
  for (const id of facts.heroIds) {
    const unit = state.earnedHeroes!.find((h) => h.id === id);
    if (!unit) continue;
    let amount = facts.won ? HERO_XP_SOURCES.marchWin : HERO_XP_SOURCES.marchLoss;
    if (facts.isCapture) amount += HERO_XP_SOURCES.capture;
    if (facts.isComeback) amount += HERO_XP_SOURCES.comeback;
    grantHeroXpTo(unit, amount, now, state.heroXpCaps!);
  }
}

/** The Chronicle source label engine.ts logs with the leader's grant. */
export function leaderXpSourceLabel(facts: BattleEarnFacts): string {
  switch (facts.kind) {
    case "arena-practice":
      return "trained in the Arena";
    case "arena-stakes":
      return "led a stakes bout in the Arena";
    case "chorus-raid":
      return facts.grade ? `led a Chorus raid (G${facts.grade})` : "led a Chorus raid";
    case "pvp":
      return "led a PvP battle";
  }
}

export interface LeaderGrantIntent {
  leaderId: string;
  amount: number;
  source: string;
  kind: BattleXpKind;
  battleId: string;
}

export interface HeroEarnSummary {
  battlesProcessed: number;
  deedsCompleted: string[];
  heroesGranted: string[];
  leaderGrants: LeaderGrantIntent[];
}

/**
 * THE TICK — called from engine.advance() after the battle/rally/arena/
 * duel resolvers, in the same lazy, idempotent discipline: scan resolved
 * battles, stamp each once, fold its facts, pay hero XP, compute the
 * commanding leader's grant intent, and evaluate deeds (battle-triggered
 * completions pay their witnesses the deed XP). A final threshold pass
 * latches contribution/codex deeds that ripened outside battle. The
 * caller applies `leaderGrants` through the engine's own grantXpTo.
 */
export function processHeroEarn(
  state: GameState,
  now: number,
  opts?: { contributionScore?: number },
): HeroEarnSummary {
  ensureHeroEarn(state);
  const summary: HeroEarnSummary = { battlesProcessed: 0, deedsCompleted: [], heroesGranted: [], leaderGrants: [] };
  const battles = Array.isArray(state.battles) ? state.battles : [];
  for (const b of battles) {
    if (!b || b.status !== "resolved" || !b.result) continue;
    if (state.heroBattleGrants![b.id]) continue;
    state.heroBattleGrants![b.id] = true;
    const facts = battleEarnFacts(state, b);
    if (!facts) continue;
    summary.battlesProcessed += 1;
    foldBattleFacts(state, facts);
    grantBattleHeroXp(state, facts, now);
    const leader = commandingLeader(state);
    if (leader) {
      const amount = leaderBattleXp({
        kind: facts.kind,
        grade: facts.grade,
        myLevel: leaderLevel(leader),
        foeLevel: facts.foeLeaderLevel,
        won: facts.won,
      });
      if (amount > 0) {
        summary.leaderGrants.push({
          leaderId: leader.id,
          amount,
          source: leaderXpSourceLabel(facts),
          kind: facts.kind,
          battleId: b.id,
        });
      }
    }
    const ev = evaluateHeroDeeds(state, now, {
      contributionScore: opts?.contributionScore,
      participantHeroIds: facts.heroIds,
      evidence: b.id,
    });
    summary.deedsCompleted.push(...ev.completed);
    summary.heroesGranted.push(...ev.granted);
  }
  const ev = evaluateHeroDeeds(state, now, { contributionScore: opts?.contributionScore, evidence: "advance" });
  summary.deedsCompleted.push(...ev.completed);
  summary.heroesGranted.push(...ev.granted);
  return summary;
}
