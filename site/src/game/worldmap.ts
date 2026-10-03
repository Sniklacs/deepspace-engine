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
import type { PersonalShipyard } from "./shipyard";
import type { RaidParty, RaidWarning } from "./raids";

/** 30 days of silence → abandoned. Hans: the first month has no gleaning so
 *  everybody gets a fair chance to grow (30d ≈ 1/3 of a 12-week season). */
export const ABANDON_MS = 30 * 24 * 3600_000;

/** How long a scout probe takes to fly out, scan, and return.
 *  TEST VALUE: 30s for expedited testing (Hans Oct 2 2026).
 *  PRODUCTION: 6 hours — restore before launch. */
export const SCOUT_DURATION_MS = 30_000;

/** Research tech id that unlocks scout probes (lives in the research tree). */
export const SCOUT_TECH_ID = "scout-probes";

/** Supplies cost to BUILD one probe (one-time use). Tunable. */
export const SCOUT_PROBE_COST_SUPPLIES = 500;

/** How long a gleaning expedition takes (out and back). Tunable. */
export const GLEAN_DURATION_MS = 2 * 3600_000; // 2 hours

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
  /** AUTHORITATIVE remaining loot (abandoned only). First-come-first-served;
   *  reduced by gleaning. When empty + no mercenaries, colony is a husk. */
  loot?: ColonyLoot;
  /** Mercenary band camped at an abandoned colony (troops that were there at
   *  abandonment). Hireable with supplies. Null when none/hired. */
  mercenaries?: MercenaryBand | null;
  /** Planetary reverb (overall strength signature) — only from a visit, never
   *  a probe. Reverb tells you HOW MUCH, not WHAT (design §14). */
  reverb?: number;
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
  /** True once scout probe research completes (unlocks probe building). */
  scoutTechResearched: boolean;
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
  /** Personal shipyard for solo scout builds (warships need the alliance). */
  shipyard?: PersonalShipyard;
  /** Raiding parties (raids.ts): preparing → in_transit → landed → returning → done. */
  raids: RaidParty[];
  /** Defender warnings, filed the moment a raid touches down (raids.ts). */
  raidWarnings: RaidWarning[];
  /** Monotonic counters for id generation. */
  seq: number;
}

export function emptyWorldMap(now: number): WorldMapState {
  return {
    lastActive: now,
    scoutTechResearched: false,
    probes: 0,
    inflight: [],
    reports: {},
    known: {},
    gleanRuns: [],
    visited: [],
    raids: [],
    raidWarnings: [],
    seq: 1,
  };
}

/** Ensure state.worldMap exists (for migration compatibility). */
export function ensureWorldMap(state: { worldMap?: WorldMapState }, now: number = Date.now()): WorldMapState {
  if (!state.worldMap) state.worldMap = emptyWorldMap(now);
  const wm = state.worldMap;
  if (!Array.isArray(wm.raids)) wm.raids = [];
  if (!Array.isArray(wm.raidWarnings)) wm.raidWarnings = [];
  return wm;
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

/** True if the tech ID is the scout probe research. */
export function isScoutProbeTech(techId: string): boolean {
  return techId === SCOUT_TECH_ID;
}

// ---------------------------------------------------------------------------
// Gleaning expeditions (pure functions — design/abandoned-colonies-world-map.md §3)
// ---------------------------------------------------------------------------

/** Begin a gleaning expedition: validates the colony, creates the run. */
export function beginGleanRun(
  wm: WorldMapState,
  key: string,
  now: number,
): { ok: boolean; run?: GleanRun; error?: string } {
  const colony = wm.known[key];
  if (!colony) return { ok: false, error: "That colony isn't on your map — scout it first." };
  if (colony.status !== "abandoned") {
    return {
      ok: false,
      error: colony.status === "active"
        ? "That colony is still active — gleaning is for abandoned colonies only."
        : "That colony is a husk — nothing left to glean.",
    };
  }
  const loot = colony.loot ?? EMPTY_LOOT;
  const mercs = colony.mercenaries ?? null;
  if (isHusk(loot, mercs)) {
    colony.status = "husk";
    return { ok: false, error: "That colony is a husk — already fully gleaned." };
  }
  const existing = wm.gleanRuns.find(
    (r) => r.colonyId === colony.id && r.serverId === colony.serverId && r.status === "out"
  );
  if (existing) return { ok: false, error: "A gleaning expedition is already out to that colony." };
  
  const run: GleanRun = {
    id: `glean-${wm.seq}`,
    colonyId: colony.id,
    serverId: colony.serverId,
    startedAt: now,
    durationMs: GLEAN_DURATION_MS,
    status: "out",
  };
  wm.seq += 1;
  wm.gleanRuns.push(run);
  return { ok: true, run };
}

/** True when a gleaning expedition has completed its run. */
export function gleanReady(run: GleanRun, now: number): boolean {
  return run.status === "out" && now >= run.startedAt + run.durationMs;
}

/** Resolve a gleaning expedition: returns the loot taken (caller transfers it). */
export function resolveGleanRun(
  wm: WorldMapState,
  runId: string,
  now: number,
): { ok: boolean; lootTaken?: ColonyLoot; colony?: KnownColony; error?: string } {
  const run = wm.gleanRuns.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Gleaning expedition not found." };
  if (run.status !== "out") return { ok: false, error: "That expedition already returned." };
  if (!gleanReady(run, now)) return { ok: false, error: "The expedition is still out." };
  
  const key = colonyKey(run.serverId, run.colonyId);
  const colony = wm.known[key];
  if (!colony) return { ok: false, error: "The target colony vanished from your map." };
  
  // Take all remaining loot (v1: full take; convoy capacity limits come later)
  const loot = colony.loot ?? EMPTY_LOOT;
  const taken = { ...loot };
  
  // Update colony loot
  colony.loot = lootAfterTake(loot, taken);
  colony.lootObserved = { ...colony.loot };
  
  run.status = "complete";
  run.lootTaken = taken;
  
  // Check if now a husk
  const mercs = colony.mercenaries ?? null;
  if (isHusk(colony.loot, mercs)) {
    colony.status = "husk";
  }
  
  return { ok: true, lootTaken: taken, colony };
}

/** Scout probe research cost (codices) and duration. Tunable. */
export const SCOUT_TECH_CODICES = 10;
export const SCOUT_TECH_DURATION_MS = 60_000;

/* ── Jump ships (design/abandoned-colonies-world-map.md §10) ── */

/** Six ship classes. Each race builds their own variant with a unique name. */
export type ShipClass = "scout" | "frigate" | "bulwark" | "vanguard" | "fatcat" | "herald";

export const SHIP_CLASSES: ShipClass[] = ["scout", "frigate", "bulwark", "vanguard", "fatcat", "herald"];

/** Race-specific ship names. Key: `${raceId}:${shipClass}`. */
export const SHIP_RACE_NAMES: Record<string, string> = {
  // Scout (name TBD at class level — race names stand alone)
  "grays:scout": "Gray Scout", "draconians:scout": "Ashen Eye", "watchers:scout": "Threshold Eye",
  "ashtar:scout": "Accord Scout", "anunnaki:scout": "Gilded Eye", "nephilim:scout": "Stone Eye",
  "unbound:scout": "Dawn Scout",
  // Frigate (name TBD at class level)
  "grays:frigate": "Gray Frigate", "draconians:frigate": "Ashen Claw", "watchers:frigate": "Seraph Wing",
  "ashtar:frigate": "Accord Wing", "anunnaki:frigate": "Gilded Claw", "nephilim:frigate": "Stone Fist",
  "unbound:frigate": "Dawn Wing",
  // Bulwark
  "grays:bulwark": "Warden Lattice", "draconians:bulwark": "Ashen Bulwark", "watchers:bulwark": "Threshold Bastion",
  "ashtar:bulwark": "Accord Aegis", "anunnaki:bulwark": "Gilded Rampart", "nephilim:bulwark": "Stoneshield",
  "unbound:bulwark": "Radiant Bulwark",
  // Vanguard
  "grays:vanguard": "Calculus Vanguard", "draconians:vanguard": "Ashen Vanguard", "watchers:vanguard": "Seraph Vanguard",
  "ashtar:vanguard": "Accord Vanguard", "anunnaki:vanguard": "Gilded Vanguard", "nephilim:vanguard": "Stone Vanguard",
  "unbound:vanguard": "Radiant Vanguard",
  // Fat Cat (Hans named the class)
  "grays:fatcat": "Ledger Hauler", "draconians:fatcat": "Hoard Drake", "watchers:fatcat": "Tithe Bearer",
  "ashtar:fatcat": "Compact Hauler", "anunnaki:fatcat": "Golden Belly", "nephilim:fatcat": "Mountain's Maw",
  "unbound:fatcat": "Cornucopia",
  // Herald
  "grays:herald": "Array Herald", "draconians:herald": "War-Drum", "watchers:herald": "Trumpet Herald",
  "ashtar:herald": "Concord Herald", "anunnaki:herald": "Royal Signal", "nephilim:herald": "Thunder Call",
  "unbound:herald": "Dawn Herald",
};

/** Get the race-specific name for a ship class. Falls back to class id. */
export function shipName(raceId: string, shipClass: ShipClass): string {
  return SHIP_RACE_NAMES[`${raceId}:${shipClass}`] ?? shipClass;
}

/** Ship build time in ms (tunable). Hans: hours, not days. */
export const SHIP_BUILD_MS: Record<ShipClass, number> = {
  scout: 2 * 3600_000,      // 2 hours
  frigate: 4 * 3600_000,    // 4 hours
  bulwark: 8 * 3600_000,    // 8 hours
  vanguard: 6 * 3600_000,   // 6 hours (tunable — between frigate and bulwark)
  fatcat: 10 * 3600_000,   // 10 hours (big, heavy, slow to print)
  herald: 5 * 3600_000,    // 5 hours (complex systems, no weapons)
};

/** Ship build cost: supplies + race material + alloys (tunable). */
export interface ShipCost { supplies: number; raceMaterial: number; alloys: number; }
export const SHIP_COST: Record<ShipClass, ShipCost> = {
  scout: { supplies: 500, raceMaterial: 10, alloys: 0 },
  frigate: { supplies: 1000, raceMaterial: 20, alloys: 2 },
  bulwark: { supplies: 2000, raceMaterial: 40, alloys: 5 },
  vanguard: { supplies: 1500, raceMaterial: 30, alloys: 3 },
  fatcat: { supplies: 3000, raceMaterial: 50, alloys: 8 },
  herald: { supplies: 1200, raceMaterial: 25, alloys: 2 },
};

/** True if the ship class requires alliance membership (all except scout). */
export function shipNeedsAlliance(shipClass: ShipClass): boolean {
  return shipClass !== "scout";
}

/** A built jump ship. */
export interface JumpShip {
  id: string;
  class: ShipClass;
  raceId: RaceId;
  /** Display name (race-specific). */
  name: string;
  status: "building" | "ready" | "deployed" | "destroyed" | "stranded";
  /** When building completes (if status === "building"). */
  doneAt?: number;
  /** If stranded: beacon info (position only — no comms, §11). */
  beacon?: { serverId: string; at: number };
}

/** Stranded ship: beacon only, no comms. Rescue is a combat op (§11). */
export interface StrandedShip extends JumpShip {
  status: "stranded";
  beacon: { serverId: string; at: number };
}
