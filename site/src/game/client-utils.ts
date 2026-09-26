// Client-side helpers exposing engine-derived values for display.
// engine.ts is pure (no node imports) so it is safe to import on the client.
import type { DomainId, GameState, Leader, Zone } from "./types";
import {
  suppliesPerMinute,
  suppliesCostForZone,
  studyDurationMs,
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
import { weaponCost } from "./armory";
import { getTech } from "./research";
import { SPECIALTY_LABEL } from "./research";
import { REVELATION_TREE, getRevelation } from "./research";
import { ARMORY_TREE, getArmoryTech } from "./research";
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
} from "./engine";

export const engineHelpers = {
  suppliesPerMinute,
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
};
