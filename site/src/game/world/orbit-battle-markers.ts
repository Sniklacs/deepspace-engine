// orbit-battle-markers.ts — ORBIT DUST-CLOUD MARKERS (Phase 2, slice 3).
//
// From Z1 (orbit), every live battle is visible on the planet surface as a
// dust cloud — Hans's most literal ask. Rendering: 2–3 layered radial
// gradients with animated churn via noise-offset drift (NOT sprite-frame
// animation — cheap on canvas). Sizing scales with battle INTENSITY
// (troop count × recent casualty rate), not mere existence: a 5,000-troop
// cross-server invasion is a storm on the surface; a skirmish is a wisp.
// Color: warm/ash for player-vs-Chorus, hotter core + red fringe for PvP.
//
// Data comes from existing engine feeds only (no new schema): the Battle
// entity's committed troops + liveCasualties' ticking view (battle-engine),
// positions via siteGlobePosition for Chorus-site battles (chorus-intel).
// Beyond ~40 concurrent battles the smallest cluster into regional haze
// (the declutterMarkers precedent in globe-layers).
//
// Pure kernel + one canvas draw call. WorldGlobe (canvas) wires the render
// into its frame loop and the tap-to-focus from the returned hit rects.

import { liveCasualties } from "../war/battle-engine";
import { CHORUS_NAME, CHORUS_SITES, type ChorusGradeId } from "../war/chorus-sites";
import { siteGlobePosition } from "../chorus-intel";
import { valueNoise2D } from "../globe-layers";
import type { Battle } from "../war/war-types";

// ---------------------------------------------------------------------------
// Input — the real Battle entity (war-types), type-only. Callers pass
// state.battles straight through; liveCasualties gets the fields it reads
// (casualties, status, startedAt, durationMs, decisions).
// ---------------------------------------------------------------------------

export type OrbitBattleKind = "chorus" | "pvp";

export interface OrbitBattleFeed {
  id: string;
  lat: number;
  lon: number;
  kind: OrbitBattleKind;
  /** 0..1 normalized: troop count × recent casualty rate. */
  intensity: number;
  /** Both sides' committed troops (sizing/debug). */
  troops: number;
}

export interface BattlePosition {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Intensity — troop count × recent casualty rate, from existing engine feeds.
// ---------------------------------------------------------------------------

/** Window for the "recent" casualty rate (the ticking live view). */
export const CASUALTY_RATE_WINDOW_MS = 60_000;

/** Normalization: troop·casualties/sec that reads as a full storm (1.0).
 *  ~5,000 troops trading ~2 casualties/sec. Pure display scaling — the
 *  engine never sees it. */
export const INTENSITY_REFERENCE = 10_000;

/** Recent casualty rate (per second) for a battle: the engine's own ticking
 *  casualties (liveCasualties) differenced over the rate window; falls back
 *  to the battle's mean tick rate when the resolution interval is coarser
 *  than the window. Pure derivation — no new feeds. */
export function casualtyRatePerSec(b: Battle, now: number): number {
  const live = (t: number) =>
    liveCasualties(b, "attacker", t) + liveCasualties(b, "defender", t);
  const recent = Math.max(0, live(now) - live(now - CASUALTY_RATE_WINDOW_MS));
  const recentRate = recent / (CASUALTY_RATE_WINDOW_MS / 1000);
  if (recentRate > 0) return recentRate;
  const finalTotal = b.casualties.attacker + b.casualties.defender;
  const durSec = Math.max(60, b.durationMs / 1000);
  return finalTotal / durSec;
}

/** Normalized intensity 0..1: (troops × casualty rate) / reference. Pure. */
export function battleIntensity(b: Battle, now: number): number {
  const troops = Math.max(0, b.attacker.troops + b.defender.troops);
  if (troops <= 0) return 0;
  const raw = troops * casualtyRatePerSec(b, now);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(1, raw / INTENSITY_REFERENCE);
}

/** Vs-Chorus reads warm/ash; anything else is PvP (red fringe). Pure. */
export function battleKind(b: Battle): OrbitBattleKind {
  return b.attacker.colonyName === CHORUS_NAME || b.defender.colonyName === CHORUS_NAME
    ? "chorus"
    : "pvp";
}

/** Default battle position: Chorus-site battles sit at their site's globe
 *  position (grade cluster + deterministic jitter, via chorus-intel);
 *  anything else resolves null and the caller supplies the fallback
 *  (e.g. the home colony position for home-defense battles). Pure. */
export function defaultBattlePosition(b: Battle): BattlePosition | null {
  if (battleKind(b) !== "chorus") return null;
  const site = CHORUS_SITES.find((s) => s.zoneId === b.zoneId);
  if (!site) return null;
  return siteGlobePosition(b.zoneId, site.grade as ChorusGradeId);
}

// ---------------------------------------------------------------------------
// Feeds — filter, resolve, cluster.
// ---------------------------------------------------------------------------

/** Cap: beyond ~40 concurrent battles the smallest merge into regional
 *  haze (declutterMarkers precedent). */
export const ORBIT_FEED_MAX = 40;

export type BattlePositionResolver = (b: Battle) => BattlePosition | null;

/** One battle → one orbit feed, or null when it shouldn't scorch the
 *  planet (resolved, arena practice bouts, unresolvable position). Pure. */
export function battleFeed(
  b: Battle,
  now: number,
  resolvePosition: BattlePositionResolver = defaultBattlePosition,
): OrbitBattleFeed | null {
  if (b.status !== "active") return null;
  if (b.arena) return null; // practice bouts don't scorch the planet
  const pos = resolvePosition(b);
  if (!pos) return null;
  return {
    id: b.id,
    lat: pos.lat,
    lon: pos.lon,
    kind: battleKind(b),
    intensity: battleIntensity(b, now),
    troops: Math.max(0, b.attacker.troops + b.defender.troops),
  };
}

/** Merge the dimmest feeds past the cap into one regional haze at the
 *  intensity-weighted centroid (longitude averaged on the circle). Pure. */
export function clusterOrbitFeeds(feeds: OrbitBattleFeed[]): OrbitBattleFeed[] {
  if (feeds.length <= ORBIT_FEED_MAX) return feeds;
  const sorted = [...feeds].sort((a, b) => b.intensity - a.intensity);
  const kept = sorted.slice(0, ORBIT_FEED_MAX - 1);
  const rest = sorted.slice(ORBIT_FEED_MAX - 1);
  let wSum = 0;
  let latAcc = 0;
  let sinAcc = 0;
  let cosAcc = 0;
  let troops = 0;
  let intensity = 0;
  let pvp = false;
  for (const f of rest) {
    const w = 0.2 + f.intensity;
    wSum += w;
    latAcc += f.lat * w;
    const rad = (f.lon * Math.PI) / 180;
    sinAcc += Math.sin(rad) * w;
    cosAcc += Math.cos(rad) * w;
    troops += f.troops;
    intensity += f.intensity * 0.5;
    if (f.kind === "pvp") pvp = true;
  }
  kept.push({
    id: "haze:cluster",
    lat: latAcc / wSum,
    lon: (Math.atan2(sinAcc / wSum, cosAcc / wSum) * 180) / Math.PI,
    kind: pvp ? "pvp" : "chorus",
    intensity: Math.min(1, intensity),
    troops,
  });
  return kept;
}

/** All live battles → clustered orbit feeds. Pure. */
export function buildOrbitBattleFeeds(
  battles: Battle[],
  now: number,
  resolvePosition?: BattlePositionResolver,
): OrbitBattleFeed[] {
  const feeds: OrbitBattleFeed[] = [];
  for (const b of battles) {
    const f = battleFeed(b, now, resolvePosition);
    if (f) feeds.push(f);
  }
  return clusterOrbitFeeds(feeds);
}

// ---------------------------------------------------------------------------
// Rendering — volumetric dust via layered gradients + noise churn.
// ---------------------------------------------------------------------------

export interface OrbitMarkerProjection {
  x: number;
  y: number;
  visible: boolean;
}

export interface DrawOrbitMarkersOpts {
  /** Globe radius in px — marker size rides it. */
  globeR: number;
  /** Seconds — drives the churn, never a frame index. */
  time: number;
  /** Overall fade (Z1→Z2 the clouds thin into sigils). */
  alpha?: number;
}

export interface OrbitMarkerHit {
  id: string;
  x: number;
  y: number;
  r: number;
  lat: number;
  lon: number;
}

/** Deterministic per-feed seed from its id (churn phase + noise offsets). */
export function feedSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Draw every feed as a dust cloud in view space over the globe. Returns the
 * screen hit rects so the caller can tap-to-focus a cloud. The churn is
 * noise-offset drift on the gradient centers — no sprite frames, no
 * per-frame allocations beyond the gradients themselves.
 */
export function drawOrbitBattleMarkers(
  g: CanvasRenderingContext2D,
  feeds: OrbitBattleFeed[],
  project: (lat: number, lon: number) => OrbitMarkerProjection,
  opts: DrawOrbitMarkersOpts,
): OrbitMarkerHit[] {
  const hits: OrbitMarkerHit[] = [];
  const baseAlpha = Math.max(0, Math.min(1, opts.alpha ?? 1));
  if (baseAlpha <= 0 || feeds.length === 0) return hits;
  for (const f of feeds) {
    const p = project(f.lat, f.lon);
    if (!p.visible) continue;
    const seed = feedSeed(f.id);
    const si = Math.floor(seed * 1e9);
    // Breathe with the battle: slow pulse + noise churn on the amplitude.
    const churn =
      0.82 +
      0.18 * Math.sin(opts.time * 2.1 + seed * Math.PI * 2) +
      0.12 * (valueNoise2D(si, opts.time * 0.45, 3.7) - 0.5) * 2;
    const vis = Math.sqrt(Math.max(0, Math.min(1, f.intensity)));
    const r = Math.max(
      5,
      Math.min(opts.globeR * 0.14, opts.globeR * (0.022 + 0.06 * vis) * churn),
    );
    // Noise-offset drift on the plume center — the cloud roils.
    const ox = (valueNoise2D(si + 11, opts.time * 0.3, 8.1) - 0.5) * r * 0.45;
    const oy = (valueNoise2D(si + 23, opts.time * 0.3, 2.9) - 0.5) * r * 0.45;
    const cx = p.x + ox;
    const cy = p.y + oy;
    const pvp = f.kind === "pvp";

    g.save();
    g.globalAlpha = baseAlpha;
    // Outer haze — the wide soft skirt.
    let grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    if (pvp) {
      grad.addColorStop(0, "rgba(255,170,130,0.50)");
      grad.addColorStop(0.55, "rgba(214,110,80,0.28)");
      grad.addColorStop(1, "rgba(150,70,60,0)");
    } else {
      grad.addColorStop(0, "rgba(226,206,178,0.46)");
      grad.addColorStop(0.55, "rgba(178,158,138,0.26)");
      grad.addColorStop(1, "rgba(120,110,100,0)");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    // Mid body — denser, offset by the churn so the interior roils.
    grad = g.createRadialGradient(cx - ox * 0.7, cy - oy * 0.7, 0, cx, cy, r * 0.62);
    if (pvp) {
      grad.addColorStop(0, "rgba(255,196,150,0.55)");
      grad.addColorStop(1, "rgba(200,100,70,0)");
    } else {
      grad.addColorStop(0, "rgba(238,224,200,0.52)");
      grad.addColorStop(1, "rgba(160,142,122,0)");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    g.fill();
    // Hot core — the battle's heart.
    grad = g.createRadialGradient(cx + ox * 0.4, cy + oy * 0.4, 0, cx, cy, r * 0.3);
    if (pvp) {
      grad.addColorStop(0, "rgba(255,226,190,0.85)");
      grad.addColorStop(1, "rgba(255,150,110,0)");
    } else {
      grad.addColorStop(0, "rgba(250,240,220,0.8)");
      grad.addColorStop(1, "rgba(220,200,170,0)");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    g.fill();
    // PvP red fringe — the hotter read, per the orbit color language.
    if (pvp) {
      g.strokeStyle = `rgba(239,68,68,${0.5 * (0.7 + 0.3 * Math.sin(opts.time * 3 + seed * 9))})`;
      g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      g.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    hits.push({ id: f.id, x: p.x, y: p.y, r: r * 1.15, lat: f.lat, lon: f.lon });
  }
  return hits;
}
