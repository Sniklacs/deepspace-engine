// WAR ENERGY — squad composition + the hero-energy fairness valve (§6).
//
// Spec: design/heroes-design-brief.md §5/§6 (O3 — min-3-march, max-5 squad;
// O5 — 60/wk pool, the 20/20/15/15/10/10 action table, 8/day march cap).
// HARD CONSTS ONLY — no config field a purchase could write, no refill path,
// no "extra march" pass, no squad-slot purchase (§7 never-list). The client
// renders remaining energy; it never writes it (§6). Participation is never
// hero-gated (R8): hauling, purification assists, and defensive shields need
// no roster — the caps below are the fairness valve against no-life grind and
// whale stamina alike, identical for everyone, invisible to money.
//
// Pure module: no engine/UI/server imports, no Math.random. This file ships
// the constants + the pure validation/math helpers the war layer's server fns
// will call — so the harness can assert the §6 table right now, ahead of the
// war build.
import type { HeroAction } from "./heroes-data";

// ============================================================================
// §1 CONFIG — ONE block for every tunable number (O3/O5 values ratified).
// ============================================================================
export const WAR_ENERGY_CONFIG = {
  /** Per-hero weekly energy pool — "activation": what it costs to field a
   *  hero on the war roster for a week. Resets at the week boundary. */
  activation: {
    weeklyPool: 60,
    reset: "week-boundary-full-restore" as const,
  },
  /** Per-hero upkeep: the action energy cost (per participating hero) for
   *  each war action (§6 table — the fairness valve). */
  actionCosts: {
    march: 20,
    capture: 20,
    escort: 15,
    purify: 15, // Phase 2
    shield: 10,
    haul: 10,
  } as const,
  /** Squad composition (O3): min 3 to field a march, max 5. */
  squad: { min: 3, max: 5 } as const,
  /** DAILY_MARCH_CAP (per colony per UTC day; marches + captures counted;
   *  shields / hauls / escorts are NOT march-capped — they are the
   *  participation floor and stay uncapped). */
  dailyMarchCap: 8,
  /** The war-week boundary the weekly pool resets at (7 UTC days). */
  warWeekMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/** The §6 action energy table, flattened for iteration/tests. */
export const ACTION_ENERGY_COSTS: Readonly<Record<HeroAction, number>> = WAR_ENERGY_CONFIG.actionCosts;

/** Actions that count against DAILY_MARCH_CAP (marches + captures). */
export const MARCH_CAPPED_ACTIONS: readonly HeroAction[] = ["march", "capture"];

// ============================================================================
// §2 PURE HELPERS (server-fn call sites + harness assertions)
// ============================================================================

/** Squad size range check (O3 — 3..5). Returns a user-readable result. */
export function validateSquadSize(size: number): { ok: true } | { ok: false; error: string } {
  const { min, max } = WAR_ENERGY_CONFIG.squad;
  if (!Number.isInteger(size)) return { ok: false, error: `Squad size must be an integer between ${min} and ${max}.` };
  if (size < min) return { ok: false, error: `A march needs at least ${min} heroes (squad has ${size}).` };
  if (size > max) return { ok: false, error: `Squad is capped at ${max} heroes (got ${size}).` };
  return { ok: true };
}

export function squadSizeOk(size: number): boolean {
  return validateSquadSize(size).ok;
}

/** Energy cost of one action per participating hero (§6 table). */
export function actionEnergyCost(action: HeroAction): number {
  const c = ACTION_ENERGY_COSTS[action];
  if (typeof c !== "number" || c < 0) return 0;
  return c;
}

/** Whether an action counts against the daily march cap (§6). */
export function isMarchCapped(action: HeroAction): boolean {
  return MARCH_CAPPED_ACTIONS.includes(action);
}

/**
 * Remaining weekly energy for a hero (§6): the pool is 60 per hero per war
 * week and resets at the week boundary — derived purely from the stamp, so a
 * stale or absent stamp reads as a full pool (same rolling-window pattern as
 * the XP day ledger; no migration needed).
 */
export function weeklyEnergyRemaining(energyWeek: { cycleId: string | null; spent: number }, cycleId: string): number {
  const spent = energyWeek.cycleId === cycleId ? (typeof energyWeek.spent === "number" ? energyWeek.spent : 0) : 0;
  return Math.max(0, WAR_ENERGY_CONFIG.activation.weeklyPool - spent);
}

/** Whether a hero has enough weekly energy left to take one action (§6 —
 *  spend is validated server-side; the client only renders. */
export function canAffordAction(energyWeek: { cycleId: string | null; spent: number }, cycleId: string, action: HeroAction): boolean {
  return weeklyEnergyRemaining(energyWeek, cycleId) >= actionEnergyCost(action);
}