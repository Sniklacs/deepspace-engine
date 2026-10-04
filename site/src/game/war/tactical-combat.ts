// TACTICAL COMBAT — real act-and-react battles (owner 2026-10-03).
//
// Hans: "I want act and react... real life combat. These combat [rounds] are
// not just a couple of minutes thing — this can be an hour long depending on
// the troops."
//
// The old raid flow auto-resolved the battle the instant troops deployed.
// This module replaces that with a round-based tactical battle: after
// touchdown and deployment to the 5 entry vectors, BOTH sides issue orders
// every round, the round resolves simultaneously, casualties and morale
// update, and play continues until one side breaks.
//
// DESIGN DECISIONS (all tunable in TACTICAL_CONFIG below):
//
//  1. ROUNDS, NOT TICKS. Each round is one decision point for the commander.
//     The attacker submits orders; the defender (AI, deterministic — or a
//     live defender's orders in a future pass) responds; the round resolves.
//     A 10-vector battle at ~3 min/round runs ~30-60 min. Players who can't
//     stay can hit "quick resolve" (auto-plays remaining rounds hold/hold).
//
//  2. MIRRORED VECTORS. The attacker deploys to MAIN / FLANK_LEFT /
//     FLANK_RIGHT / REAR / RESERVE (the existing deployment shape — this
//     module consumes it directly). The defender holds the same five zones:
//     their MAIN is the colony core, FLANKS are the perimeter, REAR is the
//     rear guard, RESERVE is the militia pool. Attacker vector X engages
//     defender vector X, EXCEPT flanks cross over (attacker's FLANK_LEFT
//     hits the defender's FLANK_RIGHT — opposite sides of the field) and a
//     REAR breakthrough: if the defender's REAR is empty or routed, the
//     attacker's REAR slams straight into the defender's MAIN.
//
//  3. TROOP TYPES ARE TACTICAL, NOT RAW POWER. Hans locked (2026-09-30):
//     troop types do NOT differ in combat power beyond supply weight.
//     This module HONORS that — base power is always count × supply weight.
//     What differs is AFFINITY: each type has orders it excels at.
//       reaver   +25% damage on ADVANCE (shock troops want to move)
//       bulwark  -25% casualties taken on HOLD (they ARE the wall)
//       longeye  +25% damage on HOLD (ranged denial), -25% on ADVANCE
//       thunder  +50% damage vs fortified vectors (siege crews)
//       warden   +25% on FLANK orders, and REAR requires 20% warden escort
//                (the existing raid rule, enforced at order validation)
//     Composition is therefore a real decision without breaking the
//     weight-only power lock.
//
//  4. ORDERS (per vector, per round):
//       advance    +30% dealt / +20% taken      — push the line
//       hold       -30% taken  / -20% dealt     — dig in (default)
//       focus      +50% dealt to ONE enemy vector / +20% taken — pick target
//       flank      +40% dealt, hits adjacent enemy vector's exposed side
//       reinforce  move troops from RESERVE to a vector (no combat bonus
//                  for moved troops that round)
//       retreat    -50% taken / -80% dealt, -15 morale, preserves troops
//       withdraw   whole-force retreat — ends the battle (defender wins,
//                  attacker keeps survivors, no loot)
//     Orders are validated per vector (can't reinforce from an empty
//     reserve, can't flank with no wardens in the flanking force, etc.).
//
//  5. MORALE. Every vector starts at 100. Casualties shock it:
//     morale loss = (casualties / troops) × 120. At 0 the vector ROUTS —
//     its troops flee (half survive to exfil, half are lost). Routing
//     cascades: an adjacent vector loses 10 morale when its neighbor routs.
//     Battles are won by breaking the enemy's will as much as their bodies.
//
//  6. SHIP FIRE SUPPORT. Landed ships add +10% attacker power per round
//     (the existing rule, now per-round instead of one-shot). Ships holding
//     in orbit grant ORBITAL STRIKES: 3 charges per battle, each adds +50%
//     damage to one enemy vector for one round. Orbit = safe but limited;
//     landed = steady but exposed. That's the posture tradeoff.
//
//  7. DETERMINISM. No Math.random anywhere — the §15 discipline. All
//     randomness is a seeded hash of (battleId, round). Same orders in
//     → same result out. The defender AI is deterministic policy, not dice.
//
//  8. DEFENDER AI. Deterministic policy: hold the line, reinforce the
//     weakest engaged vector from reserve, focus-fire the attacker's
//     strongest vector when it has local advantage, counterattack with
//     REAR when the attacker's REAR is empty. A live defender issuing
//     real orders is a future pass — the AI takes the same order shape,
//     so the swap is clean.
//
//  9. END CONDITIONS. Attacker wins when every defender vector is
//     empty/routed. Defender wins when every attacker vector except
//     RESERVE is empty/routed, or the attacker withdraws. Round cap
//     (24) → stalemate: attacker forced to withdraw, loot pro-rated by
//     vectors held. Loot tiers follow the existing raid philosophy
//     (decisive/win/pyrrhic/loss) driven by the tactical result.
//
// INTEGRATION: startTacticalBattle() takes the raid's existing deployment
// shape (Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>),
// the attacker's ship posture, and defender strength — and returns a
// TacticalBattle. The raid's status transition ("deploying" → tactical →
// resolved) and server fns are the parent's wiring; this module owns the
// battle itself. Attach the returned battle to the raid (e.g.
// raid.tacticalBattle) and persist it — rounds resolve via resolveRound().

import type { ManeuverVector } from "./war-types";
import type { TroopType } from "./troops";
import { supplyWeight } from "./troops";
import type { Specialty } from "../types";
import { leaderVectorMult, leaderHoldReduction } from "../leader-roles";

// ============================================================================
// §0 CONFIG — every tunable in one block.
// ============================================================================
export const TACTICAL_CONFIG = {
  /** Max rounds before stalemate. 24 rounds × ~2.5 min/round ≈ 1 hour. */
  maxRounds: 24,
  /** Base casualty rate: casualties = power × lethality × mods. */
  lethality: 0.08,
  /** Morale shock: morale loss = (casualties/troops) × shockMult. */
  shockMult: 120,
  /** Morale lost by a vector when an adjacent vector routs. */
  routCascadeMorale: 10,
  /** Morale penalty for a vector ordered to retreat. */
  retreatMoraleCost: 15,
  /** Fraction of a routed vector's troops that survive to exfil. */
  routSurvivalFrac: 0.5,
  /** Landed ships: attacker power bonus per round. */
  landedShipBonus: 0.10,
  /** Orbital strikes: charges per battle when ships hold orbit. */
  orbitalStrikeCharges: 3,
  /** Orbital strike: damage bonus to the targeted vector for one round. */
  orbitalStrikeBonus: 0.50,
  /** Defender fortification: damage reduction on MAIN / FLANKS. */
  fortification: { MAIN: 0.15, FLANK_LEFT: 0.10, FLANK_RIGHT: 0.10, REAR: 0.05, RESERVE: 0 } as Record<ManeuverVector, number>,
  /** Thunder (siege) ignores this fraction of fortification. */
  thunderFortIgnore: 0.5,
  /** Pivoting defender vectors (envelopment) fight at this power fraction —
   *  they're outside their prepared positions. */
  pivotPowerMult: 0.35,
} as const;

// Order damage dealt / taken multipliers.
const ORDER_MODS: Record<TacticalOrderKind, { dealt: number; taken: number }> = {
  advance: { dealt: 1.30, taken: 1.20 },
  hold: { dealt: 0.80, taken: 0.70 },
  focus: { dealt: 1.50, taken: 1.20 },
  flank: { dealt: 1.40, taken: 1.10 },
  reinforce: { dealt: 1.00, taken: 1.00 },
  retreat: { dealt: 0.20, taken: 0.50 },
  withdraw: { dealt: 0, taken: 1.00 },
};

// Troop-type tactical affinities. Base power is ALWAYS count × supply
// weight (the locked rule); these are order-conditional multipliers.
function affinity(type: TroopType, order: TacticalOrderKind, fortified: boolean): { dealt: number; taken: number } {
  let dealt = 1, taken = 1;
  if (type === "reaver" && order === "advance") dealt *= 1.25;
  if (type === "bulwark" && order === "hold") taken *= 0.75;
  if (type === "longeye" && order === "hold") dealt *= 1.25;
  if (type === "longeye" && order === "advance") dealt *= 0.75;
  if (type === "thunder" && fortified) dealt *= 1.50;
  if (type === "warden" && order === "flank") dealt *= 1.25;
  return { dealt, taken };
}

// ============================================================================
// §1 TYPES
// ============================================================================

export type TacticalOrderKind =
  | "advance" | "hold" | "focus" | "flank" | "reinforce" | "retreat" | "withdraw";

export interface VectorOrder {
  order: TacticalOrderKind;
  /** For focus: the enemy vector to concentrate on. For reinforce: the
   *  friendly vector receiving troops. For flank: the adjacent enemy
   *  vector to hit (defaults to the mirrored vector's neighbor). */
  target?: ManeuverVector;
  /** For reinforce: how many troops to move (cap = reserve strength). */
  count?: number;
  /** For orbital strike (attacker only, ships in orbit): target vector. */
  orbitalStrike?: ManeuverVector;
}

export type OrdersMap = Partial<Record<ManeuverVector, VectorOrder>>;

export interface TacticalVectorState {
  troops: Partial<Record<TroopType, number>>;
  morale: number; // 0–100
  routed: boolean;
  fortified: boolean; // defender only, meaningful
  /** Damage reduction from fortifications (0–1). Set at setup from
   *  TACTICAL_CONFIG.fortification; thunder ignores half of it. */
  fortLevel: number;
}

export interface TacticalSideState {
  vectors: Record<ManeuverVector, TacticalVectorState>;
}

export type TacticalBattleStatus = "active" | "attacker_won" | "defender_won" | "stalemate";

export interface TacticalRoundLog {
  round: number;
  attackerOrders: OrdersMap;
  defenderOrders: OrdersMap;
  events: string[];
  attackerCasualties: Partial<Record<TroopType, number>>;
  defenderCasualties: Partial<Record<TroopType, number>>;
}

export interface TacticalBattle {
  id: string;
  raidId: string;
  round: number; // current round (1-based); 0 = not started
  status: TacticalBattleStatus;
  attacker: TacticalSideState;
  defender: TacticalSideState;
  /** Ship posture from the raid. */
  shipsHoldOrbit: boolean;
  shipFirepower: number; // total fleet firepower (for landed bonus scaling)
  /** Commanding leader's specialty — drives per-vector power every round. */
  leaderSpecialty?: Specialty;
  orbitalStrikesLeft: number;
  log: TacticalRoundLog[];
  /** Cumulative casualties, by side then type. */
  totalAttackerLosses: Partial<Record<TroopType, number>>;
  totalDefenderLosses: Partial<Record<TroopType, number>>;
  startedAt: number;
  endedAt?: number;
  /** Loot tier computed at battle end: 0–3 (loss/pyrrhic/win/decisive). */
  lootTier?: 0 | 1 | 2 | 3;
}

export interface StartBattleInput {
  battleId: string;
  raidId: string;
  /** The raid's deployment — the exact shape from the deploying phase. */
  deployment: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>;
  /** Defender headcount (AI colony defense). Split across zones by policy. */
  defenderTroops: number;
  /** Defender composition hint: fraction of wardens/bulwarks in the garrison. */
  defenderComposition?: Partial<Record<TroopType, number>>;
  shipsHoldOrbit: boolean;
  shipFirepower: number;
  now: number;
  /** Commanding leader's specialty (owner 2026-10-04) — their battle role
   *  modifies vector power and casualty rates every round. */
  leaderSpecialty?: Specialty;
}

// ============================================================================
// §2 DETERMINISM — seeded hash, no Math.random.
// ============================================================================
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0–1 float for (battleId, round, salt). */
function battleRand(battleId: string, round: number, salt: string): number {
  return hash32(`${battleId}:${round}:${salt}`) / 4294967296;
}

// ============================================================================
// §3 BATTLE SETUP
// ============================================================================

export const TACTICAL_VECTORS: ManeuverVector[] = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"];

function emptyVector(fortLevel = 0): TacticalVectorState {
  return { troops: {}, morale: 100, routed: false, fortified: fortLevel > 0, fortLevel };
}

/** Which defender vector does the attacker's vector engage? Flanks cross
 *  over (opposite sides of the field). REAR breakthrough: if the defender's
 *  REAR is empty/routed, the attacker's REAR hits the defender's MAIN.
 *  BREAKTHROUGH EXPLOITATION: if the primary target is routed/empty, the
 *  attacker engages the nearest defender vector that still has a fighting
 *  force — you don't stop after breaking the center, you roll up the line. */
export function engagementTarget(
  attackerVector: ManeuverVector,
  defender: TacticalSideState,
): ManeuverVector {
  let primary: ManeuverVector;
  if (attackerVector === "FLANK_LEFT") primary = "FLANK_RIGHT";
  else if (attackerVector === "FLANK_RIGHT") primary = "FLANK_LEFT";
  else if (attackerVector === "REAR") {
    const rear = defender.vectors.REAR;
    primary = (rear.routed || vectorHeadcount(rear) === 0) ? "MAIN" : "REAR";
  } else primary = attackerVector;

  const primaryVec = defender.vectors[primary];
  if (!primaryVec.routed && vectorHeadcount(primaryVec) > 0) return primary;

  // Primary target is broken — roll up the nearest intact defender vector.
  const preference = [primary, ...adjacentVectors(primary), ...TACTICAL_VECTORS];
  for (const v of preference) {
    if (v === "RESERVE") continue;
    const vec = defender.vectors[v];
    if (!vec.routed && vectorHeadcount(vec) > 0) return v;
  }
  return primary;
}

export function vectorHeadcount(v: TacticalVectorState): number {
  return (Object.values(v.troops) as number[]).reduce((n, c) => n + (c ?? 0), 0);
}

export function vectorPower(v: TacticalVectorState): number {
  return (Object.entries(v.troops) as [TroopType, number][])
    .reduce((p, [t, c]) => p + (c ?? 0) * supplyWeight(t), 0);
}

/** Split defender headcount across zones: core holds MAIN, perimeter on
 *  flanks, small rear guard, militia reserve. Deterministic. */
function deployDefender(total: number, composition?: Partial<Record<TroopType, number>>): TacticalSideState {
  const vectors = {
    MAIN: emptyVector(), FLANK_LEFT: emptyVector(), FLANK_RIGHT: emptyVector(),
    REAR: emptyVector(), RESERVE: emptyVector(),
  } as Record<ManeuverVector, TacticalVectorState>;
  // Default garrison mix: mostly bulwark/reaver, some longeye, few warden.
  const mix: Partial<Record<TroopType, number>> = composition ?? {
    bulwark: 0.35, reaver: 0.35, longeye: 0.15, warden: 0.10, thunder: 0.05,
  };
  const share: Record<ManeuverVector, number> = {
    MAIN: 0.40, FLANK_LEFT: 0.20, FLANK_RIGHT: 0.20, REAR: 0.05, RESERVE: 0.15,
  };
  for (const v of TACTICAL_VECTORS) {
    const heads = Math.floor(total * share[v]);
    const troops: Partial<Record<TroopType, number>> = {};
    let assigned = 0;
    const types = Object.keys(mix) as TroopType[];
    types.forEach((t, i) => {
      const n = i === types.length - 1 ? heads - assigned : Math.floor(heads * (mix[t] ?? 0));
      if (n > 0) { troops[t] = n; assigned += n; }
    });
    vectors[v].troops = troops;
    vectors[v].fortified = TACTICAL_CONFIG.fortification[v] > 0;
    vectors[v].fortLevel = TACTICAL_CONFIG.fortification[v];
  }
  return { vectors };
}

export function startTacticalBattle(input: StartBattleInput): TacticalBattle {
  const attackerVectors = {} as Record<ManeuverVector, TacticalVectorState>;
  for (const v of TACTICAL_VECTORS) {
    const troops = { ...(input.deployment[v] ?? {}) };
    attackerVectors[v] = { troops, morale: 100, routed: false, fortified: false, fortLevel: 0 };
  }
  return {
    id: input.battleId,
    raidId: input.raidId,
    round: 0,
    status: "active",
    attacker: { vectors: attackerVectors },
    defender: deployDefender(input.defenderTroops, input.defenderComposition),
    shipsHoldOrbit: input.shipsHoldOrbit,
    shipFirepower: input.shipFirepower,
    leaderSpecialty: input.leaderSpecialty,
    orbitalStrikesLeft: input.shipsHoldOrbit ? TACTICAL_CONFIG.orbitalStrikeCharges : 0,
    log: [],
    totalAttackerLosses: {},
    totalDefenderLosses: {},
    startedAt: input.now,
  };
}

// ============================================================================
// §4 ORDER VALIDATION
// ============================================================================

export function validateOrders(
  battle: TacticalBattle,
  side: "attacker" | "defender",
  orders: OrdersMap,
): string | null {
  const state = side === "attacker" ? battle.attacker : battle.defender;
  for (const [v, o] of Object.entries(orders) as [ManeuverVector, VectorOrder][]) {
    const vec = state.vectors[v];
    if (!vec || vec.routed || vectorHeadcount(vec) === 0) {
      return `${v} has no fighting force to order.`;
    }
    if (o.order === "reinforce") {
      // Reinforce is ordered ON the receiving vector: it pulls troops from
      // RESERVE into itself (and fights at par that round). Ordering it on
      // RESERVE itself is meaningless — hence the rejection below.
      if (v === "RESERVE") return "Order reinforce on the vector receiving troops, not on RESERVE.";
      const reserve = state.vectors.RESERVE;
      if (vectorHeadcount(reserve) === 0) return "RESERVE is empty — nothing to commit.";
    }
    if (o.order === "flank") {
      const wardens = vec.troops.warden ?? 0;
      const heads = vectorHeadcount(vec);
      if (heads > 0 && wardens / heads < 0.2) {
        return `${v} needs 20% warden escort to flank (has ${wardens}/${heads}).`;
      }
    }
    if (o.order === "withdraw" && side === "defender") {
      return "The defender holds their ground — no withdrawal.";
    }
  }
  // Orbital strike validation (attacker only).
  const strikes = Object.values(orders).filter((o) => o?.orbitalStrike).length;
  if (strikes > 0) {
    if (side !== "attacker") return "Only the attacker calls orbital strikes.";
    if (!battle.shipsHoldOrbit) return "Ships are landed — no orbital strikes available.";
    if (strikes > battle.orbitalStrikesLeft) {
      return `Only ${battle.orbitalStrikesLeft} orbital strike(s) left.`;
    }
  }
  return null;
}

// ============================================================================
// §5 DEFENDER AI — deterministic policy, same order shape as a player.
// ============================================================================

export function defenderAIOrders(battle: TacticalBattle): OrdersMap {
  const orders: OrdersMap = {};
  const d = battle.defender.vectors;
  const a = battle.attacker.vectors;
  const r = battle.round;

  // Find the attacker's strongest engaged vector → focus it if we can.
  let strongest: ManeuverVector | null = null;
  let strongestPower = 0;
  for (const v of TACTICAL_VECTORS) {
    if (v === "RESERVE" || a[v].routed) continue;
    const p = vectorPower(a[v]);
    if (p > strongestPower) { strongestPower = p; strongest = v; }
  }

  for (const v of TACTICAL_VECTORS) {
    const vec = d[v];
    if (vec.routed || vectorHeadcount(vec) === 0) continue;
    if (v === "RESERVE") {
      // Reinforce the weakest engaged friendly vector below 50% morale.
      // The order goes ON the receiving vector (it pulls from RESERVE).
      // Last stand: if the front is collapsing (any vector routed), feed
      // the reserve to the hardest-pressed SURVIVING vector instead.
      let collapsed = false;
      for (const w of TACTICAL_VECTORS) {
        if (w !== "RESERVE" && d[w].routed) { collapsed = true; break; }
      }
      let weakest: ManeuverVector | null = null;
      let weakestScore = Infinity;
      for (const w of TACTICAL_VECTORS) {
        if (w === "RESERVE" || d[w].routed || vectorHeadcount(d[w]) === 0) continue;
        const score = collapsed ? vectorHeadcount(d[w]) : d[w].morale;
        const threshold = collapsed ? Infinity : 50;
        if (score < Math.min(weakestScore, threshold)) { weakestScore = score; weakest = w; }
      }
      orders[v] = { order: "hold" };
      if (weakest) {
        orders[weakest] = { order: "reinforce", count: Math.floor(vectorHeadcount(vec) / 2) };
      }
      continue;
    }
    // Counterattack: if the attacker's REAR is empty, push ours forward.
    if (v === "REAR" && vectorHeadcount(a.REAR) === 0 && r > 2) {
      orders[v] = { order: "advance" };
      continue;
    }
    // Focus the attacker's spearhead when we have local parity.
    const mirror: ManeuverVector = v === "FLANK_LEFT" ? "FLANK_RIGHT" : v === "FLANK_RIGHT" ? "FLANK_LEFT" : v;
    if (strongest && mirror === strongest && vectorPower(vec) >= strongestPower * 0.7) {
      orders[v] = { order: "focus", target: v };
      continue;
    }
    // Shaken vectors dig in; broken ones (not MAIN) give ground to save troops.
    orders[v] = vec.morale < 25 && v !== "MAIN" ? { order: "retreat" } : { order: "hold" };
  }
  return orders;
}

// ============================================================================
// §6 ROUND RESOLUTION
// ============================================================================

interface VectorCombat {
  dealtMult: number;
  takenMult: number;
  target: ManeuverVector; // enemy vector actually hit
}

function orderCombat(
  battle: TacticalBattle,
  side: "attacker" | "defender",
  v: ManeuverVector,
  order: VectorOrder | undefined,
): VectorCombat {
  const kind = order?.order ?? "hold";
  const mod = ORDER_MODS[kind];
  const enemy = side === "attacker" ? battle.defender : battle.attacker;
  let target: ManeuverVector;
  if (kind === "focus" && order?.target) {
    target = order.target;
  } else if (side === "attacker") {
    target = engagementTarget(v, enemy);
  } else {
    // Defender mirrors: their vector X hits attacker's vector X (flanks cross).
    const mirror: ManeuverVector = v === "FLANK_LEFT" ? "FLANK_RIGHT" : v === "FLANK_RIGHT" ? "FLANK_LEFT" : v;
    const mirrorVec = battle.attacker.vectors[mirror];
    if (!mirrorVec.routed && vectorHeadcount(mirrorVec) > 0) {
      target = mirror;
    } else {
      // PIVOT: no opposition on the mirrored vector — the defender's intact
      // vector envelops the nearest engaged attacker vector instead of
      // sitting idle. This is what stops a single-vector attacker from
      // walking through an empty flank for free.
      target = nearestEngagedEnemy(battle, side, v) ?? mirror;
    }
  }
  return { dealtMult: mod.dealt, takenMult: mod.taken, target };
}

/** Nearest enemy vector that has a fighting force (not routed, not empty).
 *  Used for the defender's pivot when their mirrored vector is empty. */
function nearestEngagedEnemy(
  battle: TacticalBattle,
  side: "attacker" | "defender",
  from: ManeuverVector,
): ManeuverVector | null {
  const enemy = side === "attacker" ? battle.defender : battle.attacker;
  // Prefer adjacent vectors (envelopment), then any engaged vector.
  const preference = [from, ...adjacentVectors(from), ...TACTICAL_VECTORS];
  for (const v of preference) {
    if (v === "RESERVE") continue;
    const vec = enemy.vectors[v];
    if (!vec.routed && vectorHeadcount(vec) > 0) return v;
  }
  return null;
}

/** Effective power of a vector for this round, with order + affinity mods.
 *  targetFortified: whether the vector being hit is fortified (thunder
 *  siege crews do +50% vs fortifications). */
function effectivePower(
  vec: TacticalVectorState,
  order: VectorOrder | undefined,
  landedShipBonus: number,
  targetFortified: boolean,
): number {
  const kind = order?.order ?? "hold";
  let power = 0;
  for (const [t, c] of Object.entries(vec.troops) as [TroopType, number][]) {
    const aff = affinity(t, kind, targetFortified);
    power += (c ?? 0) * supplyWeight(t) * aff.dealt;
  }
  const mod = ORDER_MODS[kind];
  return power * mod.dealt * (1 + landedShipBonus);
}

function damageReduction(vec: TacticalVectorState, order: VectorOrder | undefined): number {
  const kind = order?.order ?? "hold";
  const mod = ORDER_MODS[kind];
  // takenMult < 1 means reduction; convert to a reduction fraction.
  let reduction = 1 - Math.min(mod.taken, 1);
  // Bulwark affinity: their share of the vector absorbs extra when holding.
  const heads = vectorHeadcount(vec);
  if (heads > 0 && kind === "hold") {
    const bulwarkShare = (vec.troops.bulwark ?? 0) / heads;
    reduction += bulwarkShare * 0.25 * (1 - reduction);
  }
  // Fortification (defender vectors carry fortLevel from setup).
  if (vec.fortLevel > 0) {
    reduction += vec.fortLevel * (1 - reduction);
  }
  return Math.min(reduction, 0.85);
}

/** Split casualties across troop types proportional to their headcount,
 *  with a deterministic jitter so repeated rounds don't look identical. */
function dealCasualties(
  vec: TacticalVectorState,
  casualties: number,
  battleId: string,
  round: number,
  salt: string,
): Partial<Record<TroopType, number>> {
  const out: Partial<Record<TroopType, number>> = {};
  const heads = vectorHeadcount(vec);
  if (heads === 0 || casualties <= 0) return out;
  let remaining = Math.min(Math.round(casualties), heads);
  const types = (Object.entries(vec.troops) as [TroopType, number][]).filter(([, c]) => (c ?? 0) > 0);
  // Bulwarks absorb first when holding — they ARE the wall (flavor of the
  // affinity: casualties skew toward bulwarks up to their share + 20%).
  const jitter = battleRand(battleId, round, salt);
  types.sort((a, b) => {
    const aScore = a[0] === "bulwark" ? 0 : 1 + jitter;
    const bScore = b[0] === "bulwark" ? 0 : 1 + (1 - jitter);
    return aScore - bScore;
  });
  for (let i = 0; i < types.length && remaining > 0; i++) {
    const [t, c] = types[i];
    const share = i === types.length - 1 ? remaining : Math.min(c ?? 0, Math.round(remaining * ((c ?? 0) / heads) * (0.9 + jitter * 0.2)));
    const killed = Math.min(share, c ?? 0, remaining);
    if (killed > 0) {
      out[t] = killed;
      vec.troops[t] = (c ?? 0) - killed;
      remaining -= killed;
    }
  }
  return out;
}

function addLosses(into: Partial<Record<TroopType, number>>, add: Partial<Record<TroopType, number>>): void {
  for (const [t, n] of Object.entries(add) as [TroopType, number][]) {
    into[t] = (into[t] ?? 0) + (n ?? 0);
  }
}

function moraleHit(vec: TacticalVectorState, casualties: number): void {
  const heads = vectorHeadcount(vec) + casualties; // pre-casualty strength
  if (heads === 0) return;
  vec.morale = Math.max(0, vec.morale - (casualties / heads) * TACTICAL_CONFIG.shockMult);
}

function checkRout(
  battle: TacticalBattle,
  side: "attacker" | "defender",
  v: ManeuverVector,
  events: string[],
  wasEngaged: boolean,
): void {
  const vec = (side === "attacker" ? battle.attacker : battle.defender).vectors[v];
  if (vec.routed) return;
  const heads = vectorHeadcount(vec);
  // Wiped out: the vector fought and has nothing left. Mark it out of the
  // fight (for defeat checks and the battle map) — distinct from a rout,
  // but equally finished.
  if (heads === 0 && wasEngaged) {
    vec.routed = true;
    events.push(`💀 ${side === "attacker" ? "Attacker" : "Defender"} ${v} WIPED OUT.`);
    cascadeMorale(battle, side, v);
    return;
  }
  if (heads === 0) return; // never deployed — not a rout, just empty
  if (vec.morale <= 0) {
    vec.routed = true;
    // Half the survivors flee the field (lost); half exfil.
    const lost: Partial<Record<TroopType, number>> = {};
    for (const [t, c] of Object.entries(vec.troops) as [TroopType, number][]) {
      const flee = Math.floor((c ?? 0) * (1 - TACTICAL_CONFIG.routSurvivalFrac));
      if (flee > 0) { lost[t] = flee; vec.troops[t] = (c ?? 0) - flee; }
    }
    const target = side === "attacker" ? battle.totalAttackerLosses : battle.totalDefenderLosses;
    addLosses(target, lost);
    events.push(`🏳️ ${side === "attacker" ? "Attacker" : "Defender"} ${v} ROUTS — the line breaks!`);
    cascadeMorale(battle, side, v);
  }
}

/** Adjacent vectors lose morale when a neighbor routs or is wiped out. */
function cascadeMorale(
  battle: TacticalBattle,
  side: "attacker" | "defender",
  v: ManeuverVector,
): void {
  const neighbors = adjacentVectors(v);
  const state = side === "attacker" ? battle.attacker : battle.defender;
  for (const n of neighbors) {
    const nv = state.vectors[n];
    if (!nv.routed && vectorHeadcount(nv) > 0) {
      nv.morale = Math.max(0, nv.morale - TACTICAL_CONFIG.routCascadeMorale);
    }
  }
}

function adjacentVectors(v: ManeuverVector): ManeuverVector[] {
  switch (v) {
    case "MAIN": return ["FLANK_LEFT", "FLANK_RIGHT"];
    case "FLANK_LEFT": return ["MAIN", "REAR"];
    case "FLANK_RIGHT": return ["MAIN", "REAR"];
    case "REAR": return ["FLANK_LEFT", "FLANK_RIGHT", "RESERVE"];
    case "RESERVE": return ["REAR", "MAIN"];
  }
}

function sideDefeated(state: TacticalSideState, isAttacker: boolean): boolean {
  for (const v of TACTICAL_VECTORS) {
    if (isAttacker && v === "RESERVE") continue; // reserves alone don't hold the field
    const vec = state.vectors[v];
    if (!vec.routed && vectorHeadcount(vec) > 0) return false;
  }
  return true;
}

/**
 * Resolve one tactical round. Attacker orders are required; defender orders
 * default to the deterministic AI. Returns the updated battle (mutated in
 * place, like the rest of the engine) plus a validation error if the orders
 * were illegal (in which case nothing resolves).
 */
export function resolveRound(
  battle: TacticalBattle,
  attackerOrders: OrdersMap,
  defenderOrders?: OrdersMap,
  now: number = Date.now(),
): { ok: boolean; error?: string } {
  if (battle.status !== "active") return { ok: false, error: "That battle is already over." };

  const aErr = validateOrders(battle, "attacker", attackerOrders);
  if (aErr) return { ok: false, error: aErr };
  const dOrders = defenderOrders ?? defenderAIOrders(battle);
  const dErr = validateOrders(battle, "defender", dOrders);
  if (dErr) return { ok: false, error: `Defender orders invalid: ${dErr}` };

  // Whole-force withdrawal ends it immediately.
  if (Object.values(attackerOrders).some((o) => o?.order === "withdraw")) {
    battle.status = "defender_won";
    battle.lootTier = 0;
    battle.endedAt = now;
    battle.round += 1;
    battle.log.push({
      round: battle.round, attackerOrders, defenderOrders: dOrders,
      events: ["🏳️ The attacker sounds the retreat — the raid withdraws."],
      attackerCasualties: {}, defenderCasualties: {},
    });
    return { ok: true };
  }

  const round = battle.round + 1;
  const events: string[] = [];
  const aCas: Partial<Record<TroopType, number>> = {};
  const dCas: Partial<Record<TroopType, number>> = {};

  // Snapshot headcounts before anything moves — drives rout detection.
  const preRoundHeads = {
    attacker: Object.fromEntries(
      TACTICAL_VECTORS.map((v) => [v, vectorHeadcount(battle.attacker.vectors[v])]),
    ) as Record<ManeuverVector, number>,
    defender: Object.fromEntries(
      TACTICAL_VECTORS.map((v) => [v, vectorHeadcount(battle.defender.vectors[v])]),
    ) as Record<ManeuverVector, number>,
  };

  // --- Reinforce moves happen BEFORE combat (troops reposition). ---
  for (const [side, orders] of [["attacker", attackerOrders], ["defender", dOrders]] as const) {
    const state = side === "attacker" ? battle.attacker : battle.defender;
    for (const [v, o] of Object.entries(orders) as [ManeuverVector, VectorOrder][]) {
      if (o?.order !== "reinforce") continue;
      // The order lives on the RECEIVING vector; it pulls from RESERVE.
      // An explicit target overrides for exotic plays.
      const destKey = o.target ?? v;
      const dest = state.vectors[destKey];
      const reserve = state.vectors.RESERVE;
      const move = Math.min(o.count ?? vectorHeadcount(reserve), vectorHeadcount(reserve));
      if (move <= 0 || dest.routed) continue;
      // Move proportionally across types.
      const rHeads = vectorHeadcount(reserve);
      for (const [t, c] of Object.entries(reserve.troops) as [TroopType, number][]) {
        const n = Math.floor(((c ?? 0) / rHeads) * move);
        if (n > 0) {
          reserve.troops[t] = (c ?? 0) - n;
          dest.troops[t] = (dest.troops[t] ?? 0) + n;
        }
      }
      events.push(`↗️ ${side === "attacker" ? "Attacker" : "Defender"} commits reserves → ${destKey} (${move} troops).`);
    }
  }

  // --- Orbital strikes (attacker, ships in orbit). ---
  const strikeTargets = new Set<ManeuverVector>();
  for (const o of Object.values(attackerOrders)) {
    if (o?.orbitalStrike) strikeTargets.add(o.orbitalStrike);
  }
  if (strikeTargets.size > 0) {
    battle.orbitalStrikesLeft = Math.max(0, battle.orbitalStrikesLeft - strikeTargets.size);
    for (const t of strikeTargets) events.push(`🛰️ ORBITAL STRIKE inbound on defender ${t}!`);
  }

  // --- Combat per vector pair. ---
  const landedBonus = battle.shipsHoldOrbit ? 0 : TACTICAL_CONFIG.landedShipBonus;
  const engagedDefenders = new Set<ManeuverVector>();
  for (const v of TACTICAL_VECTORS) {
    if (v === "RESERVE") continue; // reserves don't fight from the rear
    const aVec = battle.attacker.vectors[v];
    const aOrder = attackerOrders[v];
    if (aVec.routed || vectorHeadcount(aVec) === 0) continue;
    // Retreat orders: the vector disengages, takes reduced casualties, deals none.
    if (aOrder?.order === "retreat") {
      aVec.morale = Math.max(0, aVec.morale - TACTICAL_CONFIG.retreatMoraleCost);
      events.push(`↩️ Attacker ${v} falls back in good order.`);
      continue;
    }
    const combat = orderCombat(battle, "attacker", v, aOrder);
    const dVec = battle.defender.vectors[combat.target];
    engagedDefenders.add(combat.target);
    if (dVec.routed || vectorHeadcount(dVec) === 0) {
      // Unopposed: the vector pushes through into the defender's rear
      // echelon (their RESERVE) — a breakthrough keeps killing.
      const rear = battle.defender.vectors.RESERVE;
      if (!rear.routed && vectorHeadcount(rear) > 0) {
        const breakthroughPower = effectivePower(aVec, aOrder, landedBonus, false) * 0.5;
        const rearCas = breakthroughPower * TACTICAL_CONFIG.lethality;
        const dk = dealCasualties(rear, rearCas, battle.id, round, `rear-${v}`);
        addLosses(dCas, dk);
        moraleHit(rear, Math.round(rearCas));
        const dkTotal = (Object.values(dk) as number[]).reduce((n, c) => n + c, 0);
        events.push(`⚔️ Attacker ${v} overruns the defender's rear — ${dkTotal} casualties.`);
      } else {
        events.push(`⚔️ Attacker ${v} advances unopposed on ${combat.target}.`);
      }
      continue;
    }
    const dOrder = dOrders[combat.target];
    const aPower = effectivePower(aVec, aOrder, landedBonus, dVec.fortified)
      * (strikeTargets.has(combat.target) ? 1 + TACTICAL_CONFIG.orbitalStrikeBonus : 1)
      // Round-1 surprise: flanks/rear hit harder before the enemy reacts.
      * (round === 1 && (v === "FLANK_LEFT" || v === "FLANK_RIGHT") ? 1.25 : 1)
      * (round === 1 && v === "REAR" ? 1.5 : 1)
      // Leader battle role (owner 2026-10-04): the commanding leader's bus
      // defines the fight — favored vectors hit harder every round.
      * leaderVectorMult(battle.leaderSpecialty, v);
    const dPower = effectivePower(dVec, dOrder, 0, aVec.fortified);

    // Exchange: each side's casualties scale with the ENEMY's power.
    const dReduction = damageReduction(dVec, dOrder);
    const aReduction = damageReduction(aVec, aOrder);
    const dCasualties = aPower * TACTICAL_CONFIG.lethality * (1 - dReduction);
    // Leader hold reduction: a line-holder brings more people home.
    const aCasualties = dPower * TACTICAL_CONFIG.lethality * (1 - aReduction)
      * (1 - leaderHoldReduction(battle.leaderSpecialty));

    const dk = dealCasualties(dVec, dCasualties, battle.id, round, `a-${v}`);
    const ak = dealCasualties(aVec, aCasualties, battle.id, round, `d-${combat.target}`);
    addLosses(dCas, dk);
    addLosses(aCas, ak);
    moraleHit(dVec, Math.round(dCasualties));
    moraleHit(aVec, Math.round(aCasualties));

    const dkTotal = (Object.values(dk) as number[]).reduce((n, c) => n + c, 0);
    const akTotal = (Object.values(ak) as number[]).reduce((n, c) => n + c, 0);
    if (dkTotal > 0 || akTotal > 0) {
      events.push(`⚔️ ${v} ↔ ${combat.target}: attacker loses ${akTotal}, defender loses ${dkTotal}.`);
    }
  }

  // --- Defender counterattacks: vectors the attacker never engaged don't
  // sit idle — they pivot onto the nearest engaged attacker vector
  // (envelopment). This is what stops a single-vector attacker from walking
  // through an empty flank for free.
  // (engagedDefenders was populated in the attacker loop above — it tracks
  // which defender vectors already fought this round)
  for (const v of TACTICAL_VECTORS) {
    if (v === "RESERVE") continue;
    const dVec = battle.defender.vectors[v];
    const dOrder = dOrders[v];
    if (dVec.routed || vectorHeadcount(dVec) === 0) continue;
    if (engagedDefenders.has(v)) continue;
    if (dOrder?.order === "retreat") {
      dVec.morale = Math.max(0, dVec.morale - TACTICAL_CONFIG.retreatMoraleCost);
      events.push(`↩️ Defender ${v} falls back in good order.`);
      continue;
    }
    const target = nearestEngagedEnemy(battle, "defender", v);
    if (!target) continue;
    const aVec = battle.attacker.vectors[target];
    // Pivoting vectors fight at reduced effectiveness — they're attacking
    // outside their prepared positions, not from fortified ground.
    const dPower = effectivePower(dVec, dOrder, 0, aVec.fortified) * TACTICAL_CONFIG.pivotPowerMult;
    const aReduction = damageReduction(aVec, attackerOrders[target]);
    const aCasualties = dPower * TACTICAL_CONFIG.lethality * (1 - aReduction);
    const ak = dealCasualties(aVec, aCasualties, battle.id, round, `pivot-${v}`);
    addLosses(aCas, ak);
    moraleHit(aVec, Math.round(aCasualties));
    const akTotal = (Object.values(ak) as number[]).reduce((n, c) => n + c, 0);
    if (akTotal > 0) {
      events.push(`↩️ Defender ${v} envelops attacker ${target} — ${akTotal} casualties.`);
    }
  }

  addLosses(battle.totalAttackerLosses, aCas);
  addLosses(battle.totalDefenderLosses, dCas);

  // --- Rout checks. A vector counts as engaged if it had troops when the
  // round started (so a vector wiped to zero is marked out, while a vector
  // that was never deployed stays merely empty). ---
  const engaged = (side: "attacker" | "defender", v: ManeuverVector): boolean =>
    (preRoundHeads[side][v] ?? 0) > 0;
  for (const v of TACTICAL_VECTORS) {
    checkRout(battle, "attacker", v, events, engaged("attacker", v));
    checkRout(battle, "defender", v, events, engaged("defender", v));
  }

  battle.round = round;
  battle.log.push({ round, attackerOrders, defenderOrders: dOrders, events, attackerCasualties: aCas, defenderCasualties: dCas });

  // --- End conditions. ---
  const aDefeated = sideDefeated(battle.attacker, true);
  const dDefeated = sideDefeated(battle.defender, false);
  if (dDefeated && !aDefeated) {
    battle.status = "attacker_won";
    battle.lootTier = attackerLossFrac(battle) < 0.2 ? 3 : attackerLossFrac(battle) < 0.5 ? 2 : 1;
    battle.endedAt = now;
    events.push("🏆 DEFENDER BROKEN — the field is yours!");
  } else if (aDefeated) {
    battle.status = "defender_won";
    battle.lootTier = 0;
    battle.endedAt = now;
    events.push("💀 ATTACKER BROKEN — the raid is repulsed.");
  } else if (round >= TACTICAL_CONFIG.maxRounds) {
    battle.status = "stalemate";
    battle.lootTier = vectorsHeld(battle, "attacker") >= 3 ? 1 : 0;
    battle.endedAt = now;
    events.push("⏳ STALEMATE — both sides are spent. The attacker withdraws.");
  }
  return { ok: true };
}

function attackerLossFrac(battle: TacticalBattle): number {
  const lost = (Object.values(battle.totalAttackerLosses) as number[]).reduce((n, c) => n + c, 0);
  let committed = lost;
  for (const v of TACTICAL_VECTORS) committed += vectorHeadcount(battle.attacker.vectors[v]);
  return committed === 0 ? 1 : lost / committed;
}

function vectorsHeld(battle: TacticalBattle, side: "attacker" | "defender"): number {
  const state = side === "attacker" ? battle.attacker : battle.defender;
  return TACTICAL_VECTORS.filter((v) => !state.vectors[v].routed && vectorHeadcount(state.vectors[v]) > 0).length;
}

/** Quick-resolve: auto-play remaining rounds with hold/hold orders.
 *  For commanders who can't stay for the whole battle. Deterministic. */
export function quickResolve(battle: TacticalBattle, now: number = Date.now()): TacticalBattle {
  let guard = 0;
  while (battle.status === "active" && guard < TACTICAL_CONFIG.maxRounds + 1) {
    const res = resolveRound(battle, {}, undefined, now);
    if (!res.ok) break;
    guard++;
  }
  return battle;
}

/** Survivors the attacker brings home, by type (unrouted remaining troops). */
export function attackerSurvivors(battle: TacticalBattle): Partial<Record<TroopType, number>> {
  const out: Partial<Record<TroopType, number>> = {};
  for (const v of TACTICAL_VECTORS) {
    const vec = battle.attacker.vectors[v];
    if (vec.routed) continue;
    for (const [t, c] of Object.entries(vec.troops) as [TroopType, number][]) {
      out[t] = (out[t] ?? 0) + (c ?? 0);
    }
  }
  return out;
}

/** Compact battle summary for the report / memorial / loot pipeline. */
export function battleSummary(battle: TacticalBattle): {
  status: TacticalBattleStatus;
  rounds: number;
  attackerLosses: number;
  defenderLosses: number;
  lootTier: 0 | 1 | 2 | 3;
} {
  const aL = (Object.values(battle.totalAttackerLosses) as number[]).reduce((n, c) => n + c, 0);
  const dL = (Object.values(battle.totalDefenderLosses) as number[]).reduce((n, c) => n + c, 0);
  return {
    status: battle.status,
    rounds: battle.round,
    attackerLosses: aL,
    defenderLosses: dL,
    lootTier: battle.lootTier ?? 0,
  };
}
