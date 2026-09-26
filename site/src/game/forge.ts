// THE FORGE — the AI-gated facility that renders ONE weapon per roll (owner
// 2026-09-26; "Deepspace Research Facility" dropped: it collided with the
// game's own title and the Lab already owns research).
//
// WHAT IT IS. Ingredients go in, the Forge spits out exactly ONE item with
// rolled attributes and a grade. Nobody — not the player, not the developer —
// can predict the roll. There is NO copy, NO blueprint and NO mass production:
// the FORWARD BASE is what produces in multiples; the Forge is deliberately the
// opposite (that contrast is the design, not an inconsistency).
//
// WHERE EVERY NUMBER LIVES. One config object (FORGE_CONFIG) + two keyed
// tables (FORGE_GRADES, FORGE_RECIPES). The grade ladder is FIVE BANDS in one
// table — a rename is one line per grade, English and Persian alike.
//
// EARN-ONLY, STRUCTURALLY (G1–G4). Nothing in this module reads a currency, a
// price or an entitlement: ingredients drop in deep Exploration, and the top
// grade is bounded by the best weapon ALREADY OBTAINABLE IN PLAY (see
// forgeCeilingPower() — computed from the published armory/battle tables, not
// hardcoded, so the bound cannot drift when those tables change).
//
// THE UN-REROLLABLE ROLL. Forge_items are MATERIALIZED: a roll writes a
// complete item (stats, grade, power, identity) into the save in the same
// operation that consumes the ingredients. Nothing derives an item from a seed
// at read time, so a refresh, a re-login, a replay or an offline advance can
// never reroll it. The engine half lives in engine.forgeRoll(); the RNG call
// happens there, once, between the deduction and the persist.
//
// TRADE / SEIZURE / SUPPLY RUNS. Every item carries a unique identity, an
// owner and a location (cradle stores · in transit · deployed in the field), so
// trade (transferForgeItem), plunder of items in the field (seizableForgeItems)
// and the ~24h supply run (beginSupplyRun) are wiring against EXISTING fields —
// no data migration when those systems ship. There is no trade UI here.
import { WEAPON_BASE_STATS, familyFor, type WeaponStats, type WeaponType } from "./armory";
import type { DomainId, RaceId, Zone } from "./types";
import { kitPower } from "./war/battle-engine";
import { BATTLES_CONFIG } from "./war/war-types";

// ======================================================================
// THE CONFIG — every number the Forge uses is here.
// ======================================================================
export const FORGE_CONFIG = {
  /** Depth thresholds that decide the ingredient drop. They MIRROR the engine's
   *  zone tiers (engine.DEEP / engine.REVELATION_DEEP / the 75 "deepest" ring)
   *  and the forge suite asserts the equality, so they cannot drift apart. */
  depth: { direct: 35, deep: 60, deepest: 75 },
  /** Warplate per completed run, by depth tier 0..3. SHALLOW IS ZERO: the outer
   *  ruins have no warplate at all, which is what teaches the depth link. */
  dropChanceByTier: [0, 0.06, 0.18, 0.35] as const,
  /** [min, max] Warplate per successful drop, by depth tier. */
  dropQtyByTier: [[0, 0], [1, 1], [1, 2], [2, 3]] as const,
  /** The supply run to the forward base (owner: "about a 24-hour shipping").
   *  Real transit time; there is no forward base in beta, so nothing in the UI
   *  launches one yet — the seam is real code, not a comment. */
  supplyRunMs: 24 * 60 * 60_000,
  /** Rack limit — a save cannot grow without bound. */
  maxItems: 48,
  /** Melt-down also returns a quarter of the supplies the roll burned. */
  meltSupplyFraction: 0.25,
  /** How much of the spent Warplate a melt-down returns, at best. Multiplied by
   *  the grade's own meltBack (below), so refunds scale with grade. */
  meltWarplateFraction: 0.5,
} as const;

// ----------------------------------------------------------------------
// THE GRADE LADDER — five bands, ONE table. Renaming a band is one line
// (id + labelKey); the band arithmetic follows the fractions.
// ----------------------------------------------------------------------
export type ForgeGradeId = "makeshift" | "patterned" | "tempered" | "masterworked" | "prewar";

export interface ForgeGrade {
  id: ForgeGradeId;
  /** the i18n key the UI renders (never a hardcoded English name) */
  labelKey: string;
  /** band over the EARNED ceiling: [low, high] as a fraction of it */
  low: number;
  high: number;
  /** melt-back scale: what fraction of the cap a band returns */
  meltBack: number;
}

export const FORGE_GRADES: readonly ForgeGrade[] = [
  { id: "makeshift", labelKey: "forge.grade.makeshift", low: 0.45, high: 0.58, meltBack: 0.8 },
  { id: "patterned", labelKey: "forge.grade.patterned", low: 0.58, high: 0.72, meltBack: 1.0 },
  { id: "tempered", labelKey: "forge.grade.tempered", low: 0.72, high: 0.85, meltBack: 1.2 },
  { id: "masterworked", labelKey: "forge.grade.masterworked", low: 0.85, high: 0.96, meltBack: 1.4 },
  { id: "prewar", labelKey: "forge.grade.prewar", low: 0.96, high: 1.0, meltBack: 1.6 },
];

export const FORGE_GRADE_IDS: readonly ForgeGradeId[] = FORGE_GRADES.map((g) => g.id);

export function forgeGrade(id: string): ForgeGrade {
  return FORGE_GRADES.find((g) => g.id === id) ?? FORGE_GRADES[0];
}

export function forgeGradeIndex(id: string): number {
  const i = FORGE_GRADES.findIndex((g) => g.id === id);
  return i < 0 ? 0 : i;
}

// ----------------------------------------------------------------------
// THE CEILING — the earnable bound the top grade may never exceed.
// ----------------------------------------------------------------------
/** Unit power of the best weapon a player can EARN today: the strongest armory
 *  family at T4, priced with the battle system's own stat weights. Computed
 *  from the published tables (WEAPON_BASE_STATS × ARMORY_CONFIG.tierMult ×
 *  BATTLES_CONFIG.weaponStatWeights) so it tracks any balance change instead of
 *  being a remembered number. */
export function forgeCeilingPower(): number {
  const families = Object.keys(WEAPON_BASE_STATS) as WeaponType[];
  return families.reduce((max, f) => Math.max(max, kitPower(f, 4)), 0);
}

/** Unit power of the Armory's entry craft in a family (the "standard craft from
 *  the same materials" the quality floor is measured against). */
export function forgeFamilyFloor(family: WeaponType): number {
  return kitPower(family, 1);
}

/** The integer power band of a grade, over the earned ceiling. */
export function forgeBand(gradeId: string, ceiling = forgeCeilingPower()): { low: number; high: number } {
  const g = forgeGrade(gradeId);
  return { low: Math.ceil(ceiling * g.low), high: Math.floor(ceiling * g.high) };
}

/** The grade a realized unit power belongs to — the ladder read bottom-up, so
 *  the bands are contiguous by construction. */
export function gradeForPower(power: number, ceiling = forgeCeilingPower()): ForgeGrade {
  let out = FORGE_GRADES[0];
  for (const g of FORGE_GRADES) if (power >= forgeBand(g.id, ceiling).low) out = g;
  return out;
}

// ----------------------------------------------------------------------
// THE RECIPES — one per kind (assault / defence), each with its GUARANTEED
// minimum grade. That minimum IS the quality floor: no roll from a recipe can
// land below it, and the floor is measured above the Armory's entry craft in
// the same family (asserted by the forge suite).
// ----------------------------------------------------------------------
export type ForgeKind = "assault" | "defence";

export interface ForgeRecipe {
  id: ForgeKind;
  kind: ForgeKind;
  /** the armory family the piece is built on (assault · engine = the
   *  guard/logistics role, i.e. the defensive piece) */
  family: WeaponType;
  nameKey: string;
  subKey: string;
  /** consumed, atomically, in the same operation that rolls and persists */
  cost: { warplate: number; supplies: number; embers: number };
  /** the guaranteed floor (a MINIMUM grade, never a hard-lock) */
  minGrade: ForgeGradeId;
  /** relative odds per grade, in FORGE_GRADES order. Entries below minGrade are
   *  ignored (the floor is enforced in code, so the table stays readable). */
  weights: readonly number[];
  /** recovered-AI gate: the Lab's deployed domains. Never a hard-lock — the UI
   *  always prints what it needs. */
  unlock: { domain: DomainId; level: number };
}

export const FORGE_RECIPES: readonly ForgeRecipe[] = [
  {
    id: "assault",
    kind: "assault",
    family: "assault",
    nameKey: "forge.recipe.assault",
    subKey: "forge.recipe.assaultSub",
    cost: { warplate: 6, supplies: 150, embers: 40 },
    minGrade: "makeshift",
    weights: [50, 26, 14, 8, 2],
    unlock: { domain: "industry", level: 1 },
  },
  {
    id: "defence",
    kind: "defence",
    family: "engine",
    nameKey: "forge.recipe.defence",
    subKey: "forge.recipe.defenceSub",
    cost: { warplate: 10, supplies: 250, embers: 80 },
    // The deeper pattern guarantees a HIGHER floor — that is what the extra
    // Warplate buys, and it is why "roll again with more materials" is the
    // frustration valve rather than a reroll of the same roll.
    minGrade: "patterned",
    weights: [0, 46, 28, 18, 8],
    unlock: { domain: "industry", level: 2 },
  },
];

export function getForgeRecipe(id: string): ForgeRecipe | undefined {
  return FORGE_RECIPES.find((r) => r.id === id);
}

/** Odds of each grade for a recipe (0..1, in FORGE_GRADES order). The floor is
 *  enforced here so display and roll can never disagree. */
export function forgeGradeChances(recipe: ForgeRecipe): number[] {
  const minIndex = forgeGradeIndex(recipe.minGrade);
  const eff = recipe.weights.map((w, i) => (i < minIndex ? 0 : Math.max(0, w)));
  const total = eff.reduce((a, b) => a + b, 0) || 1;
  return eff.map((w) => w / total);
}

// ----------------------------------------------------------------------
// THE INGREDIENT DROP — depth is the whole of it.
// ----------------------------------------------------------------------
/** The drop tier of a zone: 0 = no warplate at all (shallow), 1 = the deep
 *  ring, 2 = the deep scientific sites, 3 = the deepest sites. */
export function forgeDepthTier(zone: Pick<Zone, "radiationLevel" | "risk">): number {
  const { direct, deep, deepest } = FORGE_CONFIG.depth;
  if (zone.radiationLevel >= deepest) return 3;
  if (zone.radiationLevel >= deep) return 2;
  if (zone.radiationLevel >= direct || zone.risk >= 50) return 1;
  return 0;
}

export function forgeDropChance(tier: number): number {
  return FORGE_CONFIG.dropChanceByTier[Math.max(0, Math.min(3, tier))] ?? 0;
}

/** Warplate a successful drop yields at a depth tier (deterministic given rand). */
export function forgeDropAmount(tier: number, rand: () => number = Math.random): number {
  const band = FORGE_CONFIG.dropQtyByTier[Math.max(0, Math.min(3, tier))] ?? [0, 0];
  const [lo, hi] = band;
  if (hi <= 0) return 0;
  return lo + Math.floor(rand() * (hi - lo + 1));
}

// ----------------------------------------------------------------------
// THE ITEM — a first-class object, not a stack id.
// ----------------------------------------------------------------------
export type ForgeLocation = "cradle" | "transit" | "field";

export interface ForgeItem {
  /** unique identity — trade, seizure and supply runs all move THIS. */
  id: string;
  kind: ForgeKind;
  recipeId: string;
  /** the armory family the piece is priced as */
  family: WeaponType;
  /** display name (family flavour + grade label), resolved at roll time */
  name: string;
  grade: ForgeGradeId;
  stats: WeaponStats;
  /** unit power — the SAME weighted sum the battle engine uses for a kit, so a
   *  forged piece is comparable (and later committable) without conversion */
  power: number;
  /** the ceiling the top grade was bounded by AT ROLL TIME (provenance) */
  ceilingAtRoll: number;
  /** the entry craft in the same family at roll time — the floor comparison */
  floorAtRoll: number;
  /** what it cost (melt-down reads this) */
  warplateSpent: number;
  suppliesSpent: number;
  embersSpent: number;
  /** OWNER: the account that rolled it (identity for trade and plunder) */
  ownerId: string;
  ownerName: string;
  /** LOCATION: main colony stores · in transit · deployed in the field */
  location: ForgeLocation;
  locationSince: number;
  /** set while location === "transit" (the ~24h supply run) */
  transit?: { from: ForgeLocation; to: ForgeLocation; departAt: number; arriveAt: number };
  provenance: { rolledAt: number; gameId: string | null; race: RaceId | null; seq: number };
}

/** The weighted unit power of an item's OWN rolled stats — recomputed with the
 *  battle system's weights, so a forged piece and an Armory kit are priced by
 *  one formula (and a forged item's stored power can be re-derived, never
 *  guessed). */
export function weightedPower(stats: WeaponStats): number {
  const w = BATTLES_CONFIG.weaponStatWeights;
  return Math.round(
    stats.power * w.power + stats.precision * w.precision + stats.guard * w.guard + stats.logistics * w.logistics,
  );
}

const AXES: (keyof WeaponStats)[] = ["power", "precision", "guard", "logistics"];

/** Roll integer stats whose weighted sum is EXACTLY `target`.
 *
 *  The family's shape gives the piece its identity, the jitter gives it a
 *  temperament, and the last axis settles the arithmetic: with `precision` and
 *  `guard` held to EVEN values their half-weights contribute whole numbers, so
 *  `logistics` (weight 1) can always step the total onto the target exactly.
 *  That exactness is what guarantees the printed power lies in the grade band
 *  the roll chose — the grade and the number can never disagree. */
export function rollStatsFor(family: WeaponType, target: number, rand: () => number): WeaponStats {
  const base = WEAPON_BASE_STATS[family];
  const weights = BATTLES_CONFIG.weaponStatWeights;
  const even = (v: number) => 2 * Math.max(1, Math.round(v / 2));
  const shape = [
    Math.max(1, Math.round(base.power * (0.7 + rand() * 0.6))),
    even(base.precision * (0.7 + rand() * 0.6)),
    even(base.guard * (0.7 + rand() * 0.6)),
    Math.max(1, Math.round(base.logistics * (0.7 + rand() * 0.6))),
  ];
  const shapeW = AXES.reduce((s, a, i) => s + shape[i] * weights[a], 0);
  const stats: WeaponStats = { power: 1, precision: 1, guard: 1, logistics: 1 };
  AXES.forEach((a, i) => {
    // The axis's share of the target POWER is (shape·weight)/shapeW; dividing the
    // weight back out gives the stat VALUE. Floored at 1 so no axis is ever dead.
    stats[a] = Math.max(1, Math.round((target * shape[i]) / shapeW));
  });
  stats.precision = Math.max(2, 2 * Math.round(stats.precision / 2));
  stats.guard = Math.max(2, 2 * Math.round(stats.guard / 2));
  // Settle on the target with the unit-weight axis. Bounded, and it cannot spin:
  // each step moves the weighted sum by exactly 1.
  let guard = 0;
  let power = weightedPower(stats);
  while (power !== target && guard < 400) {
    if (power < target) stats.logistics += 1;
    else if (stats.logistics > 1) stats.logistics -= 1;
    else break;
    power = weightedPower(stats);
    guard += 1;
  }
  return stats;
}

/** One roll, fully materialized. Pure given `rand` — the engine calls it once,
 *  inside the same operation that deducts the ingredients. */
export function rollForgeItem(args: {
  recipe: ForgeRecipe;
  race: RaceId | null;
  ownerId: string;
  ownerName: string;
  gameId: string | null;
  seq: number;
  now: number;
  rand?: () => number;
}): ForgeItem {
  const rand = args.rand ?? Math.random;
  const { recipe } = args;
  const ceiling = forgeCeilingPower();
  // 1 · the grade, weighted, never below the recipe's floor
  const chances = forgeGradeChances(recipe);
  const roll = rand();
  let acc = 0;
  let gradeIndex = forgeGradeIndex(recipe.minGrade);
  for (let i = 0; i < chances.length; i++) {
    acc += chances[i];
    if (roll < acc) {
      gradeIndex = i;
      break;
    }
  }
  const grade = FORGE_GRADES[gradeIndex];
  // 2 · the power band of that grade, over the EARNED ceiling
  const band = forgeBand(grade.id, ceiling);
  const target = band.low + Math.floor(rand() * Math.max(1, band.high - band.low + 1));
  // 3 · the stats that realize it
  const stats = rollStatsFor(recipe.family, target, rand);
  const power = weightedPower(stats);
  // 4 · identity, owner, location, provenance
  // The stored name is the family's in-fiction name; the GRADE is rendered from
  // its keyed label by the UI, so no English grade word is ever baked into a save.
  const familyName = args.race ? familyFor(args.race, recipe.family)?.name ?? recipe.family : recipe.family;
  const svc = Math.floor(rand() * 1_679_616).toString(36).padStart(4, "0");
  const id = `fg-${(args.gameId ?? "local").replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}-${args.seq}-${svc}`;
  return {
    id,
    kind: recipe.kind,
    recipeId: recipe.id,
    family: recipe.family,
    name: familyName,
    grade: grade.id,
    stats,
    power,
    ceilingAtRoll: ceiling,
    floorAtRoll: forgeFamilyFloor(recipe.family),
    warplateSpent: recipe.cost.warplate,
    suppliesSpent: recipe.cost.supplies,
    embersSpent: recipe.cost.embers,
    ownerId: args.ownerId,
    ownerName: args.ownerName,
    location: "cradle",
    locationSince: args.now,
    provenance: { rolledAt: args.now, gameId: args.gameId, race: args.race, seq: args.seq },
  };
}

/** What a melt-down returns: Warplate scaled by the grade, plus a quarter of the
 *  supplies the roll burned. Never zero Warplate — an unwanted roll always
 *  leaves something in the crucible. */
export function meltRefund(item: ForgeItem): { warplate: number; supplies: number } {
  const grade = forgeGrade(item.grade);
  const warplate = Math.max(
    1,
    Math.round(item.warplateSpent * FORGE_CONFIG.meltWarplateFraction * grade.meltBack),
  );
  const supplies = Math.max(0, Math.round(item.suppliesSpent * FORGE_CONFIG.meltSupplyFraction));
  return { warplate, supplies };
}

// ----------------------------------------------------------------------
// THE SEAMS — real functions today, wiring later (war · trade · forward base).
// ----------------------------------------------------------------------
/** Items DEPLOYED IN THE FIELD. These are the ones at risk when a colony or
 *  forward base is plundered (owner: "if you can get to it and plunder it you
 *  have a chance of seizing these"). Storage is protection; the toggle is a
 *  decision with a cost. */
export function seizableForgeItems(items: readonly ForgeItem[]): ForgeItem[] {
  return items.filter((i) => i.location === "field");
}

/** Hand an item to another owner — the trade path (and the plunder path, once
 *  war's chances are rolled). Moves the SAME identity: no migration, no new
 *  shape, and the item arrives in the new owner's main-colony stores. */
export function transferForgeItem(item: ForgeItem, toOwnerId: string, toOwnerName: string, now: number): ForgeItem {
  return {
    ...item,
    ownerId: toOwnerId,
    ownerName: toOwnerName,
    location: "cradle",
    locationSince: now,
    transit: undefined,
    provenance: { ...item.provenance, rolledAt: item.provenance.rolledAt },
  };
}
