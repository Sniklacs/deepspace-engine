// hive-relocation.ts — HIVE RELOCATION (Hans, Oct 4 2026, Globe Wave 2 WS-E).
//
// "How hard would it be to move the colony to a hive set point on the
// globe?" — v1: the player picks a point on the globe, pays the hive kit +
// a distance-scaled jump charge, and the home colony marker moves there.
//
// Pure data + pure functions. No UI, no clock, no I/O. The server fn in
// api.ts (relocateColonyFn) validates through this module and persists;
// the pick-mode UI lives in components/WorldGlobe.tsx.
//
// Rules (owner-locked):
//   - COST: flat 500 supplies (the hive kit) + a jump charge scaled by the
//     angular distance of the move, paid in fuel (resources.gas). Concrete
//     v1 numbers below — all tunable.
//   - COOLDOWN: 7 days between relocations (lastHiveMoveAt stamp).
//   - ANTI-ABUSE: no relocation while any incoming raid is unresolved
//     (under attack) or while any own raid party is away from home.
//   - DESTINATION: ≥4° great-circle from any other known colony marker
//     (declutter spirit — never land on a neighbor); |lat| ≤ 78, clamped
//     like the existing hash positions.

import type { GameState } from "./types";
import { ensureWorldMap, colonyMarkerName } from "./worldmap";
import {
  colonyGlobePosition,
  currentHomeGlobePosition,
  greatCircleDeg,
  GLOBE_KM_PER_DEGREE,
} from "./globe-layers";
import { allianceOf } from "./war/alliances";
import type { RaidStatus } from "./raids";

/** 7 days between relocations — the hive kit needs time to recharge. */
export const HIVE_MOVE_COOLDOWN_MS = 7 * 24 * 3600_000;

/** Flat supplies fee per move — the hive kit itself. v1 number, tunable. */
export const HIVE_MOVE_SUPPLIES_FLAT = 500;

/** Jump charge per degree of angular distance, in fuel (resources.gas).
 *  1.5/deg: a half-globe (180°) move burns 270 fuel — expensive enough to
 *  make the destination a real decision, not ruinous for a late colony.
 *  v1 number, tunable. */
export const HIVE_MOVE_FUEL_PER_DEGREE = 1.5;

/** Minimum great-circle separation from any other known colony marker.
 *  Declutter spirit: the home icon must never land on a neighbor's. */
export const HIVE_MIN_SEPARATION_DEG = 4;

/** |lat| ≤ 78 — the same pole clamp colonyGlobePosition uses. Candidates
 *  are clamped (not rejected): the point lands where the tap resolves. */
export const HIVE_MAX_LAT = 78;

/** Below this the move is a no-op — the player is already there. Reject
 *  with an honest message instead of charging for nothing. */
export const HIVE_MIN_MOVE_DEG = 0.5;

/** Raid statuses that keep a party off-home. The spec names in_transit and
 *  landed; the deploying / tactical / returning legs are equally committed
 *  (troops and ships not at home), so v1 blocks the whole away set. */
export const HIVE_BLOCKING_RAID_STATUSES: ReadonlySet<RaidStatus> = new Set([
  "in_transit",
  "deploying",
  "tactical",
  "landed",
  "returning",
]);

/** Clamp a hive candidate exactly like the existing globe code clamps
 *  generated positions: |lat| ≤ 78, lon wrapped to [-180, 180]. */
export function clampHiveCandidate(c: { lat: number; lon: number }): { lat: number; lon: number } {
  return {
    lat: Math.max(-HIVE_MAX_LAT, Math.min(HIVE_MAX_LAT, c.lat)),
    lon: ((c.lon + 540) % 360) - 180,
  };
}

export interface HiveMoveCost {
  /** Great-circle distance of the move, degrees. */
  distanceDeg: number;
  /** v1 flavor distance (GLOBE_KM_PER_DEGREE scale). */
  distanceKm: number;
  /** Flat supplies fee (HIVE_MOVE_SUPPLIES_FLAT). */
  supplies: number;
  /** Distance-scaled jump charge, in fuel. */
  fuel: number;
}

/** Cost of moving from `from` to `to`. */
export function hiveMoveCost(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): HiveMoveCost {
  const distanceDeg = greatCircleDeg(from.lat, from.lon, to.lat, to.lon);
  return {
    distanceDeg,
    distanceKm: distanceDeg * GLOBE_KM_PER_DEGREE,
    supplies: HIVE_MOVE_SUPPLIES_FLAT,
    fuel: Math.max(1, Math.ceil(distanceDeg * HIVE_MOVE_FUEL_PER_DEGREE)),
  };
}

/** Ms until the player may relocate again (0 when the kit is ready). */
export function hiveMoveCooldownRemainingMs(
  wm: { lastHiveMoveAt?: number },
  now: number,
): number {
  const last = wm.lastHiveMoveAt ?? 0;
  if (!last) return 0;
  return Math.max(0, HIVE_MOVE_COOLDOWN_MS - (now - last));
}

/** "2d 5h" / "7h 12m" / "45m" — for the cooldown inline message. */
export function formatHiveDuration(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** State-level blockers that don't need a destination yet: cooldown, being
 *  under attack, parties away. The home sheet shows these inline when the
 *  player taps "Relocate to hive"; full validation runs on confirm. */
export function hiveMoveBlockers(state: GameState, now: number): string[] {
  const out: string[] = [];
  const wm = state.worldMap;
  if (!wm) return out;
  const rem = hiveMoveCooldownRemainingMs(wm, now);
  if (rem > 0) {
    out.push(`The hive kit is recharging — your next relocation is ready in ${formatHiveDuration(rem)}.`);
  }
  const unresolved = (wm.incomingRaids ?? []).filter((r) => !r.resolved);
  if (unresolved.length > 0) {
    out.push(
      unresolved.length === 1
        ? "You're under attack — an incoming raid is still unresolved. Fight it off first."
        : `You're under attack — ${unresolved.length} incoming raids are still unresolved. Fight them off first.`,
    );
  }
  const away = (wm.raids ?? []).filter((r) => HIVE_BLOCKING_RAID_STATUSES.has(r.status));
  if (away.length > 0) {
    out.push(
      away.length === 1
        ? `A raid party is away from home (${away[0].status.replace(/_/g, " ")}) — relocation waits until it returns.`
        : `${away.length} raid parties are away from home — relocation waits until they return.`,
    );
  }
  return out;
}

export interface HiveMoveValidation {
  ok: boolean;
  error?: string;
  /** Set when ok — the clamped destination's cost. */
  cost?: HiveMoveCost;
  /** Set when ok — great-circle degrees from the current home position. */
  distanceDeg?: number;
}

/** Full validation for one hive move. Every failure names the blocker (and,
 *  where it helps, what fixes it) — Hans's UI rule: never a dead button. */
export function validateHiveMove(
  state: GameState,
  candidate: { lat: number; lon: number },
  now: number,
): HiveMoveValidation {
  const wm = ensureWorldMap(state, now);
  const dest = clampHiveCandidate(candidate);

  // State-level blockers first — they name the real problem.
  const blockers = hiveMoveBlockers(state, now);
  if (blockers.length > 0) return { ok: false, error: blockers[0] };

  const from = currentHomeGlobePosition(state);
  const cost = hiveMoveCost(from, dest);
  if (cost.distanceDeg < HIVE_MIN_MOVE_DEG) {
    return { ok: false, error: "That's where your colony already is — pick a new point on the globe." };
  }

  // Destination validity: ≥4° from every other known colony marker.
  const known = Object.values(wm.known ?? {});
  for (const c of known) {
    const pos = colonyGlobePosition(`${c.serverId}:${c.id}`);
    const d = greatCircleDeg(dest.lat, dest.lon, pos.lat, pos.lon);
    if (d < HIVE_MIN_SEPARATION_DEG) {
      return {
        ok: false,
        error: `Too close to ${colonyMarkerName(c.ownerName)} — only ${d.toFixed(1)}° away. Pick a point at least ${HIVE_MIN_SEPARATION_DEG}° from any other colony.`,
      };
    }
  }

  // Affordability — checked last so the message is about resources, not rules.
  const supplies = state.resources.supplies ?? 0;
  if (supplies < cost.supplies) {
    return {
      ok: false,
      error: `The hive kit costs ${cost.supplies} supplies — you hold ${Math.floor(supplies)}.`,
    };
  }
  const fuel = state.resources.gas ?? 0;
  if (fuel < cost.fuel) {
    return {
      ok: false,
      error: `The jump needs ${cost.fuel} fuel for ${cost.distanceDeg.toFixed(1)}° — you hold ${Math.floor(fuel)}.`,
    };
  }

  return { ok: true, cost, distanceDeg: cost.distanceDeg };
}

/** Apply a validated move: deduct the real cost, set the override and the
 *  cooldown stamp. Callers MUST validate first — this trusts the cost. */
export function applyHiveMove(
  state: GameState,
  cost: HiveMoveCost,
  candidate: { lat: number; lon: number },
  now: number,
): void {
  const wm = ensureWorldMap(state, now);
  const dest = clampHiveCandidate(candidate);
  state.resources.supplies = Math.max(0, (state.resources.supplies ?? 0) - cost.supplies);
  state.resources.gas = Math.max(0, (state.resources.gas ?? 0) - cost.fuel);
  wm.homeGlobeOverride = { lat: dest.lat, lon: dest.lon };
  wm.lastHiveMoveAt = now;
}

// ---------------------------------------------------------------------------
// Defense-response delta (v1 flavor)
// ---------------------------------------------------------------------------

export interface AlliedColonyPin {
  ownerName: string;
  lat: number;
  lon: number;
}

/** Known colonies that belong to the player's own alliance. v1 best-effort:
 *  known colonies carry owner names (not alliance ids), so members match by
 *  colony name; the player's own colony is excluded. Pure. */
export function alliedKnownColonies(state: GameState): AlliedColonyPin[] {
  const me = state.gameId ?? "";
  const a = allianceOf(state, me);
  if (!a) return [];
  const wm = state.worldMap;
  if (!wm) return [];
  const myName = state.playerName ?? "";
  const pins: AlliedColonyPin[] = [];
  for (const m of a.members) {
    if (m.colonyId === me) continue;
    for (const c of Object.values(wm.known)) {
      if (c.ownerName === m.colonyName && c.ownerName !== myName) {
        const pos = colonyGlobePosition(`${c.serverId}:${c.id}`);
        pins.push({ ownerName: c.ownerName, lat: pos.lat, lon: pos.lon });
        break;
      }
    }
  }
  return pins;
}

/** Mean great-circle distance in km from `at` to each ally pin. The v1
 *  "defense response" feel: a shorter mean distance means the war band can
 *  muster to your hive faster. Flavor only — real muster math is future. */
export function meanAllyDistanceKm(
  allies: { lat: number; lon: number }[],
  at: { lat: number; lon: number },
): number {
  if (allies.length === 0) return 0;
  let sum = 0;
  for (const p of allies) sum += greatCircleDeg(at.lat, at.lon, p.lat, p.lon);
  return (sum / allies.length) * GLOBE_KM_PER_DEGREE;
}
