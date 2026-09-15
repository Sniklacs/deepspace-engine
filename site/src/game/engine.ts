import type { DomainId, GameState, Leader, RaceId, ResearchJob, Zone } from "./types";
import { getRace } from "./races";
import { getZone } from "./zones";
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
import {
  ARMORY_CONFIG,
  ARMORY_CATALOG,
  ARMORY_FAMILY_TECH,
  TIER_LANGUAGES,
  familyFor,
  weaponCost,
  weaponTimeMs,
} from "./armory";
import {
  ensureDaily,
  reconcileDaily,
  sweepDaily,
  noteDailyEvent,
  noteDailyLaunch,
  freshDaily,
} from "./daily";
import { advanceBattles, ensureBattles, freshWarReserve } from "./war/battle-engine";
// The daily module's claim resolver + derived favor score re-exported so the
// API surface speaks one engine namespace. favorScore stays SERVER-ONLY.
export { claimDaily, favorScore } from "./daily";

// The Deepspace Engine core. Pure logic operating on a GameState object.
// Time is advanced lazily: whenever state is loaded or mutated we "roll forward"
// from lastTick to now, resolving expeditions/studies that finished while offline
// and accruing passive income. This is what makes the world persist while logged out.

export const VERSION = 10;
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
// V10 (owner-locked 2026-09-14): the L3 economy path "steward" is renamed
// "quartermaster". "Steward" survives ONLY as
// Kael's TITLE (the generalist caretaker) — never a path. Legacy saves with
// specialization "steward" migrate to "quartermaster" in ensureLeaderXp
// (additive, idempotent; buff numbers untouched). Purifier = the 4th path,
// explicitly DEFERRED to the corruption/Oracle layer — no mechanics here.

// Inputs are already in milliseconds; TIME_SCALE just allows demo-speed tuning.
export const TIME_SCALE = 1;

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
  mechkit: { supplies: 6, label: "Mechanics kit", icon: "🔧", description: "Patch-up and basic vehicle repair. Without it no team can field an expedition." },
  armorkit: { supplies: 7, label: "Armor/armature kit", icon: "🛡️", description: "Armature for crew and light vehicles. Without it no team can field an expedition." },
  // Tier 1 — outer / mild zones.
  skmech: { supplies: 14, label: "Skilled mechanics", icon: "👷", description: "A crew that repairs and maintains heavier machinery in the farther ruins." },
  gas: { supplies: 4, label: "Vehicle fuel", icon: "⛽", description: "For the long-haul convoy. Burned per expedition — refuel to go further." },
  battery: { supplies: 5, label: "Battery packs", icon: "🔋", description: "Quiet electric running at the site. Discharged per expedition — recharge before you go." },
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
      supplies: 60,
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
    // ---- Monetization (V5): zeroed seams — no storefront exists ----
    currency: freshCurrency(),
    entitlements: freshEntitlements(),
    battlePass: freshBattlePass(now),
    // ---- Armory (V6): no war hardware yet — earn-only, built at the Cradle ----
    armory: {},
    armoryBuilds: {},
    weaponsBuilt: 0,
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

function log(state: GameState, msg: string) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 60);
}

// ------- derived state -------

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
  return Math.max(10_000, Math.round(base * aligned * skill * scholar * studySpeedMult(state)));
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

/** Colony-wide Marshal survival buff (−20% surprise/survival damage severity). */
export function marshalProtectionMult(state: GameState): number {
  const marshals = state.leaders.filter((l) => l.specialization === "marshal" && l.status === "active");
  if (marshals.length === 0) return 1;
  return Math.max(0.5, 1 - marshals.length * 0.2); // −20% per specialized marshal, floor 50%
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
// Rank order is deterministic: score desc, then "earliest achievement" — the
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
}

export function contributionRanking(states: GameState[]): ContributionEntry[] {
  return states
    .filter(
      (st) => !!st && typeof st === "object" && !!st.race && !!st.gameId
    )
    .map((st) => ({
      gameId: st.gameId!,
      colonyName: st.playerName || "Unnamed Colony",
      race: st.race,
      score: contributionScore(st),
      createdAt: typeof st.createdAt === "number" ? st.createdAt : 0,
    }))
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
/** Ember→supplies scrap rate (e1 Trade Ledgers + a2 Seed Vaults). */
export function suppliesScrapRate(state: GameState): number {
  let r = 0.15;
  if (hasTech(state, "e1")) r = 0.3;
  if (hasTech(state, "a2")) r += 0.14; // Seed Vaults: +60% on top of base scrap
  return r;
}
/** Ember yield multiplier (e2 Salvage Contracts). */
export function emberYieldMult(state: GameState): number {
  return hasTech(state, "e2") ? 1.08 : 1;
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
    state.armoryBuilds[fam] = { targetTier: target as 1 | 2 | 3 | 4, startedAt: rec.startedAt, doneAt: rec.doneAt };
  }
}

export function advance(state: GameState, now = Date.now()): GameState {
  ensureResources(state);
  ensureKnowledge(state);
  ensureRevelation(state);
  ensureMonetization(state);
  ensureArmory(state);
  ensureDaily(state);
  ensureBattles(state); // V9: real-time battle entities + report ledger (no-op on new saves)
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
    return state;
  }
  const elapsedMs = now - state.lastTick;

  // Passive supplies income (colony grows while you're away). A blank/reset
  // slot (race null, pending re-founding) has no race economy — it accrues
  // nothing and advances quietly (defensive: old code crashed here on blanks
  // after the first tick; caught by the V7 daily suite's blank-safety tests).
  const supplyGain = state.race ? (suppliesPerMinute(state) / 60000) * elapsedMs : 0;
  state.resources.supplies += supplyGain;

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
      const boost = state.race === "watchers" ? 1.3 : 1;
      state.insight += Math.round(insightFor(state, s.kind) * boost);
      const prog = state.race === "watchers" ? "A taint lingers in the Academy's lesson. " : "";
      log(state, `${prog}A scientist finished studying ${s.kind === "ember" ? "an Ember" : "a Chipset"}. Knowledge distilled — insight +${Math.round(insightFor(state, s.kind) * boost)}.`);
    }
  }

  // Resolve completed research projects (Leader-appointed).
  for (const j of state.researchJobs) {
    if (j.status === "researching" && now - j.startedAt >= j.durationMs) {
      resolveResearch(state, j, now);
    }
  }

  // Resolve completed expeditions.
  for (const e of state.expeditions) {
    if (e.status === "out" && now - e.startedAt >= e.durationMs) {
      resolveExpedition(state, e, now);
    }
  }

  // Resolve completed weapon builds (V6) — same lazy, idempotent reconcile as
  // expeditions: built AT THE CRADLE while the world was offline. The deed
  // dents fire here exactly once (build records are consumed on completion).
  resolveArmoryBuilds(state, now);

  // Resolve completed battles (V9, the real-time battle engine — battle-side
  // §15): every active battle whose wall-clock end has passed is finalized
  // here (result, Chronicle line, append-only ledger report). Same lazy,
  // idempotent discipline as every other resolver — offline worlds resolve
  // on the next read; resolved battles are skipped so double-ticks can never
  // double-report. DETERMINISTIC: no Math.random in win/loss/power (the
  // strength formula reads only the §15 B4 snapshot inputs).
  advanceBattles(state, now);

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
  // Season 0 pass: completing a research project is a daily objective (§4.1).
  // The hidden revelation chain deliberately stays OUT of the pass loop.
  recordSeasonEvent(state, "complete_research", now);
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
  // A specialized Marshal's mandate softens survival damage colony-wide (−20%
  // per marshal on surprise/survival severity) and sharpens combat effectiveness.
  const prot = typeof e.protection === "number" ? clamp(e.protection, 0, 1) : 0.5;
  let wc: "lost" | "mauled" | "bumped" | null = null;
  if (coin(wildcardChance(state))) {
    const roll = Math.random();
    // catastrophe odds scale with protection — and with how many Wardens walk
    // the colony: marshal savers apply to the surprise itself.
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
  const scientistFactor = 0.7 + sci * 0.4;
  const base = zone.emberYield * scientistFactor * r.mods.emberGain * emberYieldMult(state); // e2 Salvage Contracts
  const econBoost = (1 + state.deployedDomains.economy * 0.06) * quartermasterEconomyMult(state); // Quartermaster mandate
  const corruptionPenalty = 1 - state.corruption / 200;
  const variance = 0.8 + Math.random() * 0.4;
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
  if (wc !== "lost" && zone.radiationLevel >= 20 && zone.radiationLevel < DEEP && coin(0.13)) {
    const qty = 1 + (coin(0.5) ? 1 : 0);
    if (coin(0.6)) state.resources.hazmat += qty;
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
  awardDeed(state, "five_expeditions", 3, "your fifth expedition recovers a trove of pre-war records");

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

  let msg = `Expedition to ${zone.name} returned: +${embers} Embers`;
  if (wc === "lost") {
    msg = `💀 ${zone.name} — the team never came home whole. A roaming Chorus force crossed their path, or they landed in the wrong damn spot${sciLost > 0 ? `; ${sciLost} scientist${sciLost > 1 ? "s" : ""} lost` : ";"} only ${embers} Embers dragged out of the wreck. Protection saves teams — build more.`;
  } else if (wc === "mauled") {
    msg = `⚠️ ${zone.name} — caught off-guard by something that wasn't on the map${sciLost > 0 ? `: ${sciLost} scientist${sciLost > 1 ? "s" : ""} lost` : ", but the guard kit kept everyone alive"}. +${embers} Embers recovered.`;
  } else if (wc === "bumped") {
    msg = `— ${zone.name} — the team rode out an unexpected hazard (a worse landing, a hidden pocket of Chorus). The kit took the edge off. +${embers} Embers.`;
  } else if (radiationHit) {
    msg = `☢️ ${zone.name} claimed its price: the under-geared team took radiation. +${embers} Embers recovered${e.assignedScientists > 1 ? " — scientists lost to attrition" : " — the lone scientist barely survived"}.`;
  } else if (gotChipset) msg = `Expedition to ${zone.name} returned a prize: +${embers} Embers and a rare Chipset!`;
  else if (zone.chipsetChance === 0) msg = `Expedition to ${zone.name} returned: +${embers} Embers (no chipsets in the outer rust).`;
  if (cleanRecovery) msg += ` 📜 The team brought a surviving archive home whole — Codices +${gotCodex} (earned, not looted).`;
  if (plasmaSalvaged > 0) msg += ` — the deep vaults bled high-energy plasma (🔮 +${plasmaSalvaged}).`;
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
    return fail("Your logistics can only keep one expedition team in the field. Deploy Logistics AI to send more.");
  }
  const zone = getZone(zoneId);
  const cost = suppliesCostForZone(state, zone);
  if (state.resources.supplies < cost) return fail(`Not enough supplies. Need ${cost}, have ${Math.floor(state.resources.supplies)}.`);

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
  state.resources.supplies -= cost;
  // Consume fuel (the refuel / recharge cost of the run).
  state.resources.gas -= gNeed;
  state.resources.battery -= bNeed;
  const id = "exp-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const industrySpeed = Math.pow(0.94, state.deployedDomains.industry) * (hasTech(state, "i4") ? 0.9 : 1); // i4 Foundry Lines −10% time
  const durationMs = Math.round(zone.baseDurationMs * industrySpeed * (0.9 + Math.random() * 0.2));
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
  log(state, `Expedition launched into ${zone.name} (${sci} scientist${sci > 1 ? "s" : ""}). Returns in ~${(durationMs / 60000).toFixed(1)} min. Risk ${zone.risk}.${warn}`);
  recordSeasonEvent(state, "launch_expedition", now); // Season 0 daily objective
  // V7 daily to-do: launch_any always; launch_mid (risk >= 40, rad < DEEP) and
  // launch_deep (rad >= 60) are zone-gated by the funnel.
  noteDailyLaunch(state, zone, now);
  pruneCompleted(state);
  return { ok: true, state };
}

// ------- Workshop crafting (radiation gear & the forged alloy) -------

export function craftItem(state: GameState, kind: CraftKind, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
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
  log(state, `The Workshop forged a ${def.label}${note}.`);
  recordSeasonEvent(state, "craft_item", now); // Season 0 daily objective
  // V7 daily to-do: any craft completes craft_item; gas/battery also complete
  // the refuel_convoy item.
  noteDailyEvent(state, "craft_item", now);
  if (kind === "gas" || kind === "battery") noteDailyEvent(state, "refuel_convoy", now);
  return { ok: true, state };
}

export function beginStudy(state: GameState, kind: "ember" | "chipset", now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  if (state.studies.filter((s) => s.status === "studying").length >= state.scientists) {
    return fail(`All ${state.scientists} scientist(s) are already busy. Deploy Logistics AI to raise capacity.`);
  }
  if (kind === "ember" && state.resources.embers < 2) return fail("Need at least 2 Embers to study.");
  if (kind === "chipset") {
    if (state.resources.chipsets < 1) return fail("You have no Chipsets. Only deep scientific sites yield them.");
  } else {
    state.resources.embers -= 2;
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

export function deployProgram(state: GameState, domain: DomainId, now = Date.now()): { ok: boolean; error?: string; state: GameState } {
  advance(state, now);
  if (!state.race) return fail("Choose a race first.");
  const cost = deployCost(state, domain);
  if (state.resources.embers < cost.embers) return fail(`Need ${cost.embers} Embers.`);
  if (state.insight < cost.insight) return fail(`Need ${cost.insight} insight from the lab. Study fragments to generate it.`);
  state.resources.embers -= cost.embers;
  state.insight -= cost.insight;
  state.deployedDomains[domain] += 1;
  state.deployablePrograms.push(domain);
  // Silent track: the deepest the colony has ever driven any domain line.
  const c = state.revelationCounters;
  if (c && typeof c === "object") {
    c.maxDomainDepth = Math.max(c.maxDomainDepth ?? 0, ...Object.values(state.deployedDomains));
  }
  log(state, `Recovered AI deployed: ${domainFor(domain)} advanced to level ${state.deployedDomains[domain]}.`);
  awardDeed(state, "first_deploy", 1, "recovery AI deployed for the first time");
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
  const t = TECH_TREE.find((x) => x.id === techId);
  return t ? t.name : techId;
}

// ------- the colony-side Armory (V6, weapons-system design 2026-09-12) -------
//
// Weapons are hardware BUILT AT THE CRADLE from expedition-gathered resources
// (supplies/embers/fuel) and, at T2+, refined/salvaged plasma. Five war-role
// families per race; four tiers per family; stats rise per tier (×1.5/×2.2/×3.2
// over T1). Builds and upgrades are real-time commitments — one active build
// per family, no queuing — resolved lazily in advance() exactly like
// expeditions, so the Cradle forges while the world is offline.
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
  return Math.max(10_000, Math.round(base * skill * studySpeedMult(state)));
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
  recordSeasonEvent(state, "complete_research", now);
  // V7 daily to-do: an Armory node is a completed research project.
  noteDailyEvent(state, "research_complete", now);
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
    if (!build || now < build.doneAt) continue;
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

/** Compact clock for build times ("45m" · "3h" · "12h" · "2d"). */
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

function fail(error: string) {
  return { ok: false, error, state: null as unknown as GameState };
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
