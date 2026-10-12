// HEROES HALL — pure display model for the Heroes & Leaders page
// (owner 2026-10-12: "that spot that shows the heroes and leaders and their
// attributes and how we tier those so that they can level with experience").
//
// This module invents NOTHING. Every number it surfaces already lives in the
// systems that own it:
//   • Hero catalog + deed catalog ......... heroes-data.ts (HERO_DEFS,
//     DEED_CATALOG, HEROES_CONFIG — owner-ratified Wave-1 Watchers)
//   • Hero XP / levels / mandates ......... hero-xp.ts (HERO_XP_SOURCES,
//     HERO_SPECIALIZATIONS, the Leader-spine curve)
//   • Leader levels / cap / mandates ...... leader-xp.ts (LEVEL_XP,
//     DAILY_XP_CAP, SPECIALIZATION_MILESTONE)
//   • Playbook level gating ............... war/playbook.ts (PLAYBOOK,
//     Play.minLeaderLevel)
//   • Leader XP grant amounts ............. engine.ts grant sites (see
//     LEADER_XP_SOURCE_ROWS below — the engine keeps these as literals at
//     the grant calls, so they are mirrored here for display ONLY; the
//     engine remains the source of truth for what is actually granted).
//
// THE NEVER-LIST applies to this page exactly as to the catalog: heroes are
// EARNED (signature deed or Oracle vouch), never bought. There is no cost,
// price, or shop field anywhere in this module's output — the Hall shows
// legends and the deeds that win them; it sells nothing.
import {
  DEED_BY_ID,
  DEED_CATALOG,
  HERO_DEFS,
  HEROES_CONFIG,
  type DeedTier,
  type HeroDeed,
  type HeroDef,
} from "./heroes-data";
import { HERO_XP_SOURCES, type HeroUnit } from "./hero-xp";
import {
  DAILY_XP_CAP,
  LEVEL_XP,
  MAX_LEVEL,
  SPECIALIZATION_MILESTONE,
} from "./leader-xp";
import { PLAYBOOK, type Play } from "./war/playbook";

// ============================================================================
// §1 THE DEED-TIER LADDER — how heroes are tiered by the deed that wins them
// (brief §3.1: T1 Herald ≈ wk 1–3 · T2 Veteran ≈ wk 4–8 · T3 Legend ≈
// 1–3 months · Vouch = the Oracle's earned trust, no week window).
// ============================================================================
export const DEED_TIER_ORDER: readonly DeedTier[] = ["t1", "t2", "t3", "vouch"];

export interface DeedTierRow {
  tier: DeedTier;
  /** Published worst-case weeks for the tier (null = the vouch, unwindowed). */
  weeks: number | null;
  /** Every deed in the tier, in catalog order. */
  deeds: readonly HeroDeed[];
  /** Hero ids whose SIGNATURE deed sits in this tier. */
  heroIds: readonly string[];
}

export function deedTierLadder(): DeedTierRow[] {
  return DEED_TIER_ORDER.map((tier) => ({
    tier,
    weeks:
      tier === "vouch"
        ? null
        : (HEROES_CONFIG.tierWeeks[tier as "t1" | "t2" | "t3"] ?? null),
    deeds: DEED_CATALOG.filter((d) => d.tier === tier),
    heroIds: HERO_DEFS.filter(
      (h) => (DEED_BY_ID[h.signatureDeed]?.tier ?? null) === tier,
    ).map((h) => h.id),
  }));
}

/** The tier a hero is filed under — the tier of its signature deed. */
export function heroSignatureTier(def: HeroDef): DeedTier {
  return DEED_BY_ID[def.signatureDeed]?.tier ?? "t1";
}

// ============================================================================
// §2 EARN PATHS — every way a hero can be won: its signature deed, its
// alternate deeds of the same tier, and the Oracle vouch for its race.
// Player choice, never a roll (brief R2); favor earned, never bought (§3.4).
// ============================================================================
export interface HeroEarnPaths {
  /** Signature + alternate deeds, resolved and de-duplicated, in order. */
  deeds: readonly HeroDeed[];
  /** The vouch deed id for this hero's race ("oracle_vouch:<race>"). */
  vouchDeedId: string;
  /** The catalog's vouch deed record, when published for this race. */
  vouchDeed: HeroDeed | null;
}

export function heroEarnPaths(def: HeroDef): HeroEarnPaths {
  const seen = new Set<string>();
  const deeds: HeroDeed[] = [];
  for (const id of [def.signatureDeed, ...def.alternateDeeds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const deed = DEED_BY_ID[id];
    if (deed) deeds.push(deed);
  }
  const vouchDeedId = `${HEROES_CONFIG.oracleVouchPrefix}${def.race}`;
  return { deeds, vouchDeedId, vouchDeed: DEED_BY_ID[vouchDeedId] ?? null };
}

// ============================================================================
// §3 THE ROSTER — catalog heroes joined with the colony's earned hero units.
// Earned = a HeroUnit with the hero's id exists (the prologue's sealed
// records today; the war layer's earned ledger when it lands). Everything
// else renders as an aspirational locked entry with its deed path shown.
// ============================================================================
export interface HeroHallEntry {
  def: HeroDef;
  /** The colony's earned instance, or null while the hero is unwon. */
  unit: HeroUnit | null;
  earned: boolean;
  tier: DeedTier;
  paths: HeroEarnPaths;
}

export function buildHeroRoster(
  earnedUnits: readonly HeroUnit[],
): HeroHallEntry[] {
  const byId = new Map(earnedUnits.map((u) => [u.id, u]));
  const entries: HeroHallEntry[] = HERO_DEFS.map((def) => {
    const unit = byId.get(def.id) ?? null;
    return {
      def,
      unit,
      earned: unit !== null,
      tier: heroSignatureTier(def),
      paths: heroEarnPaths(def),
    };
  });
  // An earned unit with no catalog def (a future wave landing ahead of its
  // catalog entry) still deserves a row — synthesize the minimal def from
  // the unit's own stamped record rather than hiding a hero the colony won.
  for (const unit of earnedUnits) {
    if (entries.some((e) => e.def.id === unit.id)) continue;
    const def: HeroDef = {
      id: unit.id,
      name: unit.name,
      role: unit.role,
      race: unit.race,
      wave: "wave-1",
      identity: "",
      baseAttributes: { ...unit.attributes },
      skills: [],
      signatureDeed: unit.earnedBy,
      alternateDeeds: [],
      oracleVouch: true,
    };
    entries.push({
      def,
      unit,
      earned: true,
      tier: heroSignatureTier(def),
      paths: heroEarnPaths(def),
    });
  }
  return entries;
}

// ============================================================================
// §4 THE LEVEL LADDER — L1…L10 on the shared square-root curve. Each row
// says what that level OPENS: the L3 mandate milestone, and the playbook
// plays whose minimum leader level is exactly that level (war/playbook.ts).
// ============================================================================
export interface LevelRow {
  level: number;
  /** Cumulative XP required to REACH this level (LEVEL_XP verbatim). */
  xpRequired: number;
  /** True at L3 — the one-time specialization/mandate milestone. */
  isMilestone: boolean;
  /** Plays that first unlock at this leader level. */
  newPlays: readonly Play[];
}

export function levelLadder(): LevelRow[] {
  const rows: LevelRow[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    rows.push({
      level,
      xpRequired: LEVEL_XP[level] ?? 0,
      isMilestone: level === SPECIALIZATION_MILESTONE,
      newPlays: PLAYBOOK.filter((p) => p.minLeaderLevel === level),
    });
  }
  return rows;
}

/** How many of the published plays a leader of this level may run. */
export function playsUnlockedBy(level: number): number {
  return PLAYBOOK.filter((p) => p.minLeaderLevel <= level).length;
}

// ============================================================================
// §5 HOW XP IS EARNED — the published source tables, for display.
// ============================================================================
export type HeroXpSourceId = keyof typeof HERO_XP_SOURCES;

/** Hero XP sources, verbatim from hero-xp.ts HERO_XP_SOURCES (war-ledger
 *  events only — nothing purchasable, no acceleration path). */
export const HERO_XP_SOURCE_ROWS: readonly { id: HeroXpSourceId; xp: number }[] = (
  Object.keys(HERO_XP_SOURCES) as HeroXpSourceId[]
).map((id) => ({ id, xp: HERO_XP_SOURCES[id] }));

export type LeaderXpSourceId = "research" | "breakthrough" | "wildcard" | "deepRun";

/**
 * Leader XP sources AS THE ENGINE GRANTS THEM TODAY. The engine keeps these
 * amounts as literals at its grant sites — engine.ts `researchXp` (+10 per
 * completed project, +25 more when a breakthrough fires) and
 * `resolveExpedition` (+12 for surviving a surprise encounter, +8 for a deep
 * Shatterlands run, tier ≥ 2) — under the shared 40 XP/day colony cap
 * (leader-xp.ts DAILY_XP_CAP). This table is display data mirroring those
 * call sites; if the engine's amounts change, change this table to match.
 */
export const LEADER_XP_SOURCE_ROWS: readonly { id: LeaderXpSourceId; xp: number }[] = [
  { id: "research", xp: 10 },
  { id: "breakthrough", xp: 25 },
  { id: "wildcard", xp: 12 },
  { id: "deepRun", xp: 8 },
];

/** The shared daily XP cap both ladders draw against (separate ledgers). */
export const HALL_DAILY_XP_CAP = DAILY_XP_CAP;
