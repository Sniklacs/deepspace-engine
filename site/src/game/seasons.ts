// SEASONS — the great reset (design/seasons.md — authoritative build doc).
//
// "THE BOARD RESETS, THE SOUL PERSISTS." Twelve-week seasons synchronized
// across all servers, ending in a 2-week Storm (Chorus surge, war bonuses,
// standings locked), then a 1-week intermission (sandbox: arena + Chorus
// open, nothing kept, nothing risked).
//
// LOCKED PRINCIPLES (spec §0):
//   1. Two layers, never mixed: the BOARD (world) wipes; the SOUL (player)
//      persists. If a system can't say which layer it belongs to, it
//      doesn't ship.
//   2. Persistence is earned, never bought.
//   3. Every server runs the same clock — seasons are pure time math from
//      SEASON_1_START, so all servers agree without coordination.
//   4. Seasons end with a bang (the Storm), not a countdown.
//   5. Losing stings, doesn't kill: 12 weeks is "next season," not
//      "uninstall."
//
// WIPES (board): troops, forward bases, stockpiles/supplies/cargo, modules,
//   market listings, arena ladder (history kept).
// PERSISTS (soul): Oracle favor (devotion — already monotonic), held
//   artifacts (vaulted/carried + provenance), titles & veteran markers,
//   memorial plaques (never wiped), alliance membership (locked 2026-09-30).
//
// PURE module except ensureSoul/rolloverSeason, which mutate the passed
// GameState the same way the rest of the engine does.

import type { GameState } from "./types";
import { emptyTroopHome } from "./war/troops";

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** Season 1 start (UTC). Tunable — when the live game launches, set this to
 *  the real launch date. All servers derive the same season from this. */
export const SEASON_1_START_MS = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01

export const SEASON_ACTIVE_MS = 12 * 7 * 24 * 60 * 60 * 1000; // 12 weeks
export const SEASON_STORM_MS = 2 * 7 * 24 * 60 * 60 * 1000; // final 2 weeks
export const SEASON_INTERMISSION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
export const SEASON_CYCLE_MS = SEASON_ACTIVE_MS + SEASON_INTERMISSION_MS; // 13 weeks

export type SeasonPhase = "landing" | "expansion" | "war" | "storm" | "intermission";

/** Season names are content — the world speaker announces them. */
const SEASON_NAMES = [
  "The Ashen Tide",
  "The Hollow Star",
  "The Ember Fall",
  "The Silent Choir",
  "The Broken Crown",
  "The Red Harvest",
  "The Pale Dawn",
  "The Iron Bloom",
  "The Drowned Signal",
  "The Last Lantern",
];

export interface Season {
  /** "season-1", "season-2", ... */
  id: string;
  /** 1-based season number. */
  number: number;
  /** "Season 3: The Ember Fall" */
  name: string;
  startsAt: number;
  /** End of the 12 active weeks (Storm included); intermission starts here. */
  endsAt: number;
  stormStartsAt: number;
  /** End of the 1-week intermission; next season starts here. */
  intermissionEndsAt: number;
  phase: SeasonPhase;
}

/** The season in effect at `now`. Pure time math — every server agrees. */
export function currentSeason(now: number = Date.now()): Season {
  const elapsed = Math.max(0, now - SEASON_1_START_MS);
  const number = Math.floor(elapsed / SEASON_CYCLE_MS) + 1;
  const startsAt = SEASON_1_START_MS + (number - 1) * SEASON_CYCLE_MS;
  const endsAt = startsAt + SEASON_ACTIVE_MS;
  const stormStartsAt = endsAt - SEASON_STORM_MS;
  const intermissionEndsAt = endsAt + SEASON_INTERMISSION_MS;
  const intoSeason = now - startsAt;
  let phase: SeasonPhase;
  if (intoSeason >= SEASON_ACTIVE_MS) {
    phase = "intermission";
  } else if (intoSeason >= SEASON_ACTIVE_MS - SEASON_STORM_MS) {
    phase = "storm";
  } else if (intoSeason >= 6 * 7 * 24 * 60 * 60 * 1000) {
    phase = "war";
  } else if (intoSeason >= 2 * 7 * 24 * 60 * 60 * 1000) {
    phase = "expansion";
  } else {
    phase = "landing";
  }
  const seasonName = SEASON_NAMES[(number - 1) % SEASON_NAMES.length];
  return {
    id: `season-${number}`,
    number,
    name: `Season ${number}: ${seasonName}`,
    startsAt,
    endsAt,
    stormStartsAt,
    intermissionEndsAt,
    phase,
  };
}

/** Phase at `now` without building the full Season. */
export function seasonPhaseAt(now: number = Date.now()): SeasonPhase {
  return currentSeason(now).phase;
}

/** True during the final 2 weeks: Chorus surge, war bonuses, standings locked. */
export function isStormActive(now: number = Date.now()): boolean {
  return seasonPhaseAt(now) === "storm";
}

/** True during the 1-week sandbox between seasons. */
export function isIntermission(now: number = Date.now()): boolean {
  return seasonPhaseAt(now) === "intermission";
}

/** Ladders, contribution awards, and title races freeze at Storm's start —
 *  the last two weeks are for glory, not points (spec §2). */
export function standingsLocked(now: number = Date.now()): boolean {
  const phase = seasonPhaseAt(now);
  return phase === "storm" || phase === "intermission";
}

/** Storm multipliers other systems query (spec §2). */
export function stormMultipliers(now: number = Date.now()): {
  chorusActivity: number;
  raidRewards: number;
  artifactDropOdds: number;
} {
  if (!isStormActive(now)) return { chorusActivity: 1, raidRewards: 1, artifactDropOdds: 1 };
  return { chorusActivity: 1.5, raidRewards: 1.25, artifactDropOdds: 1.5 };
}

/** For the season timer UI: current phase + ms until it ends. */
export function seasonTimeRemaining(now: number = Date.now()): {
  season: Season;
  phaseEndsAt: number;
  msRemaining: number;
} {
  const season = currentSeason(now);
  let phaseEndsAt: number;
  switch (season.phase) {
    case "landing":
      phaseEndsAt = season.startsAt + 2 * 7 * 24 * 60 * 60 * 1000;
      break;
    case "expansion":
      phaseEndsAt = season.startsAt + 6 * 7 * 24 * 60 * 60 * 1000;
      break;
    case "war":
      phaseEndsAt = season.stormStartsAt;
      break;
    case "storm":
      phaseEndsAt = season.endsAt;
      break;
    case "intermission":
      phaseEndsAt = season.intermissionEndsAt;
      break;
  }
  return { season, phaseEndsAt, msRemaining: Math.max(0, phaseEndsAt - now) };
}

// ---------------------------------------------------------------------------
// The Soul — everything about the player that crosses the season line
// ---------------------------------------------------------------------------

export interface ProvenanceEntry {
  holderId: string;
  holderName: string;
  season: string;
  /** "earned" | "carried" | "taken" | "vaulted" | "destroyed" */
  event: string;
  at: number;
}

/** An artifact held across seasons. Vaulted = safe but unusable; carried =
 *  grants power but is lootable in real PvP (spec §5). */
export interface Artifact {
  id: string;
  name: string;
  /** "vaulted" (home colony: safe, grants nothing) | "carried" (on a hero:
   *  grants power, on the table). */
  state: "vaulted" | "carried";
  provenance: ProvenanceEntry[];
}

/** The cross-season record. The colony is seasonal; the soul is eternal. */
export interface PlayerSoul {
  /** Per-race Oracle favor rank (spec §4). Diminishing returns; race loyalty
   *  has a price — switch races, start over with a stranger. */
  oracleFavor: Record<string, number>;
  /** Held artifacts with full provenance (spec §5). */
  artifacts: Artifact[];
  /** "Champion of [Server], Season 7." Cosmetic. Eternal. */
  titles: string[];
  /** "Fought in N seasons." The simplest retention mechanic ever. */
  seasonsFought: number;
}

export function emptySoul(): PlayerSoul {
  return { oracleFavor: {}, artifacts: [], titles: [], seasonsFought: 0 };
}

/** Backfill safety: every save owns a soul. */
export function ensureSoul(state: GameState): void {
  const s = state as any;
  if (!s.soul || typeof s.soul !== "object") {
    s.soul = emptySoul();
    return;
  }
  if (!s.soul.oracleFavor || typeof s.soul.oracleFavor !== "object") s.soul.oracleFavor = {};
  if (!Array.isArray(s.soul.artifacts)) s.soul.artifacts = [];
  if (!Array.isArray(s.soul.titles)) s.soul.titles = [];
  if (typeof s.soul.seasonsFought !== "number") s.soul.seasonsFought = 0;
}

// ---------------------------------------------------------------------------
// Artifacts — vault vs. field (spec §5)
// ---------------------------------------------------------------------------

/** Move an artifact to the vault: safe, cannot be looted — grants nothing. */
export function vaultArtifact(
  state: GameState,
  artifactId: string,
  now: number = Date.now()
): { ok: boolean; error?: string } {
  ensureSoul(state);
  const soul = (state as any).soul as PlayerSoul;
  const art = soul.artifacts.find((a) => a.id === artifactId);
  if (!art) return { ok: false, error: "Artifact not found in your soul." };
  if (art.state === "vaulted") return { ok: false, error: "Already vaulted." };
  art.state = "vaulted";
  addProvenance(art, {
    holderId: state.gameId || "",
    holderName: state.playerName || "",
    season: currentSeason(now).id,
    event: "vaulted",
    at: now,
  });
  return { ok: true };
}

/** Take an artifact from the vault onto a hero: grants power — and is on
 *  the table. Fall in real PvP wearing it, the victor takes it. */
export function carryArtifact(
  state: GameState,
  artifactId: string,
  now: number = Date.now()
): { ok: boolean; error?: string } {
  ensureSoul(state);
  const soul = (state as any).soul as PlayerSoul;
  const art = soul.artifacts.find((a) => a.id === artifactId);
  if (!art) return { ok: false, error: "Artifact not found in your soul." };
  if (art.state === "carried") return { ok: false, error: "Already carried." };
  art.state = "carried";
  addProvenance(art, {
    holderId: state.gameId || "",
    holderName: state.playerName || "",
    season: currentSeason(now).id,
    event: "carried",
    at: now,
  });
  return { ok: true };
}

/** Append a provenance entry. The legend is a data structure (spec §5). */
export function addProvenance(art: Artifact, entry: ProvenanceEntry): void {
  art.provenance.push(entry);
}

/** Award a newly earned artifact into the soul (starts vaulted — safe until
 *  the player chooses to carry it). */
export function earnArtifact(
  state: GameState,
  artifact: Omit<Artifact, "state" | "provenance">,
  now: number = Date.now()
): Artifact {
  ensureSoul(state);
  const soul = (state as any).soul as PlayerSoul;
  const art: Artifact = {
    ...artifact,
    state: "vaulted",
    provenance: [
      {
        holderId: state.gameId || "",
        holderName: state.playerName || "",
        season: currentSeason(now).id,
        event: "earned",
        at: now,
      },
    ],
  };
  soul.artifacts.push(art);
  return art;
}

/** Award a season title (spec §6). Idempotent per title string. */
export function awardTitle(state: GameState, title: string): boolean {
  ensureSoul(state);
  const soul = (state as any).soul as PlayerSoul;
  if (soul.titles.includes(title)) return false;
  soul.titles.push(title);
  return true;
}

// ---------------------------------------------------------------------------
// Rollover — the most dangerous batch write in the game (spec §9)
// ---------------------------------------------------------------------------

/** Result of a season rollover, for logging / the world speaker. */
export interface RolloverResult {
  fromSeasonId: string;
  toSeasonId: string;
  wiped: {
    troops: boolean;
    forwardBases: number;
    stockpiles: boolean;
    arenaLadder: boolean;
  };
  preserved: {
    artifacts: number;
    titles: number;
    seasonsFought: number;
    memorials: number;
  };
}

/**
 * Advance the save to `newSeasonId`. Wipes the board, preserves the soul.
 * Idempotent per target season id — running it twice for the same season
 * is a no-op (guards the "most dangerous batch write in the game").
 */
export function rolloverSeason(
  state: GameState,
  newSeasonId: string,
  now: number = Date.now()
): RolloverResult | null {
  ensureSoul(state);
  const s = state as any;
  if (s.seasonId === newSeasonId) return null; // already rolled — idempotent

  const fromSeasonId = typeof s.seasonId === "string" ? s.seasonId : "unknown";
  const soul = s.soul as PlayerSoul;

  // ---- WIPE: the board ----
  // Troops: garrisons, muster queues — all gone.
  let troopsWiped = false;
  if (s.troops?.home) {
    s.troops.home = emptyTroopHome(now);
    s.troops.bands = [];
    troopsWiped = true;
  }
  // Forward bases: the recall (design/forward-base.md §9).
  let basesAbandoned = 0;
  if (s.forwardBases && typeof s.forwardBases === "object") {
    basesAbandoned = Object.keys(s.forwardBases).length;
    s.forwardBases = {};
    s.serverBands = undefined; // rebuilt by ensureForwardBases
  }
  // Stockpiles, supplies, cargo: back to founding levels.
  let stockpilesWiped = false;
  if (s.resources && typeof s.resources === "object") {
    s.resources.supplies = 10000; // founding supplies (owner 2026-10-01)
    s.resources.embers = 0;
    s.resources.chipsets = 0;
    s.resources.alloys = 0;
    s.resources.plasma = 0;
    s.resources.warplate = 0;
    s.resources.hazmat = 0;
    s.resources.shots = 0;
    s.resources.medkit = 0;
    s.resources.mechkit = 0;
    s.resources.armorkit = 0;
    s.resources.skmech = 0;
    s.resources.gas = 0;
    s.resources.battery = 0;
    if (s.resources.mats && typeof s.resources.mats === "object") {
      for (const k of Object.keys(s.resources.mats)) s.resources.mats[k] = 0;
    }
    stockpilesWiped = true;
  }
  // Arena ladder resets; history kept (spec §3).
  let arenaReset = false;
  if (s.arena && typeof s.arena === "object") {
    if (Array.isArray(s.arena.ladder)) {
      if (!Array.isArray(s.arena.ladderHistory)) s.arena.ladderHistory = [];
      s.arena.ladderHistory.push({ season: fromSeasonId, entries: s.arena.ladder, at: now });
      s.arena.ladder = [];
      arenaReset = true;
    }
  }
  // Raids in flight don't survive the wipe.
  if (s.raids && typeof s.raids === "object") {
    s.raids = {};
  }
  // Market listings: none exist yet (market not built) — seam for later.
  if (Array.isArray(s.marketListings)) s.marketListings = [];

  // ---- PRESERVE: the soul ----
  // Devotion (Oracle favor soil) is already monotonic — never touched.
  // Artifacts cross the line as-is (vaulted stays vaulted, carried stays
  // carried — the risk IS the cap, spec §5).
  const artifactsKept = soul.artifacts.length;
  // Veteran marker ticks.
  soul.seasonsFought += 1;
  // Memorials never wipe (asserted by memorials.ts — untouched here).
  const memorialsKept = Array.isArray(s.memorials) ? s.memorials.length : 0;
  // Alliance membership persists (locked 2026-09-30) — untouched.

  // ---- Re-roll the sky ----
  // The constellation rolls against the season id (satellites.md §0.4).
  s.seasonId = newSeasonId;
  if (s.satellites && typeof s.satellites === "object") {
    s.satellites.seasonId = newSeasonId;
    s.satellites.stages = {}; // ~50% awake, re-randomized (ensureSatellites rebuilds)
  }

  return {
    fromSeasonId,
    toSeasonId: newSeasonId,
    wiped: {
      troops: troopsWiped,
      forwardBases: basesAbandoned,
      stockpiles: stockpilesWiped,
      arenaLadder: arenaReset,
    },
    preserved: {
      artifacts: artifactsKept,
      titles: soul.titles.length,
      seasonsFought: soul.seasonsFought,
      memorials: memorialsKept,
    },
  };
}

/**
 * Check whether the save's season has advanced; roll over if so. Called
 * from engine.advance(). Returns the rollover result, or null if no
 * rollover was needed.
 */
export function checkSeasonRollover(state: GameState, now: number = Date.now()): RolloverResult | null {
  ensureSoul(state);
  const s = state as any;
  const season = currentSeason(now);
  // Only roll when the save's season id is a game season and differs.
  // Legacy saves (monetization s0_*, etc.) adopt the current game season
  // on first run WITHOUT wiping — the wipe only fires on a real advance.
  if (typeof s.seasonId === "string" && s.seasonId.startsWith("season-")) {
    if (s.seasonId === season.id) return null;
    return rolloverSeason(state, season.id, now);
  }
  // First adoption: stamp the season, no wipe.
  s.seasonId = season.id;
  if (s.satellites && typeof s.satellites === "object") {
    s.satellites.seasonId = season.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intermission sandbox (spec §2.1)
// ---------------------------------------------------------------------------

/** Practice resources granted during intermission. Ephemeral — nothing is
 *  kept, nothing counts. Systems check isIntermission() before granting. */
export interface SandboxGrant {
  troops: number;
  supplies: number;
  /** Marker: sandbox assets evaporate at season open. */
  sandbox: true;
}

/** The weekly toy-soldier grant. Tunable. */
export function intermissionSandboxGrant(): SandboxGrant {
  return { troops: 5000, supplies: 50000, sandbox: true };
}
