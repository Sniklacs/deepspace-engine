// translate.ts — the runtime lookup, and the guarantees that make it safe to put
// a `t("…")` call anywhere in the UI.
//
// The fallback chain, in order (missing key → English, and a raw key name must
// NEVER reach the screen):
//
//   1. the chosen language's own file           (langs/<code>.ts)
//   2. the English catalogue                    (langs/en.ts — source of truth)
//   3. the translation engine, if one is installed  (engine-seam.ts)
//   4. the English literal passed at the call site   (`t("k", "Do the thing")`)
//   5. the humanised tail of the key            ("cradle.tile.workshop" → "Workshop")
//
// Step 5 is the structural promise: the last segment of a key has no dots and is
// title-cased into words, so the thing that reaches the screen can never *be* the
// key. `i18n-verify` asserts it for every shipped key and for nonsense keys too.
// Every step-2-or-later hit is recorded in a diagnostics ledger (`missingKeys`)
// so an incomplete file is visible rather than silently half-English.

import { SOURCE_LANG } from "./languages";
import { CATALOGUES } from "./catalogues";
import { engineTranslateKey } from "./engine-seam";
import type { Catalogue, T, TParams } from "./types";

/** The shape of a translation key: at least one dot, no spaces. */
export const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

/** "cradle.tile.suppliesHeld" → "Supplies held" — never a raw key. */
export function humanizeKey(key: string): string {
  const tail = key.split(".").pop() ?? key;
  const words = tail
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "…";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `{n}`-style interpolation. A missing param leaves its placeholder alone. */
export function interpolate(text: string, params?: TParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

export function catalogueFor(lang: string): Catalogue | undefined {
  return CATALOGUES[lang];
}

export function englishCatalogue(): Catalogue {
  return CATALOGUES[SOURCE_LANG] ?? {};
}

export function hasKey(key: string, lang: string = SOURCE_LANG): boolean {
  return Object.prototype.hasOwnProperty.call(catalogueFor(lang) ?? {}, key);
}

// ---- the missing-key ledger (diagnostics; never a user-visible surface) ------
const missing = new Set<string>();

function note(lang: string, key: string, step: string) {
  missing.add(`${lang}::${key}::${step}`);
}

export function missingKeys(): string[] {
  return [...missing].sort();
}

export function resetMissingKeys(): void {
  missing.clear();
}

/**
 * Resolve one key to text. `source` is the English literal at the call site, and
 * is what an English player sees when the catalogue is somehow behind the code.
 */
export function rawTranslate(
  lang: string,
  key: string,
  source?: string,
  params?: TParams,
  opts?: { note?: boolean },
): string {
  const shouldNote = opts?.note !== false;
  const own = catalogueFor(lang)?.[key];
  if (typeof own === "string" && own.length > 0) return interpolate(own, params);

  const en = englishCatalogue()[key];
  if (typeof en === "string" && en.length > 0) {
    if (shouldNote && lang !== SOURCE_LANG) note(lang, key, "english");
    return interpolate(en, params);
  }

  const engineText = engineTranslateKey(key, lang, source ?? "");
  if (typeof engineText === "string" && engineText.length > 0) {
    if (shouldNote) note(lang, key, "engine");
    return interpolate(engineText, params);
  }

  if (typeof source === "string" && source.length > 0) {
    if (shouldNote) note(lang, key, "source");
    return interpolate(source, params);
  }

  if (shouldNote) note(lang, key, "humanized");
  return humanizeKey(key);
}

/** Bind a language once and get the `t()` the components hold. */
export function makeT(lang: string): T {
  const t = ((key: string, a?: TParams | string, b?: TParams) => {
    const source = typeof a === "string" ? a : undefined;
    const params = typeof a === "string" ? b : a;
    return rawTranslate(lang, key, source, params);
  }) as T;
  t.lang = lang;
  return t;
}

/** `t(key)` / `t(key, params)` / `t(key, "English literal", params)` in one call. */
export function translate(lang: string, key: string, a?: TParams | string, b?: TParams): string {
  const source = typeof a === "string" ? a : undefined;
  const params = typeof a === "string" ? b : a;
  return rawTranslate(lang, key, source, params);
}

export interface Completeness {
  lang: string;
  total: number;
  present: number;
  /** keys the English catalogue has and this file does not */
  missing: string[];
  /** keys present but empty — worse than missing, so they fail the gate */
  empty: string[];
  /** translated text identical to English: legitimate for nouns, a smell for prose */
  identical: string[];
  complete: boolean;
}

/** How a shipped file measures against the English source of truth. */
export function catalogueCompleteness(lang: string): Completeness {
  const en = englishCatalogue();
  const own = catalogueFor(lang) ?? {};
  const keys = Object.keys(en).sort();
  const missingKeys_: string[] = [];
  const empty: string[] = [];
  const identical: string[] = [];
  for (const k of keys) {
    const v = own[k];
    if (typeof v !== "string") missingKeys_.push(k);
    else if (v.trim().length === 0) empty.push(k);
    else if (lang !== SOURCE_LANG && v === en[k]) identical.push(k);
  }
  return {
    lang,
    total: keys.length,
    present: keys.length - missingKeys_.length,
    missing: missingKeys_,
    empty,
    identical,
    complete: missingKeys_.length === 0 && empty.length === 0,
  };
}

/** Keys the app asks for that no catalogue knows — the "un-keyed string" smell. */
export function unknownKeysUsed(keys: readonly string[]): string[] {
  const en = englishCatalogue();
  return keys.filter((k) => !Object.prototype.hasOwnProperty.call(en, k));
}
