// SHIPYARD — the alliance ship factory (design/abandoned-colonies-world-map.md).
//
// Warships (everything except scouts) are built through the alliance ship
// factory. Build speed scales with active contributors: a dead alliance builds
// slow, a live one builds fast. Scouts are solo-buildable and use the same
// queue shape on a personal shipyard.
//
// Server-shaped records (keyed by alliance id) so a future multiplayer server
// migration is mechanical.
//
// NOTE: To avoid import cycles, the ShipyardState/PersonalShipyard interfaces
// live here, but worldmap.ts and alliances.ts define their fields with
// structural inline types (not imports). The functions below operate on the
// canonical interfaces defined here.

import type { RaceId } from "./types";
import {
  SHIP_BUILD_MS,
  SHIP_CLASSES,
  SHIP_COST,
  shipName,
  shipNeedsAlliance,
  type JumpShip,
  type ShipClass,
} from "./worldmap";

/** A ship currently under construction. */
export interface ShipBuild {
  id: string;
  shipClass: ShipClass;
  /** Race of the alliance (drives the race-specific ship name). */
  raceId: RaceId;
  startedAt: number;
  /** When the build completes (recalculated when contributors join). */
  doneAt: number;
  /** Colony IDs of contributors. Each contributor speeds the build. */
  contributors: string[];
  /** Who ordered the build (colony id). */
  orderedBy: string;
  orderedByName: string;
}

/** The alliance ship factory state. Lives on the Alliance record. */
export interface ShipyardState {
  /** Factory level. Higher level = faster base builds. Tunable. */
  level: number;
  /** Ships currently under construction. */
  queue: ShipBuild[];
  /** Completed ships owned by the alliance (assigned to members). */
  ships: JumpShip[];
  /** Monotonic counter for build id generation. */
  seq: number;
}

/** A personal shipyard for solo scout builds (lives on worldMap). */
export interface PersonalShipyard {
  queue: ShipBuild[];
  ships: JumpShip[];
  seq: number;
}

export function emptyShipyard(): ShipyardState {
  return { level: 1, queue: [], ships: [], seq: 1 };
}

export function emptyPersonalShipyard(): PersonalShipyard {
  return { queue: [], ships: [], seq: 1 };
}

/** Build duration in ms. More contributors = faster.
 *  Formula: base / (1 + contributors * 0.1) / (1 + (level - 1) * 0.15)
 *  - 0 contributors: full base time (dead alliance builds slow)
 *  - 10 contributors: ~half time
 *  - 20 contributors: ~third time
 *  Higher factory level also speeds builds. */
export function shipBuildDurationMs(
  shipClass: ShipClass,
  contributorCount: number,
  level = 1,
): number {
  const base = SHIP_BUILD_MS[shipClass];
  const contribFactor = 1 + contributorCount * 0.1;
  const levelFactor = 1 + (level - 1) * 0.15;
  return Math.max(60_000, Math.round(base / contribFactor / levelFactor));
}

/** Minimal Alliance shape for shipyard operations (avoids import cycle). */
export interface AllianceLike {
  shipyard?: ShipyardState;
}

/** Ensure the alliance has a shipyard (backfill for old saves). */
export function ensureShipyard(a: AllianceLike): ShipyardState {
  const rec = a as unknown as Record<string, unknown>;
  if (!rec.shipyard || typeof rec.shipyard !== "object") {
    rec.shipyard = emptyShipyard();
  }
  const sy = rec.shipyard as ShipyardState;
  if (typeof sy.level !== "number") sy.level = 1;
  if (!Array.isArray(sy.queue)) sy.queue = [];
  if (!Array.isArray(sy.ships)) sy.ships = [];
  if (typeof sy.seq !== "number") sy.seq = 1;
  return sy;
}

let shipBuildSeq = 0;
function newBuildId(now: number): string {
  shipBuildSeq += 1;
  return `sb-${now.toString(36)}-${shipBuildSeq.toString(36)}`;
}

let shipSeq = 0;
function newShipId(now: number): string {
  shipSeq += 1;
  return `ship-${now.toString(36)}-${shipSeq.toString(36)}`;
}

/** Create a ShipBuild record. Pure — the caller handles cost deduction. */
export function createShipBuild(
  shipClass: ShipClass,
  raceId: RaceId,
  orderedBy: string,
  orderedByName: string,
  contributorCount: number,
  level: number,
  now: number,
): ShipBuild {
  const duration = shipBuildDurationMs(shipClass, contributorCount, level);
  return {
    id: newBuildId(now),
    shipClass,
    raceId,
    startedAt: now,
    doneAt: now + duration,
    contributors: [],
    orderedBy,
    orderedByName,
  };
}

/** Create a completed JumpShip from a finished build. */
export function shipFromBuild(build: ShipBuild, now: number): JumpShip {
  return {
    id: newShipId(now),
    class: build.shipClass,
    raceId: build.raceId,
    name: shipName(build.raceId, build.shipClass),
    status: "ready",
  };
}

/** Recalculate doneAt when a contributor joins. */
export function recalcBuildDoneAt(build: ShipBuild, level: number, now: number): void {
  const total = shipBuildDurationMs(build.shipClass, build.contributors.length, level);
  // Contributors only speed up — never extend. New doneAt is start + new total,
  // but clamped to not go below now+1min and never later than current doneAt.
  const newDoneAt = build.startedAt + total;
  build.doneAt = Math.min(build.doneAt, Math.max(now + 60_000, newDoneAt));
}

/** True if the build is complete. */
export function buildReady(build: ShipBuild, now: number): boolean {
  return now >= build.doneAt;
}

// Re-export for convenience
export { SHIP_CLASSES, SHIP_COST, shipName, shipNeedsAlliance };
export type { ShipClass, JumpShip };
