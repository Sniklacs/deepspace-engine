// Shared game types for Deepspace Engine MVP.

import type { Battle, BattleReport, WarReserve } from "./war/war-types";
import type { ArenaBout, ArenaChallenge } from "./war/arena";
import type { CasualtyRecord, MercenaryBand, TroopHome } from "./war/troops";
import type { ForwardBase } from "./war/forward-bases";
import type { PrologueBlock } from "./prologue/prologue-state";
import type { ForgeItem } from "./forge";
import type { TimeTokenLedgerEntry } from "./time-tokens";

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
  /** TIME TOKENS (owner 2026-09-27): milliseconds earned tokens have taken off
   *  this run. `durationMs` stays the job's BASE duration, so the floor
   *  (`MIN_TIMER_FRACTION` of base) is always readable and never drifts. */
  timeTokenMs?: number;
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
  /** TIME TOKENS (owner 2026-09-27): milliseconds earned tokens have taken off
   *  this build. `doneAt`/`startedAt` never move — the record keeps the finish it
   *  was created for, and the EFFECTIVE finish is `doneAt - timeTokenMs`, so the
   *  floor (`MIN_TIMER_FRACTION` of `doneAt - startedAt`) is always readable. */
  timeTokenMs?: number;
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
  // ---- THE RE-TIME (owner-ratified 2026-09-26) --------------------------
  /** Expedition energy, in charges. Regenerated continuously at
   *  `engine.energyCapacity(state)` charges/day and spent per run, so a shallow
   *  rung cannot be farmed without limit. Lazy like every other clock: the
   *  engine has no timer of its own, `energyAt` is the stamp the pool was last
   *  topped up at (a queued `advance()` tops it up again). */
  energy?: number;
  energyAt?: number;
  /** One-shot migration stamp: absent = the save predates the ladder and its
   *  running timers must be re-based once (spec §7). Set by the pass itself so
   *  a second deploy can never double-rebase. */
  timerRebase?: number;
  /** The in-flight domain deployment — `deployProgram` runs on a timer now
   *  (the L10 cap without one leaves the R = 6 arithmetic open). Null/absent =
   *  nothing deploying. Completion is derived from `startedAt + durationMs`;
   *  the level itself only moves in the resolver, so an offline world advances
   *  it exactly once. */
  programDeploy?: { domain: DomainId; startedAt: number; durationMs: number; timeTokenMs?: number } | null;
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
    // THE FORGE's ingredient (owner 2026-09-26): torn off war wrecks, and only
    // the DEEP sites have it — a rare drop in the deeper Explorations. Earn-only
    // by construction: nothing purchasable can grant it (forge §earn-only).
    warplate: number;
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
  // ---- Orbital Watch (design/satellites.md) ----
  // Season identity the constellation rolls against (§0.4). Set at founding;
  // when the season system advances it, advance() re-rolls the sky.
  seasonId: string;
  // The constellation over this world: per-node satellite stages (0 dormant …
  // 3 full picture), rolled ~50% awake and re-randomized every season. Satellite
  // completions are tracked in `restored`, NOT techsResearched — the sky never
  // inflates research counts. Initialized/migrated by the engine; never null
  // after ensureSatellites runs in advance().
  satellites: {
    seasonId: string;
    stages: Record<string, 0 | 1 | 2 | 3>;
    restored: string[];
  };
  /** The map node this colony stands on (a covered rim/heart node). Raids
   *  head for the colony; satellites watch the node — this is the link the
   *  raid alarm checks. Assigned at founding, backfilled deterministically
   *  for older saves (satellites.colonyNodeId). */
  homeNodeId?: string;
  /** Live raid alarm (satellite klaxon, owner 2026-10-03). Set when a watched
   *  node's satellite spots an incoming raid; cleared on acknowledge or when
   *  the raid lands/resolves. The client renders the full-screen siren UI
   *  while this is non-null. */
  raidAlarm?: import("./raid-protocol").RaidAlarm | null;
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
  // Owner order 2026-10-01: every colony starts out with 10,000 supplies
  // (new players were turtling on 60 and reading the early game as a money
  // trap). New colonies are born with it; pre-change saves get a one-time
  // top-up via ensureResources. Once granted, never again.
  startingSuppliesGranted?: boolean;
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
  // ---- THE FORGE (owner 2026-09-26) ----
  // ONE roll, ONE item, never reproducible — no copies, no blueprint, no mass
  // production. `forgeItems` holds MATERIALIZED pieces (unique identity, owner,
  // location) so a refresh, a re-login or an offline advance can never reroll
  // one; `forgeRolls` maps a client request id to the item it produced, which
  // makes a double-submit a no-op instead of a second charge. Both ship to the
  // client unchanged (they are the player's own gear; nothing here is a secret).
  forgeItems: ForgeItem[]; // the racks — stored at the Cradle until deployed
  forgeRolls: Record<string, string>; // requestId -> item id (idempotent rolls)
  forgeSeq: number; // monotonic counter feeding each item's unique id
  forgeMelts: number; // melt-downs ever (the junk valve)
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

  // ---- TIME TOKENS — the EARNED path (owner direction, 2026-09-27) ----
  // One 1-minute and one 5-minute token per Devotion reward claim, held here
  // until a player spends one on a single running timer (armory build, Lab
  // research, domain deploy — NEVER an exploration run: the ladder's timers ARE
  // its price). `timeTokens` is the player's own holding and ships to the client
  // (api.ts maps it through timeTokensPublicView); `timeTokenLedger` is the
  // server's append-only idempotency record (the grantCurrency discipline) and is
  // STRIPPED from every payload. Both are backfilled at zero by ensureTimeTokens.
  // NOTHING SELLS A TOKEN in this build: `storefrontEnabled` is false and the
  // sell-side ruling is unsigned. A token grants no resource, no strength, no
  // scored currency and no season tier.
  timeTokens?: Record<string, number>; // held counts, keyed by size id
  timeTokenLedger?: TimeTokenLedgerEntry[]; // append-only; server-only

  // ---- Real-time battle engine (V9, battle-side §15 — The Fall's engine) ----
  // Persistent battle entities (offline-safe, lazily resolved in advance())
  // and the append-only battle-report ledger (the §7 History Book's raw
  // material). Per-colony in v1 (the prologue is a solo story); the
  // world-level war ledger with every colony watching every front arrives
  // with war Phase 1 (battle-side §10.2). Engine internals per battle are
  // stripped by publicState via battlePublicView (api.ts).
  battles: Battle[];
  battleReports: BattleReport[];
  /** ARENA (arena-market.md Part I): challenges + recorded bouts. Ships in
   *  publicState (nothing secret — the ladder is public by design). */
  arenaChallenges?: ArenaChallenge[];
  arenaBouts?: ArenaBout[];
  /** The colony's deployable war reserve (B12/B11 server-verified seam) —
   *  supply-weighted troops + the §6 weekly energy pool + locked hero
   *  commitments + the co-op aid recognition ledger. Grows only from play;
   *  the prologue seeds the full-power state's numbers at Act I. The battle
   *  engine VALIDATES against it; the API handler (and prologue) deduct the
   *  recorded costs — never a purchasable path (battle-side §9/B4). */
  warReserve: WarReserve;
  /** THE MUSTER (design/muster-troops.md) — real troops, not ghost numbers.
   *  Optional for migration: pre-muster saves initialize empty on first
   *  advance (ensureTroops). `home` is the Cradle garrison + muster queues +
   *  hunger clock; `bands` are deserter mercenary bands in the wild on this
   *  server (hireable); `history` is the append-only casualty feed the
   *  memorial plaques read. Nothing here is secret — all three ride the
   *  public state to the client. */
  troops?: {
    home: TroopHome;
    bands: MercenaryBand[];
    history: CasualtyRecord[];
  };
  /** FORWARD BASES (design/forward-base.md) — beachheads on foreign servers.
   *  Optional for migration: pre-beachhead saves initialize empty on first
   *  advance (ensureForwardBases). Keyed by foreign serverId — max one base
   *  per key, enforced by plantForwardBase. `serverBands` is the SHARED
   *  server-level mercenary pool: deserters from any starving base (or
   *  garrison) land in their server's list, hireable by anyone there —
   *  including the enemy. `lastJumpAt` gates the 24h jump cooldown. */
  forwardBases?: Record<string, ForwardBase>;
  serverBands?: Record<string, MercenaryBand[]>;
  lastJumpAt?: number | null;
  /** WORLD MAP & ABANDONED COLONIES (design/abandoned-colonies-world-map.md) —
   *  scout probes, known colonies, gleaning runs. Optional for migration:
   *  pre-worldmap saves initialize via emptyWorldMap on first advance. */
  worldMap?: import("./worldmap").WorldMapState;
  /** ALLIANCES + RALLIES (design/alliances.md) — the war band. Server-shaped   *  records (keyed by id, members by colonyId) so a future multiplayer
   *  server migration is mechanical. Soul-level: membership PERSISTS across
   *  seasons — no reset path touches this store (alliances.md §9).
   *  Initialized by ensureAlliances/ensureRallies on first advance. */
  alliances?: Record<string, import("./war/alliances").Alliance>;
  rallies?: Record<string, import("./war/rallies").Rally>;
  reinforcements?: import("./war/alliances").Reinforcement[];
  /** Guest mirrors: foreign troops stationed AT this colony (their bodies
   *  live on the sender's save; this is the host's shadow copy). */
  guestMirrors?: import("./war/alliances").GuestMirror[];
  /** Outbound cross-account effect queue — drained by alliance-transact. */
  allianceFx?: import("./war/alliances").AllianceFx[];
  /** Idempotency ledger for applied effects (dedupe key → applied at). */
  allianceFxDone?: Record<string, number>;
  /** Help-tick daily budget (server day key + spent count). */
  helpDay?: string;
  helpUsed?: number;
  /** Help ledger: ticks this colony gave; who helped this colony this week. */
  helpLedger?: import("./war/alliances").HelpTick[];
  helpReceived?: import("./war/alliances").HelpTick[];
  /** MAILBOX (owner 2026-10-03) — the in-game inbox. Alerts, announcements,
   *  alliance activity, patch notes. Optional for migration: old saves get
   *  an empty box on first access via ensureMailbox. */
  mailbox?: import("./mailbox").MailMessage[];
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
