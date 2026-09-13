// HERO XP / LEVELING / SPECIALIZATION — the proven Leader spine, war-flavored.
//
// Spec: design/heroes-design-brief.md §4 (R6 — "Progression spine is the
// proven Leader spine"). level = floor(√(xp/50)), K = 50, cap L10, 1 attribute
// point per level, the rolling +40 XP/day cap — ALL reused unchanged from
// leader-xp.ts (imported, never re-derived) so heroes and Leaders share one
// curve and one threshold table. The ONLY structural difference: the daily cap
// lives in a SEPARATE per-colony ledger (heroXpCaps vs leaderXpCaps) so the
// two earned budgets never cannibalize each other (brief §4 XP sources).
//
// HOLLOW? No — deliberately thin. The heavy design calls for a clone of the
// engine's grantXpTo / applyLevelUps primitives, and those live in engine.ts
// (which this module must NOT import — engine will import these modules when
// the war layer lands, and a cycle would form). So the primitives are
// re-implemented HERE as pure functions over a hero record, byte-compatible
// with the leader versions: same day-window rollover, same cap math, same
// points = level − 1 invariant (asserted in the harness).
//
// Pure module: no engine/UI/server imports. No Math.random anywhere. XP is
// event-sourced from the war ledger only — nothing purchasable, no
// acceleration path (asserted in the harness).
import { DAILY_XP_CAP, LEVEL_XP, MAX_LEVEL, SPECIALIZATION_MILESTONE, levelFromXp, xpDayKey, xpForLevel } from "./leader-xp";
import type { HeroAttributes, HeroDef, HeroRole } from "./heroes-data";
import type { RaceId } from "./types";

// ============================================================================
// §1 CONFIG — every tunable number in one place (§4 values ratified; the
// source table is the published O-derivation, calibration-pending).
// ============================================================================
export const HERO_XP_CONFIG = {
  /** Curve constant — imported from the Leader spine (K = 50). */
  k: 50,
  /** Cap: L10, same as Leaders (O8). */
  maxLevel: MAX_LEVEL,
  /** The exact cumulative threshold table shared with Leaders. */
  levelXp: LEVEL_XP,
  /** Daily XP cap — 40/day, same as Leaders, in the SEPARATE hero ledger. */
  dailyCap: DAILY_XP_CAP,
  /** L3 opens the one-time specializations (same milestone as Leaders). */
  milestone: SPECIALIZATION_MILESTONE,
  /** Freed points per level gained (= level − 1 at any level). */
  pointsPerLevel: 1,
} as const;

/** Published XP sources (brief §4 — war ledger only, engine multiplies). */
export const HERO_XP_SOURCES = {
  marchWin: 10,
  marchLoss: 4, // losing weeks still pay participation
  capture: 15,
  purify: 20, // Phase 2
  shieldAssist: 8,
  haul: 6,
  comeback: 12,
  heroDeedOrFirst: 25,
  riddleAnswered: 10,
} as const;

// ============================================================================
// §2 TYPES — the per-colony hero instance (engine state shape, brief §9).
// ============================================================================
/** A hero's one-time L3 specialization (O4 — sidegraded, engine multipliers
 *  only, zero purchase path; calibration-pending numbers, never rules). */
export type HeroSpecialization = "vanguard" | "hearthward" | "courser";

export interface HeroEnergyWeek {
  cycleId: string | null;
  spent: number;
}

export interface HeroUnit {
  id: string;
  name: string;
  race: RaceId;
  role: HeroRole;
  /** Provenance stamp (R1) — the deed id or "oracle_vouch:<oracleId>" that
   *  earned this hero. Auditable; never client-writable. */
  earnedBy: string;
  xp: number;
  unspentPoints: number;
  xpPointsGranted: number;
  specialization: HeroSpecialization | null;
  attributes: HeroAttributes;
  /** Rolling day-window for the +40 XP/day cap (key = UTC date). */
  day: string;
  dayXp: number;
  /** §6 per-hero weekly energy (spent tracked per war cycle). */
  energyWeek: HeroEnergyWeek;
}

/** The L3 specialization table (O4 — decided values). */
export const HERO_SPECIALIZATIONS: {
  id: HeroSpecialization;
  mandate: string;
  icon: string;
  blurb: string;
  effects: string[];
  accent: string;
}[] = [
  {
    id: "vanguard",
    mandate: "Spear's Mandate",
    icon: "⚔️",
    blurb: "The spearhead who teaches by example: their offensive skills hit harder and every capture they take part in counts for more.",
    effects: ["offensive skills +15% strength", "capture contribution +10%"],
    accent: "border-red-400/40 bg-red-400/10 text-red-200",
  },
  {
    id: "hearthward",
    mandate: "Gate's Mandate",
    icon: "🏰",
    blurb: "The keeper who holds the gate: purification channels and shield assists they touch are stronger, and defense costs them less.",
    effects: ["purify channels + shield assists +15% effectiveness", "defense-action energy cost −15%"],
    accent: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
  {
    id: "courser",
    mandate: "Road's Mandate",
    icon: "🏇",
    blurb: "The runner who knows every lane: their actions cost less energy and their hauling and escorting scores higher.",
    effects: ["their action energy costs −15%", "haul/escort scoring +15%"],
    accent: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
];

export const HERO_SPECIALIZATION_BY_ID = Object.fromEntries(HERO_SPECIALIZATIONS.map((s) => [s.id, s])) as Record<HeroSpecialization, (typeof HERO_SPECIALIZATIONS)[number]>;

// ============================================================================
// §3 PURE PROGRESSION PRIMITIVES (leader-spine clones)
// ============================================================================

/** Instantiate a hero at level 1 (XP 0) with the deed's provenance stamp.
 *  The deed buys the seat; the war buys the power (brief §1). */
export function newHeroUnit(def: HeroDef, earnedBy: string, now: number): HeroUnit {
  return {
    id: def.id,
    name: def.name,
    race: def.race,
    role: def.role,
    earnedBy,
    xp: 0,
    unspentPoints: 0,
    xpPointsGranted: 0,
    specialization: null,
    attributes: { ...def.baseAttributes },
    day: heroXpDayKey(now),
    dayXp: 0,
    energyWeek: { cycleId: null, spent: 0 },
  };
}

export function heroXpDayKey(now: number): string {
  return xpDayKey(now);
}

export function freshHeroXpState(now: number): { day: string; dayXp: number } {
  return { day: heroXpDayKey(now), dayXp: 0 };
}

/** Current level from total XP (leader curve, capped at L10). */
export function heroLevelFromXp(xp: number): number {
  return levelFromXp(xp);
}

export function heroLevel(hero: HeroUnit): number {
  return heroLevelFromXp(typeof hero.xp === "number" ? hero.xp : 0);
}

export function heroXpForLevel(level: number): number {
  return xpForLevel(level);
}

/** Daily XP remaining for a hero given its rolling day-window (40/day). */
export function heroDailyXpRemaining(hero: HeroUnit): number {
  const spent = typeof hero.dayXp === "number" ? hero.dayXp : 0;
  return Math.max(0, HERO_XP_CONFIG.dailyCap - spent);
}

/**
 * The hero-side clone of the engine's grantXpTo — pure: rolls the day window,
 * applies BOTH caps (per-hero dayXp AND the colony-wide heroXpCaps ledger
 * passed in), grants, then applies level-ups. Returns what was granted and
 * whether a level-up fired. Nothing here can be paid for; sources are the
 * published war-ledger events only.
 */
export function grantHeroXpTo(hero: HeroUnit, amount: number, now: number, heroXpCaps: Record<string, number>): { granted: number; leveled: boolean } {
  if (amount <= 0) return { granted: 0, leveled: false };
  const today = heroXpDayKey(now);
  if (hero.day !== today) {
    hero.day = today;
    hero.dayXp = 0;
  }
  const dayLeft = Math.max(0, HERO_XP_CONFIG.dailyCap - hero.dayXp);
  const sharedLeft = Math.max(0, HERO_XP_CONFIG.dailyCap - (heroXpCaps[today] ?? 0));
  const grant = Math.min(amount, Math.min(dayLeft, sharedLeft));
  if (grant <= 0) return { granted: 0, leveled: false };
  hero.xp = (hero.xp ?? 0) + grant;
  hero.dayXp += grant;
  heroXpCaps[today] = (heroXpCaps[today] ?? 0) + grant;
  const leveled = applyHeroLevelUps(hero);
  return { granted: grant, leveled };
}

/** The applyLevelUps clone: expected points = level − 1, grant the difference
 *  once (xpPointsGranted tracks so allocation never double-grants). */
export function applyHeroLevelUps(hero: HeroUnit): boolean {
  const level = heroLevel(hero);
  const grantedSoFar = typeof hero.xpPointsGranted === "number" ? hero.xpPointsGranted : 0;
  const expected = Math.max(0, level - 1);
  const granted = Math.max(0, expected - grantedSoFar);
  if (granted > 0) {
    hero.xpPointsGranted = expected;
    hero.unspentPoints = (hero.unspentPoints ?? 0) + granted;
    return true;
  }
  return false;
}

/** Whether the hero may choose its L3 specialization (one-time, L3+). */
export function canChooseHeroSpec(hero: HeroUnit): boolean {
  return heroLevel(hero) >= HERO_XP_CONFIG.milestone && hero.specialization === null;
}

/** Free allocation of one unspent point into a war attribute. Pure; returns
 *  a result — the client can never mutate a hero directly (§5 server-side
 *  validation pattern, mirrored here for the engine to call). */
export function allocateHeroPoint(hero: HeroUnit, attr: keyof HeroAttributes): { ok: true } | { ok: false; error: string } {
  if (attr !== "power" && attr !== "guard" && attr !== "craft" && attr !== "presence") {
    return { ok: false, error: `Unknown attribute "${String(attr)}".` };
  }
  if ((hero.unspentPoints ?? 0) < 1) return { ok: false, error: `${hero.name} has no unspent attribute points. Earn XP to level up.` };
  hero.unspentPoints -= 1;
  hero.attributes[attr] += 1;
  return { ok: true };
}

/** One-time mutually-exclusive L3 specialization (O4). Pure; nothing
 *  purchasable, no respec — the choice is permanent. */
export function chooseHeroSpec(hero: HeroUnit, specId: HeroSpecialization): { ok: true } | { ok: false; error: string } {
  const spec = HERO_SPECIALIZATION_BY_ID[specId];
  if (!spec) return { ok: false, error: `Unknown specialization "${specId}".` };
  if (hero.specialization !== null) return { ok: false, error: `${hero.name} has already chosen ${hero.specialization}.` };
  if (heroLevel(hero) < HERO_XP_CONFIG.milestone) return { ok: false, error: `${hero.name} must reach Level ${HERO_XP_CONFIG.milestone} before choosing a specialization.` };
  hero.specialization = specId;
  return { ok: true };
}