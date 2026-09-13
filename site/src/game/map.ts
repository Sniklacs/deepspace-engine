// ============================================================================
// WORLD ATLAS — the shattered circuit-web (design/world-map-design.md §3).
//
// The map IS the world: this module reuses the existing Shatterlands geography
// 1:1 (zones.ts) as a node graph — six Burning-Rim territories (contestable in
// a war week, range >= 60), four home-protected Near-Ring zones (never
// contestable), the Chorus-held heart at the web's core (the deep-most T3
// scientific site — dark-matter-observatory on every world, W2), and The Cradle
// at the bottom home edge.
//
// HOUSE STANDARDS (V8 — same spine as daily.ts):
//   • PURE module — deterministic seeded node-graph generation (xmur3 +
//     mulberry32 on the world id). ZERO Math.random anywhere in the field.
//   • ONE config block (ATLAS_CONFIG + ZONE_PROFILES) — every tunable number
//     lives here; the spec's published formulas (richness/position/chorus →
//     score → tier) are computed from zones.ts data, not hand-entered.
//   • Atlas = READ-ONLY WORLD GEOGRAPHY. Zero war state: no holders, no
//     pairing, no ownership, no FOBs, no enemy info, no scores-as-results.
//     The war overlay (zone states, holders, incursions) arrives with the
//     battle-side Phase 1 and renders SERVER-computed state on top of this
//     static shell (spec §3.6 — layout is the only client-computed thing).
//
// Client-rendered from this module: with zero mutable state, the output of a
// pure function is identical on server and client, so "server-authoritative"
// is preserved by construction — the module only ever produces public
// geography, and the war layer will ship its own server-computed view.
// ============================================================================
import { ZONES, getZone } from "./zones";
// ----------------------------------------------------------------------------
// §1 CONFIG — ONE place for every tunable number. All ratified defaults
// (M1/M2/M3/M8 + §1.2/§1.3/§2.1/§2.2 published constants).
// ----------------------------------------------------------------------------
export const ATLAS_CONFIG = {
  salt: "atlas:v1:",
  viewBox: { w: 360, h: 520 } as const,
  /** Cosmetic seeded position wobble (viewBox units). */
  jitter: 6,
  /** Probability a traverse edge drifts road ↔ ruin-pass per world (the
   *  circuit's wiring differs from world to world — history-shaped). */
  kindDrift: 0.15,
  /** Published importance formula (spec §2.1, M3): sub-score weights. */
  importanceWeights: { richness: 0.5, position: 0.3, chorus: 0.2 } as const,
  /** Richness = 0.4·(ember/90) + 0.4·(chip/0.45) + 0.2·plasmaPresence. */
  richness: { emberWeight: 0.4, chipsetWeight: 0.4, plasmaWeight: 0.2, emberNorm: 90, chipsetNorm: 0.45 } as const,
  /** Chipsets expected/day = chipsetChance × 4 (§1.3). */
  chipsetTicksPerDay: 4,
  /** Tier thresholds (M3 — published): T1 < 0.40, T2 0.40–0.70, T3 > 0.70. */
  tier: { t1Max: 0.4, t2Max: 0.7 } as const,
  /** Strategic position components (authored per zone; the §2.1 formula
   *  0.6·invasionAdjacency + 0.4·hubness reproduces the spec's published
   *  position table EXACTLY — hubness = degree in the rim chain / 4). */
  positionBreakdown: {
    "forge-valleys": { adjacency: 0.25, hubness: 0.25 },
    "boneyard": { adjacency: 1 / 3, hubness: 0.5 },
    "shattered-academies": { adjacency: 0.55, hubness: 0.75 },
    "quantum-facility": { adjacency: 0.7, hubness: 0.75 },
    "collider-ruins": { adjacency: 0.6833333333, hubness: 0.75 },
    "dark-matter-observatory": { adjacency: 0.8833333333, hubness: 0.5 },
  } as const,
  /** §2.2 per-tier war constants (ratified, published — PRE-WIRED for the war
   *  layer, NEVER rendered in the Atlas shell UI; they arrive with Phase 1). */
  war: {
    scoreTickPerBucket: { t1: 1, t2: 2, t3: 4 } as const,
    captureScore: { t1: 1, t2: 2, t3: 4 } as const,
    tithePer6h: { t1: 2, t2: 5, t3: 12 } as const,
    chorusDrawPerBucket: { t1: 0.5, t2: 1, t3: 2 } as const,
    incursionOddsPerBucket: { t2: 0.04, t3: 0.09 } as const,
  } as const,
} as const;
export type Tier = 1 | 2 | 3;
export type NodeKind = "heart" | "rim" | "near" | "cradle";
export type EdgeKind = "road" | "ruinPass" | "severed";
/** §1.3 per-territory resource profile (world geography — public). */
export interface ZoneProfile {
  embersPerDay: [number, number]; // band [lo, hi]
  chipsetsPerDay: number; // expected/day (= chipsetChance × 4)
  plasmaPerDay: [number, number] | null; // deep sites only
  mat: string | null; // war-captured territory material (race id)
  tier: Tier; // must equal the computed importance tier (asserted)
}
/** Authored §1.3 defaults (M8: "bands and tick rates default pending balance"). */
export const ZONE_PROFILES: Record<string, ZoneProfile> = {
  "forge-valleys": { embersPerDay: [110, 248], chipsetsPerDay: 0.36, plasmaPerDay: null, mat: "anunnaki", tier: 1 },
  "boneyard": { embersPerDay: [90, 203], chipsetsPerDay: 0.4, plasmaPerDay: null, mat: "nephilim", tier: 1 },
  "shattered-academies": { embersPerDay: [100, 225], chipsetsPerDay: 0.72, plasmaPerDay: null, mat: "watchers", tier: 2 },
  "quantum-facility": { embersPerDay: [120, 270], chipsetsPerDay: 1.2, plasmaPerDay: [0, 2], mat: null, tier: 2 },
  "collider-ruins": { embersPerDay: [150, 338], chipsetsPerDay: 1.4, plasmaPerDay: [1, 3], mat: null, tier: 3 },
  "dark-matter-observatory": { embersPerDay: [180, 405], chipsetsPerDay: 1.8, plasmaPerDay: [2, 4], mat: null, tier: 3 },
} as const;
export function zoneProfile(id: string): ZoneProfile | null {
  return ZONE_PROFILES[id] ?? null;
}
/** The published per-zone importance sub-scores (spec §2.1 table — the only
 *  place these six position values live; computed from zones.ts + authored
 *  breakdown via the §2.1 formulas). */
export interface ImportanceBreakdown {
  richness: number; // 0.4·(ember/90) + 0.4·(chip/0.45) + 0.2·plasmaPresence
  position: number; // 0.6·adjacency + 0.4·hubness
  chorus: number; // zone.chorusRisk verbatim
  score: number; // 0.5·richness + 0.3·position + 0.2·chorus
  tier: Tier;
}
export interface AtlasNode {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
  zoneId: string | null; // null for the Cradle
  profile: ZoneProfile | null; // rim territories only
  importance: ImportanceBreakdown | null; // rim territories only
  heart: boolean; // the Chorus-held heart at the web's core
}
export interface AtlasEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
export interface AtlasGraph {
  worldId: string;
  raceId: string | null;
  seed: number;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}
// ----------------------------------------------------------------------------
// §2 Seeded RNG (house standard — same spine as daily.ts, zero Math.random).
// ----------------------------------------------------------------------------
/** FNV-1a 32-bit string hash → a stable 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** mulberry32 — tiny deterministic PRNG (returns 0..1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// ----------------------------------------------------------------------------
// §3 World geography — node taxonomy (constants; the "no new places" rule).
// The cut is principled and publishable (spec §1.1): the Burning Rim = the six
// zones at range >= 60 — the landing edge where an invasion touches soil.
// ----------------------------------------------------------------------------
export const RIM_ZONE_IDS: readonly string[] = ZONES.filter((z) => z.range >= 60).map((z) => z.id);
export const NEAR_ZONE_IDS: readonly string[] = ZONES.filter((z) => z.range < 60).map((z) => z.id);
/** W2: the heart is the deepest T3 site — the deep-most scientific site on
 *  every world (max range; dark-matter-observatory — the Chorus stronghold). */
export const HEART_ZONE_ID: string = (() => {
  let deepest = RIM_ZONE_IDS[0];
  for (const id of RIM_ZONE_IDS) {
    const z = getZone(id);
    if (z.range > getZone(deepest).range) deepest = id;
  }
  return deepest;
})();
export const CRADLE_NODE_ID = "cradle";
// ----------------------------------------------------------------------------
// §4 Authored base skeleton — the shattered circuit-web (spec §3.2/§3.4).
// The heart sits at the web's visual core; the Cradle at the bottom home edge;
// the landing perimeter up top. Traces radiate from the heart outward: the war
// reads inward — fight the footholds, push the chain, burn toward the heart.
// Per-world variation (rim order, wiring drift, jitter) comes from the seed.
// ----------------------------------------------------------------------------
const BASE_POS: Record<string, { x: number; y: number }> = {
  // The Chorus-held heart at the center.
  "dark-matter-observatory": { x: 180, y: 100 },
  // The deep approach threads (the two lanes into the heart).
  "quantum-facility": { x: 128, y: 168 },
  "collider-ruins": { x: 232, y: 168 },
  // The rim arc — landing-perimeter footholds (order permuted per world).
  "shattered-academies": { x: 140, y: 235 },
  "boneyard": { x: 215, y: 245 },
  "forge-valleys": { x: 272, y: 232 },
  // Near ring — home-protected, dimmed, never contestable.
  "hollow-warrens": { x: 60, y: 345 },
  "observatories": { x: 150, y: 352 },
  "lantern-reach": { x: 240, y: 345 },
  "outer-ruins": { x: 315, y: 350 },
  // The Cradle — home edge.
  cradle: { x: 180, y: 480 },
};
const ARC_SLOTS = ["shattered-academies", "boneyard", "forge-valleys"] as const;
/** The rim chain (every zone's rim chain degree = 4 × hubness): FV—BY—SA with
 *  two threads into the deep pair and two lanes into the heart (QF—DM, CO—DM).
 *  Degrees: FV 1 · BY 2 · SA 3 · QF 3 · CO 3 · DM 2 — matches the authored
 *  hubness decomposition exactly (asserted in the verification harness). */
const RIM_CHAIN: ReadonlyArray<readonly [string, string]> = [
  ["forge-valleys", "boneyard"],
  ["boneyard", "shattered-academies"],
  ["shattered-academies", "quantum-facility"],
  ["quantum-facility", "collider-ruins"],
  ["collider-ruins", "dark-matter-observatory"],
  ["shattered-academies", "collider-ruins"],
  ["quantum-facility", "dark-matter-observatory"],
];
/** Authored desktop edge kinds (world-neutral base; the seed drifts a few). */
const BASE_KIND: Partial<Record<string, EdgeKind>> = {
  "forge-valleys|boneyard": "road",
  "boneyard|shattered-academies": "road",
  "shattered-academies|quantum-facility": "road",
  "quantum-facility|collider-ruins": "ruinPass", // the burnt approach to the collider
  "collider-ruins|dark-matter-observatory": "road", // the last trace into the heart
  "shattered-academies|collider-ruins": "ruinPass",
  "quantum-facility|dark-matter-observatory": "ruinPass",
  "lantern-reach|forge-valleys": "ruinPass", // Pleiadian lantern-lane, burnt but passable
  "observatories|boneyard": "road",
  "hollow-warrens|shattered-academies": "ruinPass", // Draconian warren-pass
  "outer-ruins|lantern-reach": "road",
  "lantern-reach|observatories": "road",
  "observatories|hollow-warrens": "road",
};
/** NEAR + cradle supply lanes (home turf; never contestable — §1.1). */
const SUPPLY_LANES: ReadonlyArray<readonly [string, string]> = [
  ["outer-ruins", "lantern-reach"],
  ["lantern-reach", "observatories"],
  ["observatories", "hollow-warrens"],
  ["lantern-reach", "forge-valleys"],
  ["observatories", "boneyard"],
  ["hollow-warrens", "shattered-academies"],
  ["outer-ruins", CRADLE_NODE_ID],
  ["lantern-reach", CRADLE_NODE_ID],
  ["observatories", CRADLE_NODE_ID],
  ["hollow-warrens", CRADLE_NODE_ID],
];
/** Severed traces — the old-world gaps where the Chorus broke the circuit
 *  (impassable; rendered as breaks, story-only, no mechanical effect yet). */
const SEVERED_GAPS: ReadonlyArray<readonly [string, string]> = [
  ["outer-ruins", "hollow-warrens"], // the southern near-ring arc road, cut early in the war
  ["forge-valleys", "quantum-facility"], // the furnace road straight to the deep, long gone
];
// ----------------------------------------------------------------------------
// §5 Importance (spec §2.1 — published, deterministic, symmetric).
// ----------------------------------------------------------------------------
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function richnessFor(zoneId: string): number {
  const z = getZone(zoneId);
  const p = ZONE_PROFILES[zoneId];
  const plasma = p?.plasmaPerDay ? 1 : 0;
  return round2(
    ATLAS_CONFIG.richness.emberWeight * (z.emberYield / ATLAS_CONFIG.richness.emberNorm) +
      ATLAS_CONFIG.richness.chipsetWeight * (z.chipsetChance / ATLAS_CONFIG.richness.chipsetNorm) +
      ATLAS_CONFIG.richness.plasmaWeight * plasma,
  );
}
function positionFor(zoneId: string): number {
  const b = (ATLAS_CONFIG.positionBreakdown as Record<string, { adjacency: number; hubness: number }>)[zoneId];
  if (!b) return 0;
  return round2(0.6 * b.adjacency + 0.4 * b.hubness);
}
function chorusFor(zoneId: string): number {
  return getZone(zoneId).chorusRisk;
}
export function importanceFor(zoneId: string): ImportanceBreakdown {
  const richness = richnessFor(zoneId);
  const position = positionFor(zoneId);
  const chorus = chorusFor(zoneId);
  const score = round2(
    ATLAS_CONFIG.importanceWeights.richness * richness +
      ATLAS_CONFIG.importanceWeights.position * position +
      ATLAS_CONFIG.importanceWeights.chorus * chorus,
  );
  const tier: Tier = score < ATLAS_CONFIG.tier.t1Max ? 1 : score <= ATLAS_CONFIG.tier.t2Max ? 2 : 3;
  return { richness, position, chorus, score, tier };
}
// ----------------------------------------------------------------------------
// §6 Generation — deterministic seeded node-graph (zero Math.random).
// ----------------------------------------------------------------------------
function jitter(rng: () => number, base: { x: number; y: number }): { x: number; y: number } {
  const j = ATLAS_CONFIG.jitter;
  return {
    x: Math.round(base.x + (rng() * 2 - 1) * j),
    y: Math.round(base.y + (rng() * 2 - 1) * j),
  };
}
export interface AtlasOptions {
  worldId: string;
  /** The world's race identity (worldLock race id), when the world has one. */
  raceId?: string | null;
}
/** Build this world's Atlas graph — deterministic for a given world id.
 *  Pure, no Math.random, no state, no war secrets: the output is world
 *  geography and may be rendered by any client unchanged (spec §3.6). */
export function generateAtlas(opts: AtlasOptions): AtlasGraph {
  const worldId = opts.worldId || "unknown-world";
  const raceId = opts.raceId ?? null;
  const seed = hashSeed(ATLAS_CONFIG.salt + worldId + ":" + (raceId ?? "open"));
  const rng = mulberry32(seed);
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const kindOf = (a: string, b: string): EdgeKind => {
    const authored = BASE_KIND[key(a, b)];
    return authored ?? "road";
  };
  const kindOfDrifted = (a: string, b: string): EdgeKind => {
    // Seeded wiring drift: a few traverse edges read as the other kind per
    // world, so no two worlds' webs are identical (W1). Connectivity never
    // changes — only road ↔ ruin-pass (both traversable).
    return rng() < ATLAS_CONFIG.kindDrift ? (kindOf(a, b) === "road" ? "ruinPass" : "road") : kindOf(a, b);
  };
  // The rim arc order (landing-perimeter reading) — permuted per world by the
  // seed so each world's corpse-geography reads differently (identity, §3.2).
  const arc = [...ARC_SLOTS];
  const arcPos = arc.map((id) => ({ id, base: BASE_POS[id] }));
  for (let i = arcPos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arcPos[i], arcPos[j]] = [arcPos[j], arcPos[i]];
  }
  // Authored base positions + seeded jitter (cosmetic wobble).
  const pos: Record<string, { x: number; y: number }> = {};
  for (const z of ZONES) pos[z.id] = jitter(rng, BASE_POS[z.id]);
  for (const a of arcPos) pos[a.id] = jitter(rng, a.base); // arc slots take their permuted base
  pos[CRADLE_NODE_ID] = jitter(rng, BASE_POS.cradle);
  const nodes: AtlasNode[] = [];
  for (const id of RIM_ZONE_IDS) {
    const z = getZone(id);
    nodes.push({
      id,
      name: z.name,
      kind: id === HEART_ZONE_ID ? "heart" : "rim",
      x: pos[id].x,
      y: pos[id].y,
      zoneId: id,
      profile: ZONE_PROFILES[id] ?? null,
      importance: importanceFor(id),
      heart: id === HEART_ZONE_ID,
    });
  }
  // Rim order sanity: the chain must still read left→right along the arc
  // (FV end = landing edge). We permuted only the VISUAL arc order above.
  for (const id of NEAR_ZONE_IDS) {
    const z = getZone(id);
    nodes.push({ id, name: z.name, kind: "near", x: pos[id].x, y: pos[id].y, zoneId: id, profile: null, importance: null, heart: false });
  }
  nodes.push({ id: CRADLE_NODE_ID, name: "The Cradle", kind: "cradle", x: pos[CRADLE_NODE_ID].x, y: pos[CRADLE_NODE_ID].y, zoneId: null, profile: null, importance: null, heart: false });
  const edges: AtlasEdge[] = [];
  const pushEdge = (a: string, b: string, kind: EdgeKind) => edges.push({ from: a, to: b, kind });
  for (const [a, b] of RIM_CHAIN) pushEdge(a, b, kindOfDrifted(a, b));
  for (const [a, b] of SUPPLY_LANES) pushEdge(a, b, kindOfDrifted(a, b));
  for (const [a, b] of SEVERED_GAPS) pushEdge(a, b, "severed");
  return { worldId, raceId, seed, nodes, edges };
}
/** The graph's node lookup for the client renderer. */
export function nodeById(g: AtlasGraph, id: string): AtlasNode | undefined {
  return g.nodes.find((n) => n.id === id);
}