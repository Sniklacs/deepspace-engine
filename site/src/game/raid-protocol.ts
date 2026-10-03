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
  /** Ship classes in the raid (parallel to the attacker's shipIds). Used for
   *  stage-2 partial / stage-3 full ship intel on the satellite alarm. */
  shipClasses?: import("./worldmap").ShipClass[];
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
  /** Defender's account username (for display on the alarm). */
  targetOwnerName?: string;
  shipCount: number;
  /** Ship classes in the raid (when the attacker reported them). */
  shipClasses?: import("./worldmap").ShipClass[];
  troopCount: number;
  landsAt: number;
  launchedAt: number;
  /** Set when the battle result arrives. */
  resolved?: boolean;
  won?: boolean;
  lootTaken?: RaidLoot;
  /** Defender has seen this alert. */
  seen: boolean;
  /** The satellite alarm already fired for this raid (tick sweep + server
   *  receipt both check this — the klaxon sounds exactly once per raid). */
  alarmFired?: boolean;
}

// ---------------------------------------------------------------------------
// RAID ALARM — the satellite klaxon (owner 2026-10-03).
//
// Detection is satellite-only. When an incoming raid heads for a node whose
// satellite sits at stage >= 1, the alarm fires: a full-screen visual klaxon
// + synthesized siren + alliance-wide broadcast. Stage 0 (blind) = nothing.
//
// Detail is stage-gated (owner refinement 2026-10-03):
//   stage 1 (online):    "UNIDENTIFIED SIGNATURE" + node name. Nothing else.
//   stage 2 (tracking):  + identity (attacker names/world) + PARTIAL ship
//                        types (50–70% of classes present, never 100%).
//   stage 3 (full):      + every ship class + troop count.
// ---------------------------------------------------------------------------

/** A fired raid alarm. Lives on GameState (raidAlarm) — persists across
 *  refreshes, cleared on acknowledge or when the raid lands/resolves. */
export interface RaidAlarm {
  raidId: string;
  /** Node the raid is inbound to (the defender colony's node). */
  nodeId: string;
  nodeName: string;
  /** Satellite intel level that fired this alarm. */
  intel: "presence" | "identity" | "full";
  /** Stage 2+: who is coming. Absent at stage 1. */
  attackerWorldName?: string;
  attackerNames?: string[];
  /** Stage 2: PARTIAL ship classes (subset, never all when >1 class).
   *  Stage 3: every class present. Absent at stage 1. */
  revealedShipClasses?: import("./worldmap").ShipClass[];
  /** True when more ship classes exist than revealed (stage 2 partial). */
  shipsPartial?: boolean;
  /** Stage 3 only: total attacking hulls. */
  shipCount?: number;
  /** Stage 3 only: approximate attacking troops. */
  troopCount?: number;
  targetColonyId: string;
  targetOwnerName: string;
  landsAt: number;
  launchedAt: number;
  triggeredAt: number;
}
