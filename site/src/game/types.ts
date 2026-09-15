// Shared game types for Deepspace Engine MVP.

import type { Battle, BattleReport, WarReserve } from "./war/war-types";
import type { PrologueBlock } from "./prologue/prologue-state";

export type RaceId =
  | "grays"
  | "nephilim"
  | "draconians"
  | "anunnaki"
  | "ashtar"
  | "watchers";

export type DomainId =
  | "weaponry"
  | "agriculture"
  | "economy"
  | "industry"
  | "logistics";

export interface Expedition {
  id: string;
  zoneId: string;
  label: string;
  assignedScientists: number;
  suppliesCost: number;
  startedAt: number; // epoch ms
  durationMs: number; // real-time duration
  // snapshot of the radiation risk locked in at launch (0 = no radiation risk).
  // Deep zones under-geared: 1-45; mild zones: 0. Used at resolve to roll loss.
  lossPct?: number;
  // resolved lazily when read
  status: "out" | "complete";
  completedAt?: number;
  // 0-1 protection index snapshotted at launch. The colony's guards & gear
  // (armor, medical, mechanics, hazmat, shots, numbers) that determine how a
  // wildcard surprise-encounter resolves at completion time. Never forecastable.
  protection?: number;
  // Silent track (V4): was the colony's corruption at absolute zero when this
  // team stepped out? Read at resolve for zeroCorruptionSurvivals. Optional so
  // old in-flight expeditions resolve cleanly (undefined = not pure).
  pureAtLaunch?: boolean;
}

export interface StudyJob {
  id: string;
  kind: "ember" | "chipset";
  startedAt: number;
  durationMs: number;
  status: "studying" | "complete";
}

export interface DomainLevel {
  weaponry: number;
  agriculture: number;
  economy: number;
  industry: number;
  logistics: number;
}

// The human layer. A Leader's specialty is her base boost — it maps to one
// domain line (economist → economy, horticulturist → agriculture, etc.).
export type Specialty = "tactician" | "horticulturist" | "economist" | "engineer" | "logistician";
// One-time Level-3 path choice (leader-xp.ts) — mutually exclusive per leader.
// Paths: Scholar / Marshal / Quartermaster. "Steward" is Kael's TITLE only
// (a generalist caretaker label), never a specialization. Purifier = the 4th
// path, deferred (lands with the corruption/Oracle layer).
export type Specialization = "scholar" | "marshal" | "quartermaster";

export interface Leader {
  id: string;
  name: string;
  /** Display title (V11 — the prologue's named Leaders carry owner-locked
   *  titles, e.g. Kael "the Steward"; optional so legacy saves stay valid). */
  title?: string;
  specialty: Specialty;
  attributes: { research: number; economy: number; combat: number; engineering: number };
  joinedAt: number;
  assignment: string | null; // techId currently researching, or null when free
  history: string[]; // breakthroughs, recoveries, wounds
  status: "active" | "wounded" | "lost";
  breakthroughs: number;
  codicesEarned: number; // Codices this leader has helped discover/bring home
  // ---- XP / leveling (earned through events; defaults for old saves) ----
  xp: number; // event-sourced running total (square-root curve, K=50, cap L10)
  unspentPoints: number; // 1 per level gained; allocated into ONE attribute
  xpPointsGranted: number; // total points ever granted (level-1, tracked so
  // allocation never double-grants and idle saves stay consistent)
  specialization: Specialization | null; // one-time L3 choice; null = pending
  // Rolling day-window for the +40 XP/day soft cap (key = UTC date, see xpDayKey).
  day: string;
  dayXp: number;
}

// An in-progress (or just-completed) research-tree project, run by an appointed
// Leader. Resolves lazily in advance() like studies.
export interface ResearchJob {
  id: string;
  techId: string;
  leaderId: string;
  startedAt: number;
  durationMs: number;
  status: "researching" | "complete";
}

/** Colony-side armory (weapons-system §6): one family's built tier.
 *  tier 0 = not built; 1–4 = built at that tier. everBuilt latches the first
 *  build (deed + cosmetic gates read it). */
export interface ArmoryFamilyState {
  tier: 0 | 1 | 2 | 3 | 4;
  everBuilt?: boolean;
}

/** An in-progress weapon build/upgrade, resolved lazily in advance() exactly
 *  like expeditions (offline-safe, idempotent): when `now >= doneAt` the
 *  family rises to `targetTier` and the record is consumed. One active build
 *  per family — no queuing (real commitment, weapons-system §6). */
export interface ArmoryBuild {
  targetTier: 1 | 2 | 3 | 4;
  startedAt: number;
  doneAt: number;
}

// ------- Daily to-do + Oracle Devotion (V7, daily-devotion-spec) -------
//
// A rotating, opt-in daily list of 4 small objectives drawn TODAY from the live
// beta systems, each granting a small Scrip reward (earned-only — the FIRST LIVE
// SCRIP FAUCET) plus Oracle Devotion (a per-colony monotonic ledger that is the
// soil Oracle favor later grows in). See design/daily-devotion-spec.md + the
// pure module src/game/daily.ts (config, pool, generator, funnel, reconcile,
// claim, favor formula live there — this file only declares the state shape).
//
// Owner-ratified (2026-09-12): TD1 (4 items/day, ≤1 launch, ≤2 expedition-
// family, ≥1 non-expedition, purity ~every other day, unlock-gated pool),
// TD2 (+30 Scrip/+1 Devotion per item, +80/+3 bonus, daily max 200/7),
// TD5 (Devotion total + streak PUBLIC — favor internals/Oracle thresholds
// SERVER-ONLY; api.ts strips `events`/`rolledAt`/`lastStreakDay`/`banked`).
export interface DailyState {
  /** UTC day key (utcDayKey) this list was generated for; "" = never rolled
   *  (fresh/migrated saves — the first advance rolls a fresh list). */
  dayKey: string;
  /** The day's item ids (daily.ts DAILY_ITEM_POOL), deterministic per day. */
  list: string[];
  /** SERVER-ONLY: per-day dedupe set (raw event markers, e.g. "daily_list"
   *  season-pass firing). Client never receives this (api.ts strips it). */
  events: string[];
  /** Item ids completed TODAY by real engine events (auto: visit_cradle's
   *  free tick at rollover). Completions are public — not secrets. */
  completed: string[];
  /** Item ids already claimed today (rewards granted; reset each rollover). */
  claimed: string[];
  /** The day's +80/+3 list-completion bonus claimed? (reset each rollover). */
  bonusClaimed: boolean;
  /** When the current list was generated (server-side; stripped from client). */
  rolledAt: number;
  /** UTC-day key the streak was last evaluated at — exactly-once bookkeeping,
   *  the ONLY streak field (growUntouchedStreak precedent). Server-only. */
  lastStreakDay?: string;
  /** SERVER-ONLY · TD3 "banked forever": unclaimed completions of PAST days
   *  survive the rollover here (dayKey → their unclaimed items + bonus), so
   *  work done but never claimed loses nothing. Stripped from every public
   *  payload (api.ts) — the client only ever sees the day's own list state. */
  banked?: Record<string, { items: string[]; bonus: boolean }>;
}

export interface GameState {
  version: number;
  // Unique id of this game within its account's save (set at creation; the
  // account save maps gameId -> GameState). Legacy single-save files get "0".
  gameId?: string;
  createdAt: number;
  lastTick: number; // last time the engine advanced (epoch ms)
  playerName: string;
  race: RaceId | null;
  raceLocked: boolean;

  resources: {
    embers: number;
    chipsets: number;
    supplies: number;
    // Radiation gear (crafted in the Workshop with Supplies):
    hazmat: number; // hazmat suits — let a team EXPLORE deep zones
    shots: number; // radiation support shots — attrition buffers
    alloys: number; // forged alloy-armed digging machines — let a team EXTRACT
    // Everyday logistics gear (Tier 0 — gates fielding any expedition):
    medkit: number; // medical kit — bandages, basic shots vs sickness
    mechkit: number; // basic mechanics kit — patch-up / basic vehicle repair
    armorkit: number; // armor/armature kit — crew + light vehicle protection
    // Tier 1 gear (outer/mild zones):
    skmech: number; // skilled mechanics — repair/maintain heavier machinery
    gas: number; // vehicle fuel — long-distance haul, consumed per run
    battery: number; // battery packs (electric) — quiet ops, consumed per run
    // Per-race territory materials (unique), gathered by raiding other races'
    // home regions. The forged alloy requires your OWN + 4 OTHER races' mats.
    mats: Record<RaceId, number>;
    // Condensed high-energy matter refined at the lab (25 embers → 1 plasma,
    // research-gated) and salvaged from deep chipset sites. The lifeblood of
    // high-tier weapons — rare, never cheap, earn-only (weapons-system §2).
    plasma: number;
  };

  scientists: number;
  totalScientists: number;

  // Lab research: insight is the research currency generated by study.
  insight: number;
  // Cumulative knowledge — drives the colony's advancement tier.
  deployedDomains: DomainLevel;
  // Tracked unlock of "deployable AI programs" via study (count of unlocks).
  deployablePrograms: string[];

  // ---- Knowledge track: Codices + the research tree (owner 2026-09-01) ----
  // Codices are human knowledge — earned (recovery outcomes, deeds), NEVER looted.
  codices: number;
  totalCodicesEarned: number;
  // Researched tech ids (the research tree unlocks).
  techsResearched: string[];
  researchJobs: ResearchJob[];
  leaders: Leader[];
  deedsCompleted: string[];
  totalBreakthroughs: number;
  // ---- Leader XP day-cap ledger (shared colony-wide cap per UTC day) ----
  // dayKey -> XP already taken from the shared cap today, so back-to-back
  // research cannot grind past the daily budget. Persisted so offline runs
  // resolve against the SAME cap the online runs spent from.
  leaderXpCaps: Record<string, number>;

  // ---- Hidden Unbound revelation track (V4, entirely server-side) ----
  // Silent purity counters: incremented by player actions, NEVER sent to the
  // client (api.ts strips them from every payload). When silent thresholds
  // cross, a cryptic revelation research chain unlocks with no explanation.
  revelationCounters: {
    cleanRecoveries: number; // expeditions with ZERO radiation loss AND zero wildcard
    zeroCorruptionSurvivals: number; // clean recoveries launched while corruption sat at 0
    deepCleanLandings: number; // clean recoveries from the deep scientific sites (rad >= 60)
    codicesEarnedByDeeds: number; // Codices from deedsCompleted, NOT the expedition-clean stream
    maxDomainDepth: number; // max deployed-AI domain level ever reached
    untouchedDayStreak: number; // consecutive UTC days with ZERO corruption gain
    cleanStreak: number; // consecutive clean recoveries (resets on any tainted run)
    lastCorruptionDay?: string; // UTC-day key of the last corruption gain (streak bookkeeping)
    lastStreakDay?: string; // UTC-day key the untouched-day streak was last evaluated at
    oneTimeWildcardBiasUsed?: boolean; // rv2's one-shot benign-bias shield, consumed on use
  };
  revelations: string[]; // RESOLVED revelation ids (mirrors techsResearched; visibility is separate)
  revelationHunts: boolean; // Chorus hunts the pure: slower attention decay, hotter deep zones
  revelationFirstOpenAt?: number; // stage1 fired at this time: rv1 is visible (exactly-once Chronicle beat)
  // Owner amendment (2026-09-05): the world has acknowledged this colony ONCE
  // for its contribution (server-side only; contribution score crossing the
  // beta threshold). Required IN ADDITION to stage3 before rv3 opens. The
  // client never learns of this field — publicState (api.ts) strips it.
  acknowledgedOnce: boolean;
  // revelations[] ships as the VISIBLE set only (resolved + currently available
  // — exactly the glyphs the Lab may render). revelationsResolved ships the
  // resolved subset so the client can tell done from available. Raw counters,
  // the hunt flag, the choice, reward fields and the first-open timestamp
  // NEVER leave the server (see publicState in api.ts).
  revelationsResolved: string[];
  revelationAnswered?: boolean; // PUBLIC: true once the rv3 glimpse choice is recorded (hides the one-time modal)
  revelationChoice?: "sealed" | "open" | null; // rv3's one-per-game decision (null = pending)
  // ---- Revelation reward state (silent multipliers; defaults = no effect) ----
  revelationCorruptionGainMult?: number; // rv1: 0.85 purity discount on future corruption gains
  revelationDrainPerMin?: number; // rv1: +0.5/min passive corruption drain (additive to clearRate)
  revelationChorusMult?: number; // rv3 choice: 0.75 attention-gain preview of the anti-Chorus art

  expeditions: Expedition[];
  studies: StudyJob[];
  completedExpeditions: number;
  totalEmbersLooted: number;
  totalChipsetsLooted: number;

  corruption: number; // 0-100, high is bad
  chorusAttention: number; // 0-100, high = Chorus closes in

  // ---- Monetization (V5): currencies + entitlements (server-side seams) ----
  // Survey-only BY DESIGN (see design/monetization.md §7): the catalog, ledger,
  // entitlement hooks and payment-provider seam ship now; NO storefront exists
  // and NO real money moves. `storefrontEnabled` in MONETIZATION_CONFIG gates
  // every purchase path until the owner flips the switch. Nothing here can be
  // bought that touches power — the guardrails are asserted by tests.
  currency: CurrencyState; // Scrip (earned) + Votives (premium); ledger append-only
  entitlements: EntitlementsState; // owned cosmetics / packs / passes / vehicles / sigils
  battlePass: BattlePassState; // Season 0 "The Shattering" (PvE loop, 28 tiers)

  // ---- Colony-side Armory (V6, earn-only war hardware) ----
  // Built at the Cradle from expedition-gathered resources + refined plasma.
  // tier 0 = family not built; tiers 1–4 = built/upgraded. IN-FLIGHT builds
  // live in armoryBuilds and resolve lazily in advance() (offline-safe).
  armory: Record<string, ArmoryFamilyState>; // familyId (the 5 war roles) -> state
  armoryBuilds: Record<string, ArmoryBuild>; // familyId -> in-flight build (max 1)
  weaponsBuilt: number; // completed builds ever (war "might" surface — NOT the
  // contribution formula; the Unbound gate is untouched, see engine V6 note)

  // ---- Daily to-do + Oracle Devotion (V7) ----
  // The daily list (4 opt-in objectives/day, rotate on the UTC day-timer),
  // the monotonic Devotion ledger (accrued on CLAIM — the soil Oracle favor
  // later grows in), and the devotion streak (consecutive UTC days with ≥1
  // completed item from play — prestige-only, D6 Wheel-of-Years at 30 days).
  // Devotion + streak are PUBLIC per TD5; `daily` ships as a stripped view
  // (api.ts publicState); favor internals/thresholds never leave the server.
  daily: DailyState;
  devotion: number; // lifetime total, MONOTONIC (like totalCodicesEarned)
  devotionStreak: number; // consecutive UTC days with ≥1 completed item

  // ---- Real-time battle engine (V9, battle-side §15 — The Fall's engine) ----
  // Persistent battle entities (offline-safe, lazily resolved in advance())
  // and the append-only battle-report ledger (the §7 History Book's raw
  // material). Per-colony in v1 (the prologue is a solo story); the
  // world-level war ledger with every colony watching every front arrives
  // with war Phase 1 (battle-side §10.2). Engine internals per battle are
  // stripped by publicState via battlePublicView (api.ts).
  battles: Battle[];
  battleReports: BattleReport[];
  /** The colony's deployable war reserve (B12/B11 server-verified seam) —
   *  supply-weighted troops + the §6 weekly energy pool + locked hero
   *  commitments + the co-op aid recognition ledger. Grows only from play;
   *  the prologue seeds the full-power state's numbers at Act I. The battle
   *  engine VALIDATES against it; the API handler (and prologue) deduct the
   *  recorded costs — never a purchasable path (battle-side §9/B4). */
  warReserve: WarReserve;
  // ---- Prologue state spine (V11, opening-prologue-spec §4–§8 — The Fall) ----
  // The per-colony ledger for the voiced opening: stage, sealed height
  // records, the final stand, the History Book + ash echoes. The player's own
  // story — ships whole in publicState (api.ts). ensurePrologue (V11)
  // backfills pre-V11 saves additively (stage "rebuilt", completed false).
  prologue: PrologueBlock;
  log: string[];
}

// ------- Monetization state (monetization.ts owns the rules) -------

export type CurrencyId = "scrip" | "votives";
export type CurrencyLedgerKind = "earn" | "spend" | "grant" | "purchase";

/** Append-only ledger entry (spec §1.4): eventId-keyed so every grant/spend is
 *  idempotent — a retried purchase can never double-credit. Server truth only;
 *  the client renders balances, never the ledger itself. */
export interface CurrencyLedgerEntry {
  eventId: string;
  kind: CurrencyLedgerKind;
  currency: CurrencyId;
  amount: number; // signed: + earned/granted/purchased, − spent
  reason: string;
  ts: number;
}

export interface CurrencyState {
  scrip: number; // earned currency (Cradle Scrip)
  votives: number; // premium currency (Votives)
  ledger: CurrencyLedgerEntry[];
}

export type CosmeticSlot =
  | "cradleFacade"
  | "banner"
  | "vehicleTrim"
  | "shrineMotif"
  | "leaderGarb"
  | "sigilFrame"
  | "palette";

/** Owned items. All grant paths are idempotent: cosmetics/packs/passes/vehicles
 *  are membership sets, and `consumed` records every eventId/purchaseId already
 *  processed so retries can never double-grant. */
export interface EntitlementsState {
  cosmetics: string[]; // owned cosmetic item ids (equippable via `equips`)
  packs: string[]; // claimed head-start pack ids
  passes: string[]; // owned premium season-pass ids (never expire — §4.1)
  vehicles: string[]; // vehicle grants (Long-Haul Cart etc.; model arrives later)
  conveniences: string[]; // preset slots / palettes / display stands
  sigils: number; // Season Sigils (deed-currency balance — Deed Exchange later)
  scripFromPacks: number; // lifetime Scrip granted by packs (hard cap §3.3)
  consumed: string[]; // processed eventIds / purchaseIds (idempotency set)
  equips: Partial<Record<CosmeticSlot, string>>; // equipped cosmetic per slot
}

/** Battle-pass state machine (spec §7.5). Rolling day/week windows behave like
 *  the Leader-XP day cap: a stale window simply reads as "nothing today". */
export interface BattlePassState {
  seasonId: string;
  xp: number; // Season XP from play (server-verified; objectives grant on completion)
  premium: boolean; // premium track purchased (Votives / payment-provider pass)
  claimed: string[]; // claimed reward keys: `${tier}-free` | `${tier}-premium`
  day: string; // UTC day-key the daily objectives currently roll against
  dayObjectives: string[]; // daily objective ids completed today (each grants XP once)
  week: string; // UTC week-key the weekly counters roll against
  weekCounts: Record<string, number>; // objective id -> progress toward its target
  weekCompleted: string[]; // weekly objective ids completed this week
}

export interface Zone {
  id: string;
  name: string;
  owner: RaceId | "shared" | "special";
  risk: number; // 0-100 base danger
  radiationLevel: number; // 0-100; DEEP=35 threshold needs gear + risk pop-up
  range: number; // 0-100 how far the site sits (long-haul fuel/gas need — discovery)
  quiet: number; // 0-100 how silent you must be near the Chorus (battery need — discovery)
  baseDurationMs: number;
  emberYield: number; // base ember range midpoint
  chipsetChance: number; // 0-1
  corruptionRisk: number; // 0-1 chance
  chorusRisk: number; // 0-1 chance
  flavor: string;
}

export interface Race {
  id: RaceId;
  name: string;
  title: string;
  blurb: string;
  lore: string;
  homeRegion: string;
  flavorQuote: string;
  attributes: { label: string; kind: "strength" | "weakness" | "cost" | "future" }[];
  // gameplay modifiers affecting the MVP loop (multiplicative / additive)
  mods: {
    studySpeed: number; // multiplier on study duration (lower = faster)
    emberGain: number; // multiplier on embers looted
    chipsetChance: number; // multiplier on chipset chance
    suppliesEfficiency: number; // multiplier on supplies used (lower = cheaper)
    corruptionResist: number; // multiplier applied to corruption gains (lower = more resistant)
    chorusResist: number; // multiplier applied to chorus attention (lower = more resistant)
    yieldSupply: number; // supplies earned from agriculture/economy (number per minute baseline)
  };
  accent: string; // canon fill/tint hex (spec A.3) — append "22"/"55" for alpha fills
  accentText: string; // accent text color, ≥4.5:1 on surf-3 (spec A.3 text column)
}

// ------- Beta feedback channel (First Run) -------
export type FeedbackCategory = "bug" | "flow_issue" | "feature_suggestion";
export type FeedbackSeverity = "low" | "medium" | "high" | "critical";
export type FeedbackStatus = "new" | "read" | "triaged" | "done";
export interface FeedbackRecord {
  id: string;
  accountId: string;
  createdAt: number;
  category: FeedbackCategory;
  title: string;
  description: string;
  playerName?: string;
  severity?: FeedbackSeverity;
  status: FeedbackStatus;
}
