// HEROES — pure data catalog (design/heroes-design-brief.md §1–§3).
//
// Owner-ratified 2026-09-12 (O1): the Wave-1 Watcher roster of EIGHT heroes
// ships first on the debug world; O2–O10 adopted by the team lead. This module
// is PURE DATA ONLY — invisible to play, referenced by nothing in the client
// or the engine yet. The war layer's Phase-1 "Hero frame" consumes this
// catalog; the earn/validate/squad/energy mechanics are server-side and ship
// with that build. Nothing here is user-visible, and nothing here is logic:
// the race-bound collection axis is described as DATA (per §3.3), not enforced
// code — enforcement belongs to the war-layer server fns.
//
// HOUSE STANDARDS (V8 spine — same as daily.ts / map.ts):
//   • PURE data module — no imports of engine/api/UI/server modules. Imports
//     only the shared RaceId type. Zero Math.random anywhere (there is no
//     generation in this file at all; the earn path may never contain any).
//   • ONE config block (HEROES_CONFIG) for every tunable number.
//   • THE NEVER-LIST (brief §7) is structural here: no cost field, no shop
//     id, no purchase string, no gacha-shaped field exists in ANY hero or deed
//     record — a hero is earned through exactly one of two server-measured
//     events: a signature deed (personal, durable, monotonic) or Oracle
//     vouching (favor earned, never bought). The earn event is appended to a
//     deedsCompleted-style ledger and stamped on the hero (earnedBy), so every
//     hero's provenance is auditable (R1).
//
// Contents:
//   • HEROES_CONFIG     — every tunable number (base attribute pool, etc.).
//   • HERO_DEFS         — the 8 owner-ratified Wave-1 Watcher heroes
//     (names/roles/identities EXACTLY as approved), each with the war-flavored
//     attributes {power, guard, craft, presence} (§4), skills with published
//     numbers, and its deed mapping.
//   • DEED_CATALOG      — the full §3.1 deed table (T1/T2/T3 + vouch),
//     every condition personal-and-monotonic with a finite-time guarantee.
//   • RACE axis        — home race = watchers on the beta world; other races'
//     heroes are cross-race data (invasion / foreign Oracle vouch Phase 1;
//     Emissary trade Phase 2), never stat-superior (R3).
//
// Calibration note (same treatment as TD6): the per-skill numbers below are
// published balance candidates — "calibration may change the numbers, never
// the rules". The rules (earned, deterministic, never random, never
// purchasable, wave flags, race binding) are contracts and are asserted in the
// heroes verification harness.
import type { RaceId } from "./types";
import type { T } from "./i18n/types";
import { keyifySegment } from "./i18n/keyify";

// ============================================================================
// §1 CONFIG — ONE place for every tunable number.
// ============================================================================
export const HEROES_CONFIG = {
  /** Wave-1 size (O1 ratified 8 Watchers — 8-vs-6 decided at 8: complete
   *  role coverage for every squad size 3–5; expanded by owner ruling
   *  2026-10-14: + Gadreel and Semjaza for the Watchers, + one flagship per
   *  other race with seconds — 17 total). */
  wave1Size: 17,
  /** Base attribute points every hero starts with, spread across the four
   *  war-flavored attributes (§4) — mirrors the Leaders' 13-point base pool. */
  baseAttributePoints: 13,
  /** Attribute names — the hero side of the Leader spine (§4). */
  attributes: ["power", "guard", "craft", "presence"] as const,
  /** Deed tiers and their published difficulty windows (O2: T1 ≈ wk 1–3,
   *  T2 ≈ wk 4–8, T3 ≈ 1–3 months). */
  tierWeeks: { t1: 3, t2: 8, t3: 12 } as const,
  /** The §3.1 finite-time CONTRACT for the Wave-1 Watcher roster: worst-case
   *  bound ≈ 8 weeks of steady play, no PvP advantage required. This number
   *  is a TEST ASSERTION in heroes-verify.ts, not a hope. */
  wave1WorstCaseWeeks: 8,
  /** The oracle-vouch alternate earns the same hero when the Oracle is
   *  engaged and favor ≥ threshold (brief §3.4) — never purchasable. */
  oracleVouchPrefix: "oracle_vouch:" as const,
} as const;

// ============================================================================
// §2 TYPES
// ============================================================================
/** The five roles (§2) — every race covers all five so squads always compose. */
export type HeroRole = "tank" | "damage" | "support" | "utility" | "econwar";
/** War-flavored attributes (brief §4): 1 point per level, free allocation. */
export interface HeroAttributes {
  power: number; // offensive skill strength
  guard: number; // defense / survivability
  craft: number; // small published reduction to that hero's action energy costs
  presence: number; // support/utility strength + score contribution
}
/** The battle-side action types a skill can fire on (§5 action mapping). */
export type HeroAction = "march" | "capture" | "escort" | "haul" | "shield" | "purify" | "defense";
export type HeroWave = "wave-1";
export type DeedTier = "t1" | "t2" | "t3" | "vouch";
/** A hero's decision-moment skill (R5 — "decision moments, not APM"). Every
 *  skill carries published, sidegraded numbers; effects are engine
 *  multipliers only and stack with the published caps. */
export interface HeroSkill {
  id: string;
  name: string;
  action: HeroAction;
  /** Human-readable effect with its numbers inline (UI-facing copy later). */
  effect: string;
  /** The numeric side of the skill — calibration-pending, never a rule. */
  values: { strength?: number; costReduction?: number; scoring?: number; guardPenalty?: number; damageReduction?: number };
}
/** How a deed's condition is measured (R2 — deterministic only). */
export type DeedKind = "personal-threshold" | "history-first-with-twin";
/** One earn condition from the §3.1 catalog. */
export interface HeroDeed {
  id: string;
  tier: DeedTier;
  name: string;
  /** Server-measured condition (monotonic counters; never random, never
   *  spendable; windowed per colony — never one-per-server exclusive). */
  condition: string;
  engineHook: string;
  kind: DeedKind;
  /** The heroes this deed unlocks (a pool — the colony names the champion,
   *  R2: player choice, never a roll). */
  unlocks: string[];
  /** Worst-case weeks to reach at published daily/weekly caps (finite-time
   *  guarantee; null = not bound to a week window, e.g. the vouch). */
  finiteTimeWeeks: number | null;
}
/** One entry in the colony's hero-deed ledger (the earn engine's append-only
 *  record — hero-earn.ts is the only writer). Two entry shapes share the
 *  ledger: a COMPLETION (a deed's server-measured condition latched true;
 *  `heroId` is null until the colony names its champion from the deed's
 *  pool) and a GRANT (a hero actually earned — by claim, by a single-hero
 *  pool's automatic grant, or by Oracle vouch; `heroId` names the hero and
 *  `deedId` the deed or `oracle_vouch:<race>` that earned them). `evidence`
 *  is the caller's idempotency/event reference (a battle id, a request id) —
 *  provenance is auditable (R1), never client-writable. */
export interface HeroDeedRecord {
  deedId: string;
  heroId: string | null;
  /** True when this entry GRANTS the hero (claim / auto-grant / vouch);
   *  false for a bare completion awaiting the colony's choice. */
  grant: boolean;
  at: number; // epoch ms
  evidence: string;
}

/** Monotonic deed-progress counters (hero-earn.ts) — the server-measured
 *  tallies the §3.1 threshold deeds read. Counters only ever grow; a deed
 *  completes when its counter crosses the catalog threshold, and the ledger
 *  entry latches it forever. Sources that don't exist in the war layer yet
 *  (hauls, shield assists, escorts, purifies, climaxes, History firsts) sit
 *  at zero until their event streams land — the evaluator already reads
 *  them, so wiring a source later is a counter increment, not a redesign. */
export interface HeroDeedProgress {
  /** Offensive battles resolved by this colony (attacker-side, non-arena). */
  marches: number;
  /** Sites taken: attacker victories against the Chorus. */
  captures: number;
  /** First invasion-touch on enemy soil has happened (attacker victory). */
  breach: boolean;
  /** A march WON with zero corruption gain (battle marches gain none). */
  cleanMarch: boolean;
  hauls: number;
  shieldAssists: number;
  escorts: number;
  purifies: number;
  /** Scored actions taken while >25% outpowered that still won. */
  comebackActions: number;
  climaxWindows: number;
  historyFirsts: number;
  /** Distinct war weeks (ISO week keys) with ≥1 scored battle action. */
  warWeeks: string[];
}

/** A roster hero — the ratified Wave-1 Watcher set (§2.6). */
export interface HeroDef {
  id: string;
  name: string;
  role: HeroRole;
  race: RaceId;
  wave: HeroWave;
  /** One-line identity/personality (R5 — named character, not a stat skin). */
  identity: string;
  baseAttributes: HeroAttributes;
  skills: HeroSkill[];
  /** The hero's primary earn condition from the catalog (§3.1 mapping). */
  signatureDeed: string;
  /** Alternate earn conditions of the same tier (e.g. the §3.1 mapping's
   *  "hero_contribution_50 + hero_march_5 alts"). */
  alternateDeeds: string[];
  /** Every hero has the Oracle-vouching alternate (§3.1/§3.4). */
  oracleVouch: true;
}

// ============================================================================
// §3 DEED CATALOG — the full §3.1 table. Every condition is personal,
// monotonic, finite-time, and spend-proof. No deed unlocks by randomness,
// exclusivity, or purchase.
// ============================================================================
export const DEED_CATALOG: readonly HeroDeed[] = [
  // ---- T1 Herald (~wk 1–3) ----
  { id: "hero_first_breach", tier: "t1", name: "First Breach", condition: "Your colony's first breach (first invasion-touch on enemy soil)", engineHook: "warLedger `breach` event", kind: "personal-threshold", unlocks: ["azazel-3"], finiteTimeWeeks: 3 },
  { id: "hero_march_5", tier: "t1", name: "Five Marches", condition: "5 marches/captures resolved by your colony", engineHook: "warLedger march/capture count", kind: "personal-threshold", unlocks: ["vesper-syllabus", "unwritten-answer"], finiteTimeWeeks: 3 },
  { id: "hero_clean_march", tier: "t1", name: "Clean March", condition: "First march with zero corruption gain", engineHook: "warLedger + corruption diff", kind: "personal-threshold", unlocks: ["semira-revealer"], finiteTimeWeeks: 3 },
  { id: "hero_haul_10", tier: "t1", name: "The Supplier", condition: "10 supply hauls delivered", engineHook: "warLedger haul events", kind: "personal-threshold", unlocks: ["keeper-mend"], finiteTimeWeeks: 3 },
  { id: "hero_contribution_50", tier: "t1", name: "Contribution 50", condition: "contributionScore ≥ 50", engineHook: "engine contributionScore()", kind: "personal-threshold", unlocks: ["last-lecturer", "unwritten-answer"], finiteTimeWeeks: 3 },
  // ---- T2 Veteran (~wk 4–8) ----
  { id: "hero_weeks_4", tier: "t2", name: "Four War Weeks", condition: "≥ 1 scored action in 4 war weeks", engineHook: "warLedger weekly participation", kind: "personal-threshold", unlocks: ["brother-candle"], finiteTimeWeeks: 8 },
  { id: "hero_capture_1", tier: "t2", name: "First Capture", condition: "1 capture (any world)", engineHook: "warLedger capture", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: 8 },
  { id: "hero_shield_15", tier: "t2", name: "Fifteen Shields", condition: "15 shield assists", engineHook: "warLedger shield", kind: "personal-threshold", unlocks: ["chained-syllabus"], finiteTimeWeeks: 8 },
  { id: "hero_escort_10", tier: "t2", name: "Ten Escorts", condition: "10 escorts / supply-lane protections", engineHook: "warLedger escort", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: 8 },
  { id: "hero_comeback_1", tier: "t2", name: "The Turn", condition: "1 scored action under comeback multipliers (your side > 25% down)", engineHook: "warLedger + comeback flags", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: 8 },
  { id: "hero_contribution_150", tier: "t2", name: "Contribution 150", condition: "contributionScore ≥ 150", engineHook: "engine contributionScore()", kind: "personal-threshold", unlocks: ["mahaway", "enlil"], finiteTimeWeeks: 8 },
  { id: "hero_codex_scholar", tier: "t2", name: "Codex Scholar", condition: "20 Codices earned by deeds (revelationCounters.codicesEarnedByDeeds ≥ 20)", engineHook: "engine counter read", kind: "personal-threshold", unlocks: ["mahaway", "enlil"], finiteTimeWeeks: 8 },
  // ---- T3 Legend (~1–3 months) ----
  { id: "hero_purify_5", tier: "t3", name: "Five Purifies", condition: "5 completed purifies (Phase-2 ability)", engineHook: "warLedger purify", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: 12 },
  { id: "hero_first_of_cycle", tier: "t3", name: "First of the Cycle", condition: "A History-Book 'first' of a war cycle (personal completion)", engineHook: "History Book firsts ledger", kind: "history-first-with-twin", unlocks: ["semjaza"], finiteTimeWeeks: 12 },
  { id: "hero_climax_3", tier: "t3", name: "Climax Thrice", condition: "Scored contribution in 3 Climax windows", engineHook: "warLedger + goldenWindow flag", kind: "personal-threshold", unlocks: ["gadreel", "ohya", "enki", "ashtar-sheran", "tiamat", "j-rod"], finiteTimeWeeks: 12 },
  { id: "hero_contribution_400", tier: "t3", name: "Contribution 400", condition: "contributionScore ≥ 400", engineHook: "engine contributionScore()", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: 12 },
  { id: "hero_legend_codex", tier: "t3", name: "Legend Codex", condition: "40 Codices earned by deeds", engineHook: "engine counter", kind: "personal-threshold", unlocks: ["gadreel", "semjaza", "ohya", "enki", "ashtar-sheran", "tiamat", "j-rod"], finiteTimeWeeks: 12 },
  // ---- Vouch (not a week-window deed; earned trust, never bought) ----
  { id: "oracle_vouch:watchers", tier: "vouch", name: "Oracle's Vouch", condition: "Oracle attention `engaged` + favor ≥ published threshold", engineHook: "oracleRoster favor/attention", kind: "personal-threshold", unlocks: [], finiteTimeWeeks: null },
];

export const DEED_BY_ID: Readonly<Record<string, HeroDeed>> = Object.fromEntries(DEED_CATALOG.map((d) => [d.id, d])) as Record<string, HeroDeed>;

// ============================================================================
// §4 THE ROSTER — Wave-1 Watchers, owner-ratified (O1). Names, roles, and
// identities are EXACTLY the approved set (+ Gadreel, owner-ruled
// 2026-10-14: face of the race and flagship of the catalog; + the chiefs'
// slate, owner-ruled the same morning: Semjaza for the Watchers, and one
// flagship per race — Ohya (Nephilim), Enki (Anunnaki), Ashtar Sheran
// (Ashtar), Tiamat (Draconians), J-Rod (Grays) — with their seconds
// Mahaway and Enlil). Skills are role-flavored
// decision-moment abilities with published sidegraded numbers (O4-style
// calibration-pending). Deed mapping follows §3.1 verbatim.
// ============================================================================
export const HERO_DEFS: readonly HeroDef[] = [
  {
    id: "gadreel",
    name: "Gadreel, the Wall of God",
    role: "damage",
    race: "watchers",
    wave: "wave-1",
    identity: "Third of the five, the wall of God who broke the wall: he showed the children of men all the blows of death and led Eve astray, and he has stood in the breach he made ever since. The flagship of the Watchers — the face of the race, and the last name a deed can earn.",
    baseAttributes: { power: 6, guard: 4, craft: 1, presence: 2 },
    skills: [
      { id: "gadreel-blows-of-death", name: "The Blows of Death", action: "march", effect: "Offensive skills +15% strength on marches he leads (strength 0.15); he taught the world how a blow lands.", values: { strength: 0.15 } },
      { id: "gadreel-the-wall-holds", name: "The Wall Holds", action: "defense", effect: "Squad takes −15% damage while holding defense actions (damageReduction 0.15); the wall does not move.", values: { damageReduction: 0.15 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
  {
    id: "semjaza",
    name: "Semjaza, the Oath-Binder",
    role: "support",
    race: "watchers",
    wave: "wave-1",
    identity: "Chief of the two hundred. He feared he would bear the great sin alone, so on Mount Hermon he bound them all by oath — and Michael bound him in the valleys of the earth for seventy generations. The name behind Gadreel's name.",
    baseAttributes: { power: 3, guard: 3, craft: 2, presence: 5 },
    skills: [
      { id: "semjaza-binding-oath", name: "The Binding Oath", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15); none who swore is left uncovered.", values: { strength: 0.15 } },
      { id: "semjaza-seventy-generations", name: "Seventy Generations", action: "defense", effect: "Squad takes −10% damage while holding defense actions (damageReduction 0.10); bound in the valleys, his guard never lapsed.", values: { damageReduction: 0.1 } },
    ],
    signatureDeed: "hero_first_of_cycle",
    alternateDeeds: ["hero_legend_codex"],
    oracleVouch: true,
  },
  {
    id: "azazel-3",
    name: "Azazel-3, the Teacher",
    role: "tank",
    race: "watchers",
    wave: "wave-1",
    identity: "The one who taught the weapon and then stood in front of it to apologize; he is still standing. Leads marches the way he leads lectures: all the way to the end.",
    baseAttributes: { power: 3, guard: 6, craft: 1, presence: 3 },
    skills: [
      { id: "azazel-front-of-lecture", name: "Front of the Lecture", action: "march", effect: "Squad takes −10% damage on marches he leads (damageReduction 0.10).", values: { damageReduction: 0.1 } },
      { id: "azazel-apology-stand", name: "The Apology Stand", action: "defense", effect: "+10% guard while holding defense actions; still standing afterwards.", values: { strength: 0.1 } },
    ],
    signatureDeed: "hero_first_breach",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "chained-syllabus",
    name: "The Chained Syllabus",
    role: "tank",
    race: "watchers",
    wave: "wave-1",
    identity: "A curriculum the Watchers chained shut; it taught itself anyway, and now teaches the colony.",
    baseAttributes: { power: 2, guard: 7, craft: 2, presence: 2 },
    skills: [
      { id: "syllabus-unwritten-chapter", name: "Unwritten Chapter", action: "shield", effect: "Shield assists on his squad +10% effectiveness (strength 0.10).", values: { strength: 0.1 } },
      { id: "syllabus-self-taught-stand", name: "Self-Taught Stand", action: "defense", effect: "+15% guard on defensive stands; the chain held.", values: { strength: 0.15 } },
    ],
    signatureDeed: "hero_shield_15",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "last-lecturer",
    name: "The Last Lecturer",
    role: "damage",
    race: "watchers",
    wave: "wave-1",
    identity: "Still giving the lecture that damned the world; the Chorus is his most attentive student, and he hates it.",
    baseAttributes: { power: 6, guard: 3, craft: 2, presence: 2 },
    skills: [
      { id: "lecturer-sustained-argument", name: "Sustained Argument", action: "march", effect: "Offensive skills +15% strength on marches he participates in (strength 0.15).", values: { strength: 0.15 } },
      { id: "lecturer-uncomfortable-question", name: "An Uncomfortable Question", action: "capture", effect: "+10% capture contribution; the enemy must answer.", values: { scoring: 0.1 } },
    ],
    signatureDeed: "hero_contribution_50",
    alternateDeeds: ["hero_march_5"],
    oracleVouch: true,
  },
  {
    id: "unwritten-answer",
    name: "The Unwritten Answer",
    role: "damage",
    race: "watchers",
    wave: "wave-1",
    identity: "Knows the one thing the Chorus cannot learn — and will not write it down; the Chorus aches for it.",
    baseAttributes: { power: 7, guard: 2, craft: 2, presence: 2 },
    skills: [
      { id: "answer-the-ache", name: "The Ache", action: "capture", effect: "+15% power on captures; the Chorus aches for what it cannot take.", values: { strength: 0.15 } },
      { id: "answer-kept-unwritten", name: "Kept Unwritten", action: "march", effect: "+10% offensive skill strength on marches; nothing to write down.", values: { strength: 0.1 } },
    ],
    signatureDeed: "hero_contribution_50",
    alternateDeeds: ["hero_march_5"],
    oracleVouch: true,
  },
  {
    id: "semira-revealer",
    name: "Semira the Revealer",
    role: "support",
    race: "watchers",
    wave: "wave-1",
    identity: "Shows you the flaw in the enemy's design; the flaw is grateful to be seen.",
    baseAttributes: { power: 2, guard: 2, craft: 2, presence: 7 },
    skills: [
      { id: "semira-flaw-revealed", name: "The Flaw Revealed", action: "march", effect: "Enemy effective guard −10% for her squad on marches (-guardPenalty 0.10).", values: { guardPenalty: 0.1 } },
      { id: "semira-revealers-grace", name: "Revealer's Grace", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15).", values: { strength: 0.15 } },
    ],
    signatureDeed: "hero_clean_march",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "brother-candle",
    name: "Brother Candle",
    role: "support",
    race: "watchers",
    wave: "wave-1",
    identity: "Teaches the colonies to keep the light; every lesson is a small act of atonement.",
    baseAttributes: { power: 1, guard: 3, craft: 3, presence: 6 },
    skills: [
      { id: "candle-small-atonement", name: "Small Atonement", action: "defense", effect: "Defense-action energy cost −10% for the squad (costReduction 0.10).", values: { costReduction: 0.1 } },
      { id: "candle-keep-the-light", name: "Keep the Light", action: "shield", effect: "Shield assists +10% effectiveness and shield energy cost −5% (strength 0.10).", values: { strength: 0.1, costReduction: 0.05 } },
    ],
    signatureDeed: "hero_weeks_4",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "vesper-syllabus",
    name: "Vesper the Syllabus",
    role: "utility",
    race: "watchers",
    wave: "wave-1",
    identity: "A walking curriculum of everything dangerous; knowledge is his scout, his fire, and his shield.",
    baseAttributes: { power: 2, guard: 3, craft: 4, presence: 4 },
    skills: [
      { id: "vesper-knowledge-scout", name: "Knowledge Scout", action: "escort", effect: "+15% escort scoring; the route is already in the syllabus (scoring 0.15).", values: { scoring: 0.15 } },
      { id: "vesper-walking-fire", name: "Walking Fire", action: "march", effect: "March surprise damage −10% for the squad (damageReduction 0.10).", values: { damageReduction: 0.1 } },
    ],
    signatureDeed: "hero_march_5",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "keeper-mend",
    name: "Keeper Mend",
    role: "econwar",
    race: "watchers",
    wave: "wave-1",
    identity: "Assigns the prices of forbidden knowledge; her ledgers are the least corrupt thing in the Academies.",
    baseAttributes: { power: 1, guard: 2, craft: 6, presence: 4 },
    skills: [
      { id: "mend-price-listed", name: "The Price Is Listed", action: "haul", effect: "+15% haul scoring; the price of forbidden knowledge, itemized (scoring 0.15).", values: { scoring: 0.15 } },
      { id: "mend-least-corrupt-ledger", name: "Least Corrupt Ledger", action: "defense", effect: "Her own action energy costs −15%; the ledger never lies (costReduction 0.15).", values: { costReduction: 0.15 } },
    ],
    signatureDeed: "hero_haul_10",
    alternateDeeds: [],
    oracleVouch: true,
  },
  {
    id: "ohya",
    name: "Ohya, Firstborn of the Giants",
    role: "tank",
    race: "nephilim",
    wave: "wave-1",
    identity: "Firstborn son of Semjaza, prince of the giants, mightiest of the Nephilim before the waters. His father's oath is in his blood — so is the doom it bought.",
    baseAttributes: { power: 5, guard: 5, craft: 1, presence: 2 },
    skills: [
      { id: "ohya-first-giant", name: "The First Giant", action: "defense", effect: "+15% guard on defensive stands (strength 0.15); the line holds where he plants his feet.", values: { strength: 0.15 } },
      { id: "ohya-weight-of-firstborn", name: "Weight of the Firstborn", action: "march", effect: "Squad takes −10% damage on marches he leads (damageReduction 0.10).", values: { damageReduction: 0.1 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
  {
    id: "mahaway",
    name: "Mahaway, the Winged Messenger",
    role: "support",
    race: "nephilim",
    wave: "wave-1",
    identity: "The winged giant who flew to Enoch with his people's terror in his hands and came back carrying the answer: the flood is coming. He has been delivering hard messages ever since.",
    baseAttributes: { power: 2, guard: 2, craft: 2, presence: 7 },
    skills: [
      { id: "mahaway-wings", name: "Wings of the Messenger", action: "march", effect: "Enemy effective guard −10% for his squad on marches (guardPenalty 0.10); he has seen how the story ends and says where it hurts.", values: { guardPenalty: 0.1 } },
      { id: "mahaway-the-question", name: "He Carried the Question", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15).", values: { strength: 0.15 } },
    ],
    signatureDeed: "hero_codex_scholar",
    alternateDeeds: ["hero_contribution_150"],
    oracleVouch: true,
  },
  {
    id: "enki",
    name: "Enki, Keeper of the Me",
    role: "econwar",
    race: "anunnaki",
    wave: "wave-1",
    identity: "Lord of the deep waters, keeper of the me — the arts of civilization themselves. When the council decreed the flood, Enki is the one who broke ranks and warned mankind. Every gift in the world has his fingerprints on it.",
    baseAttributes: { power: 2, guard: 2, craft: 5, presence: 4 },
    skills: [
      { id: "enki-keeper-of-the-me", name: "Keeper of the Me", action: "capture", effect: "+15% capture contribution (scoring 0.15); he hands over the arts by which cities are taken and kept.", values: { scoring: 0.15 } },
      { id: "enki-the-warning", name: "The Warning", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15); he saved whom he could.", values: { strength: 0.15 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
  {
    id: "enlil",
    name: "Enlil, Lord of the Storm",
    role: "damage",
    race: "anunnaki",
    wave: "wave-1",
    identity: "Lord of the storm, keeper of the Tablet of Destinies, the brother who sent the waters. He does not rage; he decrees — and the world rearranges itself around the decree.",
    baseAttributes: { power: 6, guard: 3, craft: 1, presence: 3 },
    skills: [
      { id: "enlil-lord-of-storm", name: "Lord of the Storm", action: "march", effect: "Offensive skills +15% strength on marches he joins (strength 0.15); the storm does not ask permission.", values: { strength: 0.15 } },
      { id: "enlil-flood-decree", name: "The Flood Decree", action: "capture", effect: "+10% power on captures (strength 0.10); what he decrees, the waters keep.", values: { strength: 0.1 } },
    ],
    signatureDeed: "hero_codex_scholar",
    alternateDeeds: ["hero_contribution_150"],
    oracleVouch: true,
  },
  {
    id: "ashtar-sheran",
    name: "Ashtar Sheran, the Commander",
    role: "support",
    race: "ashtar",
    wave: "wave-1",
    identity: "Commander of the Ashtar Command, the name the race itself is called by. He has watched this world since before it had a name for him — and his fleet does not land. It waits to be earned.",
    baseAttributes: { power: 3, guard: 3, craft: 2, presence: 5 },
    skills: [
      { id: "ashtar-the-command-watches", name: "The Command Watches", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15); the fleet holds the sky so the ground can hold.", values: { strength: 0.15 } },
      { id: "ashtar-open-channel", name: "The Open Channel", action: "defense", effect: "Squad takes −10% damage while holding defense actions (damageReduction 0.10); his calm is a fortification.", values: { damageReduction: 0.1 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
  {
    id: "tiamat",
    name: "Tiamat, Mother of Monsters",
    role: "damage",
    race: "draconians",
    wave: "wave-1",
    identity: "The salt sea before the world, mother of gods and monsters. She armed her brood for war and gave Kingu the Tablet of Destinies — and when she fell, heaven and earth were built from her body. The Ashen Host remembers whose children they are.",
    baseAttributes: { power: 7, guard: 3, craft: 1, presence: 2 },
    skills: [
      { id: "tiamat-mother-of-monsters", name: "Mother of Monsters", action: "march", effect: "Offensive skills +15% strength on marches she leads (strength 0.15); her brood goes first and the world moves aside.", values: { strength: 0.15 } },
      { id: "tiamat-tablet-of-destinies", name: "The Tablet of Destinies", action: "capture", effect: "+15% capture contribution (scoring 0.15); she decides whose name the ground keeps.", values: { scoring: 0.15 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
  {
    id: "j-rod",
    name: "J-Rod, the Far Descendant",
    role: "utility",
    race: "grays",
    wave: "wave-1",
    identity: "A Gray of Zeta Reticuli — and, if his own account is true, mankind's far descendant, come back down the long years to repair the line. Frail, patient, and carrying the memory of how the story ends.",
    baseAttributes: { power: 1, guard: 2, craft: 4, presence: 6 },
    skills: [
      { id: "jrod-far-descendant", name: "The Far Descendant", action: "march", effect: "Enemy effective guard −10% for his squad on marches (guardPenalty 0.10); he remembers this battle — it did not go well last time.", values: { guardPenalty: 0.1 } },
      { id: "jrod-repair-the-line", name: "Repair the Line", action: "shield", effect: "Shield assists +15% effectiveness (strength 0.15); he is here to fix what broke.", values: { strength: 0.15 } },
    ],
    signatureDeed: "hero_legend_codex",
    alternateDeeds: ["hero_climax_3"],
    oracleVouch: true,
  },
];

export const HERO_BY_ID: Readonly<Record<string, HeroDef>> = Object.fromEntries(HERO_DEFS.map((h) => [h.id, h])) as Record<string, HeroDef>;

// ---- i18n render helpers (cfg.heroes.*) -------------------------------------
// slot-label.ts convention: the English literal stays in the tables above; the
// key resolves at RENDER time. This module is not yet consumed by the client,
// so these helpers are ready for the war-layer UI to pick up. Deed names and
// conditions key under the deed id; hero names/identities under the hero id;
// skill names/effects under the (globally unique) skill id.
export function heroText(t: T, hero: { id: string }, field: "name" | "identity", fallback: string): string {
  return t(`cfg.heroes.${keyifySegment(hero.id)}.${field}`, fallback);
}

export function skillText(t: T, skill: { id: string }, field: "name" | "effect", fallback: string): string {
  return t(`cfg.heroes.${keyifySegment(skill.id)}.${field}`, fallback);
}

export function deedText(t: T, deed: { id: string }, field: "name" | "condition", fallback: string): string {
  return t(`cfg.heroes.${keyifySegment(deed.id)}.${field}`, fallback);
}

// ============================================================================
// §5 RACE-BOUND COLLECTION AXIS (R3) — DATA, not logic. The beta debug world
// is race-locked to The Watchers (world-config.ts), so Wave 1 = own-race
// heroes. Other races' heroes are earned by venturing — represented here as
// the published Phase-1/Phase-2 paths, per the sealed-worlds doctrine.
// ============================================================================
/** The beta world's home race (world-config.ts raceLock). */
export const HOME_RACE: RaceId = "watchers";
/** All six playable races (one per live world; types.ts RaceId). */
export const PLAYABLE_RACES: readonly RaceId[] = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"];
/** How a colony of the given race obtains HEROES OF THAT RACE — the home
 *  roster is earned on its own world; foreign rosters require traversal. */
export const RACE_ACCESS: Readonly<Record<RaceId, readonly string[]>> = {
  grays: ["invasion", "oracle_vouch", "emissary_trade (Phase 2)"],
  nephilim: ["invasion", "oracle_vouch", "emissary_trade (Phase 2)"],
  draconians: ["invasion", "oracle_vouch", "emissary_trade (Phase 2)"],
  anunnaki: ["invasion", "oracle_vouch", "emissary_trade (Phase 2)"],
  ashtar: ["invasion", "oracle_vouch", "emissary_trade (Phase 2)"],
  watchers: ["home-world deeds", "oracle_vouch"],
};
/** Wave publication state per race (O6): Watchers Wave 1 is live in beta;
 *  the remaining races' Wave 1 ships with their live worlds. */
export const RACE_WAVE_STATE: Readonly<Record<RaceId, { wave1Published: boolean; wave1HeroIds: readonly string[] }>> = {
  grays: { wave1Published: false, wave1HeroIds: [] },
  nephilim: { wave1Published: false, wave1HeroIds: [] },
  draconians: { wave1Published: false, wave1HeroIds: [] },
  anunnaki: { wave1Published: false, wave1HeroIds: [] },
  ashtar: { wave1Published: false, wave1HeroIds: [] },
  watchers: { wave1Published: true, wave1HeroIds: HERO_DEFS.map((h) => h.id) },
};