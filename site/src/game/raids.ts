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
import type { ManeuverVector } from "./war/war-types";
import type { TacticalBattle, OrdersMap } from "./war/tactical-combat";
import { startTacticalBattle, resolveRound, quickResolve } from "./war/tactical-combat";

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

/** Ship combat stats (owner 2026-10-03): firepower = damage output in power
 *  units, on the same scale as troop supply-weight power — a Vanguard hits
 *  like ~140 Reavers. Tunable, like the capacity tables above. */
export const SHIP_FIREPOWER: Record<ShipClass, number> = {
  scout: 20, // fast, fragile — eyes, not guns
  frigate: 80, // the balanced workhorse
  bulwark: 60, // a wall with teeth — defense is its weapon
  vanguard: 140, // the heavy hitter
  fatcat: 10, // a loot truck with a peashooter
  herald: 40, // support guns for the fleet
};

/** Ship combat stats (owner 2026-10-03): hull = armor that soaks ground
 *  fire when ships land. Higher hull = cheaper field repairs. Tunable. */
export const SHIP_HULL: Record<ShipClass, number> = {
  scout: 40, // paper-thin
  frigate: 160,
  bulwark: 400, // shrugs off ground fire
  vanguard: 220,
  fatcat: 200, // thick-skinned hauler
  herald: 120,
};

/** Orbital fire support: holding-pattern ships add this × their firepower
 *  to attacker power (bombardment from orbit — safe). */
export const ORBITAL_FIRE_SUPPORT_FACTOR = 0.5;
/** Landed fire support: landed ships add this × their firepower to attacker
 *  power (close support — dangerous). */
export const LANDED_FIRE_SUPPORT_FACTOR = 1.0;

export type RaidStatus =
  | "preparing" // forming up: members joining, troops loading
  | "in_transit" // jumped: flying to the target
  | "deploying" // touched down: player assigns troops to entry vectors (owner 2026-10-03)
  | "tactical" // battle in progress: player issues orders per round (owner 2026-10-03)
  | "landed" // battle resolved: defender warned, loot secured
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

/** A deserter band encountered during a raid (owner 2026-10-03). */
export interface RaidDeserterBand {
  id: string; // `deserter-<raidId>`
  /** Troops by type — a mix of whatever walked away. */
  troops: Partial<Record<TroopType, number>>;
  /** Asking price in supplies. UNKNOWN until the encounter — this is why
   *  Hans says to bring a buffer. Randomized per raid (deterministic). */
  price: number;
  /** One-shot: once hired or dismissed, they're gone. */
  resolved: boolean;
  /** True = hired, false = dismissed. Only meaningful when resolved. */
  hired?: boolean;
}

/** Chance of a deserter encounter at touchdown (owner 2026-10-03). Tunable. */
export const DESERTER_ENCOUNTER_CHANCE = 0.35;

/** Deserter band size range (heads). */
export const DESERTER_BAND_MIN = 80;
export const DESERTER_BAND_MAX = 400;

/** Asking price per head in supplies (randomized within this range). */
export const DESERTER_PRICE_PER_HEAD_MIN = 15;
export const DESERTER_PRICE_PER_HEAD_MAX = 40;

/** A raiding party. Lives on the leader's worldMap (raids array). */
export interface RaidParty {
  id: string; // `raid-<seq>`
  leaderId: string; // colony id
  leaderName: string;
  /** Short invite code for party joining (e.g. "K7X2M9"). Alliance members
   *  join via the code — up to RAID_MAX_MEMBERS total. */
  inviteCode: string;
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
  /** Supplies loaded for the raid (owner 2026-10-03): for hiring deserters,
   *  field expenses, emergency use. Moved OUT of home stockpile on commit. */
  supplies: number;
  /** Deserter encounter (owner 2026-10-03): rolled at touchdown. If a band
   *  is waiting, the player can hire them (supplies) or dismiss them. */
  deserters?: RaidDeserterBand | null;
  targetServerId: string;
  targetColonyId: string;
  targetOwnerName: string;
  /** Tactical deployment (owner 2026-10-03): player's troop assignments to
   *  entry vectors, set during the "deploying" phase after touchdown.
   *  Keys are ManeuverVector; values are troop counts by type. */
  deployment?: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>;
  /** Ship holding pattern (owner 2026-10-03): true = ships hold in orbit
   *  (safe from ground defenses, fast extract); false = ships land with
   *  troops (participate in battle, higher risk/reward). Default true. */
  shipsHoldOrbit?: boolean;
  /** Tactical battle (owner 2026-10-03): the live round-based battle entity
   *  once deployment is committed. Lives on the raid so rounds can be
   *  resolved across ticks/saves. Set when status → "tactical". */
  tacticalBattle?: TacticalBattle | null;
  status: RaidStatus;
  departedAt?: number;
  landsAt?: number;
  returnedAt?: number; // landsAt of the return leg
  /** Formation origin (owner 2026-10-04): when a raid is deployed from a
   *  standby formation, the formation id rides along so the raid's
   *  completion can retire the formation. */
  formationId?: string;
  /** Hero leader (owner 2026-10-04): the formation's assigned leader who
   *  marches with the raid. Display only in v1 — the tactical battle's
   *  defender AI doesn't counter heroes yet. */
  heroId?: string;
  heroName?: string;
  /** Battle outcome (filled when landed resolves). */
  won?: boolean;
  attackerLosses?: Partial<Record<TroopType, number>>;
  defenderLosses?: number; // approx headcount
  lootTaken?: RaidLoot;
  /** Set when the battle resolves and the result needs delivery to the
   *  defender's server. The api layer picks this up and POSTs to
   *  /api/raid-result, then clears it. (Cross-server, owner 2026-10-03.) */
  resultPendingDelivery?: boolean;
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
  /** Incoming raids from OTHER worlds (cross-server). Populated by the
   *  /api/raid-incoming endpoint when an attacker's server notifies us.
   *  The defender sees these as warnings + mailbox alerts. */
  incomingRaids: import("./raid-protocol").IncomingRaidAlert[];
}

export function emptyRaidState(): RaidState {
  return { raids: [], warnings: [], incomingRaids: [] };
}

/** Generate a short invite code for raid party joining. */
export function makeInviteCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 (readability)
  let code = "";
  // Mix time + randomness so rapid successive calls don't collide.
  const seed = Date.now() ^ (Math.floor(Math.random() * 0xffffffff) >>> 0);
  let s = seed >>> 0;
  for (let i = 0; i < 6; i++) {
    // xorshift32 for decent distribution without crypto overhead.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    code += chars[s % chars.length];
  }
  return code;
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
    inviteCode: makeInviteCode(),
    memberIds: [leaderId],
    memberNames: [leaderName],
    shipIds: [],
    shipClasses: [],
    troops: { [leaderId]: {} },
    supplies: 0,
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

/** All five entry vectors (owner 2026-10-03). */
export const RAID_VECTORS: ManeuverVector[] = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"];

/** Validate a raid deployment. Returns the first blocker. */
export function raidDeployBlocker(
  raid: RaidParty,
  deployment: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>,
): string | null {
  if (raid.status !== "deploying") return "That raid isn't deploying troops right now.";
  // At least one troop assigned somewhere.
  let total = 0;
  for (const troops of Object.values(deployment)) {
    for (const n of Object.values(troops ?? {})) total += n ?? 0;
  }
  if (total === 0) return "Assign at least one troop group to a vector.";
  // Can't deploy more than the raid carries.
  const carried = raidTroopCount(raid);
  if (total > carried) return `That's ${total.toLocaleString()} troops — the raid only carries ${carried.toLocaleString()}.`;
  // REAR requires 20% Warden escort (locked design).
  const rear = deployment.REAR;
  if (rear) {
    let rearTotal = 0;
    let rearWardens = 0;
    for (const [t, n] of Object.entries(rear) as [TroopType, number][]) {
      rearTotal += n ?? 0;
      if (t === "warden") rearWardens += n ?? 0;
    }
    if (rearTotal > 0 && rearWardens < rearTotal * 0.2) {
      return "REAR entry needs a 20% Warden escort — the rear is exposed without them.";
    }
  }
  return null;
}

/** Commit the player's tactical deployment. The tactical battle starts on
 *  the next tick (engine starts it with the defender's real strength) and
 *  the player then issues orders round by round — no more auto-resolve. */
export function deployRaidTroops(
  raid: RaidParty,
  deployment: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>,
  shipsHoldOrbit: boolean,
): { ok: boolean; error?: string } {
  const blocker = raidDeployBlocker(raid, deployment);
  if (blocker) return { ok: false, error: blocker };
  raid.deployment = deployment;
  raid.shipsHoldOrbit = shipsHoldOrbit;
  raid.tacticalBattle = null;
  raid.status = "tactical"; // battle starts on next tick; player commands it round by round
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tactical battle lifecycle (owner 2026-10-03)
// ---------------------------------------------------------------------------
//
// The old flow auto-resolved the battle on the next tick after deployment.
// Now the battle is a live round-based engagement: the engine starts a
// TacticalBattle from the deployment, the player issues orders per round via
// tacticalRaidRound(), and when the battle ends the result converts to the
// raid's won/loot/losses exactly like the old resolution did.

/** Start the tactical battle for a raid. Called by the engine tick when a
 *  "tactical" raid has no battle yet. The defender's strength comes from
 *  the map (same source the old auto-resolve used). */
export function startTacticalRaidBattle(
  raid: RaidParty,
  defenderTroops: number,
  now: number,
): { ok: boolean; error?: string } {
  if (raid.status !== "tactical") return { ok: false, error: "That raid isn't fighting a tactical battle." };
  if (raid.tacticalBattle) return { ok: false, error: "That battle is already underway." };
  if (!raid.deployment) return { ok: false, error: "No deployment — deploy your troops first." };
  const fleetFirepower = (raid.shipClasses ?? []).reduce((s, c) => s + (SHIP_FIREPOWER[c] ?? 0), 0);
  raid.tacticalBattle = startTacticalBattle({
    battleId: `tb-${raid.id}`,
    raidId: raid.id,
    deployment: raid.deployment,
    defenderTroops,
    shipsHoldOrbit: raid.shipsHoldOrbit ?? true,
    shipFirepower: fleetFirepower,
    now,
  });
  return { ok: true };
}

/** Resolve one tactical round for a raid. Attacker orders required; the
 *  defender is driven by the deterministic AI unless defenderOrders are
 *  passed (a live defender's orders — future pass). */
export function tacticalRaidRound(
  raid: RaidParty,
  orders: OrdersMap,
  now: number,
): { ok: boolean; error?: string } {
  if (raid.status !== "tactical") return { ok: false, error: "That raid isn't fighting a tactical battle." };
  const battle = raid.tacticalBattle;
  if (!battle) return { ok: false, error: "The battle hasn't started yet." };
  const res = resolveRound(battle, orders, undefined, now);
  if (!res.ok) return { ok: false, error: res.error };
  raid.tacticalBattle = battle;
  return { ok: true };
}

/** Quick-resolve: auto-play the remaining rounds with hold/hold orders.
 *  For commanders who can't stay for the whole battle. Deterministic. */
export function quickResolveTacticalRaid(raid: RaidParty, now: number): { ok: boolean; error?: string } {
  if (raid.status !== "tactical") return { ok: false, error: "That raid isn't fighting a tactical battle." };
  const battle = raid.tacticalBattle;
  if (!battle) return { ok: false, error: "The battle hasn't started yet." };
  if (battle.status !== "active") return { ok: false, error: "That battle is already over." };
  quickResolve(battle, now);
  raid.tacticalBattle = battle;
  return { ok: true };
}

/** Loot share by tactical loot tier (0–3: loss/pyrrhic/win/decisive).
 *  Matches the old auto-resolve tiers exactly. */
export const TACTICAL_LOOT_SHARE: Record<0 | 1 | 2 | 3, number> = {
  0: 0, 1: 0.20, 2: 0.50, 3: 0.80,
};

/** Convert a finished tactical battle into raid results: won, loot, losses.
 *  Mirrors the old resolveRaidBattle output shape so the rest of the raid
 *  pipeline (return leg, tithe, memorials, cross-server delivery) works
 *  unchanged. */
export function tacticalRaidResult(
  raid: RaidParty,
  defenderLoot: RaidLoot,
): {
  won: boolean;
  decisive: boolean;
  attackerLosses: Partial<Record<TroopType, number>>;
  defenderLosses: number;
  lootTaken: RaidLoot;
} {
  const battle = raid.tacticalBattle;
  const tier = (battle?.lootTier ?? 0) as 0 | 1 | 2 | 3;
  const won = battle?.status === "attacker_won";
  const decisive = tier === 3;
  const attackerLosses: Partial<Record<TroopType, number>> = { ...(battle?.totalAttackerLosses ?? {}) };
  const defenderLosses = battle
    ? (Object.values(battle.totalDefenderLosses) as number[]).reduce((n, c) => n + (c ?? 0), 0)
    : 0;
  const share = TACTICAL_LOOT_SHARE[tier];
  const rawLoot: RaidLoot = won
    ? {
        supplies: Math.floor(defenderLoot.supplies * share),
        embers: Math.floor(defenderLoot.embers * share),
        fuel: Math.floor(defenderLoot.fuel * share),
        battery: Math.floor(defenderLoot.battery * share),
        medkit: Math.floor(defenderLoot.medkit * share),
        mechkit: Math.floor(defenderLoot.mechkit * share),
        armorkit: Math.floor(defenderLoot.armorkit * share),
        hazmat: Math.floor(defenderLoot.hazmat * share),
        shots: Math.floor(defenderLoot.shots * share),
      }
    : { ...EMPTY_RAID_LOOT };
  const lootTaken = capLootToCargo(rawLoot, raidLootCapacity(raid));
  return { won, decisive, attackerLosses, defenderLosses, lootTaken };
}

// ---------------------------------------------------------------------------
// Deserter encounters (owner 2026-10-03)
// ---------------------------------------------------------------------------
//
// After touchdown, there's a chance a deserter/mercenary band is waiting.
// They offer to join for an UNKNOWN amount of supplies — the player only
// learns the price when the encounter happens, which is why Hans says to
// bring a supply buffer. Deterministic per raid (hash of raid id), so the
// encounter is stable across ticks and testable.

/** Total heads in a deserter band. */
export function deserterBandCount(band: RaidDeserterBand): number {
  let n = 0;
  for (const c of Object.values(band.troops)) n += c ?? 0;
  return n;
}

/** Roll for a deserter encounter at touchdown. Returns the band or null.
 *  Deterministic: same raid id always gives the same result. */
export function rollDeserterEncounter(raid: RaidParty): RaidDeserterBand | null {
  const h = hash32(`deserters:${raid.id}:${raid.landsAt ?? 0}`);
  if ((h % 100) >= Math.floor(DESERTER_ENCOUNTER_CHANCE * 100)) return null;

  // Band size: 80–400 heads.
  const size = DESERTER_BAND_MIN + (h >>> 8) % (DESERTER_BAND_MAX - DESERTER_BAND_MIN + 1);

  // Composition: 2–4 troop types, split weighted by hash slices.
  const types: TroopType[] = ["bulwark", "reaver", "longeye", "thunder", "warden"];
  const typeCount = 2 + (h >>> 16) % 3;
  const picked: TroopType[] = [];
  let hh = h >>> 20;
  while (picked.length < typeCount) {
    const t = types[(hh >>> 0) % types.length];
    if (!picked.includes(t)) picked.push(t);
    // Keep hh unsigned — a signed XOR result would make hh % 5 negative.
    hh = (((hh >>> 3) ^ ((hh << 5) >>> 0)) >>> 0);
    if (hh === 0) hh = (h ^ 0x9e3779b9) >>> 0;
  }
  const troops: Partial<Record<TroopType, number>> = {};
  let remaining = size;
  for (let i = 0; i < picked.length; i++) {
    const share = i === picked.length - 1 ? remaining : Math.max(1, Math.floor(size * ((hh % 40 + 10) / 100)));
    const n = Math.min(share, remaining - (picked.length - i - 1));
    troops[picked[i]] = n;
    remaining -= n;
    hh = (hh >>> 4) ^ (h >>> (i * 3));
  }

  // Price: per-head rate randomized 15–40 supplies, times band size.
  const perHead = DESERTER_PRICE_PER_HEAD_MIN + (h >>> 24) % (DESERTER_PRICE_PER_HEAD_MAX - DESERTER_PRICE_PER_HEAD_MIN + 1);
  const price = deserterBandCount({ id: "", troops, price: 0, resolved: false }) * perHead;

  return {
    id: `deserter-${raid.id}`,
    troops,
    price,
    resolved: false,
  };
}

/** Hire the deserter band: deduct supplies from raid cargo, add troops to
 *  the raid. Deserters join on the ground — they don't need ship capacity
 *  (they were never loaded on ships). */
export function hireRaidDeserters(
  raid: RaidParty,
  bandId: string,
): { ok: boolean; error?: string } {
  if (raid.status !== "deploying") return { ok: false, error: "That raid isn't deploying troops right now." };
  const band = raid.deserters;
  if (!band || band.id !== bandId) return { ok: false, error: "No deserter band waiting." };
  if (band.resolved) return { ok: false, error: "Those deserters have already made up their minds." };
  if ((raid.supplies ?? 0) < band.price) {
    return {
      ok: false,
      error: `They want ${band.price.toLocaleString()} supplies — you only brought ${(raid.supplies ?? 0).toLocaleString()}.`,
    };
  }
  raid.supplies -= band.price;
  const byType = raid.troops["deserters"] ?? {};
  for (const [t, n] of Object.entries(band.troops) as [TroopType, number][]) {
    byType[t] = (byType[t] ?? 0) + (n ?? 0);
  }
  raid.troops["deserters"] = byType;
  band.resolved = true;
  band.hired = true;
  return { ok: true };
}

/** Dismiss the deserter band — they're gone. */
export function dismissRaidDeserters(
  raid: RaidParty,
  bandId: string,
): { ok: boolean; error?: string } {
  if (raid.status !== "deploying") return { ok: false, error: "That raid isn't deploying troops right now." };
  const band = raid.deserters;
  if (!band || band.id !== bandId) return { ok: false, error: "No deserter band waiting." };
  if (band.resolved) return { ok: false, error: "Those deserters have already made up their minds." };
  band.resolved = true;
  band.hired = false;
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
  /** Tactical deployment (owner 2026-10-03): troop assignments to entry vectors.
   *  When provided, surprise bonuses apply per vector. When omitted, all troops
   *  fight at base strength (v1 auto-resolve behavior). */
  deployment?: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>;
  /** Ship posture (owner 2026-10-03): true = ships hold in orbit (safe,
   *  orbital fire support); false = ships land (full firepower, ground-fire
   *  risk scaled by hull). */
  shipsHoldOrbit?: boolean;
  /** Ship classes committed to the raid (owner 2026-10-03): drives
   *  stat-based fire support (SHIP_FIREPOWER) and ground-fire risk
   *  (SHIP_HULL). Omitted = no fleet, no fire support. */
  shipClasses?: ShipClass[];
  /** Defender approximate headcount. */
  defenderTroops: number;
  /** What's lootable at the colony (supplies/embers/materials). */
  defenderLoot: RaidLoot;
  /** Fleet cargo capacity (loot units). */
  cargoCapacity: number;
}

export interface RaidBattleResult {
  won: boolean;
  /** Decisive victory (power ratio ≥ 2.0). Against a sub colony, a decisive
   *  win SEIZES it — ownership transfers to the raid leader. */
  decisive: boolean;
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
  // Base power from troops.
  let attackerPower = (Object.entries(input.attacker) as [TroopType, number][])
    .reduce((p, [type, count]) => p + (count ?? 0) * (input.weights[type] ?? 1), 0);

  // Tactical deployment bonuses (owner 2026-10-03): entry vectors grant
  // surprise multipliers on the troops assigned to them.
  //   MAIN: 1.0x (no bonus, frontal assault)
  //   FLANK_LEFT/RIGHT: 1.25x (hidden until entry)
  //   REAR: 1.5x (highest surprise, hardest to pull off)
  //   RESERVE: 1.0x (held back, no surprise but no extra risk)
  if (input.deployment) {
    const VECTOR_BONUS: Record<ManeuverVector, number> = {
      MAIN: 1.0,
      FLANK_LEFT: 1.25,
      FLANK_RIGHT: 1.25,
      REAR: 1.5,
      RESERVE: 1.0,
    };
    let deployedPower = 0;
    for (const [vector, troops] of Object.entries(input.deployment) as [ManeuverVector, Partial<Record<TroopType, number>>][]) {
      const bonus = VECTOR_BONUS[vector] ?? 1.0;
      const vecPower = (Object.entries(troops) as [TroopType, number][])
        .reduce((p, [type, count]) => p + (count ?? 0) * (input.weights[type] ?? 1), 0);
      deployedPower += vecPower * bonus;
    }
    // Use the deployed power if a deployment was provided (it should cover
    // all troops; fall back to base power if the deployment is empty).
    if (deployedPower > 0) attackerPower = deployedPower;
  }

  // Ship posture (owner 2026-10-03): fire support is stat-based, not flat.
  // Holding orbit (default, safe): ships bombard from orbit — half their
  // firepower joins the attack at zero risk. Landed: full firepower in
  // close support, but ground fire chews the hulls — repair costs scale
  // inversely with total hull (a tanky fleet shrugs it off, a fragile
  // fleet pays dearly).
  const fleet = input.shipClasses ?? [];
  const fleetFirepower = fleet.reduce((s, c) => s + (SHIP_FIREPOWER[c] ?? 0), 0);
  const fleetHull = fleet.reduce((s, c) => s + (SHIP_HULL[c] ?? 0), 0);
  if (input.shipsHoldOrbit === false) {
    attackerPower += fleetFirepower * LANDED_FIRE_SUPPORT_FACTOR;
  } else {
    attackerPower += fleetFirepower * ORBITAL_FIRE_SUPPORT_FACTOR;
  }

  const defenderPower = Math.max(1, input.defenderTroops); // avg weight 1
  const ratio = attackerPower / defenderPower;

  let lossRate: number;
  let lootShare: number;
  let won: boolean;
  let decisive = false;
  if (ratio >= 2) { lossRate = 0.10; lootShare = 0.80; won = true; decisive = true; }
  else if (ratio >= 1) { lossRate = 0.25; lootShare = 0.50; won = true; }
  else if (ratio >= 0.5) { lossRate = 0.60; lootShare = 0.20; won = true; }
  else { lossRate = 0.90; lootShare = 0; won = false; }

  // Ships that land risk ground-fire losses: repair cost scales inversely
  // with hull — 2% of loot for a tanky fleet, up to 15% for a fragile one.
  if (input.shipsHoldOrbit === false && won && fleet.length > 0) {
    const repairFrac = Math.min(0.15, Math.max(0.02, 40 / Math.max(1, fleetHull)));
    lootShare *= 1 - repairFrac;
  }

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
  return { won, decisive, attackerLosses, defenderLosses, lootTaken };
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
