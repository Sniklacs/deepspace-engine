// Client-side helpers exposing engine-derived values for display.
// engine.ts is pure (no node imports) so it is safe to import on the client.
import type { DomainId, GameState, Leader, Zone } from "./types";
import {
  suppliesPerMinute,
  suppliesCostForZone,
  maxConcurrentExpeditionsState,
  rungEntryDemand,
  rungEntryDemandInIncomeDays,
  energyCapacity,
  energyDrawForZone,
  ordnanceUnitsForZone,
  ORDNANCE_SUPPLIES_PER_UNIT,
  ORDNANCE_EMBERS_PER_UNIT,
  RUNG_ENTRY_R,
  studyDurationMs,
  STUDY_EMBER_COST,
  insightFor,
  deployCost,
  domainAtMaxLevel,
  scientistCapacity,
  isDeepZone,
  requiredGear,
  lossPct,
  baseMaxLoss,
  hasStepOutGear,
  gasNeed,
  batteryNeed,
  skmechNeed,
  protectionIndex,
  hasTech,
  techAvailable,
  techInProgress,
  researchDurationMs as researchDur,
  specialtyAligns,
  specialtyBoostLine,
  leaderSlots,
  craftCost,
  marshalCombatMult,
  marshalProtectionMult,
  quartermasterEconomyMult,
  quartermasterCraftMult,
} from "./engine";
import {
  xpToNextLevel,
  levelProgress,
  xpForLevel,
  leaderLevel,
  xpDayKey,
  DAILY_XP_CAP,
  SPECIALIZATION_MILESTONE,
  SPECIALIZATIONS,
  type Specialization,
} from "./leader-xp";
import { runTimerMs } from "./zones";
import { weaponCost } from "./armory";
import { getTech } from "./research";
import { SPECIALTY_LABEL } from "./research";
import type { T } from "./i18n/types";
import { keyifySegment } from "./i18n/keyify";
import { REVELATION_TREE, getRevelation } from "./research";
import { ARMORY_TREE, getArmoryTech } from "./research";
import { MUSTER_TIER_TREE, getMusterTech, isMusterTech } from "./research";
import { isSatelliteTech, parseSatelliteTech } from "./satellites";
import {
  isRevelationId,
  hasRevelation,
  revelationAvailable,
  revelationInProgress,
  revelationDurationMs as revDur,
  visibleRevelations,
  isArmoryTech,
  armoryTechAvailable,
  armoryTechInProgress,
  armoryResearchDurationMs as armoryDur,
  armoryFamilyState,
  musterTechAvailable,
  musterTechInProgress,
  satelliteTechAvailable,
  satelliteTechInProgress,
} from "./engine";

/** THE BILL — a run's full launch price, itemized exactly the way
 *  `launchExpedition` charges it: operations (gear & crew) + the rung's own
 *  entry demand + ordnance (supplies AND Embers), plus the energy draw.
 *  Owner report 2026-10-16: a Hollow Warrens launch silently took ~6,000 📦
 *  because every launch surface quoted the operations cost alone while the
 *  demand — the bulk on deep rungs — appeared only inside the engine's
 *  insufficient-funds refusal. Every surface that asks a player to commit
 *  now quotes THIS bill, never a partial price. Disclosure only: the
 *  numbers are the engine's own, unchanged. */
export interface ExpeditionBill {
  operations: number;
  demand: number;
  /** the demand's pricing multiple (RUNG_ENTRY_R — the rung's own timer × R). */
  demandMultiple: number;
  /** the demand expressed in days of the colony's supplies income. */
  demandIncomeDays: number;
  ordnanceSupplies: number;
  ordnanceEmbers: number;
  energyDraw: number;
  totalSupplies: number;
  heldSupplies: number;
  afterSupplies: number;
  affordable: boolean;
}

export function expeditionBill(state: GameState, zone: Zone): ExpeditionBill {
  const operations = suppliesCostForZone(state, zone);
  const demand = rungEntryDemand(state, zone);
  const ordUnits = ordnanceUnitsForZone(zone.id);
  const ordnanceSupplies = ordUnits * ORDNANCE_SUPPLIES_PER_UNIT;
  const totalSupplies = operations + demand + ordnanceSupplies;
  const heldSupplies = Math.floor(state.resources.supplies);
  return {
    operations,
    demand,
    demandMultiple: RUNG_ENTRY_R,
    demandIncomeDays: rungEntryDemandInIncomeDays(zone),
    ordnanceSupplies,
    ordnanceEmbers: ordUnits * ORDNANCE_EMBERS_PER_UNIT,
    energyDraw: energyDrawForZone(zone.id),
    totalSupplies,
    heldSupplies,
    afterSupplies: heldSupplies - totalSupplies,
    affordable: state.resources.supplies >= totalSupplies,
  };
}

/** THE LEDGER RULE (owner, 2026-10-16): before ANY action, the player sees
 *  at the point of the tap what they HOLD, what it COSTS, and what REMAINS.
 *  These helpers are the one computation behind the Lab's ledger lines — the
 *  same disclosure pattern as THE BILL for expedition launches. Disclosure
 *  only: every number is the engine's own, unchanged. */
export interface SpendLedger {
  held: number;
  cost: number;
  /** held − cost (negative when the tap cannot be afforded). */
  after: number;
  affordable: boolean;
}

export function spendLedger(held: number, cost: number): SpendLedger {
  return { held, cost, after: held - cost, affordable: held >= cost };
}

/** The 📜 Codices ledger for a research node priced at `cost`. */
export function codicesLedger(state: GameState, cost: number): SpendLedger {
  return spendLedger(state.codices, cost);
}

export interface StudyLedger extends SpendLedger {
  kind: "ember" | "chipset";
  /** whether beginning the study CONSUMES the resource. An Ember study
   *  burns `STUDY_EMBER_COST` Embers. A Chipset study does NOT consume:
   *  `beginStudy` requires one Chipset in hand and deducts nothing (a filed
   *  engine defect, priced around by the valuation). The ledger states the
   *  truth the engine will actually do. */
  consumes: boolean;
}

export function studyLedger(state: GameState, kind: "ember" | "chipset"): StudyLedger {
  if (kind === "ember") {
    const held = Math.floor(state.resources.embers);
    return { kind, ...spendLedger(held, STUDY_EMBER_COST), consumes: true };
  }
  const held = state.resources.chipsets;
  return { kind, held, cost: 1, after: held, affordable: held >= 1, consumes: false };
}

/** A researching job's progress, clamped the way every research surface
 *  renders it. The ONE computation, deliberately independent of any leader
 *  lookup: a job whose leader record no longer resolves still runs, and its
 *  progress still shows (owner 2026-10-16 — the dead-button bar). */
export function researchProgress(
  job: { startedAt: number; durationMs: number },
  now: number,
): { pct: number; remainingMs: number } {
  const pct =
    job.durationMs > 0
      ? Math.min(100, Math.max(0, Math.floor(((now - job.startedAt) / job.durationMs) * 100)))
      : 100;
  return { pct, remainingMs: Math.max(0, job.startedAt + job.durationMs - now) };
}

/** A launch refusal, in the engine's own refusal order — the FIRST gate
 *  `launchExpedition` would trip. `null` reason = the run can go. */
export type ExpeditionRefusal =
  | "noRace"
  | "slots"
  | "supplies"
  | "embers"
  | "energy"
  | "stepOut"
  | "fuel"
  | "battery"
  | "mechanics";

export interface ExpeditionEligibility {
  /** True when every hard gate passes — the server will accept the launch
   *  (deep zones still detour through the risk confirmation, see below). */
  ok: boolean;
  /** The first refusal, mirroring launchExpedition's check order. */
  reason: ExpeditionRefusal | null;
  /** The numbers behind the refusal, for the plain-words line. */
  need: number;
  have: number;
  /** The full bill for this run (expeditionBill) — always computed. */
  bill: ExpeditionBill;
  /** Deep radiation: launching detours through the pre-launch risk
   *  pop-up (the RiskModal-with-bill), exactly as the hangar flow does. */
  needsRiskConfirm: boolean;
  /** Field slots in use / the colony's cap (the "slots" line). */
  activeCount: number;
  maxSlots: number;
}

/**
 * EXPEDITION ELIGIBILITY — can this colony explore this site NOW, and if
 * not, why not, in the engine's own terms (owner 2026-10-16, REDUNDANCY
 * BY DESIGN: every surface where a site appears must answer this in
 * place, not send the player to the hangar to find out). Mirrors
 * `launchExpedition`'s refusal order gate for gate — race, field slots,
 * the full bill in supplies, ordnance Embers, the energy pool, Tier 0
 * stepping-out gear, then the convoy stores (fuel / battery / mechanics,
 * with the same researched-tech easings the engine applies). Disclosure
 * only: nothing here changes a price or a rule.
 */
export function expeditionEligibility(state: GameState, zone: Zone): ExpeditionEligibility {
  const activeCount = state.expeditions.filter((e) => e.status === "out").length;
  const maxSlots = maxConcurrentExpeditionsState(state);
  const base: ExpeditionEligibility = {
    ok: false,
    reason: null,
    need: 0,
    have: 0,
    // A race-less state cannot be priced at all (suppliesCostForZone reads
    // the race's own modifiers — the ENGINE checks race before it ever
    // prices, and so must the mirror): the noRace refusal carries a zeroed
    // bill rather than a crash. Caught by launch-pad.test.ts.
    bill: {
      operations: 0,
      demand: 0,
      demandMultiple: RUNG_ENTRY_R,
      demandIncomeDays: rungEntryDemandInIncomeDays(zone),
      ordnanceSupplies: 0,
      ordnanceEmbers: 0,
      energyDraw: energyDrawForZone(zone.id),
      totalSupplies: 0,
      heldSupplies: Math.floor(state.resources.supplies),
      afterSupplies: Math.floor(state.resources.supplies),
      affordable: false,
    },
    needsRiskConfirm: isDeepZone(zone.radiationLevel),
    activeCount,
    maxSlots,
  };
  const refuse = (reason: ExpeditionRefusal, need: number, have: number): ExpeditionEligibility => ({
    ...base,
    reason,
    need,
    have,
  });
  if (!state.race) return refuse("noRace", 0, 0);
  const bill = expeditionBill(state, zone);
  base.bill = bill;
  if (activeCount >= maxSlots) return refuse("slots", maxSlots, activeCount);
  if (state.resources.supplies < bill.totalSupplies) {
    return refuse("supplies", bill.totalSupplies, Math.floor(state.resources.supplies));
  }
  if (bill.ordnanceEmbers > 0 && state.resources.embers < bill.ordnanceEmbers) {
    return refuse("embers", bill.ordnanceEmbers, Math.floor(state.resources.embers));
  }
  const energyHeld = state.energy ?? energyCapacity(state);
  if (energyHeld < bill.energyDraw) return refuse("energy", bill.energyDraw, Math.floor(energyHeld));
  if (!hasStepOutGear(state)) return refuse("stepOut", 0, 0);
  const gNeed = Math.ceil(gasNeed(zone) * (hasTech(state, "l1") ? 0.5 : 1));
  if (state.resources.gas < gNeed) return refuse("fuel", gNeed, state.resources.gas);
  const bNeed = Math.ceil(
    batteryNeed(zone) * (hasTech(state, "i3") ? 0.5 : 1) * (hasTech(state, "l2") ? 0.6 : 1),
  );
  if (state.resources.battery < bNeed) return refuse("battery", bNeed, state.resources.battery);
  const sNeed = Math.ceil(skmechNeed(zone) * (hasTech(state, "i2") ? 0.5 : 1));
  if (state.resources.skmech < sNeed) return refuse("mechanics", sNeed, state.resources.skmech);
  return { ...base, ok: true };
}

export const engineHelpers = {
  suppliesPerMinute,
  spendLedger(held: number, cost: number) {
    return spendLedger(held, cost);
  },
  codicesLedger(state: GameState, cost: number) {
    return codicesLedger(state, cost);
  },
  studyLedger(state: GameState, kind: "ember" | "chipset") {
    return studyLedger(state, kind);
  },
  researchProgress(job: { startedAt: number; durationMs: number }, now: number) {
    return researchProgress(job, now);
  },
  studySecs(state: GameState, kind: "ember" | "chipset") {
    return Math.round(studyDurationMs(state, kind) / 1000);
  },
  insightFor,
  deployCost,
  // ONE source for "can this domain advance?" (game-ui-shell-spec §11.1): the
  // Lab's Deploy button, the Cradle plate's ready dot, the advance bar and the
  // nav's Lab badge all read this. No new state, no second rule.
  domainAffordable(state: GameState, domain: DomainId): boolean {
    // A topped-out line is not "affordable" — it is FINISHED. Reading the cap
    // here means the Lab button, the Cradle plate's ready dot, the advance bar
    // and the nav's Lab badge all stop offering an advance the server refuses.
    if (domainAtMaxLevel(state, domain)) return false;
    const cost = deployCost(state, domain);
    return state.resources.embers >= cost.embers && state.insight >= cost.insight;
  },
  // The cap itself, for the surfaces that must SAY so rather than show a price.
  domainAtMax(state: GameState, domain: DomainId): boolean {
    return domainAtMaxLevel(state, domain);
  },
  // ONE source for "can this family be built/upgraded?" (§11.1, same reason):
  // the Armory's Build/Upgrade button and the nav's Armory badge share it.
  armoryFamilyAffordable(state: GameState, familyId: string): boolean {
    const { tier } = armoryFamilyState(state, familyId);
    if (tier >= 4) return false;
    const cost = weaponCost(Math.min(4, tier + 1) as 1 | 2 | 3 | 4);
    const r = state.resources;
    return (
      r.supplies >= cost.supplies && r.embers >= cost.embers &&
      r.gas >= cost.fuel && r.plasma >= cost.plasma
    );
  },
  scientistCap(state: GameState) {
    return scientistCapacity(state);
  },
  studying(state: GameState) {
    return state.studies.filter((s) => s.status === "studying");
  },
  suppliesCost(state: GameState, zone: Zone) {
    return suppliesCostForZone(state, zone);
  },
  /** RE-TIME: the rung's own demand and the run's total supplies price — the
   *  client must never quote the operations cost alone, or the launch button
   *  reads affordable on a run the server will refuse. */
  rungDemand(state: GameState, zone: Zone) {
    return rungEntryDemand(state, zone);
  },
  runPrice(state: GameState, zone: Zone) {
    return suppliesCostForZone(state, zone) + rungEntryDemand(state, zone) + ordnanceUnitsForZone(zone.id) * ORDNANCE_SUPPLIES_PER_UNIT;
  },
  /** THE BILL, itemized — see `expeditionBill`. Its totalSupplies IS runPrice. */
  runBill(state: GameState, zone: Zone) {
    return expeditionBill(state, zone);
  },
  /** REDUNDANCY BY DESIGN: can this site be explored NOW — and if not,
   *  the engine's own first refusal. See `expeditionEligibility`. */
  eligibility(state: GameState, zone: Zone) {
    return expeditionEligibility(state, zone);
  },
  /** RE-TIME: the energy pool, charges held vs capacity per day. */
  energy(state: GameState) {
    const cap = energyCapacity(state);
    return { charges: Math.min(cap, state.energy ?? cap), capacity: cap };
  },
  energyDraw(_state: GameState, zone: Zone) {
    return energyDrawForZone(zone.id);
  },
  /** RE-TIME: the rung's own timer and its demand as a multiple of daily income. */
  rung(_state: GameState, zone: Zone) {
    return { timerMs: runTimerMs(zone), demandIncomeDays: rungEntryDemandInIncomeDays(zone) };
  },
  stepOut(state: GameState) {
    return hasStepOutGear(state);
  },
  fuel(state: GameState, zone: Zone) {
    return { gas: gasNeed(zone), battery: batteryNeed(zone), skmech: skmechNeed(zone) };
  },
  protection(state: GameState, zone: Zone, scientists: number) {
    return Math.round(protectionIndex(state, zone, scientists) * 100);
  },
  // Research tree / leaders display helpers (knowledge track).
  hasTech(state: GameState, id: string) { return hasTech(state, id); },
  techAvailable(state: GameState, techId: string) { return techAvailable(state, techId); },
  techInProgress(state: GameState, techId: string) { return techInProgress(state, techId); },
  researching(state: GameState) { return state.researchJobs.filter((j) => j.status === "researching"); },
  techName(techId: string) {
    if (isRevelationId(techId)) return getRevelation(techId).name;
    if (isArmoryTech(techId)) return getArmoryTech(techId).name;
    if (isMusterTech(techId)) return getMusterTech(techId).name;
    if (isSatelliteTech(techId)) {
      const p = parseSatelliteTech(techId)!;
      return `🛰️ ${p.nodeId} satellite — stage ${p.stage}`;
    }
    return getTech(techId).name;
  },
  researchSecs(state: GameState, techId: string, leader: Leader) {
    return Math.round(researchDur(state, techId, leader) / 1000);
  },
  aligns(leader: Leader, techId: string) { return specialtyAligns(leader, techId); },
  boostLine(leader: Leader) { return specialtyBoostLine(leader); },
  specialtyLabel(leader: Leader) { return SPECIALTY_LABEL[leader.specialty]; },
  leaderSlots(state: GameState) { return leaderSlots(state); },
  // ---- Hidden revelation chain (Lab glyph row; public state only — the client
  // never sees raw counters, only the visible ids the server chose to ship) ----
  revelationTree: REVELATION_TREE,
  revelationName(revId: string) { return getRevelation(revId).name; },
  isRevelation(techId: string) { return isRevelationId(techId); },
  hasRevelation(state: GameState, revId: string) { return hasRevelation(state, revId); },
  revelationAvailable(state: GameState, revId: string) { return revelationAvailable(state, revId); },
  revelationInProgress(state: GameState, revId: string) { return revelationInProgress(state, revId); },
  visibleRevelations(state: GameState) { return visibleRevelations(state); },
  revelationSecs(state: GameState, revId: string, leader: Leader) {
    return Math.round(revDur(state, revId, leader) / 1000);
  },
  // ---- V6 Armory research line (Lab tree + Armory tab surfaces) ----
  armoryTree: ARMORY_TREE,
  isArmory(techId: string) { return isArmoryTech(techId); },
  armoryName(techId: string) { return getArmoryTech(techId).name; },
  armoryAvailable(state: GameState, techId: string) { return armoryTechAvailable(state, techId); },
  armoryInProgress(state: GameState, techId: string) { return armoryTechInProgress(state, techId); },
  // ---- Muster tier line (Lab tree surface; owner 2026-10-05) ----
  musterTree: MUSTER_TIER_TREE,
  isMuster(techId: string) { return isMusterTech(techId); },
  musterName(techId: string) { return getMusterTech(techId).name; },
  musterAvailable(state: GameState, techId: string) { return musterTechAvailable(state, techId); },
  musterInProgress(state: GameState, techId: string) { return musterTechInProgress(state, techId); },
  // ORBITAL WATCH: single-source satellite availability / in-progress checks
  // for the Lab's Orbital Watch section.
  satelliteAvailable(state: GameState, techId: string) { return satelliteTechAvailable(state, techId); },
  satelliteInProgress(state: GameState, techId: string) { return satelliteTechInProgress(state, techId); },
  armorySecs(state: GameState, techId: string, leader: Leader) {
    return Math.round(armoryDur(state, techId, leader) / 1000);
  },
  armoryState(state: GameState, familyId: string) {
    return armoryFamilyState(state, familyId);
  },
  craftCost(state: GameState, kind: Parameters<typeof craftCost>[1]) {
    return craftCost(state, kind);
  },
  // ---- Leader XP / leveling / specialization (V3) ----
  leaderLevel(leader: Leader) {
    return leaderLevel(leader);
  },
  xpToNext(leader: Leader) {
    return xpToNextLevel(typeof leader.xp === "number" ? leader.xp : 0);
  },
  xpProgress(leader: Leader) {
    return levelProgress(typeof leader.xp === "number" ? leader.xp : 0);
  },
  xpForLevel(level: number) {
    return xpForLevel(level);
  },
  todayXp(leader: Leader) {
    return typeof leader.dayXp === "number" ? leader.dayXp : 0;
  },
  dayKey(now: number) {
    return xpDayKey(now);
  },
  dailyCap: DAILY_XP_CAP,
  milestone: SPECIALIZATION_MILESTONE,
  specs: SPECIALIZATIONS,
  isSpecialization(v: unknown): v is Specialization {
    return v === "scholar" || v === "marshal" || v === "quartermaster";
  },
  marshalCombatMult(state: GameState) { return marshalCombatMult(state); },
  marshalProtectionMult(state: GameState) { return marshalProtectionMult(state); },
  quartermasterEconomyMult(state: GameState) { return quartermasterEconomyMult(state); },
  quartermasterCraftMult(state: GameState) { return quartermasterCraftMult(state); },
  zoneProspects(_state: GameState, zone: Zone) {
    // Rough expected ember yield for display.
    return {
      embers: Math.round(zone.emberYield * 0.7 + 5),
      chipsetChance: zone.chipsetChance,
    };
  },
  // Radiation gear helpers (DEEP threshold + risk pop-up math).
  isDeep(zone: Zone) {
    return isDeepZone(zone.radiationLevel);
  },
  gear(_state: GameState, zone: Zone, scientists: number) {
    return requiredGear(zone, scientists);
  },
  loss(state: GameState, zone: Zone, scientists: number) {
    return lossPct(state, zone, scientists);
  },
  success(state: GameState, zone: Zone, scientists: number) {
    return 100 - lossPct(state, zone, scientists);
  },
  baseLoss(zone: Zone) {
    return baseMaxLoss(zone);
  },
  domainEffect(state: GameState, domain: DomainId): string {
    switch (domain) {
      case "weaponry":
        return `Shields: Chorus/Corruption gain ${Math.round((1 - Math.pow(0.85, state.deployedDomains.weaponry)) * 100)}% reduced`;
      case "agriculture":
        return `+${state.deployedDomains.agriculture * 3}/min supplies`;
      case "economy":
        return `+${state.deployedDomains.economy * 6}% ember yield · +${state.deployedDomains.economy * 2}/min supplies`;
      case "industry":
        return `Exploration ${Math.round((1 - Math.pow(0.94, state.deployedDomains.industry)) * 100)}% faster & cheaper`;
      case "logistics":
        return `+${Math.floor(state.deployedDomains.logistics / 2)} scientist cap · +${state.deployedDomains.logistics} field slot`;
    }
  },
  /** Translated twin of domainEffect: same numbers, key resolves at RENDER time. */
  domainEffectT(t: T, state: GameState, domain: DomainId): string {
    const key = `cfg.zones.domain.${keyifySegment(domain)}.effect`;
    switch (domain) {
      case "weaponry":
        return t(key, "Shields: Chorus/Corruption gain {n}% reduced", { n: Math.round((1 - Math.pow(0.85, state.deployedDomains.weaponry)) * 100) });
      case "agriculture":
        return t(key, "+{n}/min supplies", { n: state.deployedDomains.agriculture * 3 });
      case "economy":
        return t(key, "+{a}% ember yield · +{b}/min supplies", { a: state.deployedDomains.economy * 6, b: state.deployedDomains.economy * 2 });
      case "industry":
        return t(key, "Exploration {n}% faster & cheaper", { n: Math.round((1 - Math.pow(0.94, state.deployedDomains.industry)) * 100) });
      case "logistics":
        return t(key, "+{a} scientist cap · +{b} field slot", { a: Math.floor(state.deployedDomains.logistics / 2), b: state.deployedDomains.logistics });
    }
  },
};
