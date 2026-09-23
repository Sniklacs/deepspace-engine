// ============================================================================
// CIRCUIT TOKENS — the §5 color table single-source
// (design/circuit-fullscreen-page.md §5). The SVG renderer, the legend, and
// the wcag gate ALL import from THIS module — zero hex literals live in the
// page component. ZERO new palette entries: every value below is already V8
// canon (map.ts + visual-pass-1-circuit.md §2), surfaced verbatim.
//
// Race accents are NOT here — identity comes from races.ts
// (--race-<id>-accent/-text tokens); functional meaning from app.css tokens.
// Tier colors are game-global functional (same on all six worlds): depth/risk,
// not identity. Asart gold / Draconian green / Nephilim rust never appear in
// this module (rung-1 §A.3 adjacency guards).
// ============================================================================

/** DEPTH TIERS — contestable rim ground only (map.ts importanceFor → tier).
 *  Tier is computed, never authored: score < 0.40 → T1, 0.40–0.70 → T2,
 *  > 0.70 → T3 (ATLAS_CONFIG.tier). */
export const TIER_COLORS: Record<1 | 2 | 3, string> = {
  1: "#4d7cc7", // T1 pip + fill @ 22% over surf-0 (→ #162238; 4.76:1 — PASS)
  2: "#a78bfa", // T2 (→ #2a2643; 7.31:1 — PASS)
  3: "#fb923c", // T3 (→ #3d271a; 8.79:1 — PASS)
} as const;

/** NODE-KIND fills — the canon map recipes (visual-pass-1-circuit §2.1). */
export const KIND_COLORS: Record<"heart" | "near" | "cradle", string> = {
  heart: "#7f1d1d", // Chorus-heart node + severed traces (label #fdba74 5.94:1 — PASS)
  near: "#18181b", // home-protected node (group opacity 0.6, stroke #3f3f46 1.5px)
  cradle: "#14532d", // The Cradle node (label #fde68a 7.32:1 — PASS)
} as const;

/** TRACE colors — how ground connects (visual-pass-1-circuit §2.2). */
export const TRACE_COLORS: Record<"road" | "roadNear" | "ruin" | "severed", string> = {
  road: "#8f9bb3", // solid 2px @0.55 (near #5b6472 1.5px; ~3.3:1 graphic — UI OK)
  roadNear: "#5b6472", // home-turf lane 1.5px @0.55
  ruin: "#b45309", // dashed 5 5 2px (3.96:1 — UI OK, 3:1 floor)
  severed: "#7f1d1d", // broken stubs, opacity 0.8
} as const;

/** Node labels (canon — 11px min, gated by the zoom tiers, never color alone). */
export const LABEL_COLORS = {
  node: "rgba(226,232,240,0.75)", // all names (15.17:1 on fills — PASS)
  heart: "#fdba74", // heart name (5.94:1 — PASS)
  cradle: "#fde68a", // cradle name (7.32:1 — PASS)
  // §3 label halo ≡ --surf-0 (rung-1 §A.1). A conductor lane (#8f9bb3 @0.55
  // over surf-0 → ≈(82,89,106)) crossing under a glyph drops 11px label text to
  // ≈3.2:1 — below AA. `paint-order: stroke` with this halo fixes the composite
  // at ≈9.1:1 over any underlay (the 15.17:1 figure above is the un-composited
  // label colour). One token, no new hue.
  halo: "#070910",
} as const;

/** Ring / stroke colors per kind (§2.4 layer 3). */
export const RING_COLORS: Record<"heart" | "near" | "cradle" | "rim", string> = {
  heart: "#fb923c", // 3px heart stroke (ember canon)
  near: "#3f3f46", // 1.5px near stroke
  cradle: "#fbbf24", // 1.5px cradle ring
  rim: "rgba(255,255,255,0.35)", // 1.5px contestable rim stroke
} as const;

/** Tier fill opacity (visual-pass-1 §2.1: tier @ 22% composite over surf-0). */
export const TIER_FILL_OPACITY = 0.22;
/** The invisible hit circle radius in viewBox units (the 44px tap floor —
 *  §2.1 rule 4: r26 must never render below a 22px CSS radius). */
export const HIT_RADIUS = 26;
/** The 44px-law floor — hit circle CSS radius never below this. */
export const HIT_FLOOR_PX = 22;
/** Zoom clamp (§2.1 rule 5): multiplier over the fit-capped base scale. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 1.25;

/** Sigils (layer 5) — canon marker colors (map.ts V8 renderer). */
export const SIGIL_COLORS = {
  heartZoneStar: "#fde68a", // the ★ on the heart-zone rim node
  heartSub: "#f97316", // the heart's "THE PRIZE · THE THREAT" sub-label
} as const;

/** Rim fill fallback (a rim node with no importance data must never crash). */
export const RIM_FALLBACK_FILL = "#1e293b";

/** War-phase legend swatches (reserved identities — shape channels only).
 *  No race accent appears here: legend swatches are identity-free kind/tier
 *  meaning (§5 adjacency discipline). The purple/contested swatch is the
 *  neutral holder-accent exemplar; purified gold ≡ --purity, disambiguated
 *  by the ★ shape, never the color alone. */
export const WAR_SWATCH_COLORS = {
  corruptedFill: "rgba(163,173,187,0.18)",
  corruptedRing: "rgba(163,173,187,0.45)",
  contestedFill: "rgba(180,140,255,0.35)",
  contestedRing: "rgba(255,255,255,0.4)",
  purified: "#ffd166",
  purifiedInk: "#11161d",
} as const;

/** §6.3 data contract (future, reserved): server field `presence` in the
 *  warMapView (battle-side §3.6). No client logic yet — the Who's-Here card
 *  renders its empty state until data ships. Never purchasable, never votes.
 */
export interface CircuitPresence {
  count: number;
  top: Array<{ colonyName: string; raceId: string; score: number }>;
}