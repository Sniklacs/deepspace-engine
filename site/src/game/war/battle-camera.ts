// battle-camera.ts — camera-origin model for the unbounded battle renderer
// (Seamless World Phase 2, slice 7: battle maps, battle side).
//
// The fixed 1.5×1.5 field dies as a MAP EDGE but lives on as the DEPLOYMENT
// ZONE: engine world units are unchanged (no battle-engine.ts math touched,
// no battle constants moved), and the RENDERER gains a camera origin + tile
// offset. Units may be ordered anywhere — the old hard walls
// (0.06..WORLD_W−0.06) are gone; soft clamps replace them.
//
// Also carries the slice-12 LOD gating (zoom band → shapes vs full models)
// so the zoom-band import lives in one place.

import {
  VECTOR_LANES,
  WORLD_CX,
  WORLD_CY,
  WORLD_H,
  WORLD_W,
} from "./battle-scene-model";
import type { ManeuverVector } from "./war-types";
import { bandForScale, type ZoomBand } from "../world/zoom-bands";
import type { ZoomBand as AudioZoomBand } from "../audio/zoom-audio";

// ---------------------------------------------------------------------------
// Deployment zone — the old fixed field, preserved verbatim.
// ---------------------------------------------------------------------------

/** The old WORLD_W/WORLD_H = 1.5, now the DEPLOYMENT ZONE (not the map edge).
 *  The player deploys on the south edge and advances north; the Chorus
 *  holds the north belt. Doctrine unchanged — the map just got bigger
 *  around it. */
export const DEPLOY_W = WORLD_W;
export const DEPLOY_H = WORLD_H;
export const DEPLOY_CX = WORLD_CX;
export const DEPLOY_CY = WORLD_CY;

/** Doctrine vector lanes, resolved relative to the deployment zone.
 *  MAIN/FLANK/REAR/RESERVE keep their world-unit layout — the zone stopped
 *  being "the map" and became "the deployment area"; the lanes didn't move.
 *  Copied (not aliased) so the renderer's lane view can't mutate the sim's. */
export const DOCTRINE_LANES: Record<ManeuverVector, { x: number; spread: number }> = {
  MAIN: { ...VECTOR_LANES.MAIN },
  FLANK_LEFT: { ...VECTOR_LANES.FLANK_LEFT },
  FLANK_RIGHT: { ...VECTOR_LANES.FLANK_RIGHT },
  REAR: { ...VECTOR_LANES.REAR },
  RESERVE: { ...VECTOR_LANES.RESERVE },
};

// ---------------------------------------------------------------------------
// Soft clamps — orders may land beyond the old hard walls.
// ---------------------------------------------------------------------------

/** Maneuver margin beyond the deployment zone (world units). Orders may
 *  land anywhere inside the zone + this margin; the renderer culls past it. */
export const MANEUVER_MARGIN = 0.5;

/** Soft-clamp a world x into the maneuverable area (deployment zone +
 *  margin). Replaces the old hard clampWorldX (0.06..WORLD_W−0.06): a tap
 *  just past the old wall now orders there instead of snapping back. */
export function softClampX(x: number): number {
  return Math.max(-MANEUVER_MARGIN, Math.min(DEPLOY_W + MANEUVER_MARGIN, x));
}

/** Soft-clamp a world y into the maneuverable area.
 *  Replaces the old hard clampWorldY (0.06..WORLD_H−0.06). */
export function softClampY(y: number): number {
  return Math.max(-MANEUVER_MARGIN, Math.min(DEPLOY_H + MANEUVER_MARGIN, y));
}

// ---------------------------------------------------------------------------
// Camera origin — the renderer's coordinate frame.
// ---------------------------------------------------------------------------

/** Camera-origin frame for the unbounded renderer. World units are the
 *  engine's (unchanged); the renderer centers on (ox, oy) and shifts whole
 *  tiles through (tileX, tileY) so the origin never drifts far — tile
 *  streaming rebases it via rebaseOrigin (the view doesn't move a pixel). */
export interface BattleCamera {
  /** Camera origin in world units — the viewport centers on this point. */
  ox: number;
  /** Camera origin in world units — the viewport centers on this point. */
  oy: number;
  /** World→screen scale. */
  zoom: number;
  /** Vertical squash for grazing-angle views (1 = pure overhead). */
  ysq: number;
  /** Screen-space focus height (0.5 = vertically centered). */
  fy: number;
  /** Tile offset in world units — absorbed whole-tile shifts from rebasing. */
  tileX: number;
  /** Tile offset in world units — absorbed whole-tile shifts from rebasing. */
  tileY: number;
}

/** Default camera: centered on the deployment zone, overhead, no offset. */
export function defaultBattleCamera(): BattleCamera {
  return {
    ox: DEPLOY_CX,
    oy: DEPLOY_CY,
    zoom: 1,
    ysq: 1,
    fy: 0.5,
    tileX: 0,
    tileY: 0,
  };
}

/** World units → CSS px. The tile offset rides along with the origin so a
 *  rebase never moves anything on screen. */
export function worldToScreen(
  cam: BattleCamera,
  viewW: number,
  viewH: number,
  x: number,
  y: number,
): { sx: number; sy: number } {
  return {
    sx: (x - cam.ox + cam.tileX) * cam.zoom * viewW + viewW / 2,
    sy: (y - cam.oy + cam.tileY) * cam.zoom * cam.ysq * viewH + viewH * cam.fy,
  };
}

/** CSS px → world units (inverse of worldToScreen). */
export function screenToWorld(
  cam: BattleCamera,
  viewW: number,
  viewH: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: (sx - viewW / 2) / (cam.zoom * viewW) + cam.ox - cam.tileX,
    y: (sy - viewH * cam.fy) / (cam.zoom * cam.ysq * viewH) + cam.oy - cam.tileY,
  };
}

/** Rebase the origin onto the tile grid: ox/oy stay within half a tile of
 *  zero while (tileX, tileY) absorb the shift — worldToScreen output is
 *  identical across the rebase, so tiles can stream without a visual jump.
 *  Pure. */
export function rebaseOrigin(cam: BattleCamera, tileSize: number): BattleCamera {
  if (!(tileSize > 0)) return { ...cam };
  let { ox, oy, tileX, tileY } = cam;
  const half = tileSize / 2;
  // Invariant: (x − ox + tileX) is unchanged, so doffset = dorigin.
  while (ox > half) {
    ox -= tileSize;
    tileX -= tileSize;
  }
  while (ox < -half) {
    ox += tileSize;
    tileX += tileSize;
  }
  while (oy > half) {
    oy -= tileSize;
    tileY -= tileSize;
  }
  while (oy < -half) {
    oy += tileSize;
    tileY += tileSize;
  }
  return { ...cam, ox, oy, tileX, tileY };
}

// ---------------------------------------------------------------------------
// Zoom-band detail LOD (slice 12: Z3 battle overview).
// ---------------------------------------------------------------------------

/** Unit rendering detail for a zoom band. */
export type BattleDetail = "shapes" | "full";

/** Z3 and above (orbit → low altitude) render unit shapes + tracers; only
 *  Z4 renders full models. Command UI stays Z4-only per §5. */
export function detailForBand(band: ZoomBand): BattleDetail {
  return band === "Z4" ? "full" : "shapes";
}

/** Band for the scene's seamless-world continuum scale. Null/undefined =
 *  standalone scene (not embedded in the world) — stays Z4 ground detail,
 *  so today's look is unchanged outside the continuum. */
export function bandForContinuumScale(scale: number | null | undefined): ZoomBand {
  return scale == null || !Number.isFinite(scale) ? "Z4" : bandForScale(scale);
}

/** Zoom band → the battle bus's audio band number (slice 5's real API:
 *  battleSfx.setZoomAudioLevel, 1 = orbit/silent … 4 = ground/full).
 *  Z0 (solar system) has no battle audio — it maps to Z1 (silent), matching
 *  the bus's own clamp. */
export function audioBandFor(band: ZoomBand): AudioZoomBand {
  switch (band) {
    case "Z0":
      return 1;
    case "Z1":
      return 1;
    case "Z2":
      return 2;
    case "Z3":
      return 3;
    case "Z4":
      return 4;
  }
}
