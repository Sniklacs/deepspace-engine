// types.ts — the i18n module's shared shapes (deliberately tiny; no imports, so
// nothing here can ever create a cycle between the translator, the registry and
// the language files).

/** A flat key → text map. One per language; English is the source of truth. */
export type Catalogue = Record<string, string>;

/** Interpolation values: `t("ribbon.chorusPct", { pct: 50 })` → "Chorus 50%". */
export type TParams = Record<string, string | number>;

/** The lookup function the UI holds. Bound to one language by `makeT`. */
export type T = {
  (key: string, params?: TParams): string;
  (key: string, fallback: string, params?: TParams): string;
  /** the language this `t` resolves in (already falls back to English internally) */
  lang: string;
};
