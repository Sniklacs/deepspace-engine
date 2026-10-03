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
  shipArtUrl,
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
  /** Donated stockpile (owner 2026-10-03): materials donated by members
   *  + tithe from raid/glean loot. Used to fund ship builds. */
  stockpile?: { supplies: number; alloys: number; raceMats: number };
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
export { SHIP_CLASSES, SHIP_COST, shipArtUrl, shipName, shipNeedsAlliance };
export type { ShipClass, JumpShip };

// ---------------------------------------------------------------------------
// Ordering & crewing (pure; the caller owns cost deduction, version touch,
// and cross-account sync). Added for the ship-factory build UI (owner
// 2026-10-03): Hans couldn't find any way to actually build ships.
// ---------------------------------------------------------------------------

/** Minimal payer shape for ship cost checks (structural — avoids GameState import). */
export interface ShipyardPayer {
  resources: { supplies: number; alloys: number; mats: Record<string, number> };
  race: string | null;
}

export interface ShipCostBlocker {
  kind: "supplies" | "raceMaterial" | "alloys";
  need: number;
  have: number;
}

/** First unaffordable cost component, or null when the payer can afford it. */
export function shipCostBlocker(payer: ShipyardPayer, shipClass: ShipClass): ShipCostBlocker | null {
  const cost = SHIP_COST[shipClass];
  const supplies = payer.resources.supplies ?? 0;
  if (supplies < cost.supplies) return { kind: "supplies", need: cost.supplies, have: supplies };
  const matHave = payer.race ? (payer.resources.mats[payer.race] ?? 0) : 0;
  if (matHave < cost.raceMaterial) return { kind: "raceMaterial", need: cost.raceMaterial, have: matHave };
  const alloys = payer.resources.alloys ?? 0;
  if (alloys < cost.alloys) return { kind: "alloys", need: cost.alloys, have: alloys };
  return null;
}

/** Deduct the ship cost. Caller must check shipCostBlocker first. */
export function payShipCost(payer: ShipyardPayer, shipClass: ShipClass): void {
  const cost = SHIP_COST[shipClass];
  payer.resources.supplies = Math.max(0, (payer.resources.supplies ?? 0) - cost.supplies);
  if (payer.race) {
    const m = payer.resources.mats;
    m[payer.race] = Math.max(0, (m[payer.race] ?? 0) - cost.raceMaterial);
  }
  payer.resources.alloys = Math.max(0, (payer.resources.alloys ?? 0) - cost.alloys);
}

/** Minimal alliance shape for shipyard mutations (structural — avoids import cycle). */
export interface ShipyardAlliance extends AllianceLike {
  id: string;
  members: { colonyId: string }[];
}

/**
 * Order a warship on the alliance factory. Pure — the caller deducts the
 * cost, bumps the version (touchAlliance), and fans out (syncAllianceTo).
 * The orderer is automatically first on the crew.
 */
export function orderAllianceShip(
  a: ShipyardAlliance,
  opts: { shipClass: ShipClass; raceId: RaceId; orderedBy: string; orderedByName: string; now: number },
): { ok: boolean; error?: string; build?: ShipBuild } {
  if (!shipNeedsAlliance(opts.shipClass)) {
    return { ok: false, error: "Scouts are built in your personal shipyard — no alliance needed." };
  }
  if (!a.members.some((m) => m.colonyId === opts.orderedBy)) {
    return { ok: false, error: "Only war band members can order warships." };
  }
  const sy = ensureShipyard(a);
  const build = createShipBuild(opts.shipClass, opts.raceId, opts.orderedBy, opts.orderedByName, 0, sy.level, opts.now);
  build.contributors.push(opts.orderedBy);
  recalcBuildDoneAt(build, sy.level, opts.now);
  sy.queue.push(build);
  sy.seq += 1;
  return { ok: true, build };
}

/**
 * Join a build's crew — more contributors, faster build. Pure; the caller
 * touches the version and fans out. Crewing is free (crew time, not resources).
 */
export function contributeAllianceShip(
  a: ShipyardAlliance,
  buildId: string,
  colonyId: string,
  now: number,
): { ok: boolean; error?: string } {
  if (!a.members.some((m) => m.colonyId === colonyId)) {
    return { ok: false, error: "Only war band members can crew the factory." };
  }
  const sy = ensureShipyard(a);
  const build = sy.queue.find((b) => b.id === buildId);
  if (!build) return { ok: false, error: "That build already finished." };
  if (buildReady(build, now)) return { ok: false, error: "That ship is already done." };
  if (build.contributors.includes(colonyId)) return { ok: false, error: "You're already on this crew." };
  build.contributors.push(colonyId);
  recalcBuildDoneAt(build, sy.level, now);
  return { ok: true };
}

/** Ensure the personal shipyard record on a world map (solo scout builds). */
export function ensurePersonalShipyard(wm: { shipyard?: PersonalShipyard }): PersonalShipyard {
  if (!wm.shipyard) wm.shipyard = emptyPersonalShipyard();
  const psy = wm.shipyard;
  if (!Array.isArray(psy.queue)) psy.queue = [];
  if (!Array.isArray(psy.ships)) psy.ships = [];
  if (typeof psy.seq !== "number") psy.seq = 1;
  return psy;
}

/** Ensure the stockpile exists on a shipyard state. */
export function ensureStockpile(sy: ShipyardState): { supplies: number; alloys: number; raceMats: number } {
  if (!sy.stockpile) sy.stockpile = { supplies: 0, alloys: 0, raceMats: 0 };
  return sy.stockpile;
}

/**
 * Donate materials to the alliance shipyard stockpile (owner 2026-10-03).
 * Pure — the caller deducts from the donor and touches the alliance version.
 */
export function donateToShipyard(
  a: ShipyardAlliance,
  donor: { supplies: number; alloys: number; raceMats: number },
): { ok: boolean; error?: string } {
  if (donor.supplies < 0 || donor.alloys < 0 || donor.raceMats < 0) {
    return { ok: false, error: "Can't donate negative amounts." };
  }
  if (donor.supplies === 0 && donor.alloys === 0 && donor.raceMats === 0) {
    return { ok: false, error: "Donate something — supplies, alloys, or race materials." };
  }
  const sy = ensureShipyard(a);
  const sp = ensureStockpile(sy);
  sp.supplies += donor.supplies;
  sp.alloys += donor.alloys;
  sp.raceMats += donor.raceMats;
  return { ok: true };
}

/**
 * Apply the alliance tithe to incoming loot (owner 2026-10-03).
 * Returns the tithed amounts (to add to shipyard stockpile) and the remainder (for the player).
 * Pure — the caller moves the amounts.
 */
export function applyTithe(
  titheRate: number | undefined,
  loot: { supplies: number; alloys: number; raceMats: number },
): { tithed: { supplies: number; alloys: number; raceMats: number }; kept: { supplies: number; alloys: number; raceMats: number } } {
  const rate = Math.max(0, Math.min(100, titheRate ?? 0)) / 100;
  if (rate <= 0) {
    return { tithed: { supplies: 0, alloys: 0, raceMats: 0 }, kept: { ...loot } };
  }
  const tithed = {
    supplies: Math.floor(loot.supplies * rate),
    alloys: Math.floor(loot.alloys * rate),
    raceMats: Math.floor(loot.raceMats * rate),
  };
  return {
    tithed,
    kept: {
      supplies: loot.supplies - tithed.supplies,
      alloys: loot.alloys - tithed.alloys,
      raceMats: loot.raceMats - tithed.raceMats,
    },
  };
}
