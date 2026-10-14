// BATTLE RADAR FEED (owner 2026-10-11) — the shared mutable snapshot the
// BattleScene frame loop writes and the BattleRadar canvas reads.
//
// The scene pushes a unit snapshot at ~4Hz (cheap: a few hundred dots) and
// pings on combat events (kills, shell impacts, hot-drop landings). The
// radar draws them on its own tick — the two never block each other.
// Presentation only: nothing here touches the sim.

export interface RadarDot {
  x: number;
  y: number;
  side: "attacker" | "defender";
  kind: "unit" | "turret";
  alive: boolean;
  /** owning squad (unit dots only) — lets a radar tap select the squad
   *  whose blip was tapped (owner 2026-10-13: the radar is a command
   *  surface, and this id is the selection model the future wide-picture
   *  battlefield screen will command through too). */
  squadId?: string;
}

export interface RadarPing {
  x: number;
  y: number;
  /** wall-clock ms when the ping was posted */
  atMs: number;
  kind: "kill" | "blast" | "shell" | "intel";
}

/** How long a ping stays visible on the radar (ms). */
export const RADAR_PING_TTL_MS = 1500;
/** Cap — a heavy bombardment shouldn't grow this without bound. */
export const RADAR_MAX_PINGS = 40;

interface RadarFeed {
  dots: RadarDot[];
  pings: RadarPing[];
}

/** Module-level singleton — one battle on screen at a time. */
export const radarFeed: RadarFeed = { dots: [], pings: [] };

export interface RadarUnitLike {
  x: number;
  y: number;
  side: string;
  state: string;
  squadId?: string;
}

/** Replace the dot snapshot (called ~4Hz from the scene loop). */
export function pushRadarFrame(
  units: RadarUnitLike[],
  turrets: Array<{ x: number; y: number; side: string; hp01: number }>,
): void {
  const dots: RadarDot[] = [];
  for (const u of units) {
    if (u.state === "staging") continue; // not on the field yet
    dots.push({
      x: u.x,
      y: u.y,
      side: u.side === "attacker" ? "attacker" : "defender",
      kind: "unit",
      alive: u.state !== "dead",
      ...(u.squadId ? { squadId: u.squadId } : {}),
    });
  }
  for (const t of turrets) {
    if (t.hp01 <= 0) continue;
    dots.push({
      x: t.x,
      y: t.y,
      side: t.side === "attacker" ? "attacker" : "defender",
      kind: "turret",
      alive: true,
    });
  }
  radarFeed.dots = dots;
  // prune stale pings while we're here
  const now = Date.now();
  if (radarFeed.pings.length > 0) {
    radarFeed.pings = radarFeed.pings.filter((p) => now - p.atMs < RADAR_PING_TTL_MS);
  }
}

/**
 * RADAR VIEWPORT (owner 2026-10-14: "I just want to fucking scroll in
 * the MAP VIEW"). The expanded battle map pans and zooms: the view is a
 * world-space rect {x0, y0, x1, y1} projected onto the panel's field box.
 * Pure math, unit-tested — the component owns only the gesture state.
 * The full-field view is the identity: the whole 1.5×1.5 world.
 */
export interface RadarView { x0: number; y0: number; x1: number; y1: number }

export const RADAR_VIEW_FULL: RadarView = { x0: 0, y0: 0, x1: 1.5, y1: 1.5 };
/** Tightest zoom: a 0.3-unit window — one stretch of the line. */
export const RADAR_MIN_SPAN = 0.3;
/** Overpan slack: the view may slide a little past the field edge. */
export const RADAR_OVERPAN = 0.3;

export function radarViewSpan(v: RadarView): number {
  return v.x1 - v.x0;
}

function clampView(v: RadarView): RadarView {
  const spanX = Math.min(1.5 + RADAR_OVERPAN * 2, Math.max(RADAR_MIN_SPAN, v.x1 - v.x0));
  const spanY = Math.min(1.5 + RADAR_OVERPAN * 2, Math.max(RADAR_MIN_SPAN, v.y1 - v.y0));
  const cx = Math.min(1.5 + RADAR_OVERPAN, Math.max(-RADAR_OVERPAN, (v.x0 + v.x1) / 2));
  const cy = Math.min(1.5 + RADAR_OVERPAN, Math.max(-RADAR_OVERPAN, (v.y0 + v.y1) / 2));
  return { x0: cx - spanX / 2, x1: cx + spanX / 2, y0: cy - spanY / 2, y1: cy + spanY / 2 };
}

/** Pan by a world-space delta (dragging the map moves the view the other
 *  way — the caller passes content-follow deltas). */
export function panRadarView(v: RadarView, dx: number, dy: number): RadarView {
  return clampView({ x0: v.x0 + dx, x1: v.x1 + dx, y0: v.y0 + dy, y1: v.y1 + dy });
}

/** Zoom by `factor` (<1 zooms in) around a world-space anchor point. */
export function zoomRadarView(v: RadarView, factor: number, ax: number, ay: number): RadarView {
  return clampView({
    x0: ax - (ax - v.x0) * factor,
    x1: ax + (v.x1 - ax) * factor,
    y0: ay - (ay - v.y0) * factor,
    y1: ay + (v.y1 - ay) * factor,
  });
}

/** A view centered on a world point at the given span (center-on). */
export function centerRadarView(x: number, y: number, span: number): RadarView {
  return clampView({ x0: x - span / 2, x1: x + span / 2, y0: y - span / 2, y1: y + span / 2 });
}

/** World point → field-box fraction (0..1 across the box; may exceed
 *  [0,1] when the point is outside the view — the caller clips). */
export function radarWorldToBox(wx: number, wy: number, v: RadarView): { fx: number; fy: number } {
  return { fx: (wx - v.x0) / (v.x1 - v.x0), fy: (wy - v.y0) / (v.y1 - v.y0) };
}

/** Field-box fraction → world point (the exact inverse; tap mapping). */
export function radarBoxToWorld(fx: number, fy: number, v: RadarView): { x: number; y: number } {
  return { x: v.x0 + fx * (v.x1 - v.x0), y: v.y0 + fy * (v.y1 - v.y0) };
}

/** Flash an event ping on the radar (world coords 0..1.5). */
export function radarPing(x: number, y: number, kind: RadarPing["kind"]): void {
  radarFeed.pings.push({ x, y, atMs: Date.now(), kind });
  if (radarFeed.pings.length > RADAR_MAX_PINGS) {
    radarFeed.pings.splice(0, radarFeed.pings.length - RADAR_MAX_PINGS);
  }
}

/** New battle / unmount — drop the snapshot so a stale field never shows. */
export function clearRadarFeed(): void {
  radarFeed.dots = [];
  radarFeed.pings = [];
}
