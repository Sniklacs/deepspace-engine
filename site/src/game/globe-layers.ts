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
