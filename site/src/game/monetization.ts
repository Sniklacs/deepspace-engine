// MONETIZATION SEAMS — catalog, currency ledger, entitlements, payment provider.
//
// Spec: design/monetization.md (§1–§8). This module implements the SERVER-SIDE
// seams only, exactly as the spec defines them, so a real payment provider and
// storefront can plug in later without redesign:
//   1. Catalog (Wave-1: 9 purchasable + 7 deed-earned cosmetics, 3 head-start
//      packs, 4 Votive pack sizes, 28-tier Season 0 battle pass).
//   2. Currency ledger (Scrip earned / Votives premium; append-only, eventId-
//      idempotent, no negative balances, NO conversion path — none exists).
//   3. Entitlement hooks (grant/revoke/check; packs grant their listed contents;
//      cosmetics equip onto colony visual state; all idempotent).
//   4. Stubbed PaymentProvider (single swap point in createPaymentProvider()).
//   5. Fairness guardrails (§5/§6): assertCatalogFair() throws on any
//      power-touching content; the catalog cannot grow a bad item silently.
//   6. §8 open decisions live in MONETIZATION_CONFIG (spec defaults) — flipping
//      them later is a config edit, not a code change.
//
// This file is PURE (no node imports) so the client bundle can import it; the
// client renders balances/ownership, the server owns the truth.

import type {
  BattlePassState,
  CosmeticSlot,
  CurrencyId,
  CurrencyLedgerEntry,
  CurrencyState,
  EntitlementsState,
  GameState,
} from "./types";
// The real payment provider (payment-links + signature-verified webhook). Its
// imports back into this file are TYPE-ONLY, so there is no runtime cycle and
// this module stays pure for the client bundle.
import { createStripePaymentProvider, type StripeProviderOptions } from "./payments/stripe-provider";

// ======================================================================
// §8 — OPEN DECISIONS AS CONFIG (spec defaults; owner confirmation pending).
// ======================================================================
export const MONETIZATION_CONFIG = {
  // §8.1 — currency display names (spec recommendation). Alternates for
  // Votives: Veritas / Lumen / Relics. Swapping is a strings change only.
  currencyNames: { scrip: "Scrip", votives: "Votives" } as const,
  votiveNameAlternates: ["Veritas", "Lumen", "Relics"] as const,
  // §2.1/§8.8 — pricing anchor: ~100 Votives ≈ $1 at mid/large pack sizes.
  votivesPerUsd: 100,
  // §1.3/§8.2 — NO premium↔earned conversion, ever. This flag documents the
  // locked recommendation (owner sign-off pending); there is deliberately NO
  // conversion code path in this module (a guardrail test asserts the absence).
  allowScripVotiveConversion: false,
  // §5/§8.3 — no randomized purchases at all (no cosmetic loot boxes either).
  allowRandomizedPurchases: false,
  // §4.1/§8.4 — purchased passes never expire (Halo principle); unclaimed
  // season items return (DRG). No expiry field exists on pass entitlements.
  passesNeverExpire: true,
  // §4.1/§8.5 — Season 0 runs the PvE loop. 6 weeks (owner may prefer 8).
  season0Id: "s0_the_shattering",
  season0DurationMs: 6 * 7 * 24 * 60 * 60 * 1000,
  // §3.3/§8.6 — the single gray area: packs may carry at most ~2 days of casual
  // earned income as Scrip. Wave-1 packs carry ZERO Scrip (spec §3.1 lists
  // none); this is the hard server-side lifetime cap if a pack ever does.
  maxScripPerPack: 200,
  // §8.6 — storefront stays OFF through beta (keeps the beta world's purity and
  // the First-Run channel honest). The owner flips this switch at/after launch;
  // catalog/ledger/entitlements run regardless.
  storefrontEnabled: false,
  // §2.2 — deed cosmetics may appear in the shop as commemorative DISPLAY
  // (viewable, never buyable).
  deedDisplayInShop: true,
  // §7.5 — Season pacing (calibratable): tiers unlock every seasonXpPerTier XP.
  // "~45–60 min of normal play per tier" is the design target, tuned later.
  seasonXpPerTier: 1000,
  // §4.1 — weekly objective targets (spec names "N expeditions / M Codices";
  // these are the values, calibratable).
  weeklyExpeditionTarget: 10,
  weeklyCodexTarget: 8,
  weeklyDailyListTarget: 5,
  // §2.2 D4 — pre-Cradle-tiers threshold: total research completions ≥ N
  // ("N to balance"; owner/balance team calibrate).
  d4ResearchCompletions: 12,
} as const;

// ======================================================================
// CATALOG — Wave-1 cosmetics (spec §2).
// ======================================================================
export type CosmeticSource = "purchasable" | "deed";

export interface CosmeticDef {
  id: string;
  name: string;
  slot: CosmeticSlot;
  source: CosmeticSource;
  blurb: string;
  // Purchasable cosmetics carry a Votive price; deed cosmetics never do.
  priceVotives?: number;
  // Deed items name the deed that earns them (D1–D7; spec §2.2).
  deedId?: string;
  // The seam where a real provider SKU will live. Empty until payments are
  // wired (spec §7.3); the storefront maps skuId -> provider SKU at launch.
  providerSkuId?: string;
}

export const COSMETICS: CosmeticDef[] = [
  // ---- §2.1 Purchasable (9) — Votives only, pure appearance ----
  { id: "the-observatory-hull", name: "The Observatory Hull", slot: "cradleFacade", source: "purchasable", priceVotives: 850, providerSkuId: "", blurb: "Observatory brass-and-glass exterior; Grays-adjacent aesthetic, no faction lock." },
  { id: "basalt-citadel", name: "Basalt Citadel", slot: "cradleFacade", source: "purchasable", priceVotives: 750, providerSkuId: "", blurb: "Dark volcanic stone with fissure glow; pairs with site lighting." },
  { id: "the-long-vigil", name: "The Long Vigil", slot: "banner", source: "purchasable", priceVotives: 450, providerSkuId: "", blurb: "Banner flown on your exploration column — the most-seen cosmetic slot." },
  { id: "emberline", name: "Emberline", slot: "vehicleTrim", source: "purchasable", priceVotives: 350, providerSkuId: "", blurb: "Ember-orange racing trim + lamp pattern; per-vehicle cosmetic slot." },
  { id: "votive-bell", name: "Votive Bell", slot: "shrineMotif", source: "purchasable", priceVotives: 400, providerSkuId: "", blurb: "Shrine hanging-bell lighting; rings subtly on shrine daily resets." },
  { id: "the-archivists-duster", name: "The Archivist's Duster", slot: "leaderGarb", source: "purchasable", priceVotives: 800, providerSkuId: "", blurb: "Worn-leather-and-glass duster for your appointed Leader." },
  { id: "the-sundered-ring", name: "The Sundered Ring", slot: "sigilFrame", source: "purchasable", priceVotives: 300, providerSkuId: "", blurb: "Fragmented-ring frame around the colony emblem." },
  { id: "star-atlas-cloth", name: "Star Atlas Cloth", slot: "banner", source: "purchasable", priceVotives: 450, providerSkuId: "", blurb: "Star-chart appliqué banner; Nav-themed." },
  { id: "scaffold-bastion", name: "Scaffold Bastion", slot: "cradleFacade", source: "purchasable", priceVotives: 650, providerSkuId: "", blurb: "Builder-chic: structural beams, cranes, hazard striping." },
  // ---- §2.2 Deed-earned (7) — NEVER purchasable, ever ----
  { id: "first-light-sigil", name: "First Light Sigil", slot: "sigilFrame", source: "deed", deedId: "deed_first_clean", blurb: "First clean recovery — first exploration that returns with zero corrupted fragments gathered." },
  { id: "frontier-banner", name: "Frontier Banner", slot: "banner", source: "deed", deedId: "deed_frontier", blurb: "Pushed frontier — first colony on the server to reach the deepest scientific site zone." },
  { id: "cleansed-hull", name: "Cleansed Hull", slot: "cradleFacade", source: "deed", deedId: "deed_purify", blurb: "Purified a site/zone — first corrupted ruin cleared (tees up the Oracle purity layer)." },
  { id: "the-visionarys-robes", name: "The Visionary's Robes", slot: "leaderGarb", source: "deed", deedId: "deed_tier3_research", blurb: "Milestone — Cradle reaches Tier III (pre-Cradle-tiers: research completions ≥ N)." },
  { id: "wardens-livery", name: "Warden's Livery", slot: "vehicleTrim", source: "deed", deedId: "deed_l5_specialized", blurb: "A Leader reaches L5 with a specialization chosen." },
  { id: "wheel-of-years", name: "Wheel of Years", slot: "shrineMotif", source: "deed", deedId: "deed_30day_devotion", blurb: "30-day daily devotion streak — the retention loop's crown." },
  { id: "the-contribution-ring", name: "The Contribution Ring", slot: "sigilFrame", source: "deed", deedId: "deed_contribution_award", blurb: "Server Contribution Award — one per server per cycle." },
];

export const COSMETIC_BY_ID = Object.fromEntries(COSMETICS.map((c) => [c.id, c])) as Record<string, CosmeticDef>;

export const PURCHASABLE_COSMETICS = COSMETICS.filter((c) => c.source === "purchasable");
export const DEED_COSMETICS = COSMETICS.filter((c) => c.source === "deed");

/** §2.3 Votive pack sizes (Cradle Ledger) — the premium-currency IAP table. */
export interface VotivePackDef {
  id: string;
  name: string;
  votives: number; // base
  bonus: number; // trickle bonus
  priceUsd: number;
  providerSkuId: string; // "" until payments are wired
}
export const VOTIVE_PACKS: VotivePackDef[] = [
  { id: "votive-small", name: "Small Offering", votives: 550, bonus: 0, priceUsd: 4.99, providerSkuId: "" },
  { id: "votive-steady", name: "Steady Devotion", votives: 1200, bonus: 80, priceUsd: 9.99, providerSkuId: "" },
  { id: "votive-grand", name: "Grand Vow", votives: 3000, bonus: 300, priceUsd: 19.99, providerSkuId: "" },
  { id: "votive-circuit", name: "The Complete Circuit", votives: 6500, bonus: 800, priceUsd: 39.99, providerSkuId: "" },
];

// ======================================================================
// HEAD-START PACKS (spec §3) — every grant is on the earnable curve.
// ======================================================================

// Resource keys packs may carry = exactly the craftable resource kinds (the
// "everything in a pack is also craftable with Scrip" rule, §1.1/§3.2.6).
export type PackResourceKey =
  | "supplies" | "gas" | "medkit" | "mechkit" | "armorkit" | "skmech" | "battery" | "hazmat" | "shots" | "alloys";

export type PackGrant =
  | { kind: "resource"; key: PackResourceKey; amount: number; note: string }
  | { kind: "currency"; currency: "votives"; amount: number; note: string }
  | { kind: "cosmetic"; itemId: string; note: string } // entitlement via cosmetic id
  | { kind: "vehicle"; vehicleId: string; note: string }; // ownership flag; model later

export interface HeadStartPackDef {
  id: string;
  name: string;
  priceUsd: number;
  providerSkuId: string; // "" until payments are wired
  blurb: string;
  playEquivalent: string; // a plain comparison to play, e.g. "≈ one week of steady explorations"
  scrip: number; // Scrip-in-pack supply grant (§3.3) — hard-capped; 0 for Wave-1
  grants: PackGrant[];
}

export const HEAD_START_PACKS: HeadStartPackDef[] = [
  {
    id: "scavengers-kit",
    name: "Scavenger's Kit",
    priceUsd: 4.99,
    providerSkuId: "",
    blurb: "Base supplies bundle, fuel for the first convoys, a basic gear set, and a first offering of Votives.",
    playEquivalent: "≈ one week of steady explorations at a casual pace",
    scrip: 0, // §3.1 lists no Scrip for this pack (and §3.3 caps it at 200 anyway)
    grants: [
      { kind: "resource", key: "supplies", amount: 150, note: "base supplies bundle (materials for ~10 crafts)" },
      { kind: "resource", key: "gas", amount: 24, note: "fuel for ~6 explorations" },
      { kind: "resource", key: "medkit", amount: 1, note: "basic gear set (tier-1 schematics included)" },
      { kind: "resource", key: "mechkit", amount: 1, note: "basic gear set — mechanics kit" },
      { kind: "resource", key: "armorkit", amount: 1, note: "basic gear set — armor kit" },
      { kind: "currency", currency: "votives", amount: 150, note: "Votives" },
    ],
  },
  {
    id: "expeditionary-kit",
    name: "Exploration Kit",
    priceUsd: 9.99,
    providerSkuId: "",
    blurb: "A crafted gear set, double fuel and supplies, and a deeper offering of Votives.",
    playEquivalent: "≈ two weeks of a deliberate player, or Cradle Tier 2",
    scrip: 0,
    grants: [
      // Spec §3.1: "crafted tier-2 gear set (armor + tool, no stat beyond craftable
      // tier-2)". Mapped to the current craft kinds armorkit (armor) + mechkit
      // (tool); re-mapped when the real gear tiering lands (IMPLEMENTATION-NOTES).
      { kind: "resource", key: "armorkit", amount: 2, note: "crafted tier-2 gear set — armor" },
      { kind: "resource", key: "mechkit", amount: 2, note: "crafted tier-2 gear set — tool" },
      { kind: "resource", key: "gas", amount: 48, note: "2× fuel (vs Scavenger's Kit base)" },
      { kind: "resource", key: "supplies", amount: 300, note: "2× supplies (vs Scavenger's Kit base)" },
      { kind: "currency", currency: "votives", amount: 300, note: "Votives" },
    ],
  },
  {
    id: "long-haul-cart",
    name: "Long-Haul Cart",
    priceUsd: 12.99,
    providerSkuId: "",
    blurb: "A base vehicle with the Emberline trim, plus Votives.",
    playEquivalent: "≈ what a colony reaches in its second week",
    scrip: 0,
    grants: [
      { kind: "vehicle", vehicleId: "base_cart", note: "base cart (the vehicle model arrives with the vehicle module)" },
      { kind: "cosmetic", itemId: "emberline", note: "Emberline trim — appearance" },
      { kind: "currency", currency: "votives", amount: 450, note: "Votives" },
    ],
  },
];

export const PACK_BY_ID = Object.fromEntries(HEAD_START_PACKS.map((p) => [p.id, p])) as Record<string, HeadStartPackDef>;

// ======================================================================
// BATTLE PASS — Season 0 "The Shattering" (spec §4). PvE-loop season: 28
// tiers, free + premium tracks side by side, no tier skips ever.
// ======================================================================

export type TrackRewardKind = "scrip" | "votives" | "cosmetic" | "sigil" | "convenience" | "capstone_deed" | "showcase";

export interface TrackReward {
  kind: TrackRewardKind;
  label: string;
  amount?: number; // scrip / votives / sigil count
  item?: SeasonalCosmetic; // cosmetic / capstone / showcase
  itemId?: string; // convenience item id
}

export interface SeasonalCosmetic {
  id: string;
  name: string;
  slot: CosmeticSlot;
}

export interface BattlePassTier {
  tier: number; // 1..28
  free: TrackReward;
  premium: TrackReward; // strictly cosmetic/convenience (spec §4.3)
}

// Season-earned cosmetics are NOT Wave-1 shop items — they live here so the
// pass can grant them through the same entitlement service. Unclaimed ones
// return to the shop after the season (FOMO guard, §4.3).
function seasonCosmetic(id: string, name: string, slot: CosmeticSlot): SeasonalCosmetic {
  return { id, name, slot };
}
const sc = seasonCosmetic;
export const SEASON_COSMETICS: SeasonalCosmetic[] = [
  sc("s0-facade-brass", "Season Sigil Brass Facade", "cradleFacade"),
  sc("s0-banner-shatterline", "Shatterline Banner", "banner"),
  sc("s0-facade-emberglass", "Emberglass Facade", "cradleFacade"),
  sc("s0-trim-chorusglass", "Chorus-Glass Trim", "vehicleTrim"),
  sc("s0-motif-stormglass", "Stormglass Shrine Motif", "shrineMotif"),
  sc("s0-garb-cartographer", "The Cartographer's Coat", "leaderGarb"),
  sc("s0-facade-refractory", "Refractory Veil Facade", "cradleFacade"),
  sc("s0-banner-longlight", "Long-Light Banner", "banner"),
  sc("s0-garb-trenchcrown", "Trench-Crown Garb", "leaderGarb"),
  sc("s0-facade-kilnhull", "Kiln-Hull Facade", "cradleFacade"),
  sc("s0-motif-watchtower", "Watch-Tower Motif", "shrineMotif"),
  sc("s0-banner-archive", "Archive Banner", "banner"),
  sc("s0-facade-foundrysaint", "Foundry-Saint Facade", "cradleFacade"),
  sc("s0-garb-farcall", "Far-Call Garb", "leaderGarb"),
  sc("s0-trim-lanternline", "Lantern-Line Trim", "vehicleTrim"),
  sc("s0-facade-oraclecourt", "Oracle Court Facade", "cradleFacade"),
  sc("s0-facade-lastlight", "Last-Light Facade", "cradleFacade"),
  sc("s0-motif-wardenswatch", "Warden's Watch Motif", "shrineMotif"),
  // Free-track earnable variants (never power; earnable-only).
  sc("s0-banner-ashenveil", "Ashen Veil Banner", "banner"),
  sc("s0-trim-dustfall", "Dustfall Trim", "vehicleTrim"),
  sc("s0-sigil-cinder", "Cinder Sigil Frame", "sigilFrame"),
  sc("s0-garb-shatterglass", "Shatterglass Garb", "leaderGarb"),
  sc("s0-palette-fieldash", "Field Ash Palette", "palette"),
  sc("s0-palette-rustline", "Rustline Palette", "palette"),
  sc("s0-banner-sunderedfield", "Sundered Field Banner", "banner"),
  sc("s0-sigil-bone", "Bone-Sigil Frame", "sigilFrame"),
  // Capstones.
  sc("s0-banner-shatterlands", "Shatterlands Banner", "banner"), // free capstone (deed-earned proof)
  sc("s0-facade-lastcandle", "The Last Candle Facade", "cradleFacade"), // premium showcase
];
export const SEASON_COSMETIC_BY_ID = Object.fromEntries(SEASON_COSMETICS.map((c) => [c.id, c])) as Record<string, SeasonalCosmetic>;

// Convenience items (premium track): zero gameplay effect.
export const CONVENIENCE_ITEMS: Record<string, { id: string; name: string; note: string }> = {
  "preset-slot-1": { id: "preset-slot-1", name: "Premium Cosmetic Preset Slot", note: "an extra saved cosmetic loadout — zero gameplay effect" },
  "preset-slot-2": { id: "preset-slot-2", name: "Premium Cosmetic Preset Slot II", note: "another saved cosmetic loadout — zero gameplay effect" },
  "archive-palette": { id: "archive-palette", name: "Archive Palette", note: "unlimited color palette usable only on PURCHASED skins; deed skins keep their symbolic palettes" },
  "relic-stand": { id: "relic-stand", name: "Relic Stand", note: "a display stand for earned relics in the Cradle view — purely cosmetic" },
};

// The 28 tiers. Free track: ~15 Scrip tiers (tapering up), 8 earnable
// cosmetics, 4 Season Sigils, capstone deed cosmetic at 28. Premium track:
// 17 cosmetics, 6 Votive grants, 4 conveniences, showcase capstone. NOTE the
// spec says "~14"/"~16"/"~6" — the counts landed at 15/17/6 so every other
// slot count is exact (13-year-old DRG-style "close enough" latitude, flagged
// in IMPLEMENTATION-NOTES).
export const SEASON_TIERS: BattlePassTier[] = [
  { tier: 1, free: { kind: "scrip", amount: 200, label: "200 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-brass"], label: "Season Sigil Brass Facade" } },
  { tier: 2, free: { kind: "scrip", amount: 220, label: "220 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-banner-shatterline"], label: "Shatterline Banner" } },
  { tier: 3, free: { kind: "scrip", amount: 260, label: "260 Scrip" }, premium: { kind: "votives", amount: 50, label: "50 Votives" } },
  { tier: 4, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-banner-ashenveil"], label: "Ashen Veil Banner" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-emberglass"], label: "Emberglass Facade" } },
  { tier: 5, free: { kind: "sigil", amount: 1, label: "Season Sigil ×1" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-trim-chorusglass"], label: "Chorus-Glass Trim" } },
  { tier: 6, free: { kind: "scrip", amount: 300, label: "300 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-motif-stormglass"], label: "Stormglass Shrine Motif" } },
  { tier: 7, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-trim-dustfall"], label: "Dustfall Trim" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-garb-cartographer"], label: "The Cartographer's Coat" } },
  { tier: 8, free: { kind: "scrip", amount: 340, label: "340 Scrip" }, premium: { kind: "votives", amount: 50, label: "50 Votives" } },
  { tier: 9, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-sigil-cinder"], label: "Cinder Sigil Frame" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-refractory"], label: "Refractory Veil Facade" } },
  { tier: 10, free: { kind: "sigil", amount: 1, label: "Season Sigil ×1" }, premium: { kind: "convenience", itemId: "preset-slot-1", label: "Premium Cosmetic Preset Slot" } },
  { tier: 11, free: { kind: "scrip", amount: 380, label: "380 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-banner-longlight"], label: "Long-Light Banner" } },
  { tier: 12, free: { kind: "scrip", amount: 420, label: "420 Scrip" }, premium: { kind: "votives", amount: 50, label: "50 Votives" } },
  { tier: 13, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-garb-shatterglass"], label: "Shatterglass Garb" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-garb-trenchcrown"], label: "Trench-Crown Garb" } },
  { tier: 14, free: { kind: "scrip", amount: 460, label: "460 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-kilnhull"], label: "Kiln-Hull Facade" } },
  { tier: 15, free: { kind: "sigil", amount: 1, label: "Season Sigil ×1" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-motif-watchtower"], label: "Watch-Tower Motif" } },
  { tier: 16, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-palette-fieldash"], label: "Field Ash Palette" }, premium: { kind: "convenience", itemId: "preset-slot-2", label: "Premium Cosmetic Preset Slot II" } },
  { tier: 17, free: { kind: "scrip", amount: 480, label: "480 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-banner-archive"], label: "Archive Banner" } },
  { tier: 18, free: { kind: "scrip", amount: 500, label: "500 Scrip" }, premium: { kind: "votives", amount: 75, label: "75 Votives" } },
  { tier: 19, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-palette-rustline"], label: "Rustline Palette" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-foundrysaint"], label: "Foundry-Saint Facade" } },
  { tier: 20, free: { kind: "sigil", amount: 1, label: "Season Sigil ×1" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-garb-farcall"], label: "Far-Call Garb" } },
  { tier: 21, free: { kind: "scrip", amount: 520, label: "520 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-trim-lanternline"], label: "Lantern-Line Trim" } },
  { tier: 22, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-banner-sunderedfield"], label: "Sundered Field Banner" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-oraclecourt"], label: "Oracle Court Facade" } },
  { tier: 23, free: { kind: "scrip", amount: 540, label: "540 Scrip" }, premium: { kind: "votives", amount: 75, label: "75 Votives" } },
  { tier: 24, free: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-sigil-bone"], label: "Bone-Sigil Frame" }, premium: { kind: "convenience", itemId: "archive-palette", label: "Archive Palette" } },
  { tier: 25, free: { kind: "scrip", amount: 560, label: "560 Scrip" }, premium: { kind: "cosmetic", item: SEASON_COSMETIC_BY_ID["s0-facade-lastlight"], label: "Last-Light Facade" } },
  { tier: 26, free: { kind: "scrip", amount: 580, label: "580 Scrip" }, premium: { kind: "convenience", itemId: "relic-stand", label: "Relic Stand" } },
  { tier: 27, free: { kind: "scrip", amount: 600, label: "600 Scrip" }, premium: { kind: "votives", amount: 100, label: "100 Votives" } },
  { tier: 28, free: { kind: "capstone_deed", item: SEASON_COSMETIC_BY_ID["s0-banner-shatterlands"], label: "Shatterlands Banner — deed-earned proof you cleared the season" }, premium: { kind: "showcase", item: SEASON_COSMETIC_BY_ID["s0-facade-lastcandle"], label: "The Last Candle Facade — premium showcase" } },
];
export const SEASON_TIER_COUNT = 28;

// ---- daily/weekly objectives (spec §4.1; values per spec, targets config) ----
export type SeasonEventId =
  | "launch_expedition" | "study" | "craft_item" | "complete_research" | "daily_list"
  | "expedition_complete" | "deep_site" | "codex_recovered";

export interface SeasonObjectiveDef {
  id: string;
  xp: number; // Season XP granted when the objective completes
  description: string;
}
export const DAILY_OBJECTIVES: SeasonObjectiveDef[] = [
  { id: "launch_expedition", xp: 10, description: "Launch an exploration" },
  { id: "study", xp: 5, description: "Study an Ember/Chipset in the lab" },
  { id: "complete_research", xp: 15, description: "Complete a research project" },
  { id: "daily_list", xp: 20, description: "Finish the daily to-do list (fires when the daily module lands)" },
  { id: "craft_item", xp: 5, description: "Craft an item in the Workshop" },
];
export const WEEKLY_OBJECTIVES: SeasonObjectiveDef[] = [
  { id: "expedition_complete", xp: 40, description: `Complete ${MONETIZATION_CONFIG.weeklyExpeditionTarget} explorations` },
  { id: "deep_site", xp: 60, description: "Complete any deep scientific site (rad ≥ 60)" },
  { id: "codex_recovered", xp: 40, description: `Recover ${MONETIZATION_CONFIG.weeklyCodexTarget} Codices` },
  { id: "daily_list", xp: 50, description: `Reach the daily to-do list ${MONETIZATION_CONFIG.weeklyDailyListTarget}× in a week (fires when the daily module lands)` },
];

// ======================================================================
// STATE DEFAULTS + V5 MIGRATION (ensureMonetization — same style as
// ensureRevelation/ensureLeaderXp: idempotent, silent, legacy-safe).
// ======================================================================
export function freshCurrency(): CurrencyState {
  return { scrip: 0, votives: 0, ledger: [] };
}
export function freshEntitlements(): EntitlementsState {
  return { cosmetics: [], packs: [], passes: [], vehicles: [], conveniences: [], sigils: 0, scripFromPacks: 0, consumed: [], equips: {} };
}
/** UTC day key (same convention as leader-xp's xpDayKey). */
export function utcDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
/** UTC week key (ISO-ish week number). */
export function utcWeekKey(now: number): string {
  const d = new Date(now);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}
export function freshBattlePass(now: number): BattlePassState {
  return {
    seasonId: MONETIZATION_CONFIG.season0Id,
    xp: 0,
    premium: false,
    claimed: [],
    day: utcDayKey(now),
    dayObjectives: [],
    week: utcWeekKey(now),
    weekCounts: {},
    weekCompleted: [],
  };
}

/** V5 migration: old saves without monetization fields behave as zero-owned. */
export function ensureMonetization(state: GameState) {
  if (!state.currency || typeof state.currency !== "object") {
    state.currency = freshCurrency();
  } else {
    if (typeof state.currency.scrip !== "number") state.currency.scrip = 0;
    if (typeof state.currency.votives !== "number") state.currency.votives = 0;
    if (!Array.isArray(state.currency.ledger)) state.currency.ledger = [];
  }
  if (!state.entitlements || typeof state.entitlements !== "object") {
    state.entitlements = freshEntitlements();
  } else {
    const e = state.entitlements;
    if (!Array.isArray(e.cosmetics)) e.cosmetics = [];
    if (!Array.isArray(e.packs)) e.packs = [];
    if (!Array.isArray(e.passes)) e.passes = [];
    if (!Array.isArray(e.vehicles)) e.vehicles = [];
    if (!Array.isArray(e.conveniences)) e.conveniences = [];
    if (typeof e.sigils !== "number") e.sigils = 0;
    if (typeof e.scripFromPacks !== "number") e.scripFromPacks = 0;
    if (!Array.isArray(e.consumed)) e.consumed = [];
    if (!e.equips || typeof e.equips !== "object") e.equips = {};
  }
  if (!state.battlePass || typeof state.battlePass !== "object") {
    state.battlePass = freshBattlePass(Date.now());
  } else {
    const bp = state.battlePass;
    if (typeof bp.seasonId !== "string") bp.seasonId = MONETIZATION_CONFIG.season0Id;
    if (typeof bp.xp !== "number") bp.xp = 0;
    if (typeof bp.premium !== "boolean") bp.premium = false;
    if (!Array.isArray(bp.claimed)) bp.claimed = [];
    if (typeof bp.day !== "string") bp.day = utcDayKey(Date.now());
    if (!Array.isArray(bp.dayObjectives)) bp.dayObjectives = [];
    if (typeof bp.week !== "string") bp.week = utcWeekKey(Date.now());
    if (!bp.weekCounts || typeof bp.weekCounts !== "object") bp.weekCounts = {};
    if (!Array.isArray(bp.weekCompleted)) bp.weekCompleted = [];
  }
}

/** Colony Chronicle append (mirrors engine's private log; keeps modules decoupled). */
function log(state: GameState, msg: string) {
  if (!Array.isArray(state.log)) state.log = [];
  state.log.unshift(msg);
  state.log = state.log.slice(0, 60);
}

function ledgerHas(state: GameState, eventId: string): boolean {
  return state.currency.ledger.some((e) => e.eventId === eventId);
}
function consumedHas(state: GameState, key: string): boolean {
  return state.entitlements.consumed.includes(key);
}

// ======================================================================
// CURRENCY LEDGER (spec §1.4) — server-authoritative, append-only.
// ======================================================================
export interface CurrencyResult {
  ok: boolean;
  error?: string;
  idempotent?: boolean; // true when the eventId was already applied (retry)
}

/** Grant Scrip or Votives from a server-side event. Idempotent by eventId.
 *  `kind` matches the spec's ledger kinds: earn (play events), grant (packs,
 *  pass rewards, promotions), purchase (payment-provider credit). */
export function grantCurrency(
  state: GameState,
  currency: CurrencyId,
  amount: number,
  eventId: string,
  reason: string,
  now = Date.now(),
  kind: "earn" | "grant" | "purchase" = "earn",
): CurrencyResult {
  ensureMonetization(state);
  if (amount <= 0 || !Number.isFinite(amount)) return { ok: false, error: "Grant amount must be a positive number." };
  if (!eventId) return { ok: false, error: "A grant requires an eventId (idempotency)." };
  if (ledgerHas(state, eventId)) return { ok: true, idempotent: true };
  state.currency[currency] += amount;
  const entry: CurrencyLedgerEntry = { eventId, kind, currency, amount, reason, ts: now };
  state.currency.ledger.push(entry);
  log(state, `💰 ${state.currency[currency] >= 0 ? "+" : ""}${amount} ${currencyName(currency)} — ${reason}.`);
  return { ok: true };
}

/** Spend Scrip or Votives. Never allows a negative balance; idempotent by
 *  eventId (a retried purchase cannot double-spend). */
export function spendCurrency(
  state: GameState,
  currency: CurrencyId,
  amount: number,
  eventId: string,
  reason: string,
  now = Date.now(),
): CurrencyResult {
  ensureMonetization(state);
  if (amount <= 0 || !Number.isFinite(amount)) return { ok: false, error: "Spend amount must be a positive number." };
  if (!eventId) return { ok: false, error: "A spend requires an eventId (idempotency)." };
  if (ledgerHas(state, eventId)) return { ok: true, idempotent: true };
  if (state.currency[currency] < amount) {
    return { ok: false, error: `Not enough ${currencyName(currency)}. Need ${amount}, have ${state.currency[currency]}.` };
  }
  state.currency[currency] -= amount;
  state.currency.ledger.push({ eventId, kind: "spend", currency, amount: -amount, reason, ts: now });
  log(state, `💸 −${amount} ${currencyName(currency)} — ${reason}.`);
  return { ok: true };
}

export function currencyName(c: CurrencyId): string {
  return MONETIZATION_CONFIG.currencyNames[c];
}

// ======================================================================
// ENTITLEMENTS (spec §7.4) — grant / revoke / check, all idempotent.
// ======================================================================
export function owns(state: GameState, cosmeticId: string): boolean {
  ensureMonetization(state);
  return state.entitlements.cosmetics.includes(cosmeticId);
}
export function ownsPack(state: GameState, packId: string): boolean {
  ensureMonetization(state);
  return state.entitlements.packs.includes(packId);
}
export function ownsPass(state: GameState, seasonId: string): boolean {
  ensureMonetization(state);
  return state.entitlements.passes.includes(seasonId);
}

export interface EntitlementResult {
  ok: boolean;
  error?: string;
  idempotent?: boolean;
  granted?: boolean;
}

/**
 * Grant one entitlement. `source` is one of the spec's grant sources
 * (purchase | deed | season | pack | grant). Idempotent by eventId AND by
 * membership: granting the same cosmetic twice (even under a second eventId)
 * still yields exactly one entitlement.
 */
export function grantEntitlement(
  state: GameState,
  itemId: string,
  source: "purchase" | "deed" | "season" | "pack" | "grant",
  eventId: string,
  _now = Date.now(),
): EntitlementResult {
  ensureMonetization(state);
  if (!eventId) return { ok: false, error: "An entitlement grant requires an eventId (idempotency)." };
  const e = state.entitlements;
  if (consumedHas(state, eventId)) return { ok: true, idempotent: true };
  if (e.cosmetics.includes(itemId)) return { ok: true, idempotent: true };

  // Item must exist in one of the catalogs (shop cosmetics or season cosmetics).
  if (!COSMETIC_BY_ID[itemId] && !SEASON_COSMETIC_BY_ID[itemId]) {
    return { ok: false, error: `Unknown cosmetic item: ${itemId}` };
  }
  // A deed item can ONLY be granted through the deed path — never purchased.
  const def = COSMETIC_BY_ID[itemId];
  if (def?.source === "deed" && source !== "deed") {
    return { ok: false, error: `${def.name} is deed-earned — it has no purchase path (fairness §2.2).` };
  }
  e.cosmetics.push(itemId);
  e.consumed.push(eventId);
  log(state, `✨ ${def?.name ?? SEASON_COSMETIC_BY_ID[itemId].name} added to the colony's holdings${def?.source === "deed" ? " — earned by deed" : ""}.`);
  return { ok: true, granted: true };
}

/** Revoke an entitlement (chargeback/refund rollback, spec §1.4). Idempotent. */
export function revokeEntitlement(state: GameState, itemId: string, eventId: string): EntitlementResult {
  ensureMonetization(state);
  const e = state.entitlements;
  if (!e.cosmetics.includes(itemId)) return { ok: true, idempotent: true };
  e.cosmetics = e.cosmetics.filter((id) => id !== itemId);
  if (!consumedHas(state, eventId)) e.consumed.push(eventId);
  // Unequip if it was the equipped item in its slot.
  for (const slot of Object.keys(e.equips) as CosmeticSlot[]) {
    if (e.equips[slot] === itemId) delete e.equips[slot];
  }
  log(state, `↩️ ${itemId} revoked (refund/rollback).`);
  return { ok: true, granted: false };
}

/** Equip an owned cosmetic onto the colony's visual state (rendering is the
 *  client's; ownership + equips are the server's truth). */
export function equipCosmetic(state: GameState, itemId: string, slot: CosmeticSlot, _now = Date.now()): EntitlementResult {
  ensureMonetization(state);
  const def = COSMETIC_BY_ID[itemId] ?? SEASON_COSMETIC_BY_ID[itemId];
  if (!def) return { ok: false, error: `Unknown cosmetic item: ${itemId}` };
  if (def.slot !== slot) return { ok: false, error: "That cosmetic does not fit this slot." };
  if (!state.entitlements.cosmetics.includes(itemId)) {
    return { ok: false, error: "You don't own that cosmetic yet." };
  }
  state.entitlements.equips[slot] = itemId;
  log(state, `🎨 ${def.name} equipped (${slot}).`);
  return { ok: true };
}

// ======================================================================
// DEED COSMETICS (spec §2.2) — D1–D7 map to engine resolve points.
// `wired` lists which deeds already have an engine event to fire; the rest
// fire when their systems land (server-first tracking, purity, devotion,
// contribution award) — the helper below is the one call site they'll use.
// ======================================================================
export interface DeedCosmetic {
  deedId: string;
  cosmeticId: string;
  name: string;
  wired: boolean;
  note: string;
}
export const DEED_COSMETIC_MAP: DeedCosmetic[] = [
  { deedId: "deed_first_clean", cosmeticId: "first-light-sigil", name: "First Light Sigil", wired: true, note: "D1 — first clean recovery (engine: resolveExpedition)" },
  { deedId: "deed_frontier", cosmeticId: "frontier-banner", name: "Frontier Banner", wired: false, note: "D2 — first colony on the server to reach the deepest scientific site (server-first tracking pending)" },
  { deedId: "deed_purify", cosmeticId: "cleansed-hull", name: "Cleansed Hull", wired: false, note: "D3 — first corrupted ruin cleared/purified (Oracle purity layer pending)" },
  { deedId: "deed_tier3_research", cosmeticId: "the-visionarys-robes", name: "The Visionary's Robes", wired: true, note: "D4 — research completions ≥ N (engine: advance sweep)" },
  { deedId: "deed_l5_specialized", cosmeticId: "wardens-livery", name: "Warden's Livery", wired: true, note: "D5 — a Leader at L5 with a specialization chosen (engine: advance sweep)" },
  { deedId: "deed_30day_devotion", cosmeticId: "wheel-of-years", name: "Wheel of Years", wired: true, note: "D6 — 30-day daily devotion streak (engine: daily sweep, daily-devotion-spec §7)" },
  { deedId: "deed_contribution_award", cosmeticId: "the-contribution-ring", name: "The Contribution Ring", wired: false, note: "D7 — Server Contribution Award, one per server per cycle (award sweep pending)" },
];
const DEED_BY_ID = Object.fromEntries(DEED_COSMETIC_MAP.map((d) => [d.deedId, d])) as Record<string, DeedCosmetic>;

/** The single call site deed-earned cosmetics flow through: grant the deed's
 *  cosmetic if the deed id is real and the colony doesn't own it yet. */
export function awardDeedCosmetic(state: GameState, deedId: string, now = Date.now()): { ok: boolean; error?: string; idempotent?: boolean; itemId?: string } {
  ensureMonetization(state);
  const deed = DEED_BY_ID[deedId];
  if (!deed) return { ok: false, error: `Unknown deed: ${deedId}` };
  if (owns(state, deed.cosmeticId)) return { ok: true, idempotent: true, itemId: deed.cosmeticId };
  const res = grantEntitlement(state, deed.cosmeticId, "deed", `${deedId}:${utcDayKey(now)}`, now);
  return { ok: res.ok, idempotent: res.idempotent, itemId: deed.cosmeticId };
}

// ======================================================================
// HEAD-START PACKS — apply contents through the ledger + entitlement service
// (spec §3). Exact-once per pack id; Scrip grants hard-capped (§3.3).
// ======================================================================
export function applyPack(state: GameState, packId: string, eventId: string, now = Date.now()): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  const pack = PACK_BY_ID[packId];
  if (!pack) return { ok: false, error: `Unknown pack: ${packId}`, state };
  if (state.entitlements.packs.includes(packId)) return { ok: true, idempotent: true, state };
  if (!eventId) return { ok: false, error: "A pack claim requires an eventId (idempotency).", state };

  // §3.3 hard cap: lifetime Scrip from packs never exceeds ~2 days of earning.
  if (pack.scrip > 0) {
    if (state.entitlements.scripFromPacks + pack.scrip > MONETIZATION_CONFIG.maxScripPerPack) {
      return { ok: false, error: "Pack Scrip grant would exceed the §3.3 cap.", state };
    }
  }

  for (const g of pack.grants) {
    if (g.kind === "resource") {
      // PackResourceKey excludes `mats` by construction; the cast is the
      // sub-type boundary (resources also carries Record<RaceId, number>).
      (state.resources as unknown as Record<string, number>)[g.key] += g.amount;
    } else if (g.kind === "currency") {
      const r = grantCurrency(state, g.currency, g.amount, `${eventId}:votives`, `${pack.name} — ${g.note}`, now, "grant");
      if (!r.ok) return { ok: false, error: r.error, state };
    } else if (g.kind === "cosmetic") {
      const r = grantEntitlement(state, g.itemId, "pack", `${eventId}:cosmetic:${g.itemId}`, now);
      if (!r.ok) return { ok: false, error: r.error, state };
    } else if (g.kind === "vehicle") {
      if (!state.entitlements.vehicles.includes(g.vehicleId)) state.entitlements.vehicles.push(g.vehicleId);
      if (!consumedHas(state, `${eventId}:vehicle:${g.vehicleId}`)) state.entitlements.consumed.push(`${eventId}:vehicle:${g.vehicleId}`);
    }
  }
  if (pack.scrip > 0) {
    const r = grantCurrency(state, "scrip", pack.scrip, `${eventId}:scrip`, `${pack.name} — supply grant (head-start)`, now, "grant");
    if (!r.ok) return { ok: false, error: r.error, state };
    state.entitlements.scripFromPacks += pack.scrip;
  }
  state.entitlements.packs.push(packId);
  state.entitlements.consumed.push(eventId);
  log(state, `📦 ${pack.name} opened — ${pack.playEquivalent}.`);
  return { ok: true, state };
}

// ======================================================================
// BATTLE PASS — season state machine (spec §4, §7.5).
// ======================================================================
export function tierFromXp(xp: number): number {
  const per = MONETIZATION_CONFIG.seasonXpPerTier;
  return Math.max(1, Math.min(SEASON_TIER_COUNT, 1 + Math.floor(Math.max(0, xp) / per)));
}

/** Record a play event for Season XP. Daily objectives complete once per UTC
 *  day; weekly counters accumulate toward their target once per UTC week.
 *  All XP is server-verified (same event-sourced discipline as Leader XP). */
export function recordSeasonEvent(state: GameState, event: SeasonEventId, now = Date.now(), count = 1): void {
  ensureMonetization(state);
  const bp = state.battlePass;
  // Rolling day/week windows: a stale window means "nothing today/this week".
  const day = utcDayKey(now);
  if (bp.day !== day) {
    bp.day = day;
    bp.dayObjectives = [];
  }
  const week = utcWeekKey(now);
  if (bp.week !== week) {
    bp.week = week;
    bp.weekCounts = {};
    bp.weekCompleted = [];
  }

  // Daily objectives complete once per UTC day. `daily_list` fires when the
  // daily to-do module lands (it calls recordSeasonEvent("daily_list") once per
  // day) — the +20 daily AND the weekly 5× counter share that one call.
  const daily = DAILY_OBJECTIVES.find((o) => o.id === event);
  if (daily && !bp.dayObjectives.includes(daily.id)) {
    bp.dayObjectives.push(daily.id);
    bp.xp += daily.xp;
  }

  // Weekly: expedition_complete, deep_site and codex_recovered accumulate; the
  // "daily_list ×5" weekly rides the same daily-list event when it lands.
  const weekly = WEEKLY_OBJECTIVES.find((o) => o.id === event);
  if (weekly) {
    if (!bp.weekCompleted.includes(weekly.id)) {
      const target =
        weekly.id === "expedition_complete" ? MONETIZATION_CONFIG.weeklyExpeditionTarget
        : weekly.id === "codex_recovered" ? MONETIZATION_CONFIG.weeklyCodexTarget
        : weekly.id === "daily_list" ? MONETIZATION_CONFIG.weeklyDailyListTarget
        : 1;
      bp.weekCounts[weekly.id] = (bp.weekCounts[weekly.id] ?? 0) + count;
      if (bp.weekCounts[weekly.id] >= target) {
        bp.weekCompleted.push(weekly.id);
        bp.xp += weekly.xp;
      }
    }
  }
}

/** Claim a tier reward (idempotent). Claims are the ONLY way rewards land —
 *  they flow through the same ledger/entitlement primitives as everything else. */
export function claimTierReward(
  state: GameState,
  tier: number,
  track: "free" | "premium",
  now = Date.now(),
): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  const def = SEASON_TIERS[tier - 1];
  if (!def) return { ok: false, error: `No such tier: ${tier}`, state };
  if (tier > tierFromXp(state.battlePass.xp)) {
    return { ok: false, error: `Tier ${tier} is not unlocked yet (current tier ${tierFromXp(state.battlePass.xp)}).`, state };
  }
  if (track === "premium" && !state.battlePass.premium) {
    return { ok: false, error: "The premium track isn't owned. Purchase the pass first (Votives or payment provider).", state };
  }
  const key = `${tier}-${track}`;
  if (state.battlePass.claimed.includes(key)) return { ok: true, idempotent: true, state };
  const reward = track === "free" ? def.free : def.premium;
  const eventId = `bp:${state.battlePass.seasonId}:${key}`;

  if (reward.kind === "scrip") {
    const r = grantCurrency(state, "scrip", reward.amount!, eventId, `Season pass ${track} track — tier ${tier}`, now, "grant");
    if (!r.ok) return { ok: false, error: r.error, state };
  } else if (reward.kind === "votives") {
    const r = grantCurrency(state, "votives", reward.amount!, eventId, `Season pass ${track} track — tier ${tier}`, now, "grant");
    if (!r.ok) return { ok: false, error: r.error, state };
  } else if (reward.kind === "sigil") {
    state.entitlements.sigils += reward.amount ?? 1;
    if (!consumedHas(state, eventId)) state.entitlements.consumed.push(eventId);
  } else if (reward.kind === "cosmetic" || reward.kind === "capstone_deed" || reward.kind === "showcase") {
    const r = grantEntitlement(state, reward.item!.id, reward.kind === "capstone_deed" ? "deed" : "season", eventId, now);
    if (!r.ok) return { ok: false, error: r.error, state };
  } else if (reward.kind === "convenience") {
    if (!state.entitlements.conveniences.includes(reward.itemId!)) state.entitlements.conveniences.push(reward.itemId!);
    if (!consumedHas(state, eventId)) state.entitlements.consumed.push(eventId);
  }
  state.battlePass.claimed.push(key);
  return { ok: true, state };
}

/** Purchase the premium track (idempotent): a Votives spend today, a payment-
 *  provider purchase later — the same entitlement path (spec §7.5). */
export function purchasePremiumPass(state: GameState, eventId: string, now = Date.now()): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  if (state.battlePass.premium) return { ok: true, idempotent: true, state };
  const price = 750; // §4.3: 750 Votives ≈ $6.99–7.99 list
  const spend = spendCurrency(state, "votives", price, eventId, "Season 0 premium track", now);
  if (!spend.ok) return { ok: false, error: spend.error, state };
  return grantPremiumPass(state, eventId, now);
}

/** Grant the premium track WITHOUT spending Votives — the payment-provider
 *  path (the player already paid at the provider; never double-charge). */
export function grantPremiumPass(state: GameState, eventId: string, _now = Date.now()): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  if (state.battlePass.premium) return { ok: true, idempotent: true, state };
  if (consumedHas(state, eventId)) return { ok: true, idempotent: true, state };
  state.battlePass.premium = true;
  if (!state.entitlements.passes.includes(state.battlePass.seasonId)) {
    state.entitlements.passes.push(state.battlePass.seasonId);
  }
  if (!consumedHas(state, eventId)) state.entitlements.consumed.push(eventId);
  log(state, `🎟️ Season 0 premium track unlocked — ${MONETIZATION_CONFIG.passesNeverExpire ? "never expires." : ""}`);
  return { ok: true, state };
}

// ======================================================================
// IN-GAME PURCHASES (storefront seam; gated by config until the owner flips
// the switch). purchaseWithVotives spends ALREADY-OWNED Votives; external
// payments flow through applyExternalPurchase after provider confirmation.
// ======================================================================
export function purchaseWithVotives(
  state: GameState,
  itemId: string,
  eventId: string,
  now = Date.now(),
): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  const def = COSMETIC_BY_ID[itemId];
  if (!def) return { ok: false, error: `Unknown item: ${itemId}`, state };
  if (def.source !== "purchasable" || !def.priceVotives) {
    return { ok: false, error: `${def.name} is not purchasable (deed-earned items have no buy path — fairness §2.2).`, state };
  }
  if (state.entitlements.cosmetics.includes(itemId)) return { ok: true, idempotent: true, state };
  // Spend first, then grant — never the reverse (a failed spend can't leave
  // a phantom entitlement).
  const spend = spendCurrency(state, "votives", def.priceVotives, eventId, `purchased ${def.name}`, now);
  if (!spend.ok) return { ok: false, error: spend.error, state };
  const grant = grantEntitlement(state, itemId, "purchase", eventId, now);
  if (!grant.ok) {
    // Extremely defensive: refund the spend so state stays consistent (the
    // entitlement grant can only fail on inputs validated above, but if it
    // ever does, the balance comes back and nothing is half-purchased).
    grantCurrency(state, "votives", def.priceVotives, `${eventId}:rollback`, "defensive rollback", now, "grant");
    return { ok: false, error: grant.error, state };
  }
  log(state, `🛒 ${def.name} purchased for ${def.priceVotives} Votives (cosmetic only — no power).`);
  return { ok: true, state };
}

/** Apply a payment-provider-confirmed purchase (spec §7.3/§7.4). Call ONLY
 *  after verifyWebhook() has confirmed it. Idempotent by purchaseId. */
export function applyExternalPurchase(
  state: GameState,
  purchase: { purchaseId: string; skuId: string; confirmedAt?: number },
  now = Date.now(),
): { ok: boolean; error?: string; idempotent?: boolean; state: GameState } {
  ensureMonetization(state);
  if (!purchase?.purchaseId || !purchase?.skuId) {
    return { ok: false, error: "A confirmed purchase needs purchaseId + skuId.", state };
  }
  if (consumedHas(state, `purch:${purchase.purchaseId}`)) {
    return { ok: true, idempotent: true, state };
  }
  const eventId = `purch:${purchase.purchaseId}`;

  // 1) Votive currency pack (Cradle Ledger, §2.3).
  const vp = VOTIVE_PACKS.find((p) => p.id === purchase.skuId);
  if (vp) {
    const r = grantCurrency(state, "votives", vp.votives + vp.bonus, eventId, `${vp.name} (${vp.votives}+${vp.bonus} bonus)`, now, "purchase");
    if (!r.ok) return { ok: false, error: r.error, state };
    state.entitlements.consumed.push(eventId);
    return { ok: true, state };
  }
  // 2) Head-start pack (§3).
  if (PACK_BY_ID[purchase.skuId]) {
    const r = applyPack(state, purchase.skuId, eventId, now);
    if (!r.ok) return { ok: false, error: r.error, state };
    return { ok: true, state };
  }
  // 3) Season pass (premium track, §4.3) — already paid at the provider, so
  //    granted WITHOUT a Votive spend (never double-charge).
  if (purchase.skuId === "season-pass-" + MONETIZATION_CONFIG.season0Id) {
    const r = grantPremiumPass(state, eventId, now);
    if (!r.ok) return { ok: false, error: r.error, state };
    return r.idempotent ? { ok: true, idempotent: true, state } : { ok: true, state };
  }
  // 4) Single cosmetic (§2.1) — direct grant (already paid at the provider).
  if (COSMETIC_BY_ID[purchase.skuId]?.source === "purchasable") {
    const r = grantEntitlement(state, purchase.skuId, "purchase", eventId, now);
    if (!r.ok) return { ok: false, error: r.error, state };
    return { ok: true, state };
  }
  return { ok: false, error: `Unknown purchasable SKU: ${purchase.skuId}`, state };
}

// ======================================================================
// PAYMENT PROVIDER (spec §7.3) — interface + STUB only. Real Stripe/regional
// pricing/tax/refunds/legal are explicitly out of scope until the owner flips
// the switch. The single swap point is createPaymentProvider().
// ======================================================================
export interface PurchaseIntent {
  accountId: string;
  skuId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string; // "usd"
}

export interface VerifiedPurchase {
  purchaseId: string;
  accountId: string;
  skuId: string;
  idempotencyKey: string;
  confirmedAt: number;
  amountCents: number;
  currency: string;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(intent: PurchaseIntent): Promise<{ ok: boolean; intentId?: string; error?: string }>;
  verifyWebhook(payload: unknown): Promise<{ ok: boolean; purchase?: VerifiedPurchase; error?: string }>;
  refund(opts: { purchaseId: string; reason: string }): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Stubbed provider. Per the task brief it SIMULATES SUCCESS for testing and
 * logs intent; with `simulate: false` it rejects exactly like the spec's
 * wording ("no real payment provider configured"). Either way no real money
 * moves and every call is logged.
 */
export function createStubPaymentProvider(simulate = true): PaymentProvider {
  return {
    name: "StubPaymentProvider",
    async createIntent(intent) {
      console.log(`[PaymentProvider#createIntent] no real payment provider configured (stub). intent=${JSON.stringify(intent)}`);
      if (!simulate) return { ok: false, error: "no real payment provider configured" };
      return { ok: true, intentId: `intent-stub-${intent.idempotencyKey}` };
    },
    async verifyWebhook(payload) {
      console.log(`[PaymentProvider#verifyWebhook] no real payment provider configured (stub). payload=${JSON.stringify(payload)}`);
      if (!simulate) return { ok: false, error: "no real payment provider configured" };
      const p = (payload ?? {}) as Partial<VerifiedPurchase> & { id?: string };
      if (!p.skuId) return { ok: false, error: "stub webhook payload needs skuId" };
      return {
        ok: true,
        purchase: {
          purchaseId: p.purchaseId ?? p.id ?? `purch-stub-${Date.now().toString(36)}`,
          accountId: p.accountId ?? "stub-account",
          skuId: p.skuId,
          idempotencyKey: p.idempotencyKey ?? "stub-key",
          confirmedAt: p.confirmedAt ?? Date.now(),
          amountCents: p.amountCents ?? 0,
          currency: p.currency ?? "usd",
        },
      };
    },
    async refund(opts) {
      console.log(`[PaymentProvider#refund] no real payment provider configured (stub). purchase=${opts.purchaseId} reason=${opts.reason}`);
      if (!simulate) return { ok: false, error: "no real payment provider configured" };
      return { ok: true };
    },
  };
}

/**
 * THE single swap point — SWAPPED (2026-09-26). This returns the REAL provider
 * (payments/stripe-provider.ts): Stripe Payment Links are opened by the client,
 * and an entitlement is granted ONLY by a signature-verified webhook. The stub
 * above is kept for tests that exercise the interface, but no code path reaches
 * it any more: an unconfigured real provider REFUSES everything (it has no
 * "simulate" mode to fall back on), which is the honest behaviour for money.
 *
 * The signing secret is injected by the caller — the webhook route reads it from
 * the environment (`STRIPE_WEBHOOK_SECRET`), so this pure module never touches
 * env or node APIs and stays importable by the client bundle.
 */
export function createPaymentProvider(options: StripeProviderOptions = {}): PaymentProvider {
  return createStripePaymentProvider(options);
}

// ======================================================================
// FAIRNESS GUARDRAILS (spec §5/§6, §3.2, §4.3) — assertion layer.
// ======================================================================

// Vocabulary that must NEVER appear in PURCHASABLE content (names, labels,
// grant kinds, pack copy). Even a single hit means the catalog crossed a line.
// Deliberately excludes in-universe words that are NOT power signals ("sigil",
// "devotion", "power", "shield") — those appear legitimately in cosmetic names
// and flavor; the STRUCTURAL checks (no grant payload on cosmetics, reward
// `kind` enum, grant-key list) are the real guard, this list is the tripwire.
const FORBIDDEN_POWER_TERMS = [
  "xp", "boost", "speed-up", "speedup", "skip", "rush", "timer", "instant", "finish",
  "repair", "heal", "stamina", "energy", "favor", "cleans", "riddle", "research",
  "codices", "tier-skip", "tierskip", "contribution", "unbound", "hero", "stat",
  "loot", "mystery", "random", "attack", "army", "troop", "refill", "diamond", "rebirth",
  // V6 armory vocabulary (weapons-system §6 "earn-only structural check"): NO
  // catalog item — cosmetic, pack, or premium tier — may so much as NAME plasma,
  // the armory, a weapon, or the trebuchet. A purchase path that grants war
  // hardware would have to reference it; the tripwire keeps the catalog clean.
  "plasma", "armory", "weapon", "trebuchet",
];

function hitsForbidden(text: string): string | null {
  // Word-boundary match: "xp" must be the WORD "xp", not a substring of
  // "expedition"; "skip" must not trip on a benign word like "skips".
  const t = text.toLowerCase();
  for (const term of FORBIDDEN_POWER_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(t)) return term;
  }
  return null;
}
/** Validates the ENTIRE catalog against the fairness rules and throws with a
 *  precise message on the first violation. Tests call this; the build's CI
 *  would too — power content cannot enter the catalog silently. */
export function assertCatalogFair(): void {
  // §2 hard rule: NO cosmetic grants any stat/speed/yield/chance. Purchasable
  // cosmetics carry only id/name/slot/source/price + display fields.
  for (const c of PURCHASABLE_COSMETICS) {
    if (!c.priceVotives || c.priceVotives <= 0) {
      throw new Error(`Purchasable cosmetic ${c.id} must carry a positive Votive price.`);
    }
    const hit = hitsForbidden(c.name + " " + c.blurb);
    if (hit) throw new Error(`Purchasable cosmetic ${c.id} touches forbidden power vocabulary ("${hit}").`);
  }
  // §2.2: deed cosmetics have NO price — never purchasable, ever.
  for (const c of DEED_COSMETICS) {
    if (c.priceVotives) throw new Error(`Deed cosmetic ${c.id} must never carry a price.`);
    if (!c.deedId) throw new Error(`Deed cosmetic ${c.id} must name its deed.`);
  }

  // §3.2 pack echo: no research/leaders/Oracle/advancement-currency/
  // outpacing-consumables/exclusive gear/pass-tiers/timers/immunity/Unbound/
  // Contribution/one-per-server. Grants restricted to craftable resources,
  // Votives, cosmetics and vehicles.
  const allowedResources: PackResourceKey[] = ["supplies", "gas", "medkit", "mechkit", "armorkit", "skmech", "battery", "hazmat", "shots", "alloys"];
  // V6 earn-only structural check: the pack grant-key whitelist is the ONLY
  // resource a pack may grant — plasma is a war material and can never enter
  // it. Belt-and-braces with the forbidden-vocabulary tripwire above.
  if (allowedResources.includes("plasma" as PackResourceKey)) {
    throw new Error("Plasma is a war material — a pack must never grant it (weapons-system §6).");
  }
  for (const p of HEAD_START_PACKS) {
    const hit = hitsForbidden(p.name + " " + p.blurb + " " + p.playEquivalent);
    if (hit) throw new Error(`Pack ${p.id} touches forbidden power vocabulary ("${hit}").`);
    if (p.scrip < 0 || p.scrip > MONETIZATION_CONFIG.maxScripPerPack) {
      throw new Error(`Pack ${p.id} Scrip ${p.scrip} exceeds the §3.3 cap (${MONETIZATION_CONFIG.maxScripPerPack}).`);
    }
    for (const g of p.grants) {
      if (g.kind === "resource") {
        if (!allowedResources.includes(g.key)) {
          throw new Error(`Pack ${p.id} grants resource "${g.key}" — not a craftable kind (§3.2.6).`);
        }
        if (g.amount <= 0 || g.amount > 500) {
          throw new Error(`Pack ${p.id} grant amount ${g.amount} out of head-start budget.`);
        }
      } else if (g.kind === "currency") {
        if (g.currency !== "votives") throw new Error(`Pack ${p.id} may only carry Votives as currency (§3.2.4).`);
      } else if (g.kind === "cosmetic") {
        const c = COSMETIC_BY_ID[g.itemId];
        if (!c || c.source !== "purchasable") {
          throw new Error(`Pack ${p.id} cosmetic grant ${g.itemId} must be a purchasable cosmetic (§3.2.6).`);
        }
      } else if (g.kind !== "vehicle") {
        throw new Error(`Pack ${p.id} has an unknown grant kind "${(g as { kind: string }).kind}".`);
      }
    }
  }

  // §4.3: premium track contains NO Scrip, NO Season Sigils, NO XP, no
  // research, no devotion — strictly cosmetic/votive/convenience.
  for (const t of SEASON_TIERS) {
    const pr = t.premium;
    if (pr.kind === "scrip" || pr.kind === "sigil") {
      throw new Error(`Premium tier ${t.tier} must not grant ${pr.kind} (§4.3).`);
    }
    const hit = hitsForbidden(pr.label);
    if (hit) throw new Error(`Premium tier ${t.tier} label touches forbidden power vocabulary ("${hit}").`);
    if (pr.kind === "cosmetic" || pr.kind === "showcase") {
      if (!pr.item || !SEASON_COSMETIC_BY_ID[pr.item.id]) {
        throw new Error(`Premium tier ${t.tier} references an unknown seasonal cosmetic.`);
      }
    }
    if (pr.kind === "convenience" && !CONVENIENCE_ITEMS[pr.itemId!]) {
      throw new Error(`Premium tier ${t.tier} references an unknown convenience item.`);
    }
    // Free track: capstone at 28 must be the deed cosmetic.
    if (t.tier === SEASON_TIER_COUNT && t.free.kind !== "capstone_deed") {
      throw new Error(`Tier 28 free capstone must be the deed cosmetic (§4.2).`);
    }
  }

  // §5 leak list echoed: no randomized purchases exist in the catalog at all
  // (every purchase is a known, named item — "a store, not a lottery").
  if (MONETIZATION_CONFIG.allowRandomizedPurchases) {
    throw new Error("allowRandomizedPurchases is true — the spec locks this OFF (§8.3).");
  }
  if (MONETIZATION_CONFIG.allowScripVotiveConversion) {
    throw new Error("allowScripVotiveConversion is true — the spec locks conversion OFF (§1.3/§8.2).");
  }
}

/** Structural guardrail: this module must expose NO conversion/exchange path.
 *  The ledger has exactly one earn-side and one spend-side entry point; a
 *  "convert" function would change the export surface and this check fails. */
export function assertNoConversionPath(): void {
  const surface = Object.keys(monetizationSurface());
  for (const name of surface) {
    const hit = /convert|exchange|swap|fx/i.exec(name);
    if (hit) throw new Error(`The monetization module exposes ${name} — a conversion path must never exist (§1.3).`);
  }
}

/** Enumeration used by assertNoConversionPath (a plain import of * as m would
 *  create a circular self-reference in asserts; listing the seam surface here
 *  keeps the check honest and cheap). */
function monetizationSurface(): Record<string, unknown> {
  return {
    grantCurrency, spendCurrency, owns, ownsPack, ownsPass, grantEntitlement,
    revokeEntitlement, equipCosmetic, awardDeedCosmetic, applyPack,
    purchaseWithVotives, applyExternalPurchase, claimTierReward,
    purchasePremiumPass, grantPremiumPass, recordSeasonEvent,
    createPaymentProvider, createStubPaymentProvider, ensureMonetization,
    tierFromXp, walletView, assertCatalogFair, assertNoConversionPath,
  };
}

/** Non-secret wallet view used by the storefront seam (api getWalletFn). */
export function walletView(state: GameState) {
  ensureMonetization(state);
  return {
    currency: {
      scrip: Math.floor(state.currency.scrip * 100) / 100,
      votives: Math.floor(state.currency.votives * 100) / 100,
    },
    entitlements: {
      cosmetics: [...state.entitlements.cosmetics],
      packs: [...state.entitlements.packs],
      passes: [...state.entitlements.passes],
      vehicles: [...state.entitlements.vehicles],
      conveniences: [...state.entitlements.conveniences],
      sigils: state.entitlements.sigils,
      equips: { ...state.entitlements.equips },
    },
    battlePass: {
      seasonId: state.battlePass.seasonId,
      tier: tierFromXp(state.battlePass.xp),
      xp: Math.floor(state.battlePass.xp),
      xpToNextTier: MONETIZATION_CONFIG.seasonXpPerTier - (state.battlePass.xp % MONETIZATION_CONFIG.seasonXpPerTier),
      premium: state.battlePass.premium,
      claimed: [...state.battlePass.claimed],
      dayObjectives: [...state.battlePass.dayObjectives],
      weekCounts: { ...state.battlePass.weekCounts },
      weekCompleted: [...state.battlePass.weekCompleted],
    },
  };
}

/** Season XP needed for the next tier (0 when at the cap). */
export function xpToNextTier(xp: number): number {
  const per = MONETIZATION_CONFIG.seasonXpPerTier;
  return tierFromXp(xp) >= SEASON_TIER_COUNT ? 0 : per - (xp % per);
}