// FORMATIONS — raid loadouts, exploration loadouts, response teams
// (owner 2026-10-04: "don't be afraid to make pages").
//
// A formation is a pre-built battle group ready to roll: ships reserved and
// loaded with troops, supplies staged, a hero leader assigned. When raiders
// come or you want to launch, you don't assemble from scratch — you grab a
// formation and deploy it.
//
// Types:
//   raid        — an attack formation; deploys as a raid party
//   exploration — a survey/expo formation (ships + troops + supplies staged)
//   response    — a defense formation; on standby for incoming raids
//
// Rules:
//   - A formation MUST have a hero leader. No hero = no save, no deploy.
//     The UI explains this (owner UI rule: the button says what's missing).
//   - Ships are RESERVED when assigned (status "reserved") — they can't be
//     assigned to a raid or another formation until released.
//   - Troops are moved OUT of the home roster into the formation's ships —
//     what the formation carries is committed, like raid loading.
//   - Deploying a formation as a raid creates a RaidParty pre-loaded with
//     the formation's ships, troops, and supplies. The formation is consumed
//     (status "deployed"); when the raid finishes, the formation is retired.
//
// Pure data model + logic. Engine functions (state access) live in engine.ts.
import type { TroopType } from "./war/troops";
import { supplyWeight } from "./war/troops";
import { SHIP_TROOP_CAP, SHIP_LOOT_CAP, SHIP_FIREPOWER, SHIP_HULL } from "./raids";
import { BATTLES_CONFIG } from "./war/war-types";
import { chorusSiteIntel } from "./chorus-intel";
import type { ShipClass } from "./worldmap";

/** The three formation kinds (owner 2026-10-04). */
export type FormationType = "raid" | "exploration" | "response";

export const FORMATION_TYPES: FormationType[] = ["raid", "exploration", "response"];

/** A ship in a formation, with its loaded troops. */
export interface FormationShip {
  shipId: string;
  class: ShipClass;
  /** Troops loaded on THIS ship, by type. */
  troops: Partial<Record<TroopType, number>>;
}

/** A pre-built battle formation ready to roll. */
export interface Formation {
  id: string; // `formation-<seq>`
  name: string;
  type: FormationType;
  /** Hero leader — REQUIRED. A formation can't be saved or deployed without one. */
  heroId: string;
  heroName: string;
  ships: FormationShip[];
  /** Supplies staged with the formation (moved out of home stockpile). */
  supplies: number;
  status: "standby" | "deployed";
  createdAt: number;
  /** Monotonic per-state counter is the source of ids. */
  seq: number;
}

/** Formations state. Optional on GameState for migration. */
export interface FormationsState {
  formations: Formation[];
  seq: number;
}

export function emptyFormationsState(): FormationsState {
  return { formations: [], seq: 1 };
}

/** Create a formation. The hero leader is required — no hero, no formation. */
export function createFormation(
  name: string,
  type: FormationType,
  heroId: string,
  heroName: string,
  seq: number,
  now: number,
): { ok: boolean; error?: string; formation?: Formation } {
  const cleanName = (name || "").trim().slice(0, 48);
  if (!cleanName) return { ok: false, error: "Name your formation — \"Dawn Hammer\", \"Gate Watch\", whatever fits." };
  if (!FORMATION_TYPES.includes(type)) return { ok: false, error: "Pick a formation type: raid, exploration, or response." };
  if (!heroId) {
    return {
      ok: false,
      error: "A formation needs a hero to lead it — no hero, no formation. Pick a leader first.",
    };
  }
  return {
    ok: true,
    formation: {
      id: `formation-${seq}`,
      name: cleanName,
      type,
      heroId,
      heroName,
      ships: [],
      supplies: 0,
      status: "standby",
      createdAt: now,
      seq,
    },
  };
}

/** Total troops committed to a formation (heads). */
export function formationTroopCount(f: Formation): number {
  let n = 0;
  for (const s of f.ships) {
    for (const c of Object.values(s.troops)) n += c ?? 0;
  }
  return n;
}

/** Total troop capacity of the formation's ships. */
export function formationTroopCapacity(f: Formation): number {
  return f.ships.reduce((n, s) => n + (SHIP_TROOP_CAP[s.class] ?? 0), 0);
}

/** Total loot cargo of the formation's ships. */
export function formationLootCapacity(f: Formation): number {
  return f.ships.reduce((n, s) => n + (SHIP_LOOT_CAP[s.class] ?? 0), 0);
}

/** Troops on one ship. */
export function formationShipTroopCount(s: FormationShip): number {
  let n = 0;
  for (const c of Object.values(s.troops)) n += c ?? 0;
  return n;
}

/** The first blocker stopping this formation from deploying. Null = ready. */
export function formationDeployBlocker(f: Formation): string | null {
  if (f.status !== "standby") return "That formation already deployed — it's with its raid.";
  if (!f.heroId) return "Assign a hero leader first — a formation doesn't march without one.";
  if (f.ships.length === 0) return "Reserve at least one jump ship — the formation needs a ride.";
  if (formationTroopCount(f) === 0) return "Load troops onto the ships — an empty formation defends nothing.";
  return null;
}

/** Assign a ship to a standby formation (pure — the caller flips ship status). */
export function assignFormationShip(
  f: Formation,
  shipId: string,
  shipClass: ShipClass,
): { ok: boolean; error?: string } {
  if (f.status !== "standby") return { ok: false, error: "That formation already deployed — no changes." };
  if (f.ships.some((s) => s.shipId === shipId)) return { ok: false, error: "That ship is already in this formation." };
  f.ships.push({ shipId, class: shipClass, troops: {} });
  return { ok: true };
}

/** Remove a ship from a standby formation (pure — the caller returns troops). */
export function removeFormationShip(
  f: Formation,
  shipId: string,
): { ok: boolean; error?: string; removed?: FormationShip } {
  if (f.status !== "standby") return { ok: false, error: "That formation already deployed — no changes." };
  const i = f.ships.findIndex((s) => s.shipId === shipId);
  if (i < 0) return { ok: false, error: "That ship isn't in this formation." };
  const [removed] = f.ships.splice(i, 1);
  return { ok: true, removed };
}

/** Load troops onto one of the formation's ships (pure capacity check). */
export function loadFormationShipTroops(
  f: Formation,
  shipId: string,
  type: TroopType,
  count: number,
): { ok: boolean; error?: string } {
  if (f.status !== "standby") return { ok: false, error: "That formation already deployed — no changes." };
  const ship = f.ships.find((s) => s.shipId === shipId);
  if (!ship) return { ok: false, error: "That ship isn't in this formation." };
  const n = Math.trunc(count);
  if (!(n > 0)) return { ok: false, error: "Load at least one troop." };
  const cap = SHIP_TROOP_CAP[ship.class] ?? 0;
  const used = formationShipTroopCount(ship);
  if (used + n > cap) {
    return {
      ok: false,
      error: `That ${ship.class} carries ${cap} troops — ${cap - used} seats free.`,
    };
  }
  ship.troops[type] = (ship.troops[type] ?? 0) + n;
  return { ok: true };
}

/** Unload troops from one of the formation's ships (pure). */
export function unloadFormationShipTroops(
  f: Formation,
  shipId: string,
  type: TroopType,
  count: number,
): { ok: boolean; error?: string; unloaded?: number } {
  if (f.status !== "standby") return { ok: false, error: "That formation already deployed — no changes." };
  const ship = f.ships.find((s) => s.shipId === shipId);
  if (!ship) return { ok: false, error: "That ship isn't in this formation." };
  const n = Math.trunc(count);
  if (!(n > 0)) return { ok: false, error: "Unload at least one troop." };
  const have = ship.troops[type] ?? 0;
  const take = Math.min(have, n);
  if (take <= 0) return { ok: false, error: `No ${type} on that ship to unload.` };
  ship.troops[type] = have - take;
  if (ship.troops[type] === 0) delete ship.troops[type];
  return { ok: true, unloaded: take };
}

/** Flatten all ship troops into one by-type map (for raid handoff). */
export function formationTroopsByType(f: Formation): Partial<Record<TroopType, number>> {
  const out: Partial<Record<TroopType, number>> = {};
  for (const s of f.ships) {
    for (const [t, c] of Object.entries(s.troops) as [TroopType, number][]) {
      out[t] = (out[t] ?? 0) + (c ?? 0);
    }
  }
  return out;
}

// ============================================================================
// REVERB — the loadout's force-power rating (owner 2026-10-04).
//
// Every troop, ship, and piece of equipment contributes reverb, and the
// loadout shows a running total as the player adds items. The scale is the
// battle engine's own force-power scale (chorus-intel.ts: a loadout's reverb
// is directly comparable to a Chorus site's recommended reverb), so a
// player can judge before launch whether the force survives or gets stomped.
//
//   • troops: count × supply weight × troopPowerPerTroop (the engine's term;
//     v1 troop power differs ONLY by supply weight, so thunder counts double)
//   • ships: firepower + hull (raids.ts: same scale as troop power)
//   • equipment: the forge piece's own `power` (forge.ts: the same weighted
//     sum the battle engine uses for a kit — no conversion needed)
//
// Deterministic: same loadout → same number, forever.
// ============================================================================

/** Reverb contributed by `count` troops of one type. */
export function troopReverb(type: TroopType, count: number): number {
  const n = Math.max(0, Math.trunc(count) || 0);
  return n * supplyWeight(type) * BATTLES_CONFIG.troopPowerPerTroop;
}

/** Reverb contributed by one ship of a class (firepower + hull). */
export function shipReverb(shipClass: ShipClass): number {
  return (SHIP_FIREPOWER[shipClass] ?? 0) + (SHIP_HULL[shipClass] ?? 0);
}

/** Reverb contributed by equipped forge pieces (their own battle power). */
export function equipmentReverb(powers: (number | undefined)[]): number {
  return powers.reduce<number>((n, p) => n + Math.max(0, p ?? 0), 0);
}

/** The formation's total reverb: ships + troops + the hero's equipped gear.
 *  Pass the summed `power` of forge items equipped by the formation's hero
 *  leader as `equipmentPower` (state access lives with the caller). */
export function formationReverb(f: Formation, equipmentPower = 0): number {
  let r = equipmentReverb([equipmentPower]);
  for (const s of f.ships) {
    r += shipReverb(s.class);
    for (const [t, c] of Object.entries(s.troops) as [TroopType, number][]) {
      r += troopReverb(t, c ?? 0);
    }
  }
  return Math.round(r);
}

/** The strongest Chorus site grade a reverb rating can handle: the highest
 *  grade whose recommended reverb the rating meets or beats. Null = not
 *  even a Grade I site — bulk up before picking that fight. */
export function formationSiteReadiness(reverb: number): { grade: number; gradeLabel: string; siteName: string } | null {
  let best: { grade: number; gradeLabel: string; siteName: string } | null = null;
  for (const s of chorusSiteIntel()) {
    if (reverb >= s.recommendedReverb) {
      best = { grade: s.grade, gradeLabel: s.gradeLabel, siteName: s.siteName };
    }
  }
  return best;
}
