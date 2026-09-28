// ============================================================================
// raid-tests/raid-verify.ts — CHORUS RAID PR1: the ladder's pinned table.
//
// The module under test is `game/war/chorus-sites.ts` (data + pure lookups, NO
// wiring). This harness is its contract, and it is deliberately nosey about
// where every number CAME FROM — a table that only agrees with itself is worth
// nothing:
//
//   §1 SHAPE            — 5 grades, 15 sites, 3 per grade, every site's zone id
//                         real (checked against `zones.ts`), no zone twice, and
//                         `null` for a zone that holds no site.
//   §2 THE FOB READ     — every row's troop cap / kit ceiling IS the value in
//                         `war-types.ts` (read, never retyped — asserted three
//                         ways, including a source scan for a re-typed array).
//   §3 STRENGTH         — each carried figure (21 · 100 · 186 · 345 · 1330) is
//                         re-derived from the live engine, two ways: through
//                         `computeForcePower`, and by hand from
//                         heroTerm + weaponTerm + troopTerm. Plus the day-two
//                         anchor: grade I (21) sits BELOW the stage-0 muster
//                         ceiling (100 troops × 0.4 = 40), and the closed §15 B4
//                         input set (no fourth term, no loot term).
//   §4 LOOT             — grade I pays ZERO artifacts (the Forge's own
//                         `dropChanceByTier[0]`), every chance is read from that
//                         one table by GRADE, the module defines NO second drop
//                         table (source scan), the count is the owner's 1, and
//                         artifacts are not warplate and not a strength term.
//   §5 STOCK            — the refill period is the zone's OWN run timer
//                         (`rungTimerMs(rungOfZone(zone))`), the depth tier is
//                         `forgeDepthTier`, the Ember yield is the zone's field.
//   §6 THE PIN          — the 15 rows are exactly the output of the rule the
//                         module documents (I on rungs 0-2, V on rad ≥ 75, the
//                         nine middle sites the highest-radiation remainder,
//                         split 3/3/3 into IV/III/II), and radiation never
//                         decreases as the grades climb.
//   §7 PURITY / NO WIRING — deterministic, fresh object per call, no source
//                         imports an engine/api/store module, and NOTHING in
//                         `src/` imports the module yet (this slice adds no
//                         behaviour).
//   §8 CONTROLS         — six planted defects. Each must break the NAMED
//                         invariant, so "the check passed" is a claim with a
//                         demonstrated way to fail.
//
// Run: cd /home/team/shared/raid-tests && env -u DATABASE_URL bun run raid-verify.ts
// ============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHORUS_GRADES,
  CHORUS_SITES,
  CHORUS_CELL_TEMPLATE,
  CHORUS_NAME,
  CHORUS_SITE_COLONY_ID_PREFIX,
  chorusGarrison,
  chorusSiteOf,
  chorusSiteStock,
  type ChorusGrade,
  type ChorusSite,
} from "/home/team/shared/site/src/game/war/chorus-sites.ts";
import { BATTLES_CONFIG } from "/home/team/shared/site/src/game/war/war-types.ts";
import {
  computeForcePower,
  effectiveWeaponTier,
  heroUnitPower,
  kitPower,
} from "/home/team/shared/site/src/game/war/battle-engine.ts";
import { ZONES, rungOfZone, rungTimerMs } from "/home/team/shared/site/src/game/zones.ts";
import { FORGE_CONFIG, forgeDepthTier, forgeDropChance } from "/home/team/shared/site/src/game/forge.ts";
import { HERO_DEFS } from "/home/team/shared/site/src/game/heroes-data.ts";
import { ACT1_CONFIG, chorusCell } from "/home/team/shared/site/src/game/prologue/act1-battle.ts";

const SRC_ROOT = "/home/team/shared/site/src";
const MODULE_PATH = join(SRC_ROOT, "game/war/chorus-sites.ts");
const MODULE_SRC = readFileSync(MODULE_PATH, "utf8");
/** The module with comments stripped — source scans read the EXECUTABLE text
 *  only, so a comment may name a number without tripping a scan. */
const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

const sitesOfGrade = (grade: number) => CHORUS_SITES.filter((s) => s.grade === grade);
const zoneOf = (id: string) => ZONES.find((z) => z.id === id);
const gradeOf = (grade: number) => CHORUS_GRADES[grade - 1];

// ============================================================================
// §1 · SHAPE — 5 grades, 15 sites, every zone real
// ============================================================================
console.log("\n§1 SHAPE");
check("exactly 5 grades", CHORUS_GRADES.length === 5, `length=${CHORUS_GRADES.length}`);
check(
  "the grade ids are 1..5, in order",
  CHORUS_GRADES.every((g, i) => g.grade === i + 1),
  CHORUS_GRADES.map((g) => g.grade).join(","),
);
check("exactly 15 sites", CHORUS_SITES.length === 15, `length=${CHORUS_SITES.length}`);
for (const g of CHORUS_GRADES) {
  const n = sitesOfGrade(g.grade).length;
  check(`grade ${g.grade} holds exactly 3 sites`, n === 3, `holds ${n}`);
}
check(
  "no zone holds two sites",
  new Set(CHORUS_SITES.map((s) => s.zoneId)).size === CHORUS_SITES.length,
  CHORUS_SITES.map((s) => s.zoneId).join(","),
);
{
  const bad = CHORUS_SITES.filter((s) => !zoneOf(s.zoneId)).map((s) => s.zoneId);
  check(
    `every site's zone id exists in zones.ts (${CHORUS_SITES.length} checked against ${ZONES.length} zones)`,
    bad.length === 0,
    `unknown: ${bad.join(",")}`,
  );
}
{
  const bad = CHORUS_SITES.filter((s) => zoneOf(s.zoneId)!.id !== s.zoneId).map((s) => s.zoneId);
  check("…and every id resolves to that same zone (no aliasing)", bad.length === 0, bad.join(","));
}
check(
  "a zone that holds no site reads null (cinder-farms)",
  chorusSiteOf("cinder-farms") === null && chorusGarrison("cinder-farms") === null && chorusSiteStock("cinder-farms") === null,
);
check(
  "an unknown zone id reads null too (never a rim default)",
  chorusGarrison("no-such-zone") === null && chorusSiteStock("no-such-zone") === null,
);
check(
  "a Zone object and its id give the same answer",
  JSON.stringify(chorusGarrison(zoneOf("outer-ruins")!)) === JSON.stringify(chorusGarrison("outer-ruins")),
);

// ============================================================================
// §2 · THE FOB READ — the tables come from war-types.ts, not from a retyped copy
// ============================================================================
console.log("\n§2 THE FOB READ");
for (const g of CHORUS_GRADES) {
  check(
    `grade ${g.grade} (stage ${g.fobStage}) reads its troop cap from war-types.ts: ${BATTLES_CONFIG.fobTroopCapByStage[g.fobStage]}`,
    g.troopCap === BATTLES_CONFIG.fobTroopCapByStage[g.fobStage],
    `carried ${g.troopCap}`,
  );
  check(
    `grade ${g.grade} (stage ${g.fobStage}) reads its kit ceiling from war-types.ts: ${BATTLES_CONFIG.fobMaxTierByStage[g.fobStage]}`,
    g.maxKitTier === BATTLES_CONFIG.fobMaxTierByStage[g.fobStage],
    `carried ${g.maxKitTier}`,
  );
  check(
    `grade ${g.grade} stays inside its own stage's troop ceiling`,
    g.troops <= g.troopCap && g.troops > 0,
    `${g.troops} > ${g.troopCap}`,
  );
  check(
    `grade ${g.grade}'s kit is at its own stage's ceiling (T${g.maxKitTier}) — the garrison is staged, not overloaded`,
    (g.kit?.tier ?? g.maxKitTier) === g.maxKitTier,
    `kit T${g.kit?.tier} vs ceiling T${g.maxKitTier}`,
  );
}
check(
  "the stage-0 troop cap IS 100 and grade I's cap equals it (the day-two anchor's ceiling)",
  BATTLES_CONFIG.fobTroopCapByStage[0] === 100 && gradeOf(1).troopCap === BATTLES_CONFIG.fobTroopCapByStage[0],
  `stage-0 ${BATTLES_CONFIG.fobTroopCapByStage[0]}, carried ${gradeOf(1).troopCap}`,
);
check(
  "the FOB tables are NOT re-typed in the module (executable source holds no literal copy)",
  !/100\s*,\s*150\s*,\s*250\s*,\s*400\s*,\s*600/.test(MODULE_CODE) && !/\[\s*1\s*,\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*\]/.test(MODULE_CODE),
  "a literal copy of fobTroopCapByStage / fobMaxTierByStage was found",
);

// ============================================================================
// §3 · STRENGTH — every carried figure re-derived from the live engine
// ============================================================================
console.log("\n§3 STRENGTH");
check(
  "the five carried strengths ARE the paper's ladder 21 · 100 · 186 · 345 · 1330",
  JSON.stringify(CHORUS_GRADES.map((g) => g.strength)) === JSON.stringify([21, 100, 186, 345, 1330]),
  CHORUS_GRADES.map((g) => g.strength).join(" · "),
);
check(
  "the strengths are strictly increasing",
  CHORUS_GRADES.every((g, i) => i === 0 || g.strength > CHORUS_GRADES[i - 1].strength),
  CHORUS_GRADES.map((g) => g.strength).join(" · "),
);
for (const g of CHORUS_GRADES) {
  const site = sitesOfGrade(g.grade)[0];
  const force = chorusGarrison(site.zoneId)!;
  const computed = computeForcePower(force);
  check(
    `grade ${g.grade} (${site.zoneId}): computeForcePower(chorusGarrison) === the carried ${g.strength}`,
    computed === g.strength,
    `engine says ${computed}`,
  );
  const heroTerm = force.heroSquad.reduce((s, h) => s + heroUnitPower(h), 0);
  const weaponTerm = force.weapons.reduce(
    (s, k) => s + kitPower(k.family, effectiveWeaponTier(k.tier, force.fobStage)) * k.count,
    0,
  );
  const troopTerm = Math.min(force.troops, BATTLES_CONFIG.fobTroopCapByStage[force.fobStage]) * BATTLES_CONFIG.troopPowerPerTroop;
  check(
    `grade ${g.grade} decomposes by hand: heroTerm ${heroTerm} + weaponTerm ${weaponTerm} + troopTerm ${troopTerm} = ${g.strength}`,
    Math.round(heroTerm + weaponTerm + troopTerm) === g.strength,
    `${heroTerm} + ${weaponTerm} + ${troopTerm} = ${heroTerm + weaponTerm + troopTerm}`,
  );
}
{
  const one = heroUnitPower(CHORUS_CELL_TEMPLATE);
  check("the reference cell at L1 with its 0.10 skill is worth exactly 11.0 power", Math.abs(one - 11) < 1e-9, `${one}`);
}
check(
  "the assault kit ladder is the engine's own 69 · 124 · 221 · 1104 (T1..T4)",
  JSON.stringify([1, 2, 3, 4].map((t) => kitPower("assault", t))) === JSON.stringify([69, 124, 221, 1104]),
  [1, 2, 3, 4].map((t) => kitPower("assault", t)).join(" · "),
);
{
  const azazel = HERO_DEFS.find((h) => h.id === "azazel-3")!;
  check(
    "the cell template IS the catalog's azazel-3 attribute vector (baseAttributes 3/6/1/3)",
    JSON.stringify(CHORUS_CELL_TEMPLATE.attributes) === JSON.stringify(azazel.baseAttributes),
    JSON.stringify(CHORUS_CELL_TEMPLATE.attributes),
  );
  const published = (azazel.skills as any[]).map((s) => s.values?.strength).filter((v) => typeof v === "number");
  check(
    "…and its strength skill carries the catalog's published 0.10",
    (CHORUS_CELL_TEMPLATE.skills as any[]).every((s) => published.includes(s.strength)),
    `${JSON.stringify(CHORUS_CELL_TEMPLATE.skills)} vs catalog ${JSON.stringify(published)}`,
  );
}
for (const g of CHORUS_GRADES) {
  const force = chorusGarrison(sitesOfGrade(g.grade)[0].zoneId)!;
  const mirrored = chorusCell(CHORUS_CELL_TEMPLATE, g.cellStrength);
  check(
    `grade ${g.grade}'s cells use the shipped chorusCell scaling at s=${g.cellStrength}`,
    JSON.stringify(force.heroSquad[0].attributes) === JSON.stringify(mirrored.attributes) &&
      JSON.stringify(force.heroSquad[0].skills) === JSON.stringify(mirrored.skills),
    `${JSON.stringify(force.heroSquad[0].attributes)} vs ${JSON.stringify(mirrored.attributes)}`,
  );
}
{
  const musterAtStage0 = BATTLES_CONFIG.fobTroopCapByStage[0] * BATTLES_CONFIG.troopPowerPerTroop;
  check(
    `the day-two anchor holds: grade I (21) is BELOW a full stage-0 muster (100 troops = ${musterAtStage0} power)`,
    gradeOf(1).strength < musterAtStage0,
    `21 vs ${musterAtStage0}`,
  );
}
{
  const keys = Object.keys(chorusGarrison("outer-ruins")!).sort();
  const allowed = ["colonyId", "colonyName", "fobStage", "heroSquad", "side", "troops", "weapons"].sort();
  check(
    "the garrison carries ONLY the §15 B4 input set — no fourth term, no loot term, no artifact",
    JSON.stringify(keys) === JSON.stringify(allowed),
    keys.join(","),
  );
}

// ============================================================================
// §4 · LOOT — grade I pays zero, and the chance table is the Forge's own
// ============================================================================
console.log("\n§4 LOOT");
check(
  "GRADE I PAYS ZERO ARTIFACTS (chance × count = 0 at every grade-I site)",
  sitesOfGrade(1).every((s) => {
    const st = chorusSiteStock(s.zoneId)!;
    return st.artifactChance === 0 && st.artifactChance * st.artifactQty === 0;
  }),
  JSON.stringify(sitesOfGrade(1).map((s) => chorusSiteStock(s.zoneId))),
);
check(
  "grade I's zero IS the Forge's own dropChanceByTier[0] (not a number chosen here)",
  gradeOf(1).loot.artifactChance === FORGE_CONFIG.dropChanceByTier[0] && FORGE_CONFIG.dropChanceByTier[0] === 0,
  `${gradeOf(1).loot.artifactChance}`,
);
for (const g of CHORUS_GRADES) {
  const expected = forgeDropChance(g.grade - 1);
  check(
    `grade ${g.grade}'s artifact chance is read from the Forge's published table by grade: ${expected}`,
    g.loot.artifactChance === expected && chorusSiteStock(sitesOfGrade(g.grade)[0].zoneId)!.artifactChance === expected,
    `carried ${g.loot.artifactChance}, forgeDropChance says ${expected}`,
  );
}
check(
  "the module defines NO second drop table (executable source holds no chance literal and no table name)",
  !/dropChanceByTier/.test(MODULE_CODE) && !/0\.06|0\.18|0\.35/.test(MODULE_CODE),
  "a re-typed drop chance was found in the module",
);
check(
  "the five-grade ladder ties twice on the Forge's four bands, and the tie is the function's own clamp",
  gradeOf(4).loot.artifactChance === gradeOf(5).loot.artifactChance &&
    forgeDropChance(4) === forgeDropChance(3) &&
    gradeOf(5).loot.artifactChance === forgeDropChance(3),
  `${gradeOf(4).loot.artifactChance} / ${gradeOf(5).loot.artifactChance}`,
);
check(
  "the artifact count is the owner's cleared 1 per roll, at every paying grade",
  CHORUS_GRADES.every((g) => g.loot.artifactQty === 1),
  CHORUS_GRADES.map((g) => g.loot.artifactQty).join(","),
);
check(
  "artifacts are NOT warplate: the loot shape has no warplate field and the module never names it",
  CHORUS_GRADES.every((g) => !("warplate" in g.loot)) && !/warplate/.test(MODULE_CODE),
);
check(
  "loot is a SHAPE, not a strength input: it carries exactly { artifactChance, artifactQty } — nothing that could enter a term",
  CHORUS_GRADES.every(
    (g) =>
      JSON.stringify(Object.keys(g.loot).sort()) === JSON.stringify(["artifactChance", "artifactQty"]) &&
      typeof g.loot.artifactChance === "number" &&
      typeof g.loot.artifactQty === "number",
  ),
  JSON.stringify(CHORUS_GRADES.map((g) => Object.keys(g.loot))),
);

// ============================================================================
// §5 · STOCK — every field read, none invented
// ============================================================================
console.log("\n§5 STOCK");
for (const s of CHORUS_SITES) {
  const st = chorusSiteStock(s.zoneId)!;
  const z = zoneOf(s.zoneId)!;
  check(
    `${s.zoneId}: the refill period is the zone's OWN run timer (rung ${st.rung} = ${st.refillMs / 3_600_000} h)`,
    st.rung === rungOfZone(s.zoneId) && st.refillMs === rungTimerMs(rungOfZone(s.zoneId)),
    `${st.refillMs} vs ${rungTimerMs(rungOfZone(s.zoneId))}`,
  );
  check(
    `${s.zoneId}: the depth tier is forgeDepthTier(zone) = ${forgeDepthTier(z)}, and the Ember yield is the zone's own ${z.emberYield}`,
    st.depthTier === forgeDepthTier(z) && st.emberYield === z.emberYield,
    `tier ${st.depthTier}, ember ${st.emberYield}`,
  );
}
check(
  "the stock invents no payout: it carries no supplies/embers-per-raid figure at all",
  CHORUS_SITES.every((s) => {
    const st: any = chorusSiteStock(s.zoneId)!;
    return !("supplies" in st) && !("embers" in st) && !("warplate" in st) && !("artifactPerRaid" in st);
  }),
);
check(
  "the stock holds no state: no lastRaidedAt, no stock level, no prizes",
  CHORUS_SITES.every((s) => {
    const st: any = chorusSiteStock(s.zoneId)!;
    return !("lastRaidedAt" in st) && !("stock" in st) && !("prizes" in st);
  }),
);

// ============================================================================
// §6 · THE PIN — the table IS the rule the module documents
// ============================================================================
console.log("\n§6 THE PIN");
{
  const i = ZONES.slice(0, 3).map((z) => z.id);
  const v = ZONES.filter((z) => z.radiationLevel >= FORGE_CONFIG.depth.deepest).map((z) => z.id);
  const forced = new Set([...i, ...v]);
  const rest = ZONES.filter((z) => !forced.has(z.id)).sort(
    (a, b) => b.radiationLevel - a.radiationLevel || rungOfZone(b.id) - rungOfZone(a.id),
  );
  const mid = rest.slice(0, 9);
  const rule = [
    ...i.map((zoneId) => ({ grade: 1, zoneId })),
    ...mid.slice(6, 9).map((z) => ({ grade: 2, zoneId: z.id })),
    ...mid.slice(3, 6).map((z) => ({ grade: 3, zoneId: z.id })),
    ...mid.slice(0, 3).map((z) => ({ grade: 4, zoneId: z.id })),
    ...v.map((zoneId) => ({ grade: 5, zoneId })),
  ]
    .map((r) => `${r.grade}:${r.zoneId}`)
    .sort();
  const table = CHORUS_SITES.map((s) => `${s.grade}:${s.zoneId}`).sort();
  check(
    "the 15 rows are exactly the documented pin rule's output (I: rungs 0-2 · V: rad ≥ 75 · the nine highest-radiation of the rest, split 3/3/3 into IV/III/II)",
    JSON.stringify(rule) === JSON.stringify(table),
    `rule ${rule.join(" ")} vs table ${table.join(" ")}`,
  );
  check(
    "grade V's three sites ARE the three zones at or above the Forge's deepest ring (rad ≥ 75)",
    sitesOfGrade(5).map((s) => s.zoneId).sort().join(",") === [...v].sort().join(","),
    `${sitesOfGrade(5).map((s) => s.zoneId).join(",")} vs ${v.join(",")}`,
  );
  check(
    "grade IV's three sites ARE the three zones at forgeDepthTier 2 (rad ≥ 60)",
    sitesOfGrade(4).every((s) => forgeDepthTier(zoneOf(s.zoneId)!) === 2) &&
      ZONES.filter((z) => forgeDepthTier(z) === 2).length === 3,
    sitesOfGrade(4).map((s) => `${s.zoneId}:${forgeDepthTier(zoneOf(s.zoneId)!)}`).join(","),
  );
  check(
    "grade I's three sites ARE rungs 0-2 (the reachable, ordnance-free rim)",
    sitesOfGrade(1).map((s) => rungOfZone(s.zoneId)).sort((a, b) => a - b).join(",") === "0,1,2",
    sitesOfGrade(1).map((s) => `${s.zoneId}:${rungOfZone(s.zoneId)}`).join(","),
  );
}
{
  const maxOf = (g: number) => Math.max(...sitesOfGrade(g).map((s) => zoneOf(s.zoneId)!.radiationLevel));
  const minOf = (g: number) => Math.min(...sitesOfGrade(g).map((s) => zoneOf(s.zoneId)!.radiationLevel));
  const climbs = [2, 3, 4, 5].every((g) => minOf(g) >= maxOf(g - 1));
  check(
    "radiation never DECREASES as the grades climb (I max 30 → II min 30 → … → V min 80)",
    climbs,
    [1, 2, 3, 4, 5].map((g) => `${g}: ${minOf(g)}-${maxOf(g)}`).join(" · "),
  );
}

// ============================================================================
// §7 · PURITY — deterministic, fresh, unwired, engine-free
// ============================================================================
console.log("\n§7 PURITY & NO WIRING");
{
  const a = chorusGarrison("starfall-core")!;
  const b = chorusGarrison("starfall-core")!;
  check("two calls give byte-identical garrisons (deterministic, no clock, no RNG)", JSON.stringify(a) === JSON.stringify(b));
  a.troops = 999_999;
  a.heroSquad.push({ ...a.heroSquad[0] });
  const c = chorusGarrison("starfall-core")!;
  check("mutating a returned garrison does not leak into the next call (fresh object per call)", c.troops === gradeOf(5).troops && c.heroSquad.length === gradeOf(5).cells, `troops ${c.troops}, cells ${c.heroSquad.length}`);
  check("the module reaches for no randomness", !/Math\.random/.test(MODULE_CODE));
  check(
    "the module imports no engine / api / store / account module (it is a pure war-data module)",
    !/from\s+"(\.\.\/(engine|api|store|client-utils))/.test(MODULE_CODE) && !/from\s+"\.\.\/prologue/.test(MODULE_CODE),
  );
  check(
    "the module adds NO new player-facing string: the Chorus's name is the one already shipped in Act I",
    CHORUS_NAME === ACT1_CONFIG.chorusName,
    `${CHORUS_NAME} vs ${ACT1_CONFIG.chorusName}`,
  );
  const sites = CHORUS_SITES.map((s) => s.zoneId);
  check(
    `every site's defender colony id is distinct and namespaced ("${CHORUS_SITE_COLONY_ID_PREFIX}-<zone>")`,
    new Set(sites.map((id) => chorusGarrison(id)!.colonyId)).size === 15 &&
      sites.every((id) => chorusGarrison(id)!.colonyId.startsWith(`${CHORUS_SITE_COLONY_ID_PREFIX}-`)) &&
      sites.every((id) => chorusGarrison(id)!.colonyId !== ACT1_CONFIG.chorusColonyId),
  );
  check("every garrison is on the DEFENDER side", sites.every((id) => chorusGarrison(id)!.side === "defender"));
}
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const importers = walk(SRC_ROOT).filter(
    (f) => f !== MODULE_PATH && /chorus-sites/.test(readFileSync(f, "utf8")),
  );
  check(
    "NO WIRING: nothing under src/ imports chorus-sites yet (this slice adds no behaviour)",
    importers.length === 0,
    importers.join(", "),
  );
}

// ============================================================================
// §8 · CONTROLS — planted defects, each must break the NAMED invariant
// ============================================================================
console.log("\n§8 CONTROLS");
interface Invariant {
  name: string;
  ok: boolean;
  detail: string;
}
/** Audit a table WITHOUT the module's singletons, so a planted defect can be
 *  run through the same assertions the real table passes. */
function audit(grades: readonly ChorusGrade[], sites: readonly ChorusSite[]): Invariant[] {
  const out: Invariant[] = [];
  const push = (name: string, ok: boolean, detail = "") => out.push({ name, ok, detail });
  push("exactly 5 grades", grades.length === 5, `${grades.length}`);
  push("exactly 15 sites", sites.length === 15, `${sites.length}`);
  for (const g of grades) {
    const n = sites.filter((s) => s.grade === g.grade).length;
    push(`grade ${g.grade} holds exactly 3 sites`, n === 3, `${n}`);
  }
  push("no zone holds two sites", new Set(sites.map((s) => s.zoneId)).size === sites.length);
  const unknown = sites.filter((s) => !ZONES.some((z) => z.id === s.zoneId)).map((s) => s.zoneId);
  push("every site's zone id exists in zones.ts", unknown.length === 0, unknown.join(","));
  for (const g of grades) {
    push(
      `grade ${g.grade} reads its troop cap from war-types.ts`,
      g.troopCap === BATTLES_CONFIG.fobTroopCapByStage[g.fobStage],
      `${g.troopCap} vs ${BATTLES_CONFIG.fobTroopCapByStage[g.fobStage]}`,
    );
    push(
      `grade ${g.grade} reads its kit ceiling from war-types.ts`,
      g.maxKitTier === BATTLES_CONFIG.fobMaxTierByStage[g.fobStage],
      `${g.maxKitTier} vs ${BATTLES_CONFIG.fobMaxTierByStage[g.fobStage]}`,
    );
    push(`grade ${g.grade} stays inside its stage's troop ceiling`, g.troops <= g.troopCap);
    push(
      `grade ${g.grade}'s artifact chance is the Forge's own table, by grade`,
      g.loot.artifactChance === forgeDropChance(g.grade - 1),
      `${g.loot.artifactChance} vs ${forgeDropChance(g.grade - 1)}`,
    );
  }
  push(
    "grade strengths are strictly increasing",
    grades.every((g, i) => i === 0 || g.strength > grades[i - 1].strength),
    grades.map((g) => g.strength).join(" · "),
  );
  push(
    "grade I pays ZERO artifacts",
    grades[0].loot.artifactChance === 0 && grades[0].loot.artifactQty * grades[0].loot.artifactChance === 0,
    `${grades[0].loot.artifactChance} × ${grades[0].loot.artifactQty}`,
  );
  {
    const i = ZONES.slice(0, 3).map((z) => z.id);
    const v = ZONES.filter((z) => z.radiationLevel >= FORGE_CONFIG.depth.deepest).map((z) => z.id);
    const forced = new Set([...i, ...v]);
    const rest = ZONES.filter((z) => !forced.has(z.id)).sort(
      (a, b) => b.radiationLevel - a.radiationLevel || rungOfZone(b.id) - rungOfZone(a.id),
    );
    const mid = rest.slice(0, 9);
    const rule = [
      ...i.map((zoneId) => ({ grade: 1, zoneId })),
      ...mid.slice(6, 9).map((z) => ({ grade: 2, zoneId: z.id })),
      ...mid.slice(3, 6).map((z) => ({ grade: 3, zoneId: z.id })),
      ...mid.slice(0, 3).map((z) => ({ grade: 4, zoneId: z.id })),
      ...v.map((zoneId) => ({ grade: 5, zoneId })),
    ]
      .map((r) => `${r.grade}:${r.zoneId}`)
      .sort();
    const table = sites.map((s) => `${s.grade}:${s.zoneId}`).sort();
    push(
      "the 15 rows are exactly the documented pin rule's output",
      JSON.stringify(rule) === JSON.stringify(table),
      `rule ${rule.join(" ")} vs table ${table.join(" ")}`,
    );
  }
  return out;
}

// 8a · the audit passes on the real tables — every named invariant, one check each
{
  const results = audit(CHORUS_GRADES, CHORUS_SITES);
  const bad = results.filter((r) => !r.ok);
  check(
    `the audit itself agrees with the real table on all ${results.length} invariants`,
    bad.length === 0,
    bad.map((b) => `${b.name} (${b.detail})`).join(" | "),
  );
}
/** Run the SAME audit on a planted table and require the NAMED invariant to fail. */
function control(label: string, grades: readonly ChorusGrade[], sites: readonly ChorusSite[], expectFailed: string) {
  const results = audit(grades, sites);
  const hit = results.find((r) => r.name === expectFailed);
  check(
    `CONTROL · ${label} → "${expectFailed}" must fail`,
    hit !== undefined && hit.ok === false,
    hit === undefined ? `invariant not found` : `invariant passed (${hit.detail})`,
  );
}
const cloneGrades = (): ChorusGrade[] => CHORUS_GRADES.map((g) => ({ ...g, loot: { ...g.loot } }));
const cloneSites = (): ChorusSite[] => CHORUS_SITES.map((s) => ({ ...s }));

control(
  "planted: grade I's artifact chance raised to 0.06",
  cloneGrades().map((g) => (g.grade === 1 ? { ...g, loot: { ...g.loot, artifactChance: 0.06 } } : g)),
  cloneSites(),
  "grade I pays ZERO artifacts",
);
control(
  "planted: grade V's strength dropped to grade IV's 345",
  cloneGrades().map((g) => (g.grade === 5 ? { ...g, strength: 345 } : g)),
  cloneSites(),
  "grade strengths are strictly increasing",
);
control(
  "planted: a site moved onto a zone id that does not exist",
  cloneGrades(),
  cloneSites().map((s) => (s.zoneId === "boneyard" ? { ...s, zoneId: "the-shattered-academies" } : s)),
  "every site's zone id exists in zones.ts",
);
control(
  "planted: grade I's troop cap re-typed as 99",
  cloneGrades().map((g) => (g.grade === 1 ? { ...g, troopCap: 99 } : g)),
  cloneSites(),
  "grade 1 reads its troop cap from war-types.ts",
);
control(
  "planted: a middle site swapped for a shallow zone (null-engine → cinder-farms)",
  cloneGrades(),
  cloneSites().map((s) => (s.zoneId === "null-engine" ? { ...s, zoneId: "cinder-farms" } : s)),
  "the 15 rows are exactly the documented pin rule's output",
);
control(
  "planted: a fourth site added to grade III",
  cloneGrades(),
  [...cloneSites(), { grade: 3 as const, zoneId: "glass-harbor" }],
  "grade 3 holds exactly 3 sites",
);
{
  // 8g · the engine check has teeth too: a garrison one step off its carried strength is refused
  const force = chorusGarrison("outer-ruins")!;
  const planted = { ...force, troops: force.troops + 5 };
  check(
    "CONTROL · a garrison 5 troops heavier than the carried strength is refused by computeForcePower",
    computeForcePower(planted) !== gradeOf(1).strength && computeForcePower(force) === gradeOf(1).strength,
    `${computeForcePower(planted)} vs ${gradeOf(1).strength}`,
  );
}
check(
  "CONTROL · the source scans can fail: a re-typed FOB array trips the no-literal check on planted code",
  /100\s*,\s*150\s*,\s*250\s*,\s*400\s*,\s*600/.test("fobTroopCapByStage: [100, 150, 250, 400, 600],") &&
    !/100\s*,\s*150\s*,\s*250\s*,\s*400\s*,\s*600/.test(MODULE_CODE),
);

console.log(`\nraid-tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
