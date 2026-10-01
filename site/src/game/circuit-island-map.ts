// ============================================================================
// CIRCUIT ISLAND MAP — the owner's island as THE Circuit map
// (the "Circuit Map" web artifact's world-map art + node placement).
//
// PRESENTATION ONLY: map.ts / zones.ts stay untouched (atlas-tests assert
// their layout law). Every coordinate here is in ISLAND space (1120×2240,
// the art's own pixels); the renderer draws the art full-bleed and pins the
// node markers to these points, so markers never drift off their terrain.
//
// Node positions are the artifact's `var NODES` table, keyed by GAME node
// id. Geography, north → south: volcanic peaks (the Chorus-held heart),
// ice mountains (T3 deep), ash barrens (T1 outer rim), misty highlands
// (T2 mid-depth), forests + farmlands (near ring, home-protected), the
// walled harbor city (the Cradle).
// ============================================================================

/** The art's own pixel space — the render canvas is exactly this. */
export const ISLAND_W = 1120;
export const ISLAND_H = 2240;

/** The island art, full-bleed base layer of the Circuit map. */
export const ISLAND_IMAGE = "/art/pages/circuit-island.webp";

export interface IslandPoint {
  x: number;
  y: number;
}

/** Game node id → island-space position (from the owner's artifact). */
export const ISLAND_POSITIONS: Record<string, IslandPoint> = {
  // the prize · the threat — volcanic peaks
  "dark-matter-observatory": { x: 560, y: 168 },
  // the deep · T3 — ice mountains
  "quantum-facility": { x: 190, y: 493 },
  "starfall-core": { x: 414, y: 459 },
  "deep-vaults": { x: 582, y: 504 },
  "null-engine": { x: 706, y: 470 },
  "collider-ruins": { x: 907, y: 482 },
  // the outer rim · T1 — ash barrens
  "forge-valleys": { x: 112, y: 750 },
  "ash-columns": { x: 314, y: 706 },
  "shard-fields": { x: 504, y: 762 },
  "quarry-edge": { x: 694, y: 750 },
  "rust-gardens": { x: 874, y: 762 },
  boneyard: { x: 975, y: 739 },
  // mid-depth · T2 — misty highlands
  "shattered-academies": { x: 241, y: 1109 },
  "wailing-towers": { x: 426, y: 1064 },
  "glass-harbor": { x: 582, y: 1098 },
  "titan-breaks": { x: 762, y: 1053 },
  "murmur-sumps": { x: 918, y: 1109 },
  // the near ring · home-protected — forests
  "hollow-warrens": { x: 146, y: 1400 },
  "lantern-reach": { x: 291, y: 1378 },
  "tram-yards": { x: 493, y: 1400 },
  observatories: { x: 644, y: 1367 },
  "relay-spires": { x: 806, y: 1400 },
  "outer-ruins": { x: 963, y: 1389 },
  // the near ring · home-protected — farmlands
  "cinder-farms": { x: 224, y: 1579 },
  "sigil-plaza": { x: 403, y: 1613 },
  "hearth-lanes": { x: 560, y: 1590 },
  "grain-silos": { x: 706, y: 1613 },
  "watchtower-row": { x: 874, y: 1590 },
  "pump-stations": { x: 969, y: 1602 },
  // the Cradle — walled harbor city
  cradle: { x: 560, y: 2050 },
};

/** Fallback when a node id has no island position (never expected — every
 *  game node is in the table above). Dead centre of the island. */
export const ISLAND_FALLBACK: IslandPoint = { x: 560, y: 1120 };

export function islandPos(id: string): IslandPoint {
  return ISLAND_POSITIONS[id] ?? ISLAND_FALLBACK;
}

/** Region seam banners from the owner's map — decorative, non-interactive.
 *  yPct is a fraction of ISLAND_H, matching the artifact's seam positions. */
export interface SeamBand {
  label: string;
  yPct: number;
}

export const SEAM_BANDS: SeamBand[] = [
  { label: "THE PRIZE · THE THREAT", yPct: 0.032 },
  { label: "THE DEEP · T3", yPct: 0.273 },
  { label: "THE OUTER RIM · T1", yPct: 0.41 },
  { label: "MID-DEPTH · T2", yPct: 0.562 },
  { label: "THE NEAR RING · HOME-PROTECTED", yPct: 0.795 },
];

/** ORBITAL WATCH ring on the island: an ellipse in the ocean around the
 *  landmass, one marker per covered satellite. */
export const ISLAND_SAT_RING = {
  cx: 560,
  cy: 1120,
  rx: 532,
  ry: 1082,
  markerR: 5,
} as const;

/** Rim node fill on terrain: the 22% surf-0 recipe (TIER_FILL_OPACITY) was
 *  tuned for a near-black underlay and washes out over ice and farmland, so
 *  the island render uses a denser wash — same tier hues, still translucent. */
export const ISLAND_RIM_FILL_OPACITY = 0.55;

/** Traces on terrain: old roads at a whisper so the survey art reads first. */
export const ISLAND_TRACE = {
  roadOpacity: 0.3,
  roadWidth: 1.5,
  ruinOpacity: 0.4,
  severedOpacity: 0.5,
} as const;
