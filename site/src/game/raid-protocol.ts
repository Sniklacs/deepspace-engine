// RAID PROTOCOL — cross-server message shapes (owner 2026-10-03).
//
// When a raid launches on the attacker's server, the attacker's server
// POSTs to the defender's server:
//
//   POST {defenderUrl}/api/raid-incoming
//   { secret, raid: IncomingRaidPayload }
//
// When the raid lands and the battle resolves, the attacker's server POSTs:
//
//   POST {defenderUrl}/api/raid-result
//   { secret, result: RaidResultPayload }
//
// The defender's server writes these into the defender's save (mailbox +
// world state) so the defender sees warnings and battle reports on login.

import type { RaidLoot } from "./raids";

/** Sent when a raid launches (in_transit). The defender gets warned. */
export interface IncomingRaidPayload {
  /** Unique raid id (attacker-world-scoped). */
  raidId: string;
  /** Attacker's world id. */
  attackerWorldId: string;
  /** Attacker's world name (for display). */
  attackerWorldName: string;
  /** Names of the raiders. */
  attackerNames: string[];
  /** Defender's colony id (on the defender's world). */
  targetColonyId: string;
  /** Defender's account username (for display). */
  targetOwnerName: string;
  shipCount: number;
  troopCount: number;
  /** When the raid touches down (ms epoch). */
  landsAt: number;
  /** When the raid launched (ms epoch). */
  launchedAt: number;
}

/** Sent when the raid lands and the battle resolves. */
export interface RaidResultPayload {
  raidId: string;
  attackerWorldId: string;
  attackerNames: string[];
  targetColonyId: string;
  won: boolean;
  /** Attacker casualties (approx heads). */
  attackerLosses: number;
  /** Defender casualties (approx heads). */
  defenderLosses: number;
  lootTaken: RaidLoot;
  resolvedAt: number;
}

/** Incoming raid alert stored on the defender's world map. */
export interface IncomingRaidAlert {
  raidId: string;
  attackerWorldId: string;
  attackerWorldName: string;
  attackerNames: string[];
  targetColonyId: string;
  shipCount: number;
  troopCount: number;
  landsAt: number;
  launchedAt: number;
  /** Set when the battle result arrives. */
  resolved?: boolean;
  won?: boolean;
  lootTaken?: RaidLoot;
  /** Defender has seen this alert. */
  seen: boolean;
}
