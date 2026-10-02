// worldmap.ts — ABANDONED COLONIES & THE WORLD MAP (design/abandoned-colonies-world-map.md).
//
// Pure data model + logic. No UI. The server is authoritative for other players'
// colonies; the client only knows what scouts and visits reveal.
//
// How the pieces fit:
//   - Abandonment is per-colony, server-tracked from last authenticated activity.
//     30 days of silence → abandoned: frozen, lootable, troops become mercenaries.
//   - The world map shows colonies by owner name. Visibility is gated behind
//     planetary scout probes: researched, built, one-time use, hours-long flight.
//     A probe returns a REPORT (player count vs colony count) — odds, not loot
//     guarantees. Landing reveals per-colony detail.
//   - Gleaning is an expedition (no battle). Loot is first-come-first-served;
//     abandoned troops become a MercenaryBand hireable with supplies (same pool
//     as deserters — one system, two sources).
//   - Cross-server travel costs the jump charge (fuel/supplies, never real money).
//     Active colonies are lootable-only in v1, with defender warnings.

import type { RaceId } from "./types";
import type { MercenaryBand } from "./war/troops";

/** 30 days of silence → abandoned. Hans: the first month has no gleaning so
 *  everybody gets a fair chance to grow (30d ≈ 1/3 of a 12-week season). */
export const ABANDON_MS = 30 * 24 * 3600_000;

/** How long a scout probe takes to fly out, scan, and return. */
export const SCOUT_DURATION_MS = 6 * 3600_000;

/** Research tech id that unlocks scout probes (lives in the research tree). */
export const SCOUT_TECH_ID = "scout-probes";

/** Supplies cost to BUILD one probe (one-time use). Tunable. */
export const SCOUT_PROBE_COST_SUPPLIES = 500;

/** Jump charge is fuel/supplies, never real money (forward-base.md §4). */
export const WORLD_JUMP_FUEL = 10;
export const WORLD_JUMP_SUPPLIES = 200;

export type ColonyStatus = "active" | "abandoned" | "husk";

/** Lootable stores of an abandoned colony. First-come-first-served; partial
 *  takes allowed (take what the convoy carries, leave the rest). Artifacts
 *  are NEVER in here — they only change hands in real PvP. */
export interface ColonyLoot {
  supplies: number;
  embers: number;
  fuel: number; // gas — vehicle fuel
  battery: number; // battery packs
  medkit: number; // medical kits
  mechkit: number; // mechanics kits
  armorkit: number; // armor kits
  hazmat: number; // hazmat suits
  shots: number; // radiation shots
}

export const EMPTY_LOOT: ColonyLoot = {
  supplies: 0,
  embers: 0,
  fuel: 0,
  battery: 0,
  medkit: 0,
  mechkit: 0,
  armorkit: 0,
  hazmat: 0,
  shots: 0,
};

/** A colony the player knows about (via scout report or visit). Lives on the
 *  world map as a marker: "<ownerName>'s Colony". */
export interface KnownColony {
  id: string; // colony id on its server
  serverId: string; // which world/server
  ownerName: string;
  race: RaceId;
  status: ColonyStatus;
  lastScouted: number; // epoch ms this intel was gathered (stale after a while)
  /** Approximate troop strength — only from an in-person visit, never a probe. */
  approxTroops?: number;
  /** Observed remaining loot (abandoned only; may be stale — no guarantees). */
  lootObserved?: ColonyLoot;
}

/** A scout probe in flight. One-time use: launched → returns → consumed. */
export interface ScoutProbe {
  id: string; // `probe-<seq>`
  targetServerId: string;
  launchedAt: number;
  returnsAt: number; // launchedAt + SCOUT_DURATION_MS
  status: "inflight" | "returned";
}

/** What a probe brings back: player count vs colony count. Odds, not promises —
 *  it never says whether colonies were already raided/gleaned. */
export interface ScoutReport {
  id: string; // `report-<probeId>`
  serverId: string;
  playerCount: number;
  colonyCount: number;
  abandonedCount: number; // subset of colonyCount
  receivedAt: number;
}

/** A gleaning expedition to an abandoned colony. No battle — no defenders. */
export interface GleanRun {
  id: string; // `glean-<seq>`
  colonyId: string;
  serverId: string;
  startedAt: number;
  durationMs: number;
  status: "out" | "complete";
  /** Filled on resolve: what the convoy actually took. */
  lootTaken?: ColonyLoot;
  /** Troops hired from the abandoned colony's mercenary band (with supplies). */
  mercenariesHired?: number;
}

/** Per-colony world-map state. Optional on GameState for migration. */
export interface WorldMapState {
  /** This colony's last authenticated activity (server authoritative; the
   *  client mirrors it for "abandons in Xd" UI). */
  lastActive: number;
  /** Built probes sitting in inventory, ready to launch. */
  probes: number;
  /** Probes currently flying. */
  inflight: ScoutProbe[];
  /** Latest report per serverId. */
  reports: Record<string, ScoutReport>;
  /** Colonies revealed by scouts/visits. Key: `${serverId}:${colonyId}`. */
  known: Record<string, KnownColony>;
  /** Gleaning expeditions in flight. */
  gleanRuns: GleanRun[];
  /** ServerIds this colony has visited (travel history). */
  visited: string[];
  /** Monotonic counters for id generation. */
  seq: number;
}

export function emptyWorldMap(now: number): WorldMapState {
  return {
    lastActive: now,
    probes: 0,
    inflight: [],
    reports: {},
    known: {},
    gleanRuns: [],
    visited: [],
    seq: 1,
  };
}

/** True when `now - lastActive` has crossed the 30-day abandonment threshold. */
export function isAbandoned(lastActive: number, now: number): boolean {
  return now - lastActive >= ABANDON_MS;
}

/** Ms until abandonment (0 when already abandoned). For "abandons in Xd" UI. */
export function abandonmentIn(lastActive: number, now: number): number {
  return Math.max(0, ABANDON_MS - (now - lastActive));
}

/** Key for the known-colonies map. */
export function colonyKey(serverId: string, colonyId: string): string {
  return `${serverId}:${colonyId}`;
}

/** Display name for a map marker: "Hans's Colony". */
export function colonyMarkerName(ownerName: string): string {
  return `${ownerName}'s Colony`;
}

/** True when a probe has finished its flight. */
export function probeReady(probe: ScoutProbe, now: number): boolean {
  return probe.status === "inflight" && now >= probe.returnsAt;
}

/** Launch a probe: consumes one from inventory, creates the in-flight record. */
export function launchProbe(
  wm: WorldMapState,
  targetServerId: string,
  now: number,
): { ok: boolean; probe?: ScoutProbe; error?: string } {
  if (wm.probes < 1) return { ok: false, error: "No scout probes built — forge one first." };
  const probe: ScoutProbe = {
    id: `probe-${wm.seq}`,
    targetServerId,
    launchedAt: now,
    returnsAt: now + SCOUT_DURATION_MS,
    status: "inflight",
  };
  wm.probes -= 1;
  wm.seq += 1;
  wm.inflight.push(probe);
  return { ok: true, probe };
}

/** Collect a returned probe: marks it returned and files its report. */
export function collectProbe(
  wm: WorldMapState,
  probeId: string,
  now: number,
): { ok: boolean; report?: ScoutReport; error?: string } {
  const probe = wm.inflight.find((p) => p.id === probeId);
  if (!probe) return { ok: false, error: "Probe not found." };
  if (!probeReady(probe, now)) return { ok: false, error: "Probe is still in flight." };
  probe.status = "returned";
  const report = generateScoutReport(probe.targetServerId, now, probe.id);
  wm.reports[probe.targetServerId] = report;
  return { ok: true, report };
}

// ---------------------------------------------------------------------------
// Scout reports (MOCK — server data later)
// ---------------------------------------------------------------------------
//
// The real report comes from the server (it knows every colony). Until the
// multiplayer server exists, generate deterministic mock values from the
// serverId so the UI has something honest to render in beta.

/** Deterministic 32-bit hash of a string (for stable mock values). */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mock scout report for a server. Deterministic per serverId: the same planet
 * always reports the same numbers (until the server replaces this). Values
 * are plausible for a live server — tens to ~a thousand players, a fraction
 * of colonies abandoned. NEVER include per-colony loot: the report is odds.
 */
export function generateScoutReport(serverId: string, now: number, probeId: string): ScoutReport {
  const h = hash32(serverId);
  // 40–1200 players: small quiet worlds to near-cap servers.
  const playerCount = 40 + (h % 1161);
  // Colonies track players (1.0–1.4x — some players run two colonies).
  const colonyCount = Math.round(playerCount * (1 + ((h >>> 8) % 41) / 100));
  // 5–25% of colonies abandoned (older servers skew higher).
  const abandonedCount = Math.round(colonyCount * (0.05 + ((h >>> 16) % 21) / 100));
  return {
    id: `report-${probeId}`,
    serverId,
    playerCount,
    colonyCount,
    abandonedCount,
    receivedAt: now,
  };
}

/** Loot left after gleaners took their share (never negative). */
export function lootAfterTake(loot: ColonyLoot, taken: ColonyLoot): ColonyLoot {
  const sub = (a: number, b: number) => Math.max(0, a - b);
  return {
    supplies: sub(loot.supplies, taken.supplies),
    embers: sub(loot.embers, taken.embers),
    fuel: sub(loot.fuel, taken.fuel),
    battery: sub(loot.battery, taken.battery),
    medkit: sub(loot.medkit, taken.medkit),
    mechkit: sub(loot.mechkit, taken.mechkit),
    armorkit: sub(loot.armorkit, taken.armorkit),
    hazmat: sub(loot.hazmat, taken.hazmat),
    shots: sub(loot.shots, taken.shots),
  };
}

/** Total loot value (for "fully gleaned?" checks). */
export function lootTotal(loot: ColonyLoot): number {
  return (
    loot.supplies +
    loot.embers +
    loot.fuel +
    loot.battery +
    loot.medkit +
    loot.mechkit +
    loot.armorkit +
    loot.hazmat +
    loot.shots
  );
}

/** True when nothing lootable remains (colony is a husk). */
export function isHusk(loot: ColonyLoot, mercenaries: MercenaryBand | null): boolean {
  return lootTotal(loot) === 0 && mercenaries === null;
}
