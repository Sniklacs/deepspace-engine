// THE BUTTON LAW (owner 2026-10-16, from live play in the Lab): "anything
// fucking thing clickable has to look like a button." The Lab's Deploy AI
// control and Research Tree entry points rendered as quiet text rows and
// 22px chips — they read as DATA, not doors, and a player could not tell
// what was tappable. These shared class strings are the restyle: they mirror
// ActionButton's visual language (ember primary, filled accents, rounded-xl,
// the Click Law's press dip `active:scale-[0.98] active:brightness-90`) and
// its size law (min-h-tap = 44px floor, min-h-tap-lg = 48px for primary
// doors) so every restyled control in the Lab is unmistakably a button at a
// glance. Presentation only — handlers, disabled logic and flow are the
// call sites' own, unchanged.

/** The shared skeleton: shape, weight, and the Click Law press feedback. */
export const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all active:scale-[0.98] active:brightness-90";

/** PRIMARY door — the Lab's headline actions (Deploy AI, Begin Study).
 *  48px, filled ember, the strongest treatment on the page. */
export const BTN_PRIMARY =
  `${BTN_BASE} min-h-tap-lg px-5 py-3 text-base bg-ember text-black shadow-[0_2px_14px_rgba(245,176,77,0.35)] hover:brightness-110 disabled:opacity-40`;

/** PRIMARY door, cyan study variant (the Chipset study card). */
export const BTN_PRIMARY_CYAN =
  `${BTN_BASE} min-h-tap-lg px-5 py-3 text-base bg-cyan-400 text-black shadow-[0_2px_14px_rgba(34,211,238,0.30)] hover:bg-cyan-300 disabled:opacity-40`;

/** The Research Tree's begin action (TechNode's Appoint) — filled purple,
 *  44px floor, full width of its node card. */
export const BTN_RESEARCH =
  `${BTN_BASE} min-h-tap w-full px-3 py-2.5 text-sm bg-purple-400 text-black hover:bg-purple-300 disabled:opacity-40`;

/** SECONDARY action — a clear but quieter button: bordered, tinted fill,
 *  44px floor. Accent border/bg/text classes are appended at the call site
 *  (amber Armory, emerald Muster, cyan Satellite/Probe, …). */
export const BTN_SECONDARY =
  `${BTN_BASE} min-h-tap border px-3 py-2.5 text-sm disabled:opacity-40`;

/** The Lab's view-switch doors (Deploy AI / 🌳 Research / 🫂 Leaders) —
 *  the active/inactive fills are appended at the call site. */
export const BTN_TAB =
  `${BTN_BASE} min-h-tap px-4 py-2.5 text-sm`;

/** Modal exits in the Lab's panels (44px — the Exit Law floor). */
export const BTN_CLOSE =
  `${BTN_BASE} min-h-tap px-4 py-2 text-sm border border-white/15 text-gray-300 hover:bg-white/10`;
