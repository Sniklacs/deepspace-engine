// ORBITAL WATCH / SATELLITES (design/satellites.md — authoritative build doc).
//
// The sky is broken, and fixing it is how you stop being ambushed. Every
// contestable node (the Burning Rim T1/T2/T3 + the Chorus-held heart) sits
// under a satellite footprint. Near Ring + Cradle are sanctioned land —
// nothing to watch, no dishes there.
//
// LOCKED PRINCIPLES (spec §0):
//   1. Detection is earned, never default.
//   2. Blind spots are real geography — arrivals on blind nodes are
//      mechanically invisible (no alarm, no ping, no report).
//   3. Restoration is one by one, NEVER ACCELERABLE — no store skip, no
//      time tokens, no speedup. Each satellite comes online individually,
//      on research time.
//   4. The sky resets every season: ~50% functional, RANDOMIZED per world
//      per season. The roll is SEEDED (worldId + seasonId) so the coverage
//      map is PUBLIC GEOGRAPHY — identical for every player, both sides
//      read the same sky.
//   5. Coverage is per-node, not global.
//
// PURE module except the state helpers (ensure/set), which mutate the
// passed GameState the same way the rest of the engine does. ZERO
// Math.random — the constellation roll is seeded.
// ----------------------------------------------------------------------------
import type { GameState } from "./types";
import type { IncomingRaidAlert, RaidAlarm } from "./raid-protocol";
import type { ShipClass } from "./worldmap";
import { hashSeed, mulberry32, generateAtlas, nodeById } from "./map";
import { WORLD_CONFIG_PUBLIC } from "./world-config";

/** 0 = dormant (blind) · 1 = online · 2 = tracking · 3 = full picture. */
export type SatelliteStage = 0 | 1 | 2 | 3;

export interface SatelliteTech {
  id: string;
  nodeId: string;
  /** The stage this research CLIMBS TO (1, 2 or 3). */
  stage: 1 | 2 | 3;
  icon: string;
  codicesCost: number;
  durationMs: number; // base real-time duration (research attr / Scholar scale it)
}

// ---- the constellation roll -------------------------------------------------
const ROLL_SALT = "satellite:v1:";
/** Fraction of the constellation that wakes functional at season start. */
export const SEASON_WAKE_FRACTION = 0.5;

/** Covered node ids for a world: contestable ground only (rim + heart).
 *  Near ring and the Cradle are sanctioned — no dishes. Derived from the
 *  atlas so any world's geography works; the live world's set is stable. */
export function coveredNodeIds(worldId: string = WORLD_CONFIG_PUBLIC.worldId, raceId: string | null = WORLD_CONFIG_PUBLIC.raceLock): string[] {
  const atlas = generateAtlas({ worldId, raceId });
  return atlas.nodes
    .filter((n) => n.kind === "rim" || n.kind === "heart")
    .map((n) => n.id);
}

/** Node display name for a covered node id (published catalog name). */
export function coveredNodeName(nodeId: string, worldId: string = WORLD_CONFIG_PUBLIC.worldId, raceId: string | null = WORLD_CONFIG_PUBLIC.raceLock): string {
  const atlas = generateAtlas({ worldId, raceId });
  const n = nodeById(atlas, nodeId);
  return n ? n.name : nodeId;
}

/** Seeded season roll: ~50% of covered nodes wake at stage 1, the rest
 *  dormant. Deterministic per world+season — public geography, every
 *  player reads the same sky. */
export function rollConstellation(worldId: string, seasonId: string, nodeIds: string[]): Record<string, SatelliteStage> {
  const rng = mulberry32(hashSeed(`${ROLL_SALT}${worldId}:${seasonId}`));
  const stages: Record<string, SatelliteStage> = {};
  // Shuffle-then-cut keeps the count close to 50% on every world instead of
  // letting 18 independent coins drift to 30/70.
  const order = [...nodeIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const wake = Math.round(order.length * SEASON_WAKE_FRACTION);
  for (const id of nodeIds) stages[id] = 0;
  for (let i = 0; i < wake; i++) stages[order[i]] = 1;
  return stages;
}

// ---- state ------------------------------------------------------------------
export interface SatelliteState {
  seasonId: string;
  stages: Record<string, SatelliteStage>;
  /** Completed satellite tech ids this season (bookkeeping — NOT techsResearched,
   *  so the sky never inflates the contribution/research counts). */
  restored: string[];
}

/** Fresh constellation for a season (used at colony founding + migration). */
export function freshSatellites(worldId: string, seasonId: string): SatelliteState {
  const ids = coveredNodeIds(worldId);
  return { seasonId, stages: rollConstellation(worldId, seasonId, ids), restored: [] };
}

/** Lazy init + season rollover. Called from advance(): when the season id
 *  moved, the sky resets — last season's coverage map is worthless. */
export function ensureSatellites(state: GameState, log?: (msg: string) => void): void {
  const worldId = WORLD_CONFIG_PUBLIC.worldId;
  const cur = state.satellites;
  if (!cur || !cur.stages || cur.seasonId !== state.seasonId) {
    const fresh = freshSatellites(worldId, state.seasonId);
    state.satellites = fresh;
    if (cur && cur.seasonId !== state.seasonId) {
      log?.(`🛰️ Season ${state.seasonId}: the constellation resets — the sky goes half-blind again. Last season's coverage map is worthless.`);
    }
    return;
  }
  // Backfill: a covered node the roll never saw (atlas drift) reads dormant.
  for (const id of coveredNodeIds(worldId)) {
    if (!(id in cur.stages)) cur.stages[id] = 0;
  }
  if (!Array.isArray(cur.restored)) cur.restored = [];
}

/** Current stage for a node (0 dormant … 3 full picture). Uncovered
 *  (near/cradle) and unknown nodes read null — no satellite there. */
/** The current stage of a node's satellite. Uncovered ground (sanctioned
 *  land) reads as 0 — there is no dish there. */
export function satelliteStage(state: GameState, nodeId: string): SatelliteStage {
  const s = state.satellites?.stages?.[nodeId];
  return typeof s === "number" ? (s as SatelliteStage) : 0;
}

export function setSatelliteStage(state: GameState, nodeId: string, stage: SatelliteStage): void {
  ensureSatellites(state);
  state.satellites!.stages[nodeId] = stage;
}

// ---- the research track -------------------------------------------------------
// One satellite climbs 0 → 1 → 2 → 3 through individual research jobs.
// Tech id: `sat-<nodeId>-s<stage>` (e.g. `sat-forge-valleys-s1`).
export const SAT_TECH_PREFIX = "sat-";

export function isSatelliteTech(techId: string): boolean {
  return techId.startsWith(SAT_TECH_PREFIX) && parseSatelliteTech(techId) !== null;
}

export function parseSatelliteTech(techId: string): { nodeId: string; stage: 1 | 2 | 3 } | null {
  const m = /^sat-(.+)-s([123])$/.exec(techId);
  if (!m) return null;
  return { nodeId: m[1], stage: Number(m[2]) as 1 | 2 | 3 };
}

export function satelliteTechId(nodeId: string, stage: 1 | 2 | 3): string {
  return `sat-${nodeId}-s${stage}`;
}

/** Beta-range research pricing per climb: bring online, then track, then the
 *  full picture. NEVER accelerable — no time-token path may touch these jobs. */
const SAT_STAGE_COST: Record<1 | 2 | 3, { codices: number; durationMs: number }> = {
  1: { codices: 4, durationMs: 60_000 },
  2: { codices: 8, durationMs: 120_000 },
  3: { codices: 15, durationMs: 240_000 },
};

export function satelliteTechFor(nodeId: string, stage: 1 | 2 | 3): SatelliteTech {
  const cost = SAT_STAGE_COST[stage];
  return {
    id: satelliteTechId(nodeId, stage),
    nodeId,
    stage,
    icon: "🛰️",
    codicesCost: cost.codices,
    durationMs: cost.durationMs,
  };
}

/** The next climb available for a node (null when it is already at stage 3). */
export function nextSatelliteTech(state: GameState, nodeId: string): SatelliteTech | null {
  const cur = satelliteStage(state, nodeId);
  if (cur === null || cur >= 3) return null;
  return satelliteTechFor(nodeId, (cur + 1) as 1 | 2 | 3);
}

// NOTE — research DURATION for a satellite climb lives in engine.ts next to
// researchDurationMs (it needs engine-private helpers; this module stays
// pure so engine can import it without a cycle).

// ---- intel — what each stage reveals -------------------------------------------
// The alarm contract (spec §2): a foreign arrival on a WATCHED node sounds
// the alarm; on a BLIND node there is nothing — no alarm, no ping, no feed
// entry. Foreign-presence data does not exist in game state yet (the
// Who's-Here card is still an empty-state), so the trigger is wired when the
// presence/war layer lands — this table is what the alarm consults.
/** The reveal level of a node's satellite — what the alarm/report may say
 *  about a foreign arrival. "none" = blind: no alarm, no ping. */
export type SatelliteIntel = "none" | "presence" | "identity" | "full";

/** What a node's satellite currently reveals about a foreign arrival. */
export function satelliteIntelFor(state: GameState, nodeId: string): SatelliteIntel {
  const stage = satelliteStage(state, nodeId);
  return stage === 0 ? "none" : stage === 1 ? "presence" : stage === 2 ? "identity" : "full";
}

// ---- colony ground — which node a colony sits on --------------------------------
// Raids head for colonies; satellites watch nodes. Every colony stands on one
// covered (rim/heart) node — assigned at founding, backfilled deterministically
// for older saves (stable: hash of gameId, so every load agrees).

/** Deterministic node for a colony id (no stored state needed). */
export function nodeForColonyId(colonyId: string, worldId: string = WORLD_CONFIG_PUBLIC.worldId, raceId: string | null = WORLD_CONFIG_PUBLIC.raceLock): string {
  const ids = coveredNodeIds(worldId, raceId);
  if (ids.length === 0) return "rim-1";
  const rng = mulberry32(hashSeed(`colony-node:v1:${worldId}:${colonyId}`));
  return ids[Math.floor(rng() * ids.length)];
}

/** The node this colony stands on. Backfills homeNodeId on old saves. */
export function colonyNodeId(state: GameState): string {
  if (typeof state.homeNodeId === "string" && state.homeNodeId) {
    return state.homeNodeId;
  }
  const id = state.gameId || state.playerName || "colony";
  const nodeId = nodeForColonyId(id);
  state.homeNodeId = nodeId;
  return nodeId;
}

// ---- the raid alarm ------------------------------------------------------------
// Satellite-only detection (owner 2026-10-03): an incoming raid heading for
// this colony's node fires the klaxon iff the node's satellite sits at
// stage >= 1. Stage 0 = blind: no alarm, no ping, nothing.
//
// Detail is stage-gated (owner refinement 2026-10-03):
//   stage 1: "UNIDENTIFIED SIGNATURE" + node name. Nothing else.
//   stage 2: + identity (attacker names/world) + PARTIAL ship classes
//            (50–70% of classes present, randomly picked, never 100%).
//   stage 3: + every ship class + troop count.

/** Deterministic partial ship-class reveal for stage-2 intel. Picks 50–70%
 *  of the distinct classes present (seeded by raidId — stable across loads
 *  and identical for every alliance member). Never reveals all classes when
 *  more than one is present; a lone class is shown (the count stays hidden). */
export function partialShipIntel(shipClasses: ShipClass[] | undefined, raidId: string): ShipClass[] {
  const uniq: ShipClass[] = [];
  for (const c of shipClasses ?? []) if (!uniq.includes(c)) uniq.push(c);
  if (uniq.length === 0) return [];
  if (uniq.length === 1) return uniq;
  const rng = mulberry32(hashSeed(`raid-intel:v1:${raidId}`));
  // Shuffle deterministically, then reveal 50–70% (at least 1, never all).
  const order = [...uniq];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const frac = 0.5 + rng() * 0.2; // 50–70%
  const n = Math.max(1, Math.min(order.length - 1, Math.round(order.length * frac)));
  return order.slice(0, n);
}

/** Build the raid alarm for an incoming raid, or null when blind
 *  (stage 0) or the raid already fired / resolved. Pure w.r.t. the alarm —
 *  callers persist the result and mark the raid alarmed. */
export function checkRaidAlarm(state: GameState, raid: IncomingRaidAlert, now: number): RaidAlarm | null {
  if (!raid || raid.alarmFired || raid.resolved) return null;
  if (typeof raid.landsAt === "number" && raid.landsAt <= now) return null; // already down
  const nodeId = colonyNodeId(state);
  const intel = satelliteIntelFor(state, nodeId);
  if (intel === "none") return null; // blind is blind
  const alarm: RaidAlarm = {
    raidId: raid.raidId,
    nodeId,
    nodeName: coveredNodeName(nodeId),
    intel,
    targetColonyId: raid.targetColonyId,
    targetOwnerName: raid.targetOwnerName ?? "",
    landsAt: raid.landsAt,
    launchedAt: raid.launchedAt,
    triggeredAt: now,
  };
  if (intel === "identity" || intel === "full") {
    alarm.attackerWorldName = raid.attackerWorldName;
    alarm.attackerNames = [...(raid.attackerNames ?? [])];
  }
  if (intel === "identity") {
    const revealed = partialShipIntel(raid.shipClasses, raid.raidId);
    if (revealed.length > 0) alarm.revealedShipClasses = revealed;
    const total = new Set(raid.shipClasses ?? []).size;
    alarm.shipsPartial = total > revealed.length;
  }
  if (intel === "full") {
    const all: ShipClass[] = [];
    for (const c of raid.shipClasses ?? []) if (!all.includes(c)) all.push(c);
    if (all.length > 0) alarm.revealedShipClasses = all;
    alarm.shipsPartial = false;
    alarm.shipCount = raid.shipCount;
    alarm.troopCount = raid.troopCount;
  }
  return alarm;
}

/** Tick/load sweep: fire alarms for incoming raids the satellite now sees.
 *  Covers raids that arrived while blind and later came under watch (a dish
 *  brought online before touchdown), plus any receipt the server path missed.
 *  Idempotent — alarmed raids are marked and never re-fire. Also clears a
 *  live alarm whose raid has landed or resolved.
 *  Returns the newly-fired alarm (for alliance broadcast), if any. */
export function sweepRaidAlarms(state: GameState, now: number): RaidAlarm | null {
  const wm = state.worldMap;
  const raids: IncomingRaidAlert[] | undefined = wm?.incomingRaids ?? (state as any).incomingRaids;
  // Expire a live alarm whose raid is done.
  const live = state.raidAlarm;
  if (live) {
    const rec = raids?.find((r) => r.raidId === live.raidId);
    const done = !rec || rec.resolved || (typeof rec.landsAt === "number" && rec.landsAt <= now);
    if (done) state.raidAlarm = null;
  }
  if (state.raidAlarm || !Array.isArray(raids)) return null; // one klaxon at a time
  for (const r of raids) {
    if (r.alarmFired || r.resolved) continue;
    const alarm = checkRaidAlarm(state, r, now);
    if (alarm) {
      state.raidAlarm = alarm;
      r.alarmFired = true;
      return alarm;
    }
  }
  return null;
}
