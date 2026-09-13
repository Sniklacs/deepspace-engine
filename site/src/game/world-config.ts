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

export const WORLD_CONFIG: WorldConfig = {
  worldId: "watchers-beta",
  worldName: "The Shattered Academies",
  raceLock: "watchers",
  tagline:
    "The Watchers debug world — the beta test bed. This world belongs to the Fallen Teachers, and only Watcher colonies may be founded here.",
  debugWorld: true,
};

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
export function worldAllowedRaces(): RaceId[] {
  return WORLD_CONFIG.raceLock ? [WORLD_CONFIG.raceLock] : RACES.map((r) => r.id);
}

/** The locked race's readable short label ("The Watchers (The Grigori)" → "Watchers"). */
export function worldLockPlain(): string {
  if (!WORLD_CONFIG.raceLock) return "";
  return RACES.find((r) => r.id === WORLD_CONFIG.raceLock)!.name
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
export function worldRaceError(raceId: RaceId | undefined | null): string | null {
  const lock = WORLD_CONFIG.raceLock;
  if (lock && raceId !== lock) {
    const plain = worldLockPlain();
    const denied = raceId ? RACES.find((r) => r.id === raceId) : null;
    return denied
      ? `${denied.name} cannot be founded on this world — it is the ${plain} debug world (${WORLD_CONFIG.worldName}). Only ${plain} colonies may be founded here.`
      : `This world is the ${plain} debug world (${WORLD_CONFIG.worldName}) — only ${plain} colonies may be founded here.`;
  }
  return null;
}