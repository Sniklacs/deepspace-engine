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
  | "arena"
  | "memorials"
  | "raids"
  | "satellites"
  | "beachhead";

/** Marker icon kinds (Hans, Oct 4 2026, night — WS2: icons, not dots).
 *  Accessibility: shape carries the meaning, not color. Each kind is a
 *  simple silhouette that reads at ~16px — no fine detail. WorldGlobe.tsx
 *  bakes one sprite per (kind, color) and blits it per marker. */
export type GlobeIconId =
  | "home" // the player's colony — bigger, unmistakable settlement
  | "raid" // crossed swords — incoming raid
  | "chorus" // the Chorus sigil — ring + core
  | "hut" // other players' colonies
  | "ember" // ember site / T1–T2 world site — flame teardrop
  | "chipset" // T3 / hard site — chipsets only drop in T3s
  | "husk" // dead colony — broken hut
  | "monument" // memorial — obelisk plaque
  | "satellite" // orbital watcher — parabolic dish silhouette
  | "beachhead" // beachhead banner — everyone knows where it is
  | "arena"; // stadium bowl — the arena's legend silhouette; the globe
             // itself renders the full stadium sprite (WorldGlobe.tsx)

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
  /** Representative icon shown in the legend next to the label. */
  icon: GlobeIconId;
}

/** Legend order = render order. */
export const GLOBE_LAYERS: GlobeLayerMeta[] = [
  { id: "home", label: "Your colony", color: "#fbbf24", defaultOn: true, blurb: "Home — tap to enter", icon: "home" },
  { id: "raids", label: "Incoming raids", color: "#ef4444", defaultOn: true, blurb: "Raid signatures inbound", icon: "raid" },
  // WS8 (Hans, Oct 4 2026): the beachhead is never hidden — everybody knows
  // where it is, so it rides its own default-on layer, never behind the
  // satellites toggle.
  { id: "beachhead", label: "Beachhead", color: "#fbbf24", defaultOn: true, blurb: "Invasion landing ground — open geography", icon: "beachhead" },
  { id: "chorus", label: "Chorus sites", color: "#f87171", defaultOn: true, blurb: "Raid ladder, grades I–V", icon: "chorus" },
  // WS-A (Hans, Oct 4 2026): the arena gets a marker on the globe — open to
  // everybody, so it's marked openly like the beachhead. Fuchsia glow, a
  // color no other layer uses (shape still carries the meaning).
  { id: "arena", label: "Arena", color: "#e879f9", defaultOn: true, blurb: "Open to everybody — duel & practice", icon: "arena" },
  { id: "colonies", label: "Colonies", color: "#34d399", defaultOn: true, blurb: "Known colonies by owner", icon: "hut" },
  { id: "sites", label: "World sites", color: "#7dd3fc", defaultOn: true, blurb: "T1 / T2 / T3 sites", icon: "ember" },
  { id: "husks", label: "Husks", color: "#9ca3af", defaultOn: true, blurb: "Dead colonies, claimable", icon: "husk" },
  { id: "memorials", label: "Memorials", color: "#fde68a", defaultOn: false, blurb: "Battle plaques", icon: "monument" },
  // GLOBE WAVE 3 WS2 (Hans, Oct 4 2026): satellites default ON — they're the
  // intel layer that explains what markers are. Users who toggled it off
  // keep their stored choice (merge in WorldGlobe.tsx only overrides the
  // default when a stored boolean exists for the layer).
  { id: "satellites", label: "Satellites", color: "#38bdf8", defaultOn: true, blurb: "Orbital coverage ring", icon: "satellite" },
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
  | { kind: "raid"; raid: IncomingRaidAlert }
  | { kind: "satellite"; zoneId: string; zoneName: string }
  | { kind: "beachhead" }
  | { kind: "arena" };

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
  /** Marker icon kind — shape carries the meaning, not the color. */
  icon: GlobeIconId;
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

// ---------------------------------------------------------------------------
// Hive relocation geography (Hans, Oct 4 2026, Globe Wave 2 WS-E): the
// player's colony can move to a hive set point on the globe.
// ---------------------------------------------------------------------------

/** v1 flavor scale: km per degree of great-circle distance. Earth-like on
 *  purpose — defense-response distances feel real on the confirmation
 *  panel. Never used for physics; physics uses degrees. */
export const GLOBE_KM_PER_DEGREE = 111;

/** The home colony's current globe position: the hive override when the
 *  player has relocated (worldmap.ts `homeGlobeOverride`), else the
 *  deterministic hash position. buildGlobeMarkers (home marker + raid fans)
 *  and snap-to-site share this so the globe and the raid panel always agree
 *  on where home is. Migration-safe: absent override = hash position. */
export function currentHomeGlobePosition(state: GameState): { lat: number; lon: number } {
  const override = state.worldMap?.homeGlobeOverride;
  if (override && Number.isFinite(override.lat) && Number.isFinite(override.lon)) {
    return { lat: override.lat, lon: override.lon };
  }
  return colonyGlobePosition("home:" + (state.gameId ?? "colony"));
}

/** Great-circle angular distance between two lat/lon points, in degrees.
 *  Haversine — the hive validator (min separation, move distance) and the
 *  defense-response delta both use it. Pure — tested in WorldGlobe.test.ts. */
export function greatCircleDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) * 180) / Math.PI;
}

/** Inverse of projectGlobe: unit-sphere screen coords (sx = px/R,
 *  sy = py/R, y-down like projectGlobe's output) → lat/lon for the current
 *  view (spinDeg/tiltDeg as the globe is rendered). Returns null when the
 *  point misses the sphere (beyond the limb — no valid lat/lon there).
 *  Powers hive pick-mode: tapping empty globe picks the hive point. Pure —
 *  tested in WorldGlobe.test.ts. */
export function unprojectGlobe(
  sx: number,
  sy: number,
  spinDeg: number,
  tiltDeg: number,
): { lat: number; lon: number } | null {
  // projectGlobe emits y = -y2, so y2 = -sy; x2 = sx.
  const x2 = sx;
  const y2 = -sy;
  const rr = x2 * x2 + y2 * y2;
  if (rr > 1) return null;
  const z2 = Math.sqrt(Math.max(0, 1 - rr));
  // reverse the tilt-about-X: (y1, z1) = (y2 cos t + z2 sin t, -y2 sin t + z2 cos t)
  const t = (tiltDeg * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const y1 = y2 * ct + z2 * st;
  const z1 = -y2 * st + z2 * ct;
  // reverse the spin-about-Y: (x0, z0) = (x1 cos s - z1 sin s, x1 sin s + z1 cos s)
  const s = (spinDeg * Math.PI) / 180;
  const cs = Math.cos(s);
  const ss = Math.sin(s);
  const x0 = x2 * cs - z1 * ss;
  const z0 = x2 * ss + z1 * cs;
  const lat = (Math.asin(Math.max(-1, Math.min(1, y1))) * 180) / Math.PI;
  let lon = (Math.atan2(x0, z0) * 180) / Math.PI;
  lon = ((lon + 540) % 360) - 180;
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
// WS2+WS3 icon metadata + satellite/beachhead geography (Hans, Oct 4 2026)
// ---------------------------------------------------------------------------

/** World-site marker icon: T3/hard sites get the chipset (chipsets only
 *  drop in T3s); T1/T2 sites get the ember flame. */
export function siteMarkerIcon(tier: 1 | 2 | 3): GlobeIconId {
  return tier === 3 ? "chipset" : "ember";
}

/** Satellite watch position: rendered NEXT TO the site it watches, like any
 *  map — offset a few degrees northeast so it never stacks on the site
 *  marker. Pure coordination layer only (full intel mechanics are future). */
export function satelliteWatchPosition(
  zoneId: string,
  tier: 1 | 2 | 3,
): { lat: number; lon: number } {
  const s = worldSiteGlobePosition(zoneId, tier);
  const lat = Math.max(-78, Math.min(78, s.lat + 5 + hash01(zoneId + ":slat") * 3));
  let lon = s.lon + 6 + hash01(zoneId + ":slon") * 3;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

/** The Chorus-held heart: the HEART ZONE's position (the hardest Chorus
 *  ground on the globe). Named by zone, never by sort order — the old
 *  "first grade-V site" read happened to land there only by name sorting. */
export function chorusHeartGlobePosition(): { lat: number; lon: number } {
  const heart = chorusSiteIntel().find((s) => s.isHeart) ?? chorusSiteIntel()[0];
  return { lat: heart.lat, lon: heart.lon };
}

/** The beachhead: fixed, open geography — everyone knows where it is, so it
 *  is marked openly. Deterministic constant (not hashed) so players can
 *  learn it. */
export function beachheadGlobePosition(): { lat: number; lon: number } {
  return { lat: 12, lon: 100 };
}

/** The arena: fixed, open geography — a little stadium everyone can see,
 *  and everyone can enter. Equatorial and well clear of the beachhead
 *  (12, 100) and of the T1–T3 tier clusters, so it always has room to
 *  breathe. Deterministic constant (not hashed) so players can learn it. */
export function arenaGlobePosition(): { lat: number; lon: number } {
  return { lat: -8, lon: -40 };
}

// ---------------------------------------------------------------------------
// WS7 layer filters (Hans, Oct 4 2026): real filter control as layers grow.
// Site tiers filter T1/T2/T3 markers independently of the layer toggle.
// ---------------------------------------------------------------------------

export interface GlobeFilters {
  /** Which site tiers (T1/T2/T3) are visible. True = shown. */
  siteTiers: Record<1 | 2 | 3, boolean>;
}

export const DEFAULT_GLOBE_FILTERS: GlobeFilters = {
  siteTiers: { 1: true, 2: true, 3: true },
};

export const SITE_TIER_LIST: ReadonlyArray<1 | 2 | 3> = [1, 2, 3];

/**
 * Apply filter state to a marker set. Pure. The layer toggle still gates
 * whole layers — this only narrows within them. Unknown/empty input reads
 * as DEFAULT_GLOBE_FILTERS (filters never hide anything by accident).
 */
export function applyGlobeFilters(markers: GlobeMarker[], filters: Partial<GlobeFilters>): GlobeMarker[] {
  const tiers: Record<1 | 2 | 3, boolean> = {
    1: filters.siteTiers?.[1] ?? true,
    2: filters.siteTiers?.[2] ?? true,
    3: filters.siteTiers?.[3] ?? true,
  };
  if (tiers[1] && tiers[2] && tiers[3]) return markers;
  return markers.filter((m) => {
    if (m.ref.kind === "site") return tiers[m.ref.tier];
    return true;
  });
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

/** Marker glow color per world-site tier (exported for the WS7 tier chips). */
export const GLOBE_SITE_TIER_COLOR = SITE_TIER_COLOR;

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

  // Home — the player's own colony. Distinct gold marker, top priority.
  // Hive relocation (WS-E): the override is the position once set.
  const homePos = currentHomeGlobePosition(state);
  const homeLabel = state.playerName ? colonyMarkerName(state.playerName) : "Your colony";
  markers.push({
    id: "home",
    layer: "home",
    lat: homePos.lat,
    lon: homePos.lon,
    label: homeLabel,
    sublabel: "HOME",
    color: GLOBE_LAYER_META.home.color,
    icon: "home",
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
      icon: "raid",
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
      label: site.isHeart ? `❖ ${site.siteName}` : site.siteName,
      sublabel: site.isHeart
        ? `The Chorus Heart · Reverb ~${site.recommendedReverb.toLocaleString()}`
        : `Grade ${site.gradeLabel} · Reverb ~${site.recommendedReverb.toLocaleString()}`,
      color: CHORUS_GRADE_COLOR[site.grade] ?? "#ef4444",
      icon: "chorus",
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
      icon: isHusk ? "husk" : "hut",
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
      icon: siteMarkerIcon(tier),
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
      icon: "monument",
      priority: 35,
      ref: { kind: "memorial", nodeId, name: zoneName(nodeId) },
    });
  }

  // WS3 (Hans, Oct 4 2026): satellites render next to their sites like any
  // map — one watcher per contestable world site (T1/T2/T3) plus one over
  // the Chorus-held heart. Visual coordination layer ONLY: stage colors,
  // blind-spot invisibility and the full intel mechanics are future design
  // (satellites.md) and are NOT built here.
  for (const zone of ZONES) {
    const tier = siteTier(zone.risk);
    const pos = satelliteWatchPosition(zone.id, tier);
    markers.push({
      id: `sat:${zone.id}`,
      layer: "satellites",
      lat: pos.lat,
      lon: pos.lon,
      label: `${zone.name} watch`,
      sublabel: `Satellite — T${tier} site`,
      color: GLOBE_LAYER_META.satellites.color,
      icon: "satellite",
      priority: 30,
      ref: { kind: "satellite", zoneId: zone.id, zoneName: zone.name },
    });
  }
  const heartPos = chorusHeartGlobePosition();
  markers.push({
    id: "sat:heart",
    layer: "satellites",
    lat: heartPos.lat,
    lon: heartPos.lon,
    label: "Chorus heart watch",
    sublabel: "Satellite — Chorus-held heart",
    color: GLOBE_LAYER_META.satellites.color,
    icon: "satellite",
    priority: 32,
    ref: { kind: "satellite", zoneId: "heart", zoneName: "Chorus heart" },
  });

  // WS3: the beachhead is open geography — everyone knows where it is, so
  // it is marked openly. WS8: rides its own default-on layer (never hidden
  // behind another layer's toggle). High declutter priority so it never
  // hides under other markers.
  const bh = beachheadGlobePosition();
  markers.push({
    id: "beachhead",
    layer: "beachhead",
    lat: bh.lat,
    lon: bh.lon,
    label: "The Beachhead",
    sublabel: "Invasion landing ground",
    color: "#fbbf24",
    icon: "beachhead",
    priority: 65,
    ref: { kind: "beachhead" },
  });

  // WS-A (Hans, Oct 4 2026): the arena is open to everybody, so it sits on
  // the world map like the beachhead — openly marked. On the globe it
  // renders as a full stadium sprite, not a dot-icon (WorldGlobe.tsx).
  // High declutter priority so the stadium never hides behind a marker fan.
  const arenaPos = arenaGlobePosition();
  markers.push({
    id: "arena",
    layer: "arena",
    lat: arenaPos.lat,
    lon: arenaPos.lon,
    label: "The Arena",
    sublabel: "Open to everybody — duel & practice",
    color: GLOBE_LAYER_META.arena.color,
    icon: "arena",
    priority: 75,
    ref: { kind: "arena" },
  });

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
// WAVE 3 (Oct 4 2026): irregular coastlines (angular shoreline noise —
// bays, peninsulas, headlands; no discs), directional mountain RANGES along
// a per-landmass dominant axis, sandy beach bands, guaranteed snow caps on
// medium/large landmasses, and biome palettes (verdant / arid great-plains /
// temperate) so regions feel like different places.
//
// Pure + seeded (deterministic per landmass). One elevation FIELD per
// landmass: plateau falloff from the ANGULAR shoreline (high interior, low
// coast) × directional ridged fractal noise (mountain ranges along the
// dominant axis) + rolling detail + gaussian snow-cap anchors. Shaded with
// a directional hillshade so ridgelines read as terrain, not stickers.
//
// Palette + relief constants live in TERRAIN_TUNING / TERRAIN_STOPS —
// Hans whacks the look there, never in the math below.

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
 * Hans's terrain tuning knobs (WAVE 3, Oct 4 2026). Everything that sets the
 * LOOK of the landmasses lives here — whack these, not the math below.
 */
export const TERRAIN_TUNING = {
  /** Mean shoreline radius, in sprite-disc units (the disc spans [-1, 1]). */
  coastBaseRadius: 0.78,
  /** Per-landmass coastline irregularity: the shoreline noise amplitude is
   *  drawn per seed from [min, max]. 0.30–0.50 → bays, peninsulas,
   *  headlands; every landmass reads as real terrain, never a disc. */
  coastAmpMin: 0.3,
  coastAmpMax: 0.5,
  /** Shoreline radius clamp — keeps every coast inside the sprite disc with
   *  room for the beach band and the shallow shelf outside it. */
  coastMinRadius: 0.55,
  coastMaxRadius: 0.92,
  /** Elevation below this reads as beach sand (palette), not grass. */
  sandElevation: 0.07,
  /** Coastal alpha feathers out across [0, shoreFeather] → the waterline is
   *  crisp but anti-aliased; the sand band stays visible over the shelf. */
  shoreFeather: 0.05,
  /** Dominant ridge axis: ridged noise runs ridgeFreqAcross across the axis
   *  and ridgeFreqAlong along it → long mountain RANGES, not radial blobs. */
  ridgeFreqAlong: 2.6,
  ridgeFreqAcross: 7.5,
  /** Domain-warp on the ridge field so the ranges aren't ruler-straight. */
  ridgeWarp: 0.35,
  /** Low raking key light from the upper-left + vertical exaggeration, so
   *  relief casts readable shade at a glance. */
  lightX: -0.62,
  lightY: -0.66,
  lightZ: 0.42,
  exaggerate: 3.4,
  /** Elevation at/above this renders snow (palette stop at 1.0). */
  snowLine: 0.93,
} as const;

/** Landmass size class — drives the snow-cap anchors (bigger landmass = real peaks). */
export type TerrainSizeClass = "small" | "medium" | "large";

/**
 * Bake-grid size → size class. Mirrors terrainSpriteSize: 64px sprites bake
 * 51px grids (small), 96px → 77px (medium), 128px → 102px (large).
 */
export function terrainSizeClass(gridSize: number): TerrainSizeClass {
  if (gridSize <= 60) return "small";
  if (gridSize <= 90) return "medium";
  return "large";
}

const COAST_SEED_A = 501;
const COAST_SEED_B = 917;

// Shoreline lookup: the per-pixel elevation loop needs R(θ) at every pixel,
// so each landmass precomputes its coastline once into a 512-sample table
// and the hot path interpolates. Same coastline, ~5× cheaper than raw fbm.
const COAST_TABLE_SIZE = 512;
const coastTableCache = new Map<number, Float32Array>();
function coastTable(seed: number): Float32Array {
  let t = coastTableCache.get(seed);
  if (!t) {
    t = new Float32Array(COAST_TABLE_SIZE);
    for (let k = 0; k < COAST_TABLE_SIZE; k++) {
      t[k] = shorelineRadius(seed, (k / COAST_TABLE_SIZE) * Math.PI * 2);
    }
    coastTableCache.set(seed, t);
  }
  return t;
}

/** Fast R(θ): linear interpolation over the landmass's coastline table. */
function shorelineRadiusFast(seed: number, theta: number): number {
  const t = coastTable(seed);
  const x = ((theta / (Math.PI * 2)) % 1 + 1) % 1 * COAST_TABLE_SIZE;
  const k0 = Math.floor(x) % COAST_TABLE_SIZE;
  const k1 = (k0 + 1) % COAST_TABLE_SIZE;
  const f = x - Math.floor(x);
  return t[k0] * (1 - f) + t[k1] * f;
}

/**
 * Shoreline radius at angle theta (radians) for a landmass seed. The coast
 * is ANGULAR noise — the radius varies substantially around every
 * landmass, so bays, peninsulas, and headlands emerge naturally and no
 * landmass is a disc. Sampled on the circle (cos θ, sin θ), so it's
 * seamless at θ = ±π. In sprite-disc units, clamped to
 * [coastMinRadius, coastMaxRadius].
 */
export function shorelineRadius(seed: number, theta: number): number {
  const t = TERRAIN_TUNING;
  const cx = Math.cos(theta);
  const sx = Math.sin(theta);
  // Low-frequency swell + higher-frequency wiggle, contrast-boosted so the
  // coast actually swings (raw fbm hugs the middle of its range).
  const n1 = fbm2D(seed + COAST_SEED_A, cx * 2.8 + 3.7, sx * 2.8 + 11.2, 2) - 0.5;
  const n2 = fbm2D(seed + COAST_SEED_B, cx * 5.6 + 8.9, sx * 5.6 + 2.6, 2) - 0.5;
  let coast = n1 * 2.2 + n2 * 1.0;
  coast = Math.max(-1, Math.min(1, coast));
  const amp = t.coastAmpMin + (t.coastAmpMax - t.coastAmpMin) * hash2i(41, 7, seed);
  const r = t.coastBaseRadius * (1 + amp * coast);
  return Math.min(t.coastMaxRadius, Math.max(t.coastMinRadius, r));
}

/** Dominant ridge-axis angle (radians) for a landmass seed. */
export function ridgeAxisAngle(seed: number): number {
  return Math.PI * hash2i(3, 11, seed);
}

/** One snow-cap anchor: a mountain peak (summit + rocky shoulder) laid over
 *  the elevation field with max(). Elliptical along the ridge axis. */
export interface TerrainPeak {
  x: number;
  y: number;
  amp: number;
  sigma: number;
}

/**
 * Snow-cap anchors strung along the ridge axis. Medium/large landmasses get
 * peaks tall enough to reach the snow line (WAVE 3: maxima must touch
 * snow); small islets get one high point that usually stops at rock.
 * Deterministic per seed; every anchor sits well inside the minimum
 * shoreline radius, so peaks never poke through the coast.
 */
export function terrainPeaks(seed: number, sizeClass: TerrainSizeClass): TerrainPeak[] {
  const phi = ridgeAxisAngle(seed);
  const ca = Math.cos(phi);
  const sa = Math.sin(phi);
  const along =
    sizeClass === "large" ? [-0.42, 0.03, 0.4] : sizeClass === "medium" ? [-0.3, 0.28] : [0.0];
  const amp = sizeClass === "small" ? 0.82 : 0.96;
  const sigma = sizeClass === "large" ? 0.1 : sizeClass === "medium" ? 0.09 : 0.08;
  return along.map((a, i) => {
    // Interior, strung along the ridge axis: ranges get peaks, not the beach.
    const s = a * 0.7 + (hash2i(200 + i, 3, seed) - 0.5) * 0.2;
    const c = (hash2i(200 + i, 17, seed) - 0.5) * 0.35;
    return { x: s * ca - c * sa, y: s * sa + c * ca, amp, sigma };
  });
}

// Peak anchors are per-(seed, class) constants — cache them so the
// per-pixel elevation loop never allocates.
const peaksCache = new Map<string, TerrainPeak[]>();
function cachedPeaks(seed: number, sizeClass: TerrainSizeClass): TerrainPeak[] {
  const k = seed + ":" + sizeClass;
  let p = peaksCache.get(k);
  if (!p) {
    p = terrainPeaks(seed, sizeClass);
    peaksCache.set(k, p);
  }
  return p;
}

/**
 * Elevation at normalized sprite coords (u, v in [-1, 1]).
 * 0 = ocean, 1 = highest peak. Interior = plateau falloff from the ANGULAR
 * shoreline (rr = d / R(θ): 0 at the center, 1 at the waterline) ×
 * directional ridged relief (mountain ranges along the landmass's dominant
 * axis) + rolling detail + gaussian snow-cap anchors. 0 outside the
 * shoreline — the coast is wherever rr hits 1, so bays and peninsulas are
 * real geography, not a warp on a disc.
 *
 * sizeClass drives the peak anchors: "large" gives the full mountain
 * treatment (the default keeps the old terrainElevation(seed, u, v) call
 * shape working); buildElevationGrid derives it from the bake size.
 */
export function terrainElevation(
  seed: number,
  u: number,
  v: number,
  sizeClass: TerrainSizeClass = "large",
): number {
  const t = TERRAIN_TUNING;
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  const R = shorelineRadiusFast(seed, Math.atan2(v, u));
  const rr = d / R;
  if (rr >= 1) return 0;
  // Plateau falloff: high interior with a gentle top, steepening toward the
  // shore — reads as terrain, not a cone and not a pancake.
  const falloff = Math.pow(1 - smootherstep(rr), 0.85);
  // Directional ridged relief along the dominant axis.
  const phi = ridgeAxisAngle(seed);
  const ca = Math.cos(phi);
  const sa = Math.sin(phi);
  const ax = u * ca + v * sa; // along the range
  const bx = -u * sa + v * ca; // across the range
  // Domain warp so the ranges aren't ruler-straight.
  const wx = fbm2D(seed + 313, u * 3.1 + 1.3, v * 3.1 + 8.8, 2) - 0.5;
  const wy = fbm2D(seed + 313, u * 3.1 + 4.9, v * 3.1 + 2.2, 2) - 0.5;
  const nR = fbm2D(
    seed + 701,
    (ax + wx * t.ridgeWarp) * t.ridgeFreqAlong + 11.7,
    (bx + wy * t.ridgeWarp) * t.ridgeFreqAcross + 5.3,
    4,
  );
  const ridgeAniso = Math.pow(1 - Math.abs(2 * nR - 1), 1.6);
  // Isotropic texture so the ranges don't read as corduroy.
  const nI = fbm2D(seed + 702, u * 4.6 + 3.3, v * 4.6 + 7.1, 3);
  const ridgeIso = Math.pow(1 - Math.abs(2 * nI - 1), 2);
  const ridge = Math.max(ridgeAniso, 0.5 * ridgeIso);
  // Rolling detail so lowlands aren't glassy.
  const detail = fbm2D(seed + 313, u * 7.5 + 1.3, v * 7.5 + 8.8, 3);
  // Per-landmass character: some jagged, some rolling.
  const roughness = 0.55 + 0.45 * hash2i(7, 13, seed);
  const relief = Math.min(1, ridge * roughness * 1.2 + detail * 0.28);
  // Shaped relief: crests pop into the high bands, valleys stay lowland.
  let e = falloff * (0.3 + 0.7 * Math.pow(relief, 1.25));
  // Snow-cap anchors — guaranteed maxima on medium/large landmasses.
  // Mountain profile (summit + wide rocky shoulder) laid over the field
  // with max(): the cap is exactly amp tall, so small islets stop at rock
  // while medium/large are guaranteed to touch the snow line. Elliptical
  // along the ridge axis with a noisy edge — summits, not golf balls.
  // peakFade pulls the caps back as rr → 1 so a peak can never leak past
  // the shoreline.
  const peakFade = 1 - smootherstep(Math.min(1, Math.max(0, (rr - 0.8) / 0.2)));
  if (peakFade > 0) {
    for (const p of cachedPeaks(seed, sizeClass)) {
      const dx = u - p.x;
      const dy = v - p.y;
      const da = dx * ca + dy * sa; // along the range
      const dc = -dx * sa + dy * ca; // across the range
      const r0 = Math.sqrt((da / 1.5) * (da / 1.5) + (dc / 0.75) * (dc / 0.75));
      if (r0 > p.sigma * 3.4) continue; // outside the cap entirely — skip the trig
      // Noisy cap edge: sample the noise on the circle so it's seamless.
      const pa = Math.atan2(dy, dx);
      const edgeN =
        valueNoise2D(seed + 911, Math.cos(pa) * 1.5 + p.x * 7.7, Math.sin(pa) * 1.5 + p.y * 3.1) -
        0.5;
      const pd = r0 * (1 + 0.45 * edgeN);
      const shoulder = Math.min(1, Math.max(0, (pd - p.sigma) / (1.4 * p.sigma)));
      const cap = peakFade * p.amp * (1 - smootherstep(shoulder));
      if (cap > e) e = cap;
    }
  }
  return Math.min(1, Math.max(0, e));
}

/**
 * Full elevation field for one landmass sprite. Row-major, size×size,
 * coords span [-1, 1]. Computed ONCE per landmass at init — the render
 * loop never touches this. The size class (→ snow-cap anchors) is derived
 * from the bake size, mirroring terrainSpriteSize.
 */
export function buildElevationGrid(seed: number, size: number): Float32Array {
  const sizeClass = terrainSizeClass(size);
  const grid = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / (size - 1)) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2 - 1;
      grid[y * size + x] = terrainElevation(seed, u, v, sizeClass);
    }
  }
  return grid;
}

// Elevation → color ramp: beach sand → coastal lowland → lowland green →
// great-plains grassland (golden) → highland amber → rock foothills →
// pale rock → snow peak. Biome bands, not one stamped gradient.
const TERRAIN_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [206, 196, 168]], // wet sand at the waterline — pale and warm
  [0.055, [224, 206, 162]], // dry beach sand
  [0.11, [52, 128, 90]], // coastal lowland
  [0.24, [58, 148, 96]], // lowland green
  [0.4, [122, 138, 74]], // great-plains grassland — golden green
  [0.56, [146, 122, 72]], // highland amber
  [0.7, [150, 118, 88]], // rock foothills — warm grey-brown
  [0.86, [214, 205, 185]], // pale rock
  [1.0, [246, 242, 230]], // snow peak
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
 * Elevation → [r, g, b]. hueJitter in [-1, 1] sets the landmass's BIOME
 * family as well as a small palette shift, so the 46 landmasses read as
 * different places, not one stamped texture:
 *   hueJitter ≤ -1/3 → arid great-plains (golden, warm)
 *   hueJitter ≥ +1/3 → verdant (lush, saturated greens)
 *   otherwise        → temperate (the middle ramp, near-neutral)
 * The shift only touches low/mid elevations (e < 0.56) — mountains stay
 * rocky and snow stays snow on every landmass.
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
  let r = lo[1][0] + (hi[1][0] - lo[1][0]) * t;
  let g = lo[1][1] + (hi[1][1] - lo[1][1]) * t;
  let b = lo[1][2] + (hi[1][2] - lo[1][2]) * t;
  if (c < 0.56) {
    const [h, s, l] = rgbToHsl(r, g, b);
    if (hueJitter <= -1 / 3) {
      // arid great-plains: warmer, more golden
      [r, g, b] = hslToRgb(h - 0.022, Math.min(1, s * 1.12), l);
    } else if (hueJitter >= 1 / 3) {
      // verdant: lusher, deeper greens
      [r, g, b] = hslToRgb(h + 0.016, Math.min(1, s * 1.16), l);
    } else if (hueJitter !== 0) {
      [r, g, b] = hslToRgb(h + hueJitter * 0.01, s, l);
    }
  } else if (hueJitter !== 0) {
    const [h, s, l] = rgbToHsl(r, g, b);
    [r, g, b] = hslToRgb(h + hueJitter * 0.008, s, l);
  }
  return [r, g, b];
}

/**
 * Shade an elevation grid into RGBA pixels: directional hillshade (ridgelines
 * catch light on one flank, shadow on the other) + crevice darkening +
 * elevation palette + shoreline-following coastal alpha. Output is
 * size*size*4, row-major.
 */
export function shadeTerrainGrid(
  grid: Float32Array,
  size: number,
  hueJitter: number,
): Uint8ClampedArray<ArrayBuffer> {
  const t = TERRAIN_TUNING;
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const llen = Math.sqrt(t.lightX * t.lightX + t.lightY * t.lightY + t.lightZ * t.lightZ);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = i * 4;
      const e = grid[i];
      // Coastal alpha from ELEVATION, not geometry: the shoreline is
      // wherever e falls to 0, so alpha follows the actual (irregular)
      // coast. The waterline feathers across [0, shoreFeather] — sandy
      // shallows over the shelf water, not a hard cut and not a glow halo.
      let a = 0;
      if (e > 0) {
        const s = Math.min(1, e / t.shoreFeather);
        a = s * s * (3 - 2 * s);
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
      const nx = -gx * t.exaggerate;
      const ny = -gy * t.exaggerate;
      const nz = 1;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const diff = Math.max(
        0,
        (nx * t.lightX + ny * t.lightY + nz * t.lightZ) / (nlen * llen),
      );
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
