import type { DomainId, GameState, Leader, RaceId, ResearchJob, Zone } from "./types";
import { getRace } from "./races";
import { getZone, MAX_DOMAIN_LEVEL, RUNG_TIMER_MS, rungOfZone, rungTimerMs, legacyZoneBaseMs } from "./zones";
import {
  TECH_TREE,
  getTech,
  DOMAIN_SPECIALTY,
  SPECIALTY_LABEL,
  SPECIALTY_DOMAIN,
  starterLeaders,
  rescueLeader,
  getRevelation,
  ARMORY_TREE,
  getArmoryTech,
  MUSTER_TIER_TREE,
  getMusterTech,
  isMusterTech,
} from "./research";
import {
  DAILY_XP_CAP,
  SPECIALIZATION_MILESTONE,
  levelFromXp,
  xpForLevel,
  xpDayKey,
  SPECIALIZATION_BY_ID,
  type Specialization,
} from "./leader-xp";
import {
  MONETIZATION_CONFIG,
  ensureMonetization,
  freshCurrency,
  freshEntitlements,
  freshBattlePass,
  recordSeasonEvent,
  awardDeedCosmetic,
} from "./monetization";
import { ensureStoreOffers } from "./store-offers";
import {
  ARMORY_CONFIG,
  ARMORY_BUILD_SLOTS,
  ARMORY_CATALOG,
  ARMORY_FAMILY_TECH,
  TIER_LANGUAGES,
  familyFor,
  weaponCost,
  weaponTimeMs,
} from "./armory";
import {
  FORGE_CONFIG,
  forgeDropAmount,
  forgeDropChance,
  forgeDepthTier,
  forgeGrade,
  getForgeRecipe,
  meltRefund,
  rollForgeItem,
  type ForgeItem,
  type LoadoutSlot as ForgeLoadoutSlot,
} from "./forge";
import {
  ensureDaily,
  reconcileDaily,
  sweepDaily,
  noteDailyEvent,
  noteDailyLaunch,
  freshDaily,
} from "./daily";
import { advanceBattles, ensureBattles, freshWarReserve } from "./war/battle-engine";
// HERO EARN ENGINE (hero-earn.ts): deed ledger, hero XP, Oracle vouch, and
// the leader battle-XP ladder — computed there, granted here (grantXpTo).
import { processHeroEarn } from "./hero-earn";
import {
  createMemorial,
  ensureMemorials,
  findMemorialByBattle,
  qualifiesForMemorial,
  setEpitaphOnState,
} from "./memorials";
import { currentSeason } from "./seasons";
import {
  MARKET_CONFIG,
  MODULE_CONFIG,
  craftModuleItem,
  getModuleRecipe,
  makeListing,
  marketFee,
  marketListingExpired,
  marketSellerProceeds,
  moduleBroken,
  moduleMeltRefund,
  moduleTierForIndustry,
  tickModuleBattle,
  transferModule,
  validateListing,
  type MarketListing,
  type ModuleItem,
} from "./modules";
import type { ManeuverVector } from "./war/war-types";
import { allianceOf, broadcastRaidAlarm, ensureAlliances, guestsAt, logAllianceActivity, queueAllianceFx, shrinkGuestMirrors } from "./war/alliances";
import { applyTithe, ensureStockpile } from "./shipyard";
import { advanceRallies, ensureRallies } from "./war/rallies";
import { ensureArena, expireArenaChallenges, resolveArenaBattles } from "./war/arena";
import { ensureDuels, expireDuels, resolveDuelBattles } from "./war/duels";
import {
  advanceTroopHome,
  backfillTiers,
  emptyTroopHome,
  addCohort,
  removeTroopsNewestFirst,
  supplyWeight,
  type TroopType,
} from "./war/troops";
import {
  abandonAllForwardBases,
  advanceForwardBase,
  depositBands,
  emptyServerBandPool,
} from "./war/forward-bases";
import { resolveRosterCasualties } from "./war/roster-commit";
import { ensurePrologue, freshPrologue } from "./prologue/prologue-state";
import { WORLD_CONFIG_PUBLIC } from "./world-config";
import {
  ensureSatellites,
  freshSatellites,
  isSatelliteTech,
  parseSatelliteTech,
  satelliteTechFor,
  setSatelliteStage,
  colonyNodeId,
  nodeForColonyId,
  sweepRaidAlarms,
} from "./satellites";
import {
  EMPTY_LOOT,
  SCOUT_PROBE_COST_SUPPLIES,
  SCOUT_TECH_CODICES,
  SCOUT_TECH_DURATION_MS,
  beginGleanRun,
  collectProbe,
  ensureWorldMap,
  isHusk,
  isScoutProbeTech,
  launchProbe,
  lootTotal,
  resolveGleanRun,
} from "./worldmap";
import {
  buildReady,
  createShipBuild,
  emptyPersonalShipyard,
  ensureShipyard,
  recalcBuildDoneAt,
  shipBuildDurationMs,
  shipFromBuild,
} from "./shipyard";
import { SHIP_COST, shipNeedsAlliance, shipName, type ShipClass } from "./worldmap";
import {
  claimHusk as claimHuskPure,
  resolveSubColonies as resolveSubColoniesPure,
  shipSubColonySupplies as shipSubColonySuppliesPure,
  mailOverdueUpkeep as mailOverdueUpkeepPure,
  resolveSubColonyMusters as resolveSubColonyMustersPure,
  resolveStarvedSubColonies as resolveStarvedSubColoniesPure,
  enqueueSubColonyMuster as enqueueSubColonyMusterPure,
  seizeSubColony as seizeSubColonyPure,
  subColonyTroopCount as subColonyTroopCountPure,
  bleedSubColonyTroops as bleedSubColonyTroopsPure,
} from "./subcolonies";
import { markRead, markAllRead, deleteMail } from "./mailbox";
import {
  RAID_MAX_MEMBERS,
  RAID_TRAVEL_MS,
  commitRaidTroops as commitRaidTroopsPure,
  createRaidParty,
  deployRaidTroops,
  deserterBandCount,
  dismissRaidDeserters as dismissRaidDesertersPure,
  hireRaidDeserters as hireRaidDesertersPure,
  joinRaidParty as joinRaidPartyPure,
  mockDefenderLoot,
  raidJumpCharge,
  raidLaunchBlocker,
  raidLootCapacity,
  raidTroopCapacity,
  raidTroopCount,
  rollDeserterEncounter,
  setRaidTarget as setRaidTargetPure,
  clearRaidTargetPure,
  startTacticalRaidBattle,
  tacticalRaidResult,
  tacticalRaidRound as tacticalRaidRoundPure,
  quickResolveTacticalRaid as quickResolveTacticalRaidPure,
  EMPTY_RAID_LOOT,
  type RaidParty,
} from "./raids";
import {
  assignFormationShip as assignFormationShipPure,
  createFormation as createFormationPure,
  emptyFormationsState,
  formationDeployBlocker,
  formationTroopsByType,
  loadFormationShipTroops as loadFormationShipTroopsPure,
  removeFormationShip as removeFormationShipPure,
  unloadFormationShipTroops as unloadFormationShipTroopsPure,
  type Formation,
  type FormationType,
} from "./formations";
import { emptyWarRoomState } from "./war/playbook";
// The daily module's claim resolver + derived favor score re-exported so the
// API surface speaks one engine namespace. favorScore stays SERVER-ONLY.
export { claimDaily, favorScore } from "./daily";
import { ensureTimeTokens } from "./time-tokens";
// TIME TOKENS — the EARNED path AND the SIX SELLABLE sizes, re-exported so the
// API surface speaks one engine namespace. `grantTimeToken` is the daily Devotion's
// door and pays the two EARNED sizes only ("1m","5m"); `applyTimeToken` spends ANY
// size the build defines and compresses ONE running timer, floored at the SAME
// MIN_TIMER_FRACTION the earned modifier stack uses. Since the owner's signed
// ruling of 2026-09-27 six sizes ARE sold — their prices and product ids live in
// monetization.ts (`TIME_TOKEN_PACKS`) — and nothing in THIS module sells anything:
// the sell-side entitlement lands with the Xsolla catalog rows and the storefront
// switch, both still absent (time-tokens.ts carries the whole record).
export { applyTimeToken, grantTimeToken, heldTimeTokens, TIME_TOKEN_SIZES } from "./time-tokens";

// The Deepspace Engine core. Pure logic operating on a GameState object.
// Time is advanced lazily: whenever state is loaded or mutated we "roll forward"
// from lastTick to now, resolving expeditions/studies that finished while offline
// and accruing passive income. This is what makes the world persist while logged out.

export const VERSION = 11;
/** Owner order 2026-10-01: every colony starts out with 10,000 supplies so
 *  new players get into the action immediately — no turtle start, no
 *  day-one money-trap feeling. New colonies are born with it; pre-change
 *  saves get a one-time top-up in ensureResources. */
export const STARTING_SUPPLIES = 10000;
// V2: multi-game saves (account file wrapper; GameState version bumped to match).
// V3: Leader XP/leveling/specialization (xp, unspentPoints, specialization, day,
//     dayXp per Leader; colony-wide day-cap ledger state.leaderXpCaps).
// V4: hidden Unbound revelation track (revelationCounters, revelations,
//     revelationHunts, reward multipliers, acknowledgedOnce ack gate).
//     Old saves migrate silently via ensureRevelation() (see ensureKnowledge).
// V5: monetization seams (currency ledger, entitlements, battle pass — see
//     monetization.ts). Old saves migrate silently via ensureMonetization():
//     zero balances, no owned items, Season 0 pass at 0 XP. No storefront
//     exists; MONETIZATION_CONFIG.storefrontEnabled gates all purchase paths.
// V6: colony-side Armory (weapons-system design 2026-09-12): resources.plasma,
//     state.armory (family tiers), state.armoryBuilds (in-flight builds resolved
//     lazily in advance(), max one per family), weaponsBuilt counter, the 7-node
//     Armory research line (hub + 5 family unlocks + Plasma Refinement), plasma
//     refinement (25 embers → 1) and deep-raid plasma salvage. The contribution
//     FORMULA is untouched — weapons feed NOTHING into it except the two deed
//     counters (first_weapon_built / weapon_tier4, +10 each via deedsCompleted,
//     matching the heroes §O10 precedent), protecting the Unbound gate.
// V7: daily to-do + Oracle Devotion (daily-devotion-spec 2026-09-12; TD1/TD2/TD5
//     owner-ratified): state.daily (the opt-in 4-item list, UTC day rotation),
//     state.devotion (monotonic ledger, accrued at claim — the first live Scrip
//     faucet via grantCurrency, earned-only), state.devotionStreak (consecutive
//     completion days; exactly-once bookkeeping on daily.lastStreakDay), the D6
//     Wheel-of-Years deed at 30 days, and the season-pass "daily_list" event.
//     The 11-item pool, deterministic generator, event funnel, reconcile and
//     claim resolver live in daily.ts; ensureDaily migrates old saves silently
//     (dayKey "" != today — the first advance rolls a fresh list). Devotion + the
//     streak are PUBLIC (TD5); favor internals/Oracle thresholds stay server-only
//     (api.ts strips daily.events/rolledAt/lastStreakDay/banked).
// V8+: World Atlas shell (world-map-design §3, M1/M2/M3/M6/M8 ratified
//     2026-09-12): a NEW pure module src/game/map.ts — the shattered
//     circuit-web, generated deterministically from the world id (mulberry32
//     seed, zero Math.random — the daily.ts standard): seventeen Burning-Rim
//     zones (range ≥ 60 — six ratified anchors + eleven V9 footholds), twelve
//     Near-Ring home-protected zones (four anchors + eight V9), the Chorus-held
//     heart at the web's core (W2 = dark-matter-observatory, the deep-most T3),
//     the §1.3 resource profiles and §2.1 importance (richness / position /
//     chorus → score → tier, computed from zones.ts — 6 T1 / 6 T2 / 5 T3 per
//     world), and the §2.2
//     war constants pre-wired but never exposed. V9 (2026-09-13) densified the
//     web to 30 nodes with nineteen new SHATTERLAND zones (all real expedition
//     destinations) laid out on seeded row-slot permutations. Atlas adds NO
//     STATE — client-rendered public geography (layout is the only client-
//     computed thing, spec §3.6): legacy saves migrate with zero changes,
//     blanks stay
//     quiet (asserted in atlas-tests). The war overlay (holders/ownership/
//     pairing/incursions) arrives with battle-side Phase 1 and is
//     SERVER-computed on top of this static shell.
// V9 (ENGINE VERSION — not to be confused with the Circuit map's own "V9"
// densification label, which added no state): the real-time battle engine
// (battle-side-rvr-spec §15, B1/B4 ratified 2026-09-12 — The Fall's engine).
// state.battles (persistent battle entities) + state.battleReports (the
// append-only ledger, History-Book raw material). Pure math lives in
// src/game/war/{war-types,battle-engine}.ts — offline-safe, DETERMINISTIC
// (no Math.random in win/loss/power), lazily resolved by advanceBattles inside
// advance(). ensureBattles() backfills old saves silently (empty arrays;
// resolved-but-unreported battles get their ledger entry exactly once).
// Per-colony placement for v1 (the prologue is a solo story); the
// world-level war ledger arrives with war Phase 1 (§10.2).
// Old saves migrate silently: missing leader XP fields default to level-1 no-xp
// state and the day ledger is empty (see ensureLeaderXp).
// V11 (2026-09-15): the prologue state spine ("The Fall", opening-prologue-spec
// §4–§8). state.prologue (PrologueBlock) rides every GameState; newGame
// and blankColony seed the default block via freshPrologue(); advance() runs
// ensurePrologue() alongside the other ensure* passes so pre-V11 saves gain
// the block additively and idempotently (stage "rebuilt", completed false).
// V10 (owner-locked 2026-09-14): the L3 economy path "steward" is renamed
// "quartermaster". "Steward" survives ONLY as
// Kael's TITLE (the generalist caretaker) — never a path. Legacy saves with
// specialization "steward" migrate to "quartermaster" in ensureLeaderXp
// (additive, idempotent; buff numbers untouched). Purifier = the 4th path,
// explicitly DEFERRED to the corruption/Oracle layer — no mechanics here.

// Inputs are already in milliseconds; TIME_SCALE just allows demo-speed tuning.
export const TIME_SCALE = 1;

// ======================================================================
// THE RE-TIME — owner-ratified 2026-09-26, verbatim: "Go ahead with R = 6
// and the 4h-to-168h ladder, and yes — gear gets consumed per run. Start
// the re-time."  Brief: /home/team/shared/re-time-spec-2026-09-26.md
// ======================================================================

/**
 * R = 6 — entering a rung demands SIX times that rung's own run timer, priced
 * in the player's own income: `D(k) = R x d(k) x I(k) / 24`.
 *
 * Income-denominated ON PURPOSE. Income accrues 24/7 while the world is offline
 * and is unbounded (see the passive-supplies line in `advance()`), so any price
 * LIST re-creates the defect this re-time exists to fix the moment income grows:
 * a fixed bill against a growing income is exhausted in days. A price expressed
 * as a multiple of the timer, in the income the player actually has, keeps the
 * ratio constant forever. There is deliberately NO price table anywhere.
 *
 * The identity retime-tests asserts: funding the whole ladder =
 * R x Σd / 24 = 6 x 1,316.2 h / 24 = **329.1 days** = 10.8 months.
 */
export const RUNG_ENTRY_R = 6;

/**
 * THE FLOOR — no timer may fall below this fraction of its own base.
 *
 * Derivation, written once for both sides of the product: the owner's own
 * monetization ceiling is "free 7 years / paid 2 years even spending thousands
 * a week" — a heavy buyer compresses at most 3.5x. 1 / 3.5 = 0.2857, kept as
 * 0.286. The SAME constant therefore bounds two different things:
 *   · the EARNED modifier stack (specialty, attributes, techs, domains), where
 *     `timerFloor()` asserts it at the point the stack is applied; and
 *   · TIME TOKENS — the owner's OWN ruling of 2026-09-27 ("Add 1 minute and 5
 *     minute speed UPS to each devotion reward claim") and the SELL side of the
 *     2026-09-27 ruling, EARNED OR BOUGHT and spent through `applyTimeToken`
 *     (time-tokens.ts), which asserts THIS constant
 *     against the timer's own base at every application. A token can therefore
 *     never compress a timer past the same 3.5x ceiling the purchased side was
 *     sized to.
 * THE SELL-SIDE SENTENCE IS SIGNED (2026-09-27): "speed-ups are sold, they compress
 * one timer by at most 3.5×, and grant no resource, no strength, no scored currency
 * and no season tier." So the SIX sellable sizes exist (time-tokens.ts) at the
 * owner's prices (monetization.ts `TIME_TOKEN_PACKS`), and this constant bounds them
 * at the same 3.5×, asserted at every application. What is still absent is the
 * ABILITY TO PAY: every product id is unset (a sale is refused by name), no Payment
 * Link is configured, and `storefrontEnabled` is false. Nothing purchasable moves a
 * timer in this build.
 * One assertion, three callers, one signed ceiling.
 */
export const MIN_TIMER_FRACTION = 0.286;

/**
 * Apply the floor to a base duration and a stack-modified result. Every earned
 * modifier is multiplicative `< 1`, so the product can in principle collapse a
 * week-long timer into minutes; this makes that impossible.
 */
export function timerFloor(baseMs: number, modifiedMs: number): number {
  return Math.max(Math.round(baseMs * MIN_TIMER_FRACTION), Math.round(modifiedMs));
}

/** Ordnance: `max(0, floor((k - 5) / 3))` units per run on rung k. */
export const ORDNANCE_SUPPLIES_PER_UNIT = 24;
export const ORDNANCE_EMBERS_PER_UNIT = 8;

/** Ordnance units a run on this rung burns (zero through the first five rungs). */
export function ordnanceUnitsForRung(rung: number): number {
  return Math.max(0, Math.floor((rung - 5) / 3));
}
export function ordnanceUnitsForZone(zoneId: string): number {
  return ordnanceUnitsForRung(rungOfZone(zoneId));
}

/** The energy pool: `20 + 2 x logistics` charges per day. */
export const ENERGY_BASE_CHARGES_PER_DAY = 20;
export const ENERGY_PER_LOGISTICS_LEVEL = 2;

export function energyCapacity(state: GameState): number {
  return ENERGY_BASE_CHARGES_PER_DAY + ENERGY_PER_LOGISTICS_LEVEL * (state.deployedDomains.logistics ?? 0);
}

/** What a run draws from the pool: `2 + floor(k / 6)` charges. */
export function energyDrawForRung(rung: number): number {
  return 2 + Math.floor(Math.max(0, rung) / 6);
}
export function energyDrawForZone(zoneId: string): number {
  return energyDrawForRung(rungOfZone(zoneId));
}

/** The colony's own income in 📦 per day — the denominator of the identity. */
export function suppliesIncomePerDay(state: GameState): number {
  return suppliesPerMinute(state) * 1440;
}

/**
 * THE DEMAND — `D(k) = R x d(k) x I(k) / 24`, the supplies it takes to enter
 * rung k. Read the formula, never a number: `d(k)` is the rung's own timer from
 * the ratified table and `I(k)` is this colony's income RIGHT NOW, so the price
 * follows both the ladder and the colony without a constant to go stale.
 */
export function rungEntryDemand(state: GameState, zone: Zone): number {
  const hours = rungTimerMs(rungOfZone(zone.id)) / 3_600_000;
  return Math.max(0, Math.round((RUNG_ENTRY_R * hours * suppliesIncomePerDay(state)) / 24));
}

/**
 * The same demand expressed as a multiple of one day's income — the identity
 * itself, scale-free, which is what "income-denominated" means. Rung 0 = 1.00
 * income-days, rung 28 = 42.0; the 29 rungs sum to 329.1 days.
 */
export function rungEntryDemandInIncomeDays(zone: Zone): number {
  return (RUNG_ENTRY_R * (rungTimerMs(rungOfZone(zone.id)) / 3_600_000)) / 24;
}

/** The floor of the arc: one serial pass over every rung, in days of timers. */
export function serialPassDays(): number {
  return RUNG_TIMER_MS.reduce((a, b) => a + b, 0) / 3_600_000 / 24;
}

/**
 * THE MIGRATION (spec §7) — ONE idempotent pass, both directions proven.
 *
 * Called from `advance()` AFTER every resolver, which is what makes step 1
 * true: a run that was already complete in the OLD scale has already resolved
 * (in the old scale) and is gone from `state.expeditions`, so it can never be
 * extended by the re-base. Whatever is still running is then re-based
 * proportionally to the BASE — `newBase / oldBase` keeps whatever modifiers the
 * run was launched with — and its elapsed clock is discarded (`startedAt = now`),
 * because the elapsed part was measured against a scale that no longer exists.
 *
 * The stamp makes it once-only: a second deploy cannot double-rebase, and a
 * save that was already re-based is untouched.
 */
export function TIMER_REBASE_STAMP(): number {
  return 1;
}

export function migrateTimersToReTime(state: GameState, now: number): void {
  if (state.timerRebase === TIMER_REBASE_STAMP()) return;
  for (const e of state.expeditions ?? []) {
    if (e.status !== "out") continue;
    const oldBase = legacyZoneBaseMs(e.zoneId);
    const newBase = rungTimerMs(rungOfZone(e.zoneId));
    if (!(oldBase > 0)) continue;
    e.durationMs = Math.max(1, Math.round(e.durationMs * (newBase / oldBase)));
    e.startedAt = now; // elapsed clock discarded (spec §7 step 2)
  }
  state.timerRebase = TIMER_REBASE_STAMP();
}

/** Backfill the re-time's own state on a legacy save (idempotent, silent). */
function ensureReTime(state: GameState, now: number) {
  const cap = energyCapacity(state);
  if (typeof state.energy !== "number" || !isFinite(state.energy) || state.energy < 0) {
    state.energy = cap; // a legacy colony comes back with a full pool
  }
  if (typeof state.energyAt !== "number" || !isFinite(state.energyAt)) state.energyAt = now;
  if (state.programDeploy === undefined) state.programDeploy = null;
}

/** The energy pool's lazy regen — no timer of its own, like every other clock. */
function regenEnergy(state: GameState, now: number) {
  const cap = energyCapacity(state);
  const perMs = cap / 86_400_000;
  const since = Math.max(0, now - (state.energyAt ?? now));
  state.energy = Math.min(cap, (state.energy ?? cap) + perMs * since);
  state.energyAt = now;
}

/** Resolve a finished domain deployment (the re-time gives it a timer). */
function resolveProgramDeploy(state: GameState, now: number) {
  const j = state.programDeploy;
  if (!j) return;
  // TIME TOKENS: an earned token takes its own duration off the remaining time.
  // `durationMs` and `startedAt` are never moved, so the floor is always read
  // against the deployment's own base duration.
  if (now + (j.timeTokenMs ?? 0) < j.startedAt + j.durationMs) return;
  state.deployedDomains[j.domain] = (state.deployedDomains[j.domain] ?? 0) + 1;
  state.deployablePrograms.push(j.domain);
  // Silent track: the deepest the colony has ever driven any domain line.
  const c = state.revelationCounters;
  if (c && typeof c === "object") {
    c.maxDomainDepth = Math.max(c.maxDomainDepth ?? 0, ...Object.values(state.deployedDomains));
  }
  state.programDeploy = null;
  log(state, `Recovered AI deployed: ${domainFor(j.domain)} advanced to level ${state.deployedDomains[j.domain]}.`);
  awardDeed(state, "first_deploy", 1, "recovery AI deployed for the first time");
}

/**
 * How long a domain deployment takes: the ratified ladder read at the level
 * being entered (L1 = the rim rung's 4 h … L10 ≈ 13.3 h). No new constant is
 * invented here — the same table, the same geometry, indexed by the level the
 * program is climbing to. `deployProgram` had NO timer before this, which is
 * what left the R = 6 arithmetic open.
 */
export function deployDurationMs(state: GameState, domain: DomainId): number {
  const level = state.deployedDomains[domain] ?? 0;
  return rungTimerMs(level);
}



// ------- the mild-ring incidental salvage (the valuation's V12) -------
//
// Named for the same reason the yield model is: a run's incidental haul is a
// priceable quantity, and a measurement must read the odds from the engine
// rather than retype them. `resolveExpedition` below uses THESE.
export const MILD_SALVAGE_RAD_MIN = 20;
export const MILD_SALVAGE_CHANCE = 0.13;
export const MILD_SALVAGE_SECOND_UNIT_CHANCE = 0.5;
export const MILD_SALVAGE_HAZMAT_SHARE = 0.6;

// ------- radiation model -------

// Deep zones need radiation gear (hazmat/shots/alloys) + the pre-launch risk
// pop-up. Zones below DEEP only get a small inline warning.
export const DEEP = 35;

export const ALL_RACE_IDS: RaceId[] = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"];

export function isDeepZone(rad: number): boolean {
  return rad >= DEEP;
}

export function hazmatPerScientist(rad: number): number {
  return 1 + Math.floor((rad - DEEP) / 20);
}
export function shotsPerScientist(rad: number): number {
  return 1 + Math.floor((rad - DEEP) / 20);
}
export function alloysPerZone(rad: number): number {
  return 1 + Math.floor((rad - DEEP) / 25);
}

export function requiredGear(zone: Zone, scientists: number): { hazmat: number; shots: number; alloys: number } {
  const hazmat = Math.max(0, hazmatPerScientist(zone.radiationLevel)) * scientists;
  const shots = Math.max(0, shotsPerScientist(zone.radiationLevel)) * scientists;
  const alloys = Math.max(0, alloysPerZone(zone.radiationLevel));
  return { hazmat, shots, alloys };
}

/** 0-1 how much of the required radiation load the colony's gear covers. */
export function gearCoverage(state: GameState, zone: Zone, scientists: number): number {
  if (!isDeepZone(zone.radiationLevel)) return 1;
  const need = requiredGear(zone, scientists);
  const cH = need.hazmat > 0 ? state.resources.hazmat / need.hazmat : 1;
  const cS = need.shots > 0 ? state.resources.shots / need.shots : 1;
  const cA = need.alloys > 0 ? state.resources.alloys / need.alloys : 1;
  return Math.min(1, Math.min(1, cH), Math.min(1, cS), Math.min(1, cA));
}

/** Base max loss % for a zone (deep peaks at 45; mild at rad*0.15). */
export function baseMaxLoss(zone: Zone): number {
  const rad = zone.radiationLevel;
  return isDeepZone(rad) ? Math.min(45, rad * 0.45) : rad * 0.15;
}

/** Projected loss % for a planned expedition given the colony's gear. */
export function lossPct(state: GameState, zone: Zone, scientists: number): number {
  const cover = gearCoverage(state, zone, scientists);
  return Math.round(baseMaxLoss(zone) * (1 - cover));
}

/** 0-1 loss probability snapshotted into an expedition at launch. */
export function lossFraction(state: GameState, zone: Zone, scientists: number): number {
  return lossPct(state, zone, scientists) / 100;
}

// ------- alloy recipe (cross-race territory materials) -------
//
// The radiation-resistant alloy needs your OWN race's territory material + the
// materials of 4 OTHER races (any 4 of the other 5) = 5 distinct race-materials.
// This forces cross-race expeditions: you must run other races' home regions to
// gather their unique materials and forge the alloy (extraction key).

/** Race ids held (≥1 each) — the flexible 5-material set: own + up to 4 others. */
export function alloyRecipeRaces(state: GameState): RaceId[] {
  if (!state.race) return [];
  const own = state.race;
  const others = ALL_RACE_IDS.filter((r) => r !== own && (state.resources.mats[r] ?? 0) >= 1);
  if (others.length < 4) return [];
  return [own, ...others.slice(0, 4)];
}

/** True when the 5 unique race-materials are held (alloy forge is enabled). */
export function canForgeAlloy(state: GameState): boolean {
  return alloyRecipeRaces(state).length === 5;
}

export interface CraftCosts {
  supplies: number;
  label: string;
  icon: string;
  description: string;
}

// ------- everyday gear & logistics ladder -------
//
// Beyond the radiation gear above, colonies must have stepping-out gear to field
// ANY expedition, and fuel/mechanics for the deeper, farther, noisier sites.
//
//   Tier 0 (Step Out)  — medical kit, basic mechanics kit, armor/armature kit.
//                         Without these a colony cannot field an expedition at all.
//   Tier 1 (Outer/mild) — radiation shots (above), skilled mechanics, and the
//                         fuel mix: vehicle fuel (gas) & battery packs (electric).
//
// VEHICLE FUEL MIX (owner-locked discovery puzzle — do NOT explain to the player):
//   gas    = long-distance travel (reaching far sites); scaled by a zone's `range`.
//   battery= QUIET operation once at the site (stealth near the Chorus); zone `quiet`.
//   Deeper sites need BOTH. A player who neglects one simply fails — that is intended.
//   The error strings below hint at the two axes without spelling out the mechanic.

export const FUEL_RANGE_THRESH = 45;
export const FUEL_QUIET_THRESH = 45;
export const MECH_RISK_THRESH = 50;

/** Vehicle fuel (gas) a zone needs — long-haul distance. */
export function gasNeed(zone: Zone): number {
  return zone.range >= FUEL_RANGE_THRESH ? 1 + Math.floor((zone.range - FUEL_RANGE_THRESH) / 25) : 0;
}
/** Battery packs (electric) a zone needs — quiet ops near the Chorus. */
export function batteryNeed(zone: Zone): number {
  return zone.quiet >= FUEL_QUIET_THRESH ? 1 + Math.floor((zone.quiet - FUEL_QUIET_THRESH) / 25) : 0;
}
/** Skilled mechanics needed for heavier machinery (higher-risk sites). */
export function skmechNeed(zone: Zone): number {
  return zone.risk >= MECH_RISK_THRESH ? 1 + Math.floor((zone.risk - MECH_RISK_THRESH) / 20) : 0;
}

/** Convoy stores a zone needs AFTER the colony's research discounts — the same
 *  figures `launchExpedition` enforces (l1 Long-Haul Chassis, i3 Battery Fab,
 *  l2 Silent Drives, i2 Machine Shop). The exploration page's per-site
 *  material breakdown reads these, so the card and the gate can never disagree. */
export function convoyNeeds(state: GameState, zone: Zone): { gas: number; battery: number; skmech: number } {
  return {
    gas: Math.ceil(gasNeed(zone) * (hasTech(state, "l1") ? 0.5 : 1)),
    battery: Math.ceil(
      batteryNeed(zone) * (hasTech(state, "i3") ? 0.5 : 1) * (hasTech(state, "l2") ? 0.6 : 1),
    ),
    skmech: Math.ceil(skmechNeed(zone) * (hasTech(state, "i2") ? 0.5 : 1)),
  };
}

/** Tier 0 present? Without all three a colony cannot field any expedition. */
export function hasStepOutGear(state: GameState): boolean {
  const r = state.resources;
  return r.medkit >= 1 && r.mechkit >= 1 && r.armorkit >= 1;
}

/** 0-1 protection index — the colony's guards & gear that ABSORB the unforeseeable.
 *  Snapshotted into every expedition at launch; how a wildcard resolves. */
export function protectionIndex(_state: GameState, _zone: Zone, scientists: number): number {
  const r = _state.resources;
  const armor = Math.min(1, r.armorkit / 1) * 0.30; // armature on crew & light vehicles
  const med = Math.min(1, r.medkit / 1) * 0.12; // trauma care
  const mech = Math.min(1, r.mechkit / 1) * 0.08; // field patch-up
  const skm = Math.min(1, r.skmech / Math.max(1, skmechNeed(_zone))) * 0.10; // heavy-machinery skill
  const need = requiredGear(_zone, scientists);
  const shots = Math.min(1, r.shots / Math.max(1, need.shots)) * 0.15; // radiation support
  const hazmat = Math.min(1, r.hazmat / Math.max(1, need.hazmat)) * 0.15; // suited teams
  const numbers = Math.min(1, scientists / 4) * 0.10; // strength in numbers
  return clamp(armor + med + mech + skm + shots + hazmat + numbers, 0, 1);
}

export type CraftKind = "medkit" | "mechkit" | "armorkit" | "skmech" | "gas" | "battery" | "hazmat" | "shots" | "alloy";

/** What resource a craft kind produces (kind -> resources key). "alloy" craft → "alloys". */
type ResourceKey = Exclude<keyof GameState["resources"], "mats">;
export const CRAFT_RESOURCE_KEY: Record<CraftKind, ResourceKey> = {
  medkit: "medkit",
  mechkit: "mechkit",
  armorkit: "armorkit",
  skmech: "skmech",
  gas: "gas",
  battery: "battery",
  hazmat: "hazmat",
  shots: "shots",
  alloy: "alloys",
};

export const CRAFT: Record<CraftKind, CraftCosts> = {
  // Tier 0 — stepping out. Gates fielding ANY expedition.
  medkit: { supplies: 5, label: "Medical kit", icon: "🩺", description: "Bandages and basic shots against sickness. Without a medical kit no team can step out at all." },
  mechkit: { supplies: 6, label: "Mechanics kit", icon: "🔧", description: "Patch-up and basic vehicle repair. Without it no team can field an exploration." },
  armorkit: { supplies: 7, label: "Armor/armature kit", icon: "🛡️", description: "Armature for crew and light vehicles. Without it no team can field an exploration." },
  // Tier 1 — outer / mild zones.
  skmech: { supplies: 14, label: "Skilled mechanics", icon: "👷", description: "A crew that repairs and maintains heavier machinery in the farther ruins." },
  gas: { supplies: 4, label: "Vehicle fuel", icon: "⛽", description: "For the long-haul convoy. Burned per exploration — refuel to go further." },
  battery: { supplies: 5, label: "Battery packs", icon: "🔋", description: "Quiet electric running at the site. Discharged per exploration — recharge before you go." },
  // Tier 2 — deep zones (explore vs extract).
  hazmat: { supplies: 8, label: "Hazmat suit", icon: "🧥", description: "Lets a suited team EXPLORE deep radiation zones (protection per scientist)." },
  shots: { supplies: 6, label: "Radiation shot", icon: "💉", description: "Support injector that buffers attrition (protection per scientist)." },
  alloy: { supplies: 20, label: "Alloy-armed digger", icon: "⚙️", description: "Forged from 5 unique race materials — the only way to EXTRACT loot from the deep." },
};

export function ms(v: number) {
  return v * TIME_SCALE;
}

// ------- setup -------

export function newGame(playerName: string, raceId: RaceId, now = Date.now()): GameState {
  return {
    version: VERSION,
    createdAt: now,
    lastTick: now,
    playerName: playerName.trim() || "Unnamed Colony",
    race: raceId,
    raceLocked: true,
    resources: {
      embers: 8,
      chipsets: 0,
      supplies: STARTING_SUPPLIES,
      hazmat: 0,
      shots: 0,
      alloys: 0,
      medkit: 0,
      mechkit: 0,
      armorkit: 0,
      skmech: 0,
      gas: 0,
      battery: 0,
      mats: { grays: 0, nephilim: 0, draconians: 0, anunnaki: 0, ashtar: 0, watchers: 0 },
      plasma: 0,
      // THE FORGE's ingredient — a rare drop in the deeper Explorations.
      warplate: 0,
    },
    scientists: 2,
    totalScientists: 2,
    insight: 0,
    deployedDomains: { weaponry: 0, agriculture: 0, economy: 0, industry: 0, logistics: 0 },
    deployablePrograms: [],
    codices: 0,
    totalCodicesEarned: 0,
    techsResearched: [],
    researchJobs: [],
    leaders: starterLeaders(now),
    deedsCompleted: [],
    totalBreakthroughs: 0,
    leaderXpCaps: {},
    // Hero earn engine (hero-earn.ts): zeroed ledgers — heroes are earned.
    heroDeeds: [],
    earnedHeroes: [],
    heroXpCaps: {},
    heroBattleGrants: {},
    heroEventIds: {},
    // Season identity (the sky rolls against it — design/satellites.md §0.4).
    seasonId: MONETIZATION_CONFIG.season0Id,
    // Orbital Watch: the constellation over this world (~50% awake, seeded).
    satellites: freshSatellites(WORLD_CONFIG_PUBLIC.worldId, MONETIZATION_CONFIG.season0Id),
    // The ground this colony stands on (a covered rim/heart node) — the raid
    // alarm watches this node's satellite. Seeded by name+time: stable enough
    // for founding; colonyNodeId() backfills older saves deterministically.
    homeNodeId: nodeForColonyId(`${playerName}:${now}`, WORLD_CONFIG_PUBLIC.worldId, WORLD_CONFIG_PUBLIC.raceLock),
    // ---- Hidden Unbound revelation track (V4): zeroed, silent ----
    revelationCounters: freshRevelationCounters(),
    revelations: [],
    revelationsResolved: [],
    revelationHunts: false,
    revelationFirstOpenAt: undefined,
    revelationChoice: null,
    revelationCorruptionGainMult: 1,
    revelationDrainPerMin: 0,
    revelationChorusMult: 1,
    acknowledgedOnce: false,
    // Born with the founding stockpile — no top-up needed.
    startingSuppliesGranted: true,
    expeditions: [],
    studies: [],
    completedExpeditions: 0,
    totalEmbersLooted: 0,
    totalChipsetsLooted: 0,
    corruption: 0,
    chorusAttention: 0,
    // ---- Monetization (V5): zeroed seams — no storefront exists ----
    currency: freshCurrency(),
    entitlements: freshEntitlements(),
    battlePass: freshBattlePass(now),
    // ---- Armory (V6): no war hardware yet — EARN-ONLY at the Cradle, and it
    // stays earn-only now that the store sells something: what TIME_TOKEN_PACKS
    // sells is TIME (time-tokens.ts), never a weapon, and a purchasable key that
    // named war hardware would still be refused by name (monetization.ts). ----
    armory: {},
    armoryBuilds: {},
    weaponsBuilt: 0,
    // ---- THE FORGE (owner 2026-09-26): a new colony's racks are empty ----
    forgeItems: [],
    forgeRolls: {},
    forgeSeq: 0,
    forgeMelts: 0,
    // ---- Daily to-do + Oracle Devotion (V7): quiet fresh block — the first
    // advance rolls today's list (dayKey "" != today). Devotion is zero. ----
    daily: freshDaily(now),
    devotion: 0,
    devotionStreak: 0,
    // ---- Real-time battle engine (V9): no wars have been fought yet ----
    battles: [],
    battleReports: [],
    // B12/B11 reserve seam — zero until the war layer (or Act I's seeded
    // full-power state) fills it; grows only from play.
    warReserve: freshWarReserve(),
    // ---- Prologue state spine (V11): a legacy/new colony is past the Fall ----
    prologue: freshPrologue(),
    log: [`The Cradle settles against the Shatterlands. The ${getRace(raceId).name} claim their colony.`],
  };
}

/** A wiped colony slot awaiting a NEW race+name (used by Reset → race selection). */
export function blankColony(now = Date.now()): GameState {
  return {
    version: VERSION,
    createdAt: now,
    lastTick: now,
    playerName: "",
    race: null,
    raceLocked: false,
    resources: {
      embers: 0,
      chipsets: 0,
      supplies: 0,
      hazmat: 0,
      shots: 0,
      alloys: 0,
      medkit: 0,
      mechkit: 0,
      armorkit: 0,
      skmech: 0,
      gas: 0,
      battery: 0,
      mats: { grays: 0, nephilim: 0, draconians: 0, anunnaki: 0, ashtar: 0, watchers: 0 },
      plasma: 0,
      // THE FORGE's ingredient — a rare drop in the deeper Explorations.
      warplate: 0,
    },
    scientists: 0,
    totalScientists: 0,
    insight: 0,
    deployedDomains: { weaponry: 0, agriculture: 0, economy: 0, industry: 0, logistics: 0 },
    deployablePrograms: [],
    codices: 0,
    totalCodicesEarned: 0,
    techsResearched: [],
    researchJobs: [],
    leaders: [],
    deedsCompleted: [],
    totalBreakthroughs: 0,
    leaderXpCaps: {},
    // Hero earn engine (hero-earn.ts): zeroed ledgers — heroes are earned.
    heroDeeds: [],
    earnedHeroes: [],
    heroXpCaps: {},
    heroBattleGrants: {},
    heroEventIds: {},
    seasonId: MONETIZATION_CONFIG.season0Id,
    satellites: freshSatellites(WORLD_CONFIG_PUBLIC.worldId, MONETIZATION_CONFIG.season0Id),
    // Blank slot: no ground yet — colonyNodeId() assigns on first use.
    // ---- Hidden Unbound revelation track (V4): zeroed, silent ----
    revelationCounters: freshRevelationCounters(),
    revelations: [],
    revelationsResolved: [],
    revelationHunts: false,
    revelationFirstOpenAt: undefined,
    revelationChoice: null,
    revelationCorruptionGainMult: 1,
    revelationDrainPerMin: 0,
    revelationChorusMult: 1,
    acknowledgedOnce: false,
    expeditions: [],
    studies: [],
    completedExpeditions: 0,
    totalEmbersLooted: 0,
    totalChipsetsLooted: 0,
    corruption: 0,
    chorusAttention: 0,
    // ---- Monetization (V5): zeroed seams (wiped colony keeps empty wallets) ----
    currency: freshCurrency(),
    entitlements: freshEntitlements(),
    battlePass: freshBattlePass(now),
    // ---- Armory (V6): wiped colony holds no war hardware ----
    armory: {},
    armoryBuilds: {},
    weaponsBuilt: 0,
    // ---- THE FORGE: a wiped colony's racks are empty (no items survive) ----
    forgeItems: [],
    forgeRolls: {},
    forgeSeq: 0,
    forgeMelts: 0,
    // ---- Daily to-do + Oracle Devotion (V7): quiet state — a blank/reset
    // colony holds no list (race null -> generator returns []); the panel
    // renders "the Cradle asks nothing of you today". ----
    daily: freshDaily(now),
    devotion: 0,
    devotionStreak: 0,
    // ---- Real-time battle engine (V9): a wiped colony holds no battles ----
    battles: [],
    battleReports: [],
    warReserve: freshWarReserve(),
    // ---- Prologue state spine (V11): a wiped slot never ran the Fall ----
    prologue: freshPrologue(),
    log: [],
  };
}

// ------- helpers -------

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function coin(chance: number) {
  return Math.random() < chance;
}

export function log(state: GameState, msg: string) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 60);
}

// ------- derived state -------

/**
 * Cradle tier (1–5) — the colony's advancement proxy until the building
 * system owns a real Cradle tier. Derived from total deployed domain levels:
 * every 4 levels is a tier. Drives the home garrison cap (troops.ts) and,
 * later, alliance help-tick strength (alliances.md §4). One seam, one source.
 */
export function cradleTier(state: GameState): number {
  const d = state.deployedDomains;
  const total = (d?.weaponry ?? 0) + (d?.agriculture ?? 0) + (d?.economy ?? 0) + (d?.industry ?? 0) + (d?.logistics ?? 0);
  return Math.min(5, Math.max(1, 1 + Math.floor(total / 4)));
}

/**
 * THE MUSTER — additive, idempotent. Pre-muster saves gain an empty garrison,
 * no queues, no hunger, no bands, an empty casualty feed. New games seed via
 * the same path (called from advance(); newGame flows through advance too).
 */
export function ensureTroops(state: GameState, now: number): void {
  if (!state.troops) {
    state.troops = { home: emptyTroopHome(now), bands: [], history: [] };
    return;
  }
  if (!state.troops.home) state.troops.home = emptyTroopHome(now);
  if (!Array.isArray(state.troops.bands)) state.troops.bands = [];
  if (!Array.isArray(state.troops.history)) state.troops.history = [];
  if (!Array.isArray(state.troops.home.musterQueue)) state.troops.home.musterQueue = [];
  // Tier migration (owner 2026-10-05): cohorts and muster orders saved before
  // troop tiers existed read as T1. Idempotent.
  backfillTiers(state.troops.home.roster, state.troops.home.musterQueue);
}

export function ensureForwardBases(state: GameState, now: number): void {
  if (!state.forwardBases) state.forwardBases = {};
  if (!state.serverBands) state.serverBands = emptyServerBandPool();
  if (state.lastJumpAt === undefined) state.lastJumpAt = null;
  // Backfill safety: every base owns a complete TroopHome + wall state.
  for (const base of Object.values(state.forwardBases)) {
    if (!base.home) base.home = emptyTroopHome(now);
    if (!Array.isArray(base.home.musterQueue)) base.home.musterQueue = [];
    if (typeof base.supplies !== "number") base.supplies = 0;
    if (typeof base.wallHp !== "number") base.wallHp = base.maxWallHp ?? 1200;
  }
  void now;
}

/**
 * FORWARD BASES — season rollover recall (design/forward-base.md §9).
 * The board wipes: every beachhead is abandoned, everything stationed is
 * lost. The home colony is untouched. The future season engine calls this
 * at rollover; plaques were already written by the battle layer.
 */
export function abandonForwardBasesForSeason(state: GameState, seasonId: string): number {
  ensureForwardBases(state, Date.now());
  const removed = abandonAllForwardBases(state.forwardBases!);
  if (removed.length > 0) {
    log(state, `Season ${seasonId}: ${removed.length} forward base${removed.length === 1 ? "" : "s"} abandoned — the board resets.`);
  }
  return removed.length;
}

export function effectiveScientists(state: GameState): number {
  return state.scientists;
}

export function expeditionSlots(state: GameState): number {
  return 1 + state.deployedDomains.logistics + (hasTech(state, "l4") ? 1 : 0); // l4 Relay Network +1 field slot
}
// (Slots modeled as: base 1 concurrent expedition; +1 per logistics level.)
export function maxConcurrentExpeditionsState(state: GameState): number {
  return 1 + state.deployedDomains.logistics + (hasTech(state, "l4") ? 1 : 0);
}

export function scientistCapacity(state: GameState): number {
  // Start 2, +1 per 2 logistics levels
  return 2 + Math.floor(state.deployedDomains.logistics / 2)
    + (hasTech(state, "l4") ? 1 : 0);
}

// ------- research tree & leaders (knowledge track) -------

/** Set of researched tech ids (fast membership checks). */
export function unlockedTechs(state: GameState): Set<string> {
  return new Set(state.techsResearched);
}
export function hasTech(state: GameState, id: string): boolean {
  return state.techsResearched.includes(id);
}

/** Number of research-tree nodes researched. */
export function techsResearchedCount(state: GameState): number {
  return state.techsResearched.length;
}

/** Is a tech currently being researched (in-progress) by any Leader? */
export function techInProgress(state: GameState, techId: string): boolean {
  return state.researchJobs.some((j) => j.techId === techId && j.status === "researching");
}

/** A tech is researchable when its predecessor in the same domain is done (or it's index 0). */
export function techAvailable(state: GameState, techId: string): boolean {
  const t = getTech(techId);
  if (state.techsResearched.includes(techId)) return false;
  if (t.index === 0) return true;
  const prev = techsByDomainOf(t.domain).find((x) => x.index === t.index - 1)!;
  return state.techsResearched.includes(prev.id);
}

function techsByDomainOf(domain: DomainId) {
  return TECH_TREE.filter((t) => t.domain === domain).sort((a, b) => a.index - b.index);
}

/** Does this Leader's specialty match the given tech's domain? */
export function specialtyAligns(leader: Leader, techId: string): boolean {
  return SPECIALTY_DOMAIN[leader.specialty] === getTech(techId).domain;
}

/** Research duration for a tech given the appointed Leader (specialty + research attr + Scholar path). */
export function researchDurationMs(state: GameState, techId: string, leader: Leader): number {
  const base = getTech(techId).durationMs;
  const aligned = specialtyAligns(leader, techId) ? 0.6 : 1.0; // matching specialty = faster
  const skill = 1 - leader.attributes.research * 0.04; // stronger researcher = faster
  const scholar = scholarResearchMult(leader); // −15% for a Scholar's projects
  // RE-TIME: the earned stack (specialty x attributes x Scholar x study speed) is
  // floored at MIN_TIMER_FRACTION of the base — no pile of earned bonuses can
  // collapse a timer. (Today's worst case is ~0.31 x base, so the floor is a
  // backstop, not a live clamp: retime-tests measures that headroom.)
  return timerFloor(base, base * aligned * skill * scholar * studySpeedMult(state));
}

/** 0-1 chance of a SURPRISE BREAKTHROUGH at completion (positive wildcard). */
export function breakthroughChance(_state: GameState, leader: Leader): number {
  // Aligned specialty → the good-twin wildcard fires far more often.
  // (Caller must only roll when aligned; this is the exposure for the UI.)
  // A Scholar's mandate adds +5% absolute chance.
  return 0.26 * scholarBreakthroughMult(leader);
}

/** Boost text shown in the tree for appointing a specialty-aligned Leader. */
export function specialtyBoostLine(leader: Leader): string {
  return `${SPECIALTY_LABEL[leader.specialty]} — boosts ${DOMAIN_SPECIALTY[SPECIALTY_DOMAIN[leader.specialty]]} research`;
}

/** Number of Leader slots (start 3, +1 from the Fleet Yards logistics tech). */
export function leaderSlots(state: GameState): number {
  return 3 + (hasTech(state, "l3") ? 1 : 0);
}

// ------- Leader XP / leveling / specialization (V3, earned-only) -------
//
// XP comes ONLY from real events a Leader was involved in (research completion,
// breakthroughs, surviving surprise encounters, deep runs) and is throttled by
// a colony-wide soft cap of 40 XP per UTC day. Nothing here is purchasable, and
// nothing gates progression behind spending — the Level-3 specialization (the
// strategic choice of the system) is offered purely on earned level.

/**
 * Core award primitive: add XP to one leader from a real event, applying the
 * per-leader daily window + the colony-wide shared day cap. Rolling windows mean
 * a stale/absent `day` behaves like "0 earned today" — pure and derivable.
 * Returns the amount actually granted (0 when the cap binds).
 */
function grantXpTo(state: GameState, leader: Leader, amount: number, source: string, now: number): number {
  if (amount <= 0) return 0;
  const today = xpDayKey(now);
  // Rolling per-leader window: yesterday's spend never leaks into today.
  if (leader.day !== today) {
    leader.day = today;
    leader.dayXp = 0;
  }
  const dayLeft = Math.max(0, DAILY_XP_CAP - leader.dayXp);
  if (dayLeft <= 0) {
    console.log(`[xp-cap] ${leader.name} hit the ${DAILY_XP_CAP} XP/day cap (${source}); no XP granted.`);
    log(state, `⏳ ${leader.name}'s ${DAILY_XP_CAP} XP/day cap binds — the ${source} earns no more XP today.`);
    return 0;
  }
  const sharedLeft = Math.max(0, DAILY_XP_CAP - (state.leaderXpCaps[today] ?? 0));
  const grant = Math.min(amount, Math.min(dayLeft, sharedLeft));
  if (grant <= 0) {
    console.log(`[xp-cap] Colony ${DAILY_XP_CAP} XP/day cap reached (${source}); no XP granted to ${leader.name}.`);
    return 0;
  }
  const before = leader.xp;
  leader.xp += grant;
  leader.dayXp += grant;
  state.leaderXpCaps[today] = (state.leaderXpCaps[today] ?? 0) + grant;
  const leveled = applyLevelUps(state, leader, now);
  log(
    state,
    `⭐ ${leader.name} ${source}: +${Math.round(grant)} XP${leveled ? " — LEVEL UP!" : ""}${dayLeft - grant < DAILY_XP_CAP * 0.01 ? ` (day cap ${Math.round(leader.dayXp)}/${DAILY_XP_CAP})` : ""}`,
  );
  if (leveled && before + grant >= xpForLevel(3) && before < xpForLevel(3)) {
    log(state, `🧭 ${leader.name} reaches Level 3 — a one-time path stands open: Scholar · Marshal · Quartermaster.`);
  }
  return grant;
}

/**
 * Apply level-ups earned by a new XP total: every level gained grants exactly 1
 * unspent attribute point. Level 3 additionally opens the one-time
 * specialization choice (kept pending until the player picks it).
 * Invariant: totalPointsGranted = level − 1, so granting the difference is
 * idempotent across saves, tick boundaries and multi-level jumps.
 * Returns true if at least one level-up fired.
 */
function applyLevelUps(state: GameState, leader: Leader, _now: number): boolean {
  const level = levelFromXp(leader.xp);
  const grantedSoFar = typeof leader.xpPointsGranted === "number" ? leader.xpPointsGranted : 0;
  const expected = Math.max(0, level - 1);
  const granted = Math.max(0, expected - grantedSoFar);
  if (granted > 0) {
    leader.xpPointsGranted = expected;
    leader.unspentPoints += granted;
    log(state, `📈 ${leader.name} reaches Level ${level} — +${granted} attribute point${granted > 1 ? "s" : ""} to allocate.`);
    return true;
  }
  return false;
}

/**
 * Public-ish helper used by the UI to compute a leader's current level.
 * Re-exported here so client code imports one engine namespace.
 */
export function leaderLevel(leader: Leader): number {
  return levelFromXp(typeof leader.xp === "number" ? leader.xp : 0);
}

/** Craft cost in supplies (i1 Auto-Forge −15%; a Quartermaster's watch −10%). */
export function craftCost(state: GameState, kind: CraftKind, now = Date.now()): number {
  advance(state, now);
  const def = CRAFT[kind];
  const autoForge = hasTech(state, "i1") ? 0.85 : 1;
  return Math.max(1, Math.round(def.supplies * autoForge * quartermasterCraftMult(state)));
}

/** Colony-wide Quartermaster crafting discount (any specialized Quartermaster's watch). */
export function quartermasterCraftMult(state: GameState): number {
  const quartermasters = state.leaders.filter((l) => l.specialization === "quartermaster" && l.status === "active");
  if (quartermasters.length === 0) return 1;
  return 0.9; // −10%
}

/** Colony-wide Marshal combat effectiveness (specialized Marshals). */
export function marshalCombatMult(state: GameState): number {
  const marshals = state.leaders.filter((l) => l.specialization === "marshal" && l.status === "active");
  if (marshals.length === 0) return 1;
  // +10% combat effectiveness, additive per specialization (cap +30%).
  return 1 + Math.min(0.3, marshals.length * 0.1);
}

/**
 * Colony-wide Marshal survival buff (+20% protection per specialized Marshal).
 *
 * DIRECTION (fixed 2026-09-26). Protection is "how much of a surprise the guards
 * absorb" — every severity term at the use site is written `(1 - protection)`, so
 * a HIGHER protection is always safer. This multiplier therefore has to be ≥ 1 to
 * mean "−20% surprise/survival severity"; the shipped formula was
 * `1 − 0.2 × marshals`, which multiplied protection DOWN and made specializing a
 * Marshal RAISE catastrophe odds (measured at full gear: severity 0.13 → 0.364,
 * clean recoveries 96.75% → 90.90%). One stat, one direction: more protection,
 * never less. The clamps at the use site keep a buffed colony at the same 1.0
 * ceiling it already had, so this can never exceed the protection a colony
 * without Marshals can reach.
 */
export function marshalProtectionMult(state: GameState): number {
  const marshals = state.leaders.filter((l) => l.specialization === "marshal" && l.status === "active");
  if (marshals.length === 0) return 1;
  return 1 + marshals.length * 0.2; // +20% protection per specialized marshal, additive
}

/** Colony-wide Quartermaster economy effectiveness (+10% ember yield & supplies). */
export function quartermasterEconomyMult(state: GameState): number {
  const quartermasters = state.leaders.filter((l) => l.specialization === "quartermaster" && l.status === "active");
  if (quartermasters.length === 0) return 1;
  return 1 + quartermasters.length * 0.1; // +10% per quartermaster, additive
}

/** Research-speed modifier for a specific Leader (15% per Scholar path). */
export function scholarResearchMult(leader: Leader): number {
  return leader.specialization === "scholar" ? 0.85 : 1; // shorter project times
}

/** Surprise-breakthrough chance modifier for a specific Leader (+5% Scholar). */
export function scholarBreakthroughMult(leader: Leader): number {
  return leader.specialization === "scholar" ? 1.05 : 1; // +5% absolute chance
}

/**
 * Grant XP to the leader who ran a completed research project. +10 XP on
 * completion, +25 XP bonus when a breakthrough fires (announced in the
 * Chronicle by the caller's messages). Returns the total XP granted.
 */
function researchXp(state: GameState, leader: Leader, breakthrough: boolean, now: number): number {
  let granted = 0;
  granted += grantXpTo(state, leader, 10, "researched a project", now);
  if (breakthrough) granted += grantXpTo(state, leader, 25, "earned a breakthrough", now);
  return granted;
}

function studySpeedMult(_state: GameState): number {
  return 1;
}

// ------- the hidden Unbound revelation track (V4) -------
//
// Silent purity counters, incremented only by player actions. The client never
// receives them (api.ts strips them from every payload). When the silent
// thresholds cross, a cryptic 3-node revelation chain unlocks with no clues,
// no hints, no explanation — exploration through doing.
//
// NOTE on `zeroCorruptionSurvivals`: the spec's literal post-resolve check
// (`corruption <= 0` after gains) is unreachable — every zone carries
// corruptionRisk >= 0.05, so every resolve adds corruption. The reachable
// analog, faithful to the "survived the dark at zero" intent: count clean
// recoveries launched while corruption sat at 0 (a pure colony staying pure).

/** Deep scientific sites for the track: the only places chipsets live. */
export const REVELATION_DEEP = 60;

/** Silent thresholds (stage3 follows the deep chain, checked at rv2 resolve). */
export const REVELATION_STAGE1_CLEAN = 12;
export const REVELATION_STAGE1_ZERO = 15;
export const REVELATION_STAGE2_DEEP = 6;
export const REVELATION_STAGE3_DEPTH = 5;
export const REVELATION_STAGE3_DEED_CODICES = 20;

// ---- Owner amendment (2026-09-05, §8): "acknowledged by the world" gate ----
// rv3 requires the colony to have been acknowledged ONCE for its contribution,
// in addition to the stage3 counters. In beta the acknowledgement is a modest
// contribution-score threshold (F8 policy a, lead-chosen 2026-09-05). The full
// one-per-server-per-cycle Contribution Award will later set this same flag.
export const ACKNOWLEDGED_SCORE = 100;

/**
 * A minimal server-side contribution score from the colony's real dent —
 * monotonic accumulators only (never spendable balances), so the score only
 * ever grows and crossing the threshold is permanent. Weighting: expeditions
 * are the engine; deeds are the recognized achievements; knowledge and tech
 * are the development the world watches. Purely derived from PUBLIC fields —
 * no new persisted state; the ack boolean latches once the score crosses.
 */
export function contributionScore(state: GameState): number {
  const exps = typeof state.completedExpeditions === "number" ? state.completedExpeditions : 0;
  const deeds = Array.isArray(state.deedsCompleted) ? state.deedsCompleted.length : 0;
  const codices = typeof state.totalCodicesEarned === "number" ? state.totalCodicesEarned : 0;
  const techs = Array.isArray(state.techsResearched) ? state.techsResearched.length : 0;
  return exps * 2 + deeds * 10 + codices + techs * 5;
}

// ---- Contribution leaderboard (beta world visibility) ----
// The recognition system going public (precursor to the per-server Contribution
// Award / Emissary "recognized are the leadership class" seats). PURE: derived
// from the SAME contributionScore() over already-public fields only — no new
// persisted state, and acknowledgedOnce / every revelation counter stay
// unreachable from this surface by construction (they are never read here).
// The member sheet reads the same public surface: cradle level (the five
// deployed-domain levels every visitor can see on the Cradle plate) and the
// score's four components. Rank order is deterministic: score desc, then "earliest achievement" — the
// colony founded EARLIEST wins the tie (a stable stand-in for first-to-the-dent
// without adding per-achievement timestamps; documented interpretation), then
// gameId asc as the final unambiguous break. A colony must have a race to rank
// (blank reset slots are not colonies).
export interface ContributionEntry {
  gameId: string;
  colonyName: string;
  race: RaceId | null;
  score: number;
  createdAt: number;
  /**
   * The colony's Cradle level: the sum of its five deployed-domain levels
   * (weaponry + agriculture + economy + industry + logistics) — the visible
   * advancement of the capital, public colony state, safe for the leaderboard.
   */
  cradleLevel: number;
  /**
   * The score's four components (the same public reads contributionScore()
   * makes) so the member sheet can show HOW the dent was made — never the
   * input echoed, never a guess.
   */
  expeditions: number;
  deeds: number;
  codices: number;
  techs: number;
}

export function contributionRanking(states: GameState[]): ContributionEntry[] {
  return states
    .filter(
      (st) => !!st && typeof st === "object" && !!st.race && !!st.gameId
    )
    .map((st) => {
      const d = st.deployedDomains;
      const cradleLevel =
        d && typeof d === "object"
          ? (typeof d.weaponry === "number" ? d.weaponry : 0) +
            (typeof d.agriculture === "number" ? d.agriculture : 0) +
            (typeof d.economy === "number" ? d.economy : 0) +
            (typeof d.industry === "number" ? d.industry : 0) +
            (typeof d.logistics === "number" ? d.logistics : 0)
          : 0;
      return {
        gameId: st.gameId!,
        colonyName: st.playerName || "Unnamed Colony",
        race: st.race,
        score: contributionScore(st),
        createdAt: typeof st.createdAt === "number" ? st.createdAt : 0,
        cradleLevel,
        expeditions: typeof st.completedExpeditions === "number" ? st.completedExpeditions : 0,
        deeds: Array.isArray(st.deedsCompleted) ? st.deedsCompleted.length : 0,
        codices: typeof st.totalCodicesEarned === "number" ? st.totalCodicesEarned : 0,
        techs: Array.isArray(st.techsResearched) ? st.techsResearched.length : 0,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
    });
}

export const REVELATION_FIRST_LINE =
  "The Chorus has stopped answering the signal. In the silence between its calls, a page turns somewhere in the Cradle — a page no machine wrote.";
export const REVELATION_RV1_LINE =
  "The page was written before the machines learned to write. It reads you back.";

/** Zero-value revelation counter block (new games; V4 migration target). */
export function freshRevelationCounters(): GameState["revelationCounters"] {
  return {
    cleanRecoveries: 0,
    zeroCorruptionSurvivals: 0,
    deepCleanLandings: 0,
    codicesEarnedByDeeds: 0,
    maxDomainDepth: 0,
    untouchedDayStreak: 0,
    cleanStreak: 0,
    lastCorruptionDay: undefined,
    lastStreakDay: undefined,
    oneTimeWildcardBiasUsed: false,
  };
}

/** Pure threshold read: does this colony's silent work cross stage1 / stage2? */
export function revelationThresholds(state: GameState): { stage1: boolean; stage2: boolean } {
  const c = state.revelationCounters;
  if (!c || typeof c !== "object") return { stage1: false, stage2: false };
  return {
    stage1: (c.cleanRecoveries ?? 0) >= REVELATION_STAGE1_CLEAN && (c.zeroCorruptionSurvivals ?? 0) >= REVELATION_STAGE1_ZERO,
    stage2: (c.deepCleanLandings ?? 0) >= REVELATION_STAGE2_DEEP,
  };
}

/** Stage3 (the deeper chain): domain depth + deeds Codices + an L3-specialized Leader. */
export function revelationStage3(state: GameState): boolean {
  const c = state.revelationCounters;
  if (!c || typeof c !== "object") return false;
  const deep = (c.maxDomainDepth ?? 0) >= REVELATION_STAGE3_DEPTH;
  const deeds = (c.codicesEarnedByDeeds ?? 0) >= REVELATION_STAGE3_DEED_CODICES;
  const mentor = state.leaders.some((l) => l.specialization === "scholar" || l.specialization === "marshal" || l.specialization === "quartermaster");
  return deep && deeds && mentor;
}

/** A revelation node id that has been RESOLVED (the researched set). */
export function hasRevelation(state: GameState, id: string): boolean {
  return Array.isArray(state.revelationsResolved) && state.revelationsResolved.includes(id);
}

/** Is a revelation node currently being studied by an appointed Leader? */
export function revelationInProgress(state: GameState, revId: string): boolean {
  return state.researchJobs.some((j) => j.techId === revId && j.status === "researching");
}

/**
 * Is a revelation node researchable right now — computable from PUBLIC state
 * alone (no raw counters): the server publishes the visible set, so rv1 is
 * researchable when visible; rv2 after rv1 resolves; rv3 after rv2 resolves
 * AND the silent stage3 holds (the server simply withholds rv3 visibility
 * until it does — a hidden gate inside a visible set).
 */
export function revelationAvailable(state: GameState, revId: string): boolean {
  if (hasRevelation(state, revId)) return false;
  const vis = Array.isArray(state.revelations) ? state.revelations : [];
  if (revId === "rv1") return vis.includes("rv1");
  if (revId === "rv2") return vis.includes("rv2");
  if (revId === "rv3") return vis.includes("rv3");
  return false;
}

/** The revelation ids the client may see (visibility only — resolved plus visible-available). */
export function visibleRevelations(state: GameState): string[] {
  if (typeof state.revelationFirstOpenAt !== "number") return [];
  const out: string[] = ["rv1"];
  if (hasRevelation(state, "rv1")) out.push("rv2");
  if (hasRevelation(state, "rv2") && revelationStage3(state) && state.acknowledgedOnce === true) out.push("rv3");
  return out.filter((id, i, a) => a.indexOf(id) === i);
}

/**
 * Keeps the published-visibility array (`state.revelations`) in exact sync with
 * the gate conditions: rv1 once stage1 fired; rv2 once rv1 is resolved; rv3
 * once rv2 is resolved AND stage3 holds AND the colony has been acknowledged
 * once by the world (owner §8). Idempotent — called at the end of every
 * advance(), so the client's next fetch sees rv3 the moment BOTH its gates
 * flip, even when rv2 resolved before stage3/acknowledgement were reached
 * (the normal order — stage3 grows with the AI path, rv2 resolves on the
 * soul path). This is the SINGLE source of truth for the visible set.
 */
export function reconcileRevelationVisibility(state: GameState) {
  if (typeof state.revelationFirstOpenAt !== "number") return;
  if (!Array.isArray(state.revelations)) state.revelations = [];
  const push = (id: string) => {
    if (!state.revelations.includes(id)) state.revelations.push(id);
  };
  push("rv1");
  if (hasRevelation(state, "rv1")) push("rv2");
  if (hasRevelation(state, "rv2") && revelationStage3(state) && state.acknowledgedOnce === true) push("rv3");
}

/** Revelation reward multipliers (silent; default = no effect on old saves). */
export function revelationCorruptionMult(state: GameState): number {
  return typeof state.revelationCorruptionGainMult === "number" ? state.revelationCorruptionGainMult : 1;
}
export function revelationDrainPerMin(state: GameState): number {
  return typeof state.revelationDrainPerMin === "number" ? state.revelationDrainPerMin : 0;
}
export function revelationChorusMult(state: GameState): number {
  return typeof state.revelationChorusMult === "number" ? state.revelationChorusMult : 1;
}

/**
 * Called once per corrupting event. A corrupting UTC day breaks the untouched
 * streak (once per day, idempotent within the day); a first-ever taint simply
 * starts the bookkeeping.
 */
function touchUntouchedStreak(state: GameState, now: number) {
  const c = state.revelationCounters;
  if (!c || typeof c !== "object") return;
  const today = xpDayKey(now);
  if (c.lastCorruptionDay !== today) {
    c.untouchedDayStreak = 0;
    c.lastCorruptionDay = today;
  }
}

/**
 * Called from advance() after the resolve loops: grows the untouched-day
 * streak by at most 1 per UTC day, only on days fully free of corruption gain.
 */
function growUntouchedStreak(state: GameState, now: number) {
  const c = state.revelationCounters;
  if (!c || typeof c !== "object") return;
  const today = xpDayKey(now);
  if (c.lastStreakDay === today) return; // already evaluated this day
  const wasCleanDay = c.lastCorruptionDay !== today;
  c.lastStreakDay = today;
  if (wasCleanDay) c.untouchedDayStreak += 1;
}

/**
 * Stage1 check — runs inside advance() after the resolve loop so the reveal
 * fires whether the player is online or off. Exactly-once per save via
 * revelationFirstOpenAt: writes ONE Chronicle line, makes rv1 visible, and —
 * per the locked spec — the rv1 research TRIGGER itself is what deepCleanLandings
 * has already been counting toward (stage2 gates nothing visible; it is the
 * chain's own proof-of-depth read at resolve time).
 */
function checkRevelationReveal(state: GameState, now: number) {
  if (typeof state.revelationFirstOpenAt === "number") return;
  if (!revelationThresholds(state).stage1) return;
  state.revelationFirstOpenAt = now;
  // rv1 visibility into the published set is reconciled at the end of advance()
  // (reconcileRevelationVisibility) — this beat only records the exact moment
  // and writes the ONE Chronicle line.
  log(state, REVELATION_FIRST_LINE);
}

/**
 * Owner §8 acknowledgement: once the colony's contribution score crosses the
 * beta threshold, it is acknowledged by the world — exactly once, permanently,
 * and in COMPLETE silence (no Chronicle line, no UI field; the client only
 * learns of it if/when rv3's availability changes). The future one-per-server
 * Contribution Award will set this same boolean.
 */
export function checkAcknowledgedOnce(state: GameState) {
  if (state.acknowledgedOnce === true) return;
  if (contributionScore(state) >= ACKNOWLEDGED_SCORE) {
    state.acknowledgedOnce = true;
  }
}

// ------- resistance helpers (apply research-tech effects) -------

/** Wildcard surprise-encounter chance per resolve (w1 Chorus-Sig Jammers). */
export function wildcardChance(state: GameState): number {
  return 0.25 * (hasTech(state, "w1") ? 0.75 : 1);
}
/**
 * One-shot benign bias from rv2 ("The Quiet Ledger"): the NEXT surprise
 * encounter shifts one severity step toward benign (lost→mauled→bumped→null),
 * then the flag consumes itself. Invisible in UI. Returns the shifted outcome
 * (null = the surprise dissolves entirely).
 */
export function applyRevelationBias(state: GameState, wc: "lost" | "mauled" | "bumped" | null): "lost" | "mauled" | "bumped" | null {
  const c = state.revelationCounters;
  if (wc === null || !c || c.oneTimeWildcardBiasUsed !== false) return wc;
  if (!hasRevelation(state, "rv2")) return wc;
  c.oneTimeWildcardBiasUsed = true;
  if (wc === "lost") return "mauled";
  if (wc === "mauled") return "bumped";
  return null;
}
/** Corruption gain multiplier on raids (w2 Traction Cannons). */
export function corruptionMult(state: GameState): number {
  return (hasTech(state, "w2") ? 0.75 : 1) * revelationCorruptionMult(state); // rv1 purity discount
}
/** Chorus attention gain multiplier (w4 Siege Shore Batteries). */
export function chorusMult(state: GameState): number {
  // w4 tech discount × the rv3 anti-Chorus preview (silent reward for walking
  // the soul path through the hunt). The hunt itself lands as slower decay
  // and hotter deep zones (see advance()), never as a gain multiplier.
  return (hasTech(state, "w4") ? 0.75 : 1) * revelationChorusMult(state);
}
/** Scientist attrition multiplier (a3 Triage Gardens). */
export function attritionMult(state: GameState): number {
  return hasTech(state, "a3") ? 0.6 : 1;
}
/**
 * THE Ember→supplies scrap rate (named for the valuation's V1). This is the rate
 * the engine ITSELF applies at the drop — `resolveExpedition` credits
 * `round(embers x suppliesScrapRate(state))` supplies — so a measurement that
 * prices an Ember in 📦 reads these three constants rather than retyping them.
 */
export const EMBER_SCRAP_RATE_BASE = 0.15;
export const EMBER_SCRAP_RATE_E1 = 0.3; // Trade Ledgers
export const EMBER_SCRAP_RATE_A2_BONUS = 0.14; // Seed Vaults: +60% on top of base scrap
/** Ember→supplies scrap rate (e1 Trade Ledgers + a2 Seed Vaults). */
export function suppliesScrapRate(state: GameState): number {
  let r = EMBER_SCRAP_RATE_BASE;
  if (hasTech(state, "e1")) r = EMBER_SCRAP_RATE_E1;
  if (hasTech(state, "a2")) r += EMBER_SCRAP_RATE_A2_BONUS;
  return r;
}
/** Ember yield multiplier (e2 Salvage Contracts). */
export function emberYieldMult(state: GameState): number {
  return hasTech(state, "e2") ? 1.08 : 1;
}

// ------- THE EMBER-YIELD MODEL, NAMED (the loot valuation's source) -------
//
// These factors are the whole of what `resolveExpedition` multiplies into a
// zone's `emberYield` (the random `variance` is the last one, and is the only
// term a measurement must neutralise to speak of a nominal run). They used to be
// bare literals inside the resolver, which meant "what the engine pays for a run"
// could only be quoted, never read: `game/valuation.ts` (V1–V12) imports THESE,
// and `resolveExpedition` below calls the same functions, so the module and the
// engine cannot drift apart. No value changed — only names were added.

/** Crew size is the biggest lever on a run's loot: 0.7 + 0.4 per scientist. */
export const SCIENTIST_YIELD_BASE = 0.7;
export const SCIENTIST_YIELD_PER = 0.4;
export function scientistYieldFactor(scientists: number): number {
  return SCIENTIST_YIELD_BASE + scientists * SCIENTIST_YIELD_PER;
}
/** Deployed economy domains (+6% each) with a Quartermaster mandate on top. */
export const ECONOMY_EMBER_BOOST_PER_LEVEL = 0.06;
export function economyEmberBoost(state: GameState): number {
  return (1 + (state.deployedDomains.economy ?? 0) * ECONOMY_EMBER_BOOST_PER_LEVEL) * quartermasterEconomyMult(state);
}
/** The +/-20% loot roll: 0.8 at roll 0, 1.2 at roll 1 (nominal = roll 0.5). */
export const LOOT_VARIANCE_MIN = 0.8;
export const LOOT_VARIANCE_MAX = 1.2;
export function lootVariance(roll: number = Math.random()): number {
  return LOOT_VARIANCE_MIN + roll * (LOOT_VARIANCE_MAX - LOOT_VARIANCE_MIN);
}
/** Corruption taints what a run brings home — a penalty, never a loss. */
export const CORRUPTION_YIELD_PENALTY_DIVISOR = 200;
export function corruptionYieldPenalty(state: GameState): number {
  return 1 - state.corruption / CORRUPTION_YIELD_PENALTY_DIVISOR;
}
/**
 * The engine's own NOMINAL ember yield for one run: every multiplier applied and
 * the variance EXCLUDED (it is the random term; its expectation is 1.0). Read by
 * `game/valuation.ts` and asserted against a real stubbed resolve in
 * `retime-tests`, so the valuation's loot column is engine-true, not a guess.
 */
export function emberYieldNominal(state: GameState, zone: Zone, scientists: number): number {
  const race = getRace(state.race!);
  return (
    zone.emberYield *
    scientistYieldFactor(scientists) *
    race.mods.emberGain *
    emberYieldMult(state) *
    economyEmberBoost(state) *
    corruptionYieldPenalty(state)
  );
}

/**
 * The two constants of a STUDY — the cheapest engine path to insight, which is
 * how the valuation prices a Chipset (V8). Named here so the lab's prices are
 * read, not retyped: an Ember study burns `STUDY_EMBER_COST` Embers, and the
 * Watchers' Academy grants `WATCHERS_STUDY_BOOST` on top of `insightFor`.
 */
export const STUDY_EMBER_COST = 2;
export const WATCHERS_STUDY_BOOST = 1.3;
/** The insight a completed study actually grants (boost applied, rounded) — the
 *  SAME number `advance()` credits and its Chronicle line prints. */
export function studyInsightGranted(state: GameState, kind: "ember" | "chipset"): number {
  return Math.round(insightFor(state, kind) * (state.race === "watchers" ? WATCHERS_STUDY_BOOST : 1));
}


// ------- resource math -------

export function suppliesCostForZone(state: GameState, zone: Zone): number {
  const race = getRace(state.race!);
  const base = 8 + zone.risk * 0.55;
  const industryDiscount = Math.pow(0.93, state.deployedDomains.industry); // cheaper with industry
  const priceIndex = hasTech(state, "e3") ? 0.9 : 1; // Price Index −10% expedition cost
  return Math.max(1, Math.round(base * race.mods.suppliesEfficiency * industryDiscount * priceIndex));
}

export function suppliesPerMinute(state: GameState): number {
  const race = getRace(state.race!);
  const base = race.mods.yieldSupply * 2;
  const agri = state.deployedDomains.agriculture * 3;
  const econ = state.deployedDomains.economy * 2;
  const agriTechs = (hasTech(state, "a1") ? 2 : 0) + (hasTech(state, "a4") ? 2 : 0); // Hydroponics + Terraced
  const econTech = hasTech(state, "e4") ? 1 : 0; // Market Hall
  // Quartermaster mandate: a colony with specialized Quartermasters runs leaner (+10% per
  // Quartermaster on the whole supplies line, applied to the final income).
  return (base + agri + econ + agriTechs + econTech) * quartermasterEconomyMult(state);
}

export function studyDurationMs(state: GameState, kind: "ember" | "chipset"): number {
  const race = getRace(state.race!);
  const base = kind === "ember" ? 40_000 : 90_000;
  return ms(base * race.mods.studySpeed);
}

export function insightFor(state: GameState, kind: "ember" | "chipset"): number {
  const race = getRace(state.race!);
  const base = kind === "ember" ? 18 : 70;
  const watcherBonus = state.race === "watchers" ? 1.4 : 1;
  const grayBonus = state.race === "grays" ? 1.2 : 1;
  return Math.round(base * watcherBonus * grayBonus * (race.mods.studySpeed > 1 ? 0.8 : 1));
}

export function deployCost(state: GameState, domain: DomainId): { embers: number; insight: number } {
  const level = state.deployedDomains[domain];
  // Weaponry and logistics cost more with growth; all scale up.
  const baseEmbers = domain === "weaponry" || domain === "logistics" ? 20 : 12;
  const baseInsight = domain === "weaponry" || domain === "logistics" ? 50 : 40;
  const ordnance = domain === "weaponry" && hasTech(state, "w3") ? 0.7 : 1; // Ordnance Works −30%
  return {
    embers: Math.round(baseEmbers * (1 + level) * 1.1 * ordnance),
    insight: Math.round(baseInsight * (1 + level) * ordnance),
  };
}

/**
 * Is this domain already at the ladder's top rung (MAX_DOMAIN_LEVEL)?
 * The ONE rule both the server (`deployProgram`) and the client
 * (`engineHelpers.domainAffordable`) read, so the button can never offer an
 * advance the server would refuse — and the server can never grant one silently.
 */
export function domainAtMaxLevel(state: GameState, domain: DomainId): boolean {
  return (state.deployedDomains[domain] ?? 0) >= MAX_DOMAIN_LEVEL;
}

// ------- time advancement -------

/** Brings legacy saves up to the radiation-era resource shape (idempotent). */
function ensureResources(state: GameState) {
  const r = state.resources as unknown as Record<string, unknown>;
  if (typeof r.hazmat !== "number") r.hazmat = 0;
  if (typeof r.shots !== "number") r.shots = 0;
  if (typeof r.alloys !== "number") r.alloys = 0;
  if (typeof r.medkit !== "number") r.medkit = 0;
  if (typeof r.mechkit !== "number") r.mechkit = 0;
  if (typeof r.armorkit !== "number") r.armorkit = 0;
  if (typeof r.skmech !== "number") r.skmech = 0;
  if (typeof r.gas !== "number") r.gas = 0;
  if (typeof r.battery !== "number") r.battery = 0;
  if (!r.mats || typeof r.mats !== "object") r.mats = { grays: 0, nephilim: 0, draconians: 0, anunnaki: 0, ashtar: 0, watchers: 0 };
  const mats = r.mats as Record<string, unknown>;
  for (const rid of ALL_RACE_IDS) if (typeof mats[rid] !== "number") mats[rid] = 0;
  // V6: condensed high-energy plasma (weapons-system §2) — zero on legacy saves.
  if (typeof r.plasma !== "number" || !isFinite(r.plasma as number) || (r.plasma as number) < 0) r.plasma = 0;
  // THE FORGE's ingredient: a legacy save starts with an empty crucible.
  if (typeof r.warplate !== "number" || !isFinite(r.warplate as number) || (r.warplate as number) < 0) r.warplate = 0;
  // Owner order 2026-10-01: every colony starts out with 10,000 supplies.
  // Pre-change saves get a ONE-TIME top-up to the founding stockpile the
  // next time they advance (idempotent via the flag; blank wiped colonies
  // with no race yet are skipped — they'll be born fresh via newGame).
  const s = state as unknown as Record<string, unknown>;
  if (
    state.raceLocked &&
    typeof r.supplies === "number" &&
    (r.supplies as number) < STARTING_SUPPLIES &&
    s.startingSuppliesGranted !== true
  ) {
    r.supplies = STARTING_SUPPLIES;
    s.startingSuppliesGranted = true;
    log(state, `📦 The Cradle issues a founding stockpile: ${STARTING_SUPPLIES.toLocaleString()} supplies. Get moving — the Shatterlands won't explore itself.`);
  }
}

/** Brings legacy saves up to the research-tree / leaders / codices shape. */
function ensureKnowledge(state: GameState) {
  const s = state as unknown as Record<string, unknown>;
  if (typeof s.codices !== "number") s.codices = 0;
  if (typeof s.totalCodicesEarned !== "number") s.totalCodicesEarned = 0;
  if (!Array.isArray(s.techsResearched)) s.techsResearched = [];
  if (!Array.isArray(s.researchJobs)) s.researchJobs = [];
  if (!Array.isArray(s.deedsCompleted)) s.deedsCompleted = [];
  if (typeof s.totalBreakthroughs !== "number") s.totalBreakthroughs = 0;
  if (!Array.isArray(state.leaders) || state.leaders.length === 0) {
    state.leaders = starterLeaders(Date.now());
  }
  // ---- Orbital Watch (design/satellites.md) ----
  // Legacy saves predate the sky: roll the constellation for the current
  // season. ensureSatellites (in advance()) keeps this true forever after.
  if (typeof s.seasonId !== "string") s.seasonId = MONETIZATION_CONFIG.season0Id;
  if (typeof s.satellites !== "object" || s.satellites === null) {
    s.satellites = freshSatellites(WORLD_CONFIG_PUBLIC.worldId, s.seasonId as string);
  }
  // ---- Leader XP / leveling / specialization (V3) ----
  // Idempotent per-leader defaults: missing fields behave like "level 1, no XP
  // earned today, no specialization, no unspent points" — old saves load clean.
  ensureLeaderXp(state);
}

/** V3 migration: XP fields on leaders + the colony-wide day-cap ledger. */
function ensureLeaderXp(state: GameState) {
  if (!state.leaderXpCaps || typeof state.leaderXpCaps !== "object") {
    state.leaderXpCaps = {} as Record<string, number>;
  }
  const now = Date.now();
  const today = xpDayKey(now);
  for (const l of state.leaders) {
    const L = l as unknown as Record<string, unknown>;
    if (typeof L.xp !== "number") L.xp = 0;
    if (typeof L.unspentPoints !== "number") L.unspentPoints = 0;
    if (typeof L.xpPointsGranted !== "number") L.xpPointsGranted = 0;
    // V10 rename migration: legacy saves that picked the L3 economy path as
    // "steward" move silently to "quartermaster" (same niche, same numbers).
    if (L.specialization === "steward") L.specialization = "quartermaster";
    if (typeof L.specialization !== "string" && L.specialization !== null && L.specialization !== undefined) {
      // garbage guard: only known paths (quartermaster = renamed steward)
      if (L.specialization !== "scholar" && L.specialization !== "marshal" && L.specialization !== "quartermaster") {
        L.specialization = null;
      }
    }
    if (L.specialization === undefined) L.specialization = null;
    // Rolling day-window: a stale/absent window simply means "0 spent today".
    if (typeof L.day !== "string" || L.day !== today) {
      L.day = today;
      L.dayXp = 0;
    }
    if (typeof L.dayXp !== "number") L.dayXp = 0;
  }
}

/**
 * V4 migration: the hidden revelation track. Old saves get a zeroed counter
 * block, an empty resolved list, no hunt, and neutral reward multipliers —
 * advancing an old save behaves exactly as before. Idempotent.
 */
function ensureRevelation(state: GameState) {
  const s = state as unknown as Record<string, unknown>;
  if (!state.revelationCounters || typeof state.revelationCounters !== "object") {
    state.revelationCounters = freshRevelationCounters();
  } else {
    const c = state.revelationCounters as unknown as Record<string, unknown>;
    if (typeof c.cleanRecoveries !== "number") c.cleanRecoveries = 0;
    if (typeof c.zeroCorruptionSurvivals !== "number") c.zeroCorruptionSurvivals = 0;
    if (typeof c.deepCleanLandings !== "number") c.deepCleanLandings = 0;
    if (typeof c.codicesEarnedByDeeds !== "number") c.codicesEarnedByDeeds = 0;
    if (typeof c.maxDomainDepth !== "number") c.maxDomainDepth = 0;
    if (typeof c.untouchedDayStreak !== "number") c.untouchedDayStreak = 0;
    if (typeof c.cleanStreak !== "number") c.cleanStreak = 0;
    if (typeof c.oneTimeWildcardBiasUsed !== "boolean") c.oneTimeWildcardBiasUsed = false;
  }
  if (!Array.isArray(state.revelations)) state.revelations = [];
  if (!Array.isArray(state.revelationsResolved)) state.revelationsResolved = [];
  if (typeof state.revelationHunts !== "boolean") state.revelationHunts = false;
  if (state.revelationChoice !== "sealed" && state.revelationChoice !== "open") {
    state.revelationChoice = (s.revelationChoice as "sealed" | "open" | null | undefined) ?? null;
    if (state.revelationChoice !== "sealed" && state.revelationChoice !== "open") state.revelationChoice = null;
  }
  if (typeof state.revelationCorruptionGainMult !== "number") state.revelationCorruptionGainMult = 1;
  if (typeof state.revelationDrainPerMin !== "number") state.revelationDrainPerMin = 0;
  if (typeof state.revelationChorusMult !== "number") state.revelationChorusMult = 1;
  if (typeof state.acknowledgedOnce !== "boolean") state.acknowledgedOnce = false;
}

/**
 * V6 migration: the colony-side Armory. Legacy saves get an empty armory
 * (no family built), no in-flight builds, a zero weaponsBuilt counter, and a
 * zeroed plasma pool (ensureResources covers the pool). Idempotent: entries
 * that already exist are left alone, tiers are clamped to 0..4, build records
 * with a sane shape are preserved (they keep resolving offline as designed).
 * The armory is keyed by the 5 role family ids; unknown rows are tolerated
 * (other races' catalogs arrive as data, never as state surgery).
 */
function ensureArmory(state: GameState) {
  if (!state.armory || typeof state.armory !== "object") state.armory = {};
  if (!state.armoryBuilds || typeof state.armoryBuilds !== "object") state.armoryBuilds = {};
  if (typeof state.weaponsBuilt !== "number" || !isFinite(state.weaponsBuilt) || state.weaponsBuilt < 0) {
    state.weaponsBuilt = 0;
  }
  for (const [fam, row] of Object.entries(state.armory)) {
    const r = row as unknown as Record<string, unknown>;
    if (!r || typeof r !== "object") { delete state.armory[fam]; continue; }
    const tier = Math.max(0, Math.min(4, Math.trunc(typeof r.tier === "number" ? r.tier : 0)));
    state.armory[fam] = { tier: tier as 0 | 1 | 2 | 3 | 4, everBuilt: r.everBuilt === true };
  }
  for (const [fam, b] of Object.entries(state.armoryBuilds)) {
    const rec = b as unknown as Record<string, unknown>;
    if (!rec || typeof rec !== "object" || typeof rec.startedAt !== "number" || typeof rec.doneAt !== "number") {
      delete state.armoryBuilds[fam];
      continue;
    }
    const target = Math.max(1, Math.min(4, Math.trunc(typeof rec.targetTier === "number" ? rec.targetTier : 1)));
    // TIME TOKENS (owner 2026-09-27): the earned compression this build carries is
    // part of the record — the shape check keeps it rather than dropping it, or a
    // re-login would hand the player back the time they spent a token on.
    const tokenMs = typeof rec.timeTokenMs === "number" && isFinite(rec.timeTokenMs) && rec.timeTokenMs > 0
      ? Math.floor(rec.timeTokenMs)
      : undefined;
    state.armoryBuilds[fam] = { targetTier: target as 1 | 2 | 3 | 4, startedAt: rec.startedAt, doneAt: rec.doneAt, timeTokenMs: tokenMs };
  }
}

/**
 * THE FORGE's migration (owner 2026-09-26).
 *
 * Legacy saves get empty racks, no recorded roll requests, a zero sequence and
 * a zero melt counter. Idempotent, and — the point — a row is SHAPE-CHECKED,
 * never regenerated: an item's rolled numbers are never recomputed, because
 * materializing them is exactly what makes a roll un-rerollable. Rows that are
 * not objects, or that carry no identity (the thing trade and plunder move),
 * are dropped.
 */
function ensureForge(state: GameState) {
  if (!Array.isArray(state.forgeItems)) state.forgeItems = [];
  state.forgeItems = state.forgeItems.filter((it) => !!it && typeof it === "object" && typeof it.id === "string");
  for (const it of state.forgeItems) {
    if (typeof it.power !== "number" || !isFinite(it.power)) it.power = 0;
    if (typeof it.locationSince !== "number") it.locationSince = it.provenance?.rolledAt ?? 0;
    if (it.location !== "cradle" && it.location !== "transit" && it.location !== "field") it.location = "cradle";
    if (it.location !== "transit") it.transit = undefined;
    if (!it.ownerName) it.ownerName = state.playerName;
    if (typeof it.ownerId !== "string") it.ownerId = "";
    // LOADOUT (2026-09-30): old saves predate equippedBy — everything starts
    // on the racks. Validate the shape; anything malformed is unequipped.
    const eb = (it as { equippedBy?: unknown }).equippedBy;
    if (
      !eb || typeof eb !== "object" ||
      ((eb as { kind?: unknown }).kind !== "hero" && (eb as { kind?: unknown }).kind !== "leader") ||
      typeof (eb as { id?: unknown }).id !== "string" ||
      !["weapon", "armor", "module1", "module2", "relic"].includes((eb as { slot?: unknown }).slot as string)
    ) {
      it.equippedBy = null;
    }
  }
  if (!state.forgeRolls || typeof state.forgeRolls !== "object") state.forgeRolls = {};
  if (typeof state.forgeSeq !== "number" || !isFinite(state.forgeSeq) || state.forgeSeq < 0) state.forgeSeq = 0;
  if (typeof state.forgeMelts !== "number" || !isFinite(state.forgeMelts) || state.forgeMelts < 0) state.forgeMelts = 0;
}
/** A supply run that has ARRIVED: in transit → the field (or back to the racks).
 *  Lazy and idempotent, like every other resolver in advance(): the transit
 *  record is consumed on arrival, so an offline world resolves on the next read
 *  and a double-tick cannot double-resolve. */
export function resolveForgeTransit(state: GameState, now: number) {
  for (const it of state.forgeItems ?? []) {
    if (it.location !== "transit" || !it.transit) continue;
    if (now < it.transit.arriveAt) continue;
    it.location = it.transit.to;
    it.locationSince = it.transit.arriveAt;
    it.transit = undefined;
  }
}

export function advance(state: GameState, now = Date.now()): GameState {
  ensureResources(state);
  ensureKnowledge(state);
  ensureRevelation(state);
  ensureMonetization(state);
  ensureStoreOffers(state); // STORE OFFERS (owner 2026-10-12): held extraction contracts + expedites, daily-special claims (additive)
  ensureArmory(state);
  ensureForge(state);
  ensureDaily(state);
  ensureTimeTokens(state); // EARNED time tokens: zero holdings + empty ledger on an
  //                          old save (the owner's 2026-09-27 direction; earned only)
  ensureBattles(state); // V9: real-time battle entities + report ledger (no-op on new saves)
  ensureMemorials(state); // Battle plaques (owner 2026-09-30): backfilled empty, never wiped
  ensureTroops(state, now); // MUSTER: garrison + queues + hunger clock (additive on old saves)
  ensureForwardBases(state, now); // BEACHHEADS: forward bases + shared server band pools (additive)
  ensureAlliances(state); // WAR BAND: alliance store + help budget + reinforcements (additive; never wiped by seasons)
  ensureRallies(state); // RALLIES: rally board (additive)
  ensureArena(state); // ARENA: challenges + bout ledger (additive)
  ensurePrologue(state); // V11: prologue ledger (additive backfill on pre-V11 saves)
  ensureSatellites(state, (m) => log(state, m)); // ORBITAL WATCH: constellation init + season re-roll
  ensureWorldMap(state, now); // WORLD MAP: abandonment tracking + scout probes + ships (additive)
  colonyNodeId(state); // every colony stands on a node (backfills old saves)
  const firedAlarm = sweepRaidAlarms(state, now); // SATELLITE KLAXON: incoming raids on watched nodes
  if (firedAlarm) broadcastRaidAlarm(state, firedAlarm); // alliance-wide: the whole war band hears it
  ensureReTime(state, now); // RE-TIME: energy pool + deploy slot (no-op on a fresh save)
  // V7 daily rollover: when the UTC day turned since the last advance, finalize
  // yesterday (streak exactly-once + TD3 banked-forever claims), roll the fresh
  // list, and mark visit_cradle's free tick. Runs BEFORE the resolve loops so
  // today's events credit TODAY's list. Idempotent (no-ops same-day).
  reconcileDaily(state, now);
  // Reconcile level-up points against derived levels: robust even if XP ever
  // changed outside grantXpTo (defensive; idempotent, logs only when granting).
  for (const l of state.leaders) applyLevelUps(state, l, now);
  // Deed sweeps (monetization §2.2): deterministic per-colony deeds evaluate
  // here exactly once — D4 (research completions ≥ N) and D5 (a Leader at L5
  // with a specialization chosen). D1 fires in resolveExpedition; D2/D3/D6/D7
  // fire when their systems land (server-first tracking, purity, devotion,
  // contribution award) via the same awardDeedCosmetic seam.
  if (state.techsResearched.length >= MONETIZATION_CONFIG.d4ResearchCompletions) {
    awardDeedCosmetic(state, "deed_tier3_research", now);
  }
  if (state.leaders.some((l) => l.status === "active" && levelFromXp(l.xp) >= 5 && l.specialization !== null)) {
    awardDeedCosmetic(state, "deed_l5_specialized", now);
  }
  if (state.lastTick >= now) {
    state.lastTick = now;
    // RE-TIME migration still has to run on a same-tick advance: it is once-only
    // and reads only what the resolvers above have already left behind.
    migrateTimersToReTime(state, now);
    return state;
  }
  const elapsedMs = now - state.lastTick;

  // Passive supplies income (colony grows while you're away). A blank/reset
  // slot (race null, pending re-founding) has no race economy — it accrues
  // nothing and advances quietly (defensive: old code crashed here on blanks
  // after the first tick; caught by the V7 daily suite's blank-safety tests).
  const supplyGain = state.race ? (suppliesPerMinute(state) / 60000) * elapsedMs : 0;
  state.resources.supplies += supplyGain;

  // RE-TIME: the expedition energy pool tops up continuously (charges/day),
  // lazy and idempotent like every other clock in the engine.
  regenEnergy(state, now);

  // Slow natural clearing of taint & attention (a healthy colony purges slowly).
  // rv1's soul-path drain (+0.5/min) is additive to the passive clearRate.
  // revelationHunts slows the Chorus's natural decay by 50% (0.3 → 0.15/min):
  // the hive fears what it cannot corrupt, and watches it longer.
  const clearRate = (state.race === "ashtar" ? 1.5 : 0.6) / 60000;
  const soulDrain = revelationDrainPerMin(state) / 60000;
  state.corruption = clamp(state.corruption - (clearRate + soulDrain) * elapsedMs, 0, 100);
  const attentionDecay = (state.revelationHunts ? 0.15 : 0.3) / 60000;
  state.chorusAttention = clamp(state.chorusAttention - attentionDecay * elapsedMs, 0, 100);

  // Resolve completed studies.
  for (const s of state.studies) {
    if (s.status === "studying" && now - s.startedAt >= s.durationMs) {
      s.status = "complete";
      const gained = studyInsightGranted(state, s.kind);
      state.insight += gained;
      const prog = state.race === "watchers" ? "A taint lingers in the Academy's lesson. " : "";
      log(state, `${prog}A scientist finished studying ${s.kind === "ember" ? "an Ember" : "a Chipset"}. Knowledge distilled — insight +${gained}.`);
    }
  }

  // Resolve completed research projects (Leader-appointed).
  for (const j of state.researchJobs) {
    // TIME TOKENS: `timeTokenMs` is the earned time taken off this run; the job's
    // own `durationMs` stays its base, so the floor never drifts.
    if (j.status === "researching" && now + (j.timeTokenMs ?? 0) - j.startedAt >= j.durationMs) {
      resolveResearch(state, j, now);
    }
  }

  // Resolve completed expeditions.
  for (const e of state.expeditions) {
    if (e.status === "out" && now - e.startedAt >= e.durationMs) {
      resolveExpedition(state, e, now);
    }
  }

  // Resolve a finished domain deployment (RE-TIME: `deployProgram` runs on a
  // timer — the level moves HERE, never in the action).
  resolveProgramDeploy(state, now);

  // Resolve completed weapon builds (V6) — same lazy, idempotent reconcile as
  // expeditions: built AT THE CRADLE while the world was offline. The deed
  // dents fire here exactly once (build records are consumed on completion).
  resolveArmoryBuilds(state, now);
  // Resolve completed ship builds (alliance ship factory + solo scouts) — same
  // lazy, idempotent reconcile: builds whose doneAt passed move to the fleet.
  resolveShipBuilds(state, now);
  // RAIDS: advance in_transit → landed (warn + battle) → returning → done.
  // Same lazy, idempotent discipline — offline worlds resolve on next read.
  advanceRaids(state, now);
  // SUB COLONIES: setting_up → sub_colony after the 24h setup. Same lazy,
  // idempotent discipline — offline worlds resolve on next read.
  resolveSubColoniesPure(state, now);
  // SUB COLONY MUSTER: resolve finished troop builds at active sub colonies
  // (2x speed — owner 2026-10-03).
  resolveSubColonyMustersPure(state, now);
  // SUB COLONY UPKEEP MAIL: warn once per cycle when a sub colony's
  // 1,000-supply shipment is overdue (owner 2026-10-03).
  mailOverdueUpkeepPure(state, now);
  // SUB COLONY STARVATION: 48h past the upkeep deadline with no shipment →
  // the sub colony collapses back to a husk (owner 2026-10-03).
  resolveStarvedSubColoniesPure(state, now);
  // Resolve arrivals of Forge supply runs (the ~24h transit — lazy, idempotent).
  resolveForgeTransit(state, now);

  // Resolve completed battles (V9, the real-time battle engine — battle-side
  // §15): every active battle whose wall-clock end has passed is finalized
  // here (result, Chronicle line, append-only ledger report). Same lazy,
  // idempotent discipline as every other resolver — offline worlds resolve
  // on the next read; resolved battles are skipped so double-ticks can never
  // double-report. DETERMINISTIC: no Math.random in win/loss/power (the
  // strength formula reads only the §15 B4 snapshot inputs).
  advanceBattles(state, now);

  // ROSTER COMMIT (war/roster-commit.ts): battles that stamped real-roster
  // commitments now pay them — the stamped casualty fraction comes out of
  // actual cohorts (newest-first) and lands in the memorial feed. Idempotent
  // per battle; no-op until a creator stamps a commit.
  resolveRosterCasualties(state);
  // ARENA (war/arena.ts): sweep stale challenges (locks release) and record
  // resolved arena bouts — the bout ledger feeds the public ladder; the
  // `arena-result` fx tells the guest's save. Runs AFTER
  // resolveRosterCasualties so stakes-mode bodies are already billed.
  expireArenaChallenges(state, now);
  resolveArenaBattles(state, now, (fx) => queueAllianceFx(state, fx));
  // DUELS (war/duels.ts): sweep stale duel proposals (every escrow returns
  // to its owner) and resolve finished duel battles — winner takes the whole
  // pot, draws return every escrow. The `duel-result` fx settles the guest.
  // Runs AFTER resolveRosterCasualties like the arena (duels are bloodless,
  // but the ordering keeps both ledgers consistent).
  expireDuels(state, now);
  resolveDuelBattles(state, now, (fx) => queueAllianceFx(state, fx));
  // RALLIES (war/rallies.ts): fire rally timers whose moment came (the pool
  // marches even if the caller's away) and resolve launched rallies whose
  // battles finished — contribution-locked loot, per-colony loss ledger.
  // Runs AFTER resolveRosterCasualties so the segments are already billed.
  advanceRallies(state, now);
  // HERO EARN ENGINE (hero-earn.ts; heroes-design-brief §3/§4): with every
  // battle resolver above done, fold each newly resolved battle's facts
  // into the deed ledger — participating heroes earn the published
  // HERO_XP_SOURCES, deed completions latch (single-hero pools grant on
  // the spot), and the commanding leader's battle XP comes back as grant
  // intents applied HERE through grantXpTo, so the 40/day cap, the
  // level-up invariant and the Chronicle line stay single-sourced in the
  // engine. Idempotent per battle id; the threshold pass inside also
  // latches contribution/codex deeds that ripened outside battle.
  const heroEarn = processHeroEarn(state, now, { contributionScore: contributionScore(state) });
  for (const grant of heroEarn.leaderGrants) {
    const leader = state.leaders.find((l) => l.id === grant.leaderId);
    if (leader) grantXpTo(state, leader, grant.amount, grant.source, now);
  }
  // THE MUSTER (design/muster-troops.md): resolve finished muster orders,
  // charge upkeep from the supply stockpile, run the hunger clock
  // (grace → desertion → mercenary bands). Lazy and idempotent like every
  // other resolver — offline garrisons eat, starve, and desert on the next
  // read. NOTE: the battle→roster casualty wiring lives in
  // war/roster-commit.ts — resolveRosterCasualties(state) runs right after
  // advanceBattles() above; battles don't draw from the roster until their
  // creator stamps a RosterCommit (Act I does; the Chorus never does).
  if (state.troops) {
    // Stationed allied guests eat from the host's stockpile and desert
    // BEFORE host troops (alliances.md §7). Their mirrors shrink here; the
    // senders' locks release through the seam (idempotent per tick).
    const tick = advanceTroopHome(state.troops.home, now, state.resources, {
      sourceColony: state.playerName || "An unnamed colony",
      serverId: state.gameId ?? "0",
      guests: guestsAt(state).map((m) => ({ id: m.id, weight: m.weight, troopsByType: m.troopsByType })),
      onGuestDesertion: (deserted) => {
        for (const s of shrinkGuestMirrors(state, deserted)) {
          if (s.desertedWeight <= 0) continue;
          queueAllianceFx(state, {
            kind: "release-troop-lock",
            colonyId: s.fromColonyId,
            reinforcementId: s.id,
            weight: s.desertedWeight,
            key: `unmirror:${s.id}:deserted:${now}`,
            mark: s.gone ? "deserted" : undefined,
          });
        }
      },
    });
    for (const band of tick.bands) state.troops.bands.push(band);
    for (const line of tick.log) log(state, line);
  }

  // FORWARD BASES (design/forward-base.md §5): each beachhead advances its
  // own TroopHome off its RAIDED stockpile — the same hunger math, foreign
  // soil. Deserters land in the SHARED server pool (serverBands), not in any
  // colony's private list: starving a beachhead stocks the enemy's
  // recruitment pool. Lazy and idempotent like the muster tick above.
  if (state.forwardBases && state.serverBands) {
    const colonyName = state.playerName || "An unnamed colony";
    for (const base of Object.values(state.forwardBases)) {
      const btick = advanceForwardBase(base, now, { sourceColony: colonyName });
      depositBands(state.serverBands, btick.bands);
      for (const line of btick.log) log(state, `[${base.label}] ${line}`);
    }
  }

  // Silent track bookkeeping: the untouched-day streak, the stage1 reveal, the
  // §8 world-acknowledgement, and the published-visibility reconcile. All four
  // run whether the player is online or off (lazy, inside advance).
  growUntouchedStreak(state, now);
  checkRevelationReveal(state, now);
  checkAcknowledgedOnce(state);
  reconcileRevelationVisibility(state);
  // V7 daily completion sweep: fires the season-pass "daily_list" event the
  // day the list completes (offline-safe — resolves land in advance too) and
  // wires the D6 Wheel-of-Years deed at a 30-day streak. Same-day no-op.
  sweepDaily(state, now);

  // Advance corruption / chorus only slowly over time in idle? No — keep them event-driven.
  // THE RE-TIME MIGRATION runs LAST, after every resolver: a run that was
  // already complete in the OLD scale has resolved above and is gone, so the
  // re-base can only ever touch a run that was still running (spec §7 step 1).
  migrateTimersToReTime(state, now);
  state.lastTick = now;
  return state;
}

/** Award Codices for a deed (one-time), logging it. */
function awardDeed(state: GameState, deed: string, codices: number, note: string) {
  if (state.deedsCompleted.includes(deed)) return;
  state.deedsCompleted.push(deed);
  state.codices += codices;
  state.totalCodicesEarned += codices;
  // The deeds stream is the "earned, not looted" signature the soul path reads.
  const c = state.revelationCounters;
  if (c && typeof c === "object") c.codicesEarnedByDeeds += codices;
  log(state, `🔖 Deed won: ${note} 📜 Codices +${codices} (earned, never looted).`);
}

/** Rescues a Scholar/Legend into the roster when a slot is free (deeds/rescue). */
function maybeRecruit(state: GameState) {
  if (state.leaders.some((l) => l.id === "ld-aran")) return;
  if (state.leaders.length >= leaderSlots(state)) return;
  const newcomer = rescueLeader(Date.now());
  state.leaders.push(newcomer);
  log(state, `🫂 A scholar is rescued from the ruins — ${newcomer.name} (${SPECIALTY_LABEL[newcomer.specialty]}) joins your Councillors.`);
}

// Resolve a completed research project: unlock the tech, free the Leader, and
// roll the SURPRISE BREAKTHROUGH if the appointed Leader's specialty aligned.
// Revelation jobs (rv1/rv2/rv3) resolve through this same path with their own
// payoffs (see resolveRevelation) — no breakthrough rolls on the soul path.
function resolveResearch(state: GameState, j: ResearchJob, now: number) {
  j.status = "complete";
  if (isRevelationId(j.techId)) {
    resolveRevelation(state, j, now);
    return;
  }
  if (isArmoryTech(j.techId)) {
    resolveArmoryTech(state, j, now);
    return;
  }
  if (isMusterTech(j.techId)) {
    resolveMusterTech(state, j, now);
    return;
  }
  if (isSatelliteTech(j.techId)) {
    resolveSatelliteTech(state, j, now);
    return;
  }
  if (isScoutProbeTech(j.techId)) {
    resolveScoutProbeTech(state, j, now);
    return;
  }
  const tech = getTech(j.techId);
  const leader = state.leaders.find((l) => l.id === j.leaderId)!;
  if (leader) {
    leader.assignment = null;
    leader.history.push(`Researched ${tech.name} (${tech.domain})`);
  }
  if (!state.techsResearched.includes(tech.id)) {
    state.techsResearched.push(tech.id);
  }
  log(state, `🔬 ${leader ? leader.name : "A leader"} completed research: ${tech.icon} ${tech.name}. ${tech.effect}.`);

  // Breakthrough — the positive twin of the wildcard. Only fires when the
  // appointed Leader's specialty aligns with the project (a Scholar adds +5%
  // absolute via breakthroughChance). Announced in the Chronicle.
  const aligned = leader && specialtyAligns(leader, tech.id);
  const broke = aligned && coin(breakthroughChance(state, leader));
  if (broke) {
    state.totalBreakthroughs += 1;
    if (leader) leader.breakthroughs += 1;
    // Breakthrough payoff: Codices returned + a domain-specific gift.
    const codexBack = Math.max(1, Math.floor(tech.codicesCost / 3));
    state.codices += codexBack;
    state.totalCodicesEarned += codexBack;
    const extra = breakthroughPayload(state, tech.domain);
    if (leader) leader.history.push(`Breakthrough on ${tech.name}`);
    log(state, `✨ BREAKTHROUGH — ${leader ? leader.name : "A leader"}'s ${SPECIALTY_LABEL[leader!.specialty]} insight turned ${tech.name} around: 📜 +${codexBack} Codices, ${extra.msg}.`);
  }
  if (leader) researchXp(state, leader, broke, now);
  // Season 0 pass: `complete_research` is RETIRED here by the re-time (owner
  // 2026-09-26). Under the ratified ladder a project runs for hours to days, so
  // an objective that requires COMPLETING one is unachievable inside a season
  // and silently re-prices the whole pass. The standing rule (monetization.ts,
  // asserted by retime-tests): **no season objective may require completing a
  // timed build.** The pass earns from ACTIVITIES instead (`deploy_program`
  // carries the same 15 XP). The hidden revelation chain stays OUT of the pass
  // loop as before; the daily to-do hook below is a separate list and is
  // untouched by this rule.
  // V7 daily to-do: a completed research project ticks research_complete
  // (spec §4.4 — "both job kinds": tech, revelation AND armory research all
  // resolve through completed projects; each path fires its own hook).
  noteDailyEvent(state, "research_complete", now);
}

/** True for revelation job ids (the hidden rv1/rv2/rv3 chain). */
export function isRevelationId(techId: string): boolean {
  return techId === "rv1" || techId === "rv2" || techId === "rv3";
}

/**
 * Research duration for a revelation node given the appointed Leader.
 * No specialty alignment exists on the soul path — only the Leader's raw
 * research attribute shortens the work.
 */
export function revelationDurationMs(state: GameState, revId: string, leader: Leader): number {
  const base = getRevelation(revId).durationMs;
  const skill = 1 - leader.attributes.research * 0.04;
  return Math.max(10_000, Math.round(base * skill * studySpeedMult(state)));
}

// Resolve a completed revelation study: the appointed Leader is freed, the
// node id is pushed to `revelations`, and the stage-linked payoff fires.
// No breakthrough rolls on the soul path — the payoff IS the reward.
function resolveRevelation(state: GameState, j: ResearchJob, now: number) {
  const node = getRevelation(j.techId);
  const leader = state.leaders.find((l) => l.id === j.leaderId)!;
  if (leader) {
    leader.assignment = null;
    leader.history.push(`Studied ${node.name}`);
  }
  if (!hasRevelation(state, node.id)) {
    state.revelationsResolved.push(node.id);
    // Visibility of the NEXT node is reconciled at the end of advance()
    // (reconcileRevelationVisibility) — rv2 after rv1 resolves, rv3 after rv2
    // resolves AND stage3 AND acknowledgedOnce. Publishing here would miss the
    // normal order where stage3/acknowledgement flip AFTER rv2 resolves.
  }
  // The Chorus now hunts the pure: slower attention decay, hotter deep zones.
  state.revelationHunts = true;
  if (leader) researchXp(state, leader, false, now);
  // V7 daily to-do: a resolved revelation page is a completed research project.
  noteDailyEvent(state, "research_complete", now);
  if (node.id === "rv1") {
    state.revelationCorruptionGainMult = 0.85;
    state.revelationDrainPerMin = 0.5;
    log(state, `${node.glyph} ${REVELATION_RV1_LINE}`);
  } else if (node.id === "rv2") {
    // Arm the one-shot benign bias (consumed by the next surprise encounter).
    const c = state.revelationCounters;
    if (c && typeof c === "object") c.oneTimeWildcardBiasUsed = false;
    log(state, `${node.glyph} The ledger balances without an engine to keep it. Somewhere, a weight lifts — once.`);
  } else if (node.id === "rv3") {
    // The one-per-game glimpse decision opens in the client (see play.tsx);
    // the state stays pending until the player chooses (revelationChoice).
    if (state.revelationChoice !== "sealed" && state.revelationChoice !== "open") state.revelationChoice = null;
    log(state, `${node.glyph} A glimpse only. The path does not show itself twice. Something in the Cradle waits for an answer.`);
  }
}

/**
 * The rv3 one-per-game decision (owner F2b): "seal the Record in bone" vs
 * "leave it open". Fires once per game — after choosing, the Chronicle carries
 * the consequence and the colony is watched differently (or stays watched).
 */
export function chooseRevelation(state: GameState, choice: "sealed" | "open", now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!hasRevelation(state, "rv3")) return fail("Nothing in the Cradle waits for an answer yet.");
  if (state.revelationChoice === "sealed" || state.revelationChoice === "open") {
    return fail("The answer was already given — the path does not show itself twice.");
  }
  state.revelationChoice = choice;
  if (choice === "sealed") {
    state.revelationChorusMult = 0.75;
    log(state, `🌒 The Record is sealed in bone. The Cradle keeps what it knows the way marrow keeps its memory — and you are watched differently now.`);
  } else {
    log(state, `🌒 The Record is left open. The pages turn in a wind no machine makes — and the Chorus reads over your shoulder a little longer.`);
  }
  return { ok: true, state };
}

/** Domain-flavoured breakthrough payoff. */
function breakthroughPayload(state: GameState, domain: DomainId): { msg: string } {
  switch (domain) {
    case "weaponry":
      state.resources.supplies += 25;
      return { msg: "+25 supplies to the war-chest" };
    case "agriculture":
      state.resources.supplies += 20;
      return { msg: "+20 supplies of stored harvest" };
    case "economy":
      state.resources.supplies += 18;
      state.resources.embers += 6;
      return { msg: "+18 supplies, +6 embers from a lucky trade" };
    case "industry":
      state.resources.supplies += 15;
      state.resources.mechkit += 1;
      return { msg: "+15 supplies, +1 mechanics kit from the foundry" };
    default: // logistics
      state.resources.supplies += 15;
      state.resources.gas += 2;
      return { msg: "+15 supplies, +2 fuel for the fleet" };
  }
}


export function resolveExpedition(state: GameState, e: (typeof state.expeditions)[number], now: number) {
  e.status = "complete";
  e.completedAt = now;
  state.completedExpeditions += 1;
  const zone = getZone(e.zoneId);
  const r = getRace(state.race!);
  const zoneTier = zone.radiationLevel >= DEEP ? (zone.radiationLevel >= 75 ? 3 : 2) : zone.risk >= 50 ? 2 : 1;

  // ---- Layer 1 · the PROJECTED radiation loss ----
  // lossPct was snapshotted at launch from the pre-launch risk pop-up the player
  // read and signed up for. Roll it exactly as advertised.
  const lossP = Math.max(0, Math.min(100, e.lossPct || 0));
  const lossFraction = lossP / 100;
  const radiationHit = lossP > 0 && coin(lossP / 100);

  // ---- Layer 2 · the UNFORESEEN wildcard ----
  // A non-precomputable surprise roll, independent of the layer-1 math: you
  // land off-target, a roaming Chorus force crosses your path, the site is
  // worse than the map said. The player cannot read this off any percentage.
  // Protection (guards & gear snapshotted at launch) makes a surprise less
  // deadly; an under-protected team faces a real catastrophe chance.
  // A specialized Marshal's mandate RAISES protection colony-wide (+20% per
  // marshal, see marshalProtectionMult) and sharpens combat effectiveness.
  // Direction matters here: protection is the SAFER number, so a mandate can
  // never lower it (fixed 2026-09-26 — it used to).
  const prot = typeof e.protection === "number" ? clamp(e.protection, 0, 1) : 0.5;
  let wc: "lost" | "mauled" | "bumped" | null = null;
  if (coin(wildcardChance(state))) {
    const roll = Math.random();
    // Catastrophe odds scale INVERSELY with protection — and with how many
    // Wardens walk the colony: the Marshal mandate multiplies protection UP, so
    // more Marshals can only ever mean fewer spoiled runs.
    const protEffective = clamp(prot * marshalProtectionMult(state), 0, 1);
    const catCh = 0.03 + (1 - protEffective) * 0.42;
    const maulCh = 0.10 + (1 - protEffective) * 0.35;
    if (roll < catCh) wc = "lost";
    else if (roll < catCh + maulCh) wc = "mauled";
    else if (Math.random() < (1 - protEffective) * 0.4) wc = "bumped";
  }
  // rv2's one-shot benign bias: the next surprise shifts one step toward
  // benign (lost→mauled→bumped→dissolved), then the flag consumes itself.
  wc = applyRevelationBias(state, wc);
  // Combat effectiveness of a Marshal-led colony applies to how MUCH of the
  // surprise the guards can fight off: mauling/attrition severity scales down.
  const combatMult = marshalCombatMult(state); // 1 + 10% per marshal (cap +30%)

  // ---- scientist attrition (both layers, never wipe below 1) ----
  const sci = e.assignedScientists;
  const attrition = attritionMult(state); // a3 Triage Gardens −40%
  let sciLost = 0;
  if (radiationHit) {
    sciLost += Math.min(Math.max(Math.round(sci * lossFraction * 0.8 * attrition / combatMult), sci > 1 ? 1 : 0), sci - 1);
  }
  if (wc === "mauled") sciLost += Math.round(sci * 0.25 * attrition / combatMult);
  else if (wc === "lost") sciLost += Math.max(1, Math.round(sci * 0.6 * attrition / combatMult));
  sciLost = Math.min(sciLost, sci - 1);
  if (sciLost > 0) state.scientists = Math.max(1, state.scientists - sciLost);

  // ---- yield (Quartermaster economy effectiveness applies to embers) ----
  const scientistFactor = scientistYieldFactor(sci);
  const base = zone.emberYield * scientistFactor * r.mods.emberGain * emberYieldMult(state); // e2 Salvage Contracts
  const econBoost = economyEmberBoost(state); // economy domains + Quartermaster mandate
  const corruptionPenalty = corruptionYieldPenalty(state);
  const variance = lootVariance();
  let embers = Math.max(1, Math.round(base * econBoost * variance * corruptionPenalty));
  if (radiationHit) embers = Math.max(1, Math.round(embers * (1 - lossFraction)));
  if (wc === "bumped") embers = Math.max(1, Math.round(embers * 0.7));
  else if (wc === "mauled") embers = Math.max(1, Math.round(embers * 0.4));
  else if (wc === "lost") embers = Math.max(1, Math.round(embers * 0.1));
  state.resources.embers += embers;
  state.totalEmbersLooted += embers;
  state.resources.supplies += Math.round(embers * suppliesScrapRate(state)); // scrapped scrap (e1/a2 improve)

  // Race territory material — each race's home region yields its UNIQUE
  // territory material (the alloy recipe needs own + 4 others).
  if (zone.owner !== "shared" && zone.owner !== "special") {
    state.resources.mats[zone.owner as RaceId] += 1;
  }

  // Mild-zone incidental salvage: rad 20-40 sometimes recovers 1-2 hazmat/shots.
  // (Never alloys — those are forged only.) A lost team brings none of it home.
  if (
    wc !== "lost" &&
    zone.radiationLevel >= MILD_SALVAGE_RAD_MIN &&
    zone.radiationLevel < DEEP &&
    coin(MILD_SALVAGE_CHANCE)
  ) {
    const qty = 1 + (coin(MILD_SALVAGE_SECOND_UNIT_CHANCE) ? 1 : 0);
    if (coin(MILD_SALVAGE_HAZMAT_SHARE)) state.resources.hazmat += qty;
    else state.resources.shots += qty;
  }

  // Chipset roll (only special scientific sites carry high chance).
  const chipsetChance = zone.chipsetChance * r.mods.chipsetChance;
  const gotChipset = wc !== "lost" && coin(clamp(chipsetChance, 0, 0.9));
  if (gotChipset) {
    state.resources.chipsets += 1;
    state.totalChipsetsLooted += 1;
  }

  // V6 deep-raid plasma salvage (weapons-system §2): high-risk deep ruin sites
  // (chipset sites — rad >= DEEP) occasionally yield 2–5 plasma alongside the
  // chipsets. The risk-of-depth reward; deterministic per roll, earn-only.
  let plasmaSalvaged = 0;
  if (gotChipset && zone.radiationLevel >= DEEP && coin(ARMORY_CONFIG.plasmaSalvageChance)) {
    plasmaSalvaged = ARMORY_CONFIG.plasmaSalvageMin + Math.floor(
      Math.random() * (ARMORY_CONFIG.plasmaSalvageMax - ARMORY_CONFIG.plasmaSalvageMin + 1),
    );
    state.resources.plasma += plasmaSalvaged;
  }

  // ---- THE FORGE's ingredient: WARPLATE (owner 2026-09-26) ----
  // "rare drops in some of the deeper explorations for materials" — and DEPTH is
  // the whole of it: the shallow ring yields none at all (chance 0), the deep
  // ring is thin, the deep scientific sites are where it actually lives. The
  // odds and the amounts are one table (forge.FORGE_CONFIG). Earn-only: no
  // currency, no store entry, no shortcut produces this.
  const wpTier = forgeDepthTier(zone);
  let warplateFound = 0;
  if (wc !== "lost" && wpTier > 0 && coin(forgeDropChance(wpTier))) {
    warplateFound = forgeDropAmount(wpTier);
    if (warplateFound > 0) state.resources.warplate += warplateFound;
  }
  // Corruption & Chorus consequence — the cost of the deal. Radiation adds
  // corruption directly (not Chorus). A wildcard mauling leaves wounds.
  const weaponryShield = Math.pow(0.85, state.deployedDomains.weaponry);
  const corruptionGain = zone.corruptionRisk * 100 * r.mods.corruptionResist * weaponryShield * corruptionMult(state); // w2 Traction Cannons
  // Revelation hunt: the Chorus watches the pure harder in the deep zones
  // (+50% relative chorusRisk on rad>=60 sites once revelations.length >= 1).
  const huntHeat = state.revelationHunts && zone.radiationLevel >= REVELATION_DEEP ? 1.5 : 1;
  const chorusGain = zone.chorusRisk * 100 * r.mods.chorusResist * weaponryShield * chorusMult(state) * huntHeat; // w4 Siege Batteries
  const corruptedThisRun = radiationHit || wc === "mauled" || wc === "lost" || corruptionGain > 0;
  if (corruptedThisRun) touchUntouchedStreak(state, now);
  if (radiationHit) {
    state.corruption = clamp(state.corruption + Math.round((lossP / 100) * 10), 0, 100);
  }
  if (wc === "mauled") state.corruption = clamp(state.corruption + 12, 0, 100);
  else if (wc === "lost") {
    state.corruption = clamp(state.corruption + 22, 0, 100);
    state.chorusAttention = clamp(state.chorusAttention + 18, 0, 100);
  }
  state.corruption = clamp(state.corruption + corruptionGain, 0, 100);
  state.chorusAttention = clamp(state.chorusAttention + chorusGain, 0, 100);

  // ---- CODICES: EARNED on a clean recovery, never looted ----
  // A fully clean return (no radiation loss AND no wildcard) means the team
  // recovered a surviving archive intact — human knowledge earned by protection
  // and care, scaled by how deep/rich the site was. Not a salvage roll.
  const cleanRecovery = !radiationHit && wc === null;
  // Silent track: purity counters. zeroCorruptionSurvivals counts clean
  // recoveries launched while corruption sat at 0 (a pure colony staying
  // pure — the reachable analog of "survived the dark at zero"; see the V4
  // header note). deepCleanLandings reads the deep scientific sites (rad>=60).
  // Any tainted run (loss / wildcard) breaks the clean streak.
  const c = state.revelationCounters;
  const pureAtLaunch = (e as { pureAtLaunch?: boolean }).pureAtLaunch === true;
  if (!cleanRecovery) {
    if (c && typeof c === "object") c.cleanStreak = 0;
  }
  let gotCodex = 0;
  if (cleanRecovery) {
    // V7 daily to-do: a surviving archive brought home whole (purity item).
    noteDailyEvent(state, "clean_recovery", now);
    if (c && typeof c === "object") {
      c.cleanRecoveries += 1;
      c.cleanStreak += 1;
      if (zone.radiationLevel >= REVELATION_DEEP) c.deepCleanLandings += 1;
      if (pureAtLaunch) c.zeroCorruptionSurvivals += 1;
    }
    gotCodex = Math.max(1, Math.round(1 + zone.risk / 45));
    // The deep scientific sites hide the most complete records.
    if (zone.radiationLevel >= DEEP) gotCodex += 1;
    state.codices += gotCodex;
    state.totalCodicesEarned += gotCodex;
    const speakers = state.leaders.filter((l) => l.status === "active");
    if (speakers.length > 0) {
      const scribe = speakers[Math.floor(Math.random() * speakers.length)];
      scribe.codicesEarned += gotCodex;
      scribe.history.push(`Recovered archives from ${zone.name}`);
    }
    // Deed: a deep clean recovery rescues a scholar into the Council.
    if (zone.radiationLevel >= DEEP) {
      awardDeed(state, "deep_clean", 2, "a deep clean recovery protects a buried archive");
      maybeRecruit(state);
    } else {
      awardDeed(state, "first_clean", 2, "your first clean return recovers a surviving archive");
    }
    // D1 — First Light Sigil: first expedition that returns with zero
    // corrupted fragments gathered (the first clean recovery, deep or not).
    awardDeedCosmetic(state, "deed_first_clean", now);
  }
  awardDeed(state, "five_expeditions", 3, "your fifth exploration recovers a trove of pre-war records");

  // Season 0 pass objectives (§4.1): expeditions completed (weekly target),
  // deep scientific sites (rad ≥ 60), and Codices recovered all accumulate
  // here; the objectives grant Season XP when they cross their targets.
  recordSeasonEvent(state, "expedition_complete", now);
  if (zone.radiationLevel >= REVELATION_DEEP) recordSeasonEvent(state, "deep_site", now);
  if (gotCodex > 0) recordSeasonEvent(state, "codex_recovered", now, gotCodex);

  // ---- LEADER XP: real events only ----
  // (1) Surviving a wildcard/surprise encounter: +12 XP to the expedition's
  //     assigned leaders. WOULD-BE "lost" teams don't survive to be rewarded —
  //     the reward is for the ones who came home. (2) Deep Shatterlands runs
  //     (zoneTier >= 2): +8 XP — the leader whose known successes resolve here
  //     is the one chosen to follow the teams into the deep.
  if (wc !== null && wc !== "lost") {
    const survivors = state.leaders.filter((l) => l.status === "active");
    const granted = survivors.length > 0
      ? grantXpTo(state, survivors[Math.floor(Math.random() * survivors.length)], 12, "survived a surprise encounter", now)
      : 0;
    if (granted > 0) {
      // Chronicle already told the story; add the reward line.
      log(state, `⭐ A leader drew resolve from the encounter: +${Math.round(granted)} XP.`);
    }
  }
  if (zoneTier >= 2 && wc !== "lost") {
    const deepLeaders = state.leaders.filter((l) => l.status === "active");
    if (deepLeaders.length > 0) {
      const pick = deepLeaders[Math.floor(Math.random() * deepLeaders.length)];
      const granted = grantXpTo(state, pick, 8, "ran the deep Shatterlands", now);
      if (granted > 0) {
        log(state, `⭐ ${pick.name} guided the deep run: +${Math.round(granted)} XP.`);
      }
    }
  }

  let msg = `Exploration of ${zone.name} returned: +${embers} Embers`;
  if (wc === "lost") {
    msg = `💀 ${zone.name} — the team never came home whole. A roaming Chorus force crossed their path, or they landed in the wrong damn spot${sciLost > 0 ? `; ${sciLost} scientist${sciLost > 1 ? "s" : ""} lost` : ";"} only ${embers} Embers dragged out of the wreck. Protection saves teams — build more.`;
  } else if (wc === "mauled") {
    msg = `⚠️ ${zone.name} — caught off-guard by something that wasn't on the map${sciLost > 0 ? `: ${sciLost} scientist${sciLost > 1 ? "s" : ""} lost` : ", but the guard kit kept everyone alive"}. +${embers} Embers recovered.`;
  } else if (wc === "bumped") {
    msg = `— ${zone.name} — the team rode out an unexpected hazard (a worse landing, a hidden pocket of Chorus). The kit took the edge off. +${embers} Embers.`;
  } else if (radiationHit) {
    msg = `☢️ ${zone.name} claimed its price: the under-geared team took radiation. +${embers} Embers recovered${e.assignedScientists > 1 ? " — scientists lost to attrition" : " — the lone scientist barely survived"}.`;
  } else if (gotChipset) msg = `Exploration of ${zone.name} returned a prize: +${embers} Embers and a rare Chipset!`;
  else if (zone.chipsetChance === 0) msg = `Exploration of ${zone.name} returned: +${embers} Embers (no chipsets in the outer rust).`;
  if (cleanRecovery) msg += ` 📜 The team brought a surviving archive home whole — Codices +${gotCodex} (earned, not looted).`;
  if (plasmaSalvaged > 0) msg += ` — the deep vaults bled high-energy plasma (🔮 +${plasmaSalvaged}).`;
  if (warplateFound > 0) {
    msg += ` — the wreck gave up ${warplateFound} Warplate (THE FORGE's stock — only the deep sites carry it).`;
  } else if (wpTier === 0 && !zone.chipsetChance) {
    // the shallow hint: a team that never sees warplate is told where it lives,
    // which is how a player learns the depth link without a wiki.
    msg += ` — no Warplate here; that only comes out of the deep sites.`;
  }
  if (corruptionGain > 8) msg += ` — the fragment left a taint on the Cradle (corruption +${Math.round(corruptionGain)}).`;
  if (chorusGain > 10) msg += ` — the Chorus stirred at the disturbance (attention +${Math.round(chorusGain)}).`;
  log(state, msg);

  state.expeditions = state.expeditions.filter((x) => x.id !== e.id);
}

// ------- actions -------

export function launchExpedition(state: GameState, zoneId: string, assignedScientists: number, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  if (state.expeditions.filter((e) => e.status === "out").length >= maxConcurrentExpeditionsState(state)) {
    return fail("Your logistics can only keep one exploration team in the field. Deploy Logistics AI to send more.");
  }
  const zone = getZone(zoneId);
  const cost = suppliesCostForZone(state, zone);
  // ---- THE RE-TIME: the rung's own demand, ordnance, and the energy draw ----
  const rung = rungOfZone(zone.id);
  const demand = rungEntryDemand(state, zone);
  const ordUnits = ordnanceUnitsForRung(rung);
  const ordSupplies = ordUnits * ORDNANCE_SUPPLIES_PER_UNIT;
  const ordEmbers = ordUnits * ORDNANCE_EMBERS_PER_UNIT;
  const entry = cost + demand + ordSupplies;
  if (state.resources.supplies < entry) {
    return fail(
      `Not enough supplies to enter this rung. The run needs ${entry} 📦 — ${cost} 📦 operations, ` +
        `${demand} 📦 rung demand (${RUNG_ENTRY_R} × this rung's own timer, priced in your income` +
        `, ${rungEntryDemandInIncomeDays(zone).toFixed(2)} days of it), ${ordSupplies} 📦 ordnance. Have ${Math.floor(state.resources.supplies)}.`,
    );
  }
  if (ordEmbers > 0 && state.resources.embers < ordEmbers) {
    return fail(`The ordnance this rung needs costs ${ordEmbers} 🧯 Embers. Have ${Math.floor(state.resources.embers)}.`);
  }
  const energyDraw = energyDrawForRung(rung);
  const energyHeld = state.energy ?? energyCapacity(state);
  if (energyHeld < energyDraw) {
    return fail(
      `The colony has no energy left for another run — ${energyHeld.toFixed(1)} of ${energyDraw} charges. ` +
        `The pool refills at ${energyCapacity(state)} charges a day.`,
    );
  }

  // ---- Tier 0 stepping-out gear gates fielding ANY expedition ----
  if (!hasStepOutGear(state)) {
    return fail("The Cradle hasn't stepped out yet. Forge a Medical kit, a Mechanics kit, and an Armor kit in the 🏭 Workshop before any team leaves.");
  }

  // ---- vehicle fuel & mechanics logistics (the discovery puzzle) ----
  // Gas gets you there (distance); battery runs you quiet at the site (near the
  // Chorus). Skilled mechanics handle the heavier machinery. We do NOT explain
  // the split — the cryptic failures are the intended discovery. Research techs
  // (Long-Haul Chassis, Battery Fabrication, Silent Drives, Machine Shop) ease
  // these needs.
  const gNeed = Math.ceil(gasNeed(zone) * (hasTech(state, "l1") ? 0.5 : 1)); // l1 Long-Haul Chassis
  const bNeed = Math.ceil(
    batteryNeed(zone) * (hasTech(state, "i3") ? 0.5 : 1) * (hasTech(state, "l2") ? 0.6 : 1), // i3 Battery Fab, l2 Silent Drives
  );
  const sNeed = Math.ceil(skmechNeed(zone) * (hasTech(state, "i2") ? 0.5 : 1)); // i2 Machine Shop
  if (state.resources.gas < gNeed) {
    return fail(`The convoy can't carry that run far enough with what fuel's in the depot. Pack more vehicle fuel. (needs ${gNeed})`);
  }
  if (state.resources.battery < bNeed) {
    return fail(`The engines won't run silent out there with what's charged. Pack more battery packs. (needs ${bNeed})`);
  }
  if (state.resources.skmech < sNeed) {
    return fail(`The machinery out there outranks your mechanics' skill. Forge Skilled Mechanics first. (needs ${sNeed})`);
  }

  const sci = Math.max(1, Math.min(assignedScientists, state.scientists));
  state.resources.supplies -= entry;
  state.resources.embers -= ordEmbers;
  state.energy = energyHeld - energyDraw;
  // RE-TIME (spec §3) — FIELD GEAR IS CONSUMED PER RUN. Before this, radiation
  // gear was a one-time capital purchase and `launchExpedition` deducted only
  // supplies/gas/battery: the single largest pacing bug found. A run now burns
  // hazmat/shots (per scientist) and one alloy (per zone) as well as the fuel
  // and mechanics it already burned. An under-geared run is still allowed — it
  // burns what it has and pays for the shortfall in radiation loss, exactly as
  // the pre-launch risk pop-up promises.
  const gearNeed = requiredGear(zone, sci);
  const gearHazmat = Math.min(state.resources.hazmat, gearNeed.hazmat);
  const gearShots = Math.min(state.resources.shots, gearNeed.shots);
  const gearAlloys = Math.min(state.resources.alloys, gearNeed.alloys);
  state.resources.hazmat -= gearHazmat;
  state.resources.shots -= gearShots;
  state.resources.alloys -= gearAlloys;
  // Consume fuel (the refuel / recharge cost of the run).
  state.resources.gas -= gNeed;
  state.resources.battery -= bNeed;
  state.resources.skmech -= sNeed;
  const id = "exp-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const industrySpeed = Math.pow(0.94, state.deployedDomains.industry) * (hasTech(state, "i4") ? 0.9 : 1); // i4 Foundry Lines −10% time
  // RE-TIME: the earned stack (industry domains + Foundry Lines, plus the run's
  // ±10% landing) is floored at MIN_TIMER_FRACTION of the rung's own timer.
  const durationMs = timerFloor(
    zone.baseDurationMs,
    Math.round(zone.baseDurationMs * industrySpeed * (0.9 + Math.random() * 0.2)),
  );
  // Snapshot the radiation loss % into the expedition at launch so the resolve
  // rolls the risk the player explicitly accepted in the pre-launch pop-up.
  const radLoss = lossPct(state, zone, sci);
  // Snapshot the protection index at launch — the guards & gear that absorb the
  // unforeseeable wildcard at resolve time (never shown as a percentage).
  const prot = protectionIndex(state, zone, sci);
  state.expeditions.push({
    id,
    zoneId: zone.id,
    label: zone.name,
    assignedScientists: sci,
    suppliesCost: cost,
    startedAt: now,
    durationMs,
    status: "out",
    lossPct: radLoss,
    protection: Math.round(prot * 100) / 100,
    // Silent track: was the colony's corruption at absolute zero when this
    // team stepped out? (Read at resolve; never shown anywhere.)
    pureAtLaunch: state.corruption <= 0,
  } as (typeof state.expeditions)[number]);
  const warn = radLoss > 0 ? ` ☢️ ${radLoss}% clean-return risk — the colony went without full gear.` : "";
  // RE-TIME: `fmtClock` (day-aware) replaces "N.N min", which rendered a 168 h
  // run as "10080.0 min" in the Chronicle.
  log(
    state,
    `Exploration launched into ${zone.name} (${sci} scientist${sci > 1 ? "s" : ""}). Returns in ${fmtClock(durationMs)}. ` +
      `Risk ${zone.risk} · rung ${rung + 1}/29 · demand ${demand} 📦 · ${energyDraw} energy.${warn}`,
  );
  recordSeasonEvent(state, "launch_expedition", now); // Season 0 daily objective
  // V7 daily to-do: launch_any always; launch_mid (risk >= 40, rad < DEEP) and
  // launch_deep (rad >= 60) are zone-gated by the funnel.
  noteDailyLaunch(state, zone, now);
  pruneCompleted(state);
  return { ok: true, state };
}

// ------- Workshop crafting (radiation gear & the forged alloy) -------

export function craftItem(state: GameState, kind: CraftKind, now = Date.now(), quiet = false): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  const def = CRAFT[kind];
  const forgedCost = craftCost(state, kind, now); // i1 Auto-Forge −15%; Quartermaster watch −10%
  if (state.resources.supplies < forgedCost) {
    return fail(`Not enough supplies. ${def.label} needs ${forgedCost} 📦, have ${Math.floor(state.resources.supplies)}.`);
  }
  if (kind === "alloy") {
    if (!canForgeAlloy(state)) {
      return fail("The alloy needs 5 unique race materials — your own territory's supply plus 4 other races'. Raid their home regions to gather them.");
    }
    // Consume 1 of each of the 5 materials to forge the alloy (extraction key).
    for (const rid of alloyRecipeRaces(state)) state.resources.mats[rid] -= 1;
  }
  state.resources.supplies -= forgedCost;
  state.resources[CRAFT_RESOURCE_KEY[kind]] += 1;
  const note =
    kind === "alloy"
      ? " — 5 race materials bound into radiation-resistant alloy, the deep-zone key"
      : kind === "gas" || kind === "battery"
        ? " — the convoy's logistics stores grow"
        : "";
  // The batch path passes quiet and writes ONE summary line itself, so a
  // 20-kit forge doesn't push the colony's history off the 60-line log.
  if (!quiet) log(state, `The Workshop forged a ${def.label}${note}.`);
  recordSeasonEvent(state, "craft_item", now); // Season 0 daily objective
  // V7 daily to-do: any craft completes craft_item; gas/battery also complete
  // the refuel_convoy item.
  noteDailyEvent(state, "craft_item", now);
  if (kind === "gas" || kind === "battery") noteDailyEvent(state, "refuel_convoy", now);
  return { ok: true, state };
}

/** BULK FORGE (owner 2026-09-30): one tap, up to `count` kits. Loops the
 *  single-item `craftItem` so every charge, recipe check and daily note runs
 *  exactly as it would for one-at-a-time taps — the loop simply stops at the
 *  first failure (supplies run dry, alloy recipe incomplete) instead of
 *  pretending the rest landed. `crafted` is the honest count; `ok` is true
 *  whenever at least one kit landed, and `error` carries the first failure's
 *  reason so the UI can say "forged 7, then supplies ran out". */
export function craftItemBatch(state: GameState, kind: CraftKind, count: number, now = Date.now()): { ok: boolean; crafted: number; error?: string; state: GameState } {
  const n = Math.max(1, Math.min(99, Math.floor(count) || 1));
  let crafted = 0;
  let error: string | undefined;
  for (let i = 0; i < n; i++) {
    const res = craftItem(state, kind, now, true);
    if (!res.ok) { error = res.error; break; }
    crafted++;
  }
  // ONE chronicle line for the whole batch — the per-kit lines are suppressed
  // above so a bulk forge never floods the 60-line log.
  if (crafted > 0) log(state, `The Workshop forged ${crafted} × ${CRAFT[kind].label}.`);
  return { ok: crafted > 0, crafted, error, state };
}

export function beginStudy(state: GameState, kind: "ember" | "chipset", now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  if (state.studies.filter((s) => s.status === "studying").length >= state.scientists) {
    return fail(`All ${state.scientists} scientist(s) are already busy. Deploy Logistics AI to raise capacity.`);
  }
  if (kind === "ember" && state.resources.embers < STUDY_EMBER_COST) {
    return fail(`Need at least ${STUDY_EMBER_COST} Embers to study.`);
  }
  // DEFECT (filed, NOT fixed here): the chipset branch checks a Chipset and
  // deducts NOTHING, so one Chipset is infinite insight. Do not "fix" it in a
  // valuation slice — the valuation prices a Chipset as a FLOOR because of it.
  if (kind === "chipset") {
    if (state.resources.chipsets < 1) return fail("You have no Chipsets. Only deep scientific sites yield them.");
  } else {
    state.resources.embers -= STUDY_EMBER_COST;
  }
  const id = "std-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.studies.push({ id, kind, startedAt: now, durationMs: studyDurationMs(state, kind), status: "studying" });
  log(state, `A scientist begins studying ${kind === "ember" ? "2 Embers" : "a Chipset"}. A lesson is forming.`);
  recordSeasonEvent(state, "study", now); // Season 0 daily objective
  // V7 daily to-do: a started study completes study_ember / study_chipset.
  noteDailyEvent(state, kind === "ember" ? "study_ember" : "study_chipset", now);
  pruneCompleted(state);
  return { ok: true, state };
}

export function deployProgram(
  state: GameState,
  domain: DomainId,
  now = Date.now(),
): { ok: boolean; error?: string; errorKey?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  // THE CEILING, enforced where the state is changed: a domain at the ladder's
  // top rung is REFUSED here, never silently granted a level the client cannot
  // show and no content is priced for. (The UI gates on the same constant; this
  // is the authority, not a second opinion.)
  if (domainAtMaxLevel(state, domain)) {
    return failKey(
      "cradle.domainMaxReason",
      `${domainFor(domain)} is at L${MAX_DOMAIN_LEVEL} — the highest a domain can be driven.`,
    );
  }
  // RE-TIME: one program at a time, ON A TIMER. The level moves in
  // `resolveProgramDeploy` (called from advance), never here — a deployment now
  // costs real time, which is what the R = 6 arithmetic needs from this action.
  if (state.programDeploy) {
    const left = Math.max(0, state.programDeploy.startedAt + state.programDeploy.durationMs - now);
    return fail(`The lab is already driving ${domainFor(state.programDeploy.domain)} — ${fmtClock(left)} to go.`);
  }
  const cost = deployCost(state, domain);
  if (state.resources.embers < cost.embers) return fail(`Need ${cost.embers} Embers.`);
  if (state.insight < cost.insight) return fail(`Need ${cost.insight} insight from the lab. Study fragments to generate it.`);
  state.resources.embers -= cost.embers;
  state.insight -= cost.insight;
  const durationMs = deployDurationMs(state, domain);
  state.programDeploy = { domain, startedAt: now, durationMs };
  // Season 0 objective hook (replaces `complete_research`, which under this
  // ladder would require a TIMED BUILD to finish — see monetization.ts).
  recordSeasonEvent(state, "deploy_program", now);
  log(state, `The lab begins driving ${domainFor(domain)} to level ${(state.deployedDomains[domain] ?? 0) + 1} — ready in ${fmtClock(durationMs)}.`);
  pruneCompleted(state);
  return { ok: true, state };
}

// ------- research tree (knowledge track: Codices + appointed Leaders) -------

/** Appoint a Leader to research a tech: one project per Leader, one per project. */
export function beginResearch(state: GameState, techId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  // The hidden chain resolves through the same job shape (standalone — no
  // domain, no deployedDomains key), gated by silent thresholds only.
  if (isRevelationId(techId)) return beginRevelation(state, techId, leaderId, now);
  if (isArmoryTech(techId)) return beginArmoryResearch(state, techId, leaderId, now);
  if (isMusterTech(techId)) return beginMusterResearch(state, techId, leaderId, now);
  if (isSatelliteTech(techId)) return beginSatelliteResearch(state, techId, leaderId, now);
  if (isScoutProbeTech(techId)) return beginScoutProbeResearch(state, techId, leaderId, now);
  const tech = getTech(techId);
  if (!tech) return fail("Unknown research project.");
  if (state.techsResearched.includes(techId)) return fail(`${tech.name} is already researched.`);
  if (techInProgress(state, techId)) return fail(`${tech.name} is already being researched.`);
  if (state.codices < tech.codicesCost) return fail(`${tech.name} needs ${tech.codicesCost} 📜 Codices. You have ${state.codices} — earn more through clean recoveries and deeds.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot oversee research.`);
  if (leader.assignment) return fail(`${leader.name} is already overseeing ${getTechSafe(leader.assignment)}.`);
  // One project per Leader is enforced; a Leader may only run one thing at a time.
  const durationMs = researchDurationMs(state, techId, leader);
  state.codices -= tech.codicesCost;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = techId;
  leader.history.push(`Appointed to research ${tech.name}`);
  const aligned = specialtyAligns(leader, techId);
  log(state, `📜 ${leader.name} (${SPECIALTY_LABEL[leader.specialty]}) appointed to research ${tech.icon} ${tech.name} (${tech.codicesCost} 📜). ${aligned ? "Their specialty aligns — faster work, and a chance of a breakthrough." : "No specialty edge here — they'll work at base pace."}`);
  pruneCompleted(state);
  return { ok: true, state };
}

/**
 * Appoint a Leader to study a revelation node. Costs Codices only (earned,
 * never bought). Gated purely by the silent chain: rv1 visible once stage1
 * fired; rv2 after rv1 resolves; rv3 after rv2 resolves AND stage3 holds.
 * If the player abandons (resets), nothing is lost except Codices already
 * spent — the node simply re-appears as available.
 */
export function beginRevelation(state: GameState, revId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  const node = getRevelation(revId);
  if (!node) return fail("Unknown research project.");
  if (hasRevelation(state, revId)) return fail("That page has already been read.");
  if (revelationInProgress(state, revId)) return fail("That page is already being studied.");
  if (!revelationAvailable(state, revId)) return fail("Nothing answers. Perhaps the Cradle is not ready.");
  if (state.codices < node.codicesCost) return fail(`The page asks ${node.codicesCost} 📜 Codices. You hold ${state.codices}.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot study the page.`);
  if (leader.assignment) {
    const other = getTechSafe(leader.assignment);
    return fail(`${leader.name} is already overseeing ${other}.`);
  }
  const durationMs = revelationDurationMs(state, revId, leader);
  state.codices -= node.codicesCost;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId: revId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = revId;
  leader.history.push(`Appointed to study ${node.name}`);
  log(state, `📜 ${leader.name} opens ${node.glyph} ${node.name}.`);
  pruneCompleted(state);
  return { ok: true, state };
}

/** Assignment display name that never crashes on revelation ids. */
function getTechSafe(techId: string): string {
  if (isRevelationId(techId)) return getRevelation(techId).name;
  if (isArmoryTech(techId)) return getArmoryTech(techId).name;
  if (isMusterTech(techId)) return getMusterTech(techId).name;
  if (isSatelliteTech(techId)) {
    const p = parseSatelliteTech(techId)!;
    return `🛰️ ${p.nodeId} satellite — stage ${p.stage}`;
  }
  const t = TECH_TREE.find((x) => x.id === techId);
  return t ? t.name : techId;
}

// ------- the colony-side Armory (V6, weapons-system design 2026-09-12) -------
//
// Weapons are hardware BUILT AT THE CRADLE from expedition-gathered resources
// (supplies/embers/fuel) and, at T2+, refined/salvaged plasma. Five war-role
// families per race; four tiers per family; stats rise per tier (×1.8/×3.2/×16
// over T1 — owner-ratified 2026-09-27, T4 = 5 × T3 = "a brute"). Builds and
// upgrades are real-time commitments: owner-ratified times 12h/3d/12d/45d,
// ARMORY_BUILD_SLOTS (2) families under construction at once, no queue on one
// family — resolved lazily in advance() exactly like expeditions, so the Cradle
// forges while the world is offline.
//
// EARN-ONLY structural rule: no purchase path can grant plasma, weapons, or
// build completion. This module imports nothing from monetization.ts, takes no
// currency, and exposes no Votive/Scrip path — the guardrails assert it.

/** Read a family's built state (tier 0 = never built; everBuilt latches). */
export function armoryFamilyState(state: GameState, familyId: string): { tier: number; everBuilt: boolean } {
  const row = (state.armory ?? {})[familyId];
  const tier = row && typeof row.tier === "number" ? row.tier : 0;
  return { tier: Math.max(0, Math.min(4, tier)), everBuilt: row?.everBuilt === true };
}

/** A family's in-flight build, or null. */
export function armoryBuildFor(state: GameState, familyId: string): (typeof state.armoryBuilds)[string] | null {
  return state.armoryBuilds?.[familyId] ?? null;
}

/** How many families a colony has under construction right now — the number
 *  the slot cap counts (owner-ratified 2026-09-27: ARMORY_BUILD_SLOTS = 2). */
export function armoryBuildsInFlight(state: GameState): number {
  return Object.keys(state.armoryBuilds ?? {}).length;
}

/** Free forge slots on the colony (0 = both committed; a new build is refused). */
export function armorySlotsFree(state: GameState): number {
  return Math.max(0, ARMORY_BUILD_SLOTS - armoryBuildsInFlight(state));
}

/** True for the Muster tier-line ids (muster_1/2/3 — unlock T2/T3/T4 troops). */
export function isMusterTechId(techId: string): boolean {
  return isMusterTech(techId);
}

/** Is a Muster tier tech currently being researched by any Leader? */
export function musterTechInProgress(state: GameState, techId: string): boolean {
  return state.researchJobs.some((j) => j.techId === techId && j.status === "researching");
}

/** A Muster tier tech is researchable when its predecessor is done:
 *  muster_1 is always open; muster_2 needs muster_1; muster_3 needs muster_2. */
export function musterTechAvailable(state: GameState, techId: string): boolean {
  if (!isMusterTech(techId)) return false;
  if (state.techsResearched.includes(techId)) return false;
  const idx = MUSTER_TIER_TREE.findIndex((t) => t.id === techId);
  if (idx <= 0) return true;
  const prev = MUSTER_TIER_TREE[idx - 1];
  return state.techsResearched.includes(prev.id) && !musterTechInProgress(state, prev.id);
}

/** Research duration for a Muster tier tech given the appointed Leader (same
 *  shape as the Armory line: only the research attribute shortens it). */
export function musterResearchDurationMs(state: GameState, techId: string, leader: Leader): number {
  const base = getMusterTech(techId).durationMs;
  const skill = 1 - leader.attributes.research * 0.04;
  return timerFloor(base, base * skill * studySpeedMult(state));
}

/** Appoint a Leader to research a Muster tier node. Costs Codices; flows
 *  through the same job shape as the tree, resolving into techsResearched
 *  via resolveMusterTech. */
export function beginMusterResearch(state: GameState, techId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  const node = getMusterTech(techId);
  if (!node) return fail("Unknown research project.");
  if (state.techsResearched.includes(techId)) return fail(`${node.name} is already researched.`);
  if (musterTechInProgress(state, techId)) return fail(`${node.name} is already being researched.`);
  if (!musterTechAvailable(state, techId)) {
    const idx = MUSTER_TIER_TREE.findIndex((t) => t.id === techId);
    const prev = idx > 0 ? getMusterTech(MUSTER_TIER_TREE[idx - 1].id).name : null;
    return fail(prev ? `Research ${prev} first — the tiers unlock in order.` : `${node.name} is not available yet.`);
  }
  if (state.codices < node.codicesCost) return fail(`${node.name} needs ${node.codicesCost} 📜 Codices. You have ${state.codices} — earn more through clean recoveries and deeds.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot oversee drills.`);
  if (leader.assignment) return fail(`${leader.name} is already overseeing ${getTechSafe(leader.assignment)}.`);
  const durationMs = musterResearchDurationMs(state, techId, leader);
  state.codices -= node.codicesCost;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = techId;
  leader.history.push(`Appointed to research ${node.name}`);
  log(state, `📜 ${leader.name} appointed to research ${node.icon} ${node.name} (${node.codicesCost} 📜).`);
  pruneCompleted(state);
  return { ok: true, state };
}

/** Resolve a completed Muster tier research job: unlock the tech, free the
 *  Leader, award the standard research XP. No breakthrough roll — the muster
 *  line has no specialty to align (same carve-out as the forge line). */
function resolveMusterTech(state: GameState, j: ResearchJob, now: number) {
  const node = getMusterTech(j.techId);
  const leader = state.leaders.find((l) => l.id === j.leaderId)!;
  if (leader) {
    leader.assignment = null;
    leader.history.push(`Researched ${node.name} (muster tiers)`);
  }
  if (!state.techsResearched.includes(j.techId)) state.techsResearched.push(j.techId);
  log(state, `📜 ${leader ? leader.name : "A leader"} researched ${node.icon} ${node.name}. ${node.effect}.`);
  if (leader) researchXp(state, leader, false, now);
  noteDailyEvent(state, "research_complete", now);
}

/** True for the Armory research-line ids (hub / 5 families / plasma refinement). */
export function isArmoryTech(techId: string): boolean {
  return ARMORY_TREE.some((t) => t.id === techId);
}

/** Is an Armory tech currently being researched by any Leader? */
export function armoryTechInProgress(state: GameState, techId: string): boolean {
  return state.researchJobs.some((j) => j.techId === techId && j.status === "researching");
}

/** An Armory tech is researchable when its dependency is done: the hub is
 *  always open; per-family unlocks and Plasma Refinement need the hub first
 *  (no further chaining — the hub is the single gate). */
export function armoryTechAvailable(state: GameState, techId: string): boolean {
  if (!isArmoryTech(techId)) return false;
  if (state.techsResearched.includes(techId)) return false;
  if (techId === "armory_hub") return true;
  return state.techsResearched.includes("armory_hub") && !armoryTechInProgress(state, "armory_hub");
}

/** Research duration for an Armory tech given the appointed Leader (same shape
 *  as revelation projects: only the Leader's research attribute shortens it —
 *  no specialty line exists for the forge line). */
export function armoryResearchDurationMs(state: GameState, techId: string, leader: Leader): number {
  const base = getArmoryTech(techId).durationMs;
  const skill = 1 - leader.attributes.research * 0.04;
  // RE-TIME: same earned stack, same floor (armory research is a timed build).
  return timerFloor(base, base * skill * studySpeedMult(state));
}

/** Appoint a Leader to research an Armory node (hub / family forge / plasma
 *  refinement). Costs Codices only; flows through the same job shape as the
 *  tree, and resolves into techsResearched via resolveArmoryTech. */
export function beginArmoryResearch(state: GameState, techId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  const node = getArmoryTech(techId);
  if (!node) return fail("Unknown research project.");
  if (state.techsResearched.includes(techId)) return fail(`${node.name} is already researched.`);
  if (armoryTechInProgress(state, techId)) return fail(`${node.name} is already being researched.`);
  if (!armoryTechAvailable(state, techId)) {
    return techId === "armory_hub"
      ? fail(`${node.name} stands open — appoint a Leader to begin.`)
      : fail(`🏛️ Armory must be researched first — the forges answer to it.`);
  }
  if (state.codices < node.codicesCost) return fail(`${node.name} needs ${node.codicesCost} 📜 Codices. You have ${state.codices} — earn more through clean recoveries and deeds.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot oversee the forge.`);
  if (leader.assignment) return fail(`${leader.name} is already overseeing ${getTechSafe(leader.assignment)}.`);
  const durationMs = armoryResearchDurationMs(state, techId, leader);
  state.codices -= node.codicesCost;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = techId;
  leader.history.push(`Appointed to research ${node.name}`);
  log(state, `📜 ${leader.name} appointed to research ${node.icon} ${node.name} (${node.codicesCost} 📜).`);
  pruneCompleted(state);
  return { ok: true, state };
}

/** Resolve a completed Armory research job: unlock the tech, free the Leader,
 *  award the standard research XP. No breakthrough roll — the forge line has
 *  no specialty to align (same carve-out as the soul path). */
function resolveArmoryTech(state: GameState, j: ResearchJob, now: number) {
  const node = getArmoryTech(j.techId);
  const leader = state.leaders.find((l) => l.id === j.leaderId)!;
  if (leader) {
    leader.assignment = null;
    leader.history.push(`Researched ${node.name}`);
  }
  if (!state.techsResearched.includes(node.id)) {
    state.techsResearched.push(node.id);
  }
  log(state, `🔬 ${leader ? leader.name : "A leader"} researched ${node.icon} ${node.name}. ${node.effect}.`);
  if (leader) researchXp(state, leader, false, now);
  // RE-TIME: same retirement as `resolveResearch` above — a completed armory
  // node is a TIMED BUILD, and no season objective may depend on one.
  // V7 daily to-do: an Armory node is a completed research project.
  noteDailyEvent(state, "research_complete", now);
}

// ------- Orbital Watch research (design/satellites.md) -------
//
// A Lab research line brings dormant satellites online ONE BY ONE, then
// climbs each through stages 1 → 2 → 3. NEVER ACCELERABLE: no time-token
// path may touch these jobs (enforced in time-tokens.ts + the Lab UI hides
// the speedup affordance). Completions land in `satellites.restored`, NOT
// techsResearched — the sky never inflates research counts.

/** Research duration for a satellite climb: the Leader's research attribute,
 *  Scholar path and study speed still apply — but there is NO specialty
 *  alignment (the sky is no domain's line). */
export function satelliteResearchDurationMs(state: GameState, techId: string, leader: Leader): number {
  const parsed = parseSatelliteTech(techId);
  const base = satelliteTechFor(parsed?.nodeId ?? "", (parsed?.stage ?? 1) as 1 | 2 | 3).durationMs;
  const skill = 1 - leader.attributes.research * 0.04;
  const scholar = scholarResearchMult(leader);
  return timerFloor(base, base * skill * scholar * studySpeedMult(state));
}

/** A satellite climb is available when the node's stage is exactly one below. */
export function satelliteTechAvailable(state: GameState, techId: string): boolean {
  const p = parseSatelliteTech(techId);
  if (!p) return false;
  const cur = state.satellites?.stages?.[p.nodeId];
  return cur === p.stage - 1;
}

export function satelliteTechInProgress(state: GameState, techId: string): boolean {
  return state.researchJobs.some((j) => j.techId === techId && j.status === "researching");
}

/** Appoint a Leader to wake a satellite (or climb it a stage). Costs Codices
 *  only; flows through the same job shape as the tree. */
export function beginSatelliteResearch(state: GameState, techId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  ensureSatellites(state);
  const p = parseSatelliteTech(techId);
  if (!p) return fail("Unknown research project.");
  const node = satelliteTechFor(p.nodeId, p.stage);
  const cur = state.satellites!.stages[p.nodeId];
  if (cur === undefined) return fail("That ground has no satellite — sanctioned land needs no watch.");
  if (cur >= p.stage) return fail(`That satellite is already at stage ${cur}.`);
  if (cur !== p.stage - 1) return fail("Satellites climb one stage at a time — bring it online first.");
  if (satelliteTechInProgress(state, techId)) return fail("That climb is already underway.");
  if (state.codices < node.codicesCost) return fail(`The climb needs ${node.codicesCost} 📜 Codices. You have ${state.codices} — earn more through clean recoveries and deeds.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot watch the sky.`);
  if (leader.assignment) return fail(`${leader.name} is already overseeing ${getTechSafe(leader.assignment)}.`);
  const durationMs = satelliteResearchDurationMs(state, techId, leader);
  state.codices -= node.codicesCost;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = techId;
  leader.history.push(`Appointed to wake the ${p.nodeId} satellite (stage ${p.stage})`);
  log(state, `🛰️ ${leader.name} appointed to ${p.stage === 1 ? "bring the satellite online" : `climb the satellite to stage ${p.stage}`} over ${p.nodeId} (${node.codicesCost} 📜). The sky opens on research time alone — no token can hasten it.`);
  pruneCompleted(state);
  return { ok: true, state };
}

/** Appoint a Leader to research scout probes. Unlocks probe building. Costs
 *  Codices only (earned, never bought). Single tech — no tree. */
export function beginScoutProbeResearch(state: GameState, techId: string, leaderId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  ensureWorldMap(state);
  if (state.worldMap!.scoutTechResearched) return fail("Scout probes are already researched.");
  if (techInProgress(state, techId)) return fail("Scout probe research is already underway.");
  if (state.codices < SCOUT_TECH_CODICES) return fail(`Scout probes need ${SCOUT_TECH_CODICES} 📜 Codices. You have ${state.codices} — earn more through clean recoveries and deeds.`);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (leader.status !== "active") return fail(leader.status === "lost" ? `${leader.name} is lost.` : `${leader.name} is recovering and cannot oversee research.`);
  if (leader.assignment) return fail(`${leader.name} is already overseeing ${getTechSafe(leader.assignment)}.`);
  const durationMs = SCOUT_TECH_DURATION_MS;
  state.codices -= SCOUT_TECH_CODICES;
  const id = "rs-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.researchJobs.push({ id, techId, leaderId, startedAt: now, durationMs, status: "researching" });
  leader.assignment = techId;
  leader.history.push(`Appointed to research scout probes`);
  log(state, `🔭 ${leader.name} appointed to research scout probes (${SCOUT_TECH_CODICES} 📜). One-time eyes on distant worlds.`);
  pruneCompleted(state);
  return { ok: true, state };
}

/** Build a scout probe. Requires researched tech. Costs supplies. */
export function buildScoutProbe(state: GameState, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  if (!wm.scoutTechResearched) return fail("Research scout probes first.");
  if (state.resources.supplies < SCOUT_PROBE_COST_SUPPLIES) return fail(`A probe needs ${SCOUT_PROBE_COST_SUPPLIES} supplies. You have ${Math.floor(state.resources.supplies)}.`);
  state.resources.supplies -= SCOUT_PROBE_COST_SUPPLIES;
  wm.probes += 1;
  log(state, `🔭 Probe built (${SCOUT_PROBE_COST_SUPPLIES} supplies). ${wm.probes} ready to launch.`);
  return { ok: true, state };
}

/** Launch a scout probe at a target server. Consumes one from inventory. */
export function launchScoutProbe(state: GameState, serverId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  if (!wm.scoutTechResearched) return fail("Research scout probes first.");
  const target = (serverId || "").trim();
  if (!target) return fail("Name the target planet (server) first.");
  const res = launchProbe(wm, target, now);
  if (!res.ok) return fail(res.error ?? "Could not launch the probe.");
  log(state, `🔭 Probe ${res.probe!.id} launched at ${target} — returns in 6 hours.`);
  return { ok: true, state };
}

/** Collect a returned probe's report. */
export function collectScoutProbe(state: GameState, probeId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const res = collectProbe(wm, probeId, now);
  if (!res.ok) return fail(res.error ?? "Could not collect the probe.");
  const r = res.report!;
  log(state, `🔭 Probe report from ${r.serverId}: ${r.playerCount} players, ${r.colonyCount} colonies (${r.abandonedCount} abandoned). Odds, not guarantees.`);
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// GLEANING — expeditions to abandoned colonies (design/abandoned-colonies-world-map.md §3)
// ---------------------------------------------------------------------------

/** Begin a gleaning expedition to an abandoned colony. No battle — no defenders. */
export function beginGleaning(state: GameState, key: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const res = beginGleanRun(wm, key, now);
  if (!res.ok) return fail(res.error ?? "Could not begin gleaning.");
  const colony = wm.known[key]!;
  log(state, `⛏️ Gleaning expedition ${res.run!.id} out to ${colony.ownerName}'s colony — returns in 2 hours.`);
  return { ok: true, state };
}

/** Resolve a completed gleaning expedition: transfer loot to the player. */
export function resolveGleaning(state: GameState, runId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const res = resolveGleanRun(wm, runId, now);
  if (!res.ok) return fail(res.error ?? "Could not resolve gleaning.");
  
  const taken = res.lootTaken!;
  const colony = res.colony!;
  
  // Transfer to player resources
  const r = state.resources;
  // Alliance tithe (owner 2026-10-03): % of gleaned supplies auto-flows to shipyard.
  const myAllianceGlean = allianceOf(state, state.gameId ?? "");
  const titheRateGlean = myAllianceGlean?.titheRate ?? 0;
  const { tithed: tithedGlean, kept: keptGlean } = applyTithe(titheRateGlean, {
    supplies: taken.supplies,
    alloys: 0,
    raceMats: 0,
  });
  if (myAllianceGlean && tithedGlean.supplies > 0) {
    const syGlean = ensureShipyard(myAllianceGlean);
    const spGlean = ensureStockpile(syGlean);
    spGlean.supplies += tithedGlean.supplies;
  }
  r.supplies += keptGlean.supplies;
  r.embers += taken.embers;
  r.gas += taken.fuel; // fuel → gas (vehicle fuel)
  r.battery += taken.battery;
  r.medkit += taken.medkit;
  r.hazmat += taken.hazmat;
  r.shots += taken.shots;
  // mechkit/armorkit: map to existing resource types
  // (mechkit → skmech is a stretch; for now, bank them as supplies equivalent)
  // Actually, let's be honest: these are distinct items. For v1, add to supplies as "salvage value"
  const salvageValue = taken.mechkit + taken.armorkit;
  r.supplies += salvageValue;
  
  const total = lootTotal(taken);
  if (total > 0) {
    log(state, `⛏️ Gleaning expedition ${runId} returned from ${colony.ownerName}'s colony with ${taken.supplies} supplies, ${taken.embers} embers, and more.`);
  } else {
    log(state, `⛏️ Gleaning expedition ${runId} returned from ${colony.ownerName}'s colony — nothing left to take.`);
  }
  
  if (colony.status === "husk") {
    log(state, `💀 ${colony.ownerName}'s colony is now a husk — fully gleaned.`);
  }
  
  return { ok: true, state };
}

/** Hire the mercenary band camped at an abandoned colony. Costs supplies. */
export function hireGleanMercenaries(state: GameState, key: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  if (!colony) return fail("That colony isn't on your map.");
  if (colony.status !== "abandoned") return fail("Mercenaries only camp at abandoned colonies.");
  
  const band = colony.mercenaries ?? null;
  if (!band) return fail("No mercenary band at that colony — already hired or none deserted.");
  
  // Calculate hire cost (using the band's hireCost function)
  // For now, use a simple supplies cost based on band size
  // TODO: Import hireCost from war/troops and use proper calculation
  const bandSize = band.cohorts.reduce((n, c) => n + c.count, 0);
  const cost = bandSize * 10; // 10 supplies per troop (tunable)
  
  if (state.resources.supplies < cost) {
    return fail(`Hiring that band needs ${cost} supplies. You have ${Math.floor(state.resources.supplies)}.`);
  }
  
  state.resources.supplies -= cost;
  // TODO: Add troops to player's roster (needs TroopHome reference)
  // For now, just mark the band as hired and log
  colony.mercenaries = null;
  
  log(state, `⚔️ Hired ${bandSize} mercenaries from ${colony.ownerName}'s abandoned colony (${cost} supplies).`);
  
  // Check if now a husk
  const loot = colony.loot ?? EMPTY_LOOT;
  if (isHusk(loot, null)) {
    colony.status = "husk";
    log(state, `💀 ${colony.ownerName}'s colony is now a husk — fully gleaned.`);
  }
  
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// RAIDS — cross-server raiding parties (design/abandoned-colonies-world-map.md §§5,13; game/raids.ts)
// ---------------------------------------------------------------------------

/** All ships the player can put on a raid: personal scouts + alliance fleet. */
function raidableShips(state: GameState): { id: string; class: ShipClass; status: string; setStatus: (s: "ready" | "deployed") => void }[] {
  const out: { id: string; class: ShipClass; status: string; setStatus: (s: "ready" | "deployed") => void }[] = [];
  const psy = state.worldMap?.shipyard;
  if (psy) {
    for (const s of psy.ships) {
      out.push({ id: s.id, class: s.class, status: s.status, setStatus: (st) => { s.status = st; } });
    }
  }
  const alliance = allianceOf(state, myColonyId(state));
  if (alliance) {
    const sy = ensureShipyard(alliance);
    for (const s of sy.ships) {
      out.push({ id: s.id, class: s.class, status: s.status, setStatus: (st) => { s.status = st; } });
    }
  }
  return out;
}

function findRaid(state: GameState, raidId: string): RaidParty | undefined {
  return ensureWorldMap(state).raids.find((r) => r.id === raidId);
}

/** Claim a husk as a sub colony (owner 2026-10-03). Planet-locked, 24h setup. */
export function claimHusk(state: GameState, key: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const res = claimHuskPure(state, key, now);
  if (!res.ok) return { ok: false, error: res.error, state };
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  log(state, `🏚️ Claimed ${colony?.ownerName ?? "a husk"} as a sub colony — 24h setup. First come, first serve.`);
  return { ok: true, state };
}

/** Ship a 1,000-supply upkeep shipment to a sub colony (owner 2026-10-03). */
export function shipSubColonySupplies(state: GameState, key: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const res = shipSubColonySuppliesPure(state, key, now);
  if (!res.ok) return { ok: false, error: res.error, state };
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  log(state, `🚚 Shipped 1,000 supplies to sub colony ${colony?.ownerName ?? key} — next shipment due in 24h.`);
  return { ok: true, state };
}

/** Muster troops at an active sub colony (owner 2026-10-03): troops only,
 *  owner's research level, 2x build speed. */
export function musterSubColonyTroops(state: GameState, key: string, type: string, count: number, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const res = enqueueSubColonyMusterPure(state, key, type, count, now);
  if (!res.ok) return { ok: false, error: res.error, state };
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  log(state, `⚔️ Mustering ${count} ${type} at sub colony ${colony?.ownerName ?? key} — 2x speed.`);
  return { ok: true, state };
}

/** Mailbox: mark one message read (owner 2026-10-03). */
export function markMailRead(state: GameState, mailId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!markRead(state, mailId)) return { ok: false, error: "Message not found.", state };
  return { ok: true, state };
}

/** Mailbox: mark all messages read (owner 2026-10-03). */
export function markAllMailRead(state: GameState, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  markAllRead(state);
  return { ok: true, state };
}

/** Mailbox: delete a message (owner 2026-10-03). */
export function deleteMailMsg(state: GameState, mailId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!deleteMail(state, mailId)) return { ok: false, error: "Message not found.", state };
  return { ok: true, state };
}

/** Form a raiding party (leader = you). */
export function createRaid(state: GameState, now = Date.now()): { ok: boolean; error?: string; state: GameState; raidId?: string } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const raid = createRaidParty(myColonyId(state), state.playerName, wm.seq);
  wm.seq += 1;
  wm.raids.push(raid);
  log(state, `⚔️ Raid party ${raid.id} forming — max 5. Pick a target on the world map, load ships and troops.`);
  return { ok: true, state, raidId: raid.id };
}

/** Join a raid party via invite code (multiplayer). The joiner must be on the
 *  same world as the raid leader (parties are per-world; cross-server raiding
 *  is the raid itself, not the party). */
export function joinRaidByCode(
  state: GameState,
  inviteCode: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; raidId?: string } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const code = (inviteCode || "").trim().toUpperCase();
  if (!code) return fail("Enter the raid's invite code.");
  const raid = wm.raids.find((r) => r.inviteCode === code);
  if (!raid) return fail("No raid party found with that code — check with the leader.");
  const me = myColonyId(state);
  const res = joinRaidPartyPure(raid, me, state.playerName);
  if (!res.ok) return { ok: false, error: res.error, state };
  log(state, `⚔️ Joined ${raid.id} (${raid.leaderName}'s party) — ${raid.memberIds.length}/${RAID_MAX_MEMBERS} raiders.`);
  return { ok: true, state, raidId: raid.id };
}

/** Point a preparing raid at a known active colony. */
export function setRaidTarget(state: GameState, raidId: string, key: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const wm = ensureWorldMap(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const colony = wm.known[key];
  if (!colony) return fail("That colony isn't on your map — scout it first.");
  // SUB COLONY (owner 2026-10-03): rivals can raid sub colonies — a decisive
  // win seizes them. You can't raid your own.
  const isRivalSub = colony.status === "sub_colony" && colony.subClaim?.claimedBy !== (state.gameId ?? "");
  if (colony.status !== "active" && !isRivalSub) {
    if (colony.status === "sub_colony") return fail("That's YOUR sub colony — you can't raid yourself.");
    return fail("Raids hit ACTIVE colonies. That one's " + colony.status + " — glean it instead.");
  }
  const res = setRaidTargetPure(raid, colony.serverId, colony.id, colony.ownerName);
  if (!res.ok) return fail(res.error ?? "Could not set the target.");
  log(state, `🎯 ${raid.id} targeting ${colony.ownerName}'s colony on ${colony.serverId}.`);
  return { ok: true, state };
}

/** Clear a preparing raid's target (owner 2026-10-04: every action needs a
 *  visible button — a set target must be clearable/changeable). */
export function clearRaidTarget(state: GameState, raidId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = clearRaidTargetPure(raid);
  if (!res.ok) return fail(res.error ?? "Could not clear the target.");
  log(state, `🎯 ${raid.id} target cleared — pick a colony on the map.`);
  return { ok: true, state };
}

/** Assign ready jump ships to a preparing raid. */
export function assignRaidShips(state: GameState, raidId: string, shipIds: string[], now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  if (raid.status !== "preparing") return fail("Ships lock when the raid launches.");
  const fleet = raidableShips(state);
  const picked: { id: string; class: ShipClass }[] = [];
  for (const id of shipIds) {
    const s = fleet.find((f) => f.id === id);
    if (!s) return fail("Ship not found in your fleet.");
    if (s.status !== "ready") return fail("That ship isn't ready — it's building, deployed, or stranded.");
    if (picked.some((p) => p.id === id)) return fail("Ship assigned twice.");
    picked.push({ id: s.id, class: s.class });
  }
  if (picked.length === 0) return fail("Assign at least one ship.");
  raid.shipIds = picked.map((p) => p.id);
  raid.shipClasses = picked.map((p) => p.class);
  log(state, `🚀 ${raid.id}: ${picked.length} ship${picked.length === 1 ? "" : "s"} assigned.`);
  return { ok: true, state };
}

/** Load troops onto the raid's ships (moves them OUT of the home roster). */
export function loadRaidTroops(state: GameState, raidId: string, type: TroopType, count: number, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  ensureTroops(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const n = Math.trunc(count);
  if (!(n > 0)) return fail("Load at least one troop.");
  const roster = state.troops!.home.roster;
  const have = roster.cohorts.filter((c) => c.type === type).reduce((a, c) => a + c.count, 0);
  if (have < n) return fail(`You only have ${have} ${type} mustered.`);
  const res = commitRaidTroopsPure(raid, myColonyId(state), type, n);
  if (!res.ok) return fail(res.error ?? "Could not load troops.");
  removeTroopsNewestFirst(roster, n, type);
  log(state, `⚔️ ${raid.id}: ${n} ${type} loaded. What you carry is all you have.`);
  return { ok: true, state };
}

/** Load supplies onto the raid (owner 2026-10-03): for hiring deserters,
 *  field expenses. Supplies move OUT of home stockpile — what you carry
 *  is all you have. */
export function loadRaidSupplies(state: GameState, raidId: string, amount: number, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  if (raid.status !== "preparing") return fail("Supplies lock when the raid launches.");
  const n = Math.trunc(amount);
  if (!(n > 0)) return fail("Load at least 1 supply.");
  if (state.resources.supplies < n) return fail(`You only have ${Math.floor(state.resources.supplies)} supplies.`);
  // Cargo check: supplies take cargo space (1 supply = 1 cargo)
  const cargoUsed = raidTroopCapacity(raid) + (raid.supplies ?? 0);
  const cargoMax = raidLootCapacity(raid);
  if (cargoUsed + n > cargoMax) return fail(`Not enough cargo space. ${cargoMax - cargoUsed} free.`);
  state.resources.supplies -= n;
  raid.supplies = (raid.supplies ?? 0) + n;
  log(state, `📦 ${raid.id}: ${n} supplies loaded. For deserters, emergencies, the unknown.`);
  return { ok: true, state };
}

/** Launch the raid: pay the jump charge, ships deploy, party goes in_transit. */
export function launchRaid(state: GameState, raidId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const blocker = raidLaunchBlocker(raid);
  if (blocker) return fail(blocker);
  const charge = raidJumpCharge(raid);
  if (state.resources.gas < charge.fuel) {
    return fail(`The jump needs ${charge.fuel} fuel. You have ${Math.floor(state.resources.gas)}.`);
  }
  if (state.resources.supplies < charge.supplies) {
    return fail(`The jump needs ${charge.supplies} supplies. You have ${Math.floor(state.resources.supplies)}.`);
  }
  // Mark ships deployed
  const fleet = raidableShips(state);
  for (const id of raid.shipIds) {
    const s = fleet.find((f) => f.id === id);
    if (!s || s.status !== "ready") return fail("A assigned ship isn't ready anymore — reassign.");
  }
  state.resources.gas -= charge.fuel;
  state.resources.supplies -= charge.supplies;
  for (const id of raid.shipIds) fleet.find((f) => f.id === id)!.setStatus("deployed");
  raid.status = "in_transit";
  raid.departedAt = now;
  raid.landsAt = now + RAID_TRAVEL_MS;
  log(state, `🚀 ${raid.id} JUMPED for ${raid.targetOwnerName}'s colony — touchdown in ~1 minute. The defender will be warned.`);
  return { ok: true, state };
}

/** Commit the player's tactical deployment after touchdown (owner 2026-10-03).
 *  The battle resolves on the next advanceRaids tick. */
export function deployRaid(
  state: GameState,
  raidId: string,
  deployment: Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>,
  shipsHoldOrbit: boolean,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = deployRaidTroops(raid, deployment, shipsHoldOrbit);
  if (!res.ok) return fail(res.error ?? "Deployment failed.");
  log(state, `⚔️ ${raid.id} DEPLOYED — troops committed to their vectors. The battle begins.`);
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// FORMATIONS — raid loadouts, exploration loadouts, response teams
// (owner 2026-10-04: "don't be afraid to make pages").
// A formation is a pre-built battle group ready to roll: ships reserved,
// troops loaded, supplies staged, hero leader assigned.
// ---------------------------------------------------------------------------

/** Additive init — old saves get an empty formations roster, never a wipe. */
export function ensureFormations(state: GameState): { formations: Formation[]; seq: number } {
  const s = state as unknown as { formations?: { formations: Formation[]; seq: number } };
  if (!s.formations || !Array.isArray(s.formations.formations)) {
    s.formations = emptyFormationsState();
  }
  return s.formations;
}

// WAR ROOM (owner 2026-10-06) — the commander's battle-formation library.
// Locked-down formations are the only ones selectable on deploy.

/** Additive init — old saves get an empty war room, never a wipe. */
export function ensureWarRoom(state: GameState): import("./war/playbook").WarRoomState {
  const s = state as unknown as { warRoom?: import("./war/playbook").WarRoomState };
  if (!s.warRoom || !Array.isArray(s.warRoom.formations)) {
    s.warRoom = emptyWarRoomState();
  }
  return s.warRoom;
}

function findFormation(state: GameState, formationId: string): Formation | undefined {
  return ensureFormations(state).formations.find((f) => f.id === formationId);
}

/** All heroes available as formation leaders (prologue heroes + leaders). */
export function formationLeaderRoster(state: GameState): { id: string; name: string; kind: "hero" | "leader" }[] {
  const out: { id: string; name: string; kind: "hero" | "leader" }[] = [];
  for (const h of state.prologue?.heroes ?? []) {
    out.push({ id: h.id, name: h.name, kind: "hero" });
  }
  for (const l of state.leaders ?? []) {
    out.push({ id: l.id, name: l.name, kind: "leader" });
  }
  return out;
}

/** True if the hero already leads a standby formation. */
function heroLeadingFormation(state: GameState, heroId: string, exceptId?: string): Formation | undefined {
  return ensureFormations(state).formations.find(
    (f) => f.heroId === heroId && f.status === "standby" && f.id !== exceptId,
  );
}

/** Create a formation. The hero leader is REQUIRED — no hero, no formation. */
export function createFormation(
  state: GameState,
  name: string,
  type: FormationType,
  heroId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; formationId?: string } {
  advance(state, now);
  const roster = formationLeaderRoster(state);
  const hero = roster.find((h) => h.id === heroId);
  if (!hero) {
    return fail("Pick a hero to lead the formation — a formation doesn't march without one.");
  }
  const busy = heroLeadingFormation(state, heroId);
  if (busy) {
    return fail(`${hero.name} already leads "${busy.name}" — one hero, one formation.`);
  }
  const fs = ensureFormations(state);
  const res = createFormationPure(name, type, heroId, hero.name, fs.seq, now);
  if (!res.ok || !res.formation) return fail(res.error ?? "Could not create the formation.");
  fs.seq += 1;
  fs.formations.push(res.formation);
  log(state, `🛡️ Formation "${res.formation.name}" mustered under ${hero.name}. Reserve ships and load troops — it's on standby.`);
  return { ok: true, state, formationId: res.formation.id };
}

/** Find a jump ship by id across personal + alliance fleets. */
function findFleetShip(state: GameState, shipId: string): { id: string; class: ShipClass; status: string; setStatus: (s: "ready" | "reserved" | "deployed") => void } | undefined {
  const out: { id: string; class: ShipClass; status: string; setStatus: (s: "ready" | "reserved" | "deployed") => void }[] = [];
  const psy = state.worldMap?.shipyard;
  if (psy) {
    for (const s of psy.ships) {
      out.push({ id: s.id, class: s.class, status: s.status, setStatus: (st) => { s.status = st; } });
    }
  }
  const alliance = allianceOf(state, myColonyId(state));
  if (alliance) {
    const sy = ensureShipyard(alliance);
    for (const s of sy.ships) {
      out.push({ id: s.id, class: s.class, status: s.status, setStatus: (st) => { s.status = st; } });
    }
  }
  return out.find((s) => s.id === shipId);
}

/** Reserve a ready jump ship into a standby formation. */
export function assignFormationShip(
  state: GameState,
  formationId: string,
  shipId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  const ship = findFleetShip(state, shipId);
  if (!ship) return fail("Ship not found in your fleet.");
  if (ship.status !== "ready") {
    return fail(
      ship.status === "reserved"
        ? "That ship is already reserved — release it from its formation first."
        : "That ship isn't ready — it's building, deployed, or stranded.",
    );
  }
  const res = assignFormationShipPure(f, ship.id, ship.class);
  if (!res.ok) return fail(res.error ?? "Could not reserve the ship.");
  ship.setStatus("reserved");
  log(state, `🚀 "${f.name}": ${ship.class} reserved and on standby.`);
  return { ok: true, state };
}

/** Release a ship from a formation: troops return home, ship goes ready. */
export function removeFormationShip(
  state: GameState,
  formationId: string,
  shipId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  ensureTroops(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  const res = removeFormationShipPure(f, shipId);
  if (!res.ok || !res.removed) return fail(res.error ?? "Could not release the ship.");
  // Troops on the ship return to the home roster.
  const roster = state.troops!.home.roster;
  for (const [t, c] of Object.entries(res.removed.troops) as [TroopType, number][]) {
    if ((c ?? 0) > 0) addCohort(roster, t, c!, now);
  }
  const ship = findFleetShip(state, shipId);
  if (ship) ship.setStatus("ready");
  log(state, `🚀 "${f.name}": ship released back to ready. Its troops stood down home.`);
  return { ok: true, state };
}

/** Load troops onto one of the formation's ships (moves them OUT of home). */
export function loadFormationTroops(
  state: GameState,
  formationId: string,
  shipId: string,
  type: TroopType,
  count: number,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  ensureTroops(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  const n = Math.trunc(count);
  if (!(n > 0)) return fail("Load at least one troop.");
  const roster = state.troops!.home.roster;
  const have = roster.cohorts.filter((c) => c.type === type).reduce((a, c) => a + c.count, 0);
  if (have < n) return fail(`You only have ${have} ${type} mustered at home.`);
  const res = loadFormationShipTroopsPure(f, shipId, type, n);
  if (!res.ok) return fail(res.error ?? "Could not load troops.");
  removeTroopsNewestFirst(roster, n, type);
  log(state, `⚔️ "${f.name}": ${n} ${type} loaded. What the formation carries is committed.`);
  return { ok: true, state };
}

/** Unload troops from a formation ship back to the home roster. */
export function unloadFormationTroops(
  state: GameState,
  formationId: string,
  shipId: string,
  type: TroopType,
  count: number,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  ensureTroops(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  const res = unloadFormationShipTroopsPure(f, shipId, type, count);
  if (!res.ok) return fail(res.error ?? "Could not unload troops.");
  const roster = state.troops!.home.roster;
  addCohort(roster, type, res.unloaded!, now);
  log(state, `⚔️ "${f.name}": ${res.unloaded} ${type} stood down home.`);
  return { ok: true, state };
}

/** Stage supplies with the formation (moves them OUT of home stockpile). */
export function stageFormationSupplies(
  state: GameState,
  formationId: string,
  amount: number,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  if (f.status !== "standby") return fail("That formation already deployed — no changes.");
  const n = Math.trunc(amount);
  if (!(n > 0)) return fail("Stage at least 1 supply.");
  if (state.resources.supplies < n) return fail(`You only have ${Math.floor(state.resources.supplies)} supplies.`);
  state.resources.supplies -= n;
  f.supplies += n;
  log(state, `📦 "${f.name}": ${n} supplies staged. For deserters, emergencies, the unknown.`);
  return { ok: true, state };
}

/** Return staged supplies to the home stockpile. */
export function unstageFormationSupplies(
  state: GameState,
  formationId: string,
  amount: number,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  if (f.status !== "standby") return fail("That formation already deployed — no changes.");
  const n = Math.trunc(amount);
  if (!(n > 0)) return fail("Return at least 1 supply.");
  const take = Math.min(f.supplies, n);
  if (take <= 0) return fail("No staged supplies to return.");
  f.supplies -= take;
  state.resources.supplies += take;
  log(state, `📦 "${f.name}": ${take} supplies returned to the stockpile.`);
  return { ok: true, state };
}

/** Delete a standby formation: ships go ready, troops and supplies go home. */
export function deleteFormation(
  state: GameState,
  formationId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  ensureTroops(state, now);
  const fs = ensureFormations(state);
  const i = fs.formations.findIndex((x) => x.id === formationId);
  if (i < 0) return fail("Formation not found.");
  const f = fs.formations[i];
  if (f.status !== "standby") return fail("That formation already deployed — it's with its raid.");
  // Return everything.
  const roster = state.troops!.home.roster;
  for (const s of f.ships) {
    for (const [t, c] of Object.entries(s.troops) as [TroopType, number][]) {
      if ((c ?? 0) > 0) addCohort(roster, t, c!, now);
    }
    const ship = findFleetShip(state, s.shipId);
    if (ship) ship.setStatus("ready");
  }
  if (f.supplies > 0) state.resources.supplies += f.supplies;
  fs.formations.splice(i, 1);
  log(state, `🛡️ Formation "${f.name}" disbanded. Ships ready, troops and supplies home.`);
  return { ok: true, state };
}

/** Deploy a standby formation as a raid party: the raid is created
 *  pre-loaded with the formation's ships, troops, and supplies, led by the
 *  formation's hero. The player then picks a target on the world map and
 *  launches — the raid flow takes it from there. */
export function deployFormationAsRaid(
  state: GameState,
  formationId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; raidId?: string } {
  advance(state, now);
  const f = findFormation(state, formationId);
  if (!f) return fail("Formation not found.");
  const blocker = formationDeployBlocker(f);
  if (blocker) return fail(blocker);
  const wm = ensureWorldMap(state, now);
  const raid = createRaidParty(myColonyId(state), state.playerName, wm.seq);
  wm.seq += 1;
  // Hand off the formation's ships, troops, and supplies.
  raid.shipIds = f.ships.map((s) => s.shipId);
  raid.shipClasses = f.ships.map((s) => s.class);
  raid.troops = { [myColonyId(state)]: formationTroopsByType(f) };
  raid.supplies = f.supplies;
  raid.formationId = f.id;
  raid.heroId = f.heroId;
  raid.heroName = f.heroName;
  // Ships go from reserved to deployed; the formation is consumed.
  for (const s of f.ships) {
    const ship = findFleetShip(state, s.shipId);
    if (!ship || ship.status !== "reserved") {
      return fail("A reserved ship isn't reserved anymore — re-reserve it first.");
    }
  }
  for (const s of f.ships) findFleetShip(state, s.shipId)!.setStatus("deployed");
  f.ships = [];
  f.supplies = 0;
  f.status = "deployed";
  wm.raids.push(raid);
  log(state, `⚔️ "${f.name}" DEPLOYED as ${raid.id} under ${f.heroName} — pick a target on the world map, then launch.`);
  return { ok: true, state, raidId: raid.id };
}

/** Retire a formation when its raid finishes (called from raid completion).
 *  The raid's own completion already returned troops and ships home. */
export function retireFormationForRaid(state: GameState, raidId: string): void {
  const wm = state.worldMap;
  const raid = wm?.raids?.find((r) => r.id === raidId);
  if (!raid?.formationId) return;
  const fs = ensureFormations(state);
  const i = fs.formations.findIndex((x) => x.id === raid.formationId);
  if (i >= 0) {
    const [f] = fs.formations.splice(i, 1);
    log(state, `🛡️ Formation "${f.name}" stood down — its raid is home. Muster a new one when you're ready.`);
  }
}

/** Issue one round of tactical orders for a raid battle (owner 2026-10-03).
 *  The defender is driven by the deterministic AI. */
export function tacticalRaidRound(
  state: GameState,
  raidId: string,
  orders: Partial<Record<ManeuverVector, { order: string; target?: ManeuverVector; count?: number; orbitalStrike?: ManeuverVector }>>,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = tacticalRaidRoundPure(raid, orders as Parameters<typeof tacticalRaidRoundPure>[1], now);
  if (!res.ok) return fail(res.error ?? "Couldn't resolve the round.");
  const battle = raid.tacticalBattle;
  if (battle && battle.status !== "active") {
    log(state, `⚔️ ${raid.id} — the battle is decided after ${battle.round} rounds.`);
  }
  return { ok: true, state };
}

/** Quick-resolve a tactical raid battle (owner 2026-10-03): auto-play the
 *  remaining rounds with hold/hold orders. For commanders who can't stay. */
export function quickResolveTacticalRaid(
  state: GameState,
  raidId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = quickResolveTacticalRaidPure(raid, now);
  if (!res.ok) return fail(res.error ?? "Couldn't quick-resolve the battle.");
  if (!res.ok) return fail(res.error ?? "Couldn't quick-resolve the battle.");
  log(state, `⚔️ ${raid.id} — quick-resolved. The battle is decided.`);
  return { ok: true, state };
}

/** Hire the deserter band waiting at a raid (owner 2026-10-03).
 *  Supplies come from the raid's cargo; troops join the raid on the ground. */
export function hireRaidDeserters(
  state: GameState,
  raidId: string,
  bandId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = hireRaidDesertersPure(raid, bandId);
  if (!res.ok) return fail(res.error ?? "Couldn't hire the deserters.");
  const n = raid.deserters ? deserterBandCount(raid.deserters) : 0;
  log(state, `🤝 ${raid.id} — hired ${n.toLocaleString()} deserters. They fight with you now.`);
  return { ok: true, state };
}

/** Dismiss the deserter band waiting at a raid (owner 2026-10-03). */
export function dismissRaidDeserters(
  state: GameState,
  raidId: string,
  bandId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const raid = findRaid(state, raidId);
  if (!raid) return fail("Raid party not found.");
  const res = dismissRaidDesertersPure(raid, bandId);
  if (!res.ok) return fail(res.error ?? "Couldn't dismiss the deserters.");
  log(state, `🚶 ${raid.id} — the deserters were turned away. They melt back into the wilds.`);
  return { ok: true, state };
}

/** Advance raids: in_transit → landed (warn + battle) → returning → done (deliver). */
export function advanceRaids(state: GameState, now: number): void {
  const wm = state.worldMap;
  if (!wm || wm.raids.length === 0) return;
  ensureTroops(state, now);
  const weights = {} as Record<TroopType, number>;
  for (const t of ["bulwark", "reaver", "longeye", "thunder", "warden"] as TroopType[]) {
    weights[t] = supplyWeight(t);
  }

  for (const raid of wm.raids) {
    // --- touchdown: warn the defender, wait for player deployment (owner 2026-10-03) ---
    if (raid.status === "in_transit" && raid.landsAt != null && now >= raid.landsAt) {
      const troops = raidTroopCount(raid);
      wm.raidWarnings.push({
        raidId: raid.id,
        attackerNames: [...raid.memberNames],
        shipCount: raid.shipIds.length,
        troopCount: troops,
        landedAt: now,
        targetColonyId: raid.targetColonyId,
        seen: false,
      });

      // Player deploys troops tactically — battle waits for their orders.
      raid.status = "deploying";
      // Default: ships hold in orbit (safe). Player can change this in the deployment UI.
      if (raid.shipsHoldOrbit === undefined) raid.shipsHoldOrbit = true;
      // Deserter encounter (owner 2026-10-03): a mercenary band may be waiting.
      const band = rollDeserterEncounter(raid);
      if (band) {
        raid.deserters = band;
        log(state, `🏕️ ${raid.id} — a deserter band (${deserterBandCount(band).toLocaleString()} sellswords) wants to join your raid. They'll name their price.`);
      }
      const names = raid.memberNames.join(", ");
      log(state, `🛬 ${raid.id} TOUCHDOWN — ${names} are on the ground at ${raid.targetOwnerName}'s colony. Deploy your troops to attack.`);
    }

    // --- tactical battle: the player commands it round by round ---
    // (owner 2026-10-03: no more auto-resolve — touchdown → deploy →
    //  issue orders each round until one side breaks.)
    if (raid.status === "tactical" && raid.deployment) {
      // Defender strength: what the map knows (approx troops from the visit).
      // SUB COLONY (owner 2026-10-03): a raid against a sub colony fights its
      // REAL garrison — no fog here, the sub's troops are on the ground.
      const key = `${raid.targetServerId}:${raid.targetColonyId}`;
      const colony = wm.known[key];
      const isSubTarget = colony?.status === "sub_colony";
      const defenderTroops = isSubTarget
        ? subColonyTroopCountPure(colony!)
        : (colony?.approxTroops ?? 1000);
      const defenderLoot = mockDefenderLoot(raid.targetColonyId);

      // Start the battle if it hasn't begun yet.
      if (!raid.tacticalBattle) {
        // Leader battle role (owner 2026-10-04): the raid's hero leader
        // drives the battle — resolve their specialty from the roster.
        const heroLeader = (state.leaders ?? []).find((l) => l.id === raid.heroId);
        const started = startTacticalRaidBattle(raid, defenderTroops, now, heroLeader?.specialty);
        if (started.ok) {
          const names = raid.memberNames.join(", ");
          log(state, `⚔️ ${raid.id} — the battle for ${raid.targetOwnerName}'s colony begins. ${names}, issue your orders.`);
        }
        continue; // wait for the player's first orders
      }
      const battle = raid.tacticalBattle;
      if (battle.status === "active") continue; // battle in progress — player issues orders via tacticalRaidRound

      // Battle's over — convert the tactical result into raid results.
      const result = tacticalRaidResult(raid, defenderLoot);

      raid.won = result.won;
      raid.attackerLosses = result.attackerLosses;
      raid.defenderLosses = result.defenderLosses;
      raid.lootTaken = result.lootTaken;

      // Defender bleeds on the map record (reverb drops — the threat board moves).
      // SUB COLONY: casualties come out of the real garrison roster.
      if (colony && isSubTarget) {
        bleedSubColonyTroopsPure(colony, result.defenderLosses);
      } else if (colony && colony.approxTroops != null) {
        colony.approxTroops = Math.max(0, colony.approxTroops - result.defenderLosses);
      }

      // SUB COLONY SEIZURE (owner 2026-10-03): a decisive win against a sub
      // colony transfers it to the raid leader — "you lose what's there; the
      // taker gets it at THEIR research/build level." Main colony untouched.
      if (colony && isSubTarget && result.decisive) {
        const seized = seizeSubColonyPure(state, key, raid.leaderId, raid.leaderName, now);
        if (seized.ok) {
          log(state, `🏴 ${raid.leaderName} SEIZED the sub colony at ${key} — decisive victory. The old garrison is gone; it now musters at ${raid.leaderName}'s research level.`);
        }
      }

      // Survivors stay with the raid for the return leg.
      for (const [t, lost] of Object.entries(result.attackerLosses) as [TroopType, number][]) {
        let remaining = lost;
        for (const mid of Object.keys(raid.troops)) {
          if (remaining <= 0) break;
          const have = raid.troops[mid][t] ?? 0;
          const cut = Math.min(have, remaining);
          raid.troops[mid][t] = have - cut;
          if (raid.troops[mid][t] === 0) delete raid.troops[mid][t];
          remaining -= cut;
        }
      }

      raid.status = "returning";
      raid.returnedAt = now + RAID_TRAVEL_MS;
      // Cross-server: flag the battle result for delivery to the defender's
      // server. The api layer picks this up and POSTs to /api/raid-result.
      raid.resultPendingDelivery = true;
      // MEMORIALS (owner 2026-09-30): a raid battle with 1,000+ total
      // casualties earns a permanent plaque. Idempotent: dedupe on raid id.
      ensureMemorials(state);
      const raidAttackerLosses = Object.values(result.attackerLosses).reduce(
        (s, n) => s + Math.max(0, Math.floor(n ?? 0)),
        0,
      );
      if (
        qualifiesForMemorial(raidAttackerLosses, result.defenderLosses) &&
        !findMemorialByBattle((state as any).memorials, raid.id)
      ) {
        const raidPlaque = createMemorial({
          battleId: raid.id,
          nodeId: `${raid.targetServerId}:${raid.targetColonyId}`,
          siteName: `${raid.targetOwnerName}'s colony`,
          season: currentSeason(now).name,
          attackerName: raid.memberNames.join(", "),
          defenderName: raid.targetOwnerName,
          attackerLosses: raidAttackerLosses,
          defenderLosses: result.defenderLosses,
          victor: result.won ? "attacker" : "defender",
          at: now,
        });
        if (raidPlaque) (state as any).memorials.push(raidPlaque);
      }
      const names = raid.memberNames.join(", ");
      if (result.won) {
        log(state, `⚔️ ${raid.id} TOUCHDOWN — ${names} hit ${raid.targetOwnerName}'s colony and took loot. Defender warned. Exfil in ~1 minute.`);
      } else {
        log(state, `⚔️ ${raid.id} TOUCHDOWN — ${names} hit ${raid.targetOwnerName}'s colony and were repelled. Defender warned. Survivors exfil in ~1 minute.`);
      }
    }

    // --- homecoming: deliver loot, return survivors + ships ---
    if (raid.status === "returning" && raid.returnedAt != null && now >= raid.returnedAt) {
      const loot = raid.lootTaken ?? { ...EMPTY_RAID_LOOT };
      const r = state.resources;
      // Alliance tithe (owner 2026-10-03): % of loot auto-flows to shipyard.
      const myAlliance = allianceOf(state, state.gameId ?? "");
      const titheRate = myAlliance?.titheRate ?? 0;
      const { tithed, kept } = applyTithe(titheRate, {
        supplies: loot.supplies,
        alloys: 0, // raids don't yield alloys in v1
        raceMats: 0, // raids don't yield race mats in v1
      });
      if (myAlliance && (tithed.supplies > 0)) {
        const sy = ensureShipyard(myAlliance);
        const sp = ensureStockpile(sy);
        sp.supplies += tithed.supplies;
      }
      r.supplies += kept.supplies;
      r.embers += loot.embers;
      r.gas += loot.fuel;
      r.battery += loot.battery;
      r.medkit += loot.medkit;
      r.hazmat += loot.hazmat;
      r.shots += loot.shots;
      // mechkit/armorkit have no resource slot — bank as salvage (supplies).
      r.supplies += loot.mechkit + loot.armorkit;

      // Survivors rejoin the home roster.
      const roster = state.troops!.home.roster;
      let survivors = 0;
      for (const byType of Object.values(raid.troops)) {
        for (const [t, c] of Object.entries(byType) as [TroopType, number][]) {
          if ((c ?? 0) > 0) { addCohort(roster, t, c!, now); survivors += c!; }
        }
      }

      // Ships come home.
      const fleet = raidableShips(state);
      for (const id of raid.shipIds) {
        const s = fleet.find((f) => f.id === id);
        if (s) s.setStatus("ready");
      }

      raid.status = "done";
      // FORMATIONS (owner 2026-10-04): a raid deployed from a formation
      // retires the formation now that its ships and troops are home.
      retireFormationForRaid(state, raid.id);
      if (raid.won) {
        log(state, `🏴‍☠️ ${raid.id} returned with loot: ${Math.floor(loot.supplies)} supplies, ${Math.floor(loot.embers)} embers, and more. ${survivors} troops came home.`);
      } else {
        log(state, `🏴‍☠️ ${raid.id} limped home — repelled, no loot. ${survivors} survivors.`);
      }
    }
  }
}

/** Resolve a completed satellite climb: set the stage, free the Leader, award
 *  the standard research XP. No breakthrough roll — the sky has no specialty
 *  to align (same carve-out as the soul path and the forge line). */
function resolveSatelliteTech(state: GameState, j: ResearchJob, now: number) {
  const p = parseSatelliteTech(j.techId)!;
  const leader = state.leaders.find((l) => l.id === j.leaderId)!;
  if (leader) {
    leader.assignment = null;
    leader.history.push(`Woke the ${p.nodeId} satellite — stage ${p.stage}`);
  }
  ensureSatellites(state);
  setSatelliteStage(state, p.nodeId, p.stage);
  if (!state.satellites!.restored.includes(j.techId)) {
    state.satellites!.restored.push(j.techId);
  }
  const what = p.stage === 1
    ? "it is ONLINE — arrivals here will sound the alarm"
    : p.stage === 2
      ? "it is TRACKING — the alarm now names who, and roughly how many"
      : "the FULL PICTURE is in — amounts and troop types on every arrival";
  log(state, `🛰️ ${leader ? leader.name : "A leader"} woke the satellite over ${p.nodeId} — stage ${p.stage}: ${what}.`);
  if (leader) researchXp(state, leader, false, now);
  noteDailyEvent(state, "research_complete", now);
}

/** Resolve completed scout probe research: unlock probe building, free the
 *  Leader, award standard research XP. */
function resolveScoutProbeTech(state: GameState, j: ResearchJob, now: number) {
  ensureWorldMap(state);
  const leader = state.leaders.find((l) => l.id === j.leaderId);
  state.worldMap!.scoutTechResearched = true;
  log(state, `🔭 ${leader ? leader.name : "A leader"} completed scout probe research — probes can now be built. One-time eyes on distant worlds.`);
  if (leader) researchXp(state, leader, false, now);
  noteDailyEvent(state, "research_complete", now);
}

/* ── Alliance Ship Factory (design/abandoned-colonies-world-map.md) ── */

/** Get the player's colony id (for alliance membership checks). */
function myColonyId(state: GameState): string {
  return (state as unknown as { colonyId?: string; gameId?: string }).colonyId
    ?? (state as unknown as { gameId?: string }).gameId
    ?? "colony";
}

function myColonyName(state: GameState): string {
  return state.playerName ?? "Commander";
}

/** Order a ship build. Warships need alliance membership; scouts are solo-buildable.
 *  Cost is deducted from the player's resources. */
export function buildShip(
  state: GameState,
  shipClass: ShipClass,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const cost = SHIP_COST[shipClass];
  const r = state.resources;

  // Check resources first (tap-to-explain needs the specific missing resource)
  if (r.supplies < cost.supplies) {
    return fail(`Needs ${cost.supplies.toLocaleString()} supplies. You have ${Math.floor(r.supplies).toLocaleString()}.`);
  }
  const raceId = state.race;
  if (!raceId) return fail("Choose a race first.");
  if ((r.mats[raceId] ?? 0) < cost.raceMaterial) {
    return fail(`Needs ${cost.raceMaterial} of your race material. You have ${r.mats[raceId] ?? 0}. Raid other worlds to gather more.`);
  }
  if (r.alloys < cost.alloys) {
    return fail(`Needs ${cost.alloys} alloys. You have ${r.alloys}. Forge them from race materials.`);
  }

  const needsAlliance = shipNeedsAlliance(shipClass);
  const alliance = allianceOf(state, myColonyId(state));

  if (needsAlliance && !alliance) {
    return fail(`The ${shipName(raceId, shipClass)} needs an alliance ship factory. Scouts are solo-buildable — warships aren't. Join an alliance first.`);
  }

  // Deduct cost
  r.supplies -= cost.supplies;
  r.mats[raceId] -= cost.raceMaterial;
  r.alloys -= cost.alloys;

  const name = shipName(raceId, shipClass);

  if (alliance) {
    const sy = ensureShipyard(alliance);
    const build = createShipBuild(shipClass, raceId, myColonyId(state), myColonyName(state), 0, sy.level, now);
    // The orderer auto-contributes
    build.contributors.push(myColonyId(state));
    build.doneAt = build.startedAt + shipBuildDurationMs(shipClass, 1, sy.level);
    sy.queue.push(build);
    sy.seq += 1;
    alliance.version += 1;
    log(state, `🚀 ${name} ordered at the alliance ship factory. ${build.contributors.length} contributor — more hands build faster.`);
  } else {
    // Solo scout build — personal shipyard on worldMap
    ensureWorldMap(state, now);
    const wm = state.worldMap!;
    if (!wm.shipyard) wm.shipyard = emptyPersonalShipyard();
    const psy = wm.shipyard;
    const build = createShipBuild(shipClass, raceId, myColonyId(state), myColonyName(state), 1, 1, now);
    build.contributors.push(myColonyId(state));
    psy.queue.push(build);
    psy.seq += 1;
    log(state, `🚀 ${name} ordered (solo build). Scouts fly alone — warships need an alliance.`);
  }

  return { ok: true, state };
}

/** Contribute to an alliance ship build (speeds it up). */
export function contributeToShipBuild(
  state: GameState,
  buildId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const alliance = allianceOf(state, myColonyId(state));
  if (!alliance) return fail("Join an alliance to contribute to ship builds.");
  const sy = ensureShipyard(alliance);
  const build = sy.queue.find((b) => b.id === buildId);
  if (!build) return fail("That build isn't in the queue.");
  const me = myColonyId(state);
  if (build.contributors.includes(me)) return fail("You're already on this build crew.");
  build.contributors.push(me);
  recalcBuildDoneAt(build, sy.level, now);
  alliance.version += 1;
  log(state, `🔧 ${myColonyName(state)} joined the ${shipName(build.raceId, build.shipClass)} build crew (${build.contributors.length} hands).`);
  return { ok: true, state };
}

/** Resolve completed ship builds (alliance + personal). Call from advance(). */
export function resolveShipBuilds(state: GameState, now: number): void {
  // Alliance shipyard
  const alliance = allianceOf(state, myColonyId(state));
  if (alliance) {
    const sy = ensureShipyard(alliance);
    const done = sy.queue.filter((b) => buildReady(b, now));
    for (const b of done) {
      const ship = shipFromBuild(b, now);
      sy.ships.push(ship);
      log(state, `🚀 ${ship.name} is ready at the alliance ship factory.`);
      logAllianceActivity(alliance, "ship-built", `🚀 ${ship.name} rolled out of the alliance ship factory.`, { at: now });
    }
    if (done.length > 0) {
      sy.queue = sy.queue.filter((b) => !buildReady(b, now));
      alliance.version += 1;
    }
  }
  // Personal shipyard (solo scouts)
  if (state.worldMap?.shipyard) {
    const psy = state.worldMap.shipyard;
    const done = psy.queue.filter((b) => buildReady(b, now));
    for (const b of done) {
      const ship = shipFromBuild(b, now);
      ship.status = "ready";
      psy.ships.push(ship);
      log(state, `🚀 Your ${ship.name} is ready.`);
    }
    if (done.length > 0) {
      psy.queue = psy.queue.filter((b) => !buildReady(b, now));
    }
  }
}
/**
 * V6 core reconcile: resolve every weapon build whose `doneAt` has passed —
 * exactly once, because each record is CONSUMED on completion. Applies the
 * tier, latches everBuilt, bumps weaponsBuilt (a separate war "might" tally —
 * NOT the contribution formula), fires the durable deed dents
 * (first_weapon_built, weapon_tier4 — each +10 contribution via
 * deedsCompleted, per the heroes §O10 precedent).
 */
export function resolveArmoryBuilds(state: GameState, now: number) {
  if (typeof state.weaponsBuilt !== "number") state.weaponsBuilt = 0;
  for (const familyId of Object.keys(state.armoryBuilds ?? {})) {
    const build = state.armoryBuilds[familyId];
    // TIME TOKENS: `timeTokenMs` brings the EFFECTIVE finish forward; `doneAt` and
    // `startedAt` never move, so the floor is read against the build's own base.
    if (!build || now + (build.timeTokenMs ?? 0) < build.doneAt) continue;
    const cur = armoryFamilyState(state, familyId);
    if (build.targetTier > cur.tier) {
      state.armory[familyId] = { tier: build.targetTier, everBuilt: true };
      state.weaponsBuilt += 1;
      awardDeed(state, "first_weapon_built", 2, "the first weapon leaves the Armory forges");
      if (build.targetTier >= 4) {
        awardDeed(state, "weapon_tier4", 5, "a Tier-4 weapon stands ready — the loudest lesson in the Cradle");
      }
      log(state, `🏛️ The Armory completes ${build.targetTier === 1 ? "building" : "upgrading"} ${familyLabel(state, familyId)} — the ${tierWord(state, build.targetTier)} stands ready.`);
    }
    delete state.armoryBuilds[familyId]; // consumed — exactly once, idempotent re-runs no-op
  }
}

/** Display label for a family (name from the race's catalog; fallback to id). */
function familyLabel(state: GameState, familyId: string): string {
  if (state.race) {
    const fam = familyFor(state.race, familyId);
    if (fam) return fam.name;
  }
  return familyId;
}

/** Tier-line word for the colony's race ("Primer"…"Apocrypha" for Watchers;
 *  each race's language from TIER_LANGUAGES — never hardcoded to Watchers). */
function tierWord(state: GameState, tier: number): string {
  const raceId = state.race ?? "watchers";
  const langs = (TIER_LANGUAGES as Record<string, [string, string, string, string]>)[raceId] ?? TIER_LANGUAGES.watchers;
  return langs[tier - 1] ?? String(tier);
}

/** Model designation for a family at a tier ("The Last Bell — Catechism Mk III"). */
function armoryModel(state: GameState, fam: { name: string; id: string }, tier: number): string {
  const raceId = state.race ?? "watchers";
  const lang = (TIER_LANGUAGES as Record<string, [string, string, string, string]>)[raceId] ?? TIER_LANGUAGES.watchers;
  const mk = ["I", "II", "III", "IV"][tier - 1] ?? String(tier);
  return `${fam.name} — ${lang[tier - 1]} Mk ${mk}`;
}

/**
 * Build (tier 1) or upgrade (tier N → N+1) a weapon family at the Cradle.
 * Commits the §6 cost now and opens a real-time build (one per family, no
 * queue). The family's research unlock must be done (hub + family forge);
 * plasma enters at T2. Everything here is earned resources — no currency.
 */
export function startWeaponBuild(state: GameState, familyId: string, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  const fam = familyFor(state.race, familyId);
  if (!fam) {
    return fail((ARMORY_CATALOG[state.race]?.length ?? 0) === 0
      ? "This world's race has no catalogued war families yet."
      : "Unknown weapon family.");
  }
  if (!hasTech(state, "armory_hub")) {
    return fail("The Armory hasn't been opened. Research 🏛️ Armory in the Lab first.");
  }
  const unlockTech = ARMORY_FAMILY_TECH[fam.id];
  if (!hasTech(state, unlockTech)) {
    const node = getArmoryTech(unlockTech);
    return fail(`The ${fam.name} forges are locked. Research ${node.name} in the Lab first.`);
  }
  const cur = armoryFamilyState(state, fam.id);
  if (cur.tier >= 4) {
    return fail(`${armoryModel(state, fam, 4)} is already the family's final tier — ${tierWord(state, 4)} Mk IV.`);
  }
  if (armoryBuildFor(state, fam.id)) {
    return fail(`${fam.name} is already being built — the forges take one commitment at a time.`);
  }
  // THE SLOT CAP (owner-ratified 2026-09-27, with the four times): two families
  // under construction at once. Wall clock, stated plainly (lead, 2026-09-27):
  // one family's four tiers are 0.5 + 3 + 12 + 45 = 60.5 d. Five families at
  // five slots — the old behaviour, one build per family — all finished
  // together in 60.5 d; five EQUAL-length families at two slots take
  // ceil(5/2) = 3 waves, so 181.5 d. (Total work ÷ slots = 151.25 d is a
  // throughput floor, not a schedule — five equal jobs on two slots cannot
  // reach it. Three families sit in two waves: 121 d.)
  const inFlight = armoryBuildsInFlight(state);
  if (inFlight >= ARMORY_BUILD_SLOTS) {
    const busy = Object.keys(state.armoryBuilds ?? {}).map((id) => familyLabel(state, id)).join(", ");
    return fail(`Both forge slots are committed (${busy}) — the Armory builds ${ARMORY_BUILD_SLOTS} families at a time. One must finish before the forges take another.`);
  }
  const targetTier = (cur.tier + 1) as 1 | 2 | 3 | 4;
  const cost = weaponCost(targetTier);
  const r = state.resources;
  if (r.supplies < cost.supplies) return fail(`Not enough supplies. ${fam.name} tier ${targetTier} needs ${cost.supplies} 📦, have ${Math.floor(r.supplies)}.`);
  if (r.embers < cost.embers) return fail(`Not enough embers. ${fam.name} tier ${targetTier} needs ${cost.embers} 🧯, have ${Math.floor(r.embers)}.`);
  if (r.gas < cost.fuel) return fail(`Not enough vehicle fuel. ${fam.name} tier ${targetTier} needs ${cost.fuel} ⛽, have ${Math.floor(r.gas)}.`);
  if (r.plasma < cost.plasma) return fail(`Not enough plasma. ${fam.name} tier ${targetTier} needs ${cost.plasma} 🔮, have ${Math.floor(r.plasma)}. Refine 25 embers in the Lab (Plasma Refinement) or raid deep chipset sites.`);
  r.supplies -= cost.supplies;
  r.embers -= cost.embers;
  r.gas -= cost.fuel;
  r.plasma -= cost.plasma;
  const timeMs = weaponTimeMs(targetTier);
  state.armoryBuilds[fam.id] = { targetTier, startedAt: now, doneAt: now + timeMs };
  log(state, `🏛️ ${cur.tier === 0 ? "The Armory begins forging" : "The Armory begins upgrading"} ${fam.name} to ${tierWord(state, targetTier)} Mk ${targetTier} — ready in ${fmtClock(timeMs)}. (${cost.supplies} 📦 · ${cost.embers} 🧯 · ${cost.fuel} ⛽${cost.plasma > 0 ? ` · ${cost.plasma} 🔮` : ""})`);
  pruneCompleted(state);
  return { ok: true, state };
}

/**
 * Lab refinement (weapons-system §2): 25 embers → 1 plasma. Research-gated
 * (Plasma Refinement), deterministic, earn-only. Cradle-tier progress will
 * add a second gate when Cradle tiers land (V7 note) — for now the research
 * is the door.
 */
export function refinePlasma(state: GameState, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  if (!hasTech(state, "plasma_refinement")) {
    return fail("The lab cannot yet condense embers. Research 🔮 Plasma Refinement first.");
  }
  const cost = ARMORY_CONFIG.plasmaRefineEmbers;
  if (state.resources.embers < cost) {
    return fail(`Plasma refinement needs ${cost} 🧯 Embers. You have ${Math.floor(state.resources.embers)}.`);
  }
  state.resources.embers -= cost;
  state.resources.plasma += 1;
  log(state, `🔮 The lab condenses ${cost} embers into a unit of plasma. The forges drink deep tonight.`);
  return { ok: true, state };
}

/** Compact clock for server-side Chronicle prose (armory builds "12h" · "3d" ·
 *  "12d" · "45d"). It is day-aware and it is NOT a second player-facing
 *  formatter: no UI string is built here. The UI renders a duration through the
 *  ONE formatter, `fmtDuration` in game/i18n/format.ts (which is keyed in all
 *  five languages); a Chronicle line is English prose by construction. */
function fmtClock(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = min / 60;
  if (h < 24) return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 24)}d`;
}

// ------- Leader progression actions (XP allocation & the L3 path) -------

const ATTRIBUTE_KEYS = ["research", "economy", "combat", "engineering"] as const;
type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/**
 * Player choice: spend exactly ONE unspent attribute point (earned from a
 * level-up) into ONE attribute of ONE leader. Raises that attribute's numeric
 * effect — nothing purchasable, purely earned progression.
 */
export function allocateLeaderPoint(
  state: GameState,
  leaderId: string,
  attr: AttributeKey,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (!ATTRIBUTE_KEYS.includes(attr)) return fail("Unknown attribute.");
  if ((leader.unspentPoints ?? 0) < 1) return fail(`${leader.name} has no unspent attribute points. Earn XP to level up.`);
  leader.unspentPoints -= 1;
  leader.attributes[attr] += 1;
  const label = { research: "🔬 research", economy: "💰 economy", combat: "⚔️ combat", engineering: "🔧 engineering" }[attr];
  leader.history.push(`Allocated a point to ${label.replace(/^.. /, "")}`);
  log(state, `🎖️ ${leader.name} develops their craft: ${label} +1 (now ${leader.attributes[attr]}).`);
  return { ok: true, state };
}

/**
 * The ONE-TIME Level-3 specialization choice (mutually exclusive per Leader).
 * Picking one locks the other two FOREVER for this leader. Offered only when
 * the leader has reached L3; the offer stays pending in the UI until chosen.
 */
export function chooseSpecialization(
  state: GameState,
  leaderId: string,
  path: Specialization,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const leader = state.leaders.find((l) => l.id === leaderId);
  if (!leader) return fail("That Leader isn't in your Council.");
  if (!SPECIALIZATION_BY_ID[path]) return fail("Unknown path.");
  const level = levelFromXp(typeof leader.xp === "number" ? leader.xp : 0);
  if (level < SPECIALIZATION_MILESTONE) {
    return fail(`${leader.name} isn't Level ${SPECIALIZATION_MILESTONE} yet — earn XP to open the choice.`);
  }
  if (leader.specialization) {
    return fail(`${leader.name} already walks the ${leader.specialization} path. One choice, made permanent.`);
  }
  leader.specialization = path;
  leader.history.push(`Chose the ${SPECIALIZATION_BY_ID[path].mandate}`);
  log(state, `🧭 ${leader.name} accepts ${SPECIALIZATION_BY_ID[path].icon} ${SPECIALIZATION_BY_ID[path].mandate} — the other two paths close forever.`);
  return { ok: true, state };
}

export function discipline(state: GameState, spend: number, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  // Asart-style purity action: burn supplies to cleanse corruption.
  advance(state, now);
  const cost = 10 * spend;
  if (state.resources.supplies < cost) return fail(`Need ${cost} supplies to purify.`);
  state.resources.supplies -= cost;
  const cleaned = Math.min(state.corruption, spend * 5);
  state.corruption = clamp(state.corruption - cleaned, 0, 100);
  log(state, `Colony rites cleanse the taint: corruption -${Math.round(cleaned)}.`);
  // V7 daily to-do: an accepted cleansing rite ticks cleanse_taint (this only
  // NOTES the existing action — discipline's mechanics are untouched).
  noteDailyEvent(state, "cleanse_taint", now);
  return { ok: true, state };
}

function domainFor(d: DomainId): string {
  return { weaponry: "Weaponry", agriculture: "Agriculture", economy: "Economy", industry: "Industry", logistics: "Logistics" }[d]!;
}


// ------- THE FORGE (owner 2026-09-26) -------
// The facility that renders ONE weapon per roll. The rules live in forge.ts
// (grades, recipes, the earnable ceiling, the depth drop); this section is what
// MOVES STATE, and it is deliberately small:
//
//   • forgeRoll() consumes the ingredients, ROLLS, materializes the item and
//     returns both in ONE state object. api.ts persists that object before the
//     response leaves the server, so:
//       – there is no window between "charge" and "roll" (no charge without a
//         result, no result without a charge);
//       – the RNG runs inside the engine, once, on the server — the client
//         never sends stats, a grade, a seed or a power number, so it cannot
//         choose its own outcome (the request carries a recipe id and a
//         request id, and nothing else);
//       – a refresh, a re-login, a replay or an offline advance can never
//         reroll it: the item is STORED, not derived, and nothing in advance()
//         ever rewrites it.
//   • a repeated request id (a double-submit, a retried fetch) returns the item
//     the first call produced and consumes nothing — an idempotent roll.
//   • EARN-ONLY, structurally: this section reads resources and deployed AI and
//     nothing else. There is no price, no currency and no entitlement here.

/** Is the recipe's recovered-AI gate met? (Never a hard-lock — false just means
 *  the UI prints what it needs, and the API refuses with the same sentence.) */
export function forgeUnlocked(state: GameState, recipeId: string): boolean {
  const recipe = getForgeRecipe(recipeId);
  if (!recipe) return false;
  return (state.deployedDomains[recipe.unlock.domain] ?? 0) >= recipe.unlock.level;
}

/** The whole "you cannot roll this yet" sentence, with the numbers — the UI
 *  renders its own keyed version of the same facts. */
export function forgeUnlockLine(state: GameState, recipeId: string): string {
  const recipe = getForgeRecipe(recipeId);
  if (!recipe) return "There is no such pattern in the Forge.";
  const have = state.deployedDomains[recipe.unlock.domain] ?? 0;
  return `${domainFor(recipe.unlock.domain)} AI L${recipe.unlock.level} recovers the pattern — you have L${have}. Deploy more AI in the Lab.`;
}

/** Everything the roll would cost, with what the colony actually holds —
 *  the "what will be consumed" panel, computed from state, never guessed. */
export function forgeCostView(state: GameState, recipeId: string): {
  warplate: { need: number; have: number };
  supplies: { need: number; have: number };
  embers: { need: number; have: number };
  unlocked: boolean;
  affordable: boolean;
} | null {
  const recipe = getForgeRecipe(recipeId);
  if (!recipe) return null;
  const r = state.resources;
  const warplate = { need: recipe.cost.warplate, have: Math.floor(r.warplate ?? 0) };
  const supplies = { need: recipe.cost.supplies, have: Math.floor(r.supplies) };
  const embers = { need: recipe.cost.embers, have: Math.floor(r.embers) };
  const unlocked = forgeUnlocked(state, recipeId);
  return {
    warplate,
    supplies,
    embers,
    unlocked,
    affordable:
      unlocked &&
      warplate.have >= warplate.need &&
      supplies.have >= supplies.need &&
      embers.have >= embers.need,
  };
}

/**
 * LIGHT THE FORGE — one roll, one item, committed and persisted with the
 * consumption that paid for it.
 *
 * `requestId` is the client's idempotency key: the same id can never buy a
 * second roll, and can never produce a second item.
 */
export function forgeRoll(
  state: GameState,
  recipeId: string,
  requestId: string,
  ownerId = "",
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; item?: ForgeItem; replay?: boolean } {
  advance(state, now);
  const recipe = getForgeRecipe(recipeId);
  if (!recipe) return fail("The Forge has no such pattern.");
  if (!requestId || requestId.length < 8) return fail("The Forge needs a request id — a roll is committed, not repeated.");
  // ---- idempotency first: a replay returns the FIRST result, unchanged ----
  const priorId = state.forgeRolls?.[requestId];
  if (priorId) {
    const prior = (state.forgeItems ?? []).find((i) => i.id === priorId);
    if (prior) return { ok: true, state, item: prior, replay: true };
  }
  if (!forgeUnlocked(state, recipeId)) return fail(forgeUnlockLine(state, recipeId));
  if ((state.forgeItems ?? []).length >= FORGE_CONFIG.maxItems) {
    return fail(`The racks are full (${FORGE_CONFIG.maxItems}). Melt something down or deploy a piece to the field.`);
  }
  const r = state.resources;
  if (Math.floor(r.warplate ?? 0) < recipe.cost.warplate) {
    return fail(`The crucible needs ${recipe.cost.warplate} Warplate, and you hold ${Math.floor(r.warplate ?? 0)}. Warplate is a rare drop in the DEEP Explorations.`);
  }
  if (Math.floor(r.supplies) < recipe.cost.supplies) {
    return fail(`The Forge needs ${recipe.cost.supplies} supplies to fire, and you hold ${Math.floor(r.supplies)}.`);
  }
  if (Math.floor(r.embers) < recipe.cost.embers) {
    return fail(`The Forge needs ${recipe.cost.embers} embers to fire, and you hold ${Math.floor(r.embers)}.`);
  }
  // ---- THE ATOMIC OPERATION: consume, roll, materialize, in one object ----
  r.warplate = Math.floor(r.warplate ?? 0) - recipe.cost.warplate;
  r.supplies = Math.floor(r.supplies) - recipe.cost.supplies;
  r.embers = Math.floor(r.embers) - recipe.cost.embers;
  state.forgeSeq = (state.forgeSeq ?? 0) + 1;
  // THE RNG: here, on the server, exactly once, AFTER the deduction and BEFORE
  // the return — so the only state the world can see is a state that already
  // carries the rolled item.
  const item = rollForgeItem({
    recipe,
    race: state.race,
    ownerId,
    ownerName: state.playerName,
    gameId: state.gameId ?? null,
    seq: state.forgeSeq,
    now,
  });
  state.forgeItems.push(item);
  state.forgeRolls[requestId] = item.id;
  const gradeLabel = forgeGrade(item.grade).id;
  log(state, `🔥 The Forge drinks ${recipe.cost.warplate} Warplate and renders ${item.name} — ${gradeLabel} grade, power ${item.power}. One piece, and it will never be made again.`);
  return { ok: true, state, item };
}

/* ---------------- BATTLE MEMORIALS — the victor's epitaph --------------------
 *  Owner 2026-09-30: the victor may add ONE epitaph line to a plaque. Once
 *  set, it's locked forever. Server-validated: the caller passes the
 *  victor's name; the plaque records who carved it.
 */

/** Carve the victor's epitaph on a memorial plaque (one line, permanent). */
export function setMemorialEpitaph(
  state: GameState,
  plaqueId: string,
  epitaph: string,
  byName: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const err = setEpitaphOnState(state, plaqueId, epitaph, byName);
  if (err) return { ok: false, error: err, state };
  log(state, `🕯️ An epitaph is carved in stone — it will stand forever.`);
  return { ok: true, state };
}

/** MELT-DOWN — the junk valve. An unwanted piece goes back into the crucible for
 *  a fraction of what it cost, SCALED BY GRADE (a good roll is worth more even as
 *  scrap). The piece is removed: it is not tradable after it is melted. */
export function meltForgeItem(
  state: GameState,
  itemId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; refund?: { warplate: number; supplies: number } } {
  advance(state, now);
  const idx = (state.forgeItems ?? []).findIndex((i) => i.id === itemId);
  if (idx < 0) return fail("That piece is not in the Cradle's racks.");
  const item = state.forgeItems[idx];
  if (item.location === "transit") {
    return fail("That piece is on a supply run — a convoy in transit cannot be recalled into the furnace.");
  }
  if (item.equippedBy) {
    return fail("That piece is worn — take it off its bearer before melting it down.");
  }
  const refund = meltRefund(item);
  state.resources.warplate = Math.floor(state.resources.warplate ?? 0) + refund.warplate;
  state.resources.supplies += refund.supplies;
  state.forgeItems.splice(idx, 1);
  state.forgeMelts = (state.forgeMelts ?? 0) + 1;
  log(state, `♻️ ${item.name} (${forgeGrade(item.grade).id}) goes back into the crucible: +${refund.warplate} Warplate, +${refund.supplies} supplies.`);
  return { ok: true, state, refund };
}

/* ---------------- MODULES — the sellable tier ---------------------------------
 *  Owner 2026-10-01; spec: design/modules-build.md. Forge-manufactured
 *  commodities: deterministic crafting keyed to Industry level, fixed
 *  attributes per (line, tier), deterioration with use, player market in
 *  Scrip. Rented power, never legend.
 *
 *  The craft is atomic like forgeRoll: deduct + materialize in one operation,
 *  idempotent on requestId. Crafted tier = min(4, industry domain level).
 *  NO REPAIR — broken modules melt for scrap or go in the bin.
 */

/** Is the recipe's industry gate met? (Never a hard-lock — the UI prints what
 *  it needs, and the API refuses with the same sentence.) */
export function moduleUnlocked(state: GameState, recipeId: string): boolean {
  const recipe = getModuleRecipe(recipeId);
  if (!recipe) return false;
  return (state.deployedDomains[recipe.unlock.domain] ?? 0) >= recipe.unlock.level;
}

/** The whole "you cannot craft this yet" sentence, with the numbers. */
export function moduleUnlockLine(state: GameState, recipeId: string): string {
  const recipe = getModuleRecipe(recipeId);
  if (!recipe) return "The Forge has no such module pattern.";
  const have = state.deployedDomains[recipe.unlock.domain] ?? 0;
  return `That module needs Industry ${recipe.unlock.level} deployed in the Lab (you hold ${have}). Recover and deploy the programme first.`;
}

/**
 * MANUFACTURE A MODULE — one craft, one item, committed and persisted with the
 * consumption that paid for it. Deterministic: the tier is min(4, industry
 * level), the stats are the fixed line/tier table. `requestId` is the client's
 * idempotency key: the same id can never buy a second craft.
 */
export function moduleCraft(
  state: GameState,
  recipeId: string,
  requestId: string,
  ownerId = "",
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; item?: ModuleItem; replay?: boolean } {
  advance(state, now);
  const recipe = getModuleRecipe(recipeId);
  if (!recipe) return fail("The Forge has no such module pattern.");
  if (!requestId || requestId.length < 8) return fail("The Forge needs a request id — a craft is committed, not repeated.");
  // ---- idempotency first: a replay returns the FIRST result, unchanged ----
  const priorId = state.moduleCrafts?.[requestId];
  if (priorId) {
    const prior = (state.modules ?? []).find((i) => i.id === priorId);
    if (prior) return { ok: true, state, item: prior, replay: true };
  }
  if (!moduleUnlocked(state, recipeId)) return fail(moduleUnlockLine(state, recipeId));
  if ((state.modules ?? []).length >= MODULE_CONFIG.maxModules) {
    return fail(`The module racks are full (${MODULE_CONFIG.maxModules}). Melt something down or list it on the market.`);
  }
  const tier = moduleTierForIndustry(state.deployedDomains["industry"] ?? 0);
  const cost = recipe.costByTier[tier - 1];
  const r = state.resources;
  if (Math.floor(r.warplate ?? 0) < cost.warplate) {
    return fail(`The crucible needs ${cost.warplate} Warplate, and you hold ${Math.floor(r.warplate ?? 0)}. Warplate is a rare drop in the DEEP Explorations.`);
  }
  if (Math.floor(r.supplies) < cost.supplies) {
    return fail(`The Forge needs ${cost.supplies} supplies to fire, and you hold ${Math.floor(r.supplies)}.`);
  }
  if (Math.floor(r.embers) < cost.embers) {
    return fail(`The Forge needs ${cost.embers} embers to fire, and you hold ${Math.floor(r.embers)}.`);
  }
  // ---- THE ATOMIC OPERATION: consume, materialize, in one object ----
  r.warplate = Math.floor(r.warplate ?? 0) - cost.warplate;
  r.supplies = Math.floor(r.supplies) - cost.supplies;
  r.embers = Math.floor(r.embers) - cost.embers;
  state.moduleSeq = (state.moduleSeq ?? 0) + 1;
  const item = craftModuleItem({
    recipe,
    tier,
    race: state.race,
    ownerId,
    ownerName: state.playerName,
    gameId: state.gameId ?? null,
    seq: state.moduleSeq,
    now,
  });
  state.modules.push(item);
  state.moduleCrafts[requestId] = item.id;
  log(state, `⚙️ The Forge manufactures ${item.name} — power ${item.power}. Fixed pattern, fixed output: the same module, every time.`);
  return { ok: true, state, item };
}

/** MELT-DOWN — the scrap loop. Broken modules melt for 25% of the normal
 *  refund. There is NO repair: the replacement loop feeds forgers and the market. */
export function meltModuleItem(
  state: GameState,
  itemId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; refund?: { warplate: number; supplies: number } } {
  advance(state, now);
  const idx = (state.modules ?? []).findIndex((i) => i.id === itemId);
  if (idx < 0) return fail("That module is not on the racks.");
  const item = state.modules[idx];
  if (item.location === "transit") {
    return fail("That module is on a supply run — a convoy in transit cannot be recalled into the furnace.");
  }
  if (item.equippedBy) {
    return fail("That module is worn — take it off its Bearer <redacted> melting it down.");
  }
  if (item.listedId) {
    return fail("That module is listed on the market — delist it before melting it.");
  }
  const refund = moduleMeltRefund(item);
  state.resources.warplate = Math.floor(state.resources.warplate ?? 0) + refund.warplate;
  state.resources.supplies += refund.supplies;
  state.modules.splice(idx, 1);
  state.moduleMelts = (state.moduleMelts ?? 0) + 1;
  log(state, `♻️ ${item.name}${moduleBroken(item) ? " (broken)" : ""} goes back into the crucible: +${refund.warplate} Warplate, +${refund.supplies} supplies.`);
  return { ok: true, state, refund };
}

/** The derived module loadout view: slot -> worn ModuleItem (or undefined). */
export function moduleLoadoutOf(
  state: GameState,
  bearer: LoadoutBearer,
): Partial<Record<"module1" | "module2", ModuleItem>> {
  const out: Partial<Record<"module1" | "module2", ModuleItem>> = {};
  for (const it of state.modules ?? []) {
    const eb = it.equippedBy;
    if (eb && eb.kind === bearer.kind && eb.id === bearer.id) out[eb.slot] = it;
  }
  return out;
}

/** WEAR A MODULE — equip into module1/module2. The no-duplicate-line rule is
 *  enforced: a bearer may not wear the same line twice (spec §5.2). Broken
 *  modules CAN be worn (they contribute 0, flagged BROKEN) — breaking never
 *  strands a hero mid-campaign. */
export function equipModuleItem(
  state: GameState,
  itemId: string,
  bearer: LoadoutBearer,
  slot: "module1" | "module2",
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; swappedId?: string } {
  advance(state, now);
  const item = (state.modules ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That module is not on the racks.");
  if (!bearerExists(state, bearer)) return fail("That hero or leader is not with the colony.");
  if (item.location !== "cradle") {
    return fail("That module isn't on the racks — only stored modules can be worn.");
  }
  if (item.listedId) {
    return fail("That module is listed on the market — delist it before wearing it.");
  }
  if (item.equippedBy && item.equippedBy.kind === bearer.kind && item.equippedBy.id === bearer.id && item.equippedBy.slot === slot) {
    return { ok: true, state }; // already worn there — idempotent
  }
  if (item.equippedBy) {
    return fail("That module is already worn by someone else — one body, one item.");
  }
  // THE NO-DUPLICATE-LINE RULE: two slots exist for choices, not stacking.
  const worn = moduleLoadoutOf(state, bearer);
  for (const s of ["module1", "module2"] as const) {
    if (s !== slot && worn[s]?.line === item.line) {
      return fail(`One ${item.name.split(" Mk")[0]} per bearer — ${bearerName(state, bearer)} already wears that line. Two slots are for choices (coil + plate), not stacking.`);
    }
  }
  // The swap: whatever was in the slot goes back to the racks, atomically.
  const displaced = worn[slot];
  if (displaced) displaced.equippedBy = null;
  item.equippedBy = { kind: bearer.kind, id: bearer.id, slot };
  item.lastIdleTickAt = now;
  const who = bearerName(state, bearer);
  const brokenNote = moduleBroken(item) ? " (BROKEN — contributes nothing until replaced)" : "";
  log(state, `🔧 ${who} fits ${item.name}${brokenNote}${displaced ? ` — ${displaced.name} goes back to the racks` : ""}.`);
  return { ok: true, state, swappedId: displaced?.id };
}

export function unequipModuleItem(
  state: GameState,
  itemId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const item = (state.modules ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That module is not on the racks.");
  if (!item.equippedBy) return { ok: true, state }; // idempotent
  const who = bearerName(state, item.equippedBy);
  item.equippedBy = null;
  log(state, `🔧 ${who} takes off ${item.name} — back on the racks.`);
  return { ok: true, state };
}

/** THE BATTLE TICK — −5 condition per REAL battle a bearer fights with the
 *  module equipped. Called from advanceBattles when a battle resolves.
 *  Arena bouts never tick (the proving ground doesn't wear out your gear).
 *  Idempotent per battle id; only the LOCAL state's bearers are ticked. */
export function tickModulesForBattle(
  state: GameState,
  battle: { id: string; arena?: unknown; attacker: { heroSquad: { id: string }[] }; defender: { heroSquad: { id: string }[] } },
  now = Date.now(),
): number {
  if (battle.arena) return 0;
  if (!state.moduleBattleTicks) state.moduleBattleTicks = {};
  if (state.moduleBattleTicks[battle.id]) return 0;
  state.moduleBattleTicks[battle.id] = true;
  const fought = new Set<string>();
  for (const s of battle.attacker.heroSquad ?? []) fought.add(s.id);
  for (const s of battle.defender.heroSquad ?? []) fought.add(s.id);
  let ticked = 0;
  for (const m of state.modules ?? []) {
    if (!m.equippedBy || !fought.has(m.equippedBy.id)) continue;
    const wasBroken = moduleBroken(m);
    tickModuleBattle(m);
    ticked += 1;
    if (!wasBroken && moduleBroken(m)) {
      log(state, `⚠️ ${m.name} broke in battle — it contributes nothing until replaced.`);
    }
  }
  void now;
  return ticked;
}

/* ---------------- THE PLAYER MARKET -----------------------------------------
 *  Spec §8.1 + arena-market.md Part II: fixed Scrip prices, 5% fee DESTROYED on
 *  sale, 7-day expiry with return-to-seller, per-server markets. Broken modules
 *  cannot be listed — melt them. Listing snapshots the commodity (the snapshot
 *  is the lock); the module is escrowed (listedId) until sold, delisted, or
 *  expired.
 */
export function listModuleForSale(
  state: GameState,
  itemId: string,
  price: number,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; listing?: MarketListing } {
  advance(state, now);
  const item = (state.modules ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That module is not on the racks.");
  const liveCount = (state.market?.listings ?? []).filter((l) => l.sellerId === (state.accountId ?? "") || true).length;
  const err = validateListing(item, price, liveCount);
  if (err) return fail(err);
  const fee = MARKET_CONFIG.listingFeeSupplies;
  if (Math.floor(state.resources.supplies) < fee) {
    return fail(`Listing costs ${fee} supplies (anti-spam), and you hold ${Math.floor(state.resources.supplies)}.`);
  }
  state.resources.supplies = Math.floor(state.resources.supplies) - fee;
  const listing = makeListing({
    item,
    sellerId: state.accountId ?? "",
    sellerName: state.playerName,
    price,
    now,
  });
  item.listedId = listing.id;
  state.market.listings.push(listing);
  log(state, `🏪 ${item.name} listed on the market for ${listing.price} Scrip — 7 days, then it comes home.`);
  return { ok: true, state, listing };
}

export function cancelMarketListing(
  state: GameState,
  listingId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const idx = (state.market?.listings ?? []).findIndex((l) => l.id === listingId);
  if (idx < 0) return fail("That listing is gone from the board.");
  const listing = state.market.listings[idx];
  const item = (state.modules ?? []).find((i) => i.id === listing.moduleId);
  if (item) item.listedId = null;
  state.market.listings.splice(idx, 1);
  log(state, `🏪 ${listing.name} delisted — back on the racks.`);
  return { ok: true, state };
}

/** Buy a listing. In the single-save architecture the buyer and seller are the
 *  same account's market board; the settlement is written so a future
 *  cross-account market can call the same seam with two states. The 5% fee is
 *  DESTROYED (a sink, not revenue). */
export function buyMarketListing(
  state: GameState,
  listingId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; item?: ModuleItem } {
  advance(state, now);
  const listing = (state.market?.listings ?? []).find((l) => l.id === listingId);
  if (!listing) return fail("That listing is gone from the board.");
  if (marketListingExpired(listing, now)) {
    // Lazily expire on touch — sweepMarketExpiry in advance() normally beats us here.
    cancelMarketListing(state, listingId, now);
    return fail("That listing just expired — the module went home to its seller.");
  }
  const sellerId = state.accountId ?? "";
  if (listing.sellerId === sellerId) {
    return fail("That's your own listing — delist it instead of buying it.");
  }
  const wallet = Math.floor(state.currency?.scrip ?? 0);
  if (wallet < listing.price) {
    return fail(`That costs ${listing.price} Scrip and your purse holds ${wallet}.`);
  }
  const item = (state.modules ?? []).find((i) => i.id === listing.moduleId);
  if (!item || item.listedId !== listing.id) {
    return fail("That module is no longer on the board.");
  }
  // ---- settlement: buyer pays, seller keeps 95%, 5% destroyed ----
  state.currency.scrip = wallet - listing.price;
  const proceeds = marketSellerProceeds(listing.price);
  // Single-save note: the seller is another account's state in the full
  // design. Here the board is per-server; credit the seller's purse when the
  // seller state is this state (self-listings are blocked above, so this path
  // only fires when cross-account settlement lands).
  void proceeds;
  const bought = transferModule(item, sellerId, state.playerName, now);
  const idx = state.modules.findIndex((i) => i.id === bought.id);
  state.modules[idx] = bought;
  state.market.listings = state.market.listings.filter((l) => l.id !== listing.id);
  log(state, `🏪 Bought ${bought.name} for ${listing.price} Scrip (${marketFee(listing.price)} destroyed as the market's cut).`);
  return { ok: true, state, item: bought };
}

/** Expired listings return to the seller's racks. Runs in ensureModules (every
 *  advance) — lazy, idempotent, offline-safe. */
export function sweepMarketExpiry(state: GameState, now: number): number {
  const listings = state.market?.listings ?? [];
  let swept = 0;
  for (const l of [...listings]) {
    if (!marketListingExpired(l, now)) continue;
    const item = (state.modules ?? []).find((i) => i.id === l.moduleId);
    if (item && item.listedId === l.id) item.listedId = null;
    state.market.listings = state.market.listings.filter((x) => x.id !== l.id);
    swept += 1;
    log(state, `🏪 ${l.name}'s listing expired — back on the racks.`);
  }
  return swept;
}

/* ---------------- LOADOUT — dressing heroes & leaders --------------------
 *  One body, one item per slot. Equipped pieces stay location "cradle"
 *  (worn at home, not in transit). Server-authoritative: the UI never
 *  invents equipped state, and battle snapshots carry RESOLVED deltas
 *  (resolveHeroEquipment) so the engine never reaches back into the loadout
 *  mid-battle. Cargo stays cargo: equipped pieces are never lootable. */

export type LoadoutSlot = "weapon" | "armor" | "module1" | "module2" | "relic";
export interface LoadoutBearer { kind: "hero" | "leader"; id: string; }

/** Which forged kind fits which slot. Module/relic slots have no item model
 *  yet — they stay locked until the module / artifact models land. */
function loadoutSlotFit(slot: LoadoutSlot, kind: string): boolean {
  if (slot === "weapon") return kind === "assault";
  if (slot === "armor") return kind === "defence";
  return false;
}

function bearerExists(state: GameState, bearer: LoadoutBearer): boolean {
  if (bearer.kind === "hero") return (state.prologue?.heroes ?? []).some((h) => h.id === bearer.id);
  return (state.leaders ?? []).some((l) => l.id === bearer.id);
}

function bearerName(state: GameState, bearer: LoadoutBearer): string {
  const list = bearer.kind === "hero" ? (state.prologue?.heroes ?? []) : (state.leaders ?? []);
  return list.find((x) => x.id === bearer.id)?.name ?? "the bearer";
}

/** The derived loadout view: slot -> worn ForgeItem (or undefined). */
export function loadoutOf(
  state: GameState,
  bearer: LoadoutBearer,
): Partial<Record<ForgeLoadoutSlot, ForgeItem>> {
  const out: Partial<Record<ForgeLoadoutSlot, ForgeItem>> = {};
  for (const it of state.forgeItems ?? []) {
    const eb = it.equippedBy;
    if (eb && eb.kind === bearer.kind && eb.id === bearer.id) out[eb.slot] = it;
  }
  return out;
}

export function equipForgeItem(
  state: GameState,
  itemId: string,
  bearer: LoadoutBearer,
  slot: LoadoutSlot,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; swappedId?: string } {
  advance(state, now);
  const item = (state.forgeItems ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That piece is not in the Cradle's racks.");
  if (!bearerExists(state, bearer)) return fail("That hero or leader is not with the colony.");
  if (slot === "module1" || slot === "module2") {
    return fail("Module slots are not open yet — the module model hasn't landed.");
  }
  if (slot === "relic") {
    return fail("The relic slot waits on true artifacts — exploration finds and Chorus spoils, not forge work.");
  }
  if (!loadoutSlotFit(slot, item.kind)) {
    return fail(`That piece doesn't fit the ${slot} slot — ${item.kind === "assault" ? "assault pieces are weapons" : "defence pieces are armor"}.`);
  }
  if (item.location !== "cradle") {
    return fail("That piece isn't on the racks — only stored pieces can be worn.");
  }
  if (item.equippedBy && item.equippedBy.kind === bearer.kind && item.equippedBy.id === bearer.id && item.equippedBy.slot === slot) {
    return { ok: true, state }; // already worn there — idempotent
  }
  if (item.equippedBy) {
    return fail("That piece is already worn by someone else — one body, one item.");
  }
  // The swap: whatever was in the slot goes back to the racks, atomically.
  const worn = loadoutOf(state, bearer)[slot];
  if (worn) worn.equippedBy = null;
  item.equippedBy = { kind: bearer.kind, id: bearer.id, slot };
  const who = bearerName(state, bearer);
  log(state, `🛡️ ${who} takes up ${item.name} (${forgeGrade(item.grade).id})${worn ? ` — ${worn.name} goes back to the racks` : ""}.`);
  return { ok: true, state, swappedId: worn?.id };
}

export function unequipForgeItem(
  state: GameState,
  itemId: string,
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  const item = (state.forgeItems ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That piece is not in the Cradle's racks.");
  if (!item.equippedBy) return { ok: true, state }; // already on the racks — idempotent
  const who = bearerName(state, { kind: item.equippedBy.kind, id: item.equippedBy.id });
  item.equippedBy = null;
  log(state, `🛡️ ${item.name} comes off ${who} and goes back to the racks.`);
  return { ok: true, state };
}

/** The battle seam: resolve a bearer's worn pieces into the snapshot block.
 *  Carries RESOLVED stat deltas in HERO-attribute space (power/guard — the two
 *  axes the forge and hero stat systems share by meaning) plus item identity
 *  for the battle report. Never live references: the snapshot is the lock;
 *  editing the loadout later can't rewrite a battle already joined. */
export function resolveHeroEquipment(
  state: GameState,
  bearer: LoadoutBearer,
): {
  weapon?: { itemId: string; name: string; grade: string };
  armor?: { itemId: string; name: string; grade: string };
  attrs: { power: number; guard: number };
} | undefined {
  const worn = loadoutOf(state, bearer);
  const w = worn.weapon;
  const a = worn.armor;
  if (!w && !a) return undefined;
  return {
    ...(w ? { weapon: { itemId: w.id, name: w.name, grade: w.grade } } : {}),
    ...(a ? { armor: { itemId: a.id, name: a.name, grade: a.grade } } : {}),
    attrs: {
      power: (w?.stats.power ?? 0) + (a?.stats.power ?? 0),
      guard: (w?.stats.guard ?? 0) + (a?.stats.guard ?? 0),
    },
  };
}

/** SUPPLY RUN — move a piece between the Cradle's racks and the field.
 *  ~24h transit, never instant (owner: "the shipping times should be like a
 *  24-hour shipping it doesn't get there right away"). REAL state today: the
 *  arrival resolves lazily and offline in advance(). What beta does NOT have is
 *  a forward base to receive it — so nothing in the UI launches one yet, and a
 *  deployed piece earns no battle power until war ships. */
export function beginSupplyRun(
  state: GameState,
  itemId: string,
  to: "field" | "cradle" = "field",
  now = Date.now(),
): { ok: boolean; error?: string; state: GameState; arriveAt?: number } {
  advance(state, now);
  const item = (state.forgeItems ?? []).find((i) => i.id === itemId);
  if (!item) return fail("That piece is not in the Cradle's racks.");
  if (item.location === "transit") return fail("That piece is already on a supply run.");
  if (item.location === to) return fail(`That piece is already ${to === "field" ? "in the field" : "in the Cradle's racks"}.`);
  if (item.equippedBy) {
    return fail("That piece is worn — take it off its bearer before sending it to the field.");
  }
  const arriveAt = now + FORGE_CONFIG.supplyRunMs;
  item.transit = { from: item.location, to, departAt: now, arriveAt };
  item.location = "transit";
  log(
    state,
    `🚚 ${item.name} leaves the Cradle on a supply run — ${to === "field" ? "to the field" : "home to the racks"}. Arrives in ${Math.round(FORGE_CONFIG.supplyRunMs / 3_600_000)} hours, and it is exposed while it is out there.`,
  );
  return { ok: true, state, arriveAt };
}

/** The pieces a successful plunder could take: the ones IN USE IN THE FIELD
 *  (owner: "if they're using them in the field"). Everything in the racks is
 *  out of reach — which is what makes toggling a piece home a real decision.
 *  War rolls the chance; this decides what is at stake. */
export function forgeFieldItems(state: GameState): ForgeItem[] {
  return (state.forgeItems ?? []).filter((i) => i.location === "field");
}

function fail(error: string) {
  return { ok: false, error, state: null as unknown as GameState };
}
/**
 * A refusal the player READS, carrying the catalogue key the client renders it
 * with — so the reason an action is unavailable is translated like every other
 * player-facing string instead of arriving as raw English. `error` stays the
 * English fallback for callers that have no catalogue.
 */
function failKey(errorKey: string, error: string) {
  return { ok: false, error, errorKey, state: null as unknown as GameState };
}

// Keep history tidy (drop complete records older than 40).
function pruneCompleted(state: GameState) {
  state.studies = state.studies.filter((s) => !(s.status === "complete"));
  state.expeditions = state.expeditions.filter((e) => !(e.status === "complete"));
  state.researchJobs = state.researchJobs.filter((j) => !(j.status === "complete"));
}

export function serialize(state: GameState) {
  return JSON.stringify(state);
}
