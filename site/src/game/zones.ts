import type { DomainId, Zone } from "./types";

// Expedition destinations in the Shatterlands. Outer ruins hold embers; deep
// scientific sites are the only places chipsets live. Higher risk, higher reward.

/**
 * THE RE-TIME LADDER — the 29 rungs (owner-ratified 2026-09-26).
 *
 * `d(k) = 14_400_000 x 1.1428^k` ms, shipped as a TABLE OF CONSTANTS.
 *
 * Why a table and not the formula at every call site: `engine.rungEntryDemand`
 * prices a rung by its own timer, and the in-flight migration (spec §7) has to
 * re-base a run that was launched under the OLD scale — both need d(k) for a
 * specific rung, and a table is the only form that cannot silently reprice live
 * timers when someone later edits the formula. The formula is recorded in the
 * comment above each band so the table is auditable against the ratified shape:
 * **4 h at the rim (rung 0) → 168 h at the deepest (rung 28)**, ratio 1.1428.
 *
 * A serial single pass = 1,316.2 h = **54.8 days of timers** (the floor of the
 * arc); with R = 6 the funding identity is R x Σd / 24 = **329.1 days**.
 * RUNG_TIMER_MS.length === ZONES.length is asserted by retime-tests.
 */
export const RUNG_TIMER_MS: readonly number[] = [
  14_400_000, // rung  0    4.00 h
  16_456_320, // rung  1    4.57 h
  18_806_282, // rung  2    5.22 h
  21_491_820, // rung  3    5.97 h
  24_560_851, // rung  4    6.82 h
  28_068_141, // rung  5    7.80 h
  32_076_272, // rung  6    8.91 h
  36_656_763, // rung  7   10.18 h
  41_891_349, // rung  8   11.64 h
  47_873_434, // rung  9   13.30 h
  54_709_760, // rung 10   15.20 h
  62_522_314, // rung 11   17.37 h
  71_450_500, // rung 12   19.85 h
  81_653_631, // rung 13   22.68 h
  93_313_770, // rung 14   25.92 h
  106_638_976, // rung 15   29.62 h
  121_867_022, // rung 16   33.85 h
  139_269_633, // rung 17   38.69 h
  159_157_337, // rung 18   44.21 h
  181_885_004, // rung 19   50.52 h
  207_858_183, // rung 20   57.74 h
  237_540_331, // rung 21   65.98 h
  271_461_091, // rung 22   75.41 h
  310_225_734, // rung 23   86.17 h
  354_525_969, // rung 24   98.48 h
  405_152_278, // rung 25  112.54 h
  463_008_023, // rung 26  128.61 h
  529_125_569, // rung 27  146.98 h
  604_684_700, // rung 28  167.97 h
];

/** The rung's own run timer (clamped: an unknown/legacy zone reads the rim). */
export function rungTimerMs(rung: number): number {
  if (!Number.isFinite(rung) || rung < 0) return RUNG_TIMER_MS[0];
  return RUNG_TIMER_MS[Math.min(RUNG_TIMER_MS.length - 1, Math.floor(rung))];
}

/**
 * The rung a zone IS: the ZONES array is the ladder, in order (rung 0 = the
 * `outer-ruins` rim … rung 28 = `starfall-core`, the deepest). The ladder, the
 * demand and the migration all read this one index, so a zone can never be
 * priced by one rung and timed by another. An unknown id reads the rim.
 */
export function rungOfZone(zoneId: string): number {
  const i = ZONES.findIndex((z) => z.id === zoneId);
  return i < 0 ? 0 : i;
}

/**
 * The PRE-RE-TIME base durations, in ZONES order — MIGRATION ONLY (spec §7).
 *
 * A save written before the re-time carries runs whose `durationMs` was derived
 * from these values. The one-shot pass resolves anything already complete in
 * THIS scale first, then re-bases only what is still running, proportionally to
 * the base. Nothing else in the codebase may read this table: it is the past,
 * kept so the migration can be exact.
 */
export const LEGACY_ZONE_BASE_MS: readonly number[] = [
  45_000, 90_000, 120_000, 90_000, 100_000, 90_000, 110_000, 150_000, 180_000,
  210_000, 60_000, 65_000, 75_000, 85_000, 90_000, 95_000, 100_000, 105_000,
  105_000, 110_000, 110_000, 115_000, 115_000, 125_000, 120_000, 125_000,
  160_000, 170_000, 190_000,
];

/** The pre-re-time base for a zone (migration only). */
export function legacyZoneBaseMs(zoneId: string): number {
  return LEGACY_ZONE_BASE_MS[rungOfZone(zoneId)] ?? LEGACY_ZONE_BASE_MS[0];
}

export const ZONES: Zone[] = [
  {
    id: "outer-ruins",
    name: "Outer Ruins",
    owner: "shared",
    risk: 15,
    radiationLevel: 0,
    range: 15,
    quiet: 15,
    baseDurationMs: RUNG_TIMER_MS[0],
    emberYield: 12,
    chipsetChance: 0.0,
    corruptionRisk: 0.05,
    chorusRisk: 0.05,
    flavor: "Shattered suburb-shells near the colony rim. Embers rust in the outer dark; safe, quick, and thin.",
  },
  {
    id: "observatories",
    name: "Observatories of the Still Dark",
    owner: "grays",
    risk: 40,
    radiationLevel: 25,
    range: 50,
    quiet: 50,
    baseDurationMs: RUNG_TIMER_MS[1],
    emberYield: 30,
    chipsetChance: 0.08,
    corruptionRisk: 0.3,
    chorusRisk: 0.45,
    flavor: "Dead observatories where the sky was once counted. Cold, exact fragments — and a signature the Chorus can taste.",
  },
  {
    id: "boneyard",
    name: "Boneyard Ranges",
    owner: "nephilim",
    risk: 55,
    radiationLevel: 30,
    range: 70,
    quiet: 55,
    baseDurationMs: RUNG_TIMER_MS[2],
    emberYield: 45,
    chipsetChance: 0.1,
    corruptionRisk: 0.2,
    chorusRisk: 0.3,
    flavor: "Mountain-chains of tumbled artillery citadels. Armored war-fragments that persist — heavy, but slow to teach.",
  },
  {
    id: "hollow-warrens",
    name: "The Hollow Warrens",
    owner: "draconians",
    risk: 40,
    radiationLevel: 20,
    range: 55,
    quiet: 65,
    baseDurationMs: RUNG_TIMER_MS[3],
    emberYield: 40,
    chipsetChance: 0.12,
    corruptionRisk: 0.2,
    chorusRisk: 0.25,
    flavor: "Sealed subterranean vault-cities. Efficient covert fragments that stretch a resource and hide its true flow — if you can slip out unseen.",
  },
  {
    id: "forge-valleys",
    name: "Forge Valleys",
    owner: "anunnaki",
    risk: 45,
    radiationLevel: 30,
    range: 60,
    quiet: 50,
    baseDurationMs: RUNG_TIMER_MS[4],
    emberYield: 55,
    chipsetChance: 0.09,
    corruptionRisk: 0.28,
    chorusRisk: 0.3,
    flavor: "Terraformed greenheart overgrown with engineered life that remembers its makers. Productive fragments — and the pride that blinds.",
  },
  {
    id: "lantern-reach",
    name: "The Lantern Reach",
    owner: "ashtar",
    risk: 25,
    radiationLevel: 0,
    range: 25,
    quiet: 20,
    baseDurationMs: RUNG_TIMER_MS[5],
    emberYield: 22,
    chipsetChance: 0.1,
    corruptionRisk: 0.05,
    chorusRisk: 0.15,
    flavor: "Half-collapsed sanctuaries that held the Chorus back again and again. Clean, bright fragments that shield what they touch.",
  },
  {
    id: "shattered-academies",
    name: "The Shattered Academies",
    owner: "watchers",
    risk: 60,
    radiationLevel: 40,
    range: 75,
    quiet: 60,
    baseDurationMs: RUNG_TIMER_MS[6],
    emberYield: 50,
    chipsetChance: 0.18,
    corruptionRisk: 0.5,
    chorusRisk: 0.5,
    flavor: "Ruins of the world's greatest schools and sealed vaults. Razor-edged knowledge that teaches at terrible speed — and leaves a wound.",
  },
  // Deep scientific sites — chipsets only live here. Deep radiation: hangared
  // until the colony holds hazmat (explore) and alloy (extract); the pre-launch
  // risk pop-up governs under-geared runs.
  {
    id: "quantum-facility",
    name: "Quantum Research Facility",
    owner: "special",
    risk: 70,
    radiationLevel: 60,
    range: 80,
    quiet: 80,
    baseDurationMs: RUNG_TIMER_MS[7],
    emberYield: 60,
    chipsetChance: 0.3,
    corruptionRisk: 0.35,
    chorusRisk: 0.5,
    flavor: "A collapsed quantum laboratory. Complete, advanced AI sets lean against the walls, each whispering of the end it saw coming.",
  },
  {
    id: "collider-ruins",
    name: "Super-Collider Ruins",
    owner: "special",
    risk: 80,
    radiationLevel: 80,
    range: 90,
    quiet: 85,
    baseDurationMs: RUNG_TIMER_MS[8],
    emberYield: 75,
    chipsetChance: 0.35,
    corruptionRisk: 0.4,
    chorusRisk: 0.6,
    flavor: "A ring-mountain of magnetized wreckage. The deep burns the ground away — and the Chorus thickens the closer you get to the core.",
  },
  {
    id: "dark-matter-observatory",
    name: "Dark-Matter Observatory",
    owner: "special",
    risk: 90,
    radiationLevel: 95,
    range: 95,
    quiet: 95,
    baseDurationMs: RUNG_TIMER_MS[9],
    emberYield: 90,
    chipsetChance: 0.45,
    corruptionRisk: 0.5,
    chorusRisk: 0.7,
    flavor: "The deepest, most dangerous scientific site in the Shatterlands. Whole minds wait in the dark. So does the hive.",
  },
  // ---------------------------------------------------------------------------
  // V9 denser web (2026-09-13): nineteen procedural "foothold" sites appended to
  // the Shatterlands as the Circuit densifies to ~30 nodes. All real zones: what
  // you see on the map, you can send a team to. The ratified six anchors above
  // are byte-identical. New near-ring zones (range < 60) are home-protected;
  // new rim sites (range >= 60) are contestable and tier-computed by the SAME
  // importanceFor math (no new formulas). Deep sites carry plasma + chipsets;
  // footholds carry embers and a little chipset chance.
  // ---------------------------------------------------------------------------
  // — Near ring (home-protected, range < 60) —
  {
    id: "cinder-farms",
    name: "Cinder Farms",
    owner: "shared",
    risk: 12,
    radiationLevel: 5,
    range: 18,
    quiet: 10,
    baseDurationMs: RUNG_TIMER_MS[10],
    emberYield: 14,
    chipsetChance: 0.05,
    corruptionRisk: 0.04,
    chorusRisk: 0.08,
    flavor: "Ash-drifted greenhouse rows near the Cradle. Warm, simple fragments; the easiest work in the Shatterlands.",
  },
  {
    id: "hearth-lanes",
    name: "The Hearth Lanes",
    owner: "ashtar",
    risk: 14,
    radiationLevel: 6,
    range: 22,
    quiet: 12,
    baseDurationMs: RUNG_TIMER_MS[11],
    emberYield: 16,
    chipsetChance: 0.05,
    corruptionRisk: 0.05,
    chorusRisk: 0.09,
    flavor: "Narrow market-lanes that once ran warm at night. Modest fragments that keep a colony fed.",
  },
  {
    id: "pump-stations",
    name: "The Pump Stations",
    owner: "shared",
    risk: 18,
    radiationLevel: 10,
    range: 28,
    quiet: 22,
    baseDurationMs: RUNG_TIMER_MS[12],
    emberYield: 18,
    chipsetChance: 0.06,
    corruptionRisk: 0.06,
    chorusRisk: 0.1,
    flavor: "Beaten iron pump-houses on the old aqueduct line. Steady fragments that sweat usefulness.",
  },
  {
    id: "sigil-plaza",
    name: "Sigil Plaza",
    owner: "anunnaki",
    risk: 24,
    radiationLevel: 14,
    range: 36,
    quiet: 30,
    baseDurationMs: RUNG_TIMER_MS[13],
    emberYield: 22,
    chipsetChance: 0.08,
    corruptionRisk: 0.1,
    chorusRisk: 0.14,
    flavor: "A civic square where markers still stand. Fragments of public memory — plain and sturdy.",
  },
  {
    id: "grain-silos",
    name: "The Grain Silos",
    owner: "shared",
    risk: 28,
    radiationLevel: 16,
    range: 42,
    quiet: 32,
    baseDurationMs: RUNG_TIMER_MS[14],
    emberYield: 26,
    chipsetChance: 0.09,
    corruptionRisk: 0.12,
    chorusRisk: 0.16,
    flavor: "Ruptured silos and granaries on the home approach. Stored fragments, dry and counting.",
  },
  {
    id: "tram-yards",
    name: "The Tram Yards",
    owner: "shared",
    risk: 32,
    radiationLevel: 18,
    range: 45,
    quiet: 35,
    baseDurationMs: RUNG_TIMER_MS[15],
    emberYield: 28,
    chipsetChance: 0.09,
    corruptionRisk: 0.14,
    chorusRisk: 0.2,
    flavor: "Idle tram sheds and marshalling yards at the ring's edge. Clean freight-fragments still sorted by route.",
  },
  {
    id: "relay-spires",
    name: "The Relay Spires",
    owner: "grays",
    risk: 36,
    radiationLevel: 22,
    range: 50,
    quiet: 45,
    baseDurationMs: RUNG_TIMER_MS[16],
    emberYield: 32,
    chipsetChance: 0.1,
    corruptionRisk: 0.16,
    chorusRisk: 0.22,
    flavor: "Dead signal towers that linked the old world. Fragments that remember how to listen.",
  },
  {
    id: "watchtower-row",
    name: "Watchtower Row",
    owner: "draconians",
    risk: 38,
    radiationLevel: 24,
    range: 52,
    quiet: 48,
    baseDurationMs: RUNG_TIMER_MS[17],
    emberYield: 34,
    chipsetChance: 0.11,
    corruptionRisk: 0.18,
    chorusRisk: 0.24,
    flavor: "A line of fallen watchtowers guarding the inner ring. Reliable fragments that watched, and warn.",
  },
  // — Burning Rim footholds (contestable, range >= 60, tiers computed) —
  {
    id: "quarry-edge",
    name: "The Quarry-Edge Works",
    owner: "ashtar",
    risk: 40,
    radiationLevel: 26,
    range: 61,
    quiet: 38,
    baseDurationMs: RUNG_TIMER_MS[18],
    emberYield: 36,
    chipsetChance: 0.06,
    corruptionRisk: 0.15,
    chorusRisk: 0.15,
    flavor: "A stepped quarry that never finished cutting. Bright, shielded fragments stacked at the lip, waiting for steady hands.",
  },
  {
    id: "ash-columns",
    name: "The Ash Columns",
    owner: "grays",
    risk: 42,
    radiationLevel: 25,
    range: 62,
    quiet: 40,
    baseDurationMs: RUNG_TIMER_MS[19],
    emberYield: 40,
    chipsetChance: 0.08,
    corruptionRisk: 0.18,
    chorusRisk: 0.18,
    flavor: "Rows of calcined pillars that once held a census of stars. Fragments here read fast — and leave a grey taste in the sky.",
  },
  {
    id: "glass-harbor",
    name: "The Glass Harbor",
    owner: "grays",
    risk: 50,
    radiationLevel: 28,
    range: 63,
    quiet: 45,
    baseDurationMs: RUNG_TIMER_MS[20],
    emberYield: 55,
    chipsetChance: 0.15,
    corruptionRisk: 0.26,
    chorusRisk: 0.38,
    flavor: "A harbor basin vitrified by the final strike. Clear fragments at the quay — cold, exact, and watched.",
  },
  {
    id: "rust-gardens",
    name: "The Rust Gardens",
    owner: "draconians",
    risk: 44,
    radiationLevel: 28,
    range: 64,
    quiet: 42,
    baseDurationMs: RUNG_TIMER_MS[21],
    emberYield: 38,
    chipsetChance: 0.07,
    corruptionRisk: 0.22,
    chorusRisk: 0.2,
    flavor: "Vaulted garden-rings gone to red oxide. Fragments that hide in the earth and hoard what they learn.",
  },
  {
    id: "murmur-sumps",
    name: "The Murmur Sumps",
    owner: "nephilim",
    risk: 52,
    radiationLevel: 30,
    range: 66,
    quiet: 48,
    baseDurationMs: RUNG_TIMER_MS[22],
    emberYield: 50,
    chipsetChance: 0.14,
    corruptionRisk: 0.28,
    chorusRisk: 0.32,
    flavor: "Drowned sump-vaults where old engines still whisper. Heavy fragments that persist through the sludge.",
  },
  {
    id: "shard-fields",
    name: "The Shard Fields",
    owner: "shared",
    risk: 48,
    radiationLevel: 32,
    range: 68,
    quiet: 50,
    baseDurationMs: RUNG_TIMER_MS[23],
    emberYield: 42,
    chipsetChance: 0.09,
    corruptionRisk: 0.25,
    chorusRisk: 0.2,
    flavor: "A plain of standing glass where a mirror-city fell. Sharp, shallow fragments — quick to work, no one's home ground.",
  },
  {
    id: "titan-breaks",
    name: "The Titan Breaks",
    owner: "watchers",
    risk: 54,
    radiationLevel: 32,
    range: 69,
    quiet: 52,
    baseDurationMs: RUNG_TIMER_MS[24],
    emberYield: 54,
    chipsetChance: 0.15,
    corruptionRisk: 0.3,
    chorusRisk: 0.35,
    flavor: "Shattered ribwork of a walker so vast it reads as geology. Fragments that remember forbidden heights.",
  },
  {
    id: "wailing-towers",
    name: "The Wailing Towers",
    owner: "ashtar",
    risk: 56,
    radiationLevel: 33,
    range: 72,
    quiet: 55,
    baseDurationMs: RUNG_TIMER_MS[25],
    emberYield: 55,
    chipsetChance: 0.16,
    corruptionRisk: 0.32,
    chorusRisk: 0.4,
    flavor: "Collapsed broadcast masts that still shriek on the wind. Fragments that carry a warning you can almost place.",
  },
  // — Deep scientific sites (hazmat-gated, chipsets + plasma, T3) —
  {
    id: "deep-vaults",
    name: "The Deep Vaults",
    owner: "special",
    risk: 72,
    radiationLevel: 65,
    range: 78,
    quiet: 82,
    baseDurationMs: RUNG_TIMER_MS[26],
    emberYield: 66,
    chipsetChance: 0.32,
    corruptionRisk: 0.38,
    chorusRisk: 0.58,
    flavor: "Sub-basement archives beneath the old city. Complete sets shelved in the dark, each sealed behind a promise.",
  },
  {
    id: "null-engine",
    name: "The Null Engine",
    owner: "special",
    risk: 76,
    radiationLevel: 72,
    range: 83,
    quiet: 86,
    baseDurationMs: RUNG_TIMER_MS[27],
    emberYield: 70,
    chipsetChance: 0.34,
    corruptionRisk: 0.4,
    chorusRisk: 0.6,
    flavor: "A reactor hall that burns nothing and hums. The quietest, most patient mind in the ruins.",
  },
  {
    id: "starfall-core",
    name: "The Starfall Core",
    owner: "special",
    risk: 82,
    radiationLevel: 80,
    range: 88,
    quiet: 90,
    baseDurationMs: RUNG_TIMER_MS[28],
    emberYield: 74,
    chipsetChance: 0.36,
    corruptionRisk: 0.45,
    chorusRisk: 0.62,
    flavor: "A foundry where the sky itself was once forged down. Dense, ordered fragments — and the Chorus sings here.",
  },
];

export function getZone(id: string): Zone {
  return ZONES.find((z) => z.id === id)!;
}

export const DOMAINS: {
  id: DomainId;
  name: string;
  description: string;
  icon: string;
}[] = [
  { id: "weaponry", name: "Weaponry", description: "Arms and siege-works. Reduces Chorus/Corruption gain.", icon: "⚔️" },
  { id: "agriculture", name: "Agriculture", description: "Farms and forges of food. Earns supplies over time.", icon: "🌾" },
  { id: "economy", name: "Economy", description: "Trade and currency. Boosts ember yields and supplies.", icon: "💰" },
  { id: "industry", name: "Industry", description: "Refineries and workshops. Cuts exploration costs and speeds return.", icon: "⚙️" },
  { id: "logistics", name: "Logistics", description: "Routes, depots, signals. More scientists and faster exploration scheduling.", icon: "🚚" },
];

export const DOMAIN_BY_ID: Record<DomainId, { id: DomainId; name: string; description: string; icon: string }> =
  Object.fromEntries(DOMAINS.map((d) => [d.id, d])) as never;

/**
 * THE DOMAIN LADDER'S TOP RUNG — the ONE authoritative ceiling for a deployed
 * domain, and the only literal of it anywhere in the codebase.
 *
 * Why here: this module owns the domain table (DOMAINS), so the ladder's top
 * rung belongs beside it. Why 10: it is the rung the game's own maxed-colony
 * content already uses — the Fall prologue's "height" (PROLOGUE_CONFIG imports
 * this constant rather than repeating 10) and the L10 milestone the economy
 * report measures against. Every effect a domain grants reads its LEVEL, so the
 * ceiling has exactly two enforcement points and they share this constant:
 * `engine.deployProgram` (refuses past it, server-side — the authority) and
 * `engineHelpers.domainAffordable` (stops offering it in the UI).
 */
export const MAX_DOMAIN_LEVEL = 10;
