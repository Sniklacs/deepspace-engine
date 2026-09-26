// index.ts — the i18n module's public door.
//
// The UI only ever needs three things from here:
//
//   const t = useT();            // in a component: t("nav.colony")
//   const { lang } = useLang();  // the language in force right now
//   <LanguageGate /> …           // the pre-paint resolve + first-run picker
//
// Everything below is exported so the harnesses and, later, the chat UI can use
// the pipe without reaching into internals: `t` for a plain lookup outside
// React, `engineTranslateText` for live text (the chat "Translate" button — a
// later slice, seam only today), and the diagnostics ledger.
export * from "./types";
export * from "./languages";
export * from "./catalogues";
export * from "./translate";
export * from "./engine-seam";
export * from "./device";
export * from "./slot-label";
