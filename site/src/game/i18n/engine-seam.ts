// engine-seam.ts — THE one seam a translation engine plugs into (owner, 2026-09-25:
// "why don't we just make our own translation engine ourselves and build it into
// the game").
//
// Nothing else in the UI may ever call a translation engine directly. The chat
// "Translate" button (a later slice) and any future live-string translation go
// through `engineTranslateText`; a key the catalogues are missing (a rare case,
// e.g. content written before its key landed) goes through `engineTranslateKey`
// *before* the humanised fallback below. Today no engine is registered, both
// helpers return null, and the app behaves exactly as the catalogue says.
//
// Why a seam at all, and not the browser's built-in Translator API: Chrome's own
// docs say those APIs work on desktop Chrome and NOT on mobile devices, and this
// game is phone-first. Live translation therefore needs an engine we control —
// with a real compute cost — and that is a later slice by the owner's decision.
//
// Contract for the future engine:
//   • pure and synchronous-ish (a cache belongs behind it; the UI never awaits
//     inside a render),
//   • returns null when it cannot help — never a guess wrapped in confidence,
//   • never returns a raw key or an empty string,
//   • does no network call of its own on a UI thread.

import type { TParams } from "./types";

export interface TranslationEngine {
  /** an identifier for the diagnostics line, e.g. "dse-mt-1" */
  name: string;
  /** translate a missing KEY for a language, given the English source text */
  key?: (key: string, lang: string, englishSource: string) => string | null;
  /** translate arbitrary player text (the chat Translate button, later) */
  text?: (text: string, from: string, to: string) => string | null;
}

let engine: TranslationEngine | null = null;

/** Install (or, with null, remove) the one engine the app consults. */
export function registerTranslationEngine(next: TranslationEngine | null): void {
  engine = next;
}

export function activeTranslationEngine(): TranslationEngine | null {
  return engine;
}

export function engineTranslateKey(key: string, lang: string, englishSource: string): string | null {
  return engine?.key ? engine.key(key, lang, englishSource) : null;
}

/**
 * The seam the chat UI will call for a per-message "Translate" button. Returns
 * null when no engine is installed — the caller shows the original text, never a
 * placeholder pretending to be a translation.
 */
export function engineTranslateText(text: string, from: string, to: string): string | null {
  return engine?.text ? engine.text(text, from, to) : null;
}

/** Diagnostics: is a live translation engine available right now? */
export function translationEngineName(): string | null {
  return engine?.name ?? null;
}

/** Unused params in the engine interface are intentional — keep the shape. */
export type { TParams };
