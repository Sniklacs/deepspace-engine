// RAIDS — cross-server raiding parties (design/abandoned-colonies-world-map.md §§5,13).
//
// The heist, not the invasion: max 5 players, pre-coordinated, hit-and-run.
// A raiding party CANNOT build troops — what you carry is what you have
// (the ship cargo constraint). v1 is LOOT-ONLY: no razing, no colony
// destruction, no artifact theft (the locked rules hold).
//
// Pure data model + logic. No UI. Server-shaped records so a future
// multiplayer server migration is mechanical: the raid lives on the
// attacker's world map; when raids land, a warning is filed for the
// defender (delivered to their account by the server; in single-player
// test worlds the warning rides the same record).

import type { TroopType } from "./war/troops";
import { WORLD_JUMP_FUEL, WORLD_JUMP_SUPPLIES, type ShipClass } from "./worldmap";

/** Max raiding party size. Hans: the 5-player cap forces coordination —
 *  you can't zerg a raid, you have to plan it. The beachhead is where
 *  the zerg lives. */
export const RAID_MAX_MEMBERS = 5;

/** How long a jump takes, one way.
 *  TEST VALUE: 60s for expedited testing (Hans Oct 2 2026).
 *  PRODUCTION: hours — restore before launch. */
export const RAID_TRAVEL_MS = 60_000;

/** Jump charge is fuel/supplies, never real money (forward-base.md §4).
 *  Charged PER SHIP — a bigger fleet costs more to jump. */
export const RAID_JUMP_FUEL_PER_SHIP = WORLD_JUMP_FUEL;
export const RAID_JUMP_SUPPLIES_PER_SHIP = WORLD_JUMP_SUPPLIES;

/** Troop capacity per ship class (heads, not weight). The Fat Cat is a
 *  hauler — it carries loot, not an army. Tunable. */
export const SHIP_TROOP_CAP: Record<ShipClass, number> = {
  scout: 200,
  frigate: 800,
  bulwark: 2000,
  vanguard: 1200,
  fatcat: 500,
  herald: 300,
};

/** Loot capacity per ship class (loot units). The Fat Cat earns its name —
 *  it is the loot truck. Tunable. */
export const SHIP_LOOT_CAP: Record<ShipClass, number> = {
  scout: 1_000,
  frigate: 5_000,
  bulwark: 8_000,
  vanguard: 6_000,
  fatcat: 25_000,
  herald: 2_000,
};

export type RaidStatus =
  | "preparing" // forming up: members joining, troops loading
  | "in_transit" // jumped: flying to the target
  | "landed" // touched down: defender warned, battle resolves
  | "returning" // exfil: flying home with the loot
  | "done"; // delivered: loot in the attacker's stores

/** Loot taken in a raid. Cargo-only per the locked rule: equipped modules
 *  are NOT lootable, artifacts NEVER change hands in a raid (they only
 *  move in real PvP per the locked rule — and a raid IS real PvP, but v1
 *  keeps it to supplies/embers/materials; artifacts stay out). */
export interface RaidLoot {
  supplies: number;
  embers: number;
  /** Vehicle fuel (gas). */
  fuel: number;
  battery: number;
  medkit: number;
  mechkit: number;
  armorkit: number;
  hazmat: number;
  shots: number;
}

export const EMPTY_RAID_LOOT: RaidLoot = {
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

/** A raiding party. Lives on the leader's worldMap (raids array). */
export interface RaidParty {
  id: string; // `raid-<seq>`
  leaderId: string; // colony id
  leaderName: string;
  /** Member colony ids (includes the leader). Max RAID_MAX_MEMBERS. */
  memberIds: string[];
  memberNames: string[];
  /** Ship ids committed to the raid (status → "deployed" while out). */
  shipIds: string[];
  /** Ship classes (parallel to shipIds) for capacity math without a join. */
  shipClasses: ShipClass[];
  /** Troops committed, per member, per type. Moved OUT of the home roster
   *  on commit — what you carry is all you have. */
  troops: Record<string, Partial<Record<TroopType, number>>>;
  targetServerId: string;
  targetColonyId: string;
  targetOwnerName: string;
  status: RaidStatus;
  departedAt?: number;
  landsAt?: number;
  returnedAt?: number; // landsAt of the return leg
  /** Battle outcome (filled when landed resolves). */
  won?: boolean;
  attackerLosses?: Partial<Record<TroopType, number>>;
  defenderLosses?: number; // approx headcount
  lootTaken?: RaidLoot;
  /** Monotonic per-worldMap counter is the source of ids. */
  seq: number;
}

/** The warning a defender gets the moment attackers touch down.
 *  Hans: "they know they're going to be exposed the minute they touch
 *  down... that means it's a real mission, not just going in and
 *  getting free stuff." Stored so the defender sees it on login. */
export interface RaidWarning {
  raidId: string;
  attackerNames: string[];
  shipCount: number;
  troopCount: number;
  landedAt: number;
  targetColonyId: string;
  /** v1: warnings are filed on the attacker's record (single-player test
   *  worlds); the server delivers them to the defender's account later. */
  seen: boolean;
}

/** Raid state on the world map. Optional on WorldMapState for migration. */
export interface RaidState {
  raids: RaidParty[];
  warnings: RaidWarning[];
}

export function emptyRaidState(): RaidState {
  return { raids: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Total troops committed to a raid (heads). */
export function raidTroopCount(raid: RaidParty): number {
  let n = 0;
  for (const byType of Object.values(raid.troops)) {
    for (const c of Object.values(byType)) n += c ?? 0;
  }
  return n;
}

/** Total troop capacity of the raid's ships. */
export function raidTroopCapacity(raid: RaidParty): number {
  return raid.shipClasses.reduce((n, c) => n + (SHIP_TROOP_CAP[c] ?? 0), 0);
}

/** Total loot capacity of the raid's ships. */
export function raidLootCapacity(raid: RaidParty): number {
  return raid.shipClasses.reduce((n, c) => n + (SHIP_LOOT_CAP[c] ?? 0), 0);
}

/** Jump charge for the raid's ships (fuel + supplies). */
export function raidJumpCharge(raid: RaidParty): { fuel: number; supplies: number } {
  return {
    fuel: raid.shipIds.length * RAID_JUMP_FUEL_PER_SHIP,
    supplies: raid.shipIds.length * RAID_JUMP_SUPPLIES_PER_SHIP,
  };
}

/** Loot units total (for cargo-cap math). */
export function raidLootTotal(loot: RaidLoot): number {
  return (
    loot.supplies + loot.embers + loot.fuel + loot.battery +
    loot.medkit + loot.mechkit + loot.armorkit + loot.hazmat + loot.shots
  );
}

/** Cap loot to the fleet's cargo capacity, scaling proportionally. */
export function capLootToCargo(loot: RaidLoot, capacity: number): RaidLoot {
  const total = raidLootTotal(loot);
  if (total <= capacity || total <= 0) return { ...loot };
  const f = capacity / total;
  const scaled = (n: number) => Math.floor(n * f);
  return {
    supplies: scaled(loot.supplies),
    embers: scaled(loot.embers),
    fuel: scaled(loot.fuel),
    battery: scaled(loot.battery),
    medkit: scaled(loot.medkit),
    mechkit: scaled(loot.mechkit),
    armorkit: scaled(loot.armorkit),
    hazmat: scaled(loot.hazmat),
    shots: scaled(loot.shots),
  };
}

// ---------------------------------------------------------------------------
// Party management (pure; the caller owns persistence + resource moves)
// ---------------------------------------------------------------------------

/** Create a raid party in "preparing". The leader is member #1. */
export function createRaidParty(
  leaderId: string,
  leaderName: string,
  seq: number,
): RaidParty {
  return {
    id: `raid-${seq}`,
    leaderId,
    leaderName,
    memberIds: [leaderId],
    memberNames: [leaderName],
    shipIds: [],
    shipClasses: [],
    troops: { [leaderId]: {} },
    targetServerId: "",
    targetColonyId: "",
    targetOwnerName: "",
    status: "preparing",
    seq,
  };
}

/** Add a member (max 5, preparing only). */
export function joinRaidParty(
  raid: RaidParty,
  memberId: string,
  memberName: string,
): { ok: boolean; error?: string } {
  if (raid.status !== "preparing") return { ok: false, error: "That raid has already launched — no late joiners." };
  if (raid.memberIds.includes(memberId)) return { ok: false, error: "Already in the raid party." };
  if (raid.memberIds.length >= RAID_MAX_MEMBERS) {
    return { ok: false, error: `Raid parties cap at ${RAID_MAX_MEMBERS} — coordinate a second party.` };
  }
  raid.memberIds.push(memberId);
  raid.memberNames.push(memberName);
  raid.troops[memberId] = {};
  return { ok: true };
}

/** Commit troops to the raid (validates against the member's available heads).
 *  The caller moves the troops out of the home roster. */
export function commitRaidTroops(
  raid: RaidParty,
  memberId: string,
  type: string,
  count: number,
): { ok: boolean; error?: string } {
  if (raid.status !== "preparing") return { ok: false, error: "Troops lock when the raid launches." };
  if (!raid.memberIds.includes(memberId)) return { ok: false, error: "Not a member of this raid party." };
  const n = Math.trunc(count);
  if (!(n > 0)) return { ok: false, error: "Commit at least one troop." };
  const byType = raid.troops[memberId] ?? {};
  const after = raidTroopCount(raid) + n;
  if (after > raidTroopCapacity(raid)) {
    return {
      ok: false,
      error: `The fleet only carries ${raidTroopCapacity(raid)} troops — ${after} is too many. Bring more ships.`,
    };
  }
  byType[type as TroopType] = (byType[type as TroopType] ?? 0) + n;
  raid.troops[memberId] = byType;
  return { ok: true };
}

/** Set the raid's target (preparing only). */
export function setRaidTarget(
  raid: RaidParty,
  targetServerId: string,
  targetColonyId: string,
  targetOwnerName: string,
): { ok: boolean; error?: string } {
  if (raid.status !== "preparing") return { ok: false, error: "Target locks when the raid launches." };
  if (!targetServerId || !targetColonyId) return { ok: false, error: "Pick a target colony first." };
  raid.targetServerId = targetServerId;
  raid.targetColonyId = targetColonyId;
  raid.targetOwnerName = targetOwnerName;
  return { ok: true };
}

/** Validate a raid is launchable. Returns the first blocker. */
export function raidLaunchBlocker(raid: RaidParty): string | null {
  if (raid.status !== "preparing") return "That raid already launched.";
  if (!raid.targetServerId || !raid.targetColonyId) return "Pick a target colony on the world map first.";
  if (raid.shipIds.length === 0) return "Assign at least one jump ship — the party needs a ride.";
  if (raidTroopCount(raid) === 0) return "Load troops onto the ships — what you carry is all you have.";
  return null;
}

// ---------------------------------------------------------------------------
// Battle resolution (v1: loot-only, supply-weight power)
// ---------------------------------------------------------------------------
//
// Hans locked v1 troop stats: combat power is supply weight, nothing else.
// Attacker power = committed troops' supply weight. Defender power = the
// colony's approximate troop count at average weight. No battle engine
// theatrics in v1 — a clean, legible power comparison with casualty rates.

export interface RaidBattleInput {
  /** Attacker troops by type (heads). */
  attacker: Partial<Record<TroopType, number>>;
  /** Attacker supply weight per type. */
  weights: Record<TroopType, number>;
  /** Defender approximate headcount. */
  defenderTroops: number;
  /** What's lootable at the colony (supplies/embers/materials). */
  defenderLoot: RaidLoot;
  /** Fleet cargo capacity (loot units). */
  cargoCapacity: number;
}

export interface RaidBattleResult {
  won: boolean;
  /** Attacker casualties by type (heads). */
  attackerLosses: Partial<Record<TroopType, number>>;
  /** Defender casualties (approx heads). */
  defenderLosses: number;
  lootTaken: RaidLoot;
}

/**
 * Resolve a raid battle. Deterministic (no Math.random — the same inputs
 * always give the same outcome, like the battle engine's §15 discipline).
 *
 * Outcome tiers by power ratio (attacker / defender):
 *   ≥ 2.0  decisive win:  10% attacker losses, 80% of loot
 *   ≥ 1.0  win:           25% attacker losses, 50% of loot
 *   ≥ 0.5  pyrrhic:       60% attacker losses, 20% of loot
 *   < 0.5  loss:          90% attacker losses, no loot
 *
 * Defender losses scale with attacker power committed. Loot is cargo-capped.
 * Artifacts are never in the loot pool (locked rule).
 */
export function resolveRaidBattle(input: RaidBattleInput): RaidBattleResult {
  const attackerPower = (Object.entries(input.attacker) as [TroopType, number][])
    .reduce((p, [type, count]) => p + (count ?? 0) * (input.weights[type] ?? 1), 0);
  const defenderPower = Math.max(1, input.defenderTroops); // avg weight 1
  const ratio = attackerPower / defenderPower;

  let lossRate: number;
  let lootShare: number;
  let won: boolean;
  if (ratio >= 2) { lossRate = 0.10; lootShare = 0.80; won = true; }
  else if (ratio >= 1) { lossRate = 0.25; lootShare = 0.50; won = true; }
  else if (ratio >= 0.5) { lossRate = 0.60; lootShare = 0.20; won = true; }
  else { lossRate = 0.90; lootShare = 0; won = false; }

  const attackerLosses: Partial<Record<TroopType, number>> = {};
  for (const [type, count] of Object.entries(input.attacker) as [TroopType, number][]) {
    const lost = Math.floor((count ?? 0) * lossRate);
    if (lost > 0) attackerLosses[type] = lost;
  }

  // Defender bleeds proportionally to what hit them (capped at their force).
  const defenderLosses = Math.min(
    input.defenderTroops,
    Math.floor(attackerPower * (won ? 0.4 : 0.15)),
  );

  const rawLoot: RaidLoot = won
    ? {
        supplies: Math.floor(input.defenderLoot.supplies * lootShare),
        embers: Math.floor(input.defenderLoot.embers * lootShare),
        fuel: Math.floor(input.defenderLoot.fuel * lootShare),
        battery: Math.floor(input.defenderLoot.battery * lootShare),
        medkit: Math.floor(input.defenderLoot.medkit * lootShare),
        mechkit: Math.floor(input.defenderLoot.mechkit * lootShare),
        armorkit: Math.floor(input.defenderLoot.armorkit * lootShare),
        hazmat: Math.floor(input.defenderLoot.hazmat * lootShare),
        shots: Math.floor(input.defenderLoot.shots * lootShare),
      }
    : { ...EMPTY_RAID_LOOT };

  const lootTaken = capLootToCargo(rawLoot, input.cargoCapacity);
  return { won, attackerLosses, defenderLosses, lootTaken };
}

// ---------------------------------------------------------------------------
// Mock defender stores (test worlds; the server provides real ones later)
// ---------------------------------------------------------------------------

/** Deterministic 32-bit hash (for stable mock values). */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mock lootable stores for an ACTIVE colony. Deterministic per colonyId.
 * The real server provides the defender's actual stores later; until then
 * this gives the test world honest, stable numbers to raid. Artifacts are
 * NEVER in here (locked rule).
 */
export function mockDefenderLoot(colonyId: string): RaidLoot {
  const h = hash32(`raid-loot:${colonyId}`);
  return {
    supplies: 5_000 + (h % 45_000),
    embers: 100 + ((h >>> 7) % 900),
    fuel: 50 + ((h >>> 13) % 450),
    battery: 20 + ((h >>> 17) % 180),
    medkit: 10 + ((h >>> 21) % 90),
    mechkit: 10 + ((h >>> 25) % 90),
    armorkit: 5 + (h % 45),
    hazmat: 5 + ((h >>> 3) % 45),
    shots: 5 + ((h >>> 11) % 45),
  };
}
