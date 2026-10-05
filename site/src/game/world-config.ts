// World configuration — the per-deploy identity of a Deepspace Engine world.
//
// One codebase ships every world. A deployment is defined by this single
// config flag block: each deployed world sets its own worldId, worldName and
// raceLock, and BOTH the server and the client read the world's identity from
// THIS module (the server build is authoritative: it is the only one that
// enforces the lock — see api.ts createGameFn; the client merely renders it).
//
// Six live servers will be one per playable race:
//   { worldId: "grays-world",        raceLock: "grays" }
//   { worldId: "nephilim-world",     raceLock: "nephilim" }
//   ... one per race
// The debug/test server runs ONE race — The Watchers — and that beta world IS
// the test bed (per the ratified business plan). `raceLock: null` means any
// race may be founded (a fully open world); the beta world is locked.
//
// Existing beta saves of other races remain playable — the lock applies ONLY
// to NEW colony creation (server-enforced in createGameFn). Legacy colonies
// are beta artifacts and are deliberately not converted or deleted.
import { RACES } from "./races";
import type { RaceId } from "./types";

export interface WorldConfig {
  /** Stable per-deploy world id (e.g. "watchers-beta" for the debug world). */
  worldId: string;
  /** Human-facing world name, shown in the race-selection framing. */
  worldName: string;
  /**
   * The single race this world allows at colony-creation time, or null for an
   * open world. Server-enforced; drives the client's race-selection UI.
   */
  raceLock: RaceId | null;
  /** Tagline shown on the race-select screen to frame the world's identity. */
  tagline: string;
  /** True for the debug/test world (the beta test bed). Cosmetic only. */
  debugWorld: boolean;
}

function parseRaceLockValue(v: string | undefined): RaceId | null {
  if (!v || v === "null" || v === "open") return null;
  return v as RaceId;
}

/** The env keys that define a world's identity (build-vercel.sh must export
 *  all of these before the Vite build so the client bundle bakes them). */
export interface WorldEnvMap {
  WORLD_ID?: string;
  WORLD_NAME?: string;
  RACE_LOCK?: string;
  WORLD_TAGLINE?: string;
  DEBUG_WORLD?: string;
}

/**
 * Pure factory — builds a WorldConfig from an explicit env map. The module
 * const below wires the real env; tests pass their own map, which is how the
 * draconians-build regression is pinned without fighting module-load order
 * (owner P0 2026-10-05).
 */
export function buildWorldConfig(e: WorldEnvMap): WorldConfig {
  return {
    worldId: e.WORLD_ID ?? "watchers-beta",
    worldName: e.WORLD_NAME ?? "The Shattered Academies",
    raceLock: e.RACE_LOCK !== undefined ? parseRaceLockValue(e.RACE_LOCK) : "watchers",
    tagline:
      e.WORLD_TAGLINE ??
      "The Watchers debug world — the beta test bed. This world belongs to the Fallen Teachers, and only Watcher colonies may be founded here.",
    debugWorld: (e.DEBUG_WORLD ?? "true") === "true",
  };
}

/** Read config from process.env (server/SSR runtime, local shell) or from
 *  Vite-baked VITE_* vars (client build time). Falls back to watchers-beta. */
declare const __WORLD_ENV__: Record<string, string> | undefined;
function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[key] !== undefined) {
    return process.env[key];
  }
  if (typeof __WORLD_ENV__ !== "undefined" && __WORLD_ENV__[key] !== undefined) {
    return __WORLD_ENV__[key];
  }
  return undefined;
}

export const WORLD_CONFIG: WorldConfig = buildWorldConfig({
  WORLD_ID: env("WORLD_ID"),
  WORLD_NAME: env("WORLD_NAME"),
  RACE_LOCK: env("RACE_LOCK"),
  WORLD_TAGLINE: env("WORLD_TAGLINE"),
  DEBUG_WORLD: env("DEBUG_WORLD"),
});

/** Trimmed, non-secret view for the client UI. */
export const WORLD_CONFIG_PUBLIC = {
  worldId: WORLD_CONFIG.worldId,
  worldName: WORLD_CONFIG.worldName,
  raceLock: WORLD_CONFIG.raceLock,
  tagline: WORLD_CONFIG.tagline,
  debugWorld: WORLD_CONFIG.debugWorld,
};
export type WorldConfigPublic = typeof WORLD_CONFIG_PUBLIC;

/** The races the client may offer on this world (just the lock when locked). */
export function worldAllowedRaces(config: WorldConfig = WORLD_CONFIG): RaceId[] {
  return config.raceLock ? [config.raceLock] : RACES.map((r) => r.id);
}

/** The locked race's readable short label ("The Watchers (The Grigori)" → "Watchers"). */
export function worldLockPlain(config: WorldConfig = WORLD_CONFIG): string {
  if (!config.raceLock) return "";
  return RACES.find((r) => r.id === config.raceLock)!.name
    .replace(/^The /, "")
    .replace(/\s*\(.*\)$/, "")
    .trim();
}

/**
 * THE enforcement point, shared by the create-game server handler and tests:
 * returns a user-readable error when `raceId` may not be founded on this
 * world, or null when it may. Server-side only — the client never trusts this
 * to gate anything; it just renders the same answer.
 */
export function worldRaceError(raceId: RaceId | undefined | null, config: WorldConfig = WORLD_CONFIG): string | null {
  const lock = config.raceLock;
  if (lock && raceId !== lock) {
    const plain = worldLockPlain(config);
    const denied = raceId ? RACES.find((r) => r.id === raceId) : null;
    return denied
      ? `${denied.name} cannot be founded on this world — it is the ${plain} debug world (${config.worldName}). Only ${plain} colonies may be founded here.`
      : `This world is the ${plain} debug world (${config.worldName}) — only ${plain} colonies may be founded here.`;
  }
  return null;
}