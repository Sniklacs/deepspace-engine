// MODULES — the sellable tier (owner 2026-10-01; spec: design/modules-build.md).
//
// WHAT IT IS. Forge-manufactured commodities: fixed attributes per (line, tier),
// deterministic crafting keyed to Industry level, deteriorating with use (~20
// battles of life), sellable on the player market. This is RENTED power —
// strong today, scrap within a season (season wipe). It is NOT the legend tier:
// modules can never be named, never carry reverb, never ascend to artifact,
// and never touch the relic slot.
//
// THE COMMODITY CONTRACT. A module is fully described by (line, tier). Two
// modules of the same line and tier have byte-identical stats. They differ only
// in identity, condition, owner, and provenance. No rolls, no grades, no
// surprises — the forge *manufactures* modules; it *renders* weapons.
//
// OPEN QUESTIONS (resolved 2026-10-03, per spec proposals):
//   1. Store at launch: bounded from day one — Mk I–II of the two basic lines
//      only, price ≥ 150% of craft cost (STORE_MODULE_POLICY below). Actual
//      Xsolla SKU wiring is a monetization-catalog concern, not this module.
//   2. No-duplicate-line rule: KEPT — one of each line per bearer.
//   3. Repair: NEVER — the replacement loop feeds forgers and the market.
//   4. Deterioration pace: −5/battle, −1/day — ship as specced, tune in play.
import { forgeCeilingPower, weightedPower, type ForgeLocation } from "./forge";
import type { WeaponStats } from "./armory";
import type { RaceId } from "./types";

// ======================================================================
// THE CONFIG — every number the module system uses is here.
// ======================================================================
export const MODULE_CONFIG = {
  /** Rack limit — a save cannot grow without bound (shares the forge's discipline). */
  maxModules: 48,
  /** Battle tick: condition lost per real battle the bearer fights equipped. */
  battleDecay: 5,
  /** Idle tick: condition lost per 24h while equipped. Racked/cargo modules are immortal. */
  idleDecayPerDay: 1,
  /** UI warnings — worn at ≤20, failing at ≤5. No silent breakage. */
  warnWornAt: 20,
  warnFailingAt: 5,
  /** Craft-cost → Scrip conversion for the store price floor (tunable). */
  scripValue: { supplies: 1, embers: 5, warplate: 25 },
} as const;

// ----------------------------------------------------------------------
// THE LINES — four, fixed, in the same style as FORGE_GRADES.
// ----------------------------------------------------------------------
export type ModuleLineId = "siege-coil" | "aegis-plate" | "warden-mesh" | "striker-rig";
export type ModuleTier = 1 | 2 | 3 | 4;

export interface ModuleLine {
  id: ModuleLineId;
  /** i18n key the UI renders (never hardcoded English in saves) */
  labelKey: string;
  /** stat profile: which axis is primary */
  profile: "power" | "guard" | "guard-power" | "power-guard";
}

export const MODULE_LINES: readonly ModuleLine[] = [
  { id: "siege-coil", labelKey: "module.line.siegeCoil", profile: "power" },
  { id: "aegis-plate", labelKey: "module.line.aegisPlate", profile: "guard" },
  { id: "warden-mesh", labelKey: "module.line.wardenMesh", profile: "guard-power" },
  { id: "striker-rig", labelKey: "module.line.strikerRig", profile: "power-guard" },
];

export const MODULE_LINE_IDS: readonly ModuleLineId[] = MODULE_LINES.map((l) => l.id);

export function moduleLine(id: string): ModuleLine {
  return MODULE_LINES.find((l) => l.id === id) ?? MODULE_LINES[0];
}

/** Tier fractions of the forge ceiling (spec §1.3 — tunable, not locked). */
const TIER_FRACTIONS = [
  { single: 0.06, primary: 0.05, secondary: 0.02 }, // Mk I
  { single: 0.1, primary: 0.08, secondary: 0.03 }, // Mk II
  { single: 0.15, primary: 0.12, secondary: 0.05 }, // Mk III
  { single: 0.22, primary: 0.18, secondary: 0.07 }, // Mk IV
] as const;

export function moduleTierName(tier: ModuleTier): string {
  return `Mk ${["I", "II", "III", "IV"][tier - 1]}`;
}

/** FIXED stats for a (line, tier) — deterministic, byte-identical for every
 *  module of the same line and tier. v1 lines use only the power/guard axes;
 *  precision/logistics are 0 (spec §1.2). */
export function moduleStatsFor(line: ModuleLineId, tier: ModuleTier, ceiling = forgeCeilingPower()): WeaponStats {
  const f = TIER_FRACTIONS[tier - 1];
  const { profile } = moduleLine(line);
  let power = 0;
  let guard = 0;
  if (profile === "power") power = Math.round(ceiling * f.single);
  else if (profile === "guard") guard = Math.round(ceiling * f.single);
  else if (profile === "guard-power") {
    guard = Math.round(ceiling * f.primary);
    power = Math.round(ceiling * f.secondary);
  } else {
    power = Math.round(ceiling * f.primary);
    guard = Math.round(ceiling * f.secondary);
  }
  return { power, precision: 0, guard, logistics: 0 };
}

/** The generated name — line name + tier. Never player-set (commodity contract). */
export function moduleDisplayName(line: ModuleLineId, tier: ModuleTier): string {
  const names: Record<ModuleLineId, string> = {
    "siege-coil": "Siege Coil",
    "aegis-plate": "Aegis Plate",
    "warden-mesh": "Warden Mesh",
    "striker-rig": "Striker Rig",
  };
  return `${names[line]} ${moduleTierName(tier)}`;
}

// ----------------------------------------------------------------------
// THE RECIPES — one per line. Tier is DETERMINISTIC: min(4, industry level).
// ----------------------------------------------------------------------
export interface ModuleRecipe {
  id: ModuleLineId;
  line: ModuleLineId;
  /** cost per tier crafted (index 0 = Mk I) */
  costByTier: readonly { warplate: number; supplies: number; embers: number }[];
  /** recovered-AI gate: industry 1 for basics, 2 for hybrids. Never a hard-lock. */
  unlock: { domain: "industry"; level: number };
}

export const MODULE_RECIPES: readonly ModuleRecipe[] = [
  {
    id: "siege-coil",
    line: "siege-coil",
    costByTier: [
      { warplate: 2, supplies: 60, embers: 15 },
      { warplate: 4, supplies: 110, embers: 30 },
      { warplate: 7, supplies: 200, embers: 55 },
      { warplate: 11, supplies: 340, embers: 95 },
    ],
    unlock: { domain: "industry", level: 1 },
  },
  {
    id: "aegis-plate",
    line: "aegis-plate",
    costByTier: [
      { warplate: 2, supplies: 60, embers: 15 },
      { warplate: 4, supplies: 110, embers: 30 },
      { warplate: 7, supplies: 200, embers: 55 },
      { warplate: 11, supplies: 340, embers: 95 },
    ],
    unlock: { domain: "industry", level: 1 },
  },
  {
    id: "warden-mesh",
    line: "warden-mesh",
    costByTier: [
      { warplate: 2, supplies: 60, embers: 15 },
      { warplate: 4, supplies: 110, embers: 30 },
      { warplate: 7, supplies: 200, embers: 55 },
      { warplate: 11, supplies: 340, embers: 95 },
    ],
    unlock: { domain: "industry", level: 2 },
  },
  {
    id: "striker-rig",
    line: "striker-rig",
    costByTier: [
      { warplate: 2, supplies: 60, embers: 15 },
      { warplate: 4, supplies: 110, embers: 30 },
      { warplate: 7, supplies: 200, embers: 55 },
      { warplate: 11, supplies: 340, embers: 95 },
    ],
    unlock: { domain: "industry", level: 2 },
  },
];

export function getModuleRecipe(id: string): ModuleRecipe | undefined {
  return MODULE_RECIPES.find((r) => r.id === id);
}

/** The tier a craft produces — deterministic, no roll (spec §2.1). */
export function moduleTierForIndustry(industryLevel: number): ModuleTier {
  return Math.max(1, Math.min(4, Math.floor(industryLevel))) as ModuleTier;
}

// ----------------------------------------------------------------------
// THE ITEM — a first-class object, not a stack id.
// ----------------------------------------------------------------------
export interface ModuleItem {
  /** unique identity — trade, loot, escrow move THIS */
  id: string;
  line: ModuleLineId;
  tier: ModuleTier;
  /** generated: line name + "Mk " + tier — never player-set */
  name: string;
  /** FIXED from the line/tier table — never rolled */
  stats: WeaponStats;
  /** weightedPower(stats) — fixed */
  power: number;
  /** 0..100 — the deterioration clock. `broken` is derived, never stored. */
  condition: number;
  warplateSpent: number;
  suppliesSpent: number;
  embersSpent: number;
  ownerId: string;
  ownerName: string;
  /** "cradle" (safe) | "transit" | "field" (at risk) — same machinery as forge */
  location: ForgeLocation;
  locationSince: number;
  equippedBy: { kind: "hero" | "leader"; id: string; slot: "module1" | "module2" } | null;
  /** market listing id while listed — listed modules can't be worn/melted/moved */
  listedId: string | null;
  /** last idle-decay sweep (epoch ms) — racked modules don't tick */
  lastIdleTickAt: number;
  provenance: { craftedAt: number; gameId: string | null; race: RaceId | null; seq: number };
}

/** `broken` is derived (condition <= 0), never stored (spec §1.4). */
export function moduleBroken(m: Pick<ModuleItem, "condition">): boolean {
  return m.condition <= 0;
}

export function moduleConditionLabel(condition: number): "fine" | "worn" | "failing" | "broken" {
  if (condition <= 0) return "broken";
  if (condition <= MODULE_CONFIG.warnFailingAt) return "failing";
  if (condition <= MODULE_CONFIG.warnWornAt) return "worn";
  return "fine";
}

/** One craft, fully materialized. Pure given args — the engine calls it once,
 *  inside the same operation that deducts the ingredients (forge.ts convention). */
export function craftModuleItem(args: {
  recipe: ModuleRecipe;
  tier: ModuleTier;
  race: RaceId | null;
  ownerId: string;
  ownerName: string;
  gameId: string | null;
  seq: number;
  now: number;
}): ModuleItem {
  const stats = moduleStatsFor(args.recipe.line, args.tier);
  const cost = args.recipe.costByTier[args.tier - 1];
  const id = `md-${(args.gameId ?? "local").replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}-${args.seq}`;
  return {
    id,
    line: args.recipe.line,
    tier: args.tier,
    name: moduleDisplayName(args.recipe.line, args.tier),
    stats,
    power: weightedPower(stats),
    condition: 100,
    warplateSpent: cost.warplate,
    suppliesSpent: cost.supplies,
    embersSpent: cost.embers,
    ownerId: args.ownerId,
    ownerName: args.ownerName,
    location: "cradle",
    locationSince: args.now,
    equippedBy: null,
    listedId: null,
    lastIdleTickAt: args.now,
    provenance: { craftedAt: args.now, gameId: args.gameId, race: args.race, seq: args.seq },
  };
}

/** Melt-down refund. Broken modules melt for 25% of the normal refund — scrap,
 *  not value. Never zero Warplate (spec §2.3: no module is ever worth less
 *  than its scrap). */
export function moduleMeltRefund(item: Pick<ModuleItem, "condition" | "warplateSpent" | "suppliesSpent" | "tier">): {
  warplate: number;
  supplies: number;
} {
  const scale = 0.5 * (0.8 + 0.2 * item.tier);
  let warplate = Math.max(1, Math.round(item.warplateSpent * scale));
  let supplies = Math.max(0, Math.round(item.suppliesSpent * 0.25));
  if (moduleBroken(item)) {
    warplate = Math.max(1, Math.round(warplate * 0.25));
    supplies = Math.round(supplies * 0.25);
  }
  return { warplate, supplies };
}

// ----------------------------------------------------------------------
// DETERIORATION — the replacement-demand loop (spec §4).
// ----------------------------------------------------------------------
/** Battle tick: −5 condition per real battle the bearer fights equipped.
 *  Arena mock battles never tick. Returns the new condition. */
export function tickModuleBattle(m: ModuleItem): number {
  if (!m.equippedBy) return m.condition;
  m.condition = Math.max(0, m.condition - MODULE_CONFIG.battleDecay);
  return m.condition;
}

/** Idle tick: −1 per 24h while equipped. Racked, cargo, or in-transit modules
 *  do not decay — storage is protection. Returns the new condition. */
export function tickModuleIdle(m: ModuleItem, now: number): number {
  if (!m.equippedBy) {
    m.lastIdleTickAt = now;
    return m.condition;
  }
  const days = Math.floor((now - m.lastIdleTickAt) / 86_400_000);
  if (days > 0) {
    m.condition = Math.max(0, m.condition - days * MODULE_CONFIG.idleDecayPerDay);
    m.lastIdleTickAt += days * 86_400_000;
  }
  return m.condition;
}

// ----------------------------------------------------------------------
// SEAMS — loot, trade (spec §6). Mirror the forge seams.
// ----------------------------------------------------------------------
/** Modules DEPLOYED IN THE FIELD (cargo manifest). At risk when plundered. */
export function seizableModules(items: readonly ModuleItem[]): ModuleItem[] {
  return items.filter((i) => i.location === "field" && !i.equippedBy);
}

/** Hand a module to another owner — the trade/market/plunder path. Moves the
 *  SAME identity; arrives in the new owner's stores, unequipped, unlisted. */
export function transferModule(item: ModuleItem, toOwnerId: string, toOwnerName: string, now: number): ModuleItem {
  return {
    ...item,
    ownerId: toOwnerId,
    ownerName: toOwnerName,
    location: "cradle",
    locationSince: now,
    equippedBy: null,
    listedId: null,
    lastIdleTickAt: now,
  };
}

// ======================================================================
// THE MARKET — player-to-player, Scrip, 5% fee destroyed (spec §8.1).
// ======================================================================
export const MARKET_CONFIG = {
  /** The game's cut: 5% of sale price in Scrip, DESTROYED (a sink, not revenue). */
  feeBps: 500,
  /** Listings expire after 7 days and return to the seller. */
  listingDays: 7,
  /** Anti-spam: small supplies fee per listing. */
  listingFeeSupplies: 25,
  /** Max live listings per seller. */
  maxListings: 24,
} as const;

export interface MarketListing {
  id: string;
  moduleId: string;
  /** snapshot at list time — commodities don't change, but the snapshot is the lock */
  line: ModuleLineId;
  tier: ModuleTier;
  name: string;
  stats: WeaponStats;
  power: number;
  condition: number;
  sellerId: string;
  sellerName: string;
  /** fixed asking price in Scrip */
  price: number;
  listedAt: number;
  expiresAt: number;
}

export function marketFee(price: number): number {
  return Math.floor((price * MARKET_CONFIG.feeBps) / 10_000);
}

export function marketSellerProceeds(price: number): number {
  return price - marketFee(price);
}

export function marketListingExpired(l: Pick<MarketListing, "expiresAt">, now: number): boolean {
  return now >= l.expiresAt;
}

/** Validate a listing request. Returns the error or null. */
export function validateListing(
  item: ModuleItem,
  price: number,
  sellerLiveCount: number,
): string | null {
  if (moduleBroken(item)) return "Broken modules can't be listed — melt them for scrap.";
  if (item.equippedBy) return "That module is worn — take it off before listing it.";
  if (item.location !== "cradle") return "Only modules on the racks can be listed.";
  if (item.listedId) return "That module is already listed.";
  if (!Number.isFinite(price) || price < 1) return "Name a price of at least 1 Scrip.";
  if (sellerLiveCount >= MARKET_CONFIG.maxListings)
    return `You already have ${MARKET_CONFIG.maxListings} live listings — the most the market board holds.`;
  return null;
}

export function makeListing(args: {
  item: ModuleItem;
  sellerId: string;
  sellerName: string;
  price: number;
  now: number;
}): MarketListing {
  const seq = Math.floor(Math.random() * 1_679_616).toString(36);
  return {
    id: `mk-${args.now.toString(36)}-${seq}`,
    moduleId: args.item.id,
    line: args.item.line,
    tier: args.item.tier,
    name: args.item.name,
    stats: { ...args.item.stats },
    power: args.item.power,
    condition: Math.round(args.item.condition),
    sellerId: args.sellerId,
    sellerName: args.sellerName,
    price: Math.floor(args.price),
    listedAt: args.now,
    expiresAt: args.now + MARKET_CONFIG.listingDays * 86_400_000,
  };
}

// ======================================================================
// THE STORE BOUNDARY (spec §8.2) — v1 proposal, enforced as data.
// ======================================================================
/** v1: the store sells Mk I–II of the two basic lines ONLY. Mk III+ and the
 *  hybrids are forged, traded, or looted — never bought. */
export const STORE_MODULE_POLICY = {
  allowedLines: ["siege-coil", "aegis-plate"] as const,
  maxTier: 2 as const,
  /** The store price sits AT OR ABOVE 150% of craft cost (Scrip-equivalent),
   *  so player-forgers are never undercut by the shop. */
  minPriceVsCraft: 1.5,
} as const;

export function storeModuleAllowed(line: ModuleLineId, tier: ModuleTier): boolean {
  return (
    (STORE_MODULE_POLICY.allowedLines as readonly string[]).includes(line) && tier <= STORE_MODULE_POLICY.maxTier
  );
}

/** Craft cost in Scrip-equivalent (tunable conversion). The store SKU price for
 *  a (line, tier) must sit at or above 1.5× this. */
export function moduleCraftScripValue(line: ModuleLineId, tier: ModuleTier): number {
  const recipe = getModuleRecipe(line);
  if (!recipe) return 0;
  const cost = recipe.costByTier[tier - 1];
  const v = MODULE_CONFIG.scripValue;
  return cost.supplies * v.supplies + cost.embers * v.embers + cost.warplate * v.warplate;
}

export function storeModuleMinPrice(line: ModuleLineId, tier: ModuleTier): number {
  return Math.ceil(moduleCraftScripValue(line, tier) * STORE_MODULE_POLICY.minPriceVsCraft);
}
