// BEACHHEAD PRESENCE — the pure sizing/color law behind the wide
// picture's rendering (design/beachhead-layout-2026-10-15.md §4, owner
// Oct 15 2026: presence at ARENA SCALE — big, lit, carrying the holder's
// identity, never "just a little flag"). BeachheadView's painter consumes
// these numbers; the tests pin them, so a presence mark can never quietly
// shrink back under the floor.
//
// The three zoom bands (zoomRatio = camera scale ÷ fit scale):
//   BAND 1 — THE FRONT (fit → 2×): bunker glyph floor 14px; each side's
//     strongest bunker in a sector raises a sector STANDARD 56–88px.
//   BAND 2 — THE SECTOR (2–6×): every held bunker flies a standard
//     (24–40px); nameplates under every non-empty bunker.
//   BAND 3 — THE POSITION (6–14×): bunkers render as structures,
//     32–48px glyphs.
// THE FLAG BAN (§4.5): no presence mark under 24px at its band's working
// zoom. Size is never a cosmetic reward — cosmetics add light, not
// legibility.

/** Band-1 glyph floor — a bunker never renders smaller than this. */
export const BUNKER_GLYPH_FLOOR_PX = 14;
/** Band-3 glyph ceiling — a bunker never renders bigger than this. */
export const BUNKER_GLYPH_CAP_PX = 48;
/** The flag ban: minimum height of any standard (presence mark). */
export const STANDARD_MIN_PX = 24;
/** Band-1 sector standard height window. */
export const SECTOR_STANDARD_MIN_PX = 56;
export const SECTOR_STANDARD_MAX_PX = 88;

/** Zoom band for a zoom ratio (camera scale ÷ fit scale). */
export function presenceBand(zoomRatio: number): 1 | 2 | 3 {
  if (zoomRatio >= 6) return 3;
  if (zoomRatio >= 2) return 2;
  return 1;
}

/** Bunker glyph size (px) at a zoom ratio: 14px at fit, growing with
 *  the square root of zoom, capped at the Band-3 structure size. */
export function bunkerGlyphSize(zoomRatio: number): number {
  const zr = Math.max(1, zoomRatio);
  return Math.min(BUNKER_GLYPH_CAP_PX, Math.max(BUNKER_GLYPH_FLOOR_PX, BUNKER_GLYPH_FLOOR_PX * Math.sqrt(zr)));
}

/**
 * Standard height (px) for a held bunker.
 * `sectorLeader` = the side's strongest bunker in its sector (Band 1
 * raises the standard only there; Bands 2–3 raise it everywhere held).
 * Returns 0 where no standard flies (Band 1, non-leader).
 */
export function standardHeight(zoomRatio: number, glyphSize: number, sectorLeader: boolean): number {
  const band = presenceBand(zoomRatio);
  if (band === 1) {
    if (!sectorLeader) return 0;
    // 56–88px at fit, easing toward the cap as the camera closes in.
    return Math.min(SECTOR_STANDARD_MAX_PX, Math.max(SECTOR_STANDARD_MIN_PX, glyphSize * 4.4));
  }
  // Bands 2–3: every held bunker flies its standard, 24–40px.
  return Math.min(40, Math.max(STANDARD_MIN_PX, glyphSize * 1.35));
}

/**
 * Radiance halo radius (px) around a standard/glyph. Radiance is LIGHT
 * (§4.2): tier 0 still carries the base presence glow — a held position
 * is lit ground, Chronicle or no Chronicle — and each tier widens and
 * brightens it (tier 3 ≈ 2.5× the standard's footprint).
 */
export function radianceHaloRadius(standardH: number, radianceTier: number | null | undefined): number {
  const tier = Math.max(0, Math.min(3, Math.round(radianceTier ?? 0)));
  const base = Math.max(standardH, BUNKER_GLYPH_FLOOR_PX) * 0.9;
  return base * (1 + tier * 0.5);
}

/** Halo alpha by tier — tier 0 is a whisper, tier 3 is the brightest
 *  thing on the front. */
export function radianceHaloAlpha(radianceTier: number | null | undefined): number {
  const tier = Math.max(0, Math.min(3, Math.round(radianceTier ?? 0)));
  return 0.1 + tier * 0.07;
}

/**
 * Per-holder colors (§4.3): color is demoted from identity to
 * allegiance. The viewer is emerald, the Chorus is rose — everything
 * else derives deterministically from the holder's colony id over a
 * curated palette, so two enemy alliances on one front never share a
 * color by accident of arrival order. Amber stays in the palette as
 * one holder's color among many, no longer everyone's.
 */
export const HOLDER_PALETTE = [
  "#fbbf24", // amber
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#f472b6", // pink
  "#fb923c", // orange
  "#a3e635", // lime
] as const;

export function holderColor(colonyId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < colonyId.length; i++) {
    h ^= colonyId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return HOLDER_PALETTE[Math.abs(h) % HOLDER_PALETTE.length];
}
