// TROOPS — the muster system (design/muster-troops.md, authoritative).
//
// Troops are REAL entities: the battle engine's "supply-weighted troop counts"
// (war-types.ts `CommittedForce.troops`) resolve to actual mustered soldiers,
// never ghost numbers. Five troop types, one per war role (armory.ts), uniform
// mechanics across races; race-flavored names/art arrive with the race pass.
//
// Owner-locked rules this module enforces:
//   • v1 troop power differs ONLY by supply weight (heroes/modules add texture)
//   • Muster builds are linear — no batch discount, no alliance help, ever
//   • Troops eat: one hunger system serves home garrisons and (later) forward
//     bases — parameterize the stockpile, never fork the logic
//   • Deserters don't vanish: they become mercenary bands in the wild
//   • Casualties are cohort-tracked (veterancy-ready for v2), newest-first
//
// Pure module: deterministic, no Math.random anywhere. Ids are
// sequence-derived (`c-<type>-<seq>`, `m-<seq>`, `band-<seq>`) so offline
// resolution and tests are reproducible. The engine (engine.ts advance())
// owns the clocks; this module owns the math.

export const TROOP_TYPES = ["bulwark", "reaver", "longeye", "thunder", "warden"] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

/** Battlefield job per type (muster-troops.md §1) — flavor for UI/log lines. */
export const TROOP_JOBS: Record<TroopType, string> = {
  bulwark: "Frontline · holds ground, absorbs casualties",
  reaver: "Assault · shock attacks, breaks lines",
  longeye: "Precision · ranged denial, picks targets",
  thunder: "Siege · breaks walls (counts double)",
  warden: "Engine · escorts, shields, logistics",
};

// ============================================================================
// §0 CONFIG — every tunable in one block (muster-troops.md §11).
// ============================================================================
export const TROOPS_CONFIG = {
  /** Supply weight per type — THE stat that matters in v1. Thunder crews eat
   *  double, so they count double. The war layer MUST call supplyWeight();
   *  computing weight anywhere else is a bug (one source of truth). */
  supplyWeight: { bulwark: 1, reaver: 1, longeye: 1, thunder: 2, warden: 1 } as Record<TroopType, number>,
  /** Muster cost: this many supplies per troop × supply weight. The faucet. */
  musterCostPerWeight: 4,
  /** Muster time is linear: 30s per troop, parallel queues per type. */
  musterTimeMsPerTroop: 30_000,
  /** Home garrison cap by Cradle tier (index = tier − 1). T1 200 → T5 2000. */
  homeGarrisonCapByTier: [200, 650, 1100, 1550, 2000] as const,
  /** Forward-base garrison cap — fixed. A knife, not a home. */
  forwardGarrisonCap: 500,
  /** Upkeep: 1 supply per 10 troops per hour. Shared with forward-base §10. */
  upkeepSuppliesPerTroopPerHour: 0.1,
  /** Hunger: stockpile empty → this grace → desertion. */
  hungerGraceMs: 24 * 3600_000,
  /** Desertion rate once grace expires: 5% of the roster per hour. */
  desertionFracPerHour: 0.05,
  /** Mercenary hire price: × muster cost. Instant troops, no queue — time is
   *  the discount. (muster-troops.md §10 leaves the price to us.) */
  mercenaryHireCostMult: 1,
} as const;

/** The single source of truth for supply weight. */
export function supplyWeight(type: TroopType): number {
  return TROOPS_CONFIG.supplyWeight[type];
}
export function isTroopType(t: string): t is TroopType {
  return (TROOP_TYPES as readonly string[]).includes(t);
}

// ============================================================================
// §1 ROSTER — cohorts, not anonymous counts (veterancy-ready for v2).
// ============================================================================

/** One muster cohort: troops mustered together, aging together. Veterancy
 *  (v2) will bump `veterans` here — the shape already carries it. */
export interface TroopCohort {
  id: string; // `c-<type>-<seq>`
  type: TroopType;
  count: number;
  veterans: number; // reserved for v2; always 0 in v1
  musteredAt: number; // epoch ms — newest-first death/desertion order
}

export interface TroopRoster {
  cohorts: TroopCohort[];
  /** Supply-weight currently committed to battles (the battle engine's
   *  ledger — troops above the FOB cap / in reserve are NOT committed). */
  committedWeight: number;
  /** Sequence counter for deterministic cohort ids. */
  seq: number;
}

export function emptyRoster(): TroopRoster {
  return { cohorts: [], committedWeight: 0, seq: 0 };
}

/** Total headcount. */
export function rosterCount(r: TroopRoster): number {
  return r.cohorts.reduce((n, c) => n + c.count, 0);
}

/** Total supply weight — the number the battle engine consumes. */
export function rosterWeight(r: TroopRoster): number {
  return r.cohorts.reduce((n, c) => n + c.count * supplyWeight(c.type), 0);
}

/** Supply-weight not committed to any battle — what can still be fielded. */
export function availableWeight(r: TroopRoster): number {
  return Math.max(0, rosterWeight(r) - r.committedWeight);
}

export function rosterByType(r: TroopRoster): Record<TroopType, number> {
  const out = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  for (const c of r.cohorts) out[c.type] += c.count;
  return out;
}

/** Add a cohort (muster completion, mercenary hire). Returns the cohort. */
export function addCohort(r: TroopRoster, type: TroopType, count: number, now: number, veterans = 0): TroopCohort {
  const cohort: TroopCohort = {
    id: `c-${type}-${r.seq++}`,
    type,
    count: Math.max(0, Math.trunc(count)),
    veterans: Math.max(0, Math.trunc(veterans)),
    musteredAt: now,
  };
  if (cohort.count > 0) r.cohorts.push(cohort);
  return cohort;
}

/**
 * Remove `count` troops, newest cohorts first (the invested survive longest —
 * muster-troops.md §§3/5). Optionally restricted to one type.
 * Returns what was actually removed, per type.
 */
export function removeTroopsNewestFirst(
  r: TroopRoster,
  count: number,
  type?: TroopType,
): Record<TroopType, number> {
  const removed: Record<TroopType, number> = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  let left = Math.max(0, Math.trunc(count));
  // Newest first: later musteredAt, then higher seq (later id) as tiebreak.
  const ordered = [...r.cohorts]
    .filter((c) => (type === undefined || c.type === type) && c.count > 0)
    .sort((a, b) => b.musteredAt - a.musteredAt || (parseInt(a.id.split("-").pop()!, 10) - parseInt(b.id.split("-").pop()!, 10)) * -1);
  for (const c of ordered) {
    if (left <= 0) break;
    const take = Math.min(c.count, left);
    c.count -= take;
    // Veterans are the last to go within a cohort (v2-ready ordering).
    const vetLoss = Math.min(c.veterans, take);
    c.veterans -= vetLoss;
    removed[c.type] += take;
    left -= take;
  }
  r.cohorts = r.cohorts.filter((c) => c.count > 0);
  return removed;
}

/**
 * Apply a casualty FRACTION to the roster — pure, deterministic
 * (muster-troops.md §13: `(roster, fraction) → roster`). Death order is
 * newest-first, like desertion. Returns per-type losses for the feed.
 */
export function applyCasualties(
  r: TroopRoster,
  fraction: number,
): { roster: TroopRoster; lossesByType: Record<TroopType, number> } {
  const f = Math.min(1, Math.max(0, fraction));
  const total = rosterCount(r);
  const deaths = Math.round(total * f);
  const lossesByType = removeTroopsNewestFirst(r, deaths);
  // Committed weight shrinks proportionally — the dead were in the field.
  r.committedWeight = Math.max(0, Math.round(r.committedWeight * (1 - f)));
  return { roster: r, lossesByType };
}

/**
 * Commit supply-weight to a battle (the battle-engine seam). Returns false
 * when the roster can't cover it — the caller must not fabricate troops.
 */
export function commitWeight(r: TroopRoster, weight: number): boolean {
  const w = Math.max(0, Math.trunc(weight));
  if (w > availableWeight(r)) return false;
  r.committedWeight += w;
  return true;
}

/** Release a commitment (battle ended without casualties applied here —
 *  casualties go through applyCasualties / resolveBattleCasualties). */
export function releaseWeight(r: TroopRoster, weight: number): void {
  r.committedWeight = Math.max(0, r.committedWeight - Math.max(0, Math.trunc(weight)));
}

/**
 * Kill `weight` supply-weight of COMMITTED troops, newest-first, WITHOUT
 * releasing the commitment — for mid-battle tolls (withdrawal rearguard)
 * that land while the battle (and the rest of the commitment) continues.
 * The dead leave the roster AND the commitment: dead troops are gone, not
 * locked. Returns the losses by type plus the exact supply-weight killed
 * (the kill loop rounds troops up, so the caller reconciles segment weight
 * against weightKilled, not the request). Pure over the roster
 * (deterministic, no Math.random).
 */
export function applyCommittedCasualties(
  r: TroopRoster,
  weight: number,
): { losses: Record<TroopType, number>; weightKilled: number } {
  const weightToKill = Math.max(0, Math.round(Math.min(r.committedWeight, weight)));
  const losses: Record<TroopType, number> = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  let weightLeft = weightToKill;
  let killed = 0;
  const ordered = [...r.cohorts]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.musteredAt - a.musteredAt);
  for (const c of ordered) {
    if (weightLeft <= 0) break;
    const w = supplyWeight(c.type);
    const take = Math.min(c.count, Math.ceil(weightLeft / w));
    c.count -= take;
    const vetLoss = Math.min(c.veterans, take);
    c.veterans -= vetLoss;
    losses[c.type] += take;
    weightLeft -= take * w;
    killed += take * w;
  }
  r.cohorts = r.cohorts.filter((c) => c.count > 0);
  r.committedWeight = Math.max(0, r.committedWeight - weightToKill);
  return { losses, weightKilled: killed };
}

/**
 * Resolve a finished battle's casualties against the roster: `fraction` of
 * the COMMITTED weight dies (newest-first), the commitment clears.
 * The engine's casualty numbers are supply-weight; removal converts
 * weight → troops against the newest cohorts until the weight is covered.
 */
export function resolveBattleCasualties(
  r: TroopRoster,
  committedWeight: number,
  fraction: number,
): Record<TroopType, number> {
  const f = Math.min(1, Math.max(0, fraction));
  const weightToKill = Math.round(Math.min(r.committedWeight, committedWeight) * f);
  const losses: Record<TroopType, number> = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  let weightLeft = weightToKill;
  const ordered = [...r.cohorts]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.musteredAt - a.musteredAt);
  for (const c of ordered) {
    if (weightLeft <= 0) break;
    const w = supplyWeight(c.type);
    // Troops to remove from this cohort to cover the remaining weight.
    const take = Math.min(c.count, Math.ceil(weightLeft / w));
    c.count -= take;
    const vetLoss = Math.min(c.veterans, take);
    c.veterans -= vetLoss;
    losses[c.type] += take;
    weightLeft -= take * w;
  }
  r.cohorts = r.cohorts.filter((c) => c.count > 0);
  r.committedWeight = Math.max(0, r.committedWeight - committedWeight);
  return losses;
}

// ============================================================================
// §2 MUSTER QUEUES — linear builds, parallel per type, never alliance-helped.
// ============================================================================

export interface MusterOrder {
  id: string; // `m-<seq>`
  type: TroopType;
  count: number;
  startedAt: number;
  completesAt: number;
}

export function musterCost(type: TroopType, count: number): number {
  return Math.max(1, Math.trunc(count)) * supplyWeight(type) * TROOPS_CONFIG.musterCostPerWeight;
}

export function musterDurationMs(count: number): number {
  return Math.max(1, Math.trunc(count)) * TROOPS_CONFIG.musterTimeMsPerTroop;
}

export interface MusterEnqueue {
  ok: boolean;
  error?: string;
  order?: MusterOrder;
}

/**
 * Validate + build a muster order (the server deducts the cost — this pure
 * function only decides). Rules: positive count, fits the garrison cap
 * (existing + queued + new), one active order per type (parallel queues per
 * type, not stacked).
 */
export function enqueueMuster(
  roster: TroopRoster,
  queue: MusterOrder[],
  type: TroopType,
  count: number,
  now: number,
  seq: number,
  garrisonCap: number,
): MusterEnqueue {
  const n = Math.trunc(count);
  if (!isTroopType(type)) return { ok: false, error: "Unknown troop type." };
  if (!(n > 0)) return { ok: false, error: "Muster at least one troop." };
  if (queue.some((o) => o.type === type))
    return { ok: false, error: `${label(type)} muster already running — one queue per type.` };
  const queuedCount = queue.reduce((s, o) => s + o.count, 0);
  if (rosterCount(roster) + queuedCount + n > garrisonCap)
    return { ok: false, error: `Garrison cap ${garrisonCap} — no room for ${n} more.` };
  return {
    ok: true,
    order: {
      id: `m-${seq}`,
      type,
      count: n,
      startedAt: now,
      completesAt: now + musterDurationMs(n),
    },
  };
}

/** Label for UI/log lines. */
export function label(type: TroopType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ============================================================================
// §3 HUNGER — one system, every home (muster-troops.md §3).
// The stockpile is a parameter: { supplies } the caller owns.
// ============================================================================

export interface TroopHome {
  roster: TroopRoster;
  musterQueue: MusterOrder[];
  /** Epoch ms the stockpile ran dry; null = currently fed. */
  hungerSince: number | null;
  lastUpkeepAt: number;
  seq: number; // muster-order + band sequence counter
}

export function emptyTroopHome(now: number): TroopHome {
  return { roster: emptyRoster(), musterQueue: [], hungerSince: null, lastUpkeepAt: now, seq: 0 };
}

export interface HungerTick {
  /** Mercenary bands spawned by desertion this tick. */
  bands: MercenaryBand[];
  /** Human-readable log lines for the Chronicle. */
  log: string[];
}

/**
 * Advance one troop home over (lastUpkeepAt → now):
 *   1. complete finished muster orders → cohorts
 *   2. charge upkeep from the stockpile (1 supply / 10 troops / hour)
 *   3. track hunger: grace 24h → 5%/hr desertion, newest-first
 *   4. deserters become mercenary bands (muster-troops.md §10)
 * Pure except for the stockpile object it deducts through.
 */
export function advanceTroopHome(
  home: TroopHome,
  now: number,
  stock: { supplies: number },
  opts: { sourceColony: string; serverId: string },
): HungerTick {
  const tick: HungerTick = { bands: [], log: [] };
  if (now <= home.lastUpkeepAt) return tick;
  const elapsedMs = now - home.lastUpkeepAt;
  const prevUpkeepAt = home.lastUpkeepAt;

  // 1. Muster completions.
  const done = home.musterQueue.filter((o) => o.completesAt <= now);
  home.musterQueue = home.musterQueue.filter((o) => o.completesAt > now);
  for (const o of done) {
    addCohort(home.roster, o.type, o.count, o.completesAt);
    tick.log.push(`${o.count} ${label(o.type)}${o.count === 1 ? "" : "s"} mustered.`);
  }

  // 2. Upkeep.
  const troops = rosterCount(home.roster);
  const upkeep = (troops * TROOPS_CONFIG.upkeepSuppliesPerTroopPerHour * elapsedMs) / 3600_000;
  let paid = 0;
  if (upkeep > 0 && stock.supplies > 0) {
    paid = Math.min(stock.supplies, upkeep);
    stock.supplies -= paid;
  }
  const fed = stock.supplies > 0 || troops === 0;

  // 3–4. Hunger. A long offline stretch must catch up in ONE tick: hunger
  // is stamped, then any starving time past grace deserts immediately.
  if (!fed) {
    if (home.hungerSince === null) {
      // Hunger began mid-tick if the stockpile couldn't cover the period.
      const coveredFrac = upkeep > 0 ? paid / upkeep : 1;
      home.hungerSince = now - elapsedMs * (1 - coveredFrac);
      tick.log.push("The stockpile is empty — the garrison goes hungry. (24h foraging grace)");
    }
    const graceEnd = home.hungerSince + TROOPS_CONFIG.hungerGraceMs;
    // Only the NEW starving time since the last tick deserts — never
    // re-apply the whole window (that would compound the desertion).
    const starvingMs = Math.max(0, now - Math.max(graceEnd, prevUpkeepAt));
    if (starvingMs > 0) {
      const starvingHours = starvingMs / 3600_000;
      const desertFrac = Math.min(0.95, 1 - Math.pow(1 - TROOPS_CONFIG.desertionFracPerHour, starvingHours));
      const deserters = Math.floor(troops * desertFrac);
      if (deserters > 0) {
        const lost = removeTroopsNewestFirst(home.roster, deserters);
        const band = spawnBand(lost, now, home.seq++, opts);
        tick.bands.push(band);
        const parts = TROOP_TYPES.filter((t) => lost[t] > 0)
          .map((t) => `${lost[t]} ${label(t)}`)
          .join(", ");
        tick.log.push(
          `Starvation! ${deserters} troops desert (${parts}) — they form a mercenary band in the wild.`,
        );
      }
    }
  } else if (home.hungerSince !== null) {
    home.hungerSince = null;
    tick.log.push("The garrison is fed again — hunger ends.");
  }

  home.lastUpkeepAt = now;
  return tick;
}

// ============================================================================
// §4 MERCENARIES — the deserters' market (muster-troops.md §10).
// The ONLY buyable troops: soldiers who walked away from a starving army.
// ============================================================================

export interface MercenaryBand {
  id: string; // `band-<seq>`
  serverId: string;
  sourceColony: string; // whose neglect created them (flavor + intel)
  cohorts: { type: TroopType; count: number; veterans: number }[];
  createdAt: number;
}

export function bandCount(b: MercenaryBand): number {
  return b.cohorts.reduce((n, c) => n + c.count, 0);
}

export function bandWeight(b: MercenaryBand): number {
  return b.cohorts.reduce((n, c) => n + c.count * supplyWeight(c.type), 0);
}

/** A desertion event becomes a band — composition mirrors the deserters. */
function spawnBand(
  lost: Record<TroopType, number>,
  now: number,
  seq: number,
  opts: { sourceColony: string; serverId: string },
): MercenaryBand {
  return {
    id: `band-${seq}`,
    serverId: opts.serverId,
    sourceColony: opts.sourceColony,
    cohorts: TROOP_TYPES.filter((t) => lost[t] > 0).map((t) => ({ type: t, count: lost[t], veterans: 0 })),
    createdAt: now,
  };
}

/** Hire price: muster-cost equivalent (instant troops, no queue — time is the
 *  discount; the cap is your stomach). */
export function hireCost(band: MercenaryBand): number {
  return bandWeight(band) * TROOPS_CONFIG.musterCostPerWeight * TROOPS_CONFIG.mercenaryHireCostMult;
}

export interface HireResult {
  ok: boolean;
  error?: string;
}

/**
 * Hire a mercenary band: supplies on the table, band joins the roster at this
 * home (garrison cap still applies — the cap is your stomach). The caller
 * deducts the hire cost from the stockpile on ok.
 */
export function hireBand(
  home: TroopHome,
  band: MercenaryBand,
  garrisonCap: number,
  now: number,
): HireResult {
  const n = bandCount(band);
  if (n <= 0) return { ok: false, error: "That band has already been hired." };
  if (rosterCount(home.roster) + n > garrisonCap)
    return { ok: false, error: `Garrison cap ${garrisonCap} — no room for ${n} sellswords.` };
  for (const c of band.cohorts) addCohort(home.roster, c.type, c.count, now, c.veterans);
  // Empty the band in place so a double-hire is a no-op.
  band.cohorts = [];
  return { ok: true };
}

// ============================================================================
// §5 THE MEMORIAL FEED — casualty records the plaques read (forward-base §9).
// ============================================================================

export interface CasualtyRecord {
  battleId: string;
  site: string;
  season: string;
  factions: [string, string];
  lossesByType: Record<TroopType, number>;
  fallenHeroes: string[];
  at: number;
}

export function recordCasualties(
  feed: CasualtyRecord[],
  record: Omit<CasualtyRecord, "at"> & { at?: number },
): CasualtyRecord {
  const entry: CasualtyRecord = { ...record, at: record.at ?? Date.now() };
  feed.push(entry);
  return entry;
}

/** Total troops lost in a record — the plaque-qualification number. */
export function recordDeaths(r: CasualtyRecord): number {
  return (Object.keys(r.lossesByType) as TroopType[]).reduce((n, t) => n + r.lossesByType[t], 0);
}

// ============================================================================
// §6 GARRISON CAPS — the Cradle-tier seam.
// ============================================================================

/**
 * Home garrison cap from Cradle tier (1–5). The tier itself is derived by the
 * caller (engine.ts: from deployed domain levels — the colony's advancement
 * proxy until the building system owns a real Cradle tier).
 */
export function homeGarrisonCap(cradleTier: number): number {
  const t = Math.min(5, Math.max(1, Math.trunc(cradleTier) || 1));
  return TROOPS_CONFIG.homeGarrisonCapByTier[t - 1];
}
