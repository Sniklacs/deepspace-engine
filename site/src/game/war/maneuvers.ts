// RALLY MANEUVERS — the battle plan (design/alliances.md §2).
//
// A rally isn't a pile of troops, it's a plan: up to four maneuvers
// (MAIN + three), each with an entry vector and a timed entry. FLANK/REAR
// stay hidden until they enter, then fight surprised (+25% power, 5 min).
// REAR needs its logistics tail (≥20% Warden weight); Thunder is too heavy
// to sweep (MAIN/RESERVE only). Illegal plans are rejected BEFORE launch —
// never mid-battle.
//
// This module is pure: plan types, legality validation, weight/composition
// math. The engine (battle-engine.ts advanceManeuverEntries) consumes plans
// as scheduled entry events; the roster layer (roster-commit.ts) commits
// each maneuver's weight out of a real roster at attach time ("pledged
// troops leave the garrison on pledge, not on launch").
//
// Deterministic, no Math.random. Troop-type roles (alliances.md):
//   Bulwark → MAIN · Reaver → FLANK/REAR · Longeye → FLANK
//   Thunder → MAIN/RESERVE only · Warden → logistics escort
// v1 enforces the two hard vector rules (Thunder, REAR Wardens) plus plan
// structure; the rest is composition guidance, not law.

import { supplyWeight, type TroopType } from "./troops";
import { BATTLES_CONFIG, type ManeuverVector } from "./war-types";

/** One maneuver in a battle plan: who goes where, when, and in what mix. */
export interface PlannedManeuver {
  id: string;
  vector: ManeuverVector;
  /** Minutes from battle start when this maneuver enters. MAIN is always 0. */
  enterAtMin: number;
  /** Troop mix by type — drives the Warden/Thunder vector rules. */
  composition: Partial<Record<TroopType, number>>;
}

/** A rally's battle plan: the caller's vectors, timing, and logistics. */
export interface BattlePlan {
  id: string;
  maneuvers: PlannedManeuver[];
}

/** Supply-weight of one maneuver (the lock/commit unit). */
export function maneuverWeight(m: PlannedManeuver): number {
  let w = 0;
  for (const [t, n] of Object.entries(m.composition ?? {})) {
    w += supplyWeight(t as TroopType) * Math.max(0, Math.trunc(n ?? 0) || 0);
  }
  return w;
}

/** Total pledged weight of the whole plan. */
export function planWeight(plan: BattlePlan): number {
  return plan.maneuvers.reduce((s, m) => s + maneuverWeight(m), 0);
}

/** Aggregate pledged composition by type — the scouts' report (public at
 *  launch; the plan itself stays hidden). */
export function planComposition(plan: BattlePlan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of plan.maneuvers) {
    for (const [t, n] of Object.entries(m.composition ?? {})) {
      const c = Math.max(0, Math.trunc(n ?? 0) || 0);
      if (c > 0) out[t] = (out[t] ?? 0) + c;
    }
  }
  return out;
}

/** Warden supply-weight share of one maneuver (the REAR logistics rule). */
export function wardenShare(m: PlannedManeuver): number {
  const w = maneuverWeight(m);
  if (w <= 0) return 0;
  const warden = supplyWeight("warden") * Math.max(0, Math.trunc(m.composition?.warden ?? 0) || 0);
  return warden / w;
}

const FLANK_VECTORS: ManeuverVector[] = ["FLANK_LEFT", "FLANK_RIGHT", "REAR"];

/**
 * Validate a battle plan BEFORE launch. Returns the list of violations —
 * empty means the plan is legal. Checks (alliances.md §2, §10):
 *  • at most maneuverMaxCount maneuvers (MAIN + 3)
 *  • exactly one MAIN, entering at T+0
 *  • no vector twice
 *  • every entry time inside [0, battle duration]
 *  • no empty maneuver
 *  • Thunder never flanks (MAIN/RESERVE only)
 *  • REAR carries ≥ maneuverRearWardenFrac Warden weight
 */
export function validateBattlePlan(plan: BattlePlan, durationMs: number): string[] {
  const errors: string[] = [];
  const maneuvers = plan.maneuvers ?? [];
  if (maneuvers.length === 0) {
    errors.push("A battle plan needs at least one maneuver.");
    return errors;
  }
  if (maneuvers.length > BATTLES_CONFIG.maneuverMaxCount) {
    errors.push(`At most ${BATTLES_CONFIG.maneuverMaxCount} maneuvers per plan (MAIN + 3) — plans stay legible.`);
  }
  const mains = maneuvers.filter((m) => m.vector === "MAIN");
  if (mains.length === 0) errors.push("Every plan needs a MAIN maneuver to hold the enemy's facing.");
  if (mains.length > 1) errors.push("Only one MAIN maneuver per plan.");
  const seen = new Set<string>();
  for (const m of maneuvers) {
    if (!m.vector) {
      errors.push(`Maneuver ${m.id || "?"} has no entry vector.`);
      continue;
    }
    if (seen.has(m.vector)) errors.push(`${m.vector} is assigned twice — one maneuver per vector.`);
    seen.add(m.vector);
    const enterAtMs = (m.enterAtMin ?? 0) * 60_000;
    if (m.vector === "MAIN" && (m.enterAtMin ?? 0) !== 0) {
      errors.push("MAIN engages at T+0 — it holds the line from the first minute.");
    }
    if (!(m.enterAtMin >= 0)) errors.push(`${m.vector}: entry time must be ≥ 0.`);
    else if (enterAtMs >= durationMs) {
      errors.push(`${m.vector}: entry at ${m.enterAtMin} min is after the battle ends.`);
    }
    const w = maneuverWeight(m);
    if (w <= 0) {
      errors.push(`${m.vector}: an empty maneuver holds nothing.`);
      continue;
    }
    const thunder = Math.max(0, Math.trunc(m.composition?.thunder ?? 0) || 0);
    if (thunder > 0 && (FLANK_VECTORS as string[]).includes(m.vector)) {
      errors.push(`${m.vector}: Thunder is too heavy to sweep — MAIN or RESERVE only.`);
    }
    if (m.vector === "REAR" && wardenShare(m) < BATTLES_CONFIG.maneuverRearWardenFrac) {
      errors.push(`REAR needs its logistics tail — at least ${Math.round(BATTLES_CONFIG.maneuverRearWardenFrac * 100)}% Warden weight, or the sweep starves.`);
    }
  }
  return errors;
}

/** Wall-clock entry time of a maneuver (battle.startedAt + offset). */
export function maneuverEnterAt(startedAt: number, m: PlannedManeuver): number {
  return startedAt + Math.max(0, m.enterAtMin) * 60_000;
}

/** Surprise multiplier for an entering FLANK/REAR maneuver — halved when the
 *  defender screened the vector (early warning). MAIN/RESERVE never surprise. */
export function surpriseMult(vector: ManeuverVector, screened: boolean): number {
  if (!(FLANK_VECTORS as string[]).includes(vector)) return 1;
  return screened ? BATTLES_CONFIG.maneuverScreenedMult : BATTLES_CONFIG.maneuverSurpriseMult;
}
