// TIME TOKENS — the EARNED path (owner direction, 2026-09-27).
//
// OWNER, VERBATIM (2026-09-27): "Add 1 minute and 5 minute speed UPS to each
// devotion reward claim as well so we can get those rolling in." Standing ruling
// it extends: "don't sell the one minute or the 5 minutes speed UPS — we will let
// the player gain those through functions like daily rewards like in the devotion
// thing… if everybody clears all the devotions in a day they get a nice pack."
//
// WHAT THIS FILE IS: the whole of the earned side. A time token is a held thing in
// the colony state that, when applied to ONE running timer, takes its own duration
// off that timer's remaining time. That is all it does — it grants no resource, no
// strength, no scored currency and no season tier, so a colony holding a million of
// them is as strong, as rich and as highly scored as one holding none (asserted:
// time-token-tests §D "power invariance").
//
// WHAT IS NOT HERE, AND CANNOT BE ADDED WITHOUT A SIGNED RULING: a price, a
// product, a purchase path, an entitlement, a Stripe object, a bundle — anything
// that would SELL a token. The sell-side sentence ("Speed-ups are sold; they
// compress one timer by at most 3.5×; they grant no resource, no strength, no
// scored currency, no season tier") is STILL UNSIGNED, so the only way a token can
// enter a colony in this build is the daily Devotion. `storefrontEnabled` stays
// false and the monetization catalogue's forbidden-vocabulary tripwire still
// refuses any purchasable key named like a speed-up (asserted in §E).
//
// THE FLOOR, ASSERTED AT APPLICATION (re-time spec; MIN_TIMER_FRACTION = 0.286):
// `timerFloor()` in engine.ts applies the SAME constant to the earned modifier
// stack. A token goes through the same door: an application is REFUSED when it
// would take the timer's own accumulated compression past `1 - 0.286` of that
// timer's BASE duration, and refused again if the remaining time would go to zero
// or below. So no pile of held tokens — one, a hundred, a million — can take a
// timer below the owner's 3.5× ceiling, and none can make it negative. The
// constant is MIRRORED here rather than imported because engine.ts imports this
// module (a cycle would form — the same reason daily.ts mirrors DEEP); the two
// are asserted EQUAL by `time-token-tests` §B, which is a stronger guard than a
// shared import would have been.
//
// WHAT A TOKEN MAY NOT TOUCH — an EXPLORATION RUN, BY NAME. "Speed must never
// touch the expedition ladder: those timers ARE the price." An expedition timer is
// therefore absent from the allow-list AND refused explicitly (`time.refusedExpedition`,
// translated in all five languages in the same commit), because a silent
// "unknown kind" would read as a bug rather than as a rule.
import type { GameState } from "./types";

// ======================================================================
// §1 THE TYPE — one explicit definition: size id -> duration ms.
// ======================================================================
//
// The TWO EARNED SIZES. These, and only these, exist in this build: the daily
// Devotion pays one of each per reward claim (§3), and nothing sells them.
export type TimeTokenSizeId = "1m" | "5m";

/** The earned sizes, in the order they are paid and displayed. */
export const EARNED_TIME_TOKEN_SIZES: readonly TimeTokenSizeId[] = ["1m", "5m"] as const;

export interface TimeTokenSizeDef {
  id: TimeTokenSizeId;
  ms: number;
}

export const TIME_TOKEN_SIZES: Record<TimeTokenSizeId, TimeTokenSizeDef> = {
  "1m": { id: "1m", ms: 60_000 },
  "5m": { id: "5m", ms: 300_000 },
};

// ---- THE SIX SELLABLE SIZES — FUTURE ENTRIES ONLY, DELIBERATELY NOT DEFINED ----
//
// Owner-decided 2026-09-27, verbatim: "don't sell the one minute or the 5 minutes
// speed UPS". What may one day be sold, and at the durations the owner set:
//
//     30m -> 1_800_000 ms      12h -> 43_200_000 ms
//      1h -> 3_600_000 ms      24h -> 86_400_000 ms
//      8h -> 28_800_000 ms     48h -> 172_800_000 ms
//
// They are NOT entries in the table above, on purpose. A live entry would be a
// sell-side object, and the ruling that legalises one is unsigned; when it is
// signed, the entries land here together with the price, the product id and the
// power-invariance test, in that PR. Nothing in this module may reference them
// before then — and `time-token-tests` §E asserts that this file defines exactly
// two sizes and that the monetization tripwire still refuses a purchasable key
// named like a speed-up.

/** Milliseconds a size is worth. Unknown sizes resolve to 0 and are refused. */
export function timeTokenMs(sizeId: string): number {
  return TIME_TOKEN_SIZES[sizeId as TimeTokenSizeId]?.ms ?? 0;
}

/** True when `sizeId` is one of the two EARNED sizes this build defines. */
export function isEarnedTimeTokenSize(sizeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIME_TOKEN_SIZES, sizeId);
}

// ======================================================================
// §2 STATE + GRANT — held tokens, one-shot migration, idempotent by eventId.
// ======================================================================

/** Held counts, keyed by size id. A size never held is absent or 0. */
export type TimeTokenHoldings = Record<string, number>;

/** One append-only ledger row. `grantCurrency`'s entry shape, for tokens: same
 *  field names, same monotonically-appended discipline, same "earn" source of
 *  truth — the ONLY way a token ever enters a colony. */
export interface TimeTokenLedgerEntry {
  eventId: string;
  kind: "earn" | "apply";
  sizeId: string;
  amount: number;
  reason: string;
  ts: number;
}

/** A colony that has never held a token: both earned sizes at zero. */
export function freshTimeTokens(): TimeTokenHoldings {
  const held: TimeTokenHoldings = {};
  for (const id of EARNED_TIME_TOKEN_SIZES) held[id] = 0;
  return held;
}

/**
 * ONE-SHOT MIGRATION (ensure-pattern, called from advance() beside the other
 * ensure* passes). A save written before time tokens existed gets both earned
 * sizes at zero and an empty ledger — never a guessed balance, never a negative
 * one. Idempotent: running it twice changes nothing.
 */
export function ensureTimeTokens(state: GameState): void {
  if (!state.timeTokens || typeof state.timeTokens !== "object") {
    state.timeTokens = freshTimeTokens();
  } else {
    for (const id of EARNED_TIME_TOKEN_SIZES) {
      const v = state.timeTokens[id];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) state.timeTokens[id] = 0;
      else state.timeTokens[id] = Math.floor(v);
    }
  }
  if (!Array.isArray(state.timeTokenLedger)) state.timeTokenLedger = [];
}

/** How many tokens of this size the colony holds. Never negative, never NaN. */
export function heldTimeTokens(state: GameState, sizeId: string): number {
  const v = state.timeTokens?.[sizeId];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Total held value in ms, across the earned sizes (for readouts and reports —
 *  never a number the engine derives a price or a reward from). */
export function heldTimeTokenMs(state: GameState): number {
  let total = 0;
  for (const id of EARNED_TIME_TOKEN_SIZES) total += heldTimeTokens(state, id) * timeTokenMs(id);
  return total;
}

/** Every eventId this colony has already used, in either ledger — an eventId is
 *  spent once, whatever it was spent on. */
function eventIdUsed(state: GameState, eventId: string): boolean {
  if ((state.timeTokenLedger ?? []).some((e) => e && e.eventId === eventId)) return true;
  return (state.currency?.ledger ?? []).some((e) => e && e.eventId === eventId);
}

export interface TimeTokenGrantResult {
  ok: boolean;
  error?: string;
  /** True when this exact eventId was already paid — a no-op, never a double-pay. */
  idempotent?: boolean;
}

/**
 * GRANT ONE TIME TOKEN — the earned path's only door.
 *
 * Idempotent by `eventId` exactly as `grantCurrency` is, against the same
 * discipline and the same rule that an eventId is spent once: a retried grant, a
 * replayed request or a re-run of the day's claim can never pay twice. `reason` is
 * for the log and the operator, never a player-facing surface.
 */
export function grantTimeToken(
  state: GameState,
  sizeId: string,
  eventId: string,
  reason: string,
  now = Date.now(),
): TimeTokenGrantResult {
  ensureTimeTokens(state);
  if (!isEarnedTimeTokenSize(sizeId)) return { ok: false, error: `Unknown time-token size "${sizeId}".` };
  if (!eventId) return { ok: false, error: "A time-token grant requires an eventId (idempotency)." };
  if (eventIdUsed(state, eventId)) return { ok: true, idempotent: true };
  state.timeTokens![sizeId] = heldTimeTokens(state, sizeId) + 1;
  state.timeTokenLedger!.push({ eventId, kind: "earn", sizeId, amount: 1, reason, ts: now });
  return { ok: true };
}

// ======================================================================
// §3 APPLY — compress exactly ONE running timer, floored, idempotent.
// ======================================================================

/**
 * The timers a token MAY compress. An EXPLORATION RUN is not on this list and
 * never can be: the ladder's timers are its price, and speed must never touch them.
 */
export type TimeTokenTimerKind = "armory_build" | "research" | "domain_deploy";

/** The refused kinds, named so the refusal can be explicit rather than silent. */
export type TimeTokenRefusedTimerKind = "expedition";

export const TIME_TOKEN_TIMER_KINDS: readonly TimeTokenTimerKind[] = [
  "armory_build",
  "research",
  "domain_deploy",
] as const;

/** What a token is pointed at: the timer's kind, plus the record's own id where a
 *  colony can have more than one of that kind running (an armory family, a research
 *  job). A domain deployment is single-slot, so it carries no id. */
export interface TimeTokenTarget {
  kind: string;
  id?: string;
}

export interface TimeTokenApplyResult {
  ok: boolean;
  /** A catalogue key the UI renders in the player's own language. A refusal is
   *  player-facing — this is the key, translated in all five files. */
  errorKey?: string;
  /** The same refusal in plain English, for the log and the operator. */
  error?: string;
  /** True when this request id was already applied — a no-op, never a second bite. */
  idempotent?: boolean;
  /** Milliseconds this application took off the timer (0 on a no-op or refusal). */
  compressedMs?: number;
  /** The timer's remaining time AFTER the application. */
  remainingMs?: number;
  /** The timer's own base duration (what it was created with). */
  baseMs?: number;
  /** Total compression now standing against this timer, tokens included. */
  compressedTotalMs?: number;
}

/**
 * MIRROR of `engine.MIN_TIMER_FRACTION` — the re-time's floor, one number shared by
 * the earned modifier stack and every time token. Mirrored (not imported) because
 * engine.ts imports this module; `time-token-tests` §B asserts the two are EQUAL,
 * so the mirror cannot drift silently.
 */
export const TIME_TOKEN_FLOOR_FRACTION = 0.286;

/** The most any pile of tokens may ever take off one timer: base × (1 - 0.286),
 *  i.e. the owner's 3.5× compression ceiling. */
export function maxTimeTokenCompressionMs(baseMs: number): number {
  return Math.floor(Math.max(0, baseMs) * (1 - TIME_TOKEN_FLOOR_FRACTION));
}

/** Where a timer's resolution lives, so one function can read and write all three
 *  kinds without the engine having to expose its resolvers. */
interface TimerRef {
  /** The timer's own base duration — what it was created with, never mutated. */
  baseMs: number;
  /** Currently accumulated compression (undefined = never touched). */
  compressedMs: number;
  startedAt: number;
  /** Resolution timestamp: `startedAt + baseMs` for every kind. */
  endMs: number;
  /** Write `compressedMs` back to the record. */
  write: (compressedMs: number) => void;
}

function timerRef(state: GameState, target: TimeTokenTarget): TimerRef | null {
  switch (target.kind) {
    case "armory_build": {
      const build = target.id ? state.armoryBuilds?.[target.id] : undefined;
      if (!build) return null;
      // The armory's own base IS `doneAt - startedAt` (nothing else ever moves it).
      const base = build.doneAt - build.startedAt;
      return {
        baseMs: base,
        compressedMs: build.timeTokenMs ?? 0,
        startedAt: build.startedAt,
        endMs: build.doneAt,
        write: (ms) => { build.timeTokenMs = ms; },
      };
    }
    case "research": {
      const job = target.id ? (state.researchJobs ?? []).find((j) => j.id === target.id && j.status === "researching") : undefined;
      if (!job) return null;
      return {
        baseMs: job.durationMs,
        compressedMs: job.timeTokenMs ?? 0,
        startedAt: job.startedAt,
        endMs: job.startedAt + job.durationMs,
        write: (ms) => { job.timeTokenMs = ms; },
      };
    }
    case "domain_deploy": {
      const j = state.programDeploy;
      if (!j) return null;
      return {
        baseMs: j.durationMs,
        compressedMs: j.timeTokenMs ?? 0,
        startedAt: j.startedAt,
        endMs: j.startedAt + j.durationMs,
        write: (ms) => { j.timeTokenMs = ms; },
      };
    }
    default:
      return null;
  }
}

/** A refusal, in both languages the system needs: the key the player reads and the
 *  English the log keeps. */
function refuse(errorKey: string, error: string): TimeTokenApplyResult {
  return { ok: false, errorKey, error };
}

/**
 * APPLY ONE TIME TOKEN to one running timer.
 *
 * Compresses ONE timer by the token's own duration and nothing else. Every
 * application re-asserts the floor against the timer's own base duration: the
 * accumulated compression may never exceed `base × (1 - 0.286)`, and the remaining
 * time may never reach or pass zero. A refusal is a first-class result carrying a
 * catalogue key, because the player asked for something the game declines to do.
 *
 * IDEMPOTENT BY REQUEST ID: `requestId` is the ledger's eventId, spent once. A
 * repeated apply — a double-tap, a retried POST — returns `idempotent: true` and
 * takes nothing more off the timer.
 */
export function applyTimeToken(
  state: GameState,
  sizeId: string,
  requestId: string,
  target: TimeTokenTarget,
  now = Date.now(),
): TimeTokenApplyResult {
  ensureTimeTokens(state);
  // 1 · the token itself.
  if (!isEarnedTimeTokenSize(sizeId)) return refuse("time.refusedSize", `Unknown time-token size "${sizeId}".`);
  if (!requestId) return refuse("time.refusedSize", "An apply requires a requestId (idempotency).");
  // 2 · the ladder is out of reach, BY NAME. Checked before anything else so the
  //     refusal the player sees is the rule, not a generic "no such timer".
  if (target.kind === "expedition") {
    return refuse(
      "time.refusedExpedition",
      "A time token cannot shorten an exploration run — the ladder's timers are its price.",
    );
  }
  if (!TIME_TOKEN_TIMER_KINDS.includes(target.kind as TimeTokenTimerKind)) {
    return refuse("time.refusedUnknownKind", `"${target.kind}" is not a timer a time token may compress.`);
  }
  // 3 · idempotency BEFORE the timer is read: a repeat is a no-op whatever the
  //     timer has done since (it may already have resolved — still a no-op).
  if (eventIdUsed(state, requestId)) return { ok: true, idempotent: true, compressedMs: 0 };
  // 4 · the timer.
  const ref = timerRef(state, target);
  if (!ref) return refuse("time.refusedNoTimer", `No running ${target.kind} timer to compress.`);
  // 5 · the token must be held.
  if (heldTimeTokens(state, sizeId) < 1) return refuse("time.refusedNoTokens", `No ${sizeId} time token is held.`);
  const remaining = ref.endMs - ref.compressedMs - now;
  if (!(remaining > 0)) return refuse("time.refusedNoTimer", "That timer has already run out.");
  // 6 · THE FLOOR, asserted here, against the timer's OWN base duration. The
  //     remaining time is clamped to it rather than refused outright, so a player
  //     holding a pile spends part of a token's worth and keeps the rest — and the
  //     timer can never be driven to zero or below by any pile.
  const ceiling = maxTimeTokenCompressionMs(ref.baseMs);
  const headroom = Math.max(0, ceiling - ref.compressedMs);
  if (headroom <= 0) return refuse("time.refusedFloor", "That timer is already at its floor.");
  const compress = Math.min(timeTokenMs(sizeId), remaining, headroom);
  if (!(compress > 0)) return refuse("time.refusedFloor", "That timer is already at its floor.");
  // 7 · spend and compress. The token is consumed by the ledger, exactly once.
  state.timeTokens![sizeId] = heldTimeTokens(state, sizeId) - 1;
  state.timeTokenLedger!.push({
    eventId: requestId,
    kind: "apply",
    sizeId,
    amount: -1,
    reason: `Time token — ${compress} ms off a running ${target.kind} timer${target.id ? ` (${target.id})` : ""}`,
    ts: now,
  });
  const total = ref.compressedMs + compress;
  ref.write(total);
  return {
    ok: true,
    compressedMs: compress,
    remainingMs: Math.max(0, remaining - compress),
    baseMs: ref.baseMs,
    compressedTotalMs: total,
  };
}

// ======================================================================
// §4 PUBLIC VIEW — what the client is told. Held tokens are the player's own
// possessions (like a balance), so they ship; the LEDGER is the server's
// idempotency record, so it does not (api.ts strips it).
// ======================================================================
export function timeTokensPublicView(held: TimeTokenHoldings | undefined): TimeTokenHoldings {
  const out: TimeTokenHoldings = {};
  for (const id of EARNED_TIME_TOKEN_SIZES) {
    const v = held?.[id];
    out[id] = typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  return out;
}
