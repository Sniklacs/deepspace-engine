// pov-projection.ts — TRUE first-person perspective for the command-ship
// POV (owner 2026-10-12, phase 2).
//
// Phase 1's "command" camera was the top-down renderer with a vertical
// squash — Hans saw through it instantly: "it doesn't look at all like POV,
// it just zooms in on the map." This module is the real thing: a pinhole
// camera hovering ~50ft over the field, looking FORWARD. World points
// project through the camera; near troops are large, far troops shrink to
// the horizon, and the ground plane unprojects for tap-to-move.
//
// World frame (unchanged engine units): x east, y SOUTH (screen-like — the
// defender holds the north belt at low y), z up. The field is 1.5×1.5
// engine units; at 500ft per unit the 50ft hover is 0.10 units.
//
// Pure math only — the renderer (BattleScene) owns the canvas.

/** Feet per engine world unit — the scale the hover height reads in. */
export const POV_FEET_PER_UNIT = 500;
/** The command ship's hover: ~50ft up, in world units. */
export const POV_HOVER_UNITS = 50 / POV_FEET_PER_UNIT; // 0.10
/** Cull / full-fog distance in world units (the field diagonal is ~2.12). */
export const POV_MAX_DEPTH = 2.6;

export interface PovCamera {
  /** Camera ground position (world units). */
  x: number;
  y: number;
  /** Height above the ground plane (world units). */
  h: number;
  /** Heading, radians. 0 = north (−y); positive turns east (right). */
  heading: number;
  /** Pitch DOWN, radians. 0 = level (horizon at screen center). */
  pitch: number;
  /** Vertical field of view, radians. */
  vfov: number;
}

export const POV_DEFAULTS = {
  vfov: 1.0, // ~57° — wide enough to feel present, narrow enough to read
  pitch: 0.21, // ~12° down: field fills the lower 2/3, horizon upper third
  heading: 0,
} as const;

export function createPovCamera(x: number, y: number): PovCamera {
  return {
    x,
    y,
    h: POV_HOVER_UNITS,
    heading: POV_DEFAULTS.heading,
    pitch: POV_DEFAULTS.pitch,
    vfov: POV_DEFAULTS.vfov,
  };
}

/** Focal length in px for a viewport height — the pinhole's scale. */
export function povFocal(viewH: number, vfov: number): number {
  return viewH / 2 / Math.tan(vfov / 2);
}

export interface PovPoint {
  /** Screen position, CSS px. */
  sx: number;
  sy: number;
  /** Forward depth in world units (view-space, post-pitch). */
  depth: number;
  /** Screen px per world unit at this depth — sprite sizing. */
  scale: number;
  /** True when the point is in front of the near plane. */
  visible: boolean;
}

const NEAR = 0.02;

/**
 * Project a world point (wx, wy, wz) to screen. Points behind the camera
 * come back with visible=false and unusable screen coords — never draw
 * them. wz defaults to ground level (0).
 */
export function projectPoint(
  cam: PovCamera,
  viewW: number,
  viewH: number,
  wx: number,
  wy: number,
  wz = 0,
): PovPoint {
  const fx = Math.sin(cam.heading);
  const fy = -Math.cos(cam.heading);
  const rx = Math.cos(cam.heading);
  const ry = Math.sin(cam.heading);
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const dz = wz - cam.h;
  const xc = dx * rx + dy * ry; // lateral (+right)
  const zc = dx * fx + dy * fy; // forward (pre-pitch)
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const depth = zc * cp - dz * sp;
  const up = zc * sp + dz * cp;
  const f = povFocal(viewH, cam.vfov);
  if (depth <= NEAR) {
    return { sx: 0, sy: 0, depth, scale: 0, visible: false };
  }
  return {
    sx: viewW / 2 + (f * xc) / depth,
    sy: viewH / 2 - (f * up) / depth,
    depth,
    scale: f / depth,
    visible: true,
  };
}

/** Screen y of the horizon line for this camera. */
export function horizonY(cam: PovCamera, viewH: number): number {
  const f = povFocal(viewH, cam.vfov);
  return viewH / 2 - f * Math.tan(cam.pitch);
}

/**
 * Inverse of projectPoint for the GROUND plane (wz = 0): the world point
 * under a screen pixel, or null when the pixel is at/above the horizon
 * (the ray never meets the ground). This is how POV taps become move
 * destinations.
 */
export function unprojectToGround(
  cam: PovCamera,
  viewW: number,
  viewH: number,
  sx: number,
  sy: number,
): { x: number; y: number } | null {
  const f = povFocal(viewH, cam.vfov);
  const a = (sx - viewW / 2) / f; // right, per unit depth
  const b = (viewH / 2 - sy) / f; // up, per unit depth
  const fx = Math.sin(cam.heading);
  const fy = -Math.cos(cam.heading);
  const rx = Math.cos(cam.heading);
  const ry = Math.sin(cam.heading);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  // View direction back into world: dir = a·right + b·e_up + 1·e_depth,
  // with e_depth = (f·cos p, −sin p) and e_up = (f·sin p, cos p) in
  // (horizontal-forward, z) terms.
  const dirX = a * rx + (b * sp + cp) * fx;
  const dirY = a * ry + (b * sp + cp) * fy;
  const dirZ = b * cp - sp;
  if (dirZ >= -1e-6) return null; // level or rising ray — no ground hit
  const t = cam.h / -dirZ;
  return { x: cam.x + t * dirX, y: cam.y + t * dirY };
}

/**
 * Atmospheric haze 0..1 for a depth: 0 near, 1 at the fog wall. The ground
 * and sprites fade toward the haze color with this — depth you can feel.
 */
export function hazeFactor(depth: number): number {
  const t = Math.max(0, Math.min(1, (depth - 0.55) / (POV_MAX_DEPTH - 0.55)));
  return t * t * (3 - 2 * t); // smoothstep
}

/**
 * Screen-space size of a ground-plane circle (radius r at wx, wy) — the
 * ellipse radii for unit rings, blast circles and scorch decals drawn ON
 * the ground. rx from the lateral axis, ry from the forward axis (which
 * foreshortens with the grazing angle). Null when off-camera.
 */
export function groundEllipse(
  cam: PovCamera,
  viewW: number,
  viewH: number,
  wx: number,
  wy: number,
  r: number,
): { sx: number; sy: number; rx: number; ry: number; depth: number } | null {
  const c = projectPoint(cam, viewW, viewH, wx, wy, 0);
  if (!c.visible) return null;
  const fx = Math.sin(cam.heading);
  const fy = -Math.cos(cam.heading);
  const rxP = projectPoint(cam, viewW, viewH, wx + Math.cos(cam.heading) * r, wy + Math.sin(cam.heading) * r, 0);
  const ryP = projectPoint(cam, viewW, viewH, wx + fx * r, wy + fy * r, 0);
  const rx = rxP.visible ? Math.abs(rxP.sx - c.sx) : r * c.scale;
  const ry = ryP.visible ? Math.abs(ryP.sy - c.sy) : r * c.scale * 0.3;
  return { sx: c.sx, sy: c.sy, rx: Math.max(1, rx), ry: Math.max(0.6, ry), depth: c.depth };
}
