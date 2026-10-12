// command-console — compact command-console styling (owner 2026-10-12).
//
// Hans: think EVE Online. ALL text stays small and compact — headers are
// bold but the SAME size as body text, no size changes anywhere. Sharp,
// clean, tight, compact. Accent COLOR comes from the cockpit theme
// (Halo green default, player-changeable, race presets) —
// cockpit-theme.ts owns the palette; this file owns the density.
//
// These are OPAQUE windows (solid backgrounds). Text color is themeable:
// tweak the hex values in CMD_THEME to retune readability — every surface
// below reads its colors from these variables.
//
// One scale for every squad-command surface: quick-pick menus, the Enemy
// Forces window, the squad picker, and the radar window.

/**
 * Theme variables — put CMD_THEME on the window root. Tweak the hex values
 * here to retune readability against the opaque background; every command
 * surface inherits automatically. All high-contrast against the dark bg.
 */
export const CMD_THEME =
  "[--cmd-bg:#0b0f16]" + // opaque window background — solid, near-black blue
  " [--cmd-panel:#121722]" + // panel surface — solid dark slate
  " [--cmd-text:#eef1f6]" + // primary text — near-white, high contrast
  " [--cmd-dim:#a9b2c2]" + // secondary text — cool gray, readable
  " [--cmd-faint:#7c8595]" + // metadata — muted but legible
  " [--cmd-accent:#3dff73]" + // cockpit accent — overridden by cockpitAccentStyle(); default Halo green
  " [--cmd-line:rgba(255,255,255,0.14)]"; // hairline borders

export const CMD = {
  /** window/panel container — opaque, solid */
  panel: "gap-1 p-1.5 rounded-md border border-[var(--cmd-line)] bg-[var(--cmd-bg)]",
  /** inner panel surface — opaque, solid */
  surface: "rounded border border-[var(--cmd-line)] bg-[var(--cmd-panel)] p-1.5",
  /** section headers: FIRE CONTROL / MOVE / COVER / HOLD — brassy, bold, SAME size as body */
  section: "mt-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--cmd-accent)] [text-shadow:var(--cmd-accent-glow)]",
  /** row titles: squad names, enemy unit names — bold, body size */
  title: "text-[9px] font-bold text-[var(--cmd-text)]",
  /** body copy: composition, hints — small, tight, dense */
  body: "text-[9px] leading-snug text-[var(--cmd-dim)]",
  /** metadata: morale, headcounts, ranges — delicate but legible */
  meta: "text-[8px] tabular-nums text-[var(--cmd-faint)]",
  /** command buttons — small, dense, opaque */
  btn: "rounded border border-[var(--cmd-line)] bg-[var(--cmd-panel)] px-2 py-1 text-[9px] font-semibold text-[var(--cmd-text)] transition active:scale-[0.97]",
  /** active button state — brassy highlight */
  btnActive: "border-[var(--cmd-accent)] bg-[var(--cmd-accent-dim)] text-[var(--cmd-accent)]",
  /** touch target floor — small, but still tappable */
  btnH: "min-h-[30px] touch-manipulation",
  /** grid gaps inside menus */
  grid: "grid grid-cols-2 gap-1",
} as const;
