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
  kind: "kill" | "blast" | "shell";
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
