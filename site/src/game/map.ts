// ============================================================================
// WORLD ATLAS — the shattered circuit-web (design/world-map-design.md §3).
//
// The map IS the world: this module renders the Shatterlands geography
// (zones.ts) 1:1 as a node graph — seventeen Burning-Rim territories
// (contestable in a war week, range >= 60), twelve home-protected Near-Ring
// zones (never contestable), the Chorus-held heart at the web's core (the
// deep-most T3 scientific site — dark-matter-observatory on every world, W2),
// and The Cradle at the bottom home edge. 30 nodes total.
//
// The 19 V9 "foothold" sites (the denser web) are REAL zones — added to the
// zones.ts catalog, tier-computed by the SAME importanceFor math, and laid out
// on seeded row-slot permutations so each world's corpse-geography still reads
// differently (W1). The six ratified anchor zones keep their exact published
// scores and tiers (§2.1 spec table — position decomposition re-authored only
// where the denser web changed a rim-chain degree; scores/tiers unchanged).
//
// HOUSE STANDARDS (V8+ — same spine as daily.ts):
//   • PURE module — deterministic seeded node-graph generation (xmur3 +
//     mulberry32 on the world id). ZERO Math.random anywhere in the field.
//   • ONE config block (ATLAS_CONFIG + ZONE_PROFILES + ROW_PERMS) — every
//     tunable number lives here; the spec's published formulas (richness/
//     position/chorus → score → tier) are computed from zones.ts data, not
//     hand-entered.
//   • LAYOUT LAW (circuit-fullscreen-page.md §2.2/§6.1 — keep in every future
//     layout edit): nodes sit in the five y-fraction bands (core/deep/rim/
//     near/home, each with x inside 0.06–0.94 of width); same-row spacing
//     ≥ 60 viewBox units; ANY two nodes ≥ 52 units apart (the r26 hit-circle
//     floor, 26+26=52) so taps never overlap; the heart and the Cradle never
//     move. If a band fills, the viewBox grows (width, aspect 0.65–0.80).
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
  viewBox: { w: 560, h: 760 } as const,
  /** Cosmetic seeded position wobble (viewBox units). */
  jitter: 6,
  /** Probability a traverse edge drifts road ↔ ruin-pass per world (the
   *  circuit's wiring differs from world to world — history-shaped). */
  kindDrift: 0.15,
  /** §6.1 layout bands (viewBox y-fractions — the authoring law; see the
   *  module header). Rows: heart ~0.17, deep ~0.33, rim outer ~0.43 + inner
   *  ~0.52, near outer ~0.61 + inner ~0.70, cradle ≥ 0.88. Row gaps are ≥ 62
   *  units so worst-case jitter (±6 both axes) keeps ANY pair ≥ 54 units. */
  layoutBands: {
    core: { y0: 0.14, y1: 0.24 } as const,   // the Chorus-held heart (1)
    deep: { y0: 0.28, y1: 0.38 } as const,   // T3 approach threads + deep sites
    rim: { y0: 0.42, y1: 0.52 } as const,    // the landing perimeter (2 rows)
    near: { y0: 0.60, y1: 0.72 } as const,   // home-protected near ring (2 rows)
    home: { y0: 0.88, y1: 1.00 } as const,   // The Cradle
  } as const,
  /** §2.2 spacing law (viewBox units): same-row ≥ SPACING_ROW; any pair ≥
   *  SPACING_MIN (the r26 hit-circle floor, 26+26=52). Enforced by the
   *  atlas verification harness over every generated web. */
  spacing: { row: 60, min: 52 } as const,
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
   *  position table EXACTLY — hubness = degree in the rim chain / 4, and the
   *  harness asserts that graph-honesty for every rim node, anchors included).
   *  The six anchors keep their published positions (forge-valleys keeps 0.25
   *  — its decomposition shifted to adjacency 0.0833 + hubness 0.5 only
   *  because the denser web gave it one new rim edge: graph-honest, while the
   *  published score/tier stay byte-identical). */
  positionBreakdown: {
    "forge-valleys": { adjacency: 0.0833333333, hubness: 0.5 },
    "boneyard": { adjacency: 1 / 3, hubness: 0.5 },
    "shattered-academies": { adjacency: 0.55, hubness: 0.75 },
    "quantum-facility": { adjacency: 0.7, hubness: 0.75 },
    "collider-ruins": { adjacency: 0.6833333333, hubness: 0.75 },
    "dark-matter-observatory": { adjacency: 0.8833333333, hubness: 0.5 },
    // V9 footholds — hubness = rim-chain degree/4 (harness-asserted).
    "rust-gardens": { adjacency: 0.1833333333, hubness: 0.75 },
    "ash-columns": { adjacency: 0.25, hubness: 0.5 },
    "quarry-edge": { adjacency: 0.3, hubness: 0.5 },
    "shard-fields": { adjacency: 0.35, hubness: 0.5 },
    "murmur-sumps": { adjacency: 0.5, hubness: 0.75 },
    "titan-breaks": { adjacency: 0.55, hubness: 0.5 },
    "glass-harbor": { adjacency: 0.5, hubness: 0.5 },
    "wailing-towers": { adjacency: 0.55, hubness: 0.75 },
    "deep-vaults": { adjacency: 0.7, hubness: 0.75 },
    "null-engine": { adjacency: 0.75, hubness: 0.5 },
    "starfall-core": { adjacency: 0.8, hubness: 0.75 },
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
/** Authored §1.3 defaults (M8: "bands and tick rates default pending balance").
 *  V9 adds the nineteen foothold profiles — tier fields equal the COMPUTED
 *  importance tiers (asserted by the harness). */
export const ZONE_PROFILES: Record<string, ZoneProfile> = {
  "forge-valleys": { embersPerDay: [110, 248], chipsetsPerDay: 0.36, plasmaPerDay: null, mat: "anunnaki", tier: 1 },
  "boneyard": { embersPerDay: [90, 203], chipsetsPerDay: 0.4, plasmaPerDay: null, mat: "nephilim", tier: 1 },
  "shattered-academies": { embersPerDay: [100, 225], chipsetsPerDay: 0.72, plasmaPerDay: null, mat: "watchers", tier: 2 },
  "quantum-facility": { embersPerDay: [120, 270], chipsetsPerDay: 1.2, plasmaPerDay: [0, 2], mat: null, tier: 2 },
  "collider-ruins": { embersPerDay: [150, 338], chipsetsPerDay: 1.4, plasmaPerDay: [1, 3], mat: null, tier: 3 },
  "dark-matter-observatory": { embersPerDay: [180, 405], chipsetsPerDay: 1.8, plasmaPerDay: [2, 4], mat: null, tier: 3 },
  // V9 (chipsetsPerDay = chipsetChance × 4 exactly; deep sites carry plasma).
  "rust-gardens": { embersPerDay: [84, 189], chipsetsPerDay: 0.28, plasmaPerDay: null, mat: "draconians", tier: 1 },
  "ash-columns": { embersPerDay: [89, 200], chipsetsPerDay: 0.32, plasmaPerDay: null, mat: "grays", tier: 1 },
  "quarry-edge": { embersPerDay: [80, 180], chipsetsPerDay: 0.24, plasmaPerDay: null, mat: "ashtar", tier: 1 },
  "shard-fields": { embersPerDay: [93, 209], chipsetsPerDay: 0.36, plasmaPerDay: null, mat: null, tier: 1 },
  "murmur-sumps": { embersPerDay: [111, 250], chipsetsPerDay: 0.56, plasmaPerDay: null, mat: "nephilim", tier: 2 },
  "titan-breaks": { embersPerDay: [120, 270], chipsetsPerDay: 0.6, plasmaPerDay: null, mat: "watchers", tier: 2 },
  "glass-harbor": { embersPerDay: [122, 275], chipsetsPerDay: 0.6, plasmaPerDay: null, mat: "grays", tier: 2 },
  "wailing-towers": { embersPerDay: [122, 275], chipsetsPerDay: 0.64, plasmaPerDay: null, mat: "ashtar", tier: 2 },
  "deep-vaults": { embersPerDay: [147, 331], chipsetsPerDay: 1.28, plasmaPerDay: [0, 2], mat: null, tier: 3 },
  "null-engine": { embersPerDay: [156, 351], chipsetsPerDay: 1.36, plasmaPerDay: [1, 3], mat: null, tier: 3 },
  "starfall-core": { embersPerDay: [164, 369], chipsetsPerDay: 1.44, plasmaPerDay: [2, 4], mat: null, tier: 3 },
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
// Per-world variation (rim-row permutations, wiring drift, jitter) comes from
// the seed.
//
// LAYOUT LAW (§2.2/§6.1 — keep on every edit): rows sit on the §1 layoutBands
// (heart 0.16 · deep 0.29 · rim outer 0.44 / inner 0.52 · near outer 0.64 /
// inner 0.72 · cradle ≥ 0.88); x inside 0.06–0.94 of width; same-row spacing
// ≥ 60 viewBox units; ANY two nodes ≥ 52 apart (the r26 hit circles, 26+26=52,
// must never overlap a tap); the heart and the Cradle never move. Slots below
// are ≥ 75 apart so seeded jitter (±6) keeps same-row ≥ 63.
// ----------------------------------------------------------------------------
const BASE_POS: Record<string, { x: number; y: number }> = {
  // The Chorus-held heart at the center (never moves).
  "dark-matter-observatory": { x: 280, y: 130 },
  // The deep approach row (T3 threads + new deep sites).
  "quantum-facility": { x: 97, y: 250 },
  "collider-ruins": { x: 472, y: 250 },
  // The rim outer row — landing-perimeter footholds (T1 landing edge).
  "forge-valleys": { x: 50, y: 330 },
  "boneyard": { x: 502, y: 330 },
  // The rim inner row — strong ground (T2 core of the web).
  "shattered-academies": { x: 112, y: 392 },
  // Near ring — home-protected, dimmed, never contestable.
  "hollow-warrens": { x: 55, y: 464 },
  "lantern-reach": { x: 152, y: 464 },
  "observatories": { x: 327, y: 464 },
  "outer-ruins": { x: 507, y: 464 },
  // The Cradle — home edge (never moves).
  cradle: { x: 280, y: 710 },
};
/** The 19 V9 foothold rows: anchors are slot-pinned; the seed permutes which
 *  new node takes which free slot per world (history-shaped reading, W1 —
 *  positions are cosmetic, edges are id-keyed, so permutations cannot break
 *  the topology; the harness asserts the spacing law holds for EVERY world).
 *  Exported so the verification harness can check the layout law against the
 *  authored slot rows (public geography — spec §3.6). */
export interface RowPerm {
  y: number;
  slots: Array<{ x: number; fixed?: string }>;
  nodes: string[];
}
export const ROW_PERMS: RowPerm[] = [
  { y: 250, slots: [{ x: 97, fixed: "quantum-facility" }, { x: 197 }, { x: 280 }, { x: 363 }, { x: 472, fixed: "collider-ruins" }], nodes: ["deep-vaults", "null-engine", "starfall-core"] },
  { y: 330, slots: [{ x: 50, fixed: "forge-valleys" }, { x: 143 }, { x: 236 }, { x: 329 }, { x: 422 }, { x: 502, fixed: "boneyard" }], nodes: ["rust-gardens", "ash-columns", "quarry-edge", "shard-fields"] },
  { y: 392, slots: [{ x: 112, fixed: "shattered-academies" }, { x: 205 }, { x: 280 }, { x: 355 }, { x: 430 }], nodes: ["murmur-sumps", "titan-breaks", "glass-harbor", "wailing-towers"] },
  { y: 464, slots: [{ x: 55, fixed: "hollow-warrens" }, { x: 152, fixed: "lantern-reach" }, { x: 249 }, { x: 327, fixed: "observatories" }, { x: 404 }, { x: 507, fixed: "outer-ruins" }], nodes: ["tram-yards", "relay-spires"] },
  { y: 536, slots: [{ x: 104 }, { x: 184 }, { x: 264 }, { x: 344 }, { x: 424 }, { x: 506 }], nodes: ["cinder-farms", "pump-stations", "sigil-plaza", "hearth-lanes", "grain-silos", "watchtower-row"] },
];
/** The rim web — every rim-only edge (both ends rim) counts toward the
 *  hubness = degree/4 law (§2.1). Anchor degrees stay EXACTLY as published
 *  (FV 2 · BY 2 · SA 3 · QF 3 · CO 3 · DM 2); the V9 footholds join the chain
 *  with degrees 2–3 so every hubness is graph-honest. */
const RIM_CHAIN: ReadonlyArray<readonly [string, string]> = [
  // Anchor web (published).
  ["forge-valleys", "boneyard"],
  ["boneyard", "shattered-academies"],
  ["shattered-academies", "quantum-facility"],
  ["quantum-facility", "collider-ruins"],
  ["collider-ruins", "dark-matter-observatory"],
  ["shattered-academies", "collider-ruins"],
  ["quantum-facility", "dark-matter-observatory"],
  // Landing chain + inland threads (V9 footholds).
  ["forge-valleys", "rust-gardens"],
  ["rust-gardens", "ash-columns"],
  ["ash-columns", "quarry-edge"],
  ["quarry-edge", "shard-fields"],
  ["shard-fields", "wailing-towers"],
  ["rust-gardens", "murmur-sumps"],
  ["murmur-sumps", "titan-breaks"],
  ["titan-breaks", "glass-harbor"],
  ["glass-harbor", "wailing-towers"],
  ["murmur-sumps", "deep-vaults"],
  ["deep-vaults", "null-engine"],
  ["null-engine", "starfall-core"],
  ["deep-vaults", "starfall-core"],
  ["wailing-towers", "starfall-core"],
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
  // V9 — the landing chain reads as conductor lanes; the inland threads burn.
  "forge-valleys|rust-gardens": "road",
  "rust-gardens|ash-columns": "road",
  "ash-columns|quarry-edge": "road",
  "quarry-edge|shard-fields": "road",
  "shard-fields|wailing-towers": "ruinPass",
  "rust-gardens|murmur-sumps": "road",
  "murmur-sumps|titan-breaks": "road",
  "titan-breaks|glass-harbor": "road",
  "glass-harbor|wailing-towers": "road",
  "murmur-sumps|deep-vaults": "ruinPass", // the burnt descent to the vaults
  "deep-vaults|null-engine": "road",
  "null-engine|starfall-core": "road",
  "deep-vaults|starfall-core": "ruinPass",
  "starfall-core|wailing-towers": "road",
  "quarry-edge|tram-yards": "road", // new rim spokes (near → footholds)
  "relay-spires|shard-fields": "road",
  "outer-ruins|wailing-towers": "road",
};
/** NEAR + cradle supply lanes (home turf; never contestable — §1.1). Near
 *  ring reads as a literal RING (two rows: outer ring + inner home buffers),
 *  with spokes up into the rim footholds and roots down to the Cradle. */
const SUPPLY_LANES: ReadonlyArray<readonly [string, string]> = [
  // Existing near ring chain + cradle roots.
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
  // V9 near-ring completion (the ring closes).
  ["hollow-warrens", "tram-yards"],
  ["tram-yards", "relay-spires"],
  ["relay-spires", "outer-ruins"],
  // V9 rim spokes (near → footholds).
  ["tram-yards", "quarry-edge"],
  ["relay-spires", "shard-fields"],
  ["outer-ruins", "wailing-towers"],
  // V9 inner home buffers (the second near row).
  ["cinder-farms", "pump-stations"],
  ["pump-stations", "sigil-plaza"],
  ["sigil-plaza", "hearth-lanes"],
  ["hearth-lanes", "grain-silos"],
  ["grain-silos", "watchtower-row"],
  ["cinder-farms", "lantern-reach"],
  ["pump-stations", "tram-yards"],
  ["sigil-plaza", "observatories"],
  ["hearth-lanes", "relay-spires"],
  ["grain-silos", "outer-ruins"],
  ["watchtower-row", CRADLE_NODE_ID], // the far root lane
];
/** Severed traces — the old-world gaps where the Chorus broke the circuit
 *  (impassable; rendered as breaks, story-only, no mechanical effect yet). */
const SEVERED_GAPS: ReadonlyArray<readonly [string, string]> = [
  ["outer-ruins", "hollow-warrens"], // the southern near-ring arc road, cut early in the war
  ["forge-valleys", "quantum-facility"], // the furnace road straight to the deep, long gone
  ["quarry-edge", "murmur-sumps"], // the burnt inner thread between the footholds
  ["ash-columns", "titan-breaks"], // another broken trace inland
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
  // §§4 ROW_PERMS: seeded row-slot permutation of the V9 footholds (fixed rng
  // draw order: deep → rim outer → rim inner → near outer → near inner), then
  // jitter. Anchors are slot-pinned; the heart and the Cradle never move.
  const pos: Record<string, { x: number; y: number }> = {};
  const newIds = new Set(ROW_PERMS.flatMap((r) => r.nodes));
  for (const z of ZONES) {
    if (newIds.has(z.id)) continue; // foothold slots come from the permutation below
    pos[z.id] = jitter(rng, BASE_POS[z.id]);
  }
  for (const row of ROW_PERMS) {
    const free = row.slots.filter((s) => !s.fixed);
    const ids = [...row.nodes];
    // Fisher–Yates with the world seed — deterministic, zero Math.random.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    for (let i = 0; i < ids.length; i++) pos[ids[i]] = jitter(rng, { x: free[i].x, y: row.y });
  }
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