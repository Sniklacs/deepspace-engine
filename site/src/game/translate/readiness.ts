// readiness.ts — THE ONE PLACE "CAN THIS DEVICE TRANSLATE, AND WHAT MAY THE ROW SAY?" IS DECIDED.
//
// WHY THIS IS A PURE MODULE AND NOT LOGIC INSIDE THE COMPONENT: the owner's rule
// (2026-09-26) is a TRUTH rule — "without weights the Translate affordance must say
// translation is preparing IN THE PLAYER'S OWN LANGUAGE, and a partial download must
// never be shown as ready". A rule about what the UI may claim has to be checkable,
// so it lives here: no React, no DOM, no fetch, no catalogue. `TranslatorNote.tsx`
// renders what this returns and decides nothing itself, and `translate-tests` walks
// the whole cross-product of states below and fails if a "ready" row can exist while
// the engine is unanswerable or while the shipped profile is not the real model.
//
// THREE FACTS, AND A ROW MAY ONLY CLAIM WHAT ALL THREE SUPPORT:
//
//   1. `status.available` — an inference engine is registered and answerable. This is
//      the REAL signal, not a proxy: `translatorAvailable()` is `runtime !== null`,
//      and a runtime is only ever set after `createRuntime()` has really returned one
//      against the bytes on the device (`translate/index.ts`).
//   2. `status.realWeights` — the shipped profile is the owner-approved ~603 MB
//      m2m100 model rather than the small pipeline stand-in. The stand-in proves the
//      pipeline; it IS NOT the translator, so its byte count may never be printed in
//      this row and the row may never describe it as something that is ready.
//   3. the weights phase — "ready" only when every chunk is on the device at its exact
//      length and the whole assembled file hashed to the manifest's pin.
//
// Today: the profile is the stand-in and no inference runtime exists in this
// repository, so `available` is false and the row says — in the player's own
// language — that translation is preparing. That is the honest state, and it is the
// state the guard below pins.

import type { TranslatorStatus } from "./index";
import type { WeightsState } from "./weights";

/** What the Settings row is, right now. `hidden` = nothing true to say. */
export type TranslatorRowKind = "hidden" | "preparing" | "failed" | "ready";

export interface TranslatorRowView {
  kind: TranslatorRowKind;
  /**
   * Bytes durably on this device. NEVER `cachedBytes + receivedBytes`: the bytes read
   * off the wire in an attempt are the same bytes that attempt stored, so summing the
   * two double-counts (a 20 MB model reported as 40 MB, a half-kept download reported
   * as fully kept). `cachedBytes` alone is what is on the device.
   */
  doneBytes: number;
  /**
   * The size the row may NAME, or null when naming one would describe the stand-in as
   * the translator. Non-null only for the real model.
   */
  sizeBytes: number | null;
  /** true only when a percentage is both meaningful and honest to show */
  showProgress: boolean;
  percent: number;
  canRetry: boolean;
  canFreeSpace: boolean;
}

/**
 * The row's whole state. Every branch is derived from the three facts above; nothing
 * here reads the catalogue or the DOM, so it can be checked exhaustively.
 */
export function translatorRow(status: TranslatorStatus): TranslatorRowView {
  const w: WeightsState = status.weights;
  /** The engine can really translate a string right now. */
  const answerable = status.available === true;
  /** The row may name the model and its size. */
  const named = status.realWeights === true;
  const downloading = w.phase === "downloading" || w.phase === "partial" || w.phase === "verifying";

  let kind: TranslatorRowKind = "preparing";
  if (w.phase === "unknown" || w.phase === "unsupported") {
    kind = "hidden";
  } else if (w.phase === "ready" && answerable && named) {
    kind = "ready";
  } else if (w.phase === "failed") {
    kind = "failed";
  }

  return {
    kind,
    doneBytes: w.cachedBytes,
    // The stand-in's 20 MB is never presented as the translator.
    sizeBytes: named ? w.totalBytes : null,
    // A bar for the stand-in would be progress on something that is not the
    // translator, so it is shown only when the row may name the real model.
    showProgress: named && downloading,
    percent: w.percent,
    canRetry: kind === "failed" || (kind === "preparing" && w.cachedBytes > 0),
    canFreeSpace: w.cachedBytes > 0,
  };
}
