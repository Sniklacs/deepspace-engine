// globe-layers.ts — WORLD GLOBE LAYERS (Phase 1: layout).
//
// Pure data + pure functions. Builds the marker set the WorldGlobe canvas
// renders. Hans (Oct 4 2026): the globe IS the world — the main core
// workstation. Every layer is toggleable; the player decides what they see.
//
// LAYOUT-FIRST (Hans, Oct 4 2026): this module only lays markers out —
// positions, colors, priorities, legend metadata. Wiring markers to their
// destinations (enter colony, launch raid, rally defense) is the linking
// pass and lives outside this file.
//
// TERRAIN (Hans, Oct 4 2026, night): the landmass topography math also lives
// here — pure, seeded, DOM-free. WorldGlobe.tsx bakes one sprite per landmass
// from it ONCE at init; the render loop only blits the sprites.
//
// Reuses existing math, never reinvents it:
//   • Chorus site intel/strength/reverb/grades → game/chorus-intel.ts
//   • Deterministic globe positions for Chorus sites → siteGlobePosition
//   • Colony identity/status → game/worldmap.ts

import { chorusSiteIntel, hash01, type ChorusSiteIntel } from "./chorus-intel";
import { ZONES } from "./zones";
import { memorialNodeIds, type MemorialPlaque } from "./memorials";
import { colonyMarkerName, type KnownColony } from "./worldmap";
import type { GameState, Zone } from "./types";
import type { IncomingRaidAlert } from "./raid-protocol";

/** Every toggleable layer on the globe. */
export type GlobeLayerId =
  | "home"
  | "colonies"
  | "husks"
  | "sites"
  | "chorus"
  | "memorials"
  | "raids"
  | "satellites";

export interface GlobeLayerMeta {
  id: GlobeLayerId;
  /** Legend label. */
  label: string;
  /** Legend + marker glow color. */
  color: string;
  /** On by default. */
  defaultOn: boolean;
  /** One-line legend blurb. */
  blurb: string;
}

/** Legend order = render order. */
export const GLOBE_LAYERS: GlobeLayerMeta[] = [
  { id: "home", label: "Your colony", color: "#fbbf24", defaultOn: true, blurb: "Home — tap to enter" },
  { id: "raids", label: "Incoming raids", color: "#ef4444", defaultOn: true, blurb: "Raid signatures inbound" },
  { id: "chorus", label: "Chorus sites", color: "#f87171", defaultOn: true, blurb: "Raid ladder, grades I–V" },
  { id: "colonies", label: "Colonies", color: "#34d399", defaultOn: true, blurb: "Known colonies by owner" },
  { id: "sites", label: "World sites", color: "#7dd3fc", defaultOn: true, blurb: "T1 / T2 / T3 sites" },
  { id: "husks", label: "Husks", color: "#9ca3af", defaultOn: true, blurb: "Dead colonies, claimable" },
  { id: "memorials", label: "Memorials", color: "#fde68a", defaultOn: false, blurb: "Battle plaques" },
  { id: "satellites", label: "Satellites", color: "#38bdf8", defaultOn: false, blurb: "Orbital coverage ring" },
];

export const GLOBE_LAYER_META: Record<GlobeLayerId, GlobeLayerMeta> = Object.fromEntries(
  GLOBE_LAYERS.map((l) => [l.id, l]),
) as Record<GlobeLayerId, GlobeLayerMeta>;

/** What a marker points at — the detail sheet reads this. */
export type GlobeMarkerRef =
  | { kind: "home" }
  | { kind: "colony"; colony: KnownColony; key: string }
  | { kind: "site"; zone: Zone; tier: 1 | 2 | 3 }
  | { kind: "chorus"; site: ChorusSiteIntel }
  | { kind: "memorial"; nodeId: string; name: string }
  | { kind: "raid"; raid: IncomingRaidAlert };

export interface GlobeMarker {
  /** Stable unique id. */
  id: string;
  layer: GlobeLayerId;
  /** Degrees. */
  lat: number;
  lon: number;
  label: string;
  sublabel: string;
  /** Glow color. */
  color: string;
  /** Declutter priority — higher wins when markers overlap. */
  priority: number;
  /** Pulsing ring (raids, selected). */
  pulse?: boolean;
  ref: GlobeMarkerRef;
}

// ---------------------------------------------------------------------------
// Positions — deterministic, stable across sessions (hash-seeded, never random)
// ---------------------------------------------------------------------------

/** Colony marker position: full-globe hash spread, kept off the poles. */
export function colonyGlobePosition(key: string): { lat: number; lon: number } {
  const lat = (hash01(key + ":clat") * 2 - 1) * 68;
  const lon = hash01(key + ":clon") * 360 - 180;
  return { lat, lon };
}

/** World-site tier from the zone's risk (0–100): the deeper the risk, the
 *  deeper the tier. T1 outer rim · T2 mid-depth · T3 deep. */
export function siteTier(risk: number): 1 | 2 | 3 {
  if (risk >= 67) return 3;
  if (risk >= 34) return 2;
  return 1;
}

/** Tier cluster centers — the three tiers read as three distinct regions,
 *  mirroring how Chorus grades cluster (chorus-intel.ts). */
const TIER_CLUSTER: Record<1 | 2 | 3, { lat: number; lon: number }> = {
  1: { lat: 42, lon: -50 }, // T1 — northern rim
  2: { lat: -2, lon: 62 }, // T2 — equatorial
  3: { lat: -46, lon: -105 }, // T3 — deep south
};

/** World-site position: tier cluster + deterministic jitter (no stacking). */
export function worldSiteGlobePosition(zoneId: string, tier: 1 | 2 | 3): { lat: number; lon: number } {
  const c = TIER_CLUSTER[tier];
  const j1 = (hash01(zoneId + ":wlat") - 0.5) * 30;
  const j2 = (hash01(zoneId + ":wlon") - 0.5) * 30;
  const lat = Math.max(-78, Math.min(78, c.lat + j1));
  let lon = (c.lon + j2) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/** Memorial position: hash of its node id. */
export function memorialGlobePosition(nodeId: string): { lat: number; lon: number } {
  return colonyGlobePosition("memorial:" + nodeId);
}

// ---------------------------------------------------------------------------
// Orthographic projection — the globe math
// ---------------------------------------------------------------------------

export interface GlobeProjection {
  /** Unit-sphere x/y (multiply by globe radius for pixels). */
  x: number;
  y: number;
  /** Depth: 1 = dead center front, 0 = limb, negative = backface. */
  z: number;
  /** False on the far side — culled, never rendered or hit-tested. */
  visible: boolean;
}

/**
 * Orthographic projection of a lat/lon point.
 * @param spinDeg longitude rotation (drag spins the globe)
 * @param tiltDeg latitude tilt, clamped by the caller to ±55°
 */
export function projectGlobe(
  latDeg: number,
  lonDeg: number,
  spinDeg: number,
  tiltDeg: number,
): GlobeProjection {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  // lat/lon → 3D (y up, z toward viewer at lon 0)
  let x = Math.cos(phi) * Math.sin(lam);
  let y = Math.sin(phi);
  let z = Math.cos(phi) * Math.cos(lam);
  // spin about the Y axis
  const s = (spinDeg * Math.PI) / 180;
  const x1 = x * Math.cos(s) + z * Math.sin(s);
  const z1 = -x * Math.sin(s) + z * Math.cos(s);
  x = x1;
  z = z1;
  // tilt about the X axis
  const t = (tiltDeg * Math.PI) / 180;
  const y1 = y * Math.cos(t) - z * Math.sin(t);
  const z2 = y * Math.sin(t) + z * Math.cos(t);
  y = y1;
  z = z2;
  return { x, y: -y, z, visible: z > 0.02 };
}

// ---------------------------------------------------------------------------
// Marker assembly
// ---------------------------------------------------------------------------

const CHORUS_GRADE_COLOR: Record<number, string> = {
  1: "#fca5a5",
  2: "#f87171",
  3: "#ef4444",
  4: "#dc2626",
  5: "#991b1b",
};

const SITE_TIER_COLOR: Record<1 | 2 | 3, string> = {
  1: "#7dd3fc",
  2: "#a78bfa",
  3: "#f472b6",
};

function zoneName(zoneId: string): string {
  return ZONES.find((z) => z.id === zoneId)?.name ?? zoneId;
}

/**
 * Build every globe marker from game state. Pure — no clock, no I/O.
 * `now` is only used for raid ETA sublabels.
 */
export function buildGlobeMarkers(state: GameState, now: number): GlobeMarker[] {
  const markers: GlobeMarker[] = [];
  const wm = state.worldMap;
  const gameId = state.gameId ?? "colony";

  // Home — the player's own colony. Distinct gold marker, top priority.
  const homePos = colonyGlobePosition("home:" + gameId);
  const homeLabel = state.playerName ? colonyMarkerName(state.playerName) : "Your colony";
  markers.push({
    id: "home",
    layer: "home",
    lat: homePos.lat,
    lon: homePos.lon,
    label: homeLabel,
    sublabel: "HOME",
    color: GLOBE_LAYER_META.home.color,
    priority: 100,
    ref: { kind: "home" },
  });

  // Incoming raids — pulsing markers riding the home position (inbound to
  // the player's colony), fanned slightly so several don't stack.
  const raids = (wm?.incomingRaids ?? []).filter((r) => !r.resolved);
  raids.forEach((r, i) => {
    const fan = (i - (raids.length - 1) / 2) * 7;
    const etaMs = Math.max(0, (r.landsAt || now) - now);
    const etaMin = Math.floor(etaMs / 60000);
    const etaSec = Math.floor((etaMs % 60000) / 1000);
    markers.push({
      id: `raid:${r.raidId}`,
      layer: "raids",
      lat: Math.max(-78, Math.min(78, homePos.lat + fan * 0.4)),
      lon: homePos.lon + fan,
      label: r.attackerNames.join(", ") || "Unknown raiders",
      sublabel: `Touchdown in ${etaMin > 0 ? `${etaMin}m ` : ""}${etaSec}s`,
      color: GLOBE_LAYER_META.raids.color,
      priority: 95,
      pulse: true,
      ref: { kind: "raid", raid: r },
    });
  });

  // Chorus raid ladder — full intel already carries globe positions.
  for (const site of chorusSiteIntel()) {
    markers.push({
      id: `chorus:${site.zoneId}`,
      layer: "chorus",
      lat: site.lat,
      lon: site.lon,
      label: site.siteName,
      sublabel: `Grade ${site.gradeLabel} · ${site.strength.toLocaleString()} str`,
      color: CHORUS_GRADE_COLOR[site.grade] ?? "#ef4444",
      priority: 80,
      ref: { kind: "chorus", site },
    });
  }

  // Known colonies — husks split into their own layer.
  const known = wm ? Object.values(wm.known) : [];
  for (const c of known) {
    const key = `${c.serverId}:${c.id}`;
    const pos = colonyGlobePosition(key);
    const isHusk = c.status === "husk";
    markers.push({
      id: `colony:${key}`,
      layer: isHusk ? "husks" : "colonies",
      lat: pos.lat,
      lon: pos.lon,
      label: colonyMarkerName(c.ownerName),
      sublabel: c.status === "abandoned" ? "Abandoned — gleanable" : c.status === "husk" ? "Husk — claimable" : "Active",
      color: isHusk
        ? GLOBE_LAYER_META.husks.color
        : c.status === "abandoned"
          ? "#fbbf24"
          : GLOBE_LAYER_META.colonies.color,
      priority: isHusk ? 45 : 70,
      ref: { kind: "colony", colony: c, key },
    });
  }

  // World sites — every zone, tiered by risk.
  for (const zone of ZONES) {
    const tier = siteTier(zone.risk);
    const pos = worldSiteGlobePosition(zone.id, tier);
    markers.push({
      id: `site:${zone.id}`,
      layer: "sites",
      lat: pos.lat,
      lon: pos.lon,
      label: zone.name,
      sublabel: `T${tier} site`,
      color: SITE_TIER_COLOR[tier],
      priority: 55,
      ref: { kind: "site", zone, tier },
    });
  }

  // Memorials — battle plaques.
  const memIds = memorialNodeIds((state as unknown as { memorials?: MemorialPlaque[] }).memorials ?? []);
  for (const nodeId of memIds) {
    const pos = memorialGlobePosition(nodeId);
    markers.push({
      id: `memorial:${nodeId}`,
      layer: "memorials",
      lat: pos.lat,
      lon: pos.lon,
      label: zoneName(nodeId),
      sublabel: "Memorial",
      color: GLOBE_LAYER_META.memorials.color,
      priority: 35,
      ref: { kind: "memorial", nodeId, name: zoneName(nodeId) },
    });
  }

  return markers;
}

// ---------------------------------------------------------------------------
// Declutter — screen-space min separation so markers never pile up
// ---------------------------------------------------------------------------

export interface ScreenMarker {
  marker: GlobeMarker;
  /** CSS pixels, relative to the canvas box. */
  sx: number;
  sy: number;
}

/**
 * Keep the highest-priority marker in every minDistPx neighborhood.
 * Input must already be projected + culled + layer-filtered.
 */
export function declutterMarkers(items: ScreenMarker[], minDistPx: number): ScreenMarker[] {
  const sorted = [...items].sort((a, b) => b.marker.priority - a.marker.priority);
  const kept: ScreenMarker[] = [];
  for (const it of sorted) {
    let clash = false;
    for (const k of kept) {
      const dx = it.sx - k.sx;
      const dy = it.sy - k.sy;
      if (dx * dx + dy * dy < minDistPx * minDistPx) {
        clash = true;
        break;
      }
    }
    if (!clash) kept.push(it);
  }
  return kept;
}

/** Count markers per layer (for legend badges). */
export function countByLayer(markers: GlobeMarker[]): Record<GlobeLayerId, number> {
  const counts = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, 0])) as Record<GlobeLayerId, number>;
  for (const m of markers) counts[m.layer] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Terrain elevation — procedural topography for the globe's landmasses.
//
// Hans (Oct 4 2026, night): the flat green splotches don't impress — the
// globe needs real landmass with topography and depth: elevation shading,
// ridgelines/highlands, coastal falloff. Make it pretty.
//
// Pure + seeded (deterministic per landmass). One elevation FIELD per
// landmass: radial falloff from the landmass center (high interior, low
// coast) plus ridged fractal noise for mountain chains. Shaded with a
// directional hillshade so ridgelines read as terrain, not stickers.

/** Integer lattice hash → [0, 1). Deterministic for a given seed. */
export function hash2i(x: number, y: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x9e3779b1);
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0, 1]. */
export function valueNoise2D(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2i(xi, yi, seed);
  const b = hash2i(xi + 1, yi, seed);
  const c = hash2i(xi, yi + 1, seed);
  const d = hash2i(xi + 1, yi + 1, seed);
  const u = smootherstep(xf);
  const v = smootherstep(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal sum of value noise, normalized to [0, 1]. */
export function fbm2D(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(seed + o * 101, x * freq, y * freq);
    total += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / total;
}

/**
 * Elevation at normalized sprite coords (u, v in [-1, 1]).
 * 0 = ocean/shore, 1 = highest peak. Domain-warped radial falloff (natural,
 * non-circular coastlines, high interior, low coast) × ridged fractal noise
 * (crisp mountain chains) + rolling detail (lowlands aren't glassy).
 * 0 outside the unit disc — the unwarped disc edge is ALWAYS ocean, so every
 * landmass reads as an island.
 */
export function terrainElevation(seed: number, u: number, v: number): number {
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  // Domain warp → natural, non-circular coastlines.
  const wob = fbm2D(seed + 501, u * 1.7 + 3.1, v * 1.7 + 9.4, 3) - 0.5;
  const dw = d * (1 + 0.55 * wob);
  if (dw >= 1) return 0;
  const falloff = Math.pow(1 - dw, 0.8);
  // Ridged multifractal — crisp mountain chains.
  const n = fbm2D(seed, u * 4.2 + 11.7, v * 4.2 + 5.3, 5);
  const r = 1 - Math.abs(2 * n - 1);
  const ridge = r * r;
  // Rolling detail so lowlands aren't glassy.
  const detail = fbm2D(seed + 313, u * 7.5 + 1.3, v * 7.5 + 8.8, 3);
  // Per-landmass character: some jagged, some rolling.
  const roughness = 0.55 + 0.45 * hash2i(7, 13, seed);
  const relief = Math.min(1, ridge * roughness + detail * 0.4);
  // Hard coastal guarantee on the UNWARPED disc: the shoreline always
  // falls to ocean as d → 1, whatever the warp did.
  const cm = Math.min(1, Math.max(0, (d - 0.9) / 0.1));
  const coastMask = 1 - cm * cm * (3 - 2 * cm);
  const e = falloff * (0.3 + 0.7 * relief) * coastMask;
  return Math.min(1, Math.max(0, e));
}

/**
 * Full elevation field for one landmass sprite. Row-major, size×size,
 * coords span [-1, 1]. Computed ONCE per landmass at init — the render
 * loop never touches this.
 */
export function buildElevationGrid(seed: number, size: number): Float32Array {
  const grid = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / (size - 1)) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2 - 1;
      grid[y * size + x] = terrainElevation(seed, u, v);
    }
  }
  return grid;
}

// Elevation → color ramp: surf/shore → lowland teal-green → highland
// olive/amber → pale rock → snow peak.
const TERRAIN_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [172, 224, 190]], // surf line — pale rim at the waterline
  [0.08, [38, 122, 88]], // coastal lowland
  [0.3, [44, 141, 92]], // lowland green
  [0.52, [104, 122, 62]], // highland olive
  [0.7, [168, 127, 66]], // amber highland
  [0.86, [216, 207, 187]], // pale rock
  [1.0, [244, 239, 226]], // snow peak
];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * Elevation → [r, g, b]. hueJitter in [-1, 1] shifts each landmass's palette
 * slightly so the 46 landmasses don't look stamped from one swatch.
 */
export function terrainColor(e: number, hueJitter: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, e));
  let lo = TERRAIN_STOPS[0];
  let hi = TERRAIN_STOPS[TERRAIN_STOPS.length - 1];
  for (let i = 0; i < TERRAIN_STOPS.length - 1; i++) {
    if (c >= TERRAIN_STOPS[i][0] && c <= TERRAIN_STOPS[i + 1][0]) {
      lo = TERRAIN_STOPS[i];
      hi = TERRAIN_STOPS[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span > 0 ? (c - lo[0]) / span : 0;
  const r = lo[1][0] + (hi[1][0] - lo[1][0]) * t;
  const g = lo[1][1] + (hi[1][1] - lo[1][1]) * t;
  const b = lo[1][2] + (hi[1][2] - lo[1][2]) * t;
  if (hueJitter === 0) return [r, g, b];
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h + hueJitter * 0.03, s, l);
}

/**
 * Shade an elevation grid into RGBA pixels: directional hillshade (ridgelines
 * catch light on one flank, shadow on the other) + crevice darkening +
 * elevation palette + soft coastal alpha. Output is size*size*4, row-major.
 */
export function shadeTerrainGrid(
  grid: Float32Array,
  size: number,
  hueJitter: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const exaggerate = 3.4; // vertical exaggeration so relief reads at a glance
  // Low raking key light from the upper-left — relief casts readable shade.
  const lx = -0.62;
  const ly = -0.66;
  const lz = 0.42;
  const llen = Math.sqrt(lx * lx + ly * ly + lz * lz);
  for (let y = 0; y < size; y++) {
    const v = (y / (size - 1)) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2 - 1;
      const i = y * size + x;
      const o = i * 4;
      const d = Math.sqrt(u * u + v * v);
      // Soft coastal alpha: full land → transparent across d in [0.93, 1].
      let a = 0;
      if (d < 1) {
        const t = Math.min(1, Math.max(0, (d - 0.93) / 0.07));
        a = 1 - t * t * (3 - 2 * t);
      }
      if (a <= 0) {
        out[o + 3] = 0;
        continue;
      }
      // Central differences on the grid (clamped at borders).
      const xm = x > 0 ? i - 1 : i;
      const xp = x < size - 1 ? i + 1 : i;
      const ym = y > 0 ? i - size : i;
      const yp = y < size - 1 ? i + size : i;
      const gx = (grid[xp] - grid[xm]) * 0.5;
      const gy = (grid[yp] - grid[ym]) * 0.5;
      const nx = -gx * exaggerate;
      const ny = -gy * exaggerate;
      const nz = 1;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const diff = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nlen * llen));
      let shade = 0.55 + 0.45 * diff;
      // Crevice darkening: concave cells (negative laplacian) go darker.
      const lap = (grid[xm] + grid[xp] + grid[ym] + grid[yp]) * 0.25 - grid[i];
      if (lap < 0) shade *= Math.max(0.55, 1 + 1.2 * lap);
      const [r, g, b] = terrainColor(grid[i], hueJitter);
      out[o] = r * shade;
      out[o + 1] = g * shade;
      out[o + 2] = b * shade;
      out[o + 3] = a * 255;
    }
  }
  return out;
}

/**
 * Bake resolution for a landmass sprite from its angular radius. Blobs are
 * tens of px on screen — small sprites keep init fast and memory tiny.
 */
export function terrainSpriteSize(blobRadiusDeg: number): number {
  if (blobRadiusDeg < 8) return 64;
  if (blobRadiusDeg < 12) return 96;
  return 128;
}
