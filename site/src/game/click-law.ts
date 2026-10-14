// click-law.ts — THE CLICK LAW (Hans, Oct 14 2026), the enforceable core.
//
// "If I click on a button it has to be shown as clicked, like there was an
// action taken, so that I don't sit here and just click the motherfucker
// acting like it's broke." And the second half: a silent button gets pressed
// repeatedly and EVERY press executes — silently draining supplies and
// currency. So every spend control in the supply/store flows gets:
//
//   1. A PRESS GATE — a synchronous, render-independent lock. `tryAcquire()`
//      returns true exactly once until `release()` is called, no matter how
//      fast the taps land or how often React re-renders in between. State
//      alone cannot promise this (two taps can land inside one render batch
//      and both read the stale "not busy" value); a ref-held gate can,
//      because the check-and-set happens in the same synchronous instant.
//   2. A RECEIPT — every spend lands a visible answer in the fiction's own
//      verb (forge → "Forged", build → "Built", buy → "Loaded"), naming the
//      thing, the amount, and the RUNNING TOTALS after the action, so the
//      player sees the cost land instead of discovering it later.
//
// This module is pure (no React, no DOM) so the hammer test can prove the
// lockout: fifty presses inside one flight → exactly one execution, one
// charge.

/** A one-flight-at-a-time gate for a single control. */
export interface PressGate {
  /** True exactly once per flight; false for every repeat press while locked. */
  tryAcquire(): boolean;
  /** End the flight; the next press may execute. */
  release(): void;
  /** Whether a flight is currently in progress. */
  readonly locked: boolean;
}

export function createPressGate(): PressGate {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    get locked() {
      return locked;
    },
  };
}

/** A per-press idempotency key: one key per ACQUIRED press, reused by any
 *  retry of that same press, so a server that dedupes by eventId can never
 *  charge twice for one tap. Distinct presses get distinct keys. */
export function pressEventId(scope: string): string {
  return `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The fiction's verbs for a landed spend (Hans's receipt vocabulary,
 *  Oct 14 2026): forge → Forged, build supplies → Built/Stocked, buy →
 *  Loaded. Never a generic "success". */
export type ReceiptVerb = "forged" | "built" | "stocked" | "loaded";

export const RECEIPT_VERB_WORD: Record<ReceiptVerb, string> = {
  forged: "Forged",
  built: "Built",
  stocked: "Stocked",
  loaded: "Loaded",
};

/** One landed spend, structured: the components render it with localized
 *  labels; the shape itself is what the tests pin. */
export interface SpendReceipt {
  verb: ReceiptVerb;
  /** What was made/bought, in-world name ("Medkit", "War Bundle — Field Cache"). */
  itemLabel: string;
  /** How many landed (the server's honest count, not the requested count). */
  amount: number;
  /** Running totals AFTER the action: held count, supplies/currency left. */
  totals: { label: string; value: number }[];
}

/** The receipt's headline: "Forged ✓ +3 Medkits". */
export function receiptHeadline(r: SpendReceipt): string {
  return `${RECEIPT_VERB_WORD[r.verb]} ✓ +${r.amount} ${r.itemLabel}`;
}

/** The receipt's totals line: "14 held · 287 supplies left". Labels arrive
 *  localized from the caller; values are the post-action balances. */
export function receiptTotalsLine(r: SpendReceipt): string {
  return r.totals.map((t) => `${t.value.toLocaleString("en-US")} ${t.label}`).join(" · ");
}

export function spendReceipt(input: SpendReceipt): SpendReceipt {
  return {
    verb: input.verb,
    itemLabel: input.itemLabel,
    amount: Math.max(0, Math.floor(input.amount)),
    totals: input.totals.map((t) => ({ label: t.label, value: Math.floor(t.value) })),
  };
}
