// catalogues.ts — the assembled key → text maps, one per shipped language.
//
// A language is ONE FILE: `./langs/<code>.ts` default-exporting a flat
// `Catalogue`. Adding a language = add the file + one row in `languages.ts` +
// one line here (the imports must stay static so Vite can bundle them and the
// SSR pass can resolve them without a network round-trip). `i18n-verify` gates
// that every registered code has a catalogue and that every file in `langs/` is
// registered — a half-added language fails the suite instead of shipping.
import type { Catalogue } from "./types";
import { SOURCE_LANG } from "./languages";
import en from "./langs/en";

// Machine-translated files, zero cost (no service, no key, no purchase). Each is
// marked `machine: true` in `languages.ts` so a human pass can claim it later by
// dropping in a replacement file — no code changes anywhere.
import es from "./langs/es";
import ptBR from "./langs/pt-BR";
import ru from "./langs/ru";

export const CATALOGUES: Record<string, Catalogue> = {
  [SOURCE_LANG]: en,
  es,
  "pt-BR": ptBR,
  ru,
};

/** The codes that actually have a catalogue in the bundle (gated vs the registry). */
export const CATALOGUED_CODES: readonly string[] = Object.keys(CATALOGUES);
