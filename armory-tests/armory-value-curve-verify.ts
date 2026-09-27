// armory-tests/armory-value-curve-verify.ts — THE ARMORY TIERS (owner-ratified
// 2026-09-27), measured against the economy the re-time just shipped.
//
// WHAT THIS SUITE IS FOR. The armory's tier ladder is a PACING object: four
// build times, a stat multiplier per tier, and a bounded build concurrency. It
// had silently carried a defect the owner could see by playing — the deepest,
// most expensive tier (T4) was the WORST return per day of build in the whole
// ladder, because it was only 1.45× the tier below it. The owner's ruling:
// "I would go five times stronger I would make that thing a brute."
//
// Coverage, in order:
//   1. THE LADDER — tierMult is exactly [1, 1.8, 3.2, 16] and T4 === 5 × T3;
//      every family's stats at every tier are the base × the multiplier, on all
//      four axes (a hand-edited stat table cannot pass).
//   2. THE TIMES + THE SLOTS — 12h / 3d / 12d / 45d, exactly; 2 build slots;
//      one family 60.5 d, five families 302.5 d serial / 151.25 d at two slots
//      (the numbers the pacing brief priced). Every timer's floor is
//      MIN_TIMER_FRACTION of its own base, and a MAXIMUM legal 3.5× compression
//      (the monetization ceiling) is asserted to land at the floor, not through
//      it — this is the speed-up tripwire path, asserted before anything is sold.
//   3. ONE FORMATTER — 12d and 45d render through `fmtDuration` (day-scale, all
//      five languages), never as minutes; exactly one duration formatter is
//      defined in src/; no player-facing file carries a hand-written tier-time
//      table (the check has a negative control: it is asserted to CATCH the
//      `weaponTimeFor()` copy that was deleted in this slice).
//   4. THE VALUE CURVE — power per day of build, per tier, printed as numbers
//      and pinned. T4 must not be the worst return (it was); the counterfactual
//      ladder this replaced is asserted to FAIL the same test, so the check has
//      teeth rather than passing by construction.
//   5. THE FORGE BAND — pinned, because `forgeCeilingPower()` derives from
//      `kitPower(f, 4)`: lifting T4 to 16× lifts every forge grade. The worst
//      grade (Makeshift) now lands far above a T3. Nothing about forge BEHAVIOUR
//      changed in this slice; this section only records and guards the number,
//      because the owner has an open decision in front of him.
//   6. THE GUARDRAILS — earn-only tripwire, the season standing rule, the costs
//      and the research gates all unchanged.
//   7. THE ENGINE RUNS IT — the slot cap enforced in play, two families in
//      parallel, a third refused, and the T4 commitment lasting exactly 45 days.
//
// Run: cd /home/team/shared/armory-tests && env -u DATABASE_URL bun run armory-value-curve-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import * as weapons from "/home/team/shared/site/src/game/armory.ts";
import { kitPower } from "/home/team/shared/site/src/game/war/battle-engine.ts";
import { FORGE_GRADES, forgeBand, forgeCeilingPower, forgeFamilyFloor, FORGE_RECIPES, gradeForPower } from "/home/team/shared/site/src/game/forge.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import { assertCatalogFair, MONETIZATION_CONFIG } from "/home/team/shared/site/src/game/monetization.ts";
import { timedBuildObjectiveViolations, timedBuildObjectiveViolationsIn, TIMED_BUILD_OBJECTIVE_IDS } from "/home/team/shared/site/src/game/season-guard.ts";
import { ARMORY_TREE } from "/home/team/shared/site/src/game/research.ts";
import { fmtDuration } from "/home/team/shared/site/src/game/i18n/format.ts";
import { makeT } from "/home/team/shared/site/src/game/i18n/index.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
import type { WeaponTier, WeaponType } from "/home/team/shared/site/src/game/armory.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } }
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000, HOUR = 3_600_000;
const TIERS = [1, 2, 3, 4] as const;
const now = Date.now();
const FAMILIES = Object.keys(weapons.WEAPON_BASE_STATS) as WeaponType[];
/** The strongest family at a tier — the ceiling the ladder is measured against
 *  (KitPower is the battle system's own stat weighting, not a new formula). */
const bestKit = (tier: number) => Math.max(...FAMILIES.map((f) => kitPower(f, tier)));

console.log("— 1 · THE LADDER: [1, 1.8, 3.2, 16], T4 = 5 × T3 —");
{
  const mult = weapons.ARMORY_CONFIG.tierMult;
  check("tierMult is exactly [1, 1.8, 3.2, 16]", JSON.stringify(mult) === JSON.stringify([1, 1.8, 3.2, 16]), JSON.stringify(mult));
  check("T4 === 5 × T3 exactly (the owner's brute step)", mult[3] === 5 * mult[2], `${mult[3]} vs ${5 * mult[2]}`);
  check("T3 > T2 > T1 (no flat or inverted step)", mult[0] < mult[1] && mult[1] < mult[2] && mult[2] < mult[3], mult.join("<"));
  check("the first step is still ~1.8× (the mid-ladder reads as progress)", near(mult[1], 1.8) && mult[1] >= 1.5, `${mult[1]}`);
  check("T4 is not merely T3's equal: 16 / 3.2 = 5", near(mult[3] / mult[2], 5), `${mult[3] / mult[2]}`);
  check("T1 is the base (multiplier 1, no silent re-basing)", mult[0] === 1);
  for (const f of FAMILIES) {
    for (const t of TIERS) {
      const base = weapons.WEAPON_BASE_STATS[f];
      const got = weapons.weaponStats(f, t);
      const want = { power: Math.round(base.power * mult[t - 1]), precision: Math.round(base.precision * mult[t - 1]), guard: Math.round(base.guard * mult[t - 1]), logistics: Math.round(base.logistics * mult[t - 1]) };
      check(`${f} T${t} = base × ${mult[t - 1]} on all four axes`, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
    }
    const s = TIERS.map((t) => weapons.weaponStats(f, t));
    check(`${f} stats strictly increase T1→T4 on every axis`, s.every((v, i) => i === 0 || (v.power > s[i - 1].power && v.precision > s[i - 1].precision && v.guard > s[i - 1].guard && v.logistics > s[i - 1].logistics)));
  }
}

console.log("— 2 · THE TIMES: 12h · 3d · 12d · 45d, and 2 build slots —");
{
  const WANT = [12 * HOUR, 3 * DAY, 12 * DAY, 45 * DAY];
  const got = TIERS.map((t) => weapons.weaponTimeMs(t));
  check("T1 build = 12h (43,200,000 ms)", got[0] === 12 * HOUR, `${got[0]}`);
  check("T2 upgrade = 3d (259,200,000 ms)", got[1] === 3 * DAY, `${got[1]}`);
  check("T3 upgrade = 12d (1,036,800,000 ms)", got[2] === 12 * DAY, `${got[2]}`);
  check("T4 upgrade = 45d (3,888,000,000 ms)", got[3] === 45 * DAY, `${got[3]}`);
  check("the four times are exactly the ratified table", JSON.stringify(got) === JSON.stringify(WANT), JSON.stringify(got));
  check("times strictly increase (no cheap shortcut to T4)", got.every((v, i) => i === 0 || v > got[i - 1]));
  check("each tier's time IS its table entry (no modifier stack touches an armory build today)", TIERS.every((t) => weapons.weaponTimeMs(t) === weapons.ARMORY_TIER_COSTS[t].timeMs));

  const familyDays = got.reduce((n, ms) => n + ms, 0) / DAY;
  check("one family T1→T4 = 60.5 days of build", familyDays === 60.5, `${familyDays}`);
  check("ARMORY_BUILD_SLOTS === 2", weapons.ARMORY_BUILD_SLOTS === 2, `${weapons.ARMORY_BUILD_SLOTS}`);
  check("…and it is the ONE number (ARMORY_CONFIG.buildSlots)", weapons.ARMORY_CONFIG.buildSlots === weapons.ARMORY_BUILD_SLOTS);
  const serial = 5 * familyDays;
  check("five families serialise to 302.5 days", serial === 302.5, `${serial}`);
  check("…and ~151.25 days at two slots (the brief's ~151)", serial / weapons.ARMORY_BUILD_SLOTS === 151.25, `${serial / weapons.ARMORY_BUILD_SLOTS}`);

  // THE FLOOR — the speed-up tripwire path. MIN_TIMER_FRACTION is the same
  // constant as the 3.5× monetization ceiling; nothing purchasable touches time
  // yet, so this pins the floor BEFORE a time grant exists to break it.
  const floor = engine.MIN_TIMER_FRACTION;
  check("MIN_TIMER_FRACTION is exported and is 0.286", Math.abs(floor - 0.286) < 1e-9, `${floor}`);
  check("…which is 1 / 3.5 — the same constant as the monetization ceiling", near(floor, 1 / 3.5, 0.001), `${1 / 3.5} vs ${floor}`);
  for (const t of TIERS) {
    const base = weapons.weaponTimeMs(t);
    const fl = engine.timerFloor(base, 0);
    check(`T${t}: even a modifier stack collapsed to zero leaves ${(floor * 100).toFixed(1)}% of its own timer`, fl === Math.round(base * floor) && fl > 0, `${fl} vs ${Math.round(base * floor)}`);
  }
  for (const t of TIERS) {
    const base = weapons.weaponTimeMs(t);
    const maximallyCompressed = engine.timerFloor(base, base / 3.5);
    check(`T${t}: a MAXIMUM legal 3.5× grant lands at the floor, not through it`, maximallyCompressed === Math.round(base * floor) && base / 3.5 <= maximallyCompressed, `${maximallyCompressed} vs ${Math.round(base * floor)}`);
  }
  check("the floor passes an unmodified timer through untouched", engine.timerFloor(12 * HOUR, 12 * HOUR) === 12 * HOUR);
  check("…and clamps a timer that a modifier genuinely collapsed", engine.timerFloor(45 * DAY, 1000) === Math.round(45 * DAY * floor), `${engine.timerFloor(45 * DAY, 1000)}`);
}

console.log("— 3 · ONE FORMATTER: 12d and 45d read as days in all five languages —");
{
  const en = makeT("en");
  const t1 = fmtDuration(en, weapons.weaponTimeMs(1));
  const t3 = fmtDuration(en, weapons.weaponTimeMs(3));
  const t4 = fmtDuration(en, weapons.weaponTimeMs(4));
  check("T1 (12h) still reads hours-and-minutes", t1 === "12h 0m", t1);
  check("T3 (12d) reads DAYS, never `17280m`", t3 === "12d 0h", t3);
  check("T4 (45d) reads DAYS, never `64800m`", t4 === "45d 0h", t4);
  check("neither day-scale timer renders as a bare minute count", !/^\d+m/.test(t3) && !/^\d+m/.test(t4), `${t3} | ${t4}`);
  const langs = ["en", "es", "pt-BR", "ru", "fa"];
  const rendered = langs.map((l) => fmtDuration(makeT(l), weapons.weaponTimeMs(4)));
  check("all five languages render the 45-day build, none falls back to a raw key", rendered.every((r) => r.length > 2 && !r.includes("{d}") && r.includes("45")), rendered.join(" | "));
  check("…and Persian says it in Persian", (rendered[4] ?? "").includes("روز"), rendered[4]);
  const rendered3 = langs.map((l) => fmtDuration(makeT(l), weapons.weaponTimeMs(3)));
  check("all five languages render the 12-day build with the day unit", rendered3.every((r) => r.includes("12") && (r.includes("d") || r.includes("روز") || r.includes("dia") || r.includes("д") || r.includes("дней"))), rendered3.join(" | "));

  const fs = await import("node:fs");
  const { readdirSync, readFileSync, statSync } = fs;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.tsx?$/.test(p)) files.push(p);
    }
  };
  walk("/home/team/shared/site/src");
  const defs = files.filter((f) => /function fmtDur(ation)?\s*\(/.test(readFileSync(f, "utf-8")));
  check("exactly ONE duration formatter is defined anywhere in src/", defs.length === 1 && defs[0].endsWith("game/i18n/format.ts"), defs.join(","));

  // A hand-written tier-time table is the defect this slice removed. The net
  // below is asserted against a PLANTED copy of the code it replaced, so it is
  // proven to catch the bad input rather than merely finding nothing today.
  const HARDCODED_TIER_TIME = /tier\s*===\s*\d\s*\?\s*["'`]\d+(?:m|h|d)["'`]|["'`]\d+(?:m|h|d)["'`]\s*:\s*["'`]\d+(?:m|h|d)["'`]/;
  const offenders = files.filter((f) => HARDCODED_TIER_TIME.test(readFileSync(f, "utf-8")));
  check("no file in src/ hand-codes a tier-time table beside the ladder", offenders.length === 0, offenders.join(","));
  const plantedOld = 'function weaponTimeFor(tier: 1 | 2 | 3 | 4): string {\n  return tier === 1 ? "45m" : tier === 2 ? "3h" : tier === 3 ? "12h" : "2d";\n}';
  check("NEGATIVE CONTROL: the net CATCHES the deleted `weaponTimeFor()` copy", HARDCODED_TIER_TIME.test(plantedOld));
  const plantedNew = 'const times = tier === 4 ? "45d" : "12h";';
  check("NEGATIVE CONTROL: it also catches a NEW hand-written table with the ratified times", HARDCODED_TIER_TIME.test(plantedNew));
  check("…and it does not fire on the module's own ladder (weaponTimeMs reads the table)", !HARDCODED_TIER_TIME.test(readFileSync("/home/team/shared/site/src/game/armory.ts", "utf-8")));
}

console.log("— 4 · THE VALUE CURVE: power per day of build (T4 must not be the worst) —");
{
  const power = TIERS.map((t) => bestKit(t));
  const days = TIERS.map((t) => weapons.weaponTimeMs(t) / DAY);
  const perDay = power.map((p, i) => p / days[i]);
  const marginal = power.map((p, i) => (i === 0 ? p / days[0] : (p - power[i - 1]) / (days[i] - days[i - 1])));
  console.log("     tier | power | build  | value/day | marginal/day");
  for (let i = 0; i < 4; i++) console.log(`       T${TIERS[i]}  | ${String(power[i]).padStart(5)} | ${String(days[i]).padStart(4)}d | ${perDay[i].toFixed(2).padStart(9)} | ${marginal[i].toFixed(2).padStart(8)}`);

  check("strongest family T1 kit = 81 (the ladder's reference point)", power[0] === 81, `${power[0]}`);
  check("…T2 = 146", power[1] === 146, `${power[1]}`);
  check("…T3 = 259", power[2] === 259, `${power[2]}`);
  check("…T4 = 1296", power[3] === 1296, `${power[3]}`);
  check("T4 power is at least 5× T3 power (the brute)", power[3] >= 5 * power[2], `${power[3]} vs ${power[2]}`);
  check("value/day falls first, then RISES at T4 (the curve bends back up)", perDay[0] > perDay[1] && perDay[1] > perDay[2] && perDay[3] > perDay[2], perDay.map((v) => r2(v)).join(" → "));
  check("T4 is NOT the worst return in the ladder (this was the defect)", perDay[3] > Math.min(...perDay), perDay.map((v) => r2(v)).join(" / "));
  check("the worst return is T3 (21.58/day), not T4", Math.min(...perDay) === perDay[2] && near(perDay[2], 21.58, 0.01), `${r2(perDay[2])}`);
  check("T4's marginal step (31.42/day) beats T3's (12.56/day)", marginal[3] > marginal[2] && near(marginal[3], 31.42, 0.01) && near(marginal[2], 12.56, 0.01), `${r2(marginal[3])} vs ${r2(marginal[2])}`);
  check("T4's marginal step also beats T2's (26.00/day)", marginal[3] > marginal[1], `${r2(marginal[3])} vs ${r2(marginal[1])}`);
  check("T4's marginal step is not the worst step in the ladder", marginal[3] > Math.min(...marginal.slice(1)), marginal.map((v) => r2(v)).join(" / "));
  check("the pinned value/day row is 162.00 / 48.67 / 21.58 / 28.80", perDay.every((v, i) => near(v, [162, 48.67, 21.58, 28.8][i], 0.01)), perDay.map((v) => r2(v)).join(" / "));

  // NEGATIVE CONTROL — the ladder this slice replaced is run through the SAME
  // test and must FAIL it. Without this, the checks above could be passing by
  // construction rather than because the new ladder is better.
  const OLD_MULT = [1, 1.5, 2.2, 3.2];
  const OLD_DAYS = [45 / 1440, 3 / 24, 12 / 24, 2];
  const oldPower = TIERS.map((t) => Math.round(power[0] * OLD_MULT[t - 1]));
  const oldPerDay = oldPower.map((p, i) => p / OLD_DAYS[i]);
  const oldMarginal = oldPower.map((p, i) => (i === 0 ? p / OLD_DAYS[0] : (p - oldPower[i - 1]) / (OLD_DAYS[i] - OLD_DAYS[i - 1])));
  console.log(`     (replaced ladder: ${oldPerDay.map((v) => r2(v)).join(" / ")} power per day)`);
  check("NEGATIVE CONTROL: under the replaced 3.2× ladder T4 WAS the worst return", Math.min(...oldPerDay) === oldPerDay[3], `${r2(oldPerDay[3])} vs min ${r2(Math.min(...oldPerDay))}`);
  check("NEGATIVE CONTROL: …and its marginal step was the worst too (54.00/day)", Math.min(...oldMarginal.slice(1)) === oldMarginal[3] && near(oldMarginal[3], 54, 0.01), oldMarginal.map((v) => r2(v)).join(" / "));

  check("cost rises into T4 on every resource (the brute is paid for)", (["supplies", "embers", "fuel", "plasma"] as const).every((k) => weapons.ARMORY_TIER_COSTS[4][k] > weapons.ARMORY_TIER_COSTS[3][k]));
  check("the four tier costs are UNCHANGED by this slice", JSON.stringify(TIERS.map((t) => weapons.weaponCost(t))) === JSON.stringify([
    { supplies: 40, embers: 20, fuel: 6, plasma: 0 },
    { supplies: 120, embers: 60, fuel: 18, plasma: 3 },
    { supplies: 320, embers: 160, fuel: 45, plasma: 12 },
    { supplies: 900, embers: 420, fuel: 120, plasma: 30 },
  ]));
}

console.log("— 5 · THE FORGE BAND (pinned consequence — NOT a behaviour change) —");
{
  // `forgeCeilingPower()` = the strongest earnable T4 kit, so the ceiling MOVED
  // with the ladder. Every grade band is a fraction of it, so every roll moved.
  const ceiling = forgeCeilingPower();
  check("the forge ceiling is the strongest T4 kit (1296, not hardcoded)", ceiling === kitPower("precision", 4) && ceiling === 1296, `${ceiling}`);
  check("the top of the ladder is still the best EARNED kit — a roll never exceeds it", forgeBand("prewar").high === ceiling, `${forgeBand("prewar").high} vs ${ceiling}`);
  check("the grade fractions are untouched by this slice (only the ceiling moved)", JSON.stringify(FORGE_GRADES.map((g) => [g.id, g.low, g.high])) === JSON.stringify([
    ["makeshift", 0.45, 0.58], ["patterned", 0.58, 0.72], ["tempered", 0.72, 0.85], ["masterworked", 0.85, 0.96], ["prewar", 0.96, 1.0],
  ]));
  check("makeshift band is 584–751", JSON.stringify(forgeBand("makeshift")) === JSON.stringify({ low: 584, high: 751 }), JSON.stringify(forgeBand("makeshift")));
  check("patterned band is 752–933", JSON.stringify(forgeBand("patterned")) === JSON.stringify({ low: 752, high: 933 }), JSON.stringify(forgeBand("patterned")));
  check("tempered band is 934–1101", JSON.stringify(forgeBand("tempered")) === JSON.stringify({ low: 934, high: 1101 }), JSON.stringify(forgeBand("tempered")));
  check("masterworked band is 1102–1244", JSON.stringify(forgeBand("masterworked")) === JSON.stringify({ low: 1102, high: 1244 }), JSON.stringify(forgeBand("masterworked")));
  check("prewar band is 1245–1296", JSON.stringify(forgeBand("prewar")) === JSON.stringify({ low: 1245, high: 1296 }), JSON.stringify(forgeBand("prewar")));
  const bands = FORGE_GRADES.map((g) => forgeBand(g.id));
  check("the five bands are ordered and contiguous", bands.every((b, i) => i === 0 || b.low === bands[i - 1].high + 1) && bands.every((b) => b.low <= b.high));

  // THE CONSEQUENCE, per family: the WORST grade now beats that family's T3.
  let worstRatio = Infinity, bestRatio = 0;
  for (const f of FAMILIES) {
    const t3 = kitPower(f, 3);
    const ok = forgeBand("makeshift").low > t3;
    worstRatio = Math.min(worstRatio, forgeBand("makeshift").low / t3);
    bestRatio = Math.max(bestRatio, forgeBand("makeshift").low / t3);
    check(`${f}: Makeshift's floor (584) beats its own T3 kit (${t3})`, ok, `584 vs ${t3}`);
  }
  check("…by 2.25× at the narrowest (584 / 259) and 2.77× at the widest (584 / 211)", near(worstRatio, 2.25, 0.01) && near(bestRatio, 2.77, 0.01), `${r2(worstRatio)} – ${r2(bestRatio)}`);
  check("against the ladder's own reference kit (81): Makeshift = 7.21× to 9.27×", near(forgeBand("makeshift").low / 81, 7.21, 0.01) && near(forgeBand("makeshift").high / 81, 9.27, 0.01), `${r2(forgeBand("makeshift").low / 81)} – ${r2(forgeBand("makeshift").high / 81)}`);
  check("a Makeshift is now ~a Pre-War's 0.45 of T4 (it is 45–58% of the ceiling)", near(forgeBand("makeshift").high / ceiling, 0.58, 0.01));
  // The recipes' GUARANTEED floors are what make the leapfrog certain rather than
  // lucky: `assault` can never roll below makeshift, `defence` never below
  // patterned. Pinned because the owner's pending Forge decision is exactly
  // about these two floors.
  const FLOORS: Record<string, string> = { assault: "makeshift", defence: "patterned" };
  for (const r of FORGE_RECIPES) {
    const floorKit = forgeFamilyFloor(r.family);
    check(`recipe "${r.id}" guarantees at least ${FLOORS[r.id]}`, r.minGrade === FLOORS[r.id], r.minGrade);
    check(`recipe "${r.id}": the worst possible roll is ≥ 8× its own family's entry craft (${floorKit})`, forgeBand(r.minGrade).low >= 8 * floorKit, `${forgeBand(r.minGrade).low} vs ${8 * floorKit}`);
    check(`recipe "${r.id}": …and it beats that family's T3 kit outright (${kitPower(r.family, 3)})`, forgeBand(r.minGrade).low > kitPower(r.family, 3), `${forgeBand(r.minGrade).low} vs ${kitPower(r.family, 3)}`);
  }
  check("the deeper (defence) recipe still floors higher than the shallow one (752 > 584)", forgeBand("patterned").low > forgeBand("makeshift").low, `${forgeBand("patterned").low} vs ${forgeBand("makeshift").low}`);
  check("the leapfrog reproduces through the shipped grade reader (a 700-power roll grades Makeshift)", gradeForPower(700).id === "makeshift", gradeForPower(700).id);
  check("…and a roll just over the ceiling's band still grades Pre-War, never beyond it", gradeForPower(ceiling).id === "prewar" && gradeForPower(ceiling + 5000).id === "prewar", `${gradeForPower(ceiling).id}/${gradeForPower(ceiling + 5000).id}`);
  check("a T4 kit (1296) sits in the top band — the two ladders still meet at the ceiling", gradeForPower(kitPower("precision", 4)).id === "prewar", gradeForPower(1296).id);

  // NEGATIVE CONTROL — at the ceiling this slice replaced (259), the worst band's
  // HIGH was below a T3 (178). So the leapfrog is a real, new consequence of the
  // ladder and not something the checks would have said about the old tables.
  const oldCeiling = 259;
  const oldMakeshift = { low: Math.ceil(oldCeiling * 0.45), high: Math.floor(oldCeiling * 0.58) };
  const oldT3 = Math.round(81 * 2.2);
  console.log(`     (replaced ceiling ${oldCeiling}: Makeshift was ${oldMakeshift.low}–${oldMakeshift.high}, a T3 was ${oldT3})`);
  check("NEGATIVE CONTROL: at the replaced 3.2× ceiling the worst grade was 117–150", JSON.stringify(oldMakeshift) === JSON.stringify({ low: 117, high: 150 }));
  check("NEGATIVE CONTROL: …and its HIGH sat BELOW a T3 (150 < 178) — no leapfrog then", oldMakeshift.high < oldT3, `${oldMakeshift.high} vs ${oldT3}`);
  check("…while its LOW sat below a T2 (117 < 122): the worst grade straddled a T2, which is what the brief described", oldMakeshift.low < Math.round(81 * 1.5) && oldMakeshift.high > Math.round(81 * 1.5));
}

console.log("— 6 · GUARDRAILS: earn-only, the standing rule, the gates —");
{
  assertCatalogFair();
  check("assertCatalogFair passes clean (no war-hardware vocab in the catalog)", true);
  const fs = await import("node:fs");
  const monet = fs.readFileSync("/home/team/shared/site/src/game/monetization.ts", "utf-8");
  for (const word of ["plasma", "armory", "weapon", "trebuchet"]) {
    check(`monetization.ts never names "${word}" (earn-only tripwire, untouched)`, !new RegExp(`\\.?${word}[^A-Za-z]`).test(monet.replace(/FORBIDDEN_POWER_TERMS[\s\S]*/, "")), word);
  }
  check("the storefront is still off (nothing about this slice is purchasable)", MONETIZATION_CONFIG.storefrontEnabled === false);
  check("the standing rule holds: no live season objective is a timed build", timedBuildObjectiveViolations().length === 0, timedBuildObjectiveViolations().join(","));
  check("the watchlist still names the armory build objective (45-day builds make this matter more)", TIMED_BUILD_OBJECTIVE_IDS.includes("complete_armory_build"));
  check("a re-added timed-build objective is still refused", JSON.stringify(timedBuildObjectiveViolationsIn(["complete_armory_build", "explore_zone"])) === JSON.stringify(["complete_armory_build"]));
  check("the armory research line is unchanged (hub + 5 families + plasma = 7)", ARMORY_TREE.length === 7, `${ARMORY_TREE.length}`);
}

console.log("— 7 · THE ENGINE RUNS IT: 2 slots in play, a 45-day T4 commitment —");
{
  const ready = (name: string, plasma = 0): GameState => {
    const st = engine.newGame(name, "watchers", now);
    st.resources.supplies = 1500; st.resources.embers = 1200; st.resources.gas = 400; st.resources.plasma = plasma;
    st.techsResearched.push("armory_hub");
    for (const t of Object.values(weapons.ARMORY_FAMILY_TECH)) st.techsResearched.push(t);
    return st;
  };
  const st = ready("Curve", 50);
  const [a, b, c] = weapons.raceFamilies("watchers");
  check("a fresh colony has 2 free slots", engine.armorySlotsFree(st) === 2 && engine.armoryBuildsInFlight(st) === 0);
  check("first build opens", engine.startWeaponBuild(st, a.id, now).ok === true);
  check("…one slot is now used (1 free)", engine.armoryBuildsInFlight(st) === 1 && engine.armorySlotsFree(st) === 1);
  check("SECOND family can build IN PARALLEL — that is what the second slot is", engine.startWeaponBuild(st, b.id, now).ok === true);
  check("…both slots are committed (0 free)", engine.armoryBuildsInFlight(st) === 2 && engine.armorySlotsFree(st) === 0);
  const third = engine.startWeaponBuild(st, c.id, now);
  check("a THIRD concurrent build is refused (the ratified 2-slot cap)", third.ok === false, third.error ?? "accepted!");
  check("…and the refusal names the cap, not a resource", (third.error ?? "").includes("2") || (third.error ?? "").includes("slots"), third.error ?? "");
  check("a family already under construction is still refused (no queue)", engine.startWeaponBuild(st, a.id, now).ok === false);
  check("the T1 commitment is exactly 12h", st.armoryBuilds[a.id]!.doneAt - st.armoryBuilds[a.id]!.startedAt === 12 * HOUR);
  engine.advance(st, now + 12 * HOUR + 1000);
  check("after 12h both T1 builds resolved offline", engine.armoryFamilyState(st, a.id).tier === 1 && engine.armoryFamilyState(st, b.id).tier === 1);
  check("…and both slots are free again", engine.armorySlotsFree(st) === 2);
  check("the third family now builds (the slot really was the blocker)", engine.startWeaponBuild(st, c.id, now + 12 * HOUR + 1000).ok === true);
  check("T2 needs 3d and 3 plasma — the upgrade commits", engine.startWeaponBuild(st, a.id, now + 12 * HOUR + 2000).ok === true);
  check("a T2 upgrade is exactly 3d", st.armoryBuilds[a.id]!.doneAt - st.armoryBuilds[a.id]!.startedAt === 3 * DAY);
  engine.advance(st, now + 12 * HOUR + 3 * DAY + 2000);
  check("after 3d the family stands at T2", engine.armoryFamilyState(st, a.id).tier === 2);

  // The headline time: a T4 commitment lasts 45 days and resolves offline.
  const st4 = ready("Brute", 100);
  st4.armory[a.id] = { tier: 3, everBuilt: true };
  const t4 = engine.startWeaponBuild(st4, a.id, now);
  check("a T4 upgrade commits", t4.ok === true, t4.error ?? "");
  check("…and it lasts exactly 45 days (3,888,000,000 ms)", st4.armoryBuilds[a.id]!.doneAt - now === 45 * DAY, `${st4.armoryBuilds[a.id]!.doneAt - now}`);
  check("publicState carries the in-flight build (the client can render the 45-day timer)", (publicState(st4) as unknown as { armoryBuilds: Record<string, { targetTier: number; doneAt: number }> }).armoryBuilds[a.id]?.targetTier === 4);
  engine.advance(st4, now + 45 * DAY - 1000);
  check("it has NOT resolved one second early", engine.armoryFamilyState(st4, a.id).tier === 3);
  engine.advance(st4, now + 45 * DAY + 1000);
  check("45 days later the T4 stands — resolved offline, no client involvement", engine.armoryFamilyState(st4, a.id).tier === 4);
  check("…and the consumed record is gone (resolved exactly once)", st4.armoryBuilds[a.id] === undefined);
  check("…and the T4's stats are the brute (weaponStats T4 > 5× T3 power on the assault family)", weapons.weaponStats("assault", 4).power >= 5 * weapons.weaponStats("assault", 3).power, `${weapons.weaponStats("assault", 4).power} vs ${weapons.weaponStats("assault", 3).power}`);
}

console.log(`\narmory-value-curve-tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
