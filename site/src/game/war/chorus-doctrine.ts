// CHORUS DOCTRINE — the AI fights like a survivor, not a conqueror.
//
// (owner 2026-10-06): the Chorus almost LOST the war — it didn't win, it was
// a draw — so it would rather defend until it feels like it can attack. Any
// Chorus raid meets a layered DEFENSE first: tanks holding forward, ranged
// behind, pre-sighted siege in the rear, a deep reserve. It lets the player
// come. When the player bleeds (~60% fielded strength, or a broken vector),
// the survivor smells blood: the reserve commits and pushes the weak point.
//
// Pure module: the canvas sim (BattleScene) calls these; tests pin them.

import { supplyWeight, tierPowerMult } from "./troops";
import type { BattleSide, ManeuverVector } from "./war-types";
import { WORLD_H, clampWorldX } from "./battle-scene-model";

/** Damage reduction while a Chorus unit holds its defensive posture. Small
 *  on purpose — flanking or overwhelming a holding line must still work;
 *  the bonus rewards maneuver, it doesn't make the line unbreakable. */
export const CHORUS_HOLD_REDUCTION = 0.12;

/** Player fielded-strength fraction that smells like blood to the Chorus. */
export const COUNTERATTACK_STRENGTH_FRAC = 0.6;

/** A player vector is broken when half its committed strength is gone. */
export const VECTOR_BREAK_FRAC = 0.5;

export interface DoctrineUnit {
  id: string;
  side: BattleSide;
  kind: string;
  tier: 1 | 2 | 3 | 4;
  vector: ManeuverVector;
  state: string;
  x: number;
  y: number;
}

/** True while a unit earns the defensive hold bonus: a Chorus unit in
 *  posture — holding its ground, not yet engaged, not advancing. */
export function holdingBonusApplies(u: DoctrineUnit): boolean {
  return u.side === "defender" && u.state === "holding";
}

/** Tier-weighted power of a unit list — "fielded strength" prices elites. */
export function doctrinePower(units: DoctrineUnit[]): number {
  return units.reduce(
    (s, u) => s + supplyWeight(u.kind as "bulwark") * tierPowerMult(u.tier),
    0,
  );
}

export interface CounterattackEval {
  /** The survivor smells blood. */
  trigger: boolean;
  /** Attacker fielded strength as a fraction of its committed strength. */
  playerStrength: number;
  /** Player vectors that broke (half strength gone) — the weak points. */
  brokenVectors: ManeuverVector[];
  /** Weakest living attacker vector — where the reserve pushes. */
  weakestVector: ManeuverVector | null;
}

/**
 * Pure: should the Chorus commit its reserve? Fires when the player's
 * fielded strength drops below the grade's threshold (G5 smells blood
 * earlier — 0.75 vs 0.6), or when any player vector breaks.
 * Deterministic for a given unit snapshot.
 */
export function evaluateCounterattack(
  units: DoctrineUnit[],
  threshold: number = COUNTERATTACK_STRENGTH_FRAC,
): CounterattackEval {
  const attackers = units.filter((u) => u.side === "attacker");
  const alive = attackers.filter((u) => u.state !== "dead");
  const committed = doctrinePower(attackers);
  const fielded = doctrinePower(alive);
  const playerStrength = committed > 0 ? fielded / committed : 0;

  const brokenVectors: ManeuverVector[] = [];
  let weakestVector: ManeuverVector | null = null;
  let weakestPower = Infinity;
  const vectors = new Set(attackers.map((u) => u.vector));
  for (const v of vectors) {
    const inV = attackers.filter((u) => u.vector === v);
    const aliveV = inV.filter((u) => u.state !== "dead");
    const frac = inV.length > 0 ? aliveV.length / inV.length : 1;
    if (frac <= 1 - VECTOR_BREAK_FRAC) brokenVectors.push(v);
    const p = doctrinePower(aliveV);
    if (aliveV.length > 0 && p < weakestPower) {
      weakestPower = p;
      weakestVector = v;
    }
  }

  return {
    trigger: playerStrength < threshold || brokenVectors.length > 0,
    playerStrength,
    brokenVectors,
    weakestVector,
  };
}

export interface CounterattackOrder {
  unitId: string;
  /** Push here — the weak point. */
  tx: number;
  ty: number;
  /** True when the reserve hasn't entered yet: commit it NOW, not at its
   *  scheduled delayed entry. */
  enterNow: boolean;
}

/**
 * Pure: where the committed reserve goes. Every living defender RESERVE unit
 * gets an order toward the centroid of the weakest attacker vector — the
 * battle visibly shifts. Deterministic for a given snapshot.
 */
export function counterattackOrders(
  units: DoctrineUnit[],
  threshold: number = COUNTERATTACK_STRENGTH_FRAC,
): CounterattackOrder[] {
  const eval_ = evaluateCounterattack(units, threshold);
  if (!eval_.trigger || !eval_.weakestVector) return [];
  const prey = units.filter(
    (u) => u.side === "attacker" && u.vector === eval_.weakestVector && u.state !== "dead",
  );
  if (prey.length === 0) return [];
  const tx = meanX(prey);
  const ty = prey.reduce((s, u) => s + u.y, 0) / prey.length;
  return units
    .filter((u) => u.side === "defender" && u.vector === "RESERVE" && u.state !== "dead")
    .map((u) => ({ unitId: u.id, tx, ty, enterNow: u.state === "staging" }));
}

export interface SpoilingEval {
  /** The Bastion comes looking for the kill. */
  trigger: boolean;
  /** The most extended player vector — where the strike package goes. */
  targetVector: ManeuverVector | null;
}

/** Mean x of a unit list. */
function meanX(units: DoctrineUnit[]): number {
  return units.reduce((s, u) => s + u.x, 0) / Math.max(1, units.length);
}

/** Mean y of a unit list (0 = north edge, WORLD_H = south edge). */
function meanY(units: DoctrineUnit[]): number {
  return units.reduce((s, u) => s + u.y, 0) / Math.max(1, units.length);
}

/**
 * Pure: should G5 launch a spoiling attack? The Bastion doesn't wait for
 * the bleed trigger — after first contact, if the player's advance stalls
 * (healthy but not winning late) or overextends a vector (pushing deep
 * while the line holds), the strike package commits proactively at the
 * most extended player vector. G5 only — the lower grades never hunt.
 */
export function evaluateSpoilingAttack(
  units: DoctrineUnit[],
  tS: number,
  phase: string,
): SpoilingEval {
  const none = { trigger: false, targetVector: null };
  if (phase !== "weapons-free" && phase !== "contact") return none;
  if (tS < 90) return none; // let first contact develop
  const attackers = units.filter((u) => u.side === "attacker" && u.state !== "dead");
  if (attackers.length === 0) return none;
  // North-south battles: the most extended vector is the northmost (min y) —
  // overextension means pushing deep into the Chorus half (y < 0.45) while
  // the defensive line holds.
  let targetVector: ManeuverVector | null = null;
  let bestY = Infinity;
  let overextended = false;
  for (const v of new Set(attackers.map((u) => u.vector))) {
    const inV = attackers.filter((u) => u.vector === v);
    if (inV.length < 2) continue;
    const my = meanY(inV);
    if (my < bestY) {
      bestY = my;
      targetVector = v;
    }
    if (my < 0.45) overextended = true;
  }
  const strength = evaluateCounterattack(units).playerStrength;
  const stalled = tS >= 180 && strength >= 0.75; // healthy but not winning — the attack is dying
  const trigger = overextended || stalled;
  return { trigger, targetVector: trigger ? targetVector : null };
}

/**
 * Pure: the spoiling attack's orders — the deep reserve (G5's strike
 * package: fast movers + siege) goes at the target vector, now.
 */
export function spoilingAttackOrders(
  units: DoctrineUnit[],
  targetVector: ManeuverVector,
): CounterattackOrder[] {
  const prey = units.filter(
    (u) => u.side === "attacker" && u.vector === targetVector && u.state !== "dead",
  );
  if (prey.length === 0) return [];
  const tx = meanX(prey);
  const ty = prey.reduce((s, u) => s + u.y, 0) / prey.length;
  return units
    .filter((u) => u.side === "defender" && u.vector === "RESERVE" && u.state !== "dead")
    .map((u) => ({ unitId: u.id, tx, ty, enterNow: u.state === "staging" }));
}

export interface EnvelopmentOrder {
  flank: "FLANK_LEFT" | "FLANK_RIGHT";
  tx: number;
  ty: number;
}

/**
 * Pure: G5 envelopment. When a Bastion flank vector is engaged against a
 * weakened player flank (under half strength), it doesn't just push back —
 * it swings around the flank toward the attacker's rear, trying to win.
 * One order per engaged flank. G5 only.
 */
export function evaluateEnvelopment(units: DoctrineUnit[]): EnvelopmentOrder[] {
  const orders: EnvelopmentOrder[] = [];
  for (const flank of ["FLANK_LEFT", "FLANK_RIGHT"] as const) {
    const engaged = units.filter(
      (u) => u.side === "defender" && u.vector === flank && u.state === "engaged",
    );
    if (engaged.length === 0) continue;
    const all = units.filter((u) => u.side === "attacker" && u.vector === flank);
    const alive = all.filter((u) => u.state !== "dead");
    if (all.length === 0 || alive.length / all.length >= 0.5) continue; // not weakened
    const cx = meanX(alive);
    const cy = meanY(alive);
    // Push AROUND: swing past the weakened flank toward the attacker's rear
    // (south) — cut them off instead of shoving them back.
    orders.push({
      flank,
      tx: clampWorldX(cx),
      ty: Math.min(WORLD_H - 0.06, cy + 0.25),
    });
  }
  return orders;
}
