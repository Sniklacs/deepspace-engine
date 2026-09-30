// FORWARD BASES — beachheads on foreign servers (design/forward-base.md,
// authoritative). A forward base is a barracks, not a colony: troops and
// nothing else. No research, no forge, no economy, no artifact generation,
// no devotion. It lives off raided supplies; it can be destroyed — lose the
// base, lose everything stationed there.
//
// Owner-locked rules this module enforces:
//   • One race per server; a colony plants at most ONE base per foreign server
//   • Planting costs a jump charge + a beachhead kit (real costs, tunable)
//   • Jump cooldown 24h per colony — no jump-spam harassment
//   • Troop production reuses the shared TroopHome logic — hunger/upkeep are
//     NEVER forked (troops.ts §3 advanceTroopHome is the single source)
//   • The stockpile grows ONLY by raiding. No home convoys, ever.
//   • Garrison cap 500 (TROOPS_CONFIG.forwardGarrisonCap). A knife, not a home.
//   • Razed walls = base gone, everything in it gone. No evacuation.
//   • Deserters become mercenary bands in the FOREIGN server's shared pool
//     (serverBands), hireable by anyone on that server — including the enemy.
//   • Season rollover abandons every base (recall job in engine.ts).
//
// Pure module: deterministic, no Math.random anywhere. Ids are
// sequence-derived (`fb-<seq>`) so offline resolution and tests are
// reproducible. The engine (engine.ts advance()) owns the clocks; this
// module owns the math.

import {
  advanceTroopHome,
  emptyTroopHome,
  enqueueMuster,
  hireBand,
  hireCost,
  isTroopType,
  musterCost,
  musterDurationMs,
  recordCasualties,
  supplyWeight,
  TROOPS_CONFIG,
  type CasualtyRecord,
  type HireResult,
  type HungerTick,
  type MercenaryBand,
  type TroopHome,
  type TroopType,
} from "./troops";

// ============================================================================
// §0 CONFIG — every tunable in one block (forward-base.md §10).
// ============================================================================
export const FORWARD_BASE_CONFIG = {
  /** Garrison cap per base — fixed. A knife, not a second home. */
  garrisonCap: TROOPS_CONFIG.forwardGarrisonCap,
  /** Wall HP. Modest by design: delays a real siege, never stops one. */
  wallHp: 1200,
  /** Jump cooldown per colony — one jump per 24h. */
  jumpCooldownMs: 24 * 3600_000,
  /** Beachhead kit: the fixed, legible planting cost (supplies). */
  kitSupplies: 250,
  /**
   * Beachhead kit's forged component. The kit is supplies + one forged
   * anchor derived from a war plate (forward-base.md §3). Until the forge
   * exposes an inventory seam the anchor is represented as an item id the
   * engine resolves; `null` degrades to supplies-only (documented, not
   * silent — plantForwardBase reports what was charged).
   */
  kitAnchorItemId: "war-plate-anchor" as string | null,
  /** Jump charge: supplies, scaling with the weight that jumps. The charge
   *  must always feel like a decision, never a reflex. */
  jumpChargePerWeight: 1,
  /** Flat jump-charge floor so even a lone hero pays something real. */
  jumpChargeBase: 50,
  /** Chorus retaliation scaling is tuned in the world layer (open q3); the
   *  siege helper takes raw damage so any caller can drive it. */
  retaliationNote: "see world layer",
} as const;

// ============================================================================
// §1 THE BASE — structure. No economy fields. If one appears, the design
// has leaked (forward-base.md §12).
// ============================================================================
export interface ForwardBase {
  id: string; // `fb-<seq>`
  /** Foreign server id — the record key in GameState.forwardBases. */
  serverId: string;
  label: string;
  /** The shared troop system: roster, muster queue, hunger clock. */
  home: TroopHome;
  /** Raided supply stockpile. Grows ONLY by raiding — never by home. */
  supplies: number;
  wallHp: number;
  maxWallHp: number;
  plantedAt: number;
}

/** Shared server-level mercenary-band pools: serverId → bands in the wild.
 *  Deserters from a forward base land HERE, on the foreign server — not in
 *  any colony's private list. Anyone on that server can hire them. */
export type ServerBandPool = Record<string, MercenaryBand[]>;

export function emptyServerBandPool(): ServerBandPool {
  return {};
}

/** Deposit desertion bands into the shared pool, keyed by band.serverId. */
export function depositBands(pool: ServerBandPool, bands: MercenaryBand[]): void {
  for (const b of bands) {
    if (!pool[b.serverId]) pool[b.serverId] = [];
    pool[b.serverId].push(b);
  }
}

export function findBand(
  pool: ServerBandPool,
  serverId: string,
  bandId: string,
): MercenaryBand | undefined {
  return (pool[serverId] ?? []).find((b) => b.id === bandId && b.cohorts.length > 0);
}

/** Remove a band from the shared pool (after a successful hire). */
export function removeBand(pool: ServerBandPool, serverId: string, bandId: string): void {
  const list = pool[serverId];
  if (!list) return;
  pool[serverId] = list.filter((b) => b.id !== bandId);
}

export function poolCount(pool: ServerBandPool, serverId: string): number {
  return (pool[serverId] ?? []).reduce((n, b) => n + b.cohorts.reduce((m, c) => m + c.count, 0), 0);
}

// ============================================================================
// §2 PLANTING — the jump (forward-base.md §2–§3).
// Validated: one base per foreign server, 24h jump cooldown, real costs.
// The caller deducts the charge from the home colony on `ok`.
// ============================================================================
export interface PlantRequest {
  serverId: string;
  homeServerId: string;
  label: string;
  /** Weight of the strike force making the jump (troops + heroes' cargo). */
  forceWeight: number;
  /** Epoch ms of this colony's last jump (null = never). */
  lastJumpAt: number | null;
  /** Foreign serverIds this colony already holds a base on. */
  existingServers: string[];
  now: number;
  seq: number;
}

export interface PlantResult {
  ok: boolean;
  base?: ForwardBase;
  /** Supplies the caller must deduct from the home colony (kit + jump). */
  chargeSupplies?: number;
  /** Whether the forged anchor component was charged (forge seam). */
  anchorCharged?: boolean;
  error?: string;
}

export function jumpChargeSupplies(forceWeight: number): number {
  return (
    FORWARD_BASE_CONFIG.jumpChargeBase +
    Math.max(0, Math.floor(forceWeight)) * FORWARD_BASE_CONFIG.jumpChargePerWeight
  );
}

export function plantForwardBase(req: PlantRequest): PlantResult {
  const target = req.serverId.trim();
  if (!target) return { ok: false, error: "Pick a foreign server to jump to." };
  if (target === req.homeServerId)
    return { ok: false, error: "That's your home server — no beachhead needed." };
  if (req.existingServers.includes(target))
    return { ok: false, error: "You already hold a forward base on that server — one per server." };
  if (req.lastJumpAt !== null && req.now - req.lastJumpAt < FORWARD_BASE_CONFIG.jumpCooldownMs) {
    const leftH = Math.ceil(
      (FORWARD_BASE_CONFIG.jumpCooldownMs - (req.now - req.lastJumpAt)) / 3600_000,
    );
    return { ok: false, error: `Jump drive recharging — ${leftH}h before the next jump.` };
  }
  const charge = FORWARD_BASE_CONFIG.kitSupplies + jumpChargeSupplies(req.forceWeight);
  const base: ForwardBase = {
    id: `fb-${req.seq}`,
    serverId: target,
    label: req.label.trim() || `Beachhead ${target}`,
    home: emptyTroopHome(req.now),
    supplies: 0, // the stockpile starts EMPTY — it only grows by raiding
    wallHp: FORWARD_BASE_CONFIG.wallHp,
    maxWallHp: FORWARD_BASE_CONFIG.wallHp,
    plantedAt: req.now,
  };
  return {
    ok: true,
    base,
    chargeSupplies: charge,
    anchorCharged: FORWARD_BASE_CONFIG.kitAnchorItemId !== null,
  };
}

// ============================================================================
// §3 THE TICK — one base, one advance (forward-base.md §5).
// Delegates to advanceTroopHome — the hunger logic is NEVER reimplemented
// here. The stockpile wrapper is the base's raided supplies; desertion bands
// carry the FOREIGN serverId so the engine pools them server-side.
// ============================================================================
export interface BaseTick extends HungerTick {
  baseId: string;
}

export function advanceForwardBase(
  base: ForwardBase,
  now: number,
  opts: { sourceColony: string },
): BaseTick {
  const stock = {
    get supplies() {
      return base.supplies;
    },
    set supplies(v: number) {
      base.supplies = Math.max(0, v);
    },
  };
  const tick = advanceTroopHome(base.home, now, stock, {
    sourceColony: opts.sourceColony,
    serverId: base.serverId, // bands desert into the FOREIGN wilds
  });
  return { ...tick, baseId: base.id };
}

// ============================================================================
// §4 MUSTER AT THE BEACHHEAD — troop production, and nothing else
// (forward-base.md §4). Same linear queues, same costs, same hunger — paid
// from the RAIDED stockpile. No alliance help, ever.
// ============================================================================
export interface BaseMusterResult {
  ok: boolean;
  completesAt?: number;
  error?: string;
}

export function musterAtBase(
  base: ForwardBase,
  type: string,
  count: number,
  now: number,
): BaseMusterResult {
  if (!isTroopType(type)) return { ok: false, error: `Unknown troop type "${type}".` };
  const t: TroopType = type;
  const enq = enqueueMuster(
    base.home.roster,
    base.home.musterQueue,
    t,
    count,
    now,
    base.home.seq,
    FORWARD_BASE_CONFIG.garrisonCap,
  );
  if (!enq.ok || !enq.order) return { ok: false, error: enq.error ?? "Muster refused." };
  const cost = musterCost(t, Math.trunc(count));
  if (base.supplies < cost)
    return {
      ok: false,
      error: `Needs ${cost} raided supplies — the beachhead lives off the land, no home convoys.`,
    };
  base.supplies -= cost;
  base.home.musterQueue.push(enq.order);
  base.home.seq++;
  return { ok: true, completesAt: enq.order.completesAt };
}

/** Raid income: supplies looted on the foreign server land in the stockpile. */
export function depositRaidLoot(base: ForwardBase, supplies: number): number {
  const n = Math.max(0, Math.floor(supplies));
  base.supplies += n;
  return n;
}

// ============================================================================
// §5 HIRING ON FOREIGN SOIL — deserter bands from the shared server pool
// (forward-base.md: "starving a beachhead stocks your enemy's recruitment
// pool"). The band must be on THIS base's server; the 500-cap still applies.
// ============================================================================
export interface BaseHireResult extends HireResult {
  cost?: number;
}

export function hireBandAtBase(
  base: ForwardBase,
  pool: ServerBandPool,
  bandId: string,
  now: number,
): BaseHireResult {
  const band = findBand(pool, base.serverId, bandId);
  if (!band) return { ok: false, error: "That band is gone — hired, scattered, or never on this server." };
  const cost = hireCost(band);
  if (base.supplies < cost)
    return { ok: false, error: `Hiring costs ${cost} supplies — raid first, recruit later.` };
  const res: HireResult = hireBand(base.home, band, FORWARD_BASE_CONFIG.garrisonCap, now);
  if (!res.ok) return res;
  base.supplies -= cost;
  removeBand(pool, base.serverId, bandId);
  return { ok: true, cost };
}

// ============================================================================
// §6 DESTRUCTION — siege the walls, lose everything (forward-base.md §6).
// No evacuation: when the walls fall, the base and everything in it are gone.
// Heroes follow normal hero-fall rules (handled by the battle layer); the
// casualty record feeds the memorial-plaque pipeline (forward-base.md §9).
// ============================================================================
export interface SiegeResult {
  razed: boolean;
  wallHp: number;
  /** Present only when razed — the memorial feed entry. */
  casualties?: CasualtyRecord;
}

export function siegeForwardBase(
  base: ForwardBase,
  damage: number,
  opts: { season: string; attacker: string; defender: string; at?: number },
): SiegeResult {
  base.wallHp = Math.max(0, base.wallHp - Math.max(0, Math.floor(damage)));
  if (base.wallHp > 0) return { razed: false, wallHp: base.wallHp };
  // Razed. Everything stationed dies or scatters — record it for the plaques.
  const lossesByType = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 } as Record<
    TroopType,
    number
  >;
  for (const c of base.home.roster.cohorts) lossesByType[c.type] += c.count;
  // Troops still in the muster queue never finished training — they scatter.
  const casualties = recordCasualties([], {
    battleId: `raze-${base.id}`,
    site: `${base.label} (${base.serverId})`,
    season: opts.season,
    factions: [opts.attacker, opts.defender],
    lossesByType,
    fallenHeroes: [],
    at: opts.at,
  });
  return { razed: true, wallHp: 0, casualties };
}

/** Season rollover / voluntary scuttle: every base is abandoned, everything
 *  stationed is lost (forward-base.md §9: full wipe except plaques). Returns
 *  the bases removed so the caller can log them. */
export function abandonAllForwardBases(
  bases: Record<string, ForwardBase>,
): ForwardBase[] {
  const removed = Object.values(bases);
  for (const key of Object.keys(bases)) delete bases[key];
  return removed;
}

/** Supply weight of a whole strike force — the jump-charge input. */
export function strikeForceWeight(types: Partial<Record<TroopType, number>>): number {
  return (Object.keys(types) as TroopType[]).reduce(
    (n, t) => n + Math.max(0, Math.floor(types[t] ?? 0)) * supplyWeight(t),
    0,
  );
}

/** Muster duration passthrough (kept here so the war-table UI has one import). */
export function baseMusterDurationMs(count: number): number {
  return musterDurationMs(count);
}
