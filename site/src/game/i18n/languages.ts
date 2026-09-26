// languages.ts — the shipped-language registry (L1/L3/L9/L10 of
// design/localization-settings-captions.md).
//
// ONE DROP-IN FILE PER LANGUAGE, plus one row here. A language file lives in
// `./langs/<code>.ts`, default-exports `{ meta, strings }`, and is registered by
// adding its code to LANGS below. Nothing else in the codebase changes: the
// translator, the picker, the Settings row and the pre-paint boot script all
// read this table. `i18n-tests/i18n-verify.ts` gates the contract (every file
// registered, every registered file present).
//
// `en` is the SOURCE OF TRUTH (`./langs/en.ts`) and is never machine-translated.
// The other entries are machine translations at zero cost — no service, no key,
// no purchase — each flagged `machine: true` with its provenance, so a human
// translation can replace the file later without touching a line of code.
//
// Launch set (slice 1, chosen by player population among the languages the
// current font stack and layout already render correctly — LTR, Latin/Cyrillic):
//   es · pt-BR · ru.  CJK (ja/ko/zh) waits on font coverage and RTL (ar/he/fa/ur)
//   waits on layout mirroring; both are named in L10 and both are later slices.

export type LangDirection = "ltr" | "rtl";

export interface LangMeta {
  /** BCP-47-ish code — the file name, the storage value, the picker's value. */
  code: string;
  /** The language's own name for itself — what a player who cannot read English reads. */
  endonym: string;
  /** The English name, shown beside the endonym for English-reading testers. */
  english: string;
  dir: LangDirection;
  /** true = produced by machine translation, replaceable by a human file. */
  machine: boolean;
  /** Who/what produced this file, so provenance is never a guess. */
  source: string;
}

/** The source-of-truth language. Every other file is complete against it. */
export const SOURCE_LANG = "en";

/** The registry — the ONLY list of shipped languages. */
export const LANGS: readonly LangMeta[] = [
  {
    code: "en",
    endonym: "English",
    english: "English",
    dir: "ltr",
    machine: false,
    source: "source of truth (written in the components and catalogue, never machine)",
  },
  {
    code: "es",
    endonym: "Español",
    english: "Spanish",
    dir: "ltr",
    machine: true,
    source: "local machine translation, zero cost (team's own model; no service, no key, no account)",
  },
  {
    code: "pt-BR",
    endonym: "Português (Brasil)",
    english: "Portuguese (Brazil)",
    dir: "ltr",
    machine: true,
    source: "local machine translation, zero cost (team's own model; no service, no key, no account)",
  },
  {
    code: "ru",
    endonym: "Русский",
    english: "Russian",
    dir: "ltr",
    machine: true,
    source: "local machine translation, zero cost (team's own model; no service, no key, no account)",
  },
];

export const LANG_CODES: readonly string[] = LANGS.map((l) => l.code);

export function isShippedLang(code: unknown): code is string {
  return typeof code === "string" && LANG_CODES.includes(code);
}

export function langMeta(code: string): LangMeta {
  return LANGS.find((l) => l.code === code) ?? LANGS[0];
}

/**
 * Normalise any tag a browser hands us ("pt-br", "es-419", "ru_RU") to a shipped
 * code. Returns null when nothing matches — the caller then keeps English, so a
 * browser tag can only ever be a SUGGESTION (L1: never a lock).
 */
export function matchLangTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const norm = String(tag).replace(/_/g, "-").trim();
  if (!norm) return null;
  const exact = LANG_CODES.find((c) => c.toLowerCase() === norm.toLowerCase());
  if (exact) return exact;
  const base = norm.split("-")[0].toLowerCase();
  const byBase = LANG_CODES.find((c) => c.split("-")[0].toLowerCase() === base);
  return byBase ?? null;
}

/** The first shipped match from a `navigator.languages` list, else null. */
export function suggestLang(tags: readonly string[] | undefined | null): string | null {
  if (!tags) return null;
  for (const t of tags) {
    const m = matchLangTag(t);
    if (m) return m;
  }
  return null;
}
