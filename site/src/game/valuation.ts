/**
 * THE LOOT VALUATION — V1…V12, every price, in ONE module.
 *
 * WHAT THIS IS. `/home/team/shared/loot-valuation-2026-09-27.md` priced one full
 * pass of the 29-rung ladder in the game's own numbers and concluded that the
 * un-costed shortfall is ≈1.44 income-days, so the ladder's 329 days survives as
 * "≈330–335 days, verified to ±2 %". That document's constants were written *in
 * the document*, and the shipped measurement (`retime-tests/retime-verify.ts` §8)
 * carried its own copies of them. This module is the same rule as code; §8 and §10
 * of the retime suite read IT, and it is the only place a price is written down.
 *
 * NOTHING HERE IS INVENTED. Two statuses, marked on every item:
 *   [E]  an engine number — read from `./engine`, `./armory`, `./forge`, `./zones`
 *        or the race's own mods. Where such a number lived as a bare literal
 *        inside the resolver it was NAMED in the engine first (see the
 *        "EMBER-YIELD MODEL, NAMED" and "mild-ring incidental salvage" blocks of
 *        `engine.ts`), so this module and the engine cannot drift apart.
 *   [P]  OUR PROPOSAL — the engine has NO price for it. Every [P] carries
 *        `_PROPOSAL` in its name and is listed in `VALUATION_PROPOSAL_IDS`.
 *
 * NUMERAIRE: supplies (📦). The rung DEMAND is deliberately NOT here: it is
 * denominated in the colony's own income (income-days) — a calendar gate, not a
 * resource cost (`engine.rungEntryDemand`).
 *
 * WHAT THIS MODULE DOES NOT CLAIM. The cost column is the UNTECHED Watchers case
 * (no industry/deploy discounts, no `i1/i2/i3/l1/l2/e3`), so it is an upper bound;
 * `V8_chipsetValueProposal` is a FLOOR, because the engine charges no Chipset for a study
 * (the filed "a chipset is never consumed" defect — `beginStudy` checks it and
 * deducts nothing). Both are stated, not corrected, in this slice.
 */
import * as engine from "./engine";
import { ARMORY_CONFIG, WEAPON_TYPES, weaponCost, type WeaponTier } from "./armory";
import { FORGE_CONFIG, FORGE_RECIPES, forgeDepthTier } from "./forge";
import { getRace } from "./races";
import { ZONES, rungTimerMs } from "./zones";
import type { GameState, Zone } from "./types";

export const VALUATION_NUMERAIRE = "supplies (📦)";

const round2 = (v: number) => Math.round(v * 100) / 100;

// ======================================================================
// V1 · AN EMBER → 📦
// ======================================================================
/** [E] the engine's own scrap rate — the rate `resolveExpedition` credits at the
 *  drop. 0.15, 0.30 with `e1` Trade Ledgers, +0.14 with `a2` Seed Vaults. */
export const V1_EMBER_SCRAP_RATE_BASE = engine.EMBER_SCRAP_RATE_BASE;
export const V1_EMBER_SCRAP_RATE_E1 = engine.EMBER_SCRAP_RATE_E1;
export const V1_EMBER_SCRAP_RATE_A2_BONUS = engine.EMBER_SCRAP_RATE_A2_BONUS;
/** [E] the colony's rate right now (one source: `engine.suppliesScrapRate`). */
export function V1_emberScrapRate(state: GameState): number {
  return engine.suppliesScrapRate(state);
}
/** [E, derived] what a haul of Embers is worth in 📦: quantity × V1. The engine's
 *  own scrap action rounds the supplies it grants (an implementation detail of the
 *  action); this column prices the EMBERS, at 2dp, exactly as the measurement did. */
export function V1_emberValue(embers: number, rate: number): number {
  return round2(embers * rate);
}

// ======================================================================
// V2 · AN ORDNANCE UNIT  (the charge rungs 6+ pay before launch)
// ======================================================================
/** [E] 24 📦 + 8 🧯 a unit — BOTH halves are the price. */
export const V2_ORDNANCE_SUPPLIES_PER_UNIT = engine.ORDNANCE_SUPPLIES_PER_UNIT;
export const V2_ORDNANCE_EMBERS_PER_UNIT = engine.ORDNANCE_EMBERS_PER_UNIT;
/** [E] units a run on this rung burns (zero through rung 5). */
export function V2_ordnanceUnitsForRung(rung: number): number {
  return engine.ordnanceUnitsForRung(rung);
}
/** [E, derived] one unit in 📦 — the EMber half converted at V1, which is the
 *  half the shipped measurement's cost column omitted. */
export function V2_ordnanceUnitValue(rate: number): number {
  return V2_ORDNANCE_SUPPLIES_PER_UNIT + V2_ORDNANCE_EMBERS_PER_UNIT * rate;
}

// ======================================================================
// V3 · OPERATIONS (the per-run launch cost)
// ======================================================================
/** [E] `round((8 + risk x 0.55) x race x 0.93^industry x e3)`, read from the
 *  engine's own pricer so no discount can be lost in a retyping. */
export function V3_operationsSupplies(state: GameState, zone: Zone): number {
  return engine.suppliesCostForZone(state, zone);
}

// ======================================================================
// V4 · THE GEAR UNIT PRICES
// ======================================================================
/** [E] every piece of gear a run burns, priced by the engine's CRAFT table. */
export const V4_GEAR_UNIT_PRICES = {
  hazmat: engine.CRAFT.hazmat.supplies,
  shots: engine.CRAFT.shots.supplies,
  alloy: engine.CRAFT.alloy.supplies,
  gas: engine.CRAFT.gas.supplies,
  battery: engine.CRAFT.battery.supplies,
  skmech: engine.CRAFT.skmech.supplies,
} as const;

// ======================================================================
// V5 · THE GEAR NEEDS
// ======================================================================
/** [E] what one run consumes: hazmat/shots per scientist and one alloy per zone
 *  above rad 35, plus fuel/battery/mechanics from range/quiet/risk. The launch
 *  applies the `i1/i2/i3/l1/l2` discounts on top, so this is the upper bound. */
export function V5_gearSupplies(_state: GameState, zone: Zone, scientists: number) {
  const need = engine.requiredGear(zone, scientists);
  const gas = engine.gasNeed(zone);
  const battery = engine.batteryNeed(zone);
  const skmech = engine.skmechNeed(zone);
  const value =
    need.hazmat * V4_GEAR_UNIT_PRICES.hazmat +
    need.shots * V4_GEAR_UNIT_PRICES.shots +
    need.alloys * V4_GEAR_UNIT_PRICES.alloy +
    gas * V4_GEAR_UNIT_PRICES.gas +
    battery * V4_GEAR_UNIT_PRICES.battery +
    skmech * V4_GEAR_UNIT_PRICES.skmech;
  return { hazmat: need.hazmat, shots: need.shots, alloys: need.alloys, gas, battery, skmech, value };
}

// ======================================================================
// V6 · PLASMA
// ======================================================================
/** [E] the engine's only ember↔plasma rate: 25 Embers → 1 plasma at the lab. */
export const V6_PLASMA_REFINE_EMBERS = ARMORY_CONFIG.plasmaRefineEmbers;
/** [E] deep sites that yield a chipset also roll 2–5 plasma. */
export const V6_PLASMA_SALVAGE_CHANCE = ARMORY_CONFIG.plasmaSalvageChance;
export const V6_PLASMA_MEAN_SALVAGE_UNITS =
  (ARMORY_CONFIG.plasmaSalvageMin + ARMORY_CONFIG.plasmaSalvageMax) / 2;
export function V6_plasmaValue(rate: number): number {
  return V6_PLASMA_REFINE_EMBERS * rate;
}

// ======================================================================
// V7 · INSIGHT  (the cheapest engine path: 2 Embers → 33 insight on Watchers)
// ======================================================================
/** [E] an Ember study burns `STUDY_EMBER_COST` Embers and grants
 *  `studyInsightGranted(state, "ember")` — both read from the engine. */
export function V7_insightValue(state: GameState, rate: number): number {
  return (engine.STUDY_EMBER_COST * rate) / engine.studyInsightGranted(state, "ember");
}

// ======================================================================
// V8 · A CHIPSET  — [P], ANCHORED
// ======================================================================
/**
 * [P] anchored on two [E] numbers: one study of a Chipset grants the engine's own
 * `studyInsightGranted(state, "chipset")` insight, priced by V7.
 * IT IS A FLOOR, NOT A VALUE: the engine deducts no Chipset when it starts or
 * resolves a study ("a chipset is never consumed", `beginStudy` — a filed defect
 * this slice deliberately does NOT fix). One Chipset is therefore unbounded
 * insight today, and this anchor is the most conservative price that is still
 * engine-true.
 */
export function V8_chipsetValueProposal(state: GameState, rate: number): number {
  return engine.studyInsightGranted(state, "chipset") * V7_insightValue(state, rate);
}

// ======================================================================
// V9 · A CODEX — [P], CARRIED AT ZERO
// ======================================================================
/** [P] the engine liquidates a Codex NOWHERE (`src/` has no price for it), so it
 *  is carried at 0 📦 and reported instead as a share of the 471-Codice research
 *  bill. Pricing it would be an invention, so this module refuses to. */
export const V9_CODEX_VALUE_PROPOSAL = 0;

// ======================================================================
// V10 · A RACE MATERIAL — [P] STRICT 0, [P] 4 📦 CARRIED
// ======================================================================
/** [P] the engine never prices a race material. Carried at 4 📦 = the alloy's own
 *  20 📦 bundle split over the 5 materials it eats, which is a choice, not a price. */
export const V10_RACE_MATERIAL_VALUE_PROPOSAL = 4;
export const V10_RACE_MATERIAL_VALUE_STRICT = 0;

// ======================================================================
// V11 · WARPLATE — [P], A CEILING (never a value)
// ======================================================================
/**
 * [P] the engine never prices Warplate either. The anchor: a Forge recipe's
 * inputs buy a forged piece worth at least a T3 armory kit, so Warplate can be
 * worth AT MOST the kit's 📦 value minus the recipe's own supplies and Embers,
 * over the Warplate the recipe eats. Reported as a ceiling; carried at 0 strict in
 * the pass column (warplate is not a supplies trade).
 *
 * The paper recorded 94.8 = 569 / 6 (the whole T3 kit price over the 6 Warplate,
 * ignoring the recipe's own 150 📦 + 40 🧯). This module computes the TIGHTER
 * ceiling from the engine's own numbers, so the anchor cannot overstate.
 */
export function V11_warplateCeilingProposal(rate: number): { perUnit: number; recipeId: string; kitValue: number; kitTier: 3 } {
  const kitValue =
    weaponCost(3).supplies +
    weaponCost(3).embers * rate +
    weaponCost(3).fuel * V4_GEAR_UNIT_PRICES.gas +
    weaponCost(3).plasma * V6_plasmaValue(rate);
  // the deepest recipe that costs the least Warplate for the biggest piece
  const recipe = FORGE_RECIPES.reduce((a, b) => (b.cost.warplate < a.cost.warplate ? b : a));
  const otherInputs = recipe.cost.supplies + recipe.cost.embers * rate;
  return {
    perUnit: round2((kitValue - otherInputs) / recipe.cost.warplate),
    recipeId: recipe.id,
    kitValue: round2(kitValue),
    kitTier: 3,
  };
}

// ======================================================================
// V12 · THE MILD-RING INCIDENTAL SALVAGE (rad 20–34, 13% of runs)
// ======================================================================
/** [E] expected 📦 a mild-ring run recovers in hazmat/shots. Odds, quantity and
 *  the hazmat/shots split all read from the engine's own constants. */
export function V12_mildRingSalvageValue(state: GameState): number {
  void state;
  const meanQuantity = 1 + engine.MILD_SALVAGE_SECOND_UNIT_CHANCE;
  const meanUnitValue =
    engine.MILD_SALVAGE_HAZMAT_SHARE * V4_GEAR_UNIT_PRICES.hazmat +
    (1 - engine.MILD_SALVAGE_HAZMAT_SHARE) * V4_GEAR_UNIT_PRICES.shots;
  return engine.MILD_SALVAGE_CHANCE * meanQuantity * meanUnitValue;
}
/** [E] the depth band that can salvage at all — read from the engine. */
export function V12_appliesToZone(zone: Zone): boolean {
  return zone.radiationLevel >= engine.MILD_SALVAGE_RAD_MIN && zone.radiationLevel < engine.DEEP;
}

// ======================================================================
// THE ITEM TABLE — every item, its status, and where it comes from
// ======================================================================
export type ValuationStatus = "engine" | "proposal";

export interface ValuationItem {
  id: string;
  item: string;
  status: ValuationStatus;
  source: string;
}

export const VALUATION_ITEMS: readonly ValuationItem[] = [
  { id: "V1", item: "Ember → 📦 (scrap rate)", status: "engine", source: "engine.suppliesScrapRate / EMBER_SCRAP_RATE_*" },
  { id: "V2", item: "ordnance unit · 24 📦 + 8 🧯", status: "engine", source: "engine.ORDNANCE_*_PER_UNIT" },
  { id: "V3", item: "operations cost", status: "engine", source: "engine.suppliesCostForZone" },
  { id: "V4", item: "gear unit prices", status: "engine", source: "engine.CRAFT" },
  { id: "V5", item: "gear needs per run", status: "engine", source: "engine.requiredGear/gasNeed/batteryNeed/skmechNeed" },
  { id: "V6", item: "plasma (25 Embers → 1)", status: "engine", source: "armory.ARMORY_CONFIG.plasmaRefineEmbers" },
  { id: "V7", item: "insight (2 Embers → study insight)", status: "engine", source: "engine.STUDY_EMBER_COST × rate ÷ engine.studyInsightGranted" },
  { id: "V8", item: "Chipset — ANCHOR, a floor", status: "proposal", source: "engine.studyInsightGranted(chipset) priced by V7" },
  { id: "V9", item: "Codex — carried at 0", status: "proposal", source: "no engine price exists anywhere in src/" },
  { id: "V10", item: "race material — carried at 4 📦", status: "proposal", source: "the alloy's 20 📦 bundle ÷ the 5 materials it eats" },
  { id: "V11", item: "Warplate — a CEILING, never a value", status: "proposal", source: "T3 kit value − the recipe's other inputs, ÷ its Warplate" },
  { id: "V12", item: "mild-ring incidental salvage", status: "engine", source: "engine.MILD_SALVAGE_* × CRAFT prices" },
];

/** The [P] ones, named — so a reader can never mistake a proposal for a price. */
export const VALUATION_PROPOSAL_IDS: readonly string[] = VALUATION_ITEMS.filter((i) => i.status === "proposal").map((i) => i.id);

// ======================================================================
// THE PASS — all 29 rungs, cost vs loot, and the totals the claim rests on
// ======================================================================
export interface PassOptions {
  /** crew per run (the loot column's biggest lever). Default 1. */
  scientists?: number;
  /** override V1; default = the engine's own rate for `state`. */
  emberScrapRate?: number;
  /** THE COST FIX. false = the shipped column before 2026-09-27. Default true. */
  includeOrdnanceEmbers?: boolean;
  /** THE LOOT FIX. false = the shipped column before 2026-09-27 (zone yield
   *  × `emberYieldMult` only — no crew factor, no race mod). Default true. */
  includeLootMultipliers?: boolean;
  includeChipset?: boolean;
  includePlasma?: boolean;
  includeSalvage?: boolean;
  includeRaceMaterial?: boolean;
}

export interface RungValuation {
  rung: number;
  zone: string;
  hours: number;
  incomeDays: number;
  ops: number;
  gear: number;
  ordnanceUnits: number;
  ordnanceSupplies: number;
  ordnanceEmbers: number;
  ordnanceEmbersValue: number;
  ordnance: number;
  cost: number;
  lootEmbers: number;
  lootChipset: number;
  lootPlasma: number;
  lootSalvage: number;
  lootMaterial: number;
  loot: number;
  net: number;
}

export interface PassValuation {
  rows: RungValuation[];
  scientists: number;
  emberScrapRate: number;
  cost: number;
  loot: number;
  /** Σ|loot − cost| — the un-costed shortfall of the whole pass. */
  shortfall: number;
  incomePerDay: number;
  shortfallIncomeDays: number;
  ladderIncomeDays: number;
  /** the engine's own Σ rungEntryDemand (integer per rung) — the 📦 bill. */
  ladderSupplies: number;
  armoryBuildOut: ArmoryBuildOut;
  armoryBuildOutIncomeDays: number;
  /** the ladder + the shortfall + the armory build-out, in days. */
  worstCaseDays: number;
  payingRungs: number[];
  firstRungThatDoesNotPay: number;
}

export interface ArmoryBuildOut {
  families: number;
  perFamilySupplies: number;
  fuelUnits: number;
  fuelSupplies: number;
  total: number;
}

/** [E] what the five war-hardware families cost in 📦 if the same income funds
 *  them: supplies + the vehicle fuel they burn, priced at V4. Embers and plasma
 *  are excluded exactly as the paper excluded them. */
export function armoryBuildOutSupplies(): ArmoryBuildOut {
  const tiers: WeaponTier[] = [1, 2, 3, 4];
  const perFamilySupplies = tiers.reduce((s, t) => s + weaponCost(t).supplies, 0);
  const fuelUnits = tiers.reduce((s, t) => s + weaponCost(t).fuel, 0);
  const families = WEAPON_TYPES.length;
  const supplies = families * perFamilySupplies;
  const fuelSupplies = families * fuelUnits * V4_GEAR_UNIT_PRICES.gas;
  return { families, perFamilySupplies, fuelUnits, fuelSupplies, total: supplies + fuelSupplies };
}

/** One pass of the ladder, priced end to end. Every number out of this function
 *  is either an engine number or one of the labelled `[P]` proposals above. */
export function valuePass(state: GameState, opts: PassOptions = {}): PassValuation {
  const scientists = opts.scientists ?? 1;
  const rate = opts.emberScrapRate ?? V1_emberScrapRate(state);
  const withOrdnanceEmbers = opts.includeOrdnanceEmbers ?? true;
  const withMultipliers = opts.includeLootMultipliers ?? true;
  const withChipset = opts.includeChipset ?? true;
  const withPlasma = opts.includePlasma ?? true;
  const withSalvage = opts.includeSalvage ?? true;
  const withMaterial = opts.includeRaceMaterial ?? true;

  const chipsetAnchor = V8_chipsetValueProposal(state, rate);
  const plasmaUnit = V6_plasmaValue(rate);
  const salvageUnit = V12_mildRingSalvageValue(state);

  const rows: RungValuation[] = [];
  for (let rung = 0; rung < ZONES.length; rung++) {
    const zone = ZONES[rung];
    const ops = V3_operationsSupplies(state, zone);
    const gear = V5_gearSupplies(state, zone, scientists).value;
    const ordnanceUnits = V2_ordnanceUnitsForRung(rung);
    const ordnanceSupplies = ordnanceUnits * V2_ORDNANCE_SUPPLIES_PER_UNIT;
    const ordnanceEmbers = ordnanceUnits * V2_ORDNANCE_EMBERS_PER_UNIT;
    const ordnanceEmbersValue = withOrdnanceEmbers ? round2(ordnanceEmbers * rate) : 0;
    const ordnance = ordnanceSupplies + ordnanceEmbersValue;
    const cost = ops + gear + ordnance;

    // LOOT — the engine's own multipliers apply to the ember haul.
    const embers = withMultipliers
      ? Math.max(1, Math.round(engine.emberYieldNominal(state, zone, scientists)))
      : zone.emberYield * engine.emberYieldMult(state);
    const lootEmbers = V1_emberValue(embers, rate);
    const chipsetChance = zone.chipsetChance * getRace(state.race!).mods.chipsetChance;
    const lootChipset = withChipset ? round2(chipsetChance * chipsetAnchor) : 0;
    const lootPlasma = withPlasma && engine.isDeepZone(zone.radiationLevel)
      ? round2(chipsetChance * V6_PLASMA_SALVAGE_CHANCE * V6_PLASMA_MEAN_SALVAGE_UNITS * plasmaUnit)
      : 0;
    const lootSalvage = withSalvage && V12_appliesToZone(zone) ? round2(salvageUnit) : 0;
    const lootMaterial = withMaterial && zone.owner !== "shared" && zone.owner !== "special" ? V10_RACE_MATERIAL_VALUE_PROPOSAL : 0;
    const loot = round2(lootEmbers + lootChipset + lootPlasma + lootSalvage + lootMaterial);

    rows.push({
      rung,
      zone: zone.id,
      hours: rungTimerMs(rung) / 3_600_000,
      incomeDays: engine.rungEntryDemandInIncomeDays(zone),
      ops,
      gear,
      ordnanceUnits,
      ordnanceSupplies,
      ordnanceEmbers,
      ordnanceEmbersValue,
      ordnance,
      cost,
      lootEmbers,
      lootChipset,
      lootPlasma,
      lootSalvage,
      lootMaterial,
      loot,
      net: round2(loot - cost),
    });
  }

  const cost = round2(rows.reduce((s, r) => s + r.cost, 0));
  const loot = round2(rows.reduce((s, r) => s + r.loot, 0));
  const shortfall = round2(rows.reduce((s, r) => s + Math.abs(r.net), 0));
  const incomePerDay = engine.suppliesIncomePerDay(state);
  const ladderIncomeDays = rows.reduce((s, r) => s + r.incomeDays, 0);
  const ladderSupplies = rows.reduce((s, r) => s + engine.rungEntryDemand(state, ZONES[r.rung]), 0);
  const armoryBuildOut = armoryBuildOutSupplies();
  const armoryBuildOutIncomeDays = armoryBuildOut.total / incomePerDay;
  const shortfallIncomeDays = shortfall / incomePerDay;
  const firstRungThatDoesNotPay = rows.find((r) => r.net < 0)?.rung ?? -1;

  return {
    rows,
    scientists,
    emberScrapRate: rate,
    cost,
    loot,
    shortfall,
    incomePerDay,
    shortfallIncomeDays,
    ladderIncomeDays,
    ladderSupplies,
    armoryBuildOut,
    armoryBuildOutIncomeDays,
    worstCaseDays: ladderIncomeDays + shortfallIncomeDays + armoryBuildOutIncomeDays,
    payingRungs: rows.filter((r) => r.net >= 0).map((r) => r.rung),
    firstRungThatDoesNotPay,
  };
}

/** The deepest run's gap: what its loot would have to become to pay for itself.
 *  `ratio` is the multiplier the loot column is short by (the ~23x gap), and
 *  `withoutOrdnance` is the same ratio with the whole ordnance charge removed —
 *  which is the honest test of "no constant makes a deep ring self-funding". */
export function deepRingGap(pass: PassValuation, rung = pass.rows.length - 1) {
  const row = pass.rows[rung];
  return {
    rung,
    cost: row.cost,
    loot: row.loot,
    ratio: row.cost / row.loot,
    withoutOrdnanceLootRatio: (row.cost - row.ordnance) / row.loot,
    ordnanceShare: row.ordnance / row.cost,
  };
}

/** The Forge's ingredient, for completeness: the run-yield at a zone's depth tier
 *  under the engine's own drop table (a ceiling anchor, V11). */
export function warplatePerRun(zone: Zone): { tier: number; expected: number } {
  const tier = forgeDepthTier(zone);
  const chance = FORGE_CONFIG.dropChanceByTier[tier] ?? 0;
  const qty = FORGE_CONFIG.dropQtyByTier[tier] ?? [0, 0];
  return { tier, expected: chance * ((qty[0] + qty[1]) / 2) };
}
