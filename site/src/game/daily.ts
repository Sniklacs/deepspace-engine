// DAILY TO-DO + ORACLE DEVOTION (V7) — the "daily devotion, long-term trust" pillar.
//
// Spec: design/daily-devotion-spec.md. Owner-ratified 2026-09-12:
//   TD1 — 4 items/day; ≤1 launch, ≤2 expedition-family, ≥1 non-expedition,
//         purity ~every other day, unlock-gated pool (items a colony genuinely
//         can't do today don't appear).
//   TD2 — +30 Scrip / +1 Devotion per item; +80 / +3 bonus; daily max 200/7
//         (the schedule IS the cap: 4×30+80 = 200, 4×1+3 = 7); flat.
//   TD5 — Devotion total + streak PUBLIC; favor internals / Oracle thresholds
//         SERVER-ONLY (api.ts strips everything below da DailyState's public
//         view — leak-tested).
//
// This module is the PURE data + logic core (no node imports — the client
// bundle imports labels/lookup directly). It deliberately imports NOTHING from
// engine.ts (engine imports daily — a cycle would form); every capability
// predicate is a pure read of GameState, and the one shared constant it needs
// (engine DEEP = 35 / REVELATION_DEEP = 60 for the zone-gated launch items) is
// mirrored here with a comment.
//
// Contents:
//   • DAILY_CONFIG  — every tunable number in one place (TD2 rewards, streak
//     cosmetic day count).
//   • DAILY_ITEM_POOL — the 11-item v1 pool (§1.3), labels + categories.
//   • generateDailyList — DETERMINISTIC server-side generator (seeded by the
//     UTC day key — no Math.random anywhere in the draw), constraint-honoring.
//   • noteDailyEvent / noteDailyLaunch — the single event funnel (§4.2) that
//     engine action fns call; dedupes via `completed`; zone-gates launches.
//   • reconcileDaily — advance-time rollover: streak exactly-once (the
//     growUntouchedStreak precedent), TD3 banked-forever builds, fresh list,
//     visit_cradle's free tick.
//   • sweepDaily — runs on every advance: season-pass `daily_list` event
//     (exactly once per day, the seams §10.3.7 daily + weekly objectives) and
//     the D6 Wheel-of-Years deed (≥30-day streak → deed_30day_devotion wires).
//   • claimDaily — reward delivery + bonus (TD3: one claim button, rewards
//     bank forever). Scrip flows through grantCurrency's idempotent append-only
//     ledger — THE FIRST LIVE SCRIP FAUCET (expected per TD-X; balances bank
//     toward the future economy). Devotion accrues at claim time.
//   • favorScore — §3.2 derived trust (TD6 placeholders; SERVER-ONLY).
//     Purity-typed inputs accrue; betrayal subtracts. Devotion is practice,
//     NOT trust — it only weights the score, it can never grind it alone.
//
// HARD LINES (asserted in tests):
//   • Scrip ONLY — no Votive-shaped field exists in this state surface; the
//     reward strings name Scrip exclusively.
//   • NO purchasable completion / skip / accelerate / donate path — the export
//     surface never accepts a purchase; the API claim validates {token} only.
//   • NOT advancement — the list does not feed contributionScore(), timers,
//     Leader XP, or favor directly; it accelerates nothing.
//   • Betrayal-free by construction — no item names an AI-feeding or
//     corrupting act; the purity items are present but never mandatory.
//   • discipline()/purify stays untouched — `cleanse_taint` merely NOTES the
//     existing action; this file has no discipline implementation.
import type { DailyState, GameState, Zone } from "./types";
import { awardDeedCosmetic, grantCurrency, recordSeasonEvent, utcDayKey } from "./monetization";

// ======================================================================
// §2/§3 CONFIG — ONE place for every tunable number (TD2 values ratified;
// TD6 favor constants placeholders pending owner confirmation).
// ======================================================================
export const DAILY_CONFIG = {
  listLength: 4, // TD1 — items per UTC day
  scripPerItem: 30, // TD2
  devotionPerItem: 1,
  bonusScrip: 80,
  bonusDevotion: 3,
  // The "daily max" — the schedule IS the cap: 4×30+80 = 200, 4×1+3 = 7.
  // No path in this module can pay more than a full day's list.
  maxScripPerDay: 200,
  maxDevotionPerDay: 7,
  streakCosmeticDays: 30, // D6 — "Wheel of Years" at a 30-day devotion streak
} as const;

/** §3.2 favor formula weights (TD6 placeholders — calibrate later, aligned to
 *  heroes O2 finite-time bounds). SERVER-ONLY: never shipped to any client. */
export const FAVOR_CONSTANTS = {
  devotionWeight: 0.5,
  cleanRecoveryWeight: 2,
  zeroCorruptionWeight: 2,
  deedCodexWeight: 1.5,
  totalCodexWeight: 0.25,
  betrayalPenalty: 10,
} as const;

/** Placeholder Oracle qualification thresholds (TD6, oracle doc §4 — "vouch
 *  eligible ≥ 30, cleansing eligible ≥ 15"). SERVER-ONLY. */
export const FAVOR_THRESHOLDS = {
  vouchEligible: 30,
  cleanseEligible: 15,
} as const;

// ======================================================================
// §1.3 ITEM POOL — the 11 v1 items, grounded in TODAY'S engine events.
// Phase B/C ids (riddle_answered, cleanse_window, purify_assist, shield_ally,
// save_colony, decline_find) are deliberately NOT here — they land with the
// war layer (§1.4). Categories are first-class (purity-weighting later §3.2).
// ======================================================================
export type DailyItemId =
  | "visit_cradle"
  | "launch_any"
  | "launch_mid"
  | "launch_deep"
  | "study_ember"
  | "study_chipset"
  | "craft_item"
  | "refuel_convoy"
  | "research_complete"
  | "clean_recovery"
  | "cleanse_taint";

export type DailyCategory = "ritual" | "expedition" | "lab" | "workshop" | "knowledge" | "purity";

export interface DailyItemDef {
  id: DailyItemId;
  label: string; // diegetic label (§1.3)
  category: DailyCategory;
  icon: string;
}

export const DAILY_ITEM_POOL: DailyItemDef[] = [
  { id: "visit_cradle", label: "Attend to the Cradle — walk the works", category: "ritual", icon: "🕯️" },
  { id: "launch_any", label: "Send a team into the Shatterlands", category: "expedition", icon: "🚚" },
  { id: "launch_mid", label: "Run the mid ruins beyond the rim", category: "expedition", icon: "🚚" },
  { id: "launch_deep", label: "Take a deep scientific site", category: "expedition", icon: "🚚" },
  { id: "study_ember", label: "Study Embers in the lab", category: "lab", icon: "🔬" },
  { id: "study_chipset", label: "Decode a Chipset", category: "lab", icon: "🔬" },
  { id: "craft_item", label: "Forge something in the Workshop", category: "workshop", icon: "⚙️" },
  { id: "refuel_convoy", label: "Refuel and re-silence the convoy", category: "workshop", icon: "⚙️" },
  { id: "research_complete", label: "Complete a research project", category: "knowledge", icon: "📜" },
  { id: "clean_recovery", label: "Bring a surviving archive home whole", category: "purity", icon: "✨" },
  { id: "cleanse_taint", label: "Cleanse the Cradle's taint", category: "purity", icon: "✨" },
];

export const DAILY_ITEM_BY_ID = Object.fromEntries(DAILY_ITEM_POOL.map((d) => [d.id, d])) as Record<DailyItemId, DailyItemDef>;

export function dailyItemLabel(id: string): string {
  return DAILY_ITEM_BY_ID[id as DailyItemId]?.label ?? id;
}

// ---- family/category memberships used by the generator (TD1 constraints) ----
const LAUNCH_ITEMS = ["launch_any", "launch_mid", "launch_deep"];
/** Expedition-family = anything completed THROUGH the expedition system:
 *  the three launch items + clean_recovery (resolves via expeditions). */
const EXPEDITION_FAMILY = new Set([...LAUNCH_ITEMS, "clean_recovery"]);
const PURITY_ITEMS = ["clean_recovery", "cleanse_taint"];

// ---- capability mirrors (no engine import — cycle) ----
const DEEP_RAD = 35; // engine DEEP: zones at/above this are deep (gear-gated)
const DEEP_SITE_RAD = 60; // engine REVELATION_DEEP: the deep scientific sites
const MIN_RESEARCH_CODICES = 4; // research.ts cheapest project (w1/a1)

function hasStepOut(state: GameState): boolean {
  const r = state.resources;
  return r.medkit >= 1 && r.mechkit >= 1 && r.armorkit >= 1;
}
function hasDeepGear(state: GameState): boolean {
  const r = state.resources;
  return (r.hazmat ?? 0) + (r.shots ?? 0) + (r.alloys ?? 0) >= 1;
}

/**
 * Unlock gate (TD1): items a colony genuinely CAN'T complete today don't
 * appear. Structural gates only (gear/chipsets/codices) — transient resource
 * scarcity (supplies dip, scientists busy) is not gating: those recover
 * within a normal 15–30 min session, and the list is opt-in anyway.
 */
export function dailyItemAvailable(state: GameState, id: string): boolean {
  const r = state.resources;
  switch (id) {
    case "visit_cradle": return true;
    case "launch_any": return hasStepOut(state);
    case "launch_mid": return hasStepOut(state) && (r.gas >= 1 || r.battery >= 1);
    case "launch_deep": return hasStepOut(state) && hasDeepGear(state);
    case "study_ember": return r.embers >= 2;
    case "study_chipset": return (r.chipsets ?? 0) >= 1 || hasDeepGear(state);
    case "craft_item": return r.supplies >= 4;
    case "refuel_convoy": return r.supplies >= 4;
    case "research_complete":
      return (state.codices ?? 0) >= MIN_RESEARCH_CODICES ||
        (Array.isArray(state.researchJobs) && state.researchJobs.some((j) => j.status === "researching"));
    case "clean_recovery": return hasStepOut(state);
    case "cleanse_taint": return true;
    default: return false;
  }
}

// ======================================================================
// DETERMINISTIC GENERATOR (spec §4.2: "Deterministic generation, server-side,
// from public-ish state only"). Seeded by the UTC day key — the same (state,
// day) always draws the same list; no Math.random anywhere in the draw.
// ======================================================================
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function shuffled<T>(rng: () => number, arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Draw today's list (TD1 constraints):
 *   1. `visit_cradle` — the ritual anchor, always present (auto-completed by
 *      the day's first advance — the free tick, §1.3).
 *   2. ≤1 launch item — leads whenever the colony could launch today.
 *   3. purity ~every other day — deterministic day-seed parity pick from the
 *      available purity items (clean_recovery counts into the expedition-
 *      family cap: launch(1) + clean_recovery(1) = 2, the max).
 *   4. fill from the non-expedition pool (lab/workshop/knowledge + the
 *      un-picked purity item), no replacement.
 * Result: 4 items (or fewer if the pool is genuinely exhausted); at most 1
 * launch; ≤2 expedition-family; ≥1 non-expedition by construction.
 */
export function generateDailyList(state: GameState, now: number): string[] {
  if (!state.race) return []; // blank/reset slots hold their quiet state
  const dayKey = utcDayKey(now);
  const rng = mulberry32(hashSeed("daily:" + dayKey));
  const avail = DAILY_ITEM_POOL.filter((it) => dailyItemAvailable(state, it.id)).map((it) => it.id);
  const launches = LAUNCH_ITEMS.filter((id) => avail.includes(id));
  const purity = PURITY_ITEMS.filter((id) => avail.includes(id));
  const list: string[] = [];
  // 1 · ritual anchor.
  list.push("visit_cradle");
  // 2 · the single launch slot.
  if (list.length < DAILY_CONFIG.listLength && launches.length > 0) {
    list.push(pick(rng, launches));
  }
  // 3 · purity rhythm (~every other day).
  if (list.length < DAILY_CONFIG.listLength && purity.length > 0 && hashSeed("purity:" + dayKey) % 2 === 0) {
    list.push(pick(rng, purity));
  }
  // 4 · non-expedition fill, purity items EXCLUDED from the fill: the purity
  // rhythm is exactly the ~every-other-day parity pick above (a clean day or a
  // taint-cleansing day, deliberately — the daily's counterweight to hubris),
  // not an incidental second purity draw from the fill bag.
  const fillPool = shuffled(rng, avail.filter((id) => !EXPEDITION_FAMILY.has(id) && !PURITY_ITEMS.includes(id) && !list.includes(id)));
  while (list.length < DAILY_CONFIG.listLength && fillPool.length > 0) {
    list.push(fillPool.shift()!);
  }
  return list;
}

// ======================================================================
// THE EVENT FUNNEL (§4.2) — the ONLY way a daily item completes. Engine
// action fns call these after a successful act; the funnel marks matching
// items in the CURRENT day's list. Dedupe via `completed` (an item flips
// once). No client can fabricate these — they are engine-generated from
// real actions.
// ======================================================================
export function noteDailyEvent(state: GameState, itemId: string, now: number, zone?: Zone): void {
  if (!state.race || !state.daily) return;
  const d = state.daily;
  if (!Array.isArray(d.list) || d.list.length === 0) return;
  if (d.dayKey !== utcDayKey(now)) return; // stale block — advance() reconciles first
  if (!d.list.includes(itemId)) return;
  // Zone-gated launch predicates (§1.3).
  if (itemId === "launch_mid" && !(zone && zone.risk >= 40 && zone.radiationLevel < DEEP_RAD)) return;
  if (itemId === "launch_deep" && !(zone && zone.radiationLevel >= DEEP_SITE_RAD)) return;
  if (!d.completed.includes(itemId)) d.completed.push(itemId);
}

/** Launch-family convenience: fires launch_any + the zone-gated mid/deep ids. */
export function noteDailyLaunch(state: GameState, zone: Zone, now: number): void {
  noteDailyEvent(state, "launch_any", now, zone);
  noteDailyEvent(state, "launch_mid", now, zone);
  noteDailyEvent(state, "launch_deep", now, zone);
}

// ======================================================================
// MIGRATION + STATE DEFAULTS (ensure-pattern, V7).
// ======================================================================
export function freshDaily(now: number): DailyState {
  return {
    dayKey: "",
    list: [],
    events: [],
    completed: [],
    claimed: [],
    bonusClaimed: false,
    rolledAt: now,
    lastStreakDay: undefined,
    banked: {},
  };
}

/** V7 migration: old saves (any earlier version) load with a quiet fresh daily
 *  block (dayKey "" ≠ today → the first advance rolls today's list), zero
 *  Devotion and a zero streak. Idempotent. */
export function ensureDaily(state: GameState): void {
  if (!state.daily || typeof state.daily !== "object") {
    state.daily = freshDaily(Date.now());
  } else {
    const d = state.daily as unknown as Record<string, unknown>;
    if (typeof d.dayKey !== "string") d.dayKey = "";
    if (!Array.isArray(d.list)) d.list = [];
    if (!Array.isArray(d.events)) d.events = [];
    if (!Array.isArray(d.completed)) d.completed = [];
    if (!Array.isArray(d.claimed)) d.claimed = [];
    if (typeof d.bonusClaimed !== "boolean") d.bonusClaimed = false;
    if (typeof d.rolledAt !== "number") d.rolledAt = Date.now();
    if (typeof d.banked !== "object" || d.banked === null) d.banked = {};
  }
  if (typeof state.devotion !== "number" || !isFinite(state.devotion) || state.devotion < 0) state.devotion = 0;
  if (typeof state.devotionStreak !== "number" || !isFinite(state.devotionStreak) || state.devotionStreak < 0) {
    state.devotionStreak = 0;
  }
}

// ======================================================================
// DAY ROLLOVER (§4.2 reconcileDaily) — called at the top of advance().
// ======================================================================
function parseDayKey(key: string): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function utcDayGap(a: string, b: string): number {
  return Math.abs((parseDayKey(b) - parseDayKey(a)) / 86400000);
}

/**
 * Advance-time rollover (idempotent — only acts when the day key changed):
 *   1. Streak exactly-once per boundary UTC day (§2.3 / growUntouchedStreak):
 *      consecutive days with ≥1 completed item FROM PLAY. The auto-marked
 *      visit_cradle free tick does NOT count (it is not practice — see the
 *      module header note; otherwise every day would trivially qualify and
 *      the D6 30-day badge would be meaningless). Silent full-day gaps (a
 *      player returning after N days) break the chain — missed days reset,
 *      silently, per §2.3's "no punishment... no streak-at-risk copy".
 *   2. TD3 banked-forever: yesterday's unclaimed completions (and an
 *      unclaimed bonus) move into the server-only `banked` map, so work done
 *      but never claimed loses nothing — rewards bank until claimed, forever.
 *   3. Roll the fresh deterministic list, reset the day's claim state, and
 *      mark visit_cradle's free tick (the day's first advance — §1.3).
 */
export function reconcileDaily(state: GameState, now: number): void {
  ensureDaily(state);
  if (!state.race) return; // blank/reset colony: quiet state, no list, no rollover
  const d = state.daily;
  const today = utcDayKey(now);
  if (d.dayKey === today) return;
  const yesterday = d.dayKey;

  // 1 · streak (exactly-once per boundary day).
  const hadPractice = d.completed.some((id) => id !== "visit_cradle");
  if (d.lastStreakDay !== yesterday) {
    const prev = d.lastStreakDay;
    d.lastStreakDay = yesterday;
    // The very first rollover leaves lastStreakDay "" (a bookkeeping artifact,
    // not a real day) — it never counts as a gap: a colony's first practice
    // day simply starts its chain at 1.
    if (prev !== undefined && prev !== "" && utcDayGap(prev, yesterday) > 1) {
      state.devotionStreak = 0; // full silent days in between — the chain broke
    } else if (hadPractice) {
      state.devotionStreak = (state.devotionStreak ?? 0) + 1;
    } else {
      state.devotionStreak = 0;
    }
  }

  // 2 · TD3 bank: yesterday's unclaimed work survives the rollover.
  const allDone = d.list.length >= 1 && d.completed.length >= d.list.length;
  const unclaimed = d.completed.filter((id) => !d.claimed.includes(id));
  if (yesterday !== "" && (unclaimed.length > 0 || (allDone && !d.bonusClaimed))) {
    d.banked = d.banked ?? {};
    d.banked[yesterday] = { items: unclaimed, bonus: allDone && !d.bonusClaimed };
  }

  // 3 · roll the fresh list + reset the day's claim state.
  d.dayKey = today;
  d.list = generateDailyList(state, now);
  d.completed = [];
  d.claimed = [];
  d.bonusClaimed = false;
  d.events = [];
  d.rolledAt = now;
  if (d.list.includes("visit_cradle")) d.completed.push("visit_cradle"); // free tick
}

// ======================================================================
// COMPLETION SWEEP — runs on EVERY advance (no-op when nothing changed).
// Satisifies the already-waiting monetization seams (§7 of the spec):
//   • `daily_list` season event — the module's ONE recordSeasonEvent call
//     (fires the +20 daily objective AND the weekly ×5 counter, both of which
//     monetization.ts already defines and waits for).
//   • D6 Wheel-of-Years — DEED_COSMETIC_MAP.deed_30day_devotion flips wired
//     via awardDeedCosmetic at a ≥30-day devotion streak.
// ======================================================================
export function sweepDaily(state: GameState, now: number): void {
  ensureDaily(state);
  if (!state.race) return;
  const d = state.daily;
  if (!Array.isArray(d.list) || d.list.length === 0) return;
  if (d.dayKey !== utcDayKey(now)) return; // rollover runs first inside advance()
  if (d.completed.length >= d.list.length) {
    // Exactly once per day (the server-only events set is the dedupe).
    if (!d.events.includes("daily_list")) {
      d.events.push("daily_list");
      recordSeasonEvent(state, "daily_list", now);
    }
  }
  if ((state.devotionStreak ?? 0) >= DAILY_CONFIG.streakCosmeticDays) {
    awardDeedCosmetic(state, "deed_30day_devotion", now); // D6 — idempotent
  }
}

// ======================================================================
// CLAIM (TD3 — one claim button; rewards bank forever; idempotent) (§2.1/§4.2).
// Scrip flows through grantCurrency's append-only eventId-keyed ledger
// ("daily:<dayKey>:<itemId>") — a retried claim can never double-pay, and the
// same event ids are reused by banked days. Devotion accrues at claim time
// (streak counts completion-days, not clicks). The caller (api.ts) advances
// the state first, so this operates on the current day's reconciled block.
// ======================================================================
export interface ClaimGrant {
  scrip: number;
  devotion: number;
  bonus: boolean;
}

export function claimDaily(state: GameState, now: number): { ok: boolean; error?: string; granted?: ClaimGrant; state: GameState } {
  ensureDaily(state);
  const granted: ClaimGrant = { scrip: 0, devotion: 0, bonus: false };
  if (!state.race) return { ok: true, granted, state }; // blank colony: nothing to claim
  const d = state.daily;
  if (d.dayKey !== utcDayKey(now)) {
    // Stale block shouldn't reach here (api advances first) — refuse rather
    // than double-claim across a day boundary.
    return { ok: false, error: "The day has turned. Refresh to see today's devotion.", state };
  }

  const claimItem = (dayKey: string, itemId: string) => {
    const res = grantCurrency(state, "scrip", DAILY_CONFIG.scripPerItem, `daily:${dayKey}:${itemId}`, `Daily devotion — ${dailyItemLabel(itemId)}`, now, "earn");
    if (res.ok && !res.idempotent) {
      state.devotion += DAILY_CONFIG.devotionPerItem;
      granted.scrip += DAILY_CONFIG.scripPerItem;
      granted.devotion += DAILY_CONFIG.devotionPerItem;
    }
  };
  const claimBonus = (dayKey: string) => {
    const res = grantCurrency(state, "scrip", DAILY_CONFIG.bonusScrip, `daily:${dayKey}:bonus`, "Daily devotion — the day's practice complete", now, "earn");
    if (res.ok && !res.idempotent) {
      state.devotion += DAILY_CONFIG.bonusDevotion;
      granted.scrip += DAILY_CONFIG.bonusScrip;
      granted.devotion += DAILY_CONFIG.bonusDevotion;
      granted.bonus = true;
    }
  };

  // Today's completed-but-unclaimed items.
  for (const itemId of d.completed) {
    if (d.claimed.includes(itemId)) continue;
    claimItem(d.dayKey, itemId);
    d.claimed.push(itemId);
  }
  // Today's +80/+3 bonus when the whole list is done.
  const todayAllDone = d.list.length >= 1 && d.completed.length >= d.list.length;
  if (todayAllDone && !d.bonusClaimed) {
    claimBonus(d.dayKey);
    d.bonusClaimed = true;
  }
  // The TD3 bank — past days' unclaimed work. Entries are consumed on claim
  // (the currency ledger's event ids double-guard idempotency).
  for (const dayKey of Object.keys(d.banked ?? {})) {
    const entry = d.banked[dayKey];
    if (!entry) continue;
    for (const itemId of entry.items) claimItem(dayKey, itemId);
    if (entry.bonus) claimBonus(dayKey);
    delete d.banked[dayKey];
  }
  return { ok: true, granted, state };
}

// ======================================================================
// §3.2 FAVOR — derived trust, SERVER-ONLY (TD5/TD6). Never shipped to any
// client payload (api.ts strips the whole module surface; leak-tested).
// ======================================================================
export function favorScore(state: GameState): number {
  const c = (state.revelationCounters ?? {}) as GameState["revelationCounters"];
  const devotion = typeof state.devotion === "number" ? state.devotion : 0;
  const cleanRecoveries = c.cleanRecoveries ?? 0;
  const zeroCorruptionSurvivals = c.zeroCorruptionSurvivals ?? 0;
  const codicesEarnedByDeeds = c.codicesEarnedByDeeds ?? 0;
  const totalCodicesEarned = typeof state.totalCodicesEarned === "number" ? state.totalCodicesEarned : 0;
  const betrayals = 0; // war-layer betrayal counter arrives with the war module (Phase C)
  return (
    devotion * FAVOR_CONSTANTS.devotionWeight +
    cleanRecoveries * FAVOR_CONSTANTS.cleanRecoveryWeight +
    zeroCorruptionSurvivals * FAVOR_CONSTANTS.zeroCorruptionWeight +
    codicesEarnedByDeeds * FAVOR_CONSTANTS.deedCodexWeight +
    totalCodicesEarned * FAVOR_CONSTANTS.totalCodexWeight -
    betrayals * FAVOR_CONSTANTS.betrayalPenalty
  );
}

// ======================================================================
// PUBLIC VIEW (§4.5/§4.6) — the ONLY daily shape the client ever receives:
// dayKey, list, completed, claimed, bonusClaimed. `events` (raw dedupe),
// `rolledAt`, `lastStreakDay` and the TD3 `banked` map stay server-side.
// Devotion total + streak ship at the top level of GameState (TD5 public).
// ======================================================================
export function dailyPublicView(d: DailyState | undefined): {
  dayKey: string;
  list: string[];
  completed: string[];
  claimed: string[];
  bonusClaimed: boolean;
} {
  const x = d ?? ({} as DailyState);
  return {
    dayKey: typeof x.dayKey === "string" ? x.dayKey : "",
    list: Array.isArray(x.list) ? [...x.list] : [],
    completed: Array.isArray(x.completed) ? [...x.completed] : [],
    claimed: Array.isArray(x.claimed) ? [...x.claimed] : [],
    bonusClaimed: x.bonusClaimed === true,
  };
}