// system-view.ts — THE SOLAR SYSTEM LAYER (Hans, Oct 6 2026).
//
// "Move the scout probes over to the World page, and make the World page
// back out — hitting minus backs all the way out to the solar system to see
// the other planets, and we send probes from there."
//
// The World page's zoom is now one continuous range: home globe → (zoom
// out) → the solar system, sun at the center and every KNOWN_SERVERS world
// riding an orbit as a planet. Probes launch from this layer: tap a planet,
// send a scout, read what comes back. Fog-of-war is absolute here — a
// planet shows ONLY what a probe reported (plus the public server-select
// facts: name, race, description). There is no free intel and no entering
// any world but home.
//
// This module is the PURE kernel — zoom-band math, deterministic orbit
// layout, per-planet 2D Plus palettes, and the probe-gate state machine.
// WorldGlobe (canvas) only draws what these functions return; PlanetSheet
// only renders what probeGate decides. No I/O, no Date.now() inside.

import { KNOWN_SERVERS, type KnownServer } from "./servers";
import type { RaceId } from "./types";
import type { ScoutProbe, ScoutReport, WorldMapState } from "./worldmap";

// ---------------------------------------------------------------------------
// Zoom band — one continuous range, three reads of the same number.
//
//   scale ≥ SYSTEM_GLOBE_SCALE (0.62)  → the home globe, as it always was
//   scale ≤ SYSTEM_FULL_SCALE  (0.30)  → the solar system, fully present
//   between                            → the back-out blend (continuous)
//
// systemTFromScale is the single source of truth for the blend factor.
// ---------------------------------------------------------------------------

/** Widest zoom (today's globe max). */
export const SCALE_MAX = 3;
/** Deepest zoom-OUT: the full solar system. */
export const SCALE_MIN = 0.16;
/** At/above this scale the view is the globe alone. */
export const SYSTEM_GLOBE_SCALE = 0.62;
/** At/below this scale the solar system is fully present. */
export const SYSTEM_FULL_SCALE = 0.3;

/** Clamp a zoom scale into the one continuous range. Pure. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
}

/**
 * Blend factor for the solar-system layer: 0 = globe only, 1 = full
 * system. Smoothstepped so the back-out accelerates gently off the globe
 * and settles into the system without a pop. Pure.
 */
export function systemTFromScale(scale: number): number {
  const raw =
    (SYSTEM_GLOBE_SCALE - scale) / (SYSTEM_GLOBE_SCALE - SYSTEM_FULL_SCALE);
  const t = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
  return t * t * (3 - 2 * t);
}

/** True when the view is system-dominant (planet taps rule, globe taps don't). */
export function isSystemDominant(scale: number): boolean {
  return systemTFromScale(scale) > 0.6;
}

// ---------------------------------------------------------------------------
// Planets — every known world is a planet; the player's own world is home.
// Palettes carry each race's visual identity (2D Plus: shaded sphere, sun-
// lit rim, atmosphere glow — never a flat cartoon disc).
// ---------------------------------------------------------------------------

export interface PlanetPalette {
  /** Sunlit highlight. */
  core: string;
  /** Mid-tone body. */
  mid: string;
  /** Night-side shade. */
  dark: string;
  /** Rim light + glow color. */
  rim: string;
}

const RACE_PALETTES: Record<RaceId, PlanetPalette> = {
  watchers: { core: "#f6f8ff", mid: "#a9bdf2", dark: "#39487e", rim: "#ffd98a" },
  draconians: { core: "#ffb37a", mid: "#e64a2e", dark: "#571208", rim: "#ff8a5c" },
  grays: { core: "#dbe7f2", mid: "#8fa5bd", dark: "#31435a", rim: "#bcd6ee" },
  nephilim: { core: "#eee2c4", mid: "#a8915f", dark: "#463b28", rim: "#dcc79c" },
  anunnaki: { core: "#7d97e8", mid: "#2f4186", dark: "#121b3e", rim: "#d4af37" },
  ashtar: { core: "#d2fff6", mid: "#57d6c2", dark: "#12565a", rim: "#8ff5e2" },
};

const FALLBACK_PALETTE: PlanetPalette = {
  core: "#e2e8f0", mid: "#64748b", dark: "#1e293b", rim: "#94a3b8",
};

/** A world rendered as a planet in the system view. */
export interface PlanetDef extends KnownServer {
  /** True for the world this deployment IS (the enterable home world). */
  isHome: boolean;
  palette: PlanetPalette;
}

/** Palette for a planet; falls back to slate for unknown races. Pure. */
export function planetPalette(server: KnownServer): PlanetPalette {
  return RACE_PALETTES[server.raceId] ?? FALLBACK_PALETTE;
}

/**
 * All planets for the system view, in stable server order, with the home
 * world flagged. `homeWorldId` is WORLD_CONFIG.worldId. Pure.
 */
export function buildPlanets(
  homeWorldId: string,
  servers: KnownServer[] = KNOWN_SERVERS,
): PlanetDef[] {
  return servers.map((s) => ({
    ...s,
    isHome: s.id === homeWorldId,
    palette: planetPalette(s),
  }));
}

/** One planet by server id (undefined when unknown). Pure. */
export function planetDefById(
  serverId: string,
  homeWorldId: string,
  servers: KnownServer[] = KNOWN_SERVERS,
): PlanetDef | undefined {
  return buildPlanets(homeWorldId, servers).find((p) => p.id === serverId);
}

// ---------------------------------------------------------------------------
// Orbit layout — deterministic: same instant in, same sky out (per the
// seeded-determinism rule for anything a replay might show). Angles are a
// pure function of (serverId, nowMs, phaseOffset): base angle from a
// string hash, Kepler-ish angular speed (inner orbits move faster), and
// the player's drag phase offset. Orbits squash slightly (0.86) so the
// system reads as a tilted plane, not a top-down diagram.
// ---------------------------------------------------------------------------

/** Deterministic 32-bit string hash (stable mock/layout seed). */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Orbit radius as a fraction of maxOrbit for orbit slot `index`. Pure. */
export function orbitRadiusFactor(index: number): number {
  return 0.3 + index * 0.135;
}

/** Screen radius (px) for a planet at orbit slot `index`. Home rides bigger. Pure. */
export function planetScreenRadius(index: number, isHome: boolean, minDim: number): number {
  if (isHome) return Math.max(17, minDim * 0.052);
  return Math.max(10, minDim * (0.028 + index * 0.0035));
}

/** Current orbit angle (radians) for a planet. Pure. */
export function orbitAngle(
  serverId: string,
  index: number,
  nowMs: number,
  phaseOffset: number,
): number {
  const base = (hash32(serverId) % 6283) / 1000; // 0..2π
  const speed = 0.02 / (1 + index * 0.55); // rad/s — inner orbits faster
  return base + (nowMs / 1000) * speed + phaseOffset;
}

export interface PlanetScreenPos {
  serverId: string;
  x: number;
  y: number;
  r: number;
  /** Orbit slot (0 = innermost). */
  index: number;
  orbitFactor: number;
  isHome: boolean;
}

export interface SystemLayoutOpts {
  homeWorldId: string;
  /** System center (the sun) in canvas px. */
  cx: number;
  cy: number;
  /** Outermost orbit radius in px. */
  maxOrbit: number;
  /** min(canvas w, h) — drives planet sizes. */
  minDim: number;
  nowMs: number;
  /** Player drag offset (radians) added to every orbit angle. */
  phaseOffset: number;
  servers?: KnownServer[];
}

/** Screen positions for every planet at an instant. Pure. */
export function planetScreenPositions(opts: SystemLayoutOpts): PlanetScreenPos[] {
  const servers = opts.servers ?? KNOWN_SERVERS;
  return servers.map((s, i) => {
    const factor = orbitRadiusFactor(i);
    const orbitR = opts.maxOrbit * factor;
    const a = orbitAngle(s.id, i, opts.nowMs, opts.phaseOffset);
    const isHome = s.id === opts.homeWorldId;
    return {
      serverId: s.id,
      x: opts.cx + Math.cos(a) * orbitR,
      y: opts.cy + Math.sin(a) * orbitR * 0.86,
      r: planetScreenRadius(i, isHome, opts.minDim),
      index: i,
      orbitFactor: factor,
      isHome,
    };
  });
}

// ---------------------------------------------------------------------------
// Probe gate — the state machine PlanetSheet renders. The ENGINE stays
// authoritative (launchProbe/collectProbe validate again server-side);
// this only decides what the sheet may offer, so no tap is ever a lie.
// Fog-of-war: a foreign planet exposes a report ONLY when one exists.
// ---------------------------------------------------------------------------

export type ProbeGate =
  /** This is the player's own world — no probe needed or possible. */
  | { kind: "home" }
  /** Scout probe research not completed yet. */
  | { kind: "needs-research" }
  /** A probe is already flying to this planet (ready = collect it). */
  | { kind: "enroute"; probe: ScoutProbe; ready: boolean }
  /** No probe en route — launch allowed when probesReady ≥ 1. */
  | {
      kind: "launch";
      probesReady: number;
      report?: ScoutReport;
    };

/** Decide what the planet sheet may offer for `serverId`. Pure. */
export function probeGate(
  wm: WorldMapState | undefined,
  serverId: string,
  homeWorldId: string,
  now: number,
): ProbeGate {
  if (serverId === homeWorldId) return { kind: "home" };
  if (!wm || !wm.scoutTechResearched) return { kind: "needs-research" };
  const enroute = wm.inflight.find(
    (p) => p.targetServerId === serverId && p.status === "inflight",
  );
  if (enroute) {
    return { kind: "enroute", probe: enroute, ready: now >= enroute.returnsAt };
  }
  const gate: Extract<ProbeGate, { kind: "launch" }> = {
    kind: "launch",
    probesReady: wm.probes,
  };
  const report = wm.reports[serverId];
  if (report) gate.report = report;
  return gate;
}

/**
 * What zooming back IN does for the current selection: the home globe is
 * the only enterable world; a foreign selection "approaches" to its sheet
 * (planet + probe intel) instead of pretending we can land there. Pure.
 */
export function zoomInAction(
  selectedServerId: string | null,
  homeWorldId: string,
): "globe" | "approach" {
  if (!selectedServerId || selectedServerId === homeWorldId) return "globe";
  return "approach";
}

/** Compact ETA ("45s", "3m 12s", "2h 05m") for probe countdowns. Pure. */
export function fmtEtaMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}
