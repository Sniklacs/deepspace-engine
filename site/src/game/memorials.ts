// BATTLE MEMORIALS — permanent plaques at major-battle sites (owner 2026-09-30).
//
// "Permanent plaques at major-battle sites (season/date, factions, named fallen
// heroes), persisting across all future seasons as the game's history layer."
//
// LOCKED RULES:
//   1. Qualification: 1,000+ total casualties (attacker + defender losses) OR
//      owner discretion (manual plaque via addMemorial with force=true).
//   2. Plaques NEVER wipe — they survive seasons. When the season rollover is
//      built, it must carry `state.memorials` across untouched.
//   3. The victor may add ONE epitaph line. Once set, it's locked forever.
//   4. Plaques name names: factions, casualty counts, fallen heroes.
//
// The memorial feed (CasualtyRecord in war/troops.ts) is the raw casualty data;
// plaques are the curated permanent record built from battles that qualify.

import type { GameState } from "./types";
import type { Battle } from "./war/war-types";

/** Total casualties (both sides) required for an automatic plaque. */
export const MEMORIAL_CASUALTY_THRESHOLD = 1000;

/** A permanent battle memorial plaque. */
export interface MemorialPlaque {
  /** Unique plaque id. */
  id: string;
  /** Battle that earned this plaque (raid id, siege id, etc). */
  battleId: string;
  /** Node/sector where the battle was fought. */
  nodeId: string;
  /** Human-readable site name. */
  siteName: string;
  /** Season during which the battle was fought. */
  season: string;
  /** When the battle resolved (epoch ms). */
  at: number;
  /** Attacker faction / colony name. */
  attackerName: string;
  /** Defender faction / colony name. */
  defenderName: string;
  /** Attacker troops lost. */
  attackerLosses: number;
  /** Defender troops lost. */
  defenderLosses: number;
  /** Named fallen heroes (both sides). */
  fallenHeroes: string[];
  /** Who won: "attacker" | "defender" | "draw". */
  victor: "attacker" | "defender" | "draw";
  /** Victor's epitaph line. Null until set. Locked once set. */
  epitaph: string | null;
  /** Who set the epitaph (their colony/player name). */
  epitaphBy: string | null;
}

/** Backfill safety: every save owns a memorials array. */
export function ensureMemorials(state: GameState): void {
  const s = state as any;
  if (!Array.isArray(s.memorials)) s.memorials = [];
}

/** Total deaths for plaque qualification. */
export function totalCasualties(attackerLosses: number, defenderLosses: number): number {
  return Math.max(0, attackerLosses) + Math.max(0, defenderLosses);
}

/** Does this battle qualify for an automatic plaque? */
export function qualifiesForMemorial(attackerLosses: number, defenderLosses: number): boolean {
  return totalCasualties(attackerLosses, defenderLosses) >= MEMORIAL_CASUALTY_THRESHOLD;
}

export interface MemorialInput {
  battleId: string;
  nodeId: string;
  siteName: string;
  season: string;
  attackerName: string;
  defenderName: string;
  attackerLosses: number;
  defenderLosses: number;
  fallenHeroes?: string[];
  victor: "attacker" | "defender" | "draw";
  at?: number;
  /** Owner discretion: force a plaque even below the casualty threshold. */
  force?: boolean;
}

/**
 * Create a memorial plaque. Returns null if the battle doesn't qualify and
 * force is not set. Does NOT deduplicate — callers should check battleId.
 */
export function createMemorial(input: MemorialInput): MemorialPlaque | null {
  const total = totalCasualties(input.attackerLosses, input.defenderLosses);
  if (total < MEMORIAL_CASUALTY_THRESHOLD && !input.force) return null;
  const at = input.at ?? Date.now();
  return {
    id: `memorial-${input.battleId}-${at}`,
    battleId: input.battleId,
    nodeId: input.nodeId,
    siteName: input.siteName,
    season: input.season,
    at,
    attackerName: input.attackerName,
    defenderName: input.defenderName,
    attackerLosses: Math.max(0, Math.floor(input.attackerLosses)),
    defenderLosses: Math.max(0, Math.floor(input.defenderLosses)),
    fallenHeroes: [...(input.fallenHeroes ?? [])],
    victor: input.victor,
    epitaph: null,
    epitaphBy: null,
  };
}

/**
 * The victor adds their one epitaph line. Returns an error string on failure,
 * null on success. Locked forever once set.
 */
export function addEpitaph(
  plaque: MemorialPlaque,
  epitaph: string,
  byName: string,
): string | null {
  if (plaque.epitaph !== null) return "This plaque already bears an epitaph — it is locked forever.";
  const line = epitaph.trim().slice(0, 140);
  if (line.length === 0) return "The epitaph cannot be empty.";
  plaque.epitaph = line;
  plaque.epitaphBy = byName;
  return null;
}

/** Find a plaque by battle id (dedupe check). */
export function findMemorialByBattle(memorials: MemorialPlaque[], battleId: string): MemorialPlaque | undefined {
  return memorials.find((m) => m.battleId === battleId);
}

/** All plaques for a node, newest first. */
export function memorialsForNode(memorials: MemorialPlaque[], nodeId: string): MemorialPlaque[] {
  return memorials.filter((m) => m.nodeId === nodeId).sort((a, b) => b.at - a.at);
}

/** All plaques, newest first — the history-layer browse order. */
export function allMemorials(memorials: MemorialPlaque[]): MemorialPlaque[] {
  return [...memorials].sort((a, b) => b.at - a.at);
}

/**
 * Build a MemorialInput from a resolved battle-engine Battle. Returns null
 * when the battle doesn't qualify (caller still applies force for owner
 * discretion). Bloodless arena bouts never qualify — nobody died.
 */
export function memorialInputFromBattle(
  battle: Battle,
  seasonName: string,
  now: number,
): MemorialInput | null {
  if (battle.bloodless) return null;
  const aL = Math.max(0, Math.floor(battle.casualties?.attacker ?? 0));
  const dL = Math.max(0, Math.floor(battle.casualties?.defender ?? 0));
  if (!qualifiesForMemorial(aL, dL)) return null;
  const outcome = battle.result?.outcome ?? "standoff";
  const victor =
    outcome === "attacker_victory" ? "attacker"
    : outcome === "defender_victory" ? "defender"
    : "draw";
  const heroNames = (h: { name: string }[] | undefined) => (h ?? []).map((x) => x.name).filter(Boolean);
  return {
    battleId: battle.id,
    nodeId: battle.zoneId,
    siteName: battle.zoneName || battle.zoneId,
    season: seasonName,
    attackerName: battle.attacker.colonyName,
    defenderName: battle.defender.colonyName,
    attackerLosses: aL,
    defenderLosses: dL,
    fallenHeroes: [
      ...heroNames(battle.attacker.heroSquad),
      ...heroNames(battle.defender.heroSquad),
    ],
    victor,
    at: now,
  };
}

/**
 * Victor's epitaph through the game state (the API layer calls this).
 * Returns an error string on failure, null on success.
 */
export function setEpitaphOnState(
  state: GameState,
  plaqueId: string,
  epitaph: string,
  byName: string,
): string | null {
  ensureMemorials(state);
  const plaque = (state as any).memorials.find((m: MemorialPlaque) => m.id === plaqueId);
  if (!plaque) return "That plaque doesn't exist.";
  return addEpitaph(plaque, epitaph, byName);
}

/** Every memorial-bearing node id, for map markers. */
export function memorialNodeIds(memorials: MemorialPlaque[]): Set<string> {
  return new Set(memorials.map((m) => m.nodeId));
}
