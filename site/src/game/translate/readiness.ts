// readiness.ts — THE ONE PLACE "CAN THIS DEVICE TRANSLATE, AND WHAT MAY THE ROW SAY?" IS DECIDED.
//
// WHY THIS IS A PURE MODULE AND NOT LOGIC INSIDE THE COMPONENT: the owner's rule
// (2026-09-26) is a TRUTH rule — "without the pack the Translate affordance must say
// translation is preparing IN THE PLAYER'S OWN LANGUAGE, and a partial download must
// never be shown as ready". A rule about what the UI may claim has to be checkable,
// so it lives here: no React, no DOM, no fetch, no catalogue. `TranslatorNote.tsx`
// renders what this returns and decides nothing itself.
//
// THREE FACTS, AND A ROW MAY ONLY CLAIM WHAT ALL THREE SUPPORT:
//
//   1. `status.available` — an inference engine is registered and answerable. This is
//      the REAL signal, not a proxy: `translatorAvailable()` is `runtime !== null`,
//      and a runtime is only ever set after `createRuntime()` has really returned one
//      against the pack on the device (`translate/index.ts`).
//   2. `status.realWeights` — the shipped pack is the owner-approved m2m100 model.
//      Always true now: there is no stand-in anymore.
//   3. the pack phase — "ready" only when every file is on the device at its exact
//      length and hashed to the manifest's pin.
//
// The honest states: preparing (downloading / engine not built yet), failed (with
// retry), ready (translating). A partial download is never shown as ready.

import type { TranslatorStatus } from "./index";
import type { WeightsState } from "./weights";

/** What the Settings row is, right now. `hidden` = nothing true to say. */
export type TranslatorRowKind = "hidden" | "preparing" | "failed" | "ready";

export interface TranslatorRowView {
  kind: TranslatorRowKind;
  /**
   * Bytes durably on this device. NEVER `cachedBytes + receivedBytes`: the bytes read
   * off the wire in an attempt are the same bytes that attempt stored, so summing the
   * two double-counts. `cachedBytes` alone is what is on the device.
   */
  doneBytes: number;
  /**
   * The size the row may NAME, or null when naming one would be dishonest.
   * Non-null only for the real pack.
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
    sizeBytes: named ? w.totalBytes : null,
    showProgress: named && downloading,
    percent: w.percent,
    canRetry: kind === "failed" || (kind === "preparing" && w.cachedBytes > 0),
    canFreeSpace: w.cachedBytes > 0,
  };
}
