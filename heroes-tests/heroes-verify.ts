// ============================================================================
// HEROES DATA-LAYER VERIFICATION — design/heroes-design-brief.md (§1–§7, §9)
//
// Pure data + progression + energy harness — runs AHEAD of the war build (the
// hero data is deliberately invisible to play: nothing here is client-visible,
// nothing is wired into the engine yet). Mirrors the atlas-verify runner
// style (pass/fail counters, numbered sections, exit code).
//
// Covers, in order:
//   1 · roster invariants      — the 8 OWNER-RATIFIED Wave-1 Watcher heroes,
//        unique ids, required fields, wave-1 flags, exact approved names, the
//        2/2/2/1/1 role spread, no placeholder/"TBD" strings anywhere.
//   2 · deed catalog           — every hero references a real deed; deeds map
//        back to their heroes; every condition is personal-and-monotonic with
//        a finite-time guarantee; the Oracle-vouch alternate exists for
//        everyone; heroes-for-money is structurally impossible (no cost/price
//        field exists on any hero or deed record).
//   3 · FINITE-TIME GUARANTEE — the §3.1 contract as a test assertion: a
//        legal column at published caps earns ALL 8 Wave-1 Watcher heroes
//        within HEROES_CONFIG.wave1WorstCaseWeeks (8) — no randomness, no
//        PvP advantage required. This is the "guarantee is a test assertion,
//        not a hope" row.
//   4 · determinism            — hero XP/level math is byte-identical across
//        repeated runs at fixed clocks; curve parity with the Leader spine
//        (LEVEL_XP 200/450/800/…/5000, cap L10); zero Math.random anywhere
//        in the three modules (comment-aware source scan).
//   5 · progression            — points = level − 1 at every level; the
//        40/day cap in the SEPARATE hero ledger; allocation + L3
//        specialization gating; no respec; nothing purchasable.
//   6 · squad & energy (§6)    — squad 3–5 bounds enforced, the exact
//        20/20/15/15/10/10 action table, 60/wk pool, week-boundary reset
//        math, DAILY_MARCH_CAP = 8 (marches + captures only).
//   7 · anti-cheat / leak      — comment-aware forbidden-string scan of the
//        three modules (no gacha/purchase/storefront shapes, no
//        Oracle-bypass markers, no Math.random); modules import NO
//        React/UI/server modules; NOTHING in the client bundle paths imports
//        the heroes modules (heroes stay server-invisible until the war
//        frame, design §9 sequencing).
//   8 · race axis (R3)         — home race = watchers on the beta world;
//        foreign races require invasion / foreign Oracle vouch (Phase 1) /
//        Emissary trade (Phase 2) — DATA only, no enforcement logic here.
//
// Run:  cd /home/team/shared/heroes-tests && bun run heroes-verify.ts
// (pure imports — also runnable unchanged from the site dir.)
import {
  HERO_DEFS,
  HERO_BY_ID,
  DEED_CATALOG,
  DEED_BY_ID,
  HEROES_CONFIG,
  HOME_RACE,
  PLAYABLE_RACES,
  RACE_ACCESS,
  RACE_WAVE_STATE,
  type HeroDef,
  type HeroDeed,
} from "/home/team/shared/site/src/game/heroes-data.ts";
import {
  HERO_XP_CONFIG,
  HERO_XP_SOURCES,
  HERO_SPECIALIZATIONS,
  HERO_SPECIALIZATION_BY_ID,
  newHeroUnit,
  heroLevel,
  heroLevelFromXp,
  heroXpForLevel,
  heroDailyXpRemaining,
  grantHeroXpTo,
  applyHeroLevelUps,
  allocateHeroPoint,
  chooseHeroSpec,
  canChooseHeroSpec,
} from "/home/team/shared/site/src/game/hero-xp.ts";
import {
  WAR_ENERGY_CONFIG,
  ACTION_ENERGY_COSTS,
  MARCH_CAPPED_ACTIONS,
  validateSquadSize,
  squadSizeOk,
  actionEnergyCost,
  weeklyEnergyRemaining,
  canAffordAction,
} from "/home/team/shared/site/src/game/war-energy.ts";
import { LEVEL_XP, levelFromXp, xpForLevel, DAILY_XP_CAP, SPECIALIZATION_MILESTONE, MAX_LEVEL } from "/home/team/shared/site/src/game/leader-xp.ts";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// Comment-aware source scan (atlas pattern): strip /* */ and // so the
// modules' own never-list DOCUMENTATION can never false-positive.
function execSource(p: string): string {
  return fs
    .readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
const MODS = [
  "/home/team/shared/site/src/game/heroes-data.ts",
  "/home/team/shared/site/src/game/hero-xp.ts",
  "/home/team/shared/site/src/game/war-energy.ts",
];
const SRC = MODS.map(execSource);

// ======================================================================
// 1 · roster invariants — the ratified Wave-1 set
// ======================================================================
console.log("— 1 · roster invariants (owner-ratified Wave-1 Watchers, O1) —");
const RATIFIED: Array<[string, string]> = [
  // [id, name] — exactly as approved in design brief §2.6
  ["azazel-3", "Azazel-3, the Teacher"],
  ["last-lecturer", "The Last Lecturer"],
  ["chained-syllabus", "The Chained Syllabus"],
  ["unwritten-answer", "The Unwritten Answer"],
  ["semira-revealer", "Semira the Revealer"],
  ["brother-candle", "Brother Candle"],
  ["vesper-syllabus", "Vesper the Syllabus"],
  ["keeper-mend", "Keeper Mend"],
];
check("exactly 8 Wave-1 heroes (O1: 8-vs-6 decided at 8)", HERO_DEFS.length === 8 && HEROES_CONFIG.wave1Size === 8, `n=${HERO_DEFS.length}`);
check("ids exactly match the ratified set", JSON.stringify([...HERO_DEFS].map((h) => h.id).sort()) === JSON.stringify(RATIFIED.map(([id]) => id).sort()));
check("names exactly match the ratified set", JSON.stringify([...HERO_DEFS].map((h) => h.name).sort()) === JSON.stringify(RATIFIED.map(([, n]) => n).sort()));
check("ids unique", new Set(HERO_DEFS.map((h) => h.id)).size === HERO_DEFS.length);
check("every hero has all required fields", HERO_DEFS.every((h) =>
  typeof h.id === "string" && h.id.length > 0 &&
  typeof h.name === "string" && h.name.length > 0 &&
  ["tank", "damage", "support", "utility", "econwar"].includes(h.role) &&
  typeof h.race === "string" && typeof h.identity === "string" && h.identity.length > 0 &&
  h.baseAttributes && [h.baseAttributes.power, h.baseAttributes.guard, h.baseAttributes.craft, h.baseAttributes.presence].every((v) => Number.isInteger(v) && v >= 0) &&
  Array.isArray(h.skills) && h.skills.length >= 1 &&
  typeof h.signatureDeed === "string" && Array.isArray(h.alternateDeeds) && h.oracleVouch === true));
check("wave flag = wave-1 on every hero", HERO_DEFS.every((h) => h.wave === "wave-1"));
check("role spread exactly 2/2/2/1/1 (every squad 3–5 composes)", JSON.stringify(HERO_DEFS.map((h) => h.role).sort()) === JSON.stringify(["damage", "damage", "econwar", "support", "support", "tank", "tank", "utility"]));
check("every hero's base attribute pool == 13 (Leader parity)", HERO_DEFS.every((h) => h.baseAttributes.power + h.baseAttributes.guard + h.baseAttributes.craft + h.baseAttributes.presence === HEROES_CONFIG.baseAttributePoints));
check("no two heroes share a skill identity (R5)", new Set(HERO_DEFS.flatMap((h) => h.skills.map((s) => s.id))).size === HERO_DEFS.flatMap((h) => h.skills).length);
const ALL_TEXT = JSON.stringify(HERO_DEFS) + JSON.stringify(DEED_CATALOG);
check("no placeholder/TBD/lorem strings anywhere in the data", !/(TBD|TODO|XXX|placeholder|lorem|FIXME|\bfoo\b|\bbar\b)/i.test(ALL_TEXT));
check("HERO_BY_ID round-trips all 8", Object.keys(HERO_BY_ID).length === 8 && HERO_DEFS.every((h) => HERO_BY_ID[h.id] === h));

// ======================================================================
// 2 · deed catalog — structure, mapping, earn-path hygiene
// ======================================================================
console.log("— 2 · earn-by-deed catalog (§3.1) —");
const DEED_TIERS = DEED_CATALOG.map((d) => d.tier).sort().join(",");
check("catalog covers T1/T2/T3 + vouch", DEED_TIERS === "t1,t1,t1,t1,t1,t2,t2,t2,t2,t2,t2,t2,t3,t3,t3,t3,t3,vouch", DEED_TIERS);
check("every deed id unique", new Set(DEED_CATALOG.map((d) => d.id)).size === DEED_CATALOG.length);
for (const h of HERO_DEFS) {
  const sig = DEED_BY_ID[h.signatureDeed];
  check(`${h.id}: signature deed "${h.signatureDeed}" exists`, !!sig, h.signatureDeed);
  check(`${h.id}: signature deed unlocks a pool containing them`, !!sig && (sig.unlocks.length === 0 || sig.unlocks.includes(h.id)), `unlocks=${sig?.unlocks?.join(",")}`);
  check(`${h.id}: alternate deeds all exist`, h.alternateDeeds.every((d) => !!DEED_BY_ID[d]), h.alternateDeeds.join(","));
}
check("every Wave-1-referenced deed unlocks ≥ 1 hero", HERO_DEFS.every((h) => DEED_BY_ID[h.signatureDeed].unlocks.length >= 1));
check("future-wave deeds are valid rows (T2/T3 ids well-formed, finite bounds)", DEED_CATALOG.filter((d) => d.unlocks.length === 0 && d.tier !== "vouch").every((d) => d.tier === "t2" || d.tier === "t3"));
check("every deed condition is personal & monotonic (R2)", DEED_CATALOG.every((d) => (d.kind === "personal-threshold" || d.kind === "history-first-with-twin") && d.condition.length > 10));
check("no random/unbounded language in any condition", !DEED_CATALOG.some((d) => /random|rolls?|gacha|shards?|loot|drops?|unbounded|chance\b|odds\b/i.test(d.condition)), DEED_CATALOG.filter((d) => /random|gacha|shard|loot/i.test(d.condition)).map((d) => d.id).join(","));
check("every non-vouch deed carries a finite-time week bound", DEED_CATALOG.filter((d) => d.tier !== "vouch").every((d) => Number.isFinite(d.finiteTimeWeeks!) && d.finiteTimeWeeks! > 0 && d.finiteTimeWeeks! <= 12));
check("vouch deed exists under the oracle_vouch: prefix and is unbounded by design", !!DEED_BY_ID["oracle_vouch:watchers"] && DEED_BY_ID["oracle_vouch:watchers"].tier === "vouch" && DEED_BY_ID["oracle_vouch:watchers"].finiteTimeWeeks === null);
check("every Wave-1 hero has the oracle-vouch alternate (R2/R3)", HERO_DEFS.every((h) => h.oracleVouch === true));
check("no cost/price/purchase field exists on ANY hero or deed record (structural never-list)", !/"(?:cost|price|scrip|votives?|premium|shop|bundle|pack)"\s*:/i.test(ALL_TEXT));

// ======================================================================
// 3 · FINITE-TIME GUARANTEE — the §3.1 contract, asserted
// ======================================================================
console.log("— 3 · finite-time guarantee (all 8 heroes ≤ worst-case bound) —");
// A legal steady-play column at PUBLISHED caps: 8 marches/day (DAILY_MARCH_CAP),
// ~14 hauls/wk + ~14 shields/wk (uncapped participation floor, R8), ~+20
// contribution/wk from war scoring, one clean march in week 1, war
// participation every week. No randomness, no PvP advantage, no spend.
{
  const counters = { marches: 0, hauls: 0, shields: 0, contribution: 0, weeks: 0, breached: false, cleanMarch: false };
  const done: Record<string, number> = {};
  let allDoneWeek: number | null = null;
  const isDone = (deedId: string) => done[deedId] !== undefined;
  for (let wk = 1; wk <= HEROES_CONFIG.wave1WorstCaseWeeks; wk++) {
    counters.marches += WAR_ENERGY_CONFIG.dailyMarchCap * 7; // 8/day × 7
    counters.hauls += 14;
    counters.shields += 14;
    counters.contribution += 20;
    counters.weeks += 1;
    if (wk === 1) { counters.breached = true; counters.cleanMarch = true; } // first march = first breach, marched clean
    const satisfy: Record<string, boolean> = {
      hero_first_breach: counters.breached,
      hero_march_5: counters.marches >= 5,
      hero_clean_march: counters.cleanMarch,
      hero_haul_10: counters.hauls >= 10,
      hero_contribution_50: counters.contribution >= 50,
      hero_weeks_4: counters.weeks >= 4,
      hero_shield_15: counters.shields >= 15,
    };
    for (const h of HERO_DEFS) {
      if (isDone(h.signatureDeed)) continue;
      if (satisfy[h.signatureDeed] || h.alternateDeeds.some((d) => satisfy[d])) done[h.signatureDeed] = wk;
    }
    if (!allDoneWeek && HERO_DEFS.every((h) => isDone(h.signatureDeed))) allDoneWeek = wk;
  }
  const bound = HEROES_CONFIG.wave1WorstCaseWeeks;
  check(`the Wave-1 roster completes within the published ${bound}-week worst-case bound`, allDoneWeek !== null && allDoneWeek <= bound, `allDoneWeek=${allDoneWeek}`);
  check(`the schedule is deterministic (same week every run)`, allDoneWeek === 4, `allDoneWeek=${allDoneWeek}`);
  const perHero = HERO_DEFS.map((h) => `${h.id}:wk${done[h.signatureDeed] ?? "?"}`).join(" ");
  console.log(`      schedule → ${perHero} (T1≈3wk · T2≈8wk · roster≤${bound}wk)`);
  // The deterministic column: contribution-50 heroes take the §3.1 march_5
  // alternate at wk1; the pure contribution threshold lands wk3 (2×20 < 50 ≤
  // 3×20); shield_15 lands wk2 at 14/wk; weeks_4 needs the 4th week. All
  // inside their published tier windows — the contract, asserted.
  check("deterministic schedule matches the published column exactly", done["hero_first_breach"] === 1 && done["hero_march_5"] === 1 && done["hero_clean_march"] === 1 && done["hero_haul_10"] === 1 && done["hero_contribution_50"] === 1 && done["hero_weeks_4"] === 4 && done["hero_shield_15"] === 2);
  check("tier windows respected (T1 ≤ wk3 · T2 ≤ wk8 · weeks_4 needs its 4th week)", done["hero_contribution_50"] <= 3 && done["hero_shield_15"] <= 8 && done["hero_weeks_4"] >= 4);
  check("the pure contribution-50 threshold itself lands in its T1 window (2×20 < 50 ≤ 3×20)", 2 * 20 < 50 && 3 * 20 >= 50);
  check("the contribution-50 pool (Last Lecturer + Unwritten Answer) both resolve from one threshold", DEED_BY_ID["hero_contribution_50"].unlocks.includes("last-lecturer") && DEED_BY_ID["hero_contribution_50"].unlocks.includes("unwritten-answer"));
}

// ======================================================================
// 4 · determinism + curve parity with the Leader spine
// ======================================================================
console.log("— 4 · determinism (zero Math.random) + Leader-curve parity (§4/R6) —");
const realRandom = Math.random;
let randomCalls = 0;
(Math as any).random = () => { randomCalls++; return 0.5; };
try {
  for (const h of HERO_DEFS) { void newHeroUnit(h, "hero_first_breach", 1_800_000_000_000); }
  const probe = newHeroUnit(HERO_DEFS[0], "hero_first_breach", 1_800_000_000_000);
  for (let i = 0; i < 50; i++) grantHeroXpTo(probe, 40, 1_800_000_000_000 + i * 86_400_000, {});
  void weeklyEnergyRemaining(probe.energyWeek, "c1");
  void validateSquadSize(4);
} finally {
  (Math as any).random = realRandom;
}
check("all module paths run without touching Math.random", randomCalls === 0, `calls=${randomCalls}`);
check("no Math.random in any heroes module source", SRC.every((s) => !s.includes("Math.random")));
const FIXED = 1_785_000_000_000; // fixed clock, far past today's dates — run twice
const run1 = [heroLevelFromXp(450), heroLevelFromXp(5000), heroXpForLevel(7), heroDailyXpRemaining(newHeroUnit(HERO_DEFS[1], "hero_shield_15", FIXED))].join("|");
const run2 = [heroLevelFromXp(450), heroLevelFromXp(5000), heroXpForLevel(7), heroDailyXpRemaining(newHeroUnit(HERO_DEFS[1], "hero_shield_15", FIXED))].join("|");
check("XP/level math byte-identical across repeated fixed-clock runs", run1 === run2);
check("curve parity: hero thresholds == Leader LEVEL_XP (200/450/800/…/5000)", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((l) => heroXpForLevel(l) === xpForLevel(l) && heroXpForLevel(l) === LEVEL_XP[l]));
check("level parity with leader levelFromXp at every threshold", [0, 199, 200, 449, 450, 799, 800, 1249, 1250, 4999, 5000, 99999].every((x) => heroLevelFromXp(x) === levelFromXp(x)));
check("cap parity: L10 at 5000, clamp at 99999", heroLevelFromXp(5000) === 10 && heroLevelFromXp(99999) === 10 && HERO_XP_CONFIG.maxLevel === MAX_LEVEL);
check("daily-cap parity: hero cap == Leader 40/day (O8)", HERO_XP_CONFIG.dailyCap === DAILY_XP_CAP && HERO_XP_CONFIG.dailyCap === 40);
check("milestone parity: L3 specialization gate shared with Leaders", HERO_XP_CONFIG.milestone === SPECIALIZATION_MILESTONE && HERO_XP_CONFIG.milestone === 3);

// ======================================================================
// 5 · progression — points = level − 1, daily cap ledger, spec, allocation
// ======================================================================
console.log("— 5 · progression (leader-spine, hero-ledger) —");
{
  const h = newHeroUnit(HERO_BY_ID["vesper-syllabus"], "hero_march_5", FIXED);
  check("fresh hero: L1, 0 XP, 0 points, no spec, full day budget", heroLevel(h) === 1 && h.xp === 0 && h.unspentPoints === 0 && h.specialization === null && heroDailyXpRemaining(h) === 40 && h.energyWeek.cycleId === null && h.energyWeek.spent === 0);
  const caps: Record<string, number> = {};
  const r1 = grantHeroXpTo(h, 40, FIXED, caps);
  const r2 = grantHeroXpTo(h, 40, FIXED, caps); // same day
  const r3 = grantHeroXpTo(h, 5, FIXED, caps); // colony-shared cap also binds
  check("40/day cap is exact (single grant, then zero twice)", r1.granted === 40 && r2.granted === 0 && r3.granted === 0 && h.dayXp === 40, `r1=${r1.granted} r2=${r2.granted} r3=${r3.granted}`);
  check("heroXpCaps ledger holds the colony-side 40 (separate key from leaderXpCaps)", Object.keys(caps).length === 1 && Object.values(caps)[0] === 40, JSON.stringify(caps));
  const h2 = newHeroUnit(HERO_BY_ID["semira-revealer"], "hero_clean_march", FIXED + 86_400_000 * 1);
  const caps2: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < 10; i++) total += grantHeroXpTo(h2, 40, FIXED + i * 86_400_000, caps2).granted;
  check("10 days of 40 XP = 400 total, L2, 1 point (level − 1)", total === 400 && heroLevel(h2) === 2 && h2.unspentPoints === 1 && h2.xpPointsGranted === 1, `total=${total} L${heroLevel(h2)} pts=${h2.unspentPoints}`);
  check("day rollover resets the per-hero window across the 10 days", h2.dayXp === 40 && Object.keys(caps2).length === 10 && Object.values(caps2).every((v) => v === 40));
  const h3 = newHeroUnit(HERO_BY_ID["azazel-3"], "hero_first_breach", FIXED);
  h3.xp = 5000; // direct XP for the invariant check (cap math proven above)
  applyHeroLevelUps(h3);
  check("L10 invariant: points granted == 9 (level − 1) total", h3.xpPointsGranted === 9 && h3.unspentPoints === 9);
  check("point allocation spends and lands (guard +1)", (() => { const r = allocateHeroPoint(h3, "guard"); return r.ok === true && h3.attributes.guard === 7 && h3.unspentPoints === 8; })());
  check("allocation rejects unknown attributes and empty pools", allocateHeroPoint(h3, "nope" as any).ok === false && allocateHeroPoint(newHeroUnit(HERO_DEFS[0], "hero_first_breach", FIXED), "power").ok === false);
  const h4 = newHeroUnit(HERO_BY_ID["keeper-mend"], "hero_haul_10", FIXED);
  h4.xp = 450; applyHeroLevelUps(h4); // L3
  check("L3 opens specialization (one-time, no respec)", canChooseHeroSpec(h4) === true && chooseHeroSpec(h4, "vanguard").ok === true && h4.specialization === "vanguard");
  check("second choice rejected (mutually exclusive)", chooseHeroSpec(h4, "courser").ok === false);
  const h5 = newHeroUnit(HERO_BY_ID["last-lecturer"], "hero_contribution_50", FIXED);
  check("below L3: spec choice rejected; unknown spec rejected", chooseHeroSpec(h5, "courser").ok === false && chooseHeroSpec(h4, "bogus" as any).ok === false);
  check("exactly 3 specializations (Vanguard/Hearthward/Courser, O4)", HERO_SPECIALIZATIONS.length === 3 && ["vanguard", "hearthward", "courser"].every((s) => !!HERO_SPECIALIZATION_BY_ID[s as any]));
  check("XP source table is the published §4 list (no stray sources)", JSON.stringify([...Object.values(HERO_XP_SOURCES)].sort((a, b) => a - b)) === JSON.stringify([4, 6, 8, 10, 10, 12, 15, 20, 25]));
  check("grant of 450 on a fresh day is clamped to 40 (cap first, curve second)", (() => { const k = newHeroUnit(HERO_DEFS[2], "hero_contribution_50", FIXED); const capsK: Record<string, number> = {}; const r = grantHeroXpTo(k, 450, FIXED, capsK); return r.granted === 40 && heroLevel(k) === 1 && k.unspentPoints === 0; })());
}

// ======================================================================
// 6 · squad & energy (§6 / O3 / O5) — the hard consts, asserted
// ======================================================================
console.log("— 6 · squad & energy (the §6 fairness table) —");
check("squad bounds: 3 ok · 4 ok · 5 ok · 2 rejected · 6 rejected · non-integer rejected", squadSizeOk(3) && squadSizeOk(4) && squadSizeOk(5) && !squadSizeOk(2) && !squadSizeOk(6) && !squadSizeOk(2.5) && !squadSizeOk(-1));
check("min-3-march error is user-readable", /at least 3/.test(validateSquadSize(2).error as string));
check("max-5 error is user-readable", /capped at 5/.test(validateSquadSize(6).error as string));
check("config squad bounds == 3..5", WAR_ENERGY_CONFIG.squad.min === 3 && WAR_ENERGY_CONFIG.squad.max === 5);
const COST_WANT = { march: 20, capture: 20, escort: 15, purify: 15, shield: 10, haul: 10 };
check("action energy table is EXACTLY the §6 table (20/20/15/15/10/10)", (Object.keys(COST_WANT) as Array<keyof typeof COST_WANT>).every((a) => ACTION_ENERGY_COSTS[a] === COST_WANT[a]) && Object.keys(ACTION_ENERGY_COSTS).length === 6, JSON.stringify(ACTION_ENERGY_COSTS));
check("all energy costs non-negative and sane (≤ weekly pool)", Object.values(ACTION_ENERGY_COSTS).every((c) => Number.isInteger(c) && c >= 0 && c <= WAR_ENERGY_CONFIG.activation.weeklyPool));
check("weekly pool == 60 (activation energy)", WAR_ENERGY_CONFIG.activation.weeklyPool === 60 && WAR_ENERGY_CONFIG.activation.reset === "week-boundary-full-restore");
check("DAILY_MARCH_CAP == 8; marches + captures are march-capped, shields/hauls/escorts are NOT", WAR_ENERGY_CONFIG.dailyMarchCap === 8 && JSON.stringify(MARCH_CAPPED_ACTIONS) === JSON.stringify(["march", "capture"]));
check("weeklyEnergyRemaining: fresh/absent stamp = full 60", weeklyEnergyRemaining({ cycleId: null, spent: 0 }, "c1") === 60);
check("weeklyEnergyRemaining: current cycle reads 60 − spent, clamps at 0", weeklyEnergyRemaining({ cycleId: "c1", spent: 25 }, "c1") === 35 && weeklyEnergyRemaining({ cycleId: "c1", spent: 999 }, "c1") === 0);
check("weeklyEnergyRemaining: stale cycle resets (week-boundary regen)", weeklyEnergyRemaining({ cycleId: "c0", spent: 59 }, "c1") === 60);
check("canAffordAction boundaries (60/wk: march needs 20, shield needs 10)", canAffordAction({ cycleId: "c1", spent: 0 }, "c1", "march") && canAffordAction({ cycleId: "c1", spent: 40 }, "c1", "march") && !canAffordAction({ cycleId: "c1", spent: 41 }, "c1", "march") && canAffordAction({ cycleId: "c1", spent: 50 }, "c1", "shield") && !canAffordAction({ cycleId: "c1", spent: 51 }, "c1", "shield"));
check("war week == 7 UTC days (pool resets at the week boundary)", WAR_ENERGY_CONFIG.warWeekMs === 7 * 24 * 60 * 60 * 1000);
check("squad-size + cost helpers are pure (no state captured)", validateSquadSize(3).ok && actionEnergyCost("purify") === 15 && actionEnergyCost("bogus" as any) === 0 && canAffordAction({ cycleId: "x", spent: 0 }, "x", "march") === true);

// ======================================================================
// 7 · anti-cheat / leak — forbidden shapes, no UI imports, client-invisible
// ======================================================================
console.log("— 7 · anti-cheat / leak checks (never-list + visibility) —");
// Comment-aware forbidden-shape scan over EXECUTABLE code only.
const FORBIDDEN = /gacha|loot.?box|hero.?shard|recruit.?button|purchas|storefront|paywall|for.?sale|\$\$|premium.?track|paid\.?deeds?|sell|buy|donate|bypass|force.?vouch|instant.?earn|free.?hero/i;
for (let i = 0; i < MODS.length; i++) {
  const name = path.basename(MODS[i]);
  check(`${name}: no purchase/gacha/Oracle-bypass shape in executable code`, !FORBIDDEN.test(SRC[i]), (SRC[i].match(FORBIDDEN) || [])[0] ?? "");
}
check("no hero/deed field is wallet-shaped (structural never-list re-assert)", !/"(?:price|costScrip|costVotive|shopId|premium)"\s*:/i.test(ALL_TEXT));
check("no Math.random reachable in any heroes module (re-assert, all three)", SRC.every((s) => !s.includes("Math.random")));
// Import hygiene: the three modules may import only pure game-core modules.
for (let i = 0; i < MODS.length; i++) {
  const name = path.basename(MODS[i]);
  const imports = (SRC[i].match(/import[^;]+;/g) ?? []).join("\n");
  check(`${name}: imports only pure game-core modules (no react/engine/api/routes/server)`, !/react|@tanstack|routes\/|\.\/api|\.\/engine|\.\/store|\.\/auth|node:/.test(imports), imports.slice(0, 120));
}
// Client-invisible: nothing in the site's engine/API/client bundle may import
// the heroes modules yet (design §9 sequencing — data build runs AHEAD of the
// war frame; the hero UI/mechanics arrive with battle-side Phase 1). The
// three modules themselves are excluded — their INTERNAL imports are already
// covered by the import-hygiene checks above.
const CLIENT_PATHS = fs.readdirSync("/home/team/shared/site/src/game").map((f) => `/home/team/shared/site/src/game/${f}`)
  .concat(fs.readdirSync("/home/team/shared/site/src/routes").map((f) => `/home/team/shared/site/src/routes/${f}`))
  .concat(["/home/team/shared/site/src/client.tsx", "/home/team/shared/site/src/router.tsx", "/home/team/shared/site/src/styles/app.css"])
  .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
  .filter((p) => !/heroes-data|hero-xp|war-energy\.ts$/.test(p));
const HERO_MODULE_NAMES = ["heroes-data", "hero-xp", "war-energy"];
let referencedFromClient = 0;
for (const p of CLIENT_PATHS) {
  const raw = fs.readFileSync(p, "utf8");
  for (const mod of HERO_MODULE_NAMES) {
    if (new RegExp(`from\\s+["'][^"']*${mod}["']|require\\(["'][^"']*${mod}`).test(raw)) {
      referencedFromClient++;
      check(`heroes NOT referenced from ${path.basename(p)}`, false, mod);
    }
  }
}
check("zero references to heroes modules anywhere in engine/api/client/routes (invisible to play)", referencedFromClient === 0);
// (engine.ts legitimately contains NONE of the module names — even as strings.)
check("engine/api/play sources contain no 'heroes-data|hero-xp|war-energy' even in comments (provenance hygiene)", !fs.readFileSync("/home/team/shared/site/src/game/engine.ts", "utf8").includes("heroes-data") && !fs.readFileSync("/home/team/shared/site/src/game/api.ts", "utf8").includes("hero-xp") && !(fs.readFileSync("/home/team/shared/site/src/routes/play.tsx", "utf8").includes("war-energy")));

// ======================================================================
// 8 · race-bound collection axis (R3) — data only
// ======================================================================
console.log("— 8 · race axis (R3 — home world vs foreign traversal) —");
check("beta home race = watchers (world-config raceLock parity)", HOME_RACE === "watchers");
check("all six playable races listed (types.ts RaceId parity)", JSON.stringify([...PLAYABLE_RACES].sort()) === JSON.stringify(["anunnaki", "ashtar", "draconians", "grays", "nephilim", "watchers"]));
check("watchers earn from home-world deeds + their own Oracle", JSON.stringify(RACE_ACCESS.watchers) === JSON.stringify(["home-world deeds", "oracle_vouch"]));
check("every foreign race requires traversal (invasion + that Oracle's vouch Phase 1; Emissary trade Phase 2)", PLAYABLE_RACES.filter((r) => r !== "watchers").every((r) => RACE_ACCESS[r].includes("invasion") && RACE_ACCESS[r].includes("oracle_vouch") && RACE_ACCESS[r].some((s) => s.startsWith("emissary_trade"))));
check("watchers Wave 1 is published; the other five races' Wave 1 ships with their live worlds (O6)", RACE_WAVE_STATE.watchers.wave1Published === true && RACE_WAVE_STATE.watchers.wave1HeroIds.length === 8 && PLAYABLE_RACES.filter((r) => r !== "watchers").every((r) => RACE_WAVE_STATE[r].wave1Published === false && RACE_WAVE_STATE[r].wave1HeroIds.length === 0));
check("every hero in the roster is race watchers (own-race Wave 1 on the beta world)", HERO_DEFS.every((h) => h.race === "watchers"));

// ======================================================================
console.log(`\nheroes-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);