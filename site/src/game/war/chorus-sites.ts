// ============================================================================
// CHORUS SITES — the RAID LADDER's pinned table. DATA AND PURE FUNCTIONS ONLY.
//
// PR1 of the raid slice. **Nothing calls this module yet**: no server function,
// no endpoint, no engine change, no UI, no catalogue key. It exists so the
// numbers cannot drift, and so the later slices (muster → the raid → the loot →
// attention) read ONE table instead of re-deriving it.
//
// WHAT A GRADE IS. A grade IS the FOB stage the Chorus garrison is staged to —
// the engine already ships five of them and already uses them as a power ceiling
// on both terms that matter (`fobTroopCapByStage` caps the supply-weight brought
// to bear, applied in computeForcePower; `fobMaxTierByStage` caps the weapon
// hardware, applied in effectiveWeaponTier). So a grade needs NO new axis, and
// its strength is whatever `computeForcePower` returns for the garrison — the
// same function the player's own side is priced by, which is what makes the
// grades comparable to the player's force BY CONSTRUCTION. raid-tests asserts
// every carried `strength` against computeForcePower(chorusGarrison(zone)).
//
// THE HONEST STATE, and it must not be overstated anywhere (paper §"unverified",
// raid-calls-cleared §1): **the ladder is paper.** Grade = the FOB stage,
// **troops do not exist in the engine** (the reserve is zero for a new colony
// and only ever decremented), and a live colony has **no `fobStage` field**.
// PR1 does not change any of that. It pins the table those slices will read, and
// every price a raid will charge is still a proposal — see the gaps at the foot.
//
// PURITY. No state, no clock, no randomness, no I/O: every export is a constant
// table or a pure lookup over it. `chorusGarrison` / `chorusSiteStock` build a
// FRESH object per call (asserted in the suite by mutating a result and calling
// again). Reads only shipped data — zones (the ladder), the Forge's published
// drop table, the battle config's FOB tables.
// ============================================================================
import { forgeDepthTier, forgeDropChance } from "../forge";
import { ZONES, rungOfZone, rungTimerMs } from "../zones";
import type { Zone } from "../types";
import {
  BATTLES_CONFIG,
  type BattleHeroSnapshot,
  type CommittedForce,
  type CommittedWeapon,
  type FobStage,
} from "./war-types";

// ============================================================================
// §1 THE GRADE LADDER — five rows, one per FOB stage
// ============================================================================

export type ChorusGradeId = 1 | 2 | 3 | 4 | 5;

/** The grade's loot SHAPE. Both figures are grounded, and the module defines no
 *  new drop table:
 *   • `artifactChance` is the FORGE's own published table
 *     (`FORGE_CONFIG.dropChanceByTier`, forge.ts:48) indexed by GRADE — the
 *     owner's cleared rule ("higher grades, better drops", raid-calls-cleared
 *     §1). Grade I reads exactly zero, which is *also* the Forge's deliberate
 *     teaching ("SHALLOW IS ZERO"): a grade-I nest pays no artifact, and the
 *     loot copy says so rather than showing a zero.
 *   • `artifactQty` is the owner's cleared number: **1 per roll**. The dial is
 *     the COUNT, not the chance.
 *  Artifacts are a NEW MATERIAL (never warplate), stay on the never-in-a-bundle
 *  list, and are Forge INGREDIENTS — never a strength term (§15 B4's input set
 *  stays closed). */
export interface ChorusLootShape {
  artifactChance: number;
  artifactQty: number;
}

export interface ChorusGrade {
  grade: ChorusGradeId;
  /** The FOB stage the garrison is staged to. Also the index into both FOB
   *  tables below, which is why a grade needs no axis of its own. */
  fobStage: FobStage;
  /** READ from war-types.ts — never retyped. The stage's troop ceiling. */
  troopCap: number;
  /** READ from war-types.ts — never retyped. The stage's hardware ceiling. */
  maxKitTier: number;
  /** Reference cells fielded (see CHORUS_CELL_TEMPLATE). */
  cells: number;
  /** Each cell's mirror strength — the `chorusCell` scale factor. */
  cellStrength: number;
  /** The assault-family kit the garrison fields (null at grade I). */
  kit: CommittedWeapon | null;
  /** Garrison troops at the stage's ceiling. */
  troops: number;
  /** POWER — `computeForcePower(chorusGarrison(any site of this grade))`.
   *  The five figures the raid paper grades against (21 · 100 · 186 · 345 ·
   *  1330), each ASSERTED against the live engine by raid-tests. They are not
   *  chosen here: they fall out of the FOB table + the reference cell + the
   *  kit, all of which are shipped numbers. */
  strength: number;
  loot: ChorusLootShape;
}

/**
 * The reference cell. A Chorus warform cell mirrors a champion, exactly as the
 * shipped Act I primitive does (`chorusCell`, prologue/act1-battle.ts:123-139 —
 * scale each attribute, round, minimum 1; skills ride the mirror). The champion
 * mirrored here is the paper's reference: the wave-1 Watchers tank
 * **`azazel-3, the Teacher`** (heroes-data.ts:175-181) — baseAttributes
 * `{ power: 3, guard: 6, craft: 1, presence: 3 }` and its published
 * `strength: 0.10` skill, which at L1 makes one cell worth
 * `10.0 × 1 × 1.10 = 11.0` power.
 *
 * Carried BY VALUE, on purpose: the battle engine's discipline is that it never
 * imports the hero catalog (snapshots are flattened at commit time), and this
 * module is a war module. raid-tests pins the coupling instead — it asserts this
 * template against `heroes-data.ts`'s catalog row and the scaling against
 * `chorusCell`, so if the reference champion moves the raid ladder moves with
 * it, deliberately and visibly.
 */
export const CHORUS_CELL_TEMPLATE: BattleHeroSnapshot = {
  id: "chorus-cell",
  name: "Chorus cell",
  role: "tank",
  level: 1,
  attributes: { power: 3, guard: 6, craft: 1, presence: 3 },
  specialization: null,
  skills: [{ id: "azazel-apology-stand", name: "The Apology Stand", strength: 0.1 }],
};

/** The Chorus's display name — the value already shipped in the Act I front
 *  (`ACT1_CONFIG.chorusName`, prologue/act1-battle.ts). Reused by value so this
 *  module adds NO new player-facing string; raid-tests asserts the two are
 *  identical. The keyed, translated copy for the raid surface is a later
 *  slice's job. */
export const CHORUS_NAME = "The Chorus";

/** Every site's defender colony id carries this prefix, so a raid's defender is
 *  never mistakable for the caller's own colony (the `ourSide` matching trap the
 *  amendment §3.1 names). Distinct from the Act I front's
 *  `chorus-front-the-ashline`; raid-tests asserts it. */
export const CHORUS_SITE_COLONY_ID_PREFIX = "chorus-site";

/** The 5-row ladder. The FOB fields are READ, not retyped — change
 *  `war-types.ts` and this table follows. */
export const CHORUS_GRADES: readonly ChorusGrade[] = [
  {
    grade: 1,
    fobStage: 0,
    troopCap: BATTLES_CONFIG.fobTroopCapByStage[0],
    maxKitTier: BATTLES_CONFIG.fobMaxTierByStage[0],
    cells: 1,
    cellStrength: 1,
    kit: null,
    troops: 25,
    strength: 21,
    loot: { artifactChance: forgeDropChance(0), artifactQty: 1 },
  },
  {
    grade: 2,
    fobStage: 1,
    troopCap: BATTLES_CONFIG.fobTroopCapByStage[1],
    maxKitTier: BATTLES_CONFIG.fobMaxTierByStage[1],
    cells: 1,
    cellStrength: 1,
    kit: { family: "assault", tier: 1, count: 1 },
    troops: 50,
    strength: 100,
    loot: { artifactChance: forgeDropChance(1), artifactQty: 1 },
  },
  {
    grade: 3,
    fobStage: 2,
    troopCap: BATTLES_CONFIG.fobTroopCapByStage[2],
    maxKitTier: BATTLES_CONFIG.fobMaxTierByStage[2],
    cells: 2,
    cellStrength: 1,
    kit: { family: "assault", tier: 2, count: 1 },
    troops: 100,
    strength: 186,
    loot: { artifactChance: forgeDropChance(2), artifactQty: 1 },
  },
  {
    grade: 4,
    fobStage: 3,
    troopCap: BATTLES_CONFIG.fobTroopCapByStage[3],
    maxKitTier: BATTLES_CONFIG.fobMaxTierByStage[3],
    cells: 2,
    cellStrength: 2,
    kit: { family: "assault", tier: 3, count: 1 },
    troops: 200,
    strength: 345,
    loot: { artifactChance: forgeDropChance(3), artifactQty: 1 },
  },
  {
    grade: 5,
    fobStage: 4,
    troopCap: BATTLES_CONFIG.fobTroopCapByStage[4],
    maxKitTier: BATTLES_CONFIG.fobMaxTierByStage[4],
    cells: 2,
    cellStrength: 3,
    kit: { family: "assault", tier: 4, count: 1 },
    troops: 400,
    strength: 1330,
    // The Forge's table has FOUR bands against the ladder's five grades, so
    // grades IV and V read the same 0.35 — the clamp is `forgeDropChance`'s own,
    // not a number invented here. The owner's `1 per roll` is the dial, and the
    // grade-V site's advantage is its strength and its depth, not its odds.
    loot: { artifactChance: forgeDropChance(4), artifactQty: 1 },
  },
];

// ============================================================================
// §2 THE PINNED 15-ROW SITE TABLE — 3 sites per grade, on named shipped zones
// ============================================================================

/** One site: a place inside a shipped zone. `zoneId` names the zone; the
 *  module invents no zone names. */
export interface ChorusSite {
  grade: ChorusGradeId;
  zoneId: string;
}

/**
 * THE PIN — 15 sites, 3 per grade, on 29 shipped zones. **A PROPOSAL**, pinned
 * rather than derived, because NO single shipped field can express a 5-grade
 * ladder over a 4-band world (the raid paper §2.1, and the plan's own "five
 * grades against a four-band table must tie twice"):
 *
 *   • `forgeDepthTier` (forge.ts:207-213: rad ≥ 75 → 3, ≥ 60 → 2, ≥ 35 or risk
 *     ≥ 50 → 1, else 0) partitions the world 17 / 6 / 3 / 3. The top two tiers
 *     hold EXACTLY three zones each, so they pin grades V and IV perfectly —
 *     and nothing else, and grades I–III cannot be expressed in that field at
 *     all. (The paper's §2.1 middle bands are not satisfiable from the live
 *     tree: its grade-III band "rad 40-60" holds only TWO zones — here the
 *     `shattered-academies` (40) and `quantum-facility` (60) the same table also
 *     claims for grade IV — and the other zone it names there, `collider-ruins`
 *     (rad 80), is one of the three the same document forces into grade V. Its
 *     grade-II band is quoted with `cinder-farms`, rad 5.)
 *   • So the two ENDS are forced and the middle is chosen by one stated rule:
 *     **grade I** on the three lowest rungs (the reachable, ordnance-free
 *     entries — rung 0–2, the paper's day-two anchor); **grade V** on the three
 *     zones at or above the Forge's own deepest ring (rad ≥
 *     `FORGE_CONFIG.depth.deepest`, 75); and the nine
 *     middle sites are the nine highest-radiation zones outside those two sets,
 *     taken in radiation-DESCENDING order (ties: the deeper rung first, since
 *     both axes are climbing) and split 3/3/3 into grades IV, III, II.
 *
 * The rule is asserted, not just described: raid-tests re-derives the 15 rows
 * from it and fails if the table drifts. Consequences worth saying out loud,
 * both harmless and both stated rather than hidden: the shallow interior (rad
 * < 30, fourteen zones) holds NO Chorus site — the nests sit where the wreckage
 * is deepest — and a radiation tie at 32 splits across two grades
 * (`titan-breaks` rung 24 into III, `shard-fields` rung 23 into II).
 *
 * The alternative a reviewer may prefer, one table edit away: pin the middle
 * three grades by REACHABILITY (the lowest rung inside each danger band), which
 * makes a mid-ladder raid cheaper to enter. It was not taken because the loot is
 * graded by grade and the sites should climb the danger axis with it.
 */
export const CHORUS_SITES: readonly ChorusSite[] = [
  // I — rungs 0-2: the day-two reachable rim.
  { grade: 1, zoneId: "outer-ruins" },
  { grade: 1, zoneId: "observatories" },
  { grade: 1, zoneId: "boneyard" },
  // II — rad 30-32.
  { grade: 2, zoneId: "forge-valleys" },
  { grade: 2, zoneId: "murmur-sumps" },
  { grade: 2, zoneId: "shard-fields" },
  // III — rad 32-40.
  { grade: 3, zoneId: "shattered-academies" },
  { grade: 3, zoneId: "titan-breaks" },
  { grade: 3, zoneId: "wailing-towers" },
  // IV — rad 60-72 (`forgeDepthTier === 2`, exactly three zones).
  { grade: 4, zoneId: "quantum-facility" },
  { grade: 4, zoneId: "deep-vaults" },
  { grade: 4, zoneId: "null-engine" },
  // V — rad >= 75 (`forgeDepthTier === 3`, exactly three zones).
  { grade: 5, zoneId: "collider-ruins" },
  { grade: 5, zoneId: "dark-matter-observatory" },
  { grade: 5, zoneId: "starfall-core" },
];

// ============================================================================
// §3 THE PURE LOOKUPS
// ============================================================================

/** The zone's id, whether a Zone object or an id was handed in. */
function zoneIdOf(zone: Zone | string): string {
  return typeof zone === "string" ? zone : zone.id;
}

/** The site a zone holds, or null. */
export function chorusSiteOf(zone: Zone | string): ChorusSite | null {
  const id = zoneIdOf(zone);
  return CHORUS_SITES.find((s) => s.zoneId === id) ?? null;
}

/** One mirrored cell at a given mirror strength. Same scale-and-round the
 *  shipped `chorusCell` primitive uses (prologue/act1-battle.ts:123-139):
 *  `max(1, round(attr × s))` — minimum 1, so a cell is never an empty shell. */
function chorusCellAt(strength: number, index: number, colonyId: string): BattleHeroSnapshot {
  const t = CHORUS_CELL_TEMPLATE;
  const scale = (n: number) => Math.max(1, Math.round(n * strength));
  return {
    ...t,
    id: `${colonyId}:cell-${index + 1}`,
    attributes: {
      power: scale(t.attributes.power),
      guard: scale(t.attributes.guard),
      craft: scale(t.attributes.craft),
      presence: scale(t.attributes.presence),
    },
    skills: t.skills.map((s) => ({ ...s })),
  };
}

/**
 * The garrison a site fields — a `CommittedForce` the battle engine can price
 * with `computeForcePower` (the same §15 B4 formula that prices the player).
 *
 * Stateless and always at FULL grade strength: the paper §2.4's anti-exploit.
 * With persistent attrition a patient player could grind a grade-V hive down
 * with cheap raids and the ladder would collapse; so a site holds no garrison
 * of its own, and the casualty figures on a report are that fight's toll, not a
 * permanent weakening.
 *
 * Returns a FRESH object every call, and `null` for a zone that holds no site
 * (only 15 of the 29 zones do).
 */
export function chorusGarrison(zone: Zone | string): CommittedForce | null {
  const site = chorusSiteOf(zone);
  if (!site) return null;
  const id = site.zoneId;
  const grade = CHORUS_GRADES[site.grade - 1];
  const colonyId = `${CHORUS_SITE_COLONY_ID_PREFIX}-${id}`;
  return {
    side: "defender",
    colonyId,
    colonyName: CHORUS_NAME,
    heroSquad: Array.from({ length: grade.cells }, (_, i) => chorusCellAt(grade.cellStrength, i, colonyId)),
    weapons: grade.kit ? [{ ...grade.kit }] : [],
    troops: grade.troops,
    fobStage: grade.fobStage,
  };
}

/** What a site holds, and when it refills. Every field is READ from shipped
 *  data; this module invents none of them. */
export interface ChorusSiteStock {
  zoneId: string;
  grade: ChorusGradeId;
  /** The zone's rung on the expedition ladder (`rungOfZone`). */
  rung: number;
  /** The refill period: **the zone's OWN run timer**, `rungTimerMs(rung)` — no
   *  new constant (paper §2.4). A rim nest refills in 4 h, the deepest in a
   *  week. `BATTLES_CONFIG`/`FORGE_CONFIG` are not consulted; the ladder is. */
  refillMs: number;
  /** The zone's depth tier (`forgeDepthTier`) — the axis the Forge's ingredient
   *  drop already reads, carried here so a later slice never re-derives it. */
  depthTier: number;
  /** The Forge's published table, by grade: grade I is exactly zero. */
  artifactChance: number;
  /** The owner's cleared count: 1 per roll. */
  artifactQty: number;
  /** The zone's own published Ember yield, passed through for the loot slice.
   *  The PAYOUT FRACTION applied to it is a proposal and deliberately does not
   *  live here (see the gaps below). */
  emberYield: number;
}

/** A site's stock, or null for a zone that holds no site. Fresh object per
 *  call, no side effects, no state. */
export function chorusSiteStock(zone: Zone | string): ChorusSiteStock | null {
  const site = chorusSiteOf(zone);
  if (!site) return null;
  const id = site.zoneId;
  const z = ZONES.find((candidate) => candidate.id === id);
  if (!z) return null;
  const grade = CHORUS_GRADES[site.grade - 1];
  const rung = rungOfZone(id);
  return {
    zoneId: id,
    grade: site.grade,
    rung,
    refillMs: rungTimerMs(rung),
    depthTier: forgeDepthTier(z),
    artifactChance: grade.loot.artifactChance,
    artifactQty: grade.loot.artifactQty,
    emberYield: z.emberYield,
  };
}

// ============================================================================
// §4 WHAT THIS MODULE DELIBERATELY DOES NOT CARRY — the gaps, named
// ============================================================================
//
// Every line below is a number the raid needs and this slice REFUSES to invent.
// They are not omissions to be quietly filled in later; they are the gaps the
// PR body names, and a later slice lands each one with its own grounding:
//
//   • SUPPLIES / EMBERS PER RAID. The paper's §2.1 table (3 · 4 · 5 · 6 · 8 📦
//     and `round(emberYield × 0.25)`) is `[P]` — a proposal with no engine price,
//     and the owner's "small supplies" is not yet a figure. `chorusSiteStock`
//     passes the zone's own `emberYield` through and nothing else, so no payout
//     is invented here. The loot slice (PR4) carries it, stamped at resolve.
//   • THE RUNG DEMAND IS NOT CHARGED. A raid pays ops + ordnance + the shared
//     energy draw + the muster — never the zone's rung demand (paper §3.5). That
//     exclusion is precisely what makes a raid a faucet rather than a pure sink,
//     and it is the single line a future contributor will "fix"; it belongs in
//     the commit that charges the cost, not here.
//   • THE MUSTER PRICE (≈0.39 📦/troop) is the paper's LARGEST INVENTED NUMBER
//     and every raid cost line inherits it. It is a proposal to be tuned in play,
//     not a measured figure, and it is PR2's (the muster) business. Nothing in
//     this module quotes it.
//   • ATTENTION (Branch A: `chorusRisk × 100 × chorusResist × … × 1.5`, 9.0 at
//     rung 0 → clamped 100 at `starfall-core`) is cleared and is PR5's. The ×1.5
//     is the branch's one invented constant; it is not in this table.
//   • THE FIELD-ITEM / SEIZURE PATH is PR6's (`seizableForgeItems` /
//     `transferForgeItem` exist with no caller). A committed field item is NOT a
//     strength term: §15 B4's `heroTerm + weaponTerm + troopTerm` stays closed,
//     which is why nothing here takes a ForgeItem.
//   • KEYED COPY ("{grade} · {zone}", the stock line, the report row) and the
//     grade names are a later slice: every new string must be born keyed and
//     translated in all five languages in the same commit, and this slice adds
//     NONE (it reuses the Chorus's existing display name by value).
//   • THE SITES ARE NEVER ACCUMULATED: `chorusSiteStock` does not stamp
//     `lastRaidedAt`, hold a stock level, or hold prizes. A site record
//     (`{ zoneId, grade, lastRaidedAt, stock, prizes }`) is state, and this
//     module is pure by design.
