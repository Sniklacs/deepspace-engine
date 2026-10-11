// WorldGlobe — THE WORLD. Hans (Oct 4 2026): "the globe is the world" — the
// main core workstation. An interactive spinnable globe: touch-drag to spin,
// pinch/wheel to zoom, tap a marker for a beautiful detail sheet.
//
// PHASE 1 = LAYOUT (Hans, Oct 4 2026): the globe, layers, markers, legend and
// detail sheets stand on their own, spaced out and beautiful. Wiring markers
// to destinations (enter colony, launch raid, rally defense) is the linking
// pass — action buttons render per Hans's "nothing without a button" rule and
// explain inline that wiring lands next.
//
// Canvas 2D, 2D Plus style, and per Hans's universal rule it POPS: atmosphere
// glow, terminator shading, city lights, glowing pulse markers, starfield.
// Interaction model mirrors StarMap (drag threshold tap-vs-spin, inertia,
// smoothed pinch/wheel zoom).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../game/types";
import {
  buildGlobeMarkers,
  chorusHeartGlobePosition,
  countByLayer,
  currentHomeGlobePosition,
  declutterMarkers,
  DEFAULT_GLOBE_FILTERS,
  GLOBE_LAYERS,
  GLOBE_LAYER_META,
  GLOBE_SITE_TIER_COLOR,
  projectGlobe,
  siteMarkerIcon,
  SITE_TIER_LIST,
  unprojectGlobe,
  type GlobeFilters,
  type GlobeIconId,
  type GlobeLayerId,
  type GlobeMarker,
  type ScreenMarker,
} from "../game/globe-layers";
import { bakeTerrainRegion, bakeWorldTexture } from "../game/world/terrain-field";
import {
  alliedKnownColonies,
  clampHiveCandidate,
  hiveMoveBlockers,
  hiveMoveCost,
  meanAllyDistanceKm,
} from "../game/hive-relocation";
import { racePortrait } from "./HeroCard";
import { useT } from "./i18n/I18n";
import { playClick, playDeselect, playSelect, playWhoosh } from "../game/audio/ui-sounds";
// WS5 — real day/night cycle (GLOBE WAVE 3): player-anchored subsolar point
// + view-space night factor. Pure math lives in ../game/solar.
import {
  anchoredSubsolarPoint,
  nightFactor,
  sunViewVector,
} from "../game/solar";
// SOLAR SYSTEM LAYER (Hans, Oct 6 2026): zooming out past the globe backs
// the World page into the solar system — sun, home planet, the other
// worlds as planets — and probes launch from there. Pure kernel (zoom
// band, deterministic orbits, palettes, probe gate) lives in
// ../game/system-view; this file only draws and hit-tests it.
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import {
  buildPlanets,
  isSystemDominant,
  planetScreenPositions,
  SYSTEM_GLOBE_SCALE,
  systemTFromScale,
  type PlanetPalette,
} from "../game/system-view";
// ZOOM-AXIS (Phase 2, slice 1): the seamless-world zoom continuum — band
// thresholds Z0–Z4, octave math, the sphere→plane morph factor, and the
// extended scale clamp (the axis now runs past the old SCALE_MAX=3 down
// to the ground). Stable pure kernel; other agents import it too.
import {
  BAND_Z2,
  BAND_Z4,
  bandCenter,
  bandForScale,
  clampZoomScale,
  morphTFromScale,
  ZOOM_BAND_LABEL,
  type ZoomBand,
} from "../game/world/zoom-bands";
// FRAME-TIME TELEMETRY (Phase 2, slice 14, spec §9): the world frame loop
// feeds the rolling-window sampler AUTO's rung decisions are driven from.
import { recordFrameTime } from "../game/graphics-quality-telemetry";
// CRADLE ENTRY (Phase 2, slice 10): the tap→focus→hover→descend→inside→
// ascend state machine (spec §10) — pure kernel; this file wires gestures
// and the camera to it. Slice 11's module ids double as the ?module= URL
// param, so they stay URL-safe by contract.
import {
  CRADLE_ENTRY_INITIAL,
  panBreaksHover,
  recoverFromBackground,
  recordSpreadHint,
  shouldShowSpreadHint,
  spreadHintCount,
  syncWithZoom,
  transition,
  type CradleEntryContext,
  type CradleEntryEvent,
  type CradleModuleId,
} from "../game/world/cradle-entry";
import { SceneHeader } from "./SceneHeader";
import { colonyMarkerName } from "../game/worldmap";
// MODULE OVERLAY (Phase 2, slice 11): buildings open as overlays over the
// live world (spec §10) — the canvas never unmounts; the URL syncs via the
// history API (?module=<id>). See ModuleOverlay.tsx for the pattern.
import {
  ModuleOverlay,
  cradleModuleIds,
  cradleModuleLabel,
  readModuleParam,
  withModuleParam,
} from "./ModuleOverlay";
// ORBIT DUST CLOUDS (Phase 2, slice 3): live battles as dust-cloud markers
// on the surface at Z1 — intensity from existing engine feeds, churn via
// noise-offset drift, warm/ash vs-Chorus vs red-fringe PvP.
import {
  buildOrbitBattleFeeds,
  defaultBattlePosition,
  drawOrbitBattleMarkers,
  type OrbitBattleFeed,
  type OrbitMarkerHit,
} from "../game/world/orbit-battle-markers";

/** #rrggbb + alpha → rgba() string for canvas gradients/strokes. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

const LAYER_STORE_KEY = "worldglobe.layers.v1";
const FILTER_STORE_KEY = "worldglobe.filters.v1";
const MIN_DIST_PX = 26;
const TILT_MAX = 55;

type ViewState = { spin: number; tilt: number; scale: number; targetScale: number };

/** Snap-to-site request (owner 2026-10-04): center the globe on (lat, lon).
 *  `nonce` re-triggers the ease even for the same target (fresh tap). */
export type GlobeFocusTarget = { lat: number; lon: number; nonce: number };

/** Spin/tilt that centers (lat, lon) on screen. From projectGlobe's math,
 *  spin = −lon centers the meridian; tilt = lat centers the latitude,
 *  clamped to the drag range. Pure — tested in WorldGlobe.test.ts. */
export function focusViewTarget(lat: number, lon: number): { spin: number; tilt: number } {
  return {
    spin: (((-lon % 360) + 360) % 360),
    tilt: Math.max(-TILT_MAX, Math.min(TILT_MAX, lat)),
  };
}

/** Shortest signed spin delta (degrees) — the ease never takes the long way. */
export function shortestSpinDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

// ---------------------------------------------------------------------------
// WS5 — real day/night terminator (GLOBE WAVE 3). The visible night cap is
// the disk region {z ≥ 0, dot(p, sun) ≤ 0} in view space (x right, y down on
// screen, z toward the viewer — projectGlobe's convention). Its boundary is
// two arcs: the terminator half-circle (z ≥ 0) and the night-side limb arc.
// Sampled into a canvas path; exact for every spin/tilt, no per-pixel cost.
// ---------------------------------------------------------------------------
function traceNightPath(
  ctx: CanvasRenderingContext2D,
  sun: { x: number; y: number; z: number },
  cx: number, cy: number, R: number,
): "none" | "full" | "partial" {
  const sz = sun.z;
  if (sz >= 0.999) return "none"; // sun dead ahead — no night anywhere visible
  if (sz <= -0.999) return "full"; // sun dead behind — the whole disk is night
  const sxy = Math.hypot(sun.x, sun.y); // > 0 here (unit vector)
  // Limb ∩ terminator: the two points with x²+y²=1, z=0, dot(p,sun)=0.
  const qx = -sun.y / sxy, qy = sun.x / sxy; // P1; P2 = −P1
  // Terminator-plane basis: e1 = P1, e2 = normalize(sun × P1).
  let e2x = -sz * qy, e2y = sz * qx, e2z = sun.x * qy - sun.y * qx;
  const e2l = Math.hypot(e2x, e2y, e2z) || 1;
  e2x /= e2l; e2y /= e2l; e2z /= e2l;
  const dir = e2z > 0 ? 1 : -1; // the half-circle with z ≥ 0
  const N = 72;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = dir * (i / N) * Math.PI;
    const px = Math.cos(t) * qx + Math.sin(t) * e2x;
    const py = Math.cos(t) * qy + Math.sin(t) * e2y;
    const sx = cx + px * R, sy = cy + py * R;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  // Limb arc from P2 back to P1 through the night-side midpoint
  // m = −sun.xy/|sun.xy| (the limb point farthest from the sun).
  const TAU = Math.PI * 2;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const n2 = norm(Math.atan2(-qy, -qx)); // P2's angle
  const n1 = norm(Math.atan2(qy, qx));   // P1's angle
  const nm = norm(Math.atan2(-sun.y / sxy, -sun.x / sxy)); // night midpoint
  const ccw = (from: number, to: number) => norm(to - from);
  const d = ccw(n2, nm) < ccw(n2, n1) ? 1 : -1; // direction via the night side
  const total = d === 1 ? ccw(n2, n1) : TAU - ccw(n2, n1);
  const M = 72;
  for (let i = 1; i <= M; i++) {
    const a = n2 + d * (total * i) / M;
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  ctx.closePath();
  return "partial";
}

// Seeded RNG — stable procedural detail across sessions.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Light { lat: number; lon: number }
interface Star { x: number; y: number; r: number; tw: number; ph: number }

// ONE WORLD TEXTURE (Hans Oct 11 2026): no ocean, no stacked blob cutouts —
// the planet is a single continuous landmass baked once from the seeded
// terrain field (game/world/terrain-field.ts). The globe draws patches of
// this one map; the zoom tiles bake their own layers from the same field.
// Same field everywhere → the morph never pops.
const WORLD_TEX_W = 1024;
const WORLD_TEX_H = 512;
/** Patch grid over the texture — one map, drawn as projected patches.
 *  Small enough that the flat-rectangle projection stays honest, drawn at
 *  exactly 1.0x their projected size: oversizing stretches each patch's
 *  content and shifts it, telegraphing every boundary as a hard edge. */
const WORLD_PATCH_COLS = 32;
const WORLD_PATCH_ROWS = 16;
// Offscreen disc for the patch composite (Hans Oct 11 2026): per-patch
// alpha telegraphed the patch grid as block seams. Patches now draw at
// alpha 1 into this disc — same-texture overdraw is invisible — and a
// radial limb mask softens the edge. Recreated when the disc size changes.
let discCanvas: HTMLCanvasElement | null = null;
let discCtx: CanvasRenderingContext2D | null = null;
let discKey = "";
function ensureDiscCtx(diameterPx: number): CanvasRenderingContext2D | null {
  const s = Math.max(2, Math.round(diameterPx));
  const key = `${s}`;
  if (!discCanvas || !discCtx || discKey !== key) {
    discCanvas = document.createElement("canvas");
    discCanvas.width = discCanvas.height = s;
    discCtx = discCanvas.getContext("2d");
    discKey = key;
  }
  return discCtx;
}

let worldTexture: HTMLCanvasElement | null = null;
let worldTextureBaking = false;
/** The world texture, baked off the frame loop on first need. Null until
 *  the bake lands — the render loop holds a land-colored disc meanwhile. */
function ensureWorldTexture(): HTMLCanvasElement | null {
  if (worldTexture) return worldTexture;
  if (!worldTextureBaking) {
    worldTextureBaking = true;
    setTimeout(() => {
      try {
        const baked = bakeWorldTexture(WORLD_TEX_W, WORLD_TEX_H, chorusHeartGlobePosition());
        const c = document.createElement("canvas");
        c.width = WORLD_TEX_W;
        c.height = WORLD_TEX_H;
        c.getContext("2d")!.putImageData(new ImageData(baked.data, baked.width, baked.height), 0, 0);
        worldTexture = c;
        tileDebugStatus.texture = "ready";
      } catch {
        worldTextureBaking = false; // retry next call
      }
    }, 0);
  }
  return worldTexture;
}

const CITY_LIGHTS: Light[] = (() => {
  const rng = mulberry32(777);
  const out: Light[] = [];
  for (let i = 0; i < 110; i++) {
    out.push({ lat: (rng() * 2 - 1) * 60, lon: rng() * 360 - 180 });
  }
  return out;
})();

const STARS: Star[] = (() => {
  const rng = mulberry32(4242);
  const out: Star[] = [];
  for (let i = 0; i < 150; i++) {
    out.push({ x: rng(), y: rng(), r: 0.4 + rng() * 1.3, tw: 0.4 + rng() * 0.6, ph: rng() * Math.PI * 2 });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// WS2 icon sprites (Hans, Oct 4 2026): shape carries meaning, not color.
// One pre-baked offscreen canvas per (kind, color); the render loop blits
// it — no per-frame path drawing (phone performance). Silhouettes are
// deliberately simple: they must read at ~16px on the globe.
// ---------------------------------------------------------------------------

/** Draw one icon glyph centered on `g`, filling a box of side `s`. */
export function drawGlobeIconGlyph(g: CanvasRenderingContext2D, kind: GlobeIconId, s: number) {
  const h = s / 2;
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (kind) {
    case "hut":
      // square + triangle roof
      g.fillRect(-h * 0.55, -h * 0.1, h * 1.1, h * 0.85);
      g.beginPath();
      g.moveTo(-h * 0.8, -h * 0.1);
      g.lineTo(0, -h * 0.85);
      g.lineTo(h * 0.8, -h * 0.1);
      g.closePath();
      g.fill();
      break;
    case "home": {
      // bigger settlement: hut + watchtower + flag (unmistakable, Hans's)
      g.fillRect(-h * 0.85, -h * 0.05, h * 1.1, h * 0.8);
      g.beginPath();
      g.moveTo(-h * 1.05, -h * 0.05);
      g.lineTo(-h * 0.3, -h * 0.7);
      g.lineTo(h * 0.45, -h * 0.05);
      g.closePath();
      g.fill();
      g.fillRect(h * 0.5, -h * 0.95, h * 0.22, h * 1.7);
      g.beginPath();
      g.moveTo(h * 0.72, -h * 0.95);
      g.lineTo(h * 1.25, -h * 0.78);
      g.lineTo(h * 0.72, -h * 0.58);
      g.closePath();
      g.fill();
      break;
    }
    case "husk":
      // broken hut: hut + dark crack
      g.fillRect(-h * 0.55, -h * 0.1, h * 1.1, h * 0.85);
      g.beginPath();
      g.moveTo(-h * 0.8, -h * 0.1);
      g.lineTo(0, -h * 0.85);
      g.lineTo(h * 0.8, -h * 0.1);
      g.closePath();
      g.fill();
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.lineWidth = Math.max(2, s * 0.07);
      g.beginPath();
      g.moveTo(-h * 0.25, -h * 0.8);
      g.lineTo(h * 0.1, -h * 0.2);
      g.lineTo(-h * 0.15, h * 0.35);
      g.lineTo(h * 0.3, h * 0.75);
      g.stroke();
      g.restore();
      break;
    case "raid":
      // crossed swords
      g.lineWidth = Math.max(3, s * 0.13);
      g.beginPath();
      g.moveTo(-h * 0.7, h * 0.7);
      g.lineTo(h * 0.7, -h * 0.7);
      g.moveTo(h * 0.7, h * 0.7);
      g.lineTo(-h * 0.7, -h * 0.7);
      g.stroke();
      break;
    case "chorus":
      // The Chorus sigil: bold ring + three strong spokes + large filled core.
      // Read at ~20px on the globe, so everything here is deliberately
      // chunky — the sigil must be unmistakable, never a dot.
      g.lineWidth = Math.max(3.5, s * 0.14);
      g.beginPath();
      g.arc(0, 0, h * 0.72, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = Math.max(3, s * 0.12);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * h * 0.28, Math.sin(a) * h * 0.28);
        g.lineTo(Math.cos(a) * h * 0.72, Math.sin(a) * h * 0.72);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, h * 0.32, 0, Math.PI * 2);
      g.fill();
      break;
    case "ember":
      // flame teardrop
      g.beginPath();
      g.moveTo(0, -h * 0.9);
      g.quadraticCurveTo(h * 0.65, -h * 0.15, h * 0.42, h * 0.35);
      g.quadraticCurveTo(h * 0.3, h * 0.75, 0, h * 0.75);
      g.quadraticCurveTo(-h * 0.55, h * 0.75, -h * 0.42, h * 0.15);
      g.quadraticCurveTo(-h * 0.35, -h * 0.3, 0, -h * 0.9);
      g.closePath();
      g.fill();
      break;
    case "chipset":
      // square with pins on all four sides
      g.fillRect(-h * 0.45, -h * 0.45, h * 0.9, h * 0.9);
      g.lineWidth = Math.max(2, s * 0.08);
      for (const q of [-0.25, 0, 0.25]) {
        g.beginPath();
        g.moveTo(q * h * 2, -h * 0.45);
        g.lineTo(q * h * 2, -h * 0.85);
        g.moveTo(q * h * 2, h * 0.45);
        g.lineTo(q * h * 2, h * 0.85);
        g.moveTo(-h * 0.45, q * h * 2);
        g.lineTo(-h * 0.85, q * h * 2);
        g.moveTo(h * 0.45, q * h * 2);
        g.lineTo(h * 0.85, q * h * 2);
        g.stroke();
      }
      break;
    case "monument":
      // obelisk plaque on a base
      g.beginPath();
      g.moveTo(-h * 0.3, -h * 0.85);
      g.lineTo(h * 0.3, -h * 0.85);
      g.lineTo(h * 0.2, h * 0.45);
      g.lineTo(-h * 0.2, h * 0.45);
      g.closePath();
      g.fill();
      g.fillRect(-h * 0.5, h * 0.45, h * 1.0, h * 0.3);
      break;
    case "satellite": {
      // Bold dish silhouette built for 16–24px: a thick crescent bowl
      // (annular sector — the dish cup, opening skyward) + a stub mast +
      // a base foot. NO sub-pixel details: the previous pass's thin feed
      // arm (~2px) and feed dot (~1.5px) vanished at blit size and the
      // bowl read as a plain dot. The crescent profile reads as a dish
      // at 16px. Same glyph serves the globe, the orbit riders and the
      // legend row (shape, not color).
      const satCy = -h * 0.12;
      const rOut = h * 0.82;
      const rIn = h * 0.4;
      // bowl — filled annular sector (∪ crescent, opening up)
      g.beginPath();
      g.arc(0, satCy, rOut, Math.PI * 0.06, Math.PI * 0.94, false);
      g.arc(0, satCy, rIn, Math.PI * 0.94, Math.PI * 0.06, true);
      g.closePath();
      g.fill();
      // stub mast + base foot
      g.lineWidth = Math.max(3, s * 0.15);
      g.beginPath();
      g.moveTo(0, satCy + rIn * 0.9);
      g.lineTo(0, h * 0.74);
      g.stroke();
      g.fillRect(-h * 0.27, h * 0.68, h * 0.54, h * 0.15);
      break;
    }
    case "beachhead":
      // banner on a pole — the open invasion mark
      g.lineWidth = Math.max(2.5, s * 0.09);
      g.beginPath();
      g.moveTo(-h * 0.35, h * 0.9);
      g.lineTo(-h * 0.35, -h * 0.9);
      g.stroke();
      g.beginPath();
      g.moveTo(-h * 0.35, -h * 0.9);
      g.lineTo(h * 0.85, -h * 0.55);
      g.lineTo(-h * 0.35, -h * 0.2);
      g.closePath();
      g.fill();
      break;
    case "arena":
      // stadium silhouette for the legend — oval bowl ring + inner field.
      // (The globe itself renders the full stadium sprite, not this glyph.)
      g.lineWidth = Math.max(3, s * 0.16);
      g.beginPath();
      g.ellipse(0, 0, h * 0.85, h * 0.5, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(0, 0, h * 0.5, h * 0.28, 0, 0, Math.PI * 2);
      g.fill();
      break;
  }
}

/** Bake-size overrides: the satellite dish glyph needs a bigger bake so it
 *  reads at 16–24px blits — the standard s=24 bake renders any glyph at
 *  half the blit size, which reduced the dish to a dot. Legend rows use
 *  the same bake (globeIconURL), so they stay in sync automatically. */
const BAKE_SIZE: Partial<Record<GlobeIconId, { under: number; over: number }>> =
  {
    satellite: { under: 40, over: 34 },
  };

/** Bake the (kind, color) sprite: dark outline for contrast + color fill. */
function bakeIconSprite(kind: GlobeIconId, color: string): HTMLCanvasElement {
  const S = 48;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  const { under, over } = BAKE_SIZE[kind] ?? { under: 30, over: 24 };
  // dark underlay → glyph pops on bright terrain and dark ocean alike
  g.fillStyle = "rgba(2,6,14,0.92)";
  g.strokeStyle = "rgba(2,6,14,0.92)";
  drawGlobeIconGlyph(g, kind, under);
  g.fillStyle = color;
  g.strokeStyle = color;
  drawGlobeIconGlyph(g, kind, over);
  return c;
}

const iconCache = new Map<string, HTMLCanvasElement>();
function iconSprite(kind: GlobeIconId, color: string): HTMLCanvasElement {
  const key = `${kind}|${color}`;
  let c = iconCache.get(key);
  if (!c) {
    c = bakeIconSprite(kind, color);
    iconCache.set(key, c);
  }
  return c;
}

/** Same glyph as a data URL for HTML legend rows (same silhouette as the
 *  globe blit). Cached per (kind, color). */
const iconURLCache = new Map<string, string>();
export function globeIconURL(kind: GlobeIconId, color: string): string {
  const key = `${kind}|${color}`;
  let u = iconURLCache.get(key);
  if (!u) {
    u = bakeIconSprite(kind, color).toDataURL();
    iconURLCache.set(key, u);
  }
  return u;
}

// ---------------------------------------------------------------------------
// WS-A stadium (Hans, Oct 4 2026): the arena is NOT a flat icon — it's an
// actual little STADIUM sitting on the globe, ~2–3× icon size, readable at
// small size on phones. Oval ring walls, glowing field, four floodlight
// towers, a beacon beam, and energy dazzle per Hans's art rule
// ("everything pops" — skin, not quickly). One pre-baked offscreen canvas
// per color; the render loop blits it like any other sprite, so phone
// performance is unchanged. 2D sprite = inherently billboarded.
// ---------------------------------------------------------------------------

/** On-globe billboarded size of the arena stadium (px). */
export const ARENA_MARKER_SIZE = { normal: 52, selected: 68 };

function bakeArenaStadiumSprite(color: string): HTMLCanvasElement {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  const u = S / 128; // design units; sprite spans ±64u
  g.lineJoin = "round";
  g.lineCap = "round";

  // --- ground plate: seats the stadium on the globe surface ---
  g.fillStyle = "rgba(2,6,14,0.55)";
  g.beginPath();
  g.ellipse(0, 16 * u, 56 * u, 30 * u, 0, 0, Math.PI * 2);
  g.fill();

  // --- floodlight towers: four pylons behind the bowl, glowing heads ---
  const towers: Array<[number, number]> = [
    [-52 * u, -30 * u],
    [52 * u, -30 * u],
    [-56 * u, 18 * u],
    [56 * u, 18 * u],
  ];
  for (const [tx, ty] of towers) {
    g.strokeStyle = "rgba(226,232,240,0.9)";
    g.lineWidth = Math.max(3, 5 * u);
    g.beginPath();
    g.moveTo(tx, ty + 16 * u);
    g.lineTo(tx, ty - 22 * u);
    g.stroke();
    // head glow — the dazzle
    const hg = g.createRadialGradient(tx, ty - 24 * u, 0, tx, ty - 24 * u, 15 * u);
    hg.addColorStop(0, "#ffffff");
    hg.addColorStop(0.4, color);
    hg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hg;
    g.beginPath();
    g.arc(tx, ty - 24 * u, 15 * u, 0, Math.PI * 2);
    g.fill();
  }

  // --- beacon beam: shoots skyward so the arena reads across the globe ---
  const beam = g.createLinearGradient(0, -62 * u, 0, -10 * u);
  beam.addColorStop(0, color + "00");
  beam.addColorStop(1, color + "88");
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(-10 * u, -10 * u);
  g.lineTo(10 * u, -10 * u);
  g.lineTo(3.5 * u, -60 * u);
  g.lineTo(-3.5 * u, -60 * u);
  g.closePath();
  g.fill();

  // --- bowl: back rim (distant stands) ---
  g.fillStyle = "rgba(100,116,139,0.95)";
  g.beginPath();
  g.ellipse(0, -8 * u, 48 * u, 22 * u, 0, 0, Math.PI * 2);
  g.fill();

  // --- glowing field ---
  const fg = g.createRadialGradient(0, -8 * u, 0, 0, -8 * u, 34 * u);
  fg.addColorStop(0, "#d9f99d");
  fg.addColorStop(0.55, "#4ade80");
  fg.addColorStop(1, "#166534");
  g.fillStyle = fg;
  g.beginPath();
  g.ellipse(0, -8 * u, 36 * u, 16 * u, 0, 0, Math.PI * 2);
  g.fill();

  // --- field energy line — the POP ---
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, 3 * u);
  g.shadowColor = color;
  g.shadowBlur = 10 * u;
  g.beginPath();
  g.ellipse(0, -8 * u, 30 * u, 13 * u, 0, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;

  // --- front wall (near stands): occludes the field's lower half so the
  //     bowl reads 3D instead of flat ---
  g.fillStyle = "#1e293b";
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = Math.max(2, 3 * u);
  g.beginPath();
  g.ellipse(0, 4 * u, 48 * u, 22 * u, 0, 0, Math.PI);
  g.fill();
  g.stroke();

  // --- crowd lights: bright dots along the near rim ---
  g.fillStyle = "rgba(254,240,138,0.95)";
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const sx = Math.cos(a) * 44 * u;
    const sy = 4 * u + Math.sin(a) * 19 * u;
    g.beginPath();
    g.arc(sx, sy, 2.2 * u, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

const arenaSpriteCache = new Map<string, HTMLCanvasElement>();
function arenaSprite(color: string): HTMLCanvasElement {
  const key = `arena|${color}`;
  let c = arenaSpriteCache.get(key);
  if (!c) {
    c = bakeArenaStadiumSprite(color);
    arenaSpriteCache.set(key, c);
  }
  return c;
}
// Glow sprite cache — one radial-gradient canvas per color, reused for every
// marker so the POP stays cheap.
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + "b0");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// (Sprite-per-landmass rendering is gone — Hans Oct 11 2026: one continuous
// land map. The globe draws patches of the single world texture above; the
// tiles below bake their own layers from the same terrain field.)

// ---------------------------------------------------------------------------
// ZOOM-MORPH region tiles (Phase 2, slice 2): the sphere→plane crossfade.
//
// The planar region view is a tile baked from the SAME landmass sprites the
// globe blits (the baked-terrain pattern from game/globe-layers.ts) —
// composited equirectangularly around a quantized focus cell. The frame loop
// crossfades the globe group out and this tile in over morphT (zoom-bands).
// Tiles bake synchronously on first need (a few drawImages of already-baked
// sprites — no elevation resampling); slice 4 moves streaming off-thread.
// Fallback: bake failure → null → the globe keeps drawing. ALWAYS something
// on screen, never a black frame.
// ---------------------------------------------------------------------------

interface TileLevel {
  tilePx: number;
  /** The tile spans ±halfDeg around its cell center. */
  halfDeg: number;
  /** Focus quantization — panning rebakes only at cell crossings. */
  cellDeg: number;
  cacheMax: number;
}
// LOD LEVELS (Hans Oct 11 2026): every level bakes its OWN layer fresh from
// the terrain field at its own px/deg — the JPEG-within-a-JPEG. Level 0
// carries the morph; level 1 takes over at LOW ALT and deeper with ~25
// px/deg of real terrain detail.
const TILE_LEVELS: TileLevel[] = [
  { tilePx: 512, halfDeg: 60, cellDeg: 20, cacheMax: 6 },
  { tilePx: 768, halfDeg: 15, cellDeg: 5, cacheMax: 8 },
];
/** Deep-zoom detail tiles take over at LOW ALT and deeper. */
export const TILE_DETAIL_SCALE = 6;

interface RegionTile {
  key: string;
  canvas: HTMLCanvasElement;
  qLat: number;
  qLon: number;
  /** Bake-space px per degree — the draw path scales by ppdDraw / ppd. */
  ppd: number;
  tilePx: number;
}

let regionTileCache: RegionTile[] = [];

/** Wrap degrees to [-180, 180). Pure. */
export function wrapLon180(lon: number): number {
  let l = lon % 360;
  if (l > 180) l -= 360;
  if (l < -180) l += 360;
  return l;
}

/** The globe point currently screen-centered: tilt IS latitude, and
 *  focusViewTarget's inverse gives longitude from spin. Pure. */
export function focusLatLon(spin: number, tilt: number): { lat: number; lon: number } {
  return { lat: tilt, lon: wrapLon180(-spin) };
}

function regionTileKey(lat: number, lon: number, level: number): { key: string; qLat: number; qLon: number } {
  const cell = TILE_LEVELS[level].cellDeg;
  const qLat = Math.max(-80, Math.min(80, Math.round(lat / cell) * cell));
  const qLon = wrapLon180(Math.round(lon / cell) * cell);
  return { key: `L${level}:${qLat}:${qLon}`, qLat, qLon };
}

function bakeRegionTile(qLat: number, qLon: number, level: number): HTMLCanvasElement {
  const L = TILE_LEVELS[level];
  const ppd = L.tilePx / (L.halfDeg * 2);
  // One continuous landmass: bake this layer fresh from the terrain field
  // at the level's own px/deg — the JPEG-within-a-JPEG. No ocean, no
  // sprites; the corruption field colors the land around the Chorus heart.
  const baked = bakeTerrainRegion(
    L.tilePx, L.tilePx, qLat, qLon, ppd, chorusHeartGlobePosition(),
    level >= 1, // deep layers resolve the fine-grain relief
  );
  const c = document.createElement("canvas");
  c.width = c.height = L.tilePx;
  c.getContext("2d")!.putImageData(new ImageData(baked.data, baked.width, baked.height), 0, 0);
  return c;
}

/** ?tiledebug overlay — remote eyes on the tile pipeline. */
function TileDebugOverlay() {
  const [snap, setSnap] = useState(() => ({ ...tileDebugStatus, cache: "" }));
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.search.includes("tiledebug")) return;
    const id = window.setInterval(() => {
      setSnap({
        ...tileDebugStatus,
        cache: tileDebugStatus.cacheKeys.join(" "),
      });
    }, 600);
    return () => window.clearInterval(id);
  }, []);
  if (typeof window === "undefined" || !window.location.search.includes("tiledebug")) return null;
  return (
    <div
      style={{
        position: "absolute", left: 8, bottom: 8, zIndex: 50,
        background: "rgba(0,0,0,0.82)", color: "#a7f3d0",
        font: "10px/1.5 monospace", padding: "8px 10px", borderRadius: 8,
        maxWidth: "92%", pointerEvents: "none", whiteSpace: "pre-wrap",
      }}
    >
      {`scale ${snap.scale.toFixed(2)} · want L${snap.tileLevel} · served ${snap.served} ${snap.servedKey}\ntexture ${snap.texture} · queued ${snap.queued} · cache [${snap.cache}]\nerr: ${snap.lastError || "—"}`}
    </div>
  );
}

/** Tile pipeline telemetry — surfaced by the ?tiledebug overlay. */
export const tileDebugStatus = {
  scale: 0,
  tileLevel: -1,
  served: "none",
  servedKey: "",
  cacheKeys: [] as string[],
  queued: 0,
  lastError: "",
  texture: "baking",
};

const tileBakeQueued = new Set<string>();
/** The region tile for the focus point — or the best coarser layer while the
 *  requested one bakes. Bakes run off the frame loop (a detail tile is real
 *  field math, ~1s); the globe reads the SAME field, so the screen never
 *  blacks out or pops — the ground just resolves, layer by layer, as you
 *  descend. Small per-level LRU. */
function ensureRegionTile(lat: number, lon: number, level: number): RegionTile | null {
  const L = TILE_LEVELS[level];
  const { key, qLat, qLon } = regionTileKey(lat, lon, level);
  const hit = regionTileCache.find((t) => t.key === key);
  if (hit) {
    regionTileCache = [hit, ...regionTileCache.filter((t) => t !== hit)];
    tileDebugStatus.served = `L${level}-hit`;
    tileDebugStatus.servedKey = key;
    return hit;
  }
  if (!tileBakeQueued.has(key)) {
    tileBakeQueued.add(key);
    tileDebugStatus.queued = tileBakeQueued.size;
    setTimeout(() => {
      try {
        const canvas = bakeRegionTile(qLat, qLon, level);
        const tile: RegionTile = {
          key, canvas, qLat, qLon,
          ppd: L.tilePx / (L.halfDeg * 2), tilePx: L.tilePx,
        };
        regionTileCache = [tile, ...regionTileCache.filter((t) => t.key !== key)].slice(0, L.cacheMax + 6);
        tileDebugStatus.cacheKeys = regionTileCache.map((t) => t.key);
      } catch (err) {
        // Keep serving the coarser layer; retry on the next visit.
        tileDebugStatus.lastError = `L${level} ${key}: ${String(err)}`.slice(0, 160);
      }
      tileBakeQueued.delete(key);
      tileDebugStatus.queued = tileBakeQueued.size;
    }, 0);
  }
  // Progressive: serve the coarser layer stretched while this one bakes.
  // Level 0 → null: the globe (same field) keeps drawing. Never a black frame.
  if (level > 0) return ensureRegionTile(lat, lon, level - 1);
  return null;
}

// Offscreen canvas for the morph composite: while 0 < morphT < 1 the globe
// group (steps 2–11) renders here so its many inner globalAlpha assignments
// survive the fade — the frame loop then blits it at (1 − morphT) over the
// region tile. Reused across frames; recreated on resize.
let morphCanvas: HTMLCanvasElement | null = null;
let morphCtx: CanvasRenderingContext2D | null = null;
let morphCanvasKey = "";

function ensureMorphCtx(w: number, h: number, dpr: number): CanvasRenderingContext2D {
  const key = `${w}x${h}x${dpr}`;
  if (!morphCanvas || !morphCtx || morphCanvasKey !== key) {
    morphCanvas = document.createElement("canvas");
    morphCanvas.width = Math.max(1, Math.round(w * dpr));
    morphCanvas.height = Math.max(1, Math.round(h * dpr));
    morphCtx = morphCanvas.getContext("2d")!;
    morphCanvasKey = key;
  }
  return morphCtx;
}

/** One foreign planet of the solar system, drawn 2D Plus: atmosphere
 *  glow, a sphere lit from the sun's actual direction, sunlit rim. */
function drawSystemPlanet(
  g: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  pal: PlanetPalette,
  sunX: number, sunY: number,
  alpha: number,
) {
  const glow = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.1);
  glow.addColorStop(0, hexA(pal.rim, 0.20 * alpha));
  glow.addColorStop(1, hexA(pal.rim, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x, y, r * 2.1, 0, Math.PI * 2);
  g.fill();
  const dx = sunX - x, dy = sunY - y;
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl;
  const body = g.createRadialGradient(
    x + ux * r * 0.5, y + uy * r * 0.5, r * 0.15,
    x, y, r * 1.12,
  );
  body.addColorStop(0, pal.core);
  body.addColorStop(0.52, pal.mid);
  body.addColorStop(1, pal.dark);
  g.globalAlpha = alpha;
  g.fillStyle = body;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.save();
  g.strokeStyle = hexA(pal.rim, 0.85 * alpha);
  g.lineWidth = Math.max(1, r * 0.07);
  g.shadowBlur = 8;
  g.shadowColor = pal.rim;
  const a0 = Math.atan2(uy, ux);
  g.beginPath();
  g.arc(x, y, r - 0.5, a0 - 1.05, a0 + 1.05);
  g.stroke();
  g.restore();
}

export default function WorldGlobe({
  state,
  now,
  focusTarget,
  onRelocateColony,
  selectedPlanetId,
  onSelectPlanet,
  enterHomeNonce,
}: {
  state: GameState;
  now: number;
  focusTarget?: GlobeFocusTarget;
  /** Hive relocation (owner 2026-10-04, WS-E): called with the picked
   *  lat/lon on confirm. Resolves with an inline error message, or null on
   *  success (Hans's UI rule — the button stays tappable and explains).
   *  Unwired = the sheet says the linking pass lands next. */
  onRelocateColony?: (lat: number, lon: number) => Promise<string | null>;
  /** SOLAR SYSTEM: the selected planet (controlled by the parent, which
   *  renders PlanetSheet). Omit both for an uncontrolled globe. */
  selectedPlanetId?: string | null;
  onSelectPlanet?: (serverId: string | null) => void;
  /** SOLAR SYSTEM: bump the nonce to ease the zoom back into the home
   *  globe (the home planet sheet's "Enter" button). */
  enterHomeNonce?: number;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewState>({ spin: 24, tilt: 14, scale: 1, targetScale: 1 });
  const drag = useRef<{
    x: number; y: number; startX: number; startY: number; moved: boolean;
    lastT: number; velSpin: number; velTilt: number;
  } | null>(null);
  const pinch = useRef<{ d: number } | null>(null);
  const lastInteract = useRef(0);
  const screenPos = useRef(new Map<string, { x: number; y: number; r: number }>());
  const markersRef = useRef<GlobeMarker[]>([]);
  const reduceMotion = useRef(false);
  // ZOOM-MORPH (slice 2): the frame loop's current sphere→plane factor,
  // mirrored here so tap handling knows when the globe markers are gone.
  const morphTRef = useRef(0);
  // ORBIT DUST CLOUDS (slice 3): live-battle feeds + their screen hit
  // rects, refreshed by the frame loop. Same render-time ref pattern as
  // markersRef — the tap handler reads the latest.
  const battleFeedsRef = useRef<OrbitBattleFeed[]>([]);
  const dustHitsRef = useRef<OrbitMarkerHit[]>([]);
  // BAND INDICATOR (Phase 2, slice 14, spec §3): the live zoom band on the
  // ORBIT → GROUND continuum. React state flips only on band change, so the
  // frame loop never re-renders per frame. Display only — never a band menu.
  const [zoomBand, setZoomBand] = useState<ZoomBand>("Z1");
  const zoomBandRef = useRef<ZoomBand>("Z1");
  // WS5 — real day/night cycle (GLOBE WAVE 3): the player-anchored subsolar
  // point, refreshed on a 60s tick + visibility regain (see render loop).
  // homePosRef tracks hive relocation so the phase re-anchors when home moves.
  const sunRef = useRef({ lat: 0, lon: 180 });
  const homePosRef = useRef({ lat: 0, lon: 0 });

  // ---- snap-to-site (owner 2026-10-04): a new focusTarget nonce computes the
  // spin/tilt that centers (lat, lon); the render loop eases to it below.
  // Same render-time ref pattern as markersRef/layersOnRef above.
  const focusAnim = useRef<{ spin: number; tilt: number; nonce: number } | null>(null);
  if (focusTarget && focusTarget.nonce !== focusAnim.current?.nonce) {
    const target = focusViewTarget(focusTarget.lat, focusTarget.lon);
    focusAnim.current = { ...target, nonce: focusTarget.nonce };
  }

  const [layersOn, setLayersOn] = useState<Record<GlobeLayerId, boolean>>(() => {
    const init = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.defaultOn])) as Record<GlobeLayerId, boolean>;
    try {
      const raw = localStorage.getItem(LAYER_STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<GlobeLayerId, boolean>>;
        for (const l of GLOBE_LAYERS) if (typeof saved[l.id] === "boolean") init[l.id] = saved[l.id]!;
      }
    } catch { /* corrupted prefs → defaults */ }
    return init;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);

  // ---- WS7 layer filters (Hans, Oct 4 2026): tier filtering for sites,
  // persisted like the layer toggles. Pure filter logic in globe-layers.ts.
  const [filters, setFilters] = useState<GlobeFilters>(() => {
    const init: GlobeFilters = { siteTiers: { ...DEFAULT_GLOBE_FILTERS.siteTiers } };
    try {
      const raw = localStorage.getItem(FILTER_STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<GlobeFilters>;
        for (const t of SITE_TIER_LIST) {
          if (typeof saved.siteTiers?.[t] === "boolean") init.siteTiers[t] = saved.siteTiers[t]!;
        }
      }
    } catch { /* corrupted prefs → defaults */ }
    return init;
  });
  const toggleTier = useCallback((tier: 1 | 2 | 3) => {
    setFilters((prev) => {
      const next: GlobeFilters = { siteTiers: { ...prev.siteTiers, [tier]: !prev.siteTiers[tier] } };
      try { localStorage.setItem(FILTER_STORE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    playClick();
  }, []);

  // ---- HIVE RELOCATION pick-mode (Hans, Oct 4 2026, WS-E) ----
  // Pick-mode is modal: the globe shows a banner, taps set a candidate
  // point, and the confirmation panel shows distance / war-band response
  // delta / cost before the player commits.
  const [hivePick, setHivePick] = useState(false);
  const [hiveCandidate, setHiveCandidate] = useState<{ lat: number; lon: number } | null>(null);
  const [hiveError, setHiveError] = useState<string | null>(null);
  const [hiveDone, setHiveDone] = useState<string | null>(null);
  const [hiveBusy, setHiveBusy] = useState(false);
  const hivePickRef = useRef(hivePick);
  hivePickRef.current = hivePick;

  /** State-level relocation blockers (cooldown / under attack / party away)
   *  — shown inline on the home sheet, never a dead button. */
  const hiveBlockers = useMemo(() => hiveMoveBlockers(state, now), [state, now]);

  const markers = useMemo(() => {
    const base = buildGlobeMarkers(state, now);
    // The picked hive point rides the globe as a pulsing gold marker while
    // the confirmation panel is open.
    if (hiveCandidate) {
      base.push({
        id: "hive-candidate",
        layer: "home",
        lat: hiveCandidate.lat,
        lon: hiveCandidate.lon,
        label: "Hive point",
        sublabel: "Candidate — confirm below",
        color: "#fbbf24",
        icon: "home",
        priority: 101,
        pulse: true,
        ref: { kind: "home" },
      });
    }
    return base;
  }, [state, now, hiveCandidate]);
  const counts = useMemo(() => countByLayer(markers), [markers]);
  markersRef.current = markers;
  // ORBIT DUST CLOUDS (slice 3): live battles → orbit feeds. Chorus-site
  // battles resolve to their site's globe position; anything else (home
  // defense, PvP) falls back to the home colony position for now.
  const battleFeeds = useMemo(
    () =>
      buildOrbitBattleFeeds(
        state.battles,
        now,
        (b) => defaultBattlePosition(b) ?? currentHomeGlobePosition(state),
      ),
    [state, now],
  );
  battleFeedsRef.current = battleFeeds;
  // WS5: keep the day/night anchor on the CURRENT home position — hive
  // relocation re-anchors the phase on the next sun tick.
  homePosRef.current = currentHomeGlobePosition(state);
  const selected = useMemo(() => markers.find((m) => m.id === selectedId) ?? null, [markers, selectedId]);

  const toggleLayer = useCallback((id: GlobeLayerId) => {
    setLayersOn((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(LAYER_STORE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    playClick();
  }, []);

  // "Tap to enter" (owner 2026-10-04): the legend's home row promises the
  // colony sheet, so tapping it opens the home detail sheet instead of just
  // toggling. The layer is forced visible so the marker is there to see.
  const openHomeSheet = useCallback(() => {
    setLayersOn((prev) => {
      if (prev.home) return prev;
      const next = { ...prev, home: true };
      try { localStorage.setItem(LAYER_STORE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    playSelect();
    setSelectedId("home");
    setLinkHint(null);
  }, []);

  // layersOn/selectedId/filters refs for the render loop (avoid re-subscribing)
  const layersOnRef = useRef(layersOn);
  layersOnRef.current = layersOn;
  const tiersOnRef = useRef(filters.siteTiers);
  tiersOnRef.current = filters.siteTiers;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // ---- SOLAR SYSTEM state (Hans, Oct 6 2026) ----
  // The frame loop reads the freshest GameState (probe flights draw as
  // arcs in the system view) and the selected planet; DOM overlays key
  // off `inSystem`, flipped only when the blend crosses dominance.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [selPlanetInternal, setSelPlanetInternal] = useState<string | null>(null);
  const selectedPlanet = onSelectPlanet ? (selectedPlanetId ?? null) : selPlanetInternal;
  const selectedPlanetRef = useRef<string | null>(null);
  selectedPlanetRef.current = selectedPlanet;
  const selectPlanetRef = useRef<(id: string | null) => void>(() => {});
  selectPlanetRef.current = (id: string | null) => {
    if (onSelectPlanet) onSelectPlanet(id);
    else setSelPlanetInternal(id);
  };
  const planetPosRef = useRef(new Map<string, { x: number; y: number; r: number }>());
  const orbitPhaseRef = useRef(0);
  const sysOpenRef = useRef(false);
  const [inSystem, setInSystem] = useState(false);

  // "Enter <home world>" from the planet sheet: ease the zoom back into
  // the globe. Same render-time nonce pattern as focusTarget.
  const enterAnim = useRef(0);
  if (enterHomeNonce !== undefined && enterHomeNonce !== enterAnim.current) {
    enterAnim.current = enterHomeNonce;
    view.current.targetScale = 1.05;
    lastInteract.current = performance.now();
  }

  // ---- CRADLE ENTRY (Phase 2, slice 10) ----
  // The tap→focus→hover→descend→inside→ascend machine (spec §10). The
  // machine is the decider; the frame loop + gesture handlers feed it
  // events and z-observations. The world canvas never unmounts for any of
  // it — that is the one hard rule of the whole spec.
  const [cradle, setCradle] = useState<CradleEntryContext>(CRADLE_ENTRY_INITIAL);
  const cradleRef = useRef(cradle);
  cradleRef.current = cradle;
  // True while the centering ease belongs to the entry flow (the shared
  // focusAnim also serves dust-cloud + snap-to-site eases — only the
  // cradle's own ease may complete into EASE_DONE).
  const cradleEaseRef = useRef(false);
  // HOVERING hold anchor: pan-away detection measures drift from the
  // centered spin/tilt captured when the ease starts.
  const hoverAnchorRef = useRef<{ spin: number; tilt: number } | null>(null);
  // The one-time "spread to enter" hint pill (max 3 lifetime shows, then
  // never — persisted in localStorage, see cradle-entry.ts).
  const [spreadHint, setSpreadHint] = useState(false);
  // MODULE OVERLAY (slice 11): true while the ?module= URL entry was
  // pushed by us — Close then history.back()s instead of stranding a
  // forward entry, so the back button always means "close the overlay".
  const modulePushedRef = useRef(false);

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    reduceMotion.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(2.5, window.devicePixelRatio || 1);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Native non-passive wheel listener so globe zoom doesn't fight page scroll.
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      lastInteract.current = performance.now();
      const v = view.current;
      const zoomingIn = e.deltaY < 0;
      // CRADLE ENTRY: wheel direction feeds the machine like a pinch
      // (desktop gesture-equivalent of spread / pinch-out).
      const ce = cradleRef.current.entry;
      if (ce === "HOVERING" || ce === "FOCUSING") {
        sendCradleRef.current({ type: zoomingIn ? "SPREAD" : "PINCH_OUT" });
      } else if (!zoomingIn && (ce === "INSIDE" || ce === "DESCENDING")) {
        sendCradleRef.current({ type: "PINCH_OUT" });
      } else if (zoomingIn && ce === "ASCENDING") {
        sendCradleRef.current({ type: "SPREAD" });
      }
      v.targetScale = clampZoomScale(v.targetScale * (e.deltaY < 0 ? 1.12 : 0.89));
    };
    canvas.addEventListener("wheel", wheelHandler, { passive: false });

    // Start baking the single world texture — the frame loop draws patches
    // of it (one land map); it lands a beat after mount, off the frame loop.
    ensureWorldTexture();

    // WS5 — the server's first real clock: refresh the player-anchored
    // subsolar point every 60s and whenever the tab regains visibility
    // (a backgrounded PWA can sit on a stale phase for hours). The frame
    // loop reads sunRef each frame — spin/zoom/tilt stay in sync for free.
    const updateSun = () => {
      sunRef.current = anchoredSubsolarPoint(homePosRef.current.lon, new Date());
    };
    updateSun();
    const sunTimer = window.setInterval(updateSun, 60_000);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      updateSun();
      // CRADLE ENTRY: background/foreground mid-transition → nearest
      // stable band (spec §10: state is recoverable, never stuck).
      const settled = recoverFromBackground(cradleRef.current, view.current.scale);
      if (settled !== cradleRef.current) applyCradleRef.current(settled);
    };
    document.addEventListener("visibilitychange", onVis);

    let raf = 0;
    let last = performance.now();
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      // FRAME-TIME TELEMETRY (slice 14, spec §9): feed the rolling-window
      // sampler AUTO's rung decisions are driven from — one cheap write.
      recordFrameTime(ms - last);
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      const v = view.current;

      // smooth zoom
      v.scale += (v.targetScale - v.scale) * Math.min(1, dt * 8);
      // gentle ambient drift when idle (never while dragging)
      if (!drag.current && !reduceMotion.current && ms - lastInteract.current > 5000) {
        v.spin += dt * 1.6;
      }

      // snap-to-site: ease rotation to the focused target (shortest spin
      // path). Never fights a grab — pan/spin/zoom always win.
      const f = focusAnim.current;
      if (f && !drag.current) {
        const k = Math.min(1, dt * 4);
        v.spin += shortestSpinDelta(v.spin, f.spin) * k;
        v.tilt += (f.tilt - v.tilt) * k;
        lastInteract.current = ms; // keep ambient drift from fighting the ease
        if (Math.abs(shortestSpinDelta(v.spin, f.spin)) < 0.2 && Math.abs(f.tilt - v.tilt) < 0.2) {
          focusAnim.current = null;
          // CRADLE ENTRY: only the entry flow's own ease completes into
          // EASE_DONE (dust-cloud + snap-to-site eases are not ours).
          if (cradleEaseRef.current) {
            cradleEaseRef.current = false;
            sendCradleRef.current({ type: "EASE_DONE" });
          }
        }
      }

      // CRADLE ENTRY (slice 10): the machine follows the camera.
      // HOVERING holds at the Z1/Z2 boundary — the camera parks, waiting
      // for the spread (or the pan-away / pinch-out that cancels it).
      const ceNow = cradleRef.current.entry;
      if (ceNow === "HOVERING") {
        v.targetScale = Math.min(BAND_Z2 + 0.1, Math.max(BAND_Z2 - 0.1, v.targetScale));
      }
      // z-coherence: programmatic zooms (zoom buttons, recenter) move the
      // camera without gestures — the guards keep machine and camera
      // agreeing so nobody strands between bands.
      const synced = syncWithZoom(cradleRef.current, v.scale);
      if (synced !== cradleRef.current) applyCradleRef.current(synced);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      let cx = w / 2, cy = h / 2;
      let R = Math.min(w, h) * 0.40 * v.scale;
      const time = ms / 1000;

      // BAND INDICATOR (slice 14, spec §3): flip React state only when the
      // band actually changes — the frame loop never re-renders per frame.
      const band = bandForScale(v.scale);
      if (band !== zoomBandRef.current) {
        zoomBandRef.current = band;
        setZoomBand(band);
      }

      // SOLAR SYSTEM LAYER (Hans, Oct 6 2026): one continuous zoom — as
      // scale crosses the back-out band, sysT blends 0→1 and the home
      // planet (this very globe) flies to its orbit slot and shrinks
      // while the sun, orbits and the other worlds fade in around it.
      // planetScreenPositions is deterministic per instant (system-view.ts).
      const sysT = systemTFromScale(v.scale);
      const sysPositions = sysT > 0
        ? planetScreenPositions({
            homeWorldId: WORLD_CONFIG_PUBLIC.worldId,
            cx, cy,
            maxOrbit: Math.min(w, h) * 0.47,
            minDim: Math.min(w, h),
            nowMs: Date.now(),
            phaseOffset: orbitPhaseRef.current,
          })
        : [];
      if (sysT > 0) {
        const homePt = sysPositions.find((p) => p.isHome);
        if (homePt) {
          cx += (homePt.x - cx) * sysT;
          cy += (homePt.y - cy) * sysT;
          R += (homePt.r - R) * sysT;
        }
        planetPosRef.current.clear();
        for (const p of sysPositions) {
          planetPosRef.current.set(p.serverId, { x: p.x, y: p.y, r: p.r });
        }
      }
      // DOM overlays key off system dominance; flip only on the crossing.
      // A globe marker sheet has no meaning out here — close it.
      const sysOpen = sysT > 0.55;
      if (sysOpen !== sysOpenRef.current) {
        sysOpenRef.current = sysOpen;
        setInSystem(sysOpen);
        if (sysOpen && selectedIdRef.current) setSelectedId(null);
        // CRADLE ENTRY: the entry flow is a globe-side affair — backing out
        // to the solar system cancels a pending focus/hover. (The z-driven
        // states can't be out here: pinch-out already walked them to FREE.)
        if (sysOpen) {
          const ce = cradleRef.current.entry;
          if (ce === "FOCUSING" || ce === "HOVERING") {
            sendCradleRef.current({ type: "TAP_ELSEWHERE" });
          }
        }
      }
      // WS5 — real day/night: the sun in view space from the cached
      // player-anchored subsolar point. Per-frame so the terminator tracks
      // spin/zoom/tilt exactly; the subsolar point itself ticks every 60s.
      const sun = sunViewVector(sunRef.current.lat, sunRef.current.lon, v.spin, v.tilt);

      // 1 — starfield (parallax drift with spin)
      ctx.fillStyle = "#02040a";
      ctx.fillRect(0, 0, w, h);
      for (const s of STARS) {
        const sx = (((s.x * w - v.spin * 1.5) % w) + w) % w;
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.tw + s.ph));
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = "#cfe4ff";
        ctx.beginPath();
        ctx.arc(sx, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ZOOM-MORPH (Phase 2, slice 2): sphere→plane crossfade over the focus
      // point as z crosses Z1→Z2. morphT 0→1 across the first half-octave
      // of Z2 (zoom-bands). While morphing, the globe group (steps 2–11)
      // renders into a reused offscreen canvas — its many inner
      // globalAlpha assignments can't survive an outer fade, so the frame
      // loop blits it at (1 − morphT) over the planar region tile (baked
      // from the same landmass sprites, first tile LOD). Past the morph
      // the globe group is skipped entirely and the tile IS the world.
      // Fallback: tile bake failure → null → today's direct path at full
      // alpha. ALWAYS something on screen — never a cut, never a black
      // frame.
      const morphT = morphTFromScale(v.scale);
      const focusLL = focusLatLon(v.spin, v.tilt);
      let regionTile: RegionTile | null = null;
      if (morphT > 0) {
        // LOD: the detail tile level takes over at LOW ALT and deeper, so
        // the ground keeps resolving as you descend instead of stretching
        // the morph tile forever.
        const tileLevel = v.scale >= TILE_DETAIL_SCALE ? 1 : 0;
        tileDebugStatus.scale = v.scale;
        tileDebugStatus.tileLevel = tileLevel;
        try {
          regionTile = ensureRegionTile(focusLL.lat, focusLL.lon, tileLevel);
        } catch {
          regionTile = null;
        }
        if (!regionTile) {
          tileDebugStatus.served = "none";
          tileDebugStatus.servedKey = "";
        }
      }
      morphTRef.current = morphT;
      const pastMorph = morphT >= 1 && regionTile !== null;
      const morphing = morphT > 0 && morphT < 1 && regionTile !== null;
      const g: CanvasRenderingContext2D = morphing ? ensureMorphCtx(w, h, dpr) : ctx;
      if (morphing) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
      }
      if (!pastMorph) {
      // 2 — atmosphere glow (behind the sphere)
      const atm = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.32);
      atm.addColorStop(0, "rgba(56,189,248,0.30)");
      atm.addColorStop(0.75, "rgba(56,189,248,0.10)");
      atm.addColorStop(1, "rgba(56,189,248,0)");
      g.fillStyle = atm;
      g.beginPath();
      g.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
      g.fill();

      // 3 — the world disc: ONE continuous landmass (Hans Oct 11 2026 — no
      // ocean, no stacked cutouts). The single world texture, composited as
      // projected patches into an offscreen disc at alpha 1 (same-texture
      // overdraw is invisible), then limb-masked and blitted. Per-patch
      // alpha telegraphed the patch grid as block seams — never again.
      const tex = ensureWorldTexture();
      if (tex) {
        const D = Math.ceil(R * 2);
        const dg = ensureDiscCtx(D);
        if (dg && discCanvas) {
          dg.setTransform(1, 0, 0, 1, 0, 0);
          dg.clearRect(0, 0, D, D);
          dg.fillStyle = "#3d5a3f"; // land-colored base under the patches
          dg.fillRect(0, 0, D, D);
          const cols = WORLD_PATCH_COLS, rows = WORLD_PATCH_ROWS;
          const pw = tex.width / cols, ph = tex.height / rows;
          const patchAng = (360 / cols) * (Math.PI / 180);
          const dc = D / 2;
          for (let r = 0; r < rows; r++) {
            const lat = 90 - (r + 0.5) * (180 / rows);
            for (let c = 0; c < cols; c++) {
              const lon = -180 + (c + 0.5) * (360 / cols);
              const p = projectGlobe(lat, lon, v.spin, v.tilt);
              if (!p.visible) continue;
              // Exactly 1.0x the projected size, width corrected by cos(lat)
              // for uniform texel density. Oversizing stretches content and
              // shifts it, drawing a hard edge at every patch boundary.
              const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
              const sPxW = patchAng * R * cosLat;
              const sPxH = patchAng * R;
              dg.drawImage(
                tex, c * pw, r * ph, pw, ph,
                dc + p.x * R - sPxW / 2,
                dc + p.y * R - sPxH / 2,
                sPxW,
                sPxH,
              );
            }
          }
          // Limb mask — soft planetary edge.
          dg.globalCompositeOperation = "destination-in";
          const mask = dg.createRadialGradient(dc, dc, dc * 0.7, dc, dc, dc);
          mask.addColorStop(0, "rgba(0,0,0,1)");
          mask.addColorStop(0.8, "rgba(0,0,0,1)");
          mask.addColorStop(1, "rgba(0,0,0,0)");
          dg.fillStyle = mask;
          dg.fillRect(0, 0, D, D);
          dg.globalCompositeOperation = "source-over";
          g.drawImage(discCanvas, cx - dc, cy - dc, D, D);
        }
      } else {
        // Texture still baking — land-colored disc holds the frame.
        g.save();
        g.beginPath();
        g.arc(cx, cy, R, 0, Math.PI * 2);
        g.fillStyle = "#3d5a3f";
        g.fill();
        g.restore();
      }

      // 5 — ice caps
      for (const capLat of [78, -78]) {
        const p = projectGlobe(capLat, 0, v.spin, v.tilt);
        if (!p.visible) continue;
        const rPx = (15 * Math.PI) / 180 * R;
        const g2 = g.createRadialGradient(cx + p.x * R, cy + p.y * R, 0, cx + p.x * R, cy + p.y * R, rPx);
        g2.addColorStop(0, `rgba(226,240,250,${0.85 * p.z})`);
        g2.addColorStop(1, "rgba(226,240,250,0)");
        g.fillStyle = g2;
        g.beginPath();
        g.arc(cx + p.x * R, cy + p.y * R, rPx, 0, Math.PI * 2);
        g.fill();
      }

      // 6 — graticule
      g.strokeStyle = "rgba(148,163,184,0.10)";
      g.lineWidth = 1;
      for (let lon = -180; lon < 180; lon += 30) {
        g.beginPath();
        let pen = false;
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = projectGlobe(lat, lon, v.spin, v.tilt);
          if (!p.visible) { pen = false; continue; }
          const x = cx + p.x * R, y = cy + p.y * R;
          if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        g.beginPath();
        let pen = false;
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = projectGlobe(lat, lon, v.spin, v.tilt);
          if (!p.visible) { pen = false; continue; }
          const x = cx + p.x * R, y = cy + p.y * R;
          if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
        }
        g.stroke();
      }

      // 7 — REAL terminator shading (WS5, GLOBE WAVE 3): the night cap is the
      // disk region on the far side of the subsolar point, traced exactly in
      // view space so it survives spin/zoom/tilt. Two fills: a soft twilight
      // band (slightly expanded, low alpha) + the full night (same peak
      // darkness as the old static gradient: rgba(2,6,14,0.55)).
      const nightKind = traceNightPath(g, sun, cx, cy, R);
      if (nightKind === "full") {
        g.fillStyle = "rgba(2,6,14,0.55)";
        g.fillRect(cx - R, cy - R, R * 2, R * 2);
      } else if (nightKind === "partial") {
        g.save();
        g.translate(cx, cy);
        g.scale(1.045, 1.045);
        g.translate(-cx, -cy);
        g.fillStyle = "rgba(2,6,14,0.20)";
        g.fill();
        g.restore();
        g.fillStyle = "rgba(2,6,14,0.55)";
        g.fill();
      }
      g.restore();

      // 8 — city lights, drawn AFTER the night shading so they shine through
      // the dark (WS5). Invisible by day, brighter the deeper the night —
      // the cheap win the night side deserves. Re-clips to the disk.
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.clip();
      g.globalCompositeOperation = "lighter";
      for (const L of CITY_LIGHTS) {
        const p = projectGlobe(L.lat, L.lon, v.spin, v.tilt);
        if (!p.visible) continue;
        const nf = nightFactor(p.x, p.y, p.z, sun.x, sun.y, sun.z);
        if (nf < 0.03) continue;
        g.globalAlpha = 0.25 + 0.75 * nf;
        g.fillStyle = "#fcd34d";
        const s = 1.2 + 1.4 * nf;
        g.fillRect(cx + p.x * R - s / 2, cy + p.y * R - s / 2, s, s);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.restore();

      // 9 — rim light (the POP)
      g.save();
      g.strokeStyle = "rgba(125,211,252,0.55)";
      g.lineWidth = 2.5;
      g.shadowBlur = 14;
      g.shadowColor = "#38bdf8";
      g.beginPath();
      g.arc(cx, cy, R - 1, Math.PI * 0.55, Math.PI * 1.45);
      g.stroke();
      g.restore();

      // 10 — satellite orbit ring (globe furniture — parks once the sky opens)
      if (layersOnRef.current.satellites && sysT < 0.5) {
        g.save();
        g.translate(cx, cy);
        g.rotate(-0.32);
        g.strokeStyle = "rgba(56,189,248,0.25)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(0, 0, R * 1.5, R * 1.5 * 0.36, 0, 0, Math.PI * 2);
        g.stroke();
        for (let i = 0; i < 4; i++) {
          const a = time * 0.12 + (i * Math.PI) / 2;
          const ex = Math.cos(a) * R * 1.5;
          const ey = Math.sin(a) * R * 1.5 * 0.36;
          const blink = 0.5 + 0.5 * Math.sin(time * 3 + i * 2);
          // Zero-dots audit (WS3): orbit riders are SATELLITES — the dish
          // glyph, not plain dots. Same silhouette as the satellites-layer
          // markers and the legend row (shape, not color).
          const satSpr = iconSprite("satellite", "#7dd3fc");
          const satSize = 16;
          g.globalAlpha = 0.5 + 0.5 * blink;
          g.drawImage(satSpr, ex - satSize / 2, ey - satSize / 2, satSize, satSize);
        }
        g.globalAlpha = 1;
        g.restore();
      }

      // 11 — markers
      const projected: ScreenMarker[] = [];
      // WS5: night factor in view space per marker, keyed by marker object
      // (declutter keeps the same references, so this survives it). The
      // markers sit IN the world, so the night side dims them slightly —
      // they stay readable; they're UI. Hit-testing untouched.
      const nightByMarker = new Map<GlobeMarker, number>();
      for (const m of markersRef.current) {
        if (!layersOnRef.current[m.layer]) continue;
        // WS7: tier filter — T1/T2/T3 world-site markers gate independently
        // of the layer toggle.
        if (m.layer === "sites" && m.ref.kind === "site" && !tiersOnRef.current[m.ref.tier]) continue;
        const p = projectGlobe(m.lat, m.lon, v.spin, v.tilt);
        if (!p.visible) continue;
        nightByMarker.set(m, nightFactor(p.x, p.y, p.z, sun.x, sun.y, sun.z));
        projected.push({ marker: m, sx: cx + p.x * R, sy: cy + p.y * R });
      }
      const shown = declutterMarkers(projected, MIN_DIST_PX);
      screenPos.current.clear();
      // SOLAR SYSTEM: globe markers fade as the sky opens and are gone
      // (and untappable — screenPos stays empty) once the system rules.
      const markerVis = sysT <= 0.25 ? 1 : sysT >= 0.8 ? 0 : 1 - (sysT - 0.25) / 0.55;
      for (const s of shown) {
        if (markerVis <= 0) break;
        const m = s.marker;
        const isSel = m.id === selectedIdRef.current;
        const base = isSel ? 15 : 10;
        // WS5: night-side dim (subtle — readability wins).
        g.globalAlpha = (1 - 0.3 * (nightByMarker.get(m) ?? 0)) * markerVis;
        const isSatellite = m.ref.kind === "satellite";
        // Satellite dishes carry their own dark underlay in the baked
        // sprite — the soft glow halo swamped the dish into a plain dot,
        // so satellites skip it (zero-dots rule).
        if (!isSatellite) {
          const spr = glowSprite(m.color);
          const sprSize = base * 3.2;
          g.drawImage(spr, s.sx - sprSize / 2, s.sy - sprSize / 2, sprSize, sprSize);
        }
        // WS2: the marker ICON — shape carries the meaning, not the color.
        // One pre-baked sprite blit; 20px+ hit targets preserved below.
        // WS-A: the arena renders as the full stadium sprite, not a dot-icon.
        const isArena = m.ref.kind === "arena";
        const icon = isArena ? arenaSprite(m.color) : iconSprite(m.icon, m.color);
        const iconSize = isArena
          ? (isSel ? ARENA_MARKER_SIZE.selected : ARENA_MARKER_SIZE.normal)
          : isSatellite
            ? (isSel ? 30 : 24)
            : (isSel ? 26 : 20);
        g.drawImage(icon, s.sx - iconSize / 2, s.sy - iconSize / 2, iconSize, iconSize);
        g.globalAlpha = markerVis; // pulse ring + label fade with the markers
        // pulse ring for raids (and selected)
        if (m.pulse || isSel) {
          const pr = base + 5 + 4 * Math.sin(time * 4);
          g.strokeStyle = m.color + "cc";
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(s.sx, s.sy, Math.max(4, pr), 0, Math.PI * 2);
          g.stroke();
        }
        // CRADLE ENTRY (slice 10): the home marker is the entry door — its
        // touch target is min 44px (spec §10), bigger than the 40px default.
        const hitR = m.id === "home" ? Math.max(22, base + 8) : Math.max(20, base + 8);
        screenPos.current.set(m.id, { x: s.sx, y: s.sy, r: hitR });
        // label pill for the selected marker
        if (isSel) {
          g.font = "600 11px system-ui, sans-serif";
          const tw = g.measureText(m.label).width;
          const px = Math.min(Math.max(s.sx, tw / 2 + 12), w - tw / 2 - 12);
          const py = Math.max(26, s.sy - 34);
          roundRectPath(g, px - tw / 2 - 8, py - 14, tw + 16, 24, 12);
          g.fillStyle = "rgba(2,6,14,0.85)";
          g.fill();
          g.strokeStyle = m.color;
          g.lineWidth = 1;
          g.stroke();
          g.fillStyle = "#fff";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(m.label, px, py - 1);
        }
      }

      // 11b — ORBIT DUST-CLOUD MARKERS (Phase 2, slice 3): live battles as
      // dust clouds on the surface at Z1. View-space, over the globe, under
      // nothing — they ARE the orbit read. Intensity from existing engine
      // feeds; churn via noise-offset drift (no sprite frames). They thin
      // as the sphere→plane morph runs (alpha → 0 by morphT 0.5) and are
      // gone past it — the Z2 sigils take over in a later slice.
      if (morphT < 0.5) {
        dustHitsRef.current = drawOrbitBattleMarkers(
          g,
          battleFeedsRef.current,
          (lat, lon) => {
            const p = projectGlobe(lat, lon, v.spin, v.tilt);
            return p.visible
              ? { x: cx + p.x * R, y: cy + p.y * R, visible: true }
              : { x: 0, y: 0, visible: false };
          },
          { globeR: R, time, alpha: 1 - morphT * 2 },
        );
      } else {
        dustHitsRef.current = [];
      }
      } // end if (!pastMorph) — the globe group is skipped past the morph

      // ZOOM-MORPH composite (slice 2): the planar region tile under the
      // fading globe. Tile alpha = morphT; the offscreen globe group blits
      // at (1 − morphT) over it. At morphT = 0 regionTile is null and this
      // block never runs — today's path is untouched. The starfield behind
      // stays put, so there is never an empty or black frame.
      if (regionTile) {
        const ppdDraw = R / 90; // screen px per degree at the focus point
        const s = ppdDraw / regionTile.ppd;
        const size = regionTile.tilePx * s;
        const cosLat = Math.cos((focusLL.lat * Math.PI) / 180);
        const dLon = wrapLon180(regionTile.qLon - focusLL.lon);
        const tcx = cx + dLon * cosLat * ppdDraw;
        const tcy = cy + (regionTile.qLat - focusLL.lat) * ppdDraw;
        ctx.save();
        ctx.globalAlpha = morphT >= 1 ? 1 : morphT;
        ctx.drawImage(regionTile.canvas, tcx - size / 2, tcy - size / 2, size, size);
        ctx.restore();
        if (morphing && morphCanvas) {
          ctx.save();
          ctx.globalAlpha = 1 - morphT;
          ctx.drawImage(morphCanvas, 0, 0, w, h);
          ctx.restore();
        }
      }

      // 12 — SOLAR SYSTEM layer (Hans, Oct 6 2026): sun, orbit rings,
      // foreign planets, probe flights. Alpha = sysT throughout, so the
      // sky cross-fades in as you back out. Labels declutter like the
      // globe's: names ride only when the system is mostly present; the
      // selected planet always speaks. The home globe itself was drawn
      // above (steps 2–11) at its interpolated orbit position.
      if (sysT > 0.001) {
        const sunX = w / 2, sunY = h / 2;
        const maxOrbitPx = Math.min(w, h) * 0.47;
        const defById = new Map(
          buildPlanets(WORLD_CONFIG_PUBLIC.worldId).map((d) => [d.id, d]),
        );
        const selId = selectedPlanetRef.current;

        // Orbit rings (home's ring runs warm).
        ctx.save();
        for (const p of sysPositions) {
          ctx.strokeStyle = p.isHome
            ? `rgba(251,191,36,${0.32 * sysT})`
            : `rgba(148,163,184,${0.15 * sysT})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(
            sunX, sunY,
            p.orbitFactor * maxOrbitPx, p.orbitFactor * maxOrbitPx * 0.86,
            0, 0, Math.PI * 2,
          );
          ctx.stroke();
        }
        ctx.restore();

        // The sun — layered light, gentle pulse. Core, corona, halo:
        // never a flat yellow circle.
        const sunR = Math.min(w, h) * 0.045 * (1 + 0.03 * Math.sin(time * 0.8));
        const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 5.2);
        halo.addColorStop(0, `rgba(255,214,120,${0.50 * sysT})`);
        halo.addColorStop(0.35, `rgba(255,160,60,${0.15 * sysT})`);
        halo.addColorStop(1, "rgba(255,140,40,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 5.2, 0, Math.PI * 2);
        ctx.fill();
        const corona = ctx.createRadialGradient(
          sunX - sunR * 0.2, sunY - sunR * 0.2, sunR * 0.1, sunX, sunY, sunR * 1.7,
        );
        corona.addColorStop(0, `rgba(255,246,214,${0.95 * sysT})`);
        corona.addColorStop(0.55, `rgba(255,196,86,${0.72 * sysT})`);
        corona.addColorStop(1, `rgba(255,140,40,${0.22 * sysT})`);
        ctx.fillStyle = corona;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,252,240,${sysT})`;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 0.72, 0, Math.PI * 2);
        ctx.fill();

        // Probe flights — dashed arcs from home to their target, a lit
        // dot riding the curve; at the target it pulses until collected.
        const homePos = sysPositions.find((p) => p.isHome);
        const flights = stateRef.current.worldMap?.inflight ?? [];
        if (homePos) {
          for (const pr of flights) {
            if (pr.status !== "inflight") continue;
            const tp = sysPositions.find((p) => p.serverId === pr.targetServerId);
            if (!tp) continue;
            const span = Math.max(1, pr.returnsAt - pr.launchedAt);
            const prog = Math.min(1, Math.max(0, (Date.now() - pr.launchedAt) / span));
            const mx = (homePos.x + tp.x) / 2, my = (homePos.y + tp.y) / 2;
            const ox = mx - sunX, oy = my - sunY;
            const ol = Math.hypot(ox, oy) || 1;
            const bow = Math.hypot(tp.x - homePos.x, tp.y - homePos.y) * 0.22;
            const qx = mx + (ox / ol) * bow, qy = my + (oy / ol) * bow;
            ctx.save();
            ctx.strokeStyle = `rgba(103,232,249,${0.6 * sysT})`;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 5]);
            ctx.beginPath();
            ctx.moveTo(homePos.x, homePos.y);
            ctx.quadraticCurveTo(qx, qy, tp.x, tp.y);
            ctx.stroke();
            ctx.setLineDash([]);
            const u = 1 - prog;
            const ix = u * u * homePos.x + 2 * u * prog * qx + prog * prog * tp.x;
            const iy = u * u * homePos.y + 2 * u * prog * qy + prog * prog * tp.y;
            const pulse = prog >= 1 ? 1 + 0.35 * Math.sin(time * 5) : 1;
            ctx.fillStyle = `rgba(165,243,252,${sysT})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = "#22d3ee";
            ctx.beginPath();
            ctx.arc(ix, iy, 2.6 * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        // Foreign planets + selection rings + labels.
        ctx.textAlign = "center";
        for (const p of sysPositions) {
          const def = defById.get(p.serverId);
          if (!def) continue;
          const selected = p.serverId === selId;
          if (!p.isHome) {
            drawSystemPlanet(ctx, p.x, p.y, p.r, def.palette, sunX, sunY, sysT);
          }
          if (selected) {
            ctx.strokeStyle = hexA(def.palette.rim, 0.9 * sysT);
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r + 6 + 2 * Math.sin(time * 4), 0, Math.PI * 2);
            ctx.stroke();
          }
          if (sysT > 0.55 || selected) {
            const fs = Math.max(10, Math.min(13, p.r * 0.62));
            ctx.font = `600 ${fs}px system-ui, sans-serif`;
            ctx.textBaseline = "top";
            ctx.fillStyle = `rgba(255,255,255,${(selected ? 1 : 0.85) * sysT})`;
            ctx.fillText(def.name, p.x, p.y + p.r + 5);
            if (p.isHome) {
              ctx.font = `700 ${Math.max(8, fs - 2.5)}px system-ui, sans-serif`;
              ctx.textBaseline = "bottom";
              ctx.fillStyle = `rgba(251,191,36,${0.95 * sysT})`;
              ctx.fillText("⌂ HOME", p.x, p.y - p.r - 4);
            }
          }
        }
        ctx.textBaseline = "alphabetic";
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(sunTimer); // WS5
      document.removeEventListener("visibilitychange", onVis); // WS5
      canvas.removeEventListener("wheel", wheelHandler);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- HIVE RELOCATION flow (Hans, Oct 4 2026, WS-E) ----
  /** Tap coords → globe lat/lon under the current view. Null when the tap
   *  misses the sphere (beyond the limb). */
  const tapToGlobe = useCallback((clientX: number, clientY: number): { lat: number; lon: number } | null => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const v = view.current;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const R = Math.min(w, h) * 0.40 * v.scale; // same R the render loop uses
    const sx = (clientX - rect.left - w / 2) / R;
    const sy = (clientY - rect.top - h / 2) / R;
    const g = unprojectGlobe(sx, sy, v.spin, v.tilt);
    return g ? clampHiveCandidate(g) : null;
  }, []);

  /** "Relocate to hive" from the home sheet → pick-mode. Blockers are shown
   *  inline per Hans's UI rule — the button never just sits dead. */
  const startHivePick = useCallback(() => {
    setHiveDone(null);
    // Blocked: the first blocker is already shown inline under the button —
    // the tap is acknowledged, never dead.
    if (hiveBlockers.length > 0) {
      playClick();
      return;
    }
    setHiveCandidate(null);
    setHiveError(null);
    setSelectedId(null);
    setLinkHint(null);
    setHivePick(true);
    playSelect();
  }, [hiveBlockers]);

  const cancelHivePick = useCallback(() => {
    setHivePick(false);
    setHiveCandidate(null);
    setHiveError(null);
    setHiveBusy(false);
    playDeselect();
  }, []);

  /** Confirm: the server re-validates everything (cooldown, raids, distance,
   *  cost) — the panel's numbers are the estimate, the fn is the truth. */
  const confirmHiveMove = useCallback(async () => {
    if (!hiveCandidate || hiveBusy) return;
    if (!onRelocateColony) {
      setHiveError(
        t("worldglobe.hiveUnwired", "Relocation isn't wired up yet — the server side lands in the linking pass."),
      );
      return;
    }
    setHiveBusy(true);
    setHiveError(null);
    try {
      const err = await onRelocateColony(hiveCandidate.lat, hiveCandidate.lon);
      if (err) {
        setHiveError(err);
      } else {
        setHivePick(false);
        setHiveCandidate(null);
        setHiveDone(
          t("worldglobe.hiveDone", "Your colony is on the move — the hive point is set. Welcome home."),
        );
      }
    } catch {
      setHiveError(t("worldglobe.hiveFailed", "The relocation didn't go through — try again."));
    } finally {
      setHiveBusy(false);
    }
  }, [hiveCandidate, hiveBusy, onRelocateColony, t]);

  // ---- interaction ----
  const hitTest = useCallback((x: number, y: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = x - rect.left, ly = y - rect.top;
    // highest priority first
    const entries = [...screenPos.current.entries()].sort((a, b) => {
      const ma = markersRef.current.find((m) => m.id === a[0]);
      const mb = markersRef.current.find((m) => m.id === b[0]);
      return (mb?.priority ?? 0) - (ma?.priority ?? 0);
    });
    for (const [id, p] of entries) {
      const dx = lx - p.x, dy = ly - p.y;
      if (dx * dx + dy * dy <= p.r * p.r) return id;
    }
    return null;
  }, []);

  /** ORBIT DUST CLOUDS (slice 3) tap target: nearest live-battle cloud
   *  within its churn radius (+ thumb slack). Hit rects refresh every
   *  frame from the render loop. */
  const hitTestDust = useCallback((x: number, y: number): OrbitMarkerHit | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = x - rect.left, ly = y - rect.top;
    let best: OrbitMarkerHit | null = null;
    let bestD = Infinity;
    for (const hit of dustHitsRef.current) {
      const rr = Math.max(22, hit.r + 6);
      const d = (lx - hit.x) * (lx - hit.x) + (ly - hit.y) * (ly - hit.y);
      if (d <= rr * rr && d < bestD) {
        best = hit;
        bestD = d;
      }
    }
    return best;
  }, []);

  /** SOLAR SYSTEM tap target: nearest planet within its disc (+ thumb
   *  slack). Positions refresh every frame from the render loop. */
  const hitTestPlanet = useCallback((x: number, y: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = x - rect.left, ly = y - rect.top;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, p] of planetPosRef.current) {
      const rr = Math.max(22, p.r + 6);
      const d = (lx - p.x) * (lx - p.x) + (ly - p.y) * (ly - p.y);
      if (d <= rr * rr && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    lastInteract.current = performance.now();
    drag.current = {
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      moved: false, lastT: performance.now(), velSpin: 0, velTilt: 0,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    if (!d.moved) return;
    lastInteract.current = performance.now();
    const v = view.current;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    // SOLAR SYSTEM: dragging out here swings the orbits themselves.
    if (isSystemDominant(v.scale)) {
      orbitPhaseRef.current += dx * 0.0021;
      d.x = e.clientX;
      d.y = e.clientY;
      d.lastT = now;
      return;
    }
    // PINCH ZOOM (Hans Oct 11 2026): while a two-finger pinch is active, the
    // per-pointer events must not spin the globe or feed fling velocity —
    // the fingers move in opposite directions and each one was injecting
    // spin, so the globe spun crazily after every pinch. Keep the anchor
    // synced so there's no jump when the pinch releases.
    if (pinch.current) {
      d.x = e.clientX; d.y = e.clientY; d.lastT = now;
      return;
    }
    // FLAT MAP MODE (Hans Oct 11 2026): at LOW ALT and deeper the spinning
    // globe is gone — the view is a 2D scrollable map. Dragging pans it 1:1
    // with the finger (standard map scroll); the spin interaction and its
    // fling do not exist down here. The camera stays (spin, tilt) under the
    // hood, so crossing the boundary is seamless — only the mapping changes.
    if (v.scale >= TILE_DETAIL_SCALE) {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) {
        const Rflat = Math.min(Math.max(1, rect.width), Math.max(1, rect.height)) * 0.4 * v.scale;
        const ppd = Rflat / 90; // screen px per degree at the focus point
        const cosLat = Math.max(0.2, Math.cos((v.tilt * Math.PI) / 180));
        v.spin += dx / (cosLat * ppd);
        v.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, v.tilt - dy / ppd));
      }
      d.velSpin = 0;
      d.velTilt = 0;
    } else {
      // DEEP-ZOOM DRAG DAMPING (Hans Oct 11 2026): approaching the ground the
      // same finger travel covers far fewer degrees on screen, so raw
      // dx-driven spin felt hyper-sensitive and kept flinging. Damp the
      // spin/tilt — and the fling velocity built from them — on the way down.
      const zoomDamp = Math.max(0.12, Math.min(1, 2.5 / v.scale));
      const dSpin = dx * 0.22 * zoomDamp;
      const dTilt = dy * 0.15 * zoomDamp;
      v.spin += dSpin;
      v.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, v.tilt + dTilt));
      d.velSpin = d.velSpin * 0.8 + (dSpin / dt) * 1000 * 0.2;
      d.velTilt = d.velTilt * 0.8 + (dTilt / dt) * 1000 * 0.2;
    }
    // CRADLE ENTRY: a real drag during FOCUSING cancels the centering ease;
    // during HOVERING, drifting off the hover anchor past the threshold pans
    // away (→ FREE). A committed DESCENDING is never cancelled by a pan.
    const ce = cradleRef.current.entry;
    if (ce === "FOCUSING") {
      sendCradleRef.current({ type: "PAN_AWAY" });
    } else if (ce === "HOVERING") {
      const a = hoverAnchorRef.current;
      if (a && panBreaksHover(a.spin, a.tilt, v.spin, v.tilt)) {
        sendCradleRef.current({ type: "PAN_AWAY" });
      }
    }
    d.x = e.clientX;
    d.y = e.clientY;
    d.lastT = now;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    lastInteract.current = performance.now();
    if (!d.moved) {
      // HIVE PICK-MODE: any tap on the globe sets the candidate point —
      // markers aren't selectable while the banner is up.
      if (hivePickRef.current) {
        const pt = tapToGlobe(e.clientX, e.clientY);
        if (pt) {
          playSelect();
          setHiveCandidate(pt);
          setHiveError(null);
        }
        return;
      }
      // SOLAR SYSTEM: out here, taps choose planets — never globe markers.
      if (isSystemDominant(view.current.scale)) {
        const pid = hitTestPlanet(e.clientX, e.clientY);
        if (pid && pid !== selectedPlanetRef.current) {
          playSelect();
          selectPlanetRef.current(pid);
        } else {
          playDeselect();
          selectPlanetRef.current(null);
        }
        return;
      }
      // ORBIT DUST CLOUDS (slice 3): at Z1, tapping a live battle's dust
      // cloud sets a focus target and eases z toward Z3. The globe's own
      // focus ease (focusViewTarget + shortestSpinDelta — the snap-to-site
      // flow) centers it; the smoothed targetScale ease descends. The ease
      // math already exists — reused, not rewritten.
      if (bandForScale(view.current.scale) === "Z1") {
        const cloud = hitTestDust(e.clientX, e.clientY);
        if (cloud) {
          // CRADLE ENTRY: choosing a battle cancels a pending Cradle focus.
          const ceDust = cradleRef.current.entry;
          if (ceDust === "FOCUSING" || ceDust === "HOVERING") {
            sendCradleRef.current({ type: "TAP_ELSEWHERE" });
          }
          playSelect();
          const v = view.current;
          const target = focusViewTarget(cloud.lat, cloud.lon);
          focusAnim.current = { ...target, nonce: (focusAnim.current?.nonce ?? 0) + 1 };
          v.targetScale = clampZoomScale(bandCenter("Z3"));
          return;
        }
      }
      // ZOOM-MORPH (slice 2): past the morph the globe markers have faded
      // out with the sphere — taps find no sheet targets up here (region
      // interactions land in later slices).
      if (morphTRef.current > 0.5) return;
      const id = hitTest(e.clientX, e.clientY);
      // CRADLE ENTRY (slice 10): tapping the Cradle's home-layer marker
      // starts the tap→focus→hover→descend chain (spec §10). The Z1 detail
      // sheet still opens — it is the fallback path for players who never
      // spread; the gesture is the fast path. The existing
      // GlobeFocusTarget/focusViewTarget ease does the centering — reused,
      // not rewritten.
      if (id === "home") {
        const ceHome = cradleRef.current.entry;
        if (ceHome === "FREE" || ceHome === "FOCUSING" || ceHome === "HOVERING") {          const home = markersRef.current.find((m) => m.id === "home");
          if (home) {
            const target = focusViewTarget(home.lat, home.lon);
            focusAnim.current = { ...target, nonce: (focusAnim.current?.nonce ?? 0) + 1 };
            cradleEaseRef.current = true;
            hoverAnchorRef.current = { spin: target.spin, tilt: target.tilt };
            playSelect();
            setSelectedId("home");
            setLinkHint(null);
            sendCradleRef.current({ type: "TAP_CRADLE" });
            // HOVERING → DESCENDING via the marker tap: the tap is the
            // enter gesture's button-equivalent here — drive z; the
            // z-guard lands INSIDE when the camera arrives.
            if (cradleRef.current.entry === "DESCENDING") {
              view.current.targetScale = BAND_Z4;
              lastInteract.current = performance.now();
            }
            return;
          }
        }
        // Committed to the flow (DESCENDING/INSIDE/ASCENDING): the home
        // marker is not a sheet target right now — swallow the tap.
        return;
      } else {
        // Tapping anything (or nothing) else abandons a pending focus/hover.
        const ceOther = cradleRef.current.entry;
        if (ceOther === "FOCUSING" || ceOther === "HOVERING") {
          sendCradleRef.current({ type: "TAP_ELSEWHERE" });
        }
      }
      if (id) {
        if (id === selectedIdRef.current) {
          playDeselect();
          setSelectedId(null);
        } else {
          playSelect();
          setSelectedId(id);
        }
        setLinkHint(null);
      } else if (selectedIdRef.current) {
        playDeselect();
        setSelectedId(null);
        setLinkHint(null);
      }
      return;
    }
    // fling → inertia (the globe only — the system view keeps its sky, and
    // the flat map stops with the finger: no spin-up fling down there)
    if (isSystemDominant(view.current.scale)) return;
    if (view.current.scale >= TILE_DETAIL_SCALE) return;
    if (Math.abs(d.velSpin) > 30 || Math.abs(d.velTilt) > 30) playWhoosh();
    let vs = d.velSpin, vt = d.velTilt;
    const tick = () => {
      if (drag.current) return;
      vs *= 0.94;
      vt *= 0.94;
      if (Math.abs(vs) < 2 && Math.abs(vt) < 2) return;
      const v = view.current;
      v.spin += (vs * 16) / 1000;
      v.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, v.tilt + (vt * 16) / 1000));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [hitTest, hitTestDust, hitTestPlanet, tapToGlobe]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lastInteract.current = performance.now();
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.current) {
        const v = view.current;
        const zoomingIn = d > pinch.current.d;
        // CRADLE ENTRY: pinch direction feeds the machine (spread = toward
        // the ground, pinch-out = away); the targetScale math below keeps
        // driving z continuously either way.
        const ce = cradleRef.current.entry;
        if (ce === "HOVERING" || ce === "FOCUSING") {
          sendCradleRef.current({ type: zoomingIn ? "SPREAD" : "PINCH_OUT" });
        } else if (!zoomingIn && (ce === "INSIDE" || ce === "DESCENDING")) {
          sendCradleRef.current({ type: "PINCH_OUT" });
        } else if (zoomingIn && ce === "ASCENDING") {
          sendCradleRef.current({ type: "SPREAD" });
        }
        v.targetScale = clampZoomScale(v.targetScale * (d / pinch.current.d));
      }
      pinch.current = { d };
    }
  }, []);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  const zoomBy = useCallback((f: number) => {
    lastInteract.current = performance.now();
    const v = view.current;
    // CRADLE ENTRY: the zoom buttons are gesture-equivalents — + is a
    // spread, − is a pinch-out (spec §10: every gesture has a button).
    const ce = cradleRef.current.entry;
    if (f > 1 && (ce === "HOVERING" || ce === "FOCUSING" || ce === "ASCENDING")) {
      sendCradleRef.current({ type: "SPREAD" });
    } else if (f < 1 && ce !== "FREE") {
      sendCradleRef.current({ type: "PINCH_OUT" });
    }
    // Deeper steps inside the back-out band, so a few minus taps cross
    // from globe to solar system (and a few plus taps dive back).
    const eff = f < 1 && v.targetScale <= SYSTEM_GLOBE_SCALE ? 0.66
      : f > 1 && v.targetScale < SYSTEM_GLOBE_SCALE ? 1.5
      : f;
    v.targetScale = clampZoomScale(v.targetScale * eff);
    playClick();
  }, []);

  const recenter = useCallback(() => {
    lastInteract.current = performance.now();
    const v = view.current;
    // CRADLE ENTRY: recentering abandons the entry flow — walk the machine
    // out through its own transitions first, so the z-guards never fight
    // the camera on the way home.
    const ce = cradleRef.current.entry;
    if (ce === "FOCUSING" || ce === "HOVERING") {
      sendCradleRef.current({ type: "TAP_ELSEWHERE" });
    } else if (ce !== "FREE") {
      sendCradleRef.current({ type: "PINCH_OUT" });
    }
    v.spin = 24;
    v.tilt = 14;
    v.targetScale = 1;
    playClick();
  }, []);

  /** "Center on home" (slice 14, spec §3 gesture≡button audit): the
   *  button-equivalent of tapping the home marker — a pure camera focus
   *  ease. It never touches the cradle-entry machine (a no-op while the
   *  machine is running — the Enter/Leave buttons own the camera there). */
  const centerOnHome = useCallback(() => {
    if (cradleRef.current.entry !== "FREE") return;
    const home = markersRef.current.find((m) => m.id === "home");
    if (!home) return;
    const target = focusViewTarget(home.lat, home.lon);
    focusAnim.current = { ...target, nonce: (focusAnim.current?.nonce ?? 0) + 1 };
    playSelect();
  }, []);

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    setLinkHint(null);
    playDeselect();
  }, []);

  const soonHint = useCallback((label: string) => {
    setLinkHint(
      t("worldglobe.linkingSoon", "{label} wires up in the linking pass — this is the layout preview.", { label }),
    );
    playClick();
  }, [t]);

  // ---- CRADLE ENTRY plumbing (slice 10) ----
  /** The single funnel for entry-flow state: applies a machine transition
   *  plus its side effects (hint pill, sheet lifecycle). The machine itself
   *  stays pure — this is where the component reacts to it. */
  const applyCradleNext = useCallback((next: CradleEntryContext) => {
    const prev = cradleRef.current;
    if (next === prev) return;
    cradleRef.current = next;
    setCradle(next);
    // FOCUSING → FREE abandons the centering ease (it belongs to the flow).
    if (prev.entry === "FOCUSING" && next.entry === "FREE") {
      focusAnim.current = null;
      cradleEaseRef.current = false;
    }
    // The one-time "spread to enter" hint: entering HOVERING, max 3
    // lifetime shows, then never (Hans: no tutorial needed).
    if (next.entry === "HOVERING" && prev.entry !== "HOVERING") {
      try {
        if (shouldShowSpreadHint(spreadHintCount(localStorage))) {
          recordSpreadHint(localStorage);
          setSpreadHint(true);
        }
      } catch {
        /* private mode — no hint, no crash */
      }
    } else if (next.entry !== "HOVERING") {
      setSpreadHint(false);
    }
    // The Z1 detail sheet is the fallback path — once the descent is
    // committed (or we're inside), it has no meaning; close it.
    if (
      (next.entry === "DESCENDING" || next.entry === "INSIDE") &&
      selectedIdRef.current === "home"
    ) {
      setSelectedId(null);
    }
    // MODULE OVERLAY (slice 11): the open module mirrors to the URL as
    // ?module=<id> via the history API — the router is never involved, so
    // the canvas (and the route) never unmounts. Opening pushes exactly
    // one entry (back button = close); switching modules replaces; the
    // sync is idempotent so forward-navigation re-opens never double-push.
    if (next.module !== prev.module) {
      try {
        const want = next.module;
        const have = readModuleParam(window.location.href);
        if (want !== have) {
          const url = withModuleParam(window.location.href, want);
          if (!want) {
            // Closed without the back button (camera left the ground, or a
            // direct dispatch) — strip the param without adding history.
            window.history.replaceState(null, "", url);
          } else if (prev.module) {
            window.history.replaceState({ module: want }, "", url);
          } else {
            window.history.pushState({ module: want }, "", url);
            modulePushedRef.current = true;
          }
        }
        if (!want) modulePushedRef.current = false;
      } catch {
        /* history API unavailable — the overlay still works, the URL just
           doesn't mirror (private mode / odd embeds) */
      }
    }
  }, []);

  const sendCradleEvent = useCallback(
    (event: CradleEntryEvent) => {
      applyCradleNext(transition(cradleRef.current, event));
    },
    [applyCradleNext],
  );
  // Render-time ref mirrors (the frame loop + native wheel handler run
  // outside React's render cycle — same pattern as selectPlanetRef).
  const sendCradleRef = useRef(sendCradleEvent);
  sendCradleRef.current = sendCradleEvent;
  const applyCradleRef = useRef(applyCradleNext);
  applyCradleRef.current = applyCradleNext;

  /** "Enter Cradle" — the button-equivalent of the tap→spread gesture chain
   *  (spec §10: every gesture transition has a button equivalent). Each tap
   *  advances the machine one step, exactly like the gesture does. */
  const enterCradle = useCallback(() => {
    const prevEntry = cradleRef.current.entry;
    if (prevEntry === "FREE") {
      // Button-equivalent of tapping the home marker: the home layer must
      // be visible, then the existing focus ease centers it (not rewritten).
      const home = markersRef.current.find((m) => m.id === "home");
      if (!home) return;
      setLayersOn((pl) => {
        if (pl.home) return pl;
        const nx = { ...pl, home: true };
        try {
          localStorage.setItem(LAYER_STORE_KEY, JSON.stringify(nx));
        } catch {
          /* private mode */
        }
        return nx;
      });
      const target = focusViewTarget(home.lat, home.lon);
      focusAnim.current = { ...target, nonce: (focusAnim.current?.nonce ?? 0) + 1 };
      cradleEaseRef.current = true;
      hoverAnchorRef.current = { spin: target.spin, tilt: target.tilt };
      playSelect();
      sendCradleEvent({ type: "TAP_CRADLE" });
      return;
    }
    playSelect();
    sendCradleEvent({ type: "TAP_CRADLE" });
    // HOVERING → DESCENDING: drive z; the z-guard lands INSIDE on arrival.
    if (cradleRef.current.entry === "DESCENDING") {
      view.current.targetScale = BAND_Z4;
      lastInteract.current = performance.now();
    }
  }, [sendCradleEvent]);

  /** "Leave" — the button-equivalent of pinch-out (spec §10). The camera
   *  pulls back out; the z-guard walks the machine home to FREE. */
  const leaveCradle = useCallback(() => {
    playDeselect();
    sendCradleEvent({ type: "PINCH_OUT" });
    if (cradleRef.current.entry !== "FREE") {
      view.current.targetScale = 1;
      lastInteract.current = performance.now();
    }
  }, [sendCradleEvent]);

  // ---- MODULE OVERLAY (Phase 2, slice 11) ----
  /** Tap a building inside INSIDE → its module opens as an overlay over the
   *  live world (spec §10). The URL mirrors via ?module= (push on open,
   *  replace on switch — see applyCradleNext); the canvas never unmounts. */
  const openModule = useCallback(
    (id: CradleModuleId) => {
      playSelect();
      sendCradleEvent({ type: "ENTER_MODULE", module: id });
    },
    [sendCradleEvent],
  );

  /** Close the module overlay. When the ?module= entry is ours, the back
   *  stack pops it — the popstate handler then closes the overlay, so the
   *  browser back button and this button always agree. */
  const closeModule = useCallback(() => {
    playDeselect();
    if (modulePushedRef.current) {
      modulePushedRef.current = false;
      try {
        window.history.back();
        return;
      } catch {
        /* fall through to the direct close */
      }
    }
    sendCradleEvent({ type: "CLOSE_MODULE" });
  }, [sendCradleEvent]);

  // Back/forward-button sanity for the overlay: the URL is the truth on
  // popstate — back with no ?module= closes, forward with one re-opens
  // (only while INSIDE; a stale param anywhere else is inert and stripped).
  // Unmounting the world view never leaves a stale ?module= behind.
  useEffect(() => {
    const onPopState = () => {
      const m = readModuleParam(window.location.href);
      const cur = cradleRef.current;
      if (!m && cur.module) {
        modulePushedRef.current = false;
        applyCradleRef.current(transition(cur, { type: "CLOSE_MODULE" }));
      } else if (m && !cur.module && cur.entry === "INSIDE") {
        applyCradleRef.current(transition(cur, { type: "ENTER_MODULE", module: m }));
      } else if (m && cur.entry !== "INSIDE" && !cur.module) {
        try {
          window.history.replaceState(null, "", withModuleParam(window.location.href, null));
        } catch {
          /* noop */
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      try {
        if (readModuleParam(window.location.href)) {
          window.history.replaceState(null, "", withModuleParam(window.location.href, null));
        }
      } catch {
        /* noop */
      }
    };
  }, []);


  return (
    <section aria-label={t("worldglobe.title", "The World")} className="relative">
      <div
        ref={wrapRef}
        className="relative w-full touch-pan-y select-none overflow-hidden rounded-2xl border border-white/10 bg-[#02040a]"
        style={{ height: "62dvh", minHeight: 400 }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("worldglobe.canvasLabel", "Interactive globe of the world. Drag to spin, pinch or scroll to zoom, tap a marker for details. Zoom all the way out to reach the solar system and its planets.")}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        <TileDebugOverlay />

        {/* Legend — every layer toggleable (globe furniture; parks in the system view) */}
        {!inSystem && (
        <div className="absolute left-2 top-2 z-10 max-h-[70%] overflow-y-auto rounded-xl border border-white/10 bg-black/55 p-1.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setLegendOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-200"
            aria-expanded={legendOpen}
          >
            {t("worldglobe.legend", "Legend")}
            <span aria-hidden>{legendOpen ? "▾" : "▸"}</span>
          </button>
          {legendOpen && (
            <ul className="mt-0.5 space-y-0.5">
              {GLOBE_LAYERS.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => (l.id === "home" ? openHomeSheet() : toggleLayer(l.id))}
                    aria-pressed={layersOn[l.id]}
                    title={l.blurb}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition-opacity ${
                      layersOn[l.id] ? "text-gray-100" : "text-gray-500 opacity-60"
                    }`}
                  >
                    {/* WS2: the same icon that rides the globe marker, so
                        legend and world read identically (shape, not color). */}
                    <img
                      src={globeIconURL(l.icon, l.color)}
                      alt=""
                      aria-hidden
                      className="h-4 w-4 shrink-0"
                      style={{ filter: layersOn[l.id] ? `drop-shadow(0 0 4px ${l.color})` : "none" }}
                    />
                    <span className="flex-1">{t(`worldglobe.layer.${l.id}`, l.label)}</span>
                    <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-gray-300">{counts[l.id]}</span>
                  </button>
                  {/* WS7: tier filters for world sites — T1/T2/T3 gate
                      independently of the layer toggle. */}
                  {l.id === "sites" && (
                    <div className="mb-0.5 ml-7 flex gap-1" role="group" aria-label={t("worldglobe.siteTiers", "Site tiers")}>
                      {SITE_TIER_LIST.map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => toggleTier(tier)}
                          aria-pressed={filters.siteTiers[tier]}
                          title={t(`worldglobe.tier.${tier}`, tier === 3 ? "T3 — hard sites (chipsets)" : `T${tier} sites`)}
                          className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                            filters.siteTiers[tier]
                              ? "border-white/20 bg-white/10 text-gray-100"
                              : "border-white/5 bg-transparent text-gray-500 opacity-50"
                          }`}
                        >
                          <img
                            src={globeIconURL(siteMarkerIcon(tier), GLOBE_SITE_TIER_COLOR[tier])}
                            alt=""
                            aria-hidden
                            className="h-3.5 w-3.5"
                          />
                          T{tier}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        )}

        {/* SOLAR SYSTEM chip (Hans, Oct 6 2026) */}
        {inSystem && (
          <div className="absolute left-1/2 top-2 z-10 w-max max-w-[92%] -translate-x-1/2">
            <div className="rounded-2xl border border-sky-300/40 bg-black/70 px-3 py-1.5 text-center backdrop-blur-sm">
              <p className="text-[12px] font-bold text-sky-100">✦ {t("worldglobe.systemTitle", "Solar system")}</p>
              <p className="text-[10px] text-gray-300">
                {t("worldglobe.systemHint", "Tap a planet — send a probe, or zoom + to dive back in")}
              </p>
            </div>
          </div>
        )}

        {/* HIVE PICK-MODE banner (Hans, Oct 4 2026, WS-E) */}
        {hivePick && (
          <div className="absolute left-1/2 top-2 z-10 w-max max-w-[92%] -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-amber-300/40 bg-black/70 px-3 py-1.5 backdrop-blur-sm">
              <span aria-hidden>📍</span>
              <p className="text-[12px] font-semibold text-amber-100">
                {t("worldglobe.hiveBanner", "Tap the globe to choose your hive point")}
              </p>
              <button
                type="button"
                onClick={cancelHivePick}
                className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white"
              >
                {t("worldglobe.cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Relocation confirmation (Hans's UI rule: tap explain inline) */}
        {hiveDone && (
          <div className="absolute left-1/2 top-14 z-10 w-max max-w-[92%] -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-950/80 px-3 py-2 backdrop-blur-sm">
              <p role="status" className="text-[12px] font-semibold text-emerald-100">{hiveDone}</p>
              <button
                type="button"
                onClick={() => setHiveDone(null)}
                aria-label={t("worldglobe.close", "Close")}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* BAND INDICATOR (Phase 2, slice 14, spec §3): the live altitude
            readout on the ORBIT → GROUND continuum — minimal, unobtrusive,
            display only (never a band menu). Replaces slice 1's temporary
            dev readout. Top-right stays clear of the legend (left), the
            system/spread hints (top-center), and the zoom controls (bottom). */}
        <div
          className="pointer-events-none absolute right-2 top-2 z-10 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300 backdrop-blur-sm"
          title="Altitude on the zoom continuum"
          aria-label={`Altitude: ${ZOOM_BAND_LABEL[zoomBand]}`}
        >
          {`ALT · ${ZOOM_BAND_LABEL[zoomBand]}`}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            aria-label={t("worldglobe.zoomIn", "Zoom in")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-lg text-white backdrop-blur-sm"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.8)}
            aria-label={t("worldglobe.zoomOut", "Zoom out")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-lg text-white backdrop-blur-sm"
          >
            −
          </button>
          <button
            type="button"
            onClick={recenter}
            aria-label={t("worldglobe.recenter", "Recenter the globe")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-base text-white backdrop-blur-sm"
          >
            ⌂
          </button>
          {/* "Center on home" (slice 14, spec §3 gesture≡button audit):
              the button-equivalent of tapping the home marker. Hidden in
              the solar-system view, where the home world is a planet tile. */}
          {!inSystem && (
            <button
              type="button"
              onClick={centerOnHome}
              aria-label={t("worldglobe.centerHome", "Center on home")}
              title={t("worldglobe.centerHome", "Center on home")}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-base text-white backdrop-blur-sm"
            >
              ⌖
            </button>
          )}
        </div>

        {/* CRADLE ENTRY (slice 10): gesture≡button (spec §10). "Enter
            Cradle" advances the tap→focus→hover→descend chain one step per
            tap, exactly like the gesture; "Leave" is the pinch-out
            equivalent. The canvas never unmounts for either. */}
        {!inSystem && (
          <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1.5">
            {(cradle.entry === "FREE" || cradle.entry === "FOCUSING" || cradle.entry === "HOVERING") && (
              <button
                type="button"
                onClick={enterCradle}
                className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-950/70 px-4 text-[13px] font-bold text-amber-100 backdrop-blur-sm"
              >
                <span aria-hidden>🏰</span>
                {t("worldglobe.enterCradle", "Enter Cradle")}
              </button>
            )}
            {cradle.entry !== "FREE" && (
              <button
                type="button"
                onClick={leaveCradle}
                aria-label={t("worldglobe.leaveCradle", "Leave the Cradle")}
                className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/20 bg-black/60 px-4 text-[13px] font-bold text-gray-200 backdrop-blur-sm"
              >
                <span aria-hidden>↩</span>
                {t("worldglobe.leave", "Leave")}
              </button>
            )}
          </div>
        )}

        {/* The one-time "spread to enter" hint (slice 10): pulses while
            HOVERING, max 3 lifetime shows, then never. */}
        {spreadHint && cradle.entry === "HOVERING" && !inSystem && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2">
            <div className="animate-pulse rounded-full border border-amber-300/50 bg-black/70 px-4 py-1.5 text-[12px] font-semibold text-amber-100 backdrop-blur-sm">
              {t("worldglobe.spreadHint", "Spread your fingers to enter ✌")}
            </div>
          </div>
        )}

        {/* Detail sheet */}
        {selected && (
          <DetailSheet
            marker={selected}
            onClose={closeSheet}
            onAction={soonHint}
            hint={linkHint}
            onHivePick={selected.ref.kind === "home" ? startHivePick : undefined}
            hiveNote={selected.ref.kind === "home" ? (hiveBlockers[0] ?? null) : null}
            // CRADLE ENTRY (slice 10): the home sheet's Enter button starts
            // the tap→focus→hover→descend chain (spec §10) instead of the
            // linking-pass note — the sheet is the fallback path.
            onEnterColony={selected.ref.kind === "home" ? enterCradle : undefined}
          />
        )}

        {/* CRADLE ENTRY (slice 10): INSIDE renders the Cradle interior as
            the Z4 band — the world canvas stays live behind it. Placeholder
            panel reusing existing colony data for this slice (the
            illustrated 2D Plus art scene lands later); module logic is not
            rewritten. Buildings open as overlays in slice 11. */}
        {cradle.entry === "INSIDE" && !inSystem && (
          <CradleInteriorPanel state={state} onOpenModule={openModule} />
        )}

        {/* MODULE OVERLAY (slice 11): the open module rides OVER the live
            world — the canvas is a sibling and never unmounts. The URL
            mirrors as ?module=<id>; the back button closes the overlay. */}
        {cradle.module && cradle.entry === "INSIDE" && !inSystem && (
          <ModuleOverlay module={cradle.module} state={state} onClose={closeModule} />
        )}

        {/* Hive relocation confirmation (Hans, Oct 4 2026, WS-E) */}
        {hivePick && hiveCandidate && (
          <HiveConfirmPanel
            state={state}
            candidate={hiveCandidate}
            busy={hiveBusy}
            error={hiveError}
            onConfirm={confirmHiveMove}
            onCancel={cancelHivePick}
          />
        )}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-gray-500">
        {inSystem
          ? t("worldglobe.hintSystem", "Drag to swing the orbits — tap a planet for its sheet. Zoom back in to return to your world.")
          : t("worldglobe.hint", "Drag to spin the world — tap a glowing marker for its story.")}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail sheet — beautiful, never an ugly popup
// ---------------------------------------------------------------------------

function DetailSheet({
  marker,
  onClose,
  onAction,
  hint,
  onHivePick,
  hiveNote,
  onEnterColony,
}: {
  marker: GlobeMarker;
  onClose: () => void;
  onAction: (label: string) => void;
  hint: string | null;
  /** Hive relocation (WS-E): opens globe pick-mode from the home sheet. */
  onHivePick?: () => void;
  /** Inline blocker note shown under the relocate button (Hans's UI rule). */
  hiveNote?: string | null;
  /** CRADLE ENTRY (slice 10): the home sheet's Enter button starts the
   *  tap→focus→hover→descend chain instead of the linking-pass note. */
  onEnterColony?: () => void;
}) {
  const t = useT();
  const meta = GLOBE_LAYER_META[marker.layer];

  return (
    <div
      role="dialog"
      aria-label={marker.label}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-y-auto rounded-t-2xl border-t bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ borderTopColor: `${marker.color}66`, boxShadow: `0 -12px 48px ${marker.color}33` }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("worldglobe.close", "Close")}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/5 text-base text-white"
      >
        ✕
      </button>

      <div className="flex gap-3 px-4 pb-5 pt-1">
        <SheetArt marker={marker} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: marker.color }}>
            {t(`worldglobe.layer.${marker.layer}`, meta.label)}
          </p>
          <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-white">{marker.label}</h3>
          <p className="mt-0.5 text-[12px] text-gray-400">{marker.sublabel}</p>
          <SheetStats marker={marker} />
        </div>
      </div>

      <div className="px-4 pb-4">
        <SheetActions
          marker={marker}
          onAction={onAction}
          onHivePick={onHivePick}
          hiveNote={hiveNote}
          onEnterColony={onEnterColony}
        />
        {hint && (
          <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-gray-300">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function SheetArt({ marker }: { marker: GlobeMarker }) {
  const r = marker.ref;
  let src: string | null = null;
  let alt = "";
  if (r.kind === "chorus") {
    src = "/" + r.site.art;
    alt = `Grade ${r.site.gradeLabel} Chorus site`;
  } else if (r.kind === "colony" || r.kind === "home") {
    const raceId = r.kind === "colony" ? r.colony.race : undefined;
    if (raceId) {
      try { src = racePortrait(raceId); } catch { src = null; }
      alt = "Colony";
    }
  }
  if (!src) {
    // Zero-dots audit (WS3): no plain-circle gradient placeholder — the
    // marker's own globe icon rides here, so sheet and world read
    // identically (shape, not color).
    return (
      <img
        src={globeIconURL(marker.icon, marker.color)}
        alt=""
        aria-hidden
        className="h-20 w-16 shrink-0 rounded-lg border object-contain p-2"
        style={{
          borderColor: `${marker.color}55`,
          background: "rgba(0,0,0,0.4)",
          boxShadow: `0 0 18px ${marker.color}33`,
        }}
        loading="lazy"
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="h-24 w-20 shrink-0 rounded-lg border object-cover"
      style={{ borderColor: `${marker.color}55`, boxShadow: `0 0 18px ${marker.color}44` }}
      loading="lazy"
    />
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{k}</div>
      <div className="text-[13px] font-semibold text-gray-100">{v}</div>
    </div>
  );
}

function SheetStats({ marker }: { marker: GlobeMarker }) {
  const t = useT();
  const r = marker.ref;
  if (r.kind === "chorus") {
    const s = r.site;
    return (
      <div className="mt-2">
        {s.isHeart && (
          <p className="mb-1.5 rounded-lg border border-red-400/40 bg-red-950/50 px-2.5 py-1.5 text-[11px] font-bold leading-snug text-red-200">
            {t(
              "worldglobe.chorusHeart",
              "❖ The Chorus Heart — endgame. Bring a full rally at max reverb."
            )}
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Stat k={t("worldglobe.strength", "Strength")} v={s.strength.toLocaleString()} />
          <Stat k={t("worldglobe.garrison", "Garrison")} v={s.garrisonTroops.toLocaleString()} />
          <Stat k={t("worldglobe.recTroops", "Rec. troops")} v={s.recommendedTroops.toLocaleString()} />
          <Stat k={t("worldglobe.recReverb", "Rec. reverb")} v={s.recommendedReverb.toLocaleString()} />
        </div>
      </div>
    );
  }
  if (r.kind === "site") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.tier", "Tier")} v={`T${r.tier}`} />
        <Stat k={t("worldglobe.risk", "Risk")} v={`${r.zone.risk}/100`} />
        <Stat k={t("worldglobe.embers", "Embers")} v={`${r.zone.emberYield}`} />
        <Stat k={t("worldglobe.chorusRisk", "Chorus risk")} v={`${Math.round(r.zone.chorusRisk * 100)}%`} />
      </div>
    );
  }
  if (r.kind === "colony") {
    const c = r.colony;
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.status", "Status")} v={c.status} />
        {typeof c.reverb === "number" && (
          <Stat k={t("worldglobe.reverb", "Reverb")} v={c.reverb.toLocaleString()} />
        )}
        {typeof c.approxTroops === "number" && (
          <Stat k={t("worldglobe.troops", "Troops")} v={`~${c.approxTroops.toLocaleString()}`} />
        )}
      </div>
    );
  }
  if (r.kind === "raid") {
    const rd = r.raid;
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.from", "From")} v={rd.attackerWorldName || "?"} />
        <Stat k={t("worldglobe.ships", "Ships")} v={`${rd.shipCount}`} />
      </div>
    );
  }
  if (r.kind === "satellite") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.watches", "Watches")} v={r.zoneName} />
        <Stat k={t("worldglobe.coverage", "Coverage")} v={t("worldglobe.coverageVisual", "Visual map only")} />
      </div>
    );
  }
  if (r.kind === "beachhead") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.beachhead", "Beachhead")} v={t("worldglobe.beachheadOpen", "Open ground")} />
        <Stat k={t("worldglobe.knownTo", "Known to")} v={t("worldglobe.knownToAll", "Everyone")} />
      </div>
    );
  }
  if (r.kind === "arena") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.arenaOpen", "Open to")} v={t("worldglobe.arenaOpenAll", "Everybody")} />
        <Stat k={t("worldglobe.arenaFights", "Fights")} v={t("worldglobe.arenaModes", "Practice · duels")} />
      </div>
    );
  }
  return null;
}

function ActionButton({ label, primary, onClick }: { label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-[13px] font-bold ${
        primary
          ? "bg-red-500/80 text-white shadow-[0_0_16px_rgba(239,68,68,0.45)]"
          : "border border-white/15 bg-white/5 text-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

function SheetActions({
  marker,
  onAction,
  onHivePick,
  hiveNote,
  onEnterColony,
}: {
  marker: GlobeMarker;
  onAction: (label: string) => void;
  onHivePick?: () => void;
  hiveNote?: string | null;
  /** CRADLE ENTRY (slice 10): the home sheet's Enter button starts the
   *  entry chain — the sheet is the fallback path, the gesture the fast one. */
  onEnterColony?: () => void;
}) {
  const t = useT();
  const r = marker.ref;
  const go = (label: string) => () => onAction(label);

  if (r.kind === "chorus") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.launchRaid", "⚔️ LAUNCH RAID")} onClick={go(t("worldglobe.launchRaid", "Raid launch"))} />
      </div>
    );
  }
  if (r.kind === "home") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {/* CRADLE ENTRY (slice 10): when the entry flow is wired, Enter
              starts the tap→focus→hover→descend chain; otherwise it keeps
              the honest linking-pass note (Hans's UI rule — never a dead
              button). */}
          <ActionButton
            primary
            label={t("worldglobe.enterColony", "Enter colony")}
            onClick={onEnterColony ?? go(t("worldglobe.enterColony", "Enter colony"))}
          />
          {/* HIVE RELOCATION (Hans, Oct 4 2026, WS-E): always tappable — a
              tap while blocked shows the blocker inline (Hans's UI rule). */}
          {onHivePick && (
            <ActionButton label={t("worldglobe.relocateHive", "📍 Relocate to hive")} onClick={onHivePick} />
          )}
        </div>
        {hiveNote && (
          <p role="status" className="rounded-lg border border-amber-300/25 bg-amber-950/40 px-3 py-2 text-[12px] leading-relaxed text-amber-100">
            {hiveNote}
          </p>
        )}
      </div>
    );
  }
  if (r.kind === "colony") {
    const c = r.colony;
    return (
      <div className="flex flex-wrap gap-2">
        {c.status === "husk" ? (
          <ActionButton primary label={t("worldglobe.claimHusk", "Claim as sub colony")} onClick={go(t("worldglobe.claimHusk", "Husk claim"))} />
        ) : (
          <>
            <ActionButton primary label={t("worldglobe.raid", "Raid")} onClick={go(t("worldglobe.raid", "Raid"))} />
            {c.status === "abandoned" && (
              <ActionButton label={t("worldglobe.glean", "Glean")} onClick={go(t("worldglobe.glean", "Glean"))} />
            )}
          </>
        )}
      </div>
    );
  }
  if (r.kind === "site") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.explore", "Explore")} onClick={go(t("worldglobe.explore", "Explore"))} />
      </div>
    );
  }
  if (r.kind === "raid") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.rallyDefense", "🛡️ Rally the defense")} onClick={go(t("worldglobe.rallyDefense", "Defense rally"))} />
      </div>
    );
  }
  if (r.kind === "satellite") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton label={t("worldglobe.coverageDetails", "Coverage details")} onClick={go(t("worldglobe.coverageDetails", "Satellite coverage"))} />
      </div>
    );
  }
  if (r.kind === "beachhead") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.beachheadPlans", "Invasion plans")} onClick={go(t("worldglobe.beachheadPlans", "Beachhead plans"))} />
      </div>
    );
  }
  if (r.kind === "arena") {
    // Layout-first: the arena engine wires up in the linking pass — these
    // buttons show the honest "wires up soon" note, never a dead click.
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.enterArena", "🏟️ ENTER ARENA")} onClick={go(t("worldglobe.enterArena", "Arena entry"))} />
        <ActionButton label={t("worldglobe.arenaLadder", "View the ladder")} onClick={go(t("worldglobe.arenaLadder", "Arena ladder"))} />
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hive relocation confirmation (Hans, Oct 4 2026, WS-E)
// ---------------------------------------------------------------------------

function HiveConfirmPanel({
  state,
  candidate,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  state: GameState;
  candidate: { lat: number; lon: number };
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const from = currentHomeGlobePosition(state);
  const cost = hiveMoveCost(from, candidate);
  const allies = alliedKnownColonies(state);
  const meanNow = meanAllyDistanceKm(allies, from);
  const meanNew = meanAllyDistanceKm(allies, candidate);
  const delta = meanNew - meanNow;
  const fmtKm = (km: number) => `${Math.round(km).toLocaleString()} km`;
  const closer = delta <= 0;

  return (
    <div
      role="dialog"
      aria-label={t("worldglobe.hiveConfirmTitle", "Confirm hive relocation")}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-2xl border-t border-amber-300/40 bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ boxShadow: "0 -12px 48px rgba(251,191,36,0.25)" }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <div className="px-4 pb-5 pt-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
          {t("worldglobe.hiveConfirmKicker", "Hive relocation")}
        </p>
        <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-white">
          {t("worldglobe.hiveConfirmTitle", "Move your colony here?")}
        </h3>
        <p className="mt-0.5 text-[12px] text-gray-400">
          {t("worldglobe.hivePoint", "Hive point: {lat}°, {lon}°", {
            lat: candidate.lat.toFixed(1),
            lon: candidate.lon.toFixed(1),
          })}
        </p>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Stat
            k={t("worldglobe.hiveDistance", "Distance")}
            v={`${cost.distanceDeg.toFixed(1)}° · ${fmtKm(cost.distanceKm)}`}
          />
          <Stat
            k={t("worldglobe.hiveCost", "Cost")}
            v={t("worldglobe.hiveCostValue", "{supplies} supplies + {fuel} fuel", {
              supplies: cost.supplies.toLocaleString(),
              fuel: cost.fuel.toLocaleString(),
            })}
          />
          <div className="col-span-2 rounded-lg bg-white/5 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
              {t("worldglobe.hiveResponse", "War-band response")}
            </div>
            <div className="text-[13px] font-semibold text-gray-100">
              {allies.length === 0
                ? t(
                    "worldglobe.hiveNoAllies",
                    "No allied colonies on your map yet — your hive sets the rally point alone.",
                  )
                : t(
                    "worldglobe.hiveResponseValue",
                    "{n} allied {word}: mean {now} → {next} ({dir} by {delta})",
                    {
                      n: allies.length,
                      word:
                        allies.length === 1
                          ? t("worldglobe.hiveColonyOne", "colony")
                          : t("worldglobe.hiveColonyMany", "colonies"),
                      now: fmtKm(meanNow),
                      next: fmtKm(meanNew),
                      dir: closer
                        ? t("worldglobe.hiveCloser", "closer")
                        : t("worldglobe.hiveFarther", "farther"),
                      delta: fmtKm(Math.abs(delta)),
                    },
                  )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton
            primary
            label={busy ? t("worldglobe.hiveMoving", "Moving…") : t("worldglobe.hiveConfirm", "✅ Confirm relocation")}
            onClick={onConfirm}
          />
          <ActionButton label={t("worldglobe.cancel", "Cancel")} onClick={onCancel} />
        </div>
        {error && (
          <p role="status" className="mt-2 rounded-lg border border-red-400/30 bg-red-950/40 px-3 py-2 text-[12px] leading-relaxed text-red-100">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cradle interior — the INSIDE band (slice 10)
// ---------------------------------------------------------------------------

/** INSIDE renders the Cradle interior as the Z4 band — the world canvas stays
 *  live behind it (the one hard rule). PLACEHOLDER for this slice: reuses
 *  existing colony data (name, supplies, embers, energy) and the game-wide
 *  SceneHeader (location name + live UTC clock, Hans Oct 5). The
 *  illustrated 2D Plus art scene — buildings as clickable links — lands in
 *  a later slice; no module logic is rewritten here. Buildings open as
 *  overlays (slice 11). */
function CradleInteriorPanel({
  state,
  onOpenModule,
}: {
  state: GameState;
  /** Slice 11: tap a building → its module opens as an overlay. */
  onOpenModule: (id: CradleModuleId) => void;
}) {
  const t = useT();
  const colonyLabel = state.playerName
    ? colonyMarkerName(state.playerName)
    : t("worldglobe.yourColony", "Your colony");
  const supplies = state.resources?.supplies ?? 0;
  const embers = state.resources?.embers ?? 0;
  const energy = state.energy ?? 0;

  return (
    <div
      role="dialog"
      aria-label={t("worldglobe.cradleInteriorTitle", "Cradle interior")}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[62%] overflow-y-auto rounded-t-2xl border-t border-amber-300/40 bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ boxShadow: "0 -12px 48px rgba(251,191,36,0.25)" }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <div className="px-4 pb-5 pt-1">
        <SceneHeader
          name={colonyLabel}
          sub={t("worldglobe.cradleInteriorSub", "Cradle interior — preview")}
          band="Z4"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          {t(
            "worldglobe.cradleInteriorNote",
            "PREVIEW — the illustrated Cradle art scene lands in a later slice. The world stays live behind this panel; pinch out (or Leave) to ascend.",
          )}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Stat k={t("worldglobe.supplies", "Supplies")} v={supplies.toLocaleString()} />
          <Stat k={t("worldglobe.embers", "Embers")} v={embers.toLocaleString()} />
          <Stat k={t("worldglobe.energy", "Energy")} v={`${energy}`} />
        </div>
        {/* Slice 11: the buildings. Each opens its module as an overlay
            over the live world — the URL mirrors (?module=), the back
            button closes, the canvas never unmounts. */}
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t("worldglobe.buildings", "Buildings")}>
          {cradleModuleIds().map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpenModule(id)}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 text-[13px] font-bold text-gray-100"
            >
              <span aria-hidden>🏛️</span>
              {cradleModuleLabel(id)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
