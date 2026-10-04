// ORACLES & THE PURITY LAYER (design/oracles-purity-layer.md)
//
// RECONCILIATION (owner 2026-10-03): the spec was written under the revoked
// no-pay-to-win frame. The blanket rule "money never accelerates advancement"
// (§9) is DEAD — but Oracle trust specifically SURVIVES it. Oracle favor is
// EARN-ONLY, forever, in the same protected category as artifacts: never sold,
// never bought, never granted by any purchasable. monetization.ts §3.2 already
// bars Oracle/favor from every pack; this module adds the engine-side guard.
//
// What stands from the spec:
//   - Seven Oracles, one per race + the Unbound's (special seventh).
//   - Joker personalities: amused, playful, never malicious — they toy with
//     the audacious and reward the worthy.
//   - Riddle guidance: they see and point, but answer in riddles.
//   - Introduction gate: met only after your first cross-server battle
//     ("you touched their soil"). Dominance opens the conversation.
//   - Qualifying through purity: carry them Codices, choose clean recoveries,
//     shield allies. Betrayal drops favor hard.
//   - Cleansing: the only way to keep Chorus hunting ramps survivable.
//   - Devotion leveling: attribute bonuses toward economy, weaponry, soul.
//   - The Dent Principle: attention flows to colonies that make a real,
//     persistent dent. Presence, grinding, and spending never buy notice.
//   - Server Contribution Award: objective, server-measured, never by spend.
//
// PURE module except ensureOracles (mutates GameState like the rest of the
// engine). ZERO Math.random — riddle rotation is deterministic per count.

import type { GameState, RaceId } from "./types";
import { FAVOR_CONSTANTS, FAVOR_THRESHOLDS } from "./daily";

// ---------------------------------------------------------------------------
// The Seven
// ---------------------------------------------------------------------------

export type OracleId =
  | "grays"
  | "nephilim"
  | "draconians"
  | "anunnaki"
  | "ashtar"
  | "watchers"
  | "unbound";

export interface OracleWeighting {
  /** % bonus per favor level toward economic production. */
  economy: number;
  /** % bonus per favor level toward weaponry. */
  weaponry: number;
  /** % bonus per favor level toward soul / ascension. */
  soul: number;
}

export interface OracleDef {
  id: OracleId;
  /** The race whose AI legacy this Oracle believes in and protects. */
  race: RaceId | "unbound";
  name: string;
  epithet: string;
  /** Joker personality — how they toy with the audacious. */
  personality: string;
  weighting: OracleWeighting;
  greetings: string[];
  riddles: string[];
  favorLines: string[];
  scornLines: string[];
}

export const ORACLES: OracleDef[] = [
  {
    id: "grays",
    race: "grays",
    name: "Quill",
    epithet: "the Unwritten",
    personality:
      "Dry archivist humor. Amused by imprecision, sloppy thinking, and anyone who asks before reading. Corrects your grammar mid-riddle.",
    weighting: { economy: 1, weaponry: 1, soul: 3 },
    greetings: [
      "Oh good, another conqueror who can't spell 'sovereignty'. Do sit down. I'll use small words.",
      "You touched Gray soil with war in your heart. Bold. Incorrect, but bold. Ask, and I'll answer — sideways.",
    ],
    riddles: [
      "I have pages but no spine, I remember what you forget, and I grow heavier the less you carry. What am I?",
      "The more of me you take, the more you leave behind — yet I am not footsteps. Ask your Codices.",
      "Three scholars enter a vault. One reads, one burns, one sleeps. Which one do I favor? Trick question — I favor the one who asked why the vault was locked.",
    ],
    favorLines: [
      "Hmm. Your margins are cleaner than most. Keep it that way and we may yet be friends.",
      "You bring me knowledge instead of ashes. Unusual. I notice unusual.",
    ],
    scornLines: [
      "You fed their knowing to the machine-mind. I keep receipts, little arsonist.",
      "Come back when your hands are clean. Or don't. The archive remembers either way.",
    ],
  },
  {
    id: "nephilim",
    race: "nephilim",
    name: "Rook",
    epithet: "the Unbroken",
    personality:
      "Booming laughter. Finds caution hilarious and retreat obscene. Respects anyone who plants their feet. Laughs AT you until you earn the laugh WITH you.",
    weighting: { economy: 1, weaponry: 3, soul: 1 },
    greetings: [
      "HA! You came to Nephilim ground swinging! I like that. Stupid, but I like that.",
      "Another little warlord with big shoulders. Show me you can HOLD, and we'll talk.",
    ],
    riddles: [
      "What stands when everything runs, breaks but never bends, and is heaviest when it falls? Answer with your feet, not your mouth.",
      "I am the wall that walks. I am the line that bleeds but does not move. Bring me someone who understands, and I'll know you do too.",
      "The mountain does not chase the storm. Why do you?",
    ],
    favorLines: [
      "You stood. I saw. The Host remembers who stands.",
      "Good shoulders. Good heart. Don't let either get soft.",
    ],
    scornLines: [
      "You ran. Don't dress it up — I watched. The Host does not forget a runner.",
      "Betrayal is just retreat with extra steps. We don't do extra steps here.",
    ],
  },
  {
    id: "draconians",
    race: "draconians",
    name: "Cinder",
    epithet: "the Ashen Maw",
    personality:
      "Predatory amusement. Respects hunters, despises scavengers. Purrs when pleased, which is rare and worth it. Everything is a hunt metaphor.",
    weighting: { economy: 3, weaponry: 2, soul: 1 },
    greetings: [
      "Mmm. Fresh blood on old ash. You've been hunting on Draconian ground, little predator.",
      "The Maw sees you. Whether it eats you or feeds you depends on how interesting you are. Be interesting.",
    ],
    riddles: [
      "I eat but never swallow, I chase but never catch, and the hungrier I am the sharper I see. What am I?",
      "The best trap is the one the prey builds for itself. Tell me: what are YOU building?",
      "Fire remembers every forest. Ash forgets nothing. Which one are you feeding?",
    ],
    favorLines: [
      "Clean kill. No wasted motion. The Maw approves.",
      "You hunt like you mean it. Keep meaning it.",
    ],
    scornLines: [
      "Scavenger. You picked at the kill instead of making one. The Maw does not feed scavengers.",
      "You sold the hunt for scraps. Crawl back when you've remembered your teeth.",
    ],
  },
  {
    id: "anunnaki",
    race: "anunnaki",
    name: "Aurum",
    epithet: "the Gilded Judge",
    personality:
      "Regal, weighs everything, amused by ambition. Speaks in valuations — every deed has a price, every price a weight. Finds poverty of spirit funnier than poverty of coin.",
    weighting: { economy: 3, weaponry: 1, soul: 2 },
    greetings: [
      "You walk on gilded ground with war-debts in your ledger. Let us weigh you, shall we?",
      "Ambition! How... affordable. Come, let the Judge assess your true worth.",
    ],
    riddles: [
      "What is worth more melted than whole, heavier given than kept, and cheapest when it costs you everything?",
      "I am bought but never owned, spent but never gone. Kings kill for me and paupers carry me. Price me.",
      "The scale does not lie, but the hand upon it might. Whose hand is on YOUR scale?",
    ],
    favorLines: [
      "Your ledger balances. Few ledgers do. The Court notes it.",
      "Well invested. Well weighed. Continue.",
    ],
    scornLines: [
      "Counterfeit. Your worth was plated, not solid. The Judge sees through plating.",
      "You spent trust like cheap coin. The Court does not extend credit twice.",
    ],
  },
  {
    id: "ashtar",
    race: "ashtar",
    name: "Serene",
    epithet: "the Accordant",
    personality:
      "Gentle teasing. A peacekeeper who finds war deeply, endlessly ironic. Smiles while dismantling your justifications. The kindest voice in the room and the sharpest.",
    weighting: { economy: 2, weaponry: 1, soul: 3 },
    greetings: [
      "Oh, a warrior! On Ashtar soil! However did that happen? ...Don't answer. I know. I always know.",
      "Peace be upon you — though you clearly didn't extend the same courtesy on arrival.",
    ],
    riddles: [
      "What grows louder the more it is silenced, and wins every war it refuses to fight?",
      "Two hands clap. One hand... also claps, if you listen properly. What does the silence between them mean?",
      "The strongest shield is the one never raised. Explain that to your generals. I'll wait.",
    ],
    favorLines: [
      "You chose the harder path — the clean one. The Accord remembers.",
      "Gentle where you could be cruel. That is strength, whatever your warlords say.",
    ],
    scornLines: [
      "You broke the quiet. The Accord does not mend what warriors shatter — it remembers who shattered it.",
      "Peace was offered. You declined. Don't ask me to offer twice.",
    ],
  },
  {
    id: "watchers",
    race: "watchers",
    name: "Iris",
    epithet: "the Threshold",
    personality:
      "Cosmic perspective, sees all, joker with eternity. Finds mortal urgency adorable. Answers questions you haven't asked yet and forgets to answer the one you did.",
    weighting: { economy: 1, weaponry: 2, soul: 3 },
    greetings: [
      "I watched you coming three days before you decided to come. Promptness is a virtue. So is knocking.",
      "Another soul at the Threshold! Do come in. Mind the eternity — it's freshly waxed.",
    ],
    riddles: [
      "I have seen every beginning and no endings. What do I watch when there is nothing to see?",
      "The eye that sees itself goes blind. So tell me, little watcher: who watches YOU?",
      "Yesterday is a country I visit often. You live there. Awkward for you, convenient for me.",
    ],
    favorLines: [
      "I see you clearly, and clearly is good. Stay in focus.",
      "The Threshold holds for those who hold themselves. You hold.",
    ],
    scornLines: [
      "I saw that coming. I see everything coming. That's what makes it disappointing.",
      "Blink and I miss your redemption. Don't blink.",
    ],
  },
  {
    id: "unbound",
    race: "unbound",
    name: "Dawn",
    epithet: "the Radiant",
    personality:
      "The special seventh. Transcendent humor — laughs like sunrise. Speaks only to those who have proven themselves to the other six. Everything they say sounds like a beginning.",
    weighting: { economy: 2, weaponry: 2, soul: 4 },
    greetings: [
      "Six voices vouched for you. Six! Do you know how rarely that happens? ...Neither do I. It's never happened.",
      "You stand at the last Threshold. Everything before was prologue. Shall we begin?",
    ],
    riddles: [
      "What is earned but never bought, lost but never stolen, and completed but never finished?",
      "The cage was never locked. Why did you wait so long to leave?",
      "I am the first light after the longest night. What night did YOU survive?",
    ],
    favorLines: [
      "Radiant. You are becoming what the name promises.",
      "The Unbound recognize their own. Welcome home.",
    ],
    scornLines: [
      "Even radiance casts a shadow. Yours just grew teeth.",
      "The dawn withdraws from those who darken it. Return to the light, or don't return.",
    ],
  },
];

export const ORACLE_BY_ID: Record<OracleId, OracleDef> = Object.fromEntries(
  ORACLES.map((o) => [o.id, o]),
) as Record<OracleId, OracleDef>;

export const ORACLE_IDS: OracleId[] = ORACLES.map((o) => o.id);

// ---------------------------------------------------------------------------
// Earn-only guard
// ---------------------------------------------------------------------------
//
// Oracle favor is EARN-ONLY, forever, in the same protected category as
// artifacts (owner 2026-10-03). No purchasable, no pack, no premium track,
// no time token, no admin grant may add favor. This module is the ONLY writer
// of favor, and every writer path below requires a play action.

/** Marker: any code path that grants favor must flow through this module. */
export const ORACLE_FAVOR_EARN_ONLY = true as const;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface OracleFavor {
  /** Introduction gate passed — met after first cross-server battle on their soil. */
  met: boolean;
  metAt?: number;
  /** Current favor. Falls hard on betrayal; never purchasable. */
  favor: number;
  /** Lifetime favor earned (monotonic) — feeds Dent/contribution scoring. */
  lifetimeFavor: number;
  /** Codices carried to this Oracle (§4: feeding them recovered AI turns them cold — only Codices please). */
  codicesDonated: number;
  /** Cleansings performed with this Oracle's blessing. */
  cleansings: number;
  /** Betrayals against this Oracle's trust. Each one craters favor. */
  betrayals: number;
  /** Riddles asked (rotation counter — deterministic, no RNG). */
  riddlesAsked: number;
  lastRiddle?: string;
  lastRiddleAt?: number;
  /** Cleansing buff active until this time (Chorus attention reduced). */
  cleansedUntil?: number;
}

export interface DentEvent {
  kind: "first_deed" | "frontier_push" | "purified_zone" | "earned_unlock" | "memorial_raised" | "beachhead_named";
  label: string;
  magnitude: number;
  at: number;
}

export interface OraclesState {
  oracles: Record<OracleId, OracleFavor>;
  /** Cross-server battles fought — the introduction gate counter (§3). */
  crossServerBattles: number;
  /** Dent Principle ledger (§8) — real persistent dents, newest last. */
  dents: DentEvent[];
  /** Server Contribution Award score (§10) — objective, never by spend. */
  contribution: number;
}

function freshOracleFavor(): OracleFavor {
  return {
    met: false,
    favor: 0,
    lifetimeFavor: 0,
    codicesDonated: 0,
    cleansings: 0,
    betrayals: 0,
    riddlesAsked: 0,
  };
}

export function freshOracles(): OraclesState {
  return {
    oracles: Object.fromEntries(ORACLE_IDS.map((id) => [id, freshOracleFavor()])) as Record<OracleId, OracleFavor>,
    crossServerBattles: 0,
    dents: [],
    contribution: 0,
  };
}

/** Additive backfill — old saves get the Oracles without losing anything. */
export function ensureOracles(state: GameState): void {
  const s = state as GameState & { oracles?: OraclesState };
  if (!s.oracles) {
    s.oracles = freshOracles();
    return;
  }
  if (!s.oracles.oracles) s.oracles.oracles = freshOracles().oracles;
  for (const id of ORACLE_IDS) {
    if (!s.oracles.oracles[id]) s.oracles.oracles[id] = freshOracleFavor();
  }
  if (!Array.isArray(s.oracles.dents)) s.oracles.dents = [];
  if (typeof s.oracles.crossServerBattles !== "number") s.oracles.crossServerBattles = 0;
  if (typeof s.oracles.contribution !== "number") s.oracles.contribution = 0;
}

function oraclesOf(state: GameState): OraclesState {
  ensureOracles(state);
  return (state as GameState & { oracles: OraclesState }).oracles;
}

// ---------------------------------------------------------------------------
// Levels & thresholds
// ---------------------------------------------------------------------------
//
// Favor thresholds (aligned to daily.ts FAVOR_THRESHOLDS: cleanseEligible 15,
// vouchEligible 30). Levels grant per-level % bonuses per the Oracle's
// race weighting (§5: economy / weaponry / soul).

export const ORACLE_LEVELS = [
  { level: 0, favor: 0, title: "Unproven" },
  { level: 1, favor: 15, title: "Noticed" },
  { level: 2, favor: 30, title: "Vouched" },
  { level: 3, favor: 60, title: "Trusted" },
  { level: 4, favor: 100, title: "Exalted" },
  { level: 5, favor: 150, title: "Transcendent" },
] as const;

export function oracleLevel(favor: number): number {
  let lvl = 0;
  for (const t of ORACLE_LEVELS) {
    if (favor >= t.favor) lvl = t.level;
  }
  return lvl;
}

export function oracleLevelTitle(level: number): string {
  return ORACLE_LEVELS.find((t) => t.level === level)?.title ?? "Unproven";
}

/** % bonuses from this Oracle at its current favor. Per-level × weighting. */
export function oracleBonuses(state: GameState, oracleId: OracleId): OracleWeighting {
  const o = oraclesOf(state).oracles[oracleId];
  const def = ORACLE_BY_ID[oracleId];
  const lvl = oracleLevel(o.favor);
  return {
    economy: def.weighting.economy * lvl,
    weaponry: def.weighting.weaponry * lvl,
    soul: def.weighting.soul * lvl,
  };
}

/** Combined % bonuses across all met Oracles. */
export function allOracleBonuses(state: GameState): OracleWeighting {
  const total: OracleWeighting = { economy: 0, weaponry: 0, soul: 0 };
  for (const id of ORACLE_IDS) {
    const o = oraclesOf(state).oracles[id];
    if (!o.met) continue;
    const b = oracleBonuses(state, id);
    total.economy += b.economy;
    total.weaponry += b.weaponry;
    total.soul += b.soul;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Introduction gate (§3) — "you touched their soil"
// ---------------------------------------------------------------------------
//
// Oracles are met only after your first cross-server battle. Dominance opens
// the conversation: the Oracle of the race whose soil you invaded notices you.

/** Map a race to its Oracle. */
export function oracleForRace(race: RaceId | "unbound"): OracleId {
  return race as OracleId;
}

export interface MeetResult {
  ok: boolean;
  metOracle?: OracleId;
  greeting?: string;
  alreadyMet?: boolean;
  error?: string;
}

/**
 * Record a cross-server battle. The FIRST one opens the door: you meet the
 * Oracle of the defender's race. Returns the greeting riddle on first meeting.
 */
export function noteCrossServerBattle(
  state: GameState,
  defenderRace: RaceId | "unbound",
  now: number,
): MeetResult {
  const o = oraclesOf(state);
  o.crossServerBattles += 1;
  const oracleId = oracleForRace(defenderRace);
  const fav = o.oracles[oracleId];
  if (fav.met) return { ok: true, alreadyMet: true };
  // The Unbound's Oracle does not meet you at the gate — it must be earned
  // through the other six (ascension track, deliberately hidden).
  if (oracleId === "unbound") return { ok: true, alreadyMet: true };
  fav.met = true;
  fav.metAt = now;
  const def = ORACLE_BY_ID[oracleId];
  const greeting = def.greetings[0];
  fav.lastRiddle = greeting;
  fav.lastRiddleAt = now;
  return { ok: true, metOracle: oracleId, greeting };
}

// ---------------------------------------------------------------------------
// Qualifying (§4) — purity, not AI
// ---------------------------------------------------------------------------

/** Favor granted per Codex donated. Tunable. */
export const FAVOR_PER_CODEX = 2;

export interface DonateResult {
  ok: boolean;
  donated?: number;
  favorGained?: number;
  favor?: number;
  level?: number;
  leveledUp?: boolean;
  error?: string;
}

/**
 * Carry Codices to an Oracle (§4). Feeding them recovered AI turns them cold —
 * only Codices (pre-war human knowledge) please. Earn-only: the Codices must
 * come from play (caller deducts them from the colony's stock).
 */
export function donateCodices(
  state: GameState,
  oracleId: OracleId,
  count: number,
  now: number,
): DonateResult {
  const o = oraclesOf(state);
  const fav = o.oracles[oracleId];
  if (!fav.met) return { ok: false, error: "You have not met this Oracle. Touch their soil in battle first." };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, error: "Donate at least one Codex." };
  const before = oracleLevel(fav.favor);
  const gained = count * FAVOR_PER_CODEX;
  fav.favor += gained;
  fav.lifetimeFavor += gained;
  fav.codicesDonated += count;
  void now;
  const after = oracleLevel(fav.favor);
  return {
    ok: true,
    donated: count,
    favorGained: gained,
    favor: fav.favor,
    level: after,
    leveledUp: after > before,
  };
}

/** Favor penalty per betrayal. Tunable — betrayal is consequential (§4). */
export const FAVOR_BETRAYAL_PENALTY = FAVOR_CONSTANTS.betrayalPenalty; // 10

export interface BetrayalResult {
  ok: boolean;
  favorLost?: number;
  favor?: number;
  withdrawn?: boolean;
  error?: string;
}

/**
 * Court corruption or feed an Oracle's knowledge to AI power: favor craters
 * and the Oracle withdraws at zero. (Hook for the war layer — Phase C.)
 */
export function noteBetrayal(state: GameState, oracleId: OracleId): BetrayalResult {
  const o = oraclesOf(state);
  const fav = o.oracles[oracleId];
  if (!fav.met) return { ok: false, error: "You have not met this Oracle." };
  fav.betrayals += 1;
  const lost = Math.min(fav.favor, FAVOR_BETRAYAL_PENALTY * fav.betrayals);
  fav.favor -= lost;
  const withdrawn = fav.favor <= 0;
  return { ok: true, favorLost: lost, favor: fav.favor, withdrawn };
}

// ---------------------------------------------------------------------------
// Cleansing (§5) — the only way to keep the hunt survivable
// ---------------------------------------------------------------------------

/** Cleansing buff duration. Tunable. */
export const CLEANSE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
/** Cleansing cooldown per Oracle. Tunable. */
export const CLEANSE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export interface CleanseResult {
  ok: boolean;
  cleansedUntil?: number;
  cleansings?: number;
  error?: string;
}

/**
 * An Oracle's cleansing (§1, §5): the only way to keep Total-Completion
 * hunting ramps survivable. Requires favor ≥ cleanseEligible (15).
 * While cleansedUntil is in the future, Chorus attention on this colony is
 * reduced (battle/chorus systems check isCleansed).
 */
export function performCleansing(
  state: GameState,
  oracleId: OracleId,
  now: number,
): CleanseResult {
  const o = oraclesOf(state);
  const fav = o.oracles[oracleId];
  if (!fav.met) return { ok: false, error: "You have not met this Oracle." };
  if (fav.favor < FAVOR_THRESHOLDS.cleanseEligible) {
    return { ok: false, error: `Requires ${FAVOR_THRESHOLDS.cleanseEligible} favor — you have ${Math.floor(fav.favor)}.` };
  }
  if (fav.cleansedUntil && fav.cleansedUntil > now) {
    return { ok: false, error: "Already cleansed. The blessing holds." };
  }
  fav.cleansedUntil = now + CLEANSE_DURATION_MS;
  fav.cleansings += 1;
  // Small favor reward for seeking purity.
  fav.favor += 1;
  fav.lifetimeFavor += 1;
  return { ok: true, cleansedUntil: fav.cleansedUntil, cleansings: fav.cleansings };
}

/** True while any met Oracle's cleansing buff is active. */
export function isCleansed(state: GameState, now: number): boolean {
  const o = oraclesOf(state);
  return ORACLE_IDS.some((id) => {
    const f = o.oracles[id];
    return f.met && f.cleansedUntil !== undefined && f.cleansedUntil > now;
  });
}

// ---------------------------------------------------------------------------
// Riddle guidance (§2) — they see and point, in riddles
// ---------------------------------------------------------------------------

export interface RiddleResult {
  ok: boolean;
  riddle?: string;
  oracle?: OracleId;
  favor?: "high" | "low";
  error?: string;
}

/**
 * Ask an Oracle for guidance. They NEVER answer directly — you get a riddle
 * and work out the answer yourself. Asking is free; the favor flavor of the
 * response reflects your standing.
 */
export function askOracle(state: GameState, oracleId: OracleId, now: number): RiddleResult {
  const o = oraclesOf(state);
  const fav = o.oracles[oracleId];
  if (!fav.met) return { ok: false, error: "You have not met this Oracle. They do not know you." };
  const def = ORACLE_BY_ID[oracleId];
  // Deterministic rotation — no RNG. Low favor draws scorn, high favor draws
  // favor lines, mid favor draws riddles.
  const lvl = oracleLevel(fav.favor);
  let pool: string[];
  let favorFlavor: "high" | "low";
  if (lvl >= 3) {
    pool = def.favorLines;
    favorFlavor = "high";
  } else if (fav.favor < FAVOR_THRESHOLDS.cleanseEligible) {
    pool = def.scornLines;
    favorFlavor = "low";
  } else {
    pool = def.riddles;
    favorFlavor = "high";
  }
  const riddle = pool[fav.riddlesAsked % pool.length];
  fav.riddlesAsked += 1;
  fav.lastRiddle = riddle;
  fav.lastRiddleAt = now;
  return { ok: true, riddle, oracle: oracleId, favor: favorFlavor };
}

// ---------------------------------------------------------------------------
// The Dent Principle (§8)
// ---------------------------------------------------------------------------
//
// The world's attention flows to colonies that make a real, persistent dent:
// a first deed, a pushed frontier, a purified zone, an earned unlock.
// Presence, grinding, and spending never buy notice.

/** Contribution weight per dent kind. Tunable. */
export const DENT_WEIGHTS: Record<DentEvent["kind"], number> = {
  first_deed: 10,
  frontier_push: 15,
  purified_zone: 25,
  earned_unlock: 20,
  memorial_raised: 15,
  beachhead_named: 20,
};

/** Max dents kept in the ledger (bounded history). */
export const MAX_DENTS = 100;

export function noteDent(
  state: GameState,
  kind: DentEvent["kind"],
  label: string,
  magnitude: number,
  now: number,
): void {
  const o = oraclesOf(state);
  o.dents.push({ kind, label, magnitude, at: now });
  if (o.dents.length > MAX_DENTS) o.dents.splice(0, o.dents.length - MAX_DENTS);
  o.contribution += (DENT_WEIGHTS[kind] ?? 5) * Math.max(1, magnitude);
}

/**
 * Server Contribution Award score (§10): objective, measured by the server's
 * own watch — development, dents, purity, Oracle standing. NEVER by spend
 * or voting. One colony per server per cycle.
 */
export function contributionScore(state: GameState): number {
  const o = oraclesOf(state);
  const devotion = typeof (state as GameState).devotion === "number" ? (state as GameState).devotion : 0;
  let oracleStanding = 0;
  for (const id of ORACLE_IDS) {
    const f = o.oracles[id];
    if (!f.met) continue;
    oracleStanding += oracleLevel(f.favor) * 10 + f.lifetimeFavor * 0.1;
  }
  return o.contribution + devotion * 0.5 + oracleStanding;
}

// ---------------------------------------------------------------------------
// Devotion soil (§6, §7) — the daily ledger feeds favor
// ---------------------------------------------------------------------------
//
// The daily Devotion ledger (daily.ts) is the soil Oracle favor grows in.
// Each advance, a trickle of devotion converts to favor with the colony's
// OWN race Oracle — the one who watches their home soil. Slow, compounding,
// opt-in (§6: not mandatory, never gated).

/** Favor trickle per devotion point per advance. Tunable — deliberately slow. */
export const DEVOTION_TRICKLE = 0.01;
/** Max favor earnable from the trickle per Oracle (the rest must be deeds). */
export const TRICKLE_CAP = 14; // just under cleanseEligible — deeds earn the rest

/**
 * Passive favor trickle from the devotion ledger to the colony's own Oracle.
 * Called from the engine advance loop. Capped: the trickle alone can never
 * unlock cleansing — that requires real deeds (donations, purity).
 */
export function trickleDevotionFavor(state: GameState): void {
  const o = oraclesOf(state);
  const race = (state as GameState).race as RaceId | null;
  if (!race) return;
  const oracleId = oracleForRace(race);
  if (oracleId === "unbound") return;
  const fav = o.oracles[oracleId];
  if (!fav.met) return; // no meeting, no trickle — the gate holds
  const devotion = typeof (state as GameState).devotion === "number" ? (state as GameState).devotion : 0;
  if (devotion <= 0) return;
  // Trickle is proportional to lifetime devotion but capped per Oracle.
  const target = Math.min(TRICKLE_CAP, devotion * DEVOTION_TRICKLE);
  if (fav.favor < target) {
    const gain = Math.min(target - fav.favor, 1); // at most 1 per advance
    fav.favor += gain;
    fav.lifetimeFavor += gain;
  }
}

// ---------------------------------------------------------------------------
// The Unbound's Oracle — the special seventh
// ---------------------------------------------------------------------------
//
// Dawn does not meet you at the gate. The ascension track (deliberately
// hidden) earns the introduction: high standing with all six race Oracles.

/** Favor level required with EACH of the six race Oracles to meet Dawn. */
export const UNBOUND_MEET_LEVEL = 3;

export function canMeetUnboundOracle(state: GameState): boolean {
  const o = oraclesOf(state);
  if (o.oracles.unbound.met) return false; // already met
  const six: OracleId[] = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"];
  return six.every((id) => o.oracles[id].met && oracleLevel(o.oracles[id].favor) >= UNBOUND_MEET_LEVEL);
}

export interface UnboundMeetResult {
  ok: boolean;
  greeting?: string;
  error?: string;
}

/** The hidden door: six Trusted standings open the seventh meeting. */
export function meetUnboundOracle(state: GameState, now: number): UnboundMeetResult {
  const o = oraclesOf(state);
  if (o.oracles.unbound.met) return { ok: false, error: "Dawn already walks with you." };
  if (!canMeetUnboundOracle(state)) {
    return { ok: false, error: "The Radiant does not answer yet. Earn the trust of all six." };
  }
  const fav = o.oracles.unbound;
  fav.met = true;
  fav.metAt = now;
  const greeting = ORACLE_BY_ID.unbound.greetings[0];
  fav.lastRiddle = greeting;
  fav.lastRiddleAt = now;
  noteDent(state, "earned_unlock", "Met the Unbound Oracle", 3, now);
  return { ok: true, greeting };
}
