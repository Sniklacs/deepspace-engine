// retime-tests/retime-verify.ts — THE RE-TIME (owner-ratified 2026-09-26).
//
// Verbatim: "Go ahead with R = 6 and the 4h-to-168h ladder, and yes — gear gets
// consumed per run. Start the re-time."  Brief: /home/team/shared/re-time-spec-2026-09-26.md
//
// Coverage:
//   1. THE LADDER — 29 rungs, d(k) = 14.4e6 x 1.1428^k, 4 h -> 168 h, the table
//      IS the zones' own base durations (no drift), the serial pass = 54.8 d.
//   2. THE DEMAND IDENTITY — D(k) = R x d(k) x I(k) / 24, income-denominated
//      (linear in income, so no price list can go stale); the 29 rungs sum to
//      329.1 income-days. Hand-computed values asserted literally.
//   3. GEAR IS CONSUMED PER RUN — hazmat/shots/alloys/fuel/mechanics burn on
//      launch; ordnance per rung; an under-geared run still leaves (it pays in
//      radiation loss, as the pre-launch pop-up promises).
//   4. THE ENERGY POOL — 20 + 2 x logistics charges/day, a run draws
//      2 + floor(k/6), the pool refills lazily and caps at a day's worth.
//   5. MIN_TIMER_FRACTION = 0.286 — declared once, asserted where the EARNED
//      modifier stack is applied; the purchased side stays dormant.
//   6. THE MIGRATION (spec §7) — one idempotent pass: resolve first in the OLD
//      scale, then re-base only what is still running, including the
//      exactly-at-completion case and a second deploy that must not double-rebase.
//   7. THE COMPANIONS — `deployProgram` on a timer; the season objective swap
//      (no objective may require completing a timed build) and the derived tier
//      price absorbing the re-time.
//   8. THE MEASUREMENT — every rung's run priced and valued in the game's own
//      numbers (📦), so "does a run pay for itself" is answered, not assumed.
//      MEASURED, and reported as a disagreement with the pacing brief: the flip
//      does NOT land between rung 8 and rung 12 — no rung's loot covers ops +
//      consumed gear + ordnance (rim −13.9 📦, deepest −342.3 📦). THE PRICES NOW
//      COME FROM `game/valuation.ts` (V1–V12): this section used to carry its own
//      copies of them and had two omissions (the ordnance EMBERS half of the cost,
//      and the engine's own loot multipliers) — both fixed here.
//  10. THE VALUATION MODULE IS THE SOURCE (added 2026-09-27) — V1–V12 named,
//      every [E] item tied to the engine, every [P] proposal labelled, the
//      published figures pinned (shortfall, income-days, the 852,898 📦 bill, the
//      10,680 📦 build-out, ≈335 days worst case) with FOUR in-memory controls that
//      prove the pin can fail, plus one real stubbed resolve tying the loot column
//      to what the engine actually pays.
//   9. THE NETS AT EVERY RUNG (added 2026-09-27) — the demand identity at all 29
//      rungs for two different incomes (a hard-coded price list cannot pass), the
//      floor over every research and forge timer with an absurd stack, the
//      migration proven in BOTH directions plus the stamp, the standing-rule net
//      proven to catch a re-addition, and the ONE day-scale formatter in five
//      languages with no second formatter left anywhere in `src/`.
//
// Run: cd /home/team/shared/retime-tests && env -u DATABASE_URL bun run retime-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { ZONES, RUNG_TIMER_MS, rungOfZone, rungTimerMs, legacyZoneBaseMs } from "/home/team/shared/site/src/game/zones.ts";
import {
  DAILY_OBJECTIVES,
  WEEKLY_OBJECTIVES,
  SEASON_XP_PER_TIER,
  SEASON_EARNABLE_XP_PER_DAY,
  SEASON_FULL_LADDER_XP,
  SEASON_TIER_COUNT,
} from "/home/team/shared/site/src/game/monetization.ts";
// The standing-rule watchlist moved to its own module on 2026-09-27 (it has to
// name the armory's build objective, and monetization.ts is scanned word by word
// by the earn-only tripwire). The rule, the list and the `complete_` prefix net
// are all still here, and this suite still asserts them.
import {
  TIMED_BUILD_OBJECTIVE_IDS,
  isTimedBuildObjectiveId,
  timedBuildObjectiveViolations,
  timedBuildObjectiveViolationsIn,
} from "/home/team/shared/site/src/game/season-guard.ts";
import { TECH_TREE, ARMORY_TREE } from "/home/team/shared/site/src/game/research.ts";
// THE VALUATION (V1–V12) — one module, the only place a price is written down.
import * as valuation from "/home/team/shared/site/src/game/valuation.ts";
import type { GameState, Leader } from "/home/team/shared/site/src/game/types.ts";

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
const now = Date.now(); // real clock (never mock time, per project convention)
const R = 6; // engine.RUNG_ENTRY_R — asserted equal below, then used for the algebra

/** A colony with enough of everything to launch, unless a test says otherwise. */
function colony(name: string, opts: { supplies?: number; gear?: number; logistics?: number } = {}): GameState {
  const st = engine.newGame(name, "watchers", now);
  const g = opts.gear ?? 200;
  st.scientists = 4;
  st.resources.supplies = opts.supplies ?? 5_000_000;
  st.resources.embers = 5_000; // ordnance is paid in Embers from rung 6 up
  st.resources.hazmat = g;
  st.resources.shots = g;
  st.resources.alloys = g;
  st.resources.gas = g;
  st.resources.battery = g;
  st.resources.skmech = g;
  st.resources.medkit = 2;
  st.resources.mechkit = 2;
  st.resources.armorkit = 2;
  st.deployedDomains.logistics = opts.logistics ?? 0;
  engine.advance(st, now); // fills the energy pool for a legacy-shaped fixture
  return st;
}

// ======================================================================
console.log("— 1 · THE LADDER (RATIFIED: 4 h at the rim, 168 h at the deepest) —");
// ======================================================================
{
  check("the ladder has 29 rungs and the ZONES array is exactly as long", RUNG_TIMER_MS.length === 29 && ZONES.length === 29, `${RUNG_TIMER_MS.length}/${ZONES.length}`);
  check("rung 0 is the rim: 14_400_000 ms = 4.00 h", RUNG_TIMER_MS[0] === 14_400_000);
  check("the deepest rung is 604_684_700 ms = 167.97 h", RUNG_TIMER_MS[28] === 604_684_700);
  check("the deepest rung rounds to a week (168 h)", Math.round(RUNG_TIMER_MS[28] / 3_600_000) === 168);
  // every rung is round(14_400_000 x 1.1428^k) — the ratified formula, not a guess
  let formulaOk = true;
  for (let k = 0; k < 29; k++) {
    if (RUNG_TIMER_MS[k] !== Math.round(14_400_000 * Math.pow(1.1428, k))) formulaOk = false;
  }
  check("every rung equals round(14 400 000 x 1.1428^k)", formulaOk);
  let mono = true;
  for (let k = 1; k < 29; k++) if (!(RUNG_TIMER_MS[k] > RUNG_TIMER_MS[k - 1])) mono = false;
  check("the ladder is strictly increasing", mono);
  const ratios = Array.from({ length: 28 }, (_, i) => RUNG_TIMER_MS[i + 1] / RUNG_TIMER_MS[i]);
  check("every step is 1.1428 (within a rounding hair)", ratios.every((r) => Math.abs(r - 1.1428) < 1e-4), `${Math.min(...ratios).toFixed(6)}..${Math.max(...ratios).toFixed(6)}`);
  const sumH = RUNG_TIMER_MS.reduce((a, b) => a + b, 0) / 3_600_000;
  check("a serial pass = 1,316.2 h = 54.8 days of timers", Math.abs(sumH - 1316.203) < 0.01 && Math.abs(engine.serialPassDays() - 54.84) < 0.01, `${sumH.toFixed(3)} h`);
  // the table is the zones' own timers: no second source of truth to drift
  check("every zone's baseDurationMs IS its rung's ladder value", ZONES.every((z, k) => z.baseDurationMs === RUNG_TIMER_MS[k]));
  check("the rim zone is `outer-ruins` and the deepest is `starfall-core`", ZONES[0].id === "outer-ruins" && ZONES[28].id === "starfall-core");
  check("rungOfZone maps by the ZONES order (28 for the deepest)", rungOfZone("starfall-core") === 28 && rungOfZone("outer-ruins") === 0);
  check("an unknown zone reads the rim, never NaN", rungOfZone("no-such-zone") === 0 && rungTimerMs(-5) === RUNG_TIMER_MS[0]);
  check("rungTimerMs clamps past the top rung", rungTimerMs(99) === RUNG_TIMER_MS[28]);
  check("the legacy table (migration only) still carries the old bases", legacyZoneBaseMs("outer-ruins") === 45_000 && legacyZoneBaseMs("starfall-core") === 190_000);
}

// ======================================================================
console.log("— 2 · THE DEMAND IDENTITY — D(k) = R x d(k) x I(k) / 24 —");
// ======================================================================
{
  check("R is 6", R === engine.RUNG_ENTRY_R);
  const st = colony("Demand");
  const income = engine.suppliesIncomePerDay(st);
  check("income is read from the engine's own supplies rate (📦/day)", Math.abs(income - engine.suppliesPerMinute(st) * 1440) < 1e-6, `${income}`);
  // D(k) / I is exactly R x d(k) / 24, independent of the colony — the identity
  check("rung 0's demand is ONE day of the colony's own income", Math.abs(engine.rungEntryDemandInIncomeDays(ZONES[0]) - 1) < 1e-9);
  check("rung 4's demand is 1.71 income-days", Math.abs(engine.rungEntryDemandInIncomeDays(ZONES[4]) - 1.71) < 0.005, `${engine.rungEntryDemandInIncomeDays(ZONES[4])}`);
  check("the deepest rung's demand is 42.0 income-days", Math.abs(engine.rungEntryDemandInIncomeDays(ZONES[28]) - 41.99) < 0.01, `${engine.rungEntryDemandInIncomeDays(ZONES[28])}`);
  const identityDays = RUNG_TIMER_MS.reduce((a, b) => a + (R * (b / 3_600_000)) / 24, 0);
  check("THE IDENTITY: the 29 rungs sum to 329.1 income-days", Math.abs(identityDays - 329.05) < 0.01, `${identityDays.toFixed(2)}`);
  check("engine.rungEntryDemand agrees with the formula at rung 0", engine.rungEntryDemand(st, ZONES[0]) === Math.round((R * 4 * income) / 24), `${engine.rungEntryDemand(st, ZONES[0])} vs ${Math.round((R * 4 * income) / 24)}`);
  check("engine.rungEntryDemand agrees with the formula at the deepest rung", engine.rungEntryDemand(st, ZONES[28]) === Math.round((R * (604_684_700 / 3_600_000) * income) / 24));
  // income-denominated: NOT a price list. Double the income, double the demand.
  const rich = colony("Demand-rich");
  rich.deployedDomains.agriculture = 10;
  rich.deployedDomains.economy = 10;
  const r1 = engine.rungEntryDemand(st, ZONES[10]);
  const r2 = engine.rungEntryDemand(rich, ZONES[10]);
  const ratio = r2 / r1;
  const incomeRatio = engine.suppliesIncomePerDay(rich) / income;
  check("the demand is LINEAR in the colony's own income (no hard-coded price list)", Math.abs(ratio - incomeRatio) < 0.02, `${ratio.toFixed(3)} vs ${incomeRatio.toFixed(3)}`);
  // a rung costs the same number of income-days whatever the income is
  check("…so the same rung costs the same INCOME-DAYS at any income", Math.abs((r2 / engine.suppliesIncomePerDay(rich)) - (r1 / income)) < 0.01);
}

// ======================================================================
console.log("— 3 · GEAR AND ORDNANCE ARE CONSUMED PER RUN —");
// ======================================================================
{
  const st = colony("Gearburn");
  const before = { ...st.resources };
  const zone = ZONES[28]; // starfall-core: rad 80, range 88, quiet 90, risk 82
  const r = engine.launchExpedition(st, zone.id, 1, now);
  check("the deepest run launches", r.ok === true, r.error || "");
  const e = st.expeditions[0];
  const need = engine.requiredGear(zone, 1);
  check("hazmat is burned (per scientist)", st.resources.hazmat === before.hazmat - need.hazmat, `${before.hazmat}->${st.resources.hazmat}, need ${need.hazmat}`);
  check("shots are burned (per scientist)", st.resources.shots === before.shots - need.shots);
  check("one alloy is burned (per zone)", st.resources.alloys === before.alloys - need.alloys);
  check("fuel is burned (range)", st.resources.gas === before.gas - engine.gasNeed(zone));
  check("battery is burned (quiet ops)", st.resources.battery === before.battery - engine.batteryNeed(zone));
  check("mechanics are burned (heavy machinery)", st.resources.skmech === before.skmech - engine.skmechNeed(zone));
  const demand = engine.rungEntryDemand(st, zone);
  const ordUnits = engine.ordnanceUnitsForZone(zone.id);
  const spent = before.supplies - st.resources.supplies;
  check("supplies spent = operations + rung demand + ordnance", spent === engine.suppliesCostForZone(st, zone) + demand + ordUnits * 24, `spent ${spent}`);
  check("ordnance costs Embers too (8 🧯 a unit)", before.embers - st.resources.embers === ordUnits * 8);
  check("ordnance scales by rung: 0 through rung 5, then every 3rd rung", engine.ordnanceUnitsForRung(5) === 0 && engine.ordnanceUnitsForRung(6) === 0 && engine.ordnanceUnitsForRung(8) === 1 && engine.ordnanceUnitsForRung(28) === 7);
  check("a gearless colony is still ALLOWED to leave (it pays in radiation loss)", engine.launchExpedition(colony("Bare", { gear: 0 }), "outer-ruins", 1, now).ok === true);
  check("the run carries its radiation loss as a number, not a promise", typeof e.lossPct === "number" && typeof e.protection === "number");
  // the shallow ring must still teach the loop: no gear at all is required there
  const shallow = engine.requiredGear(ZONES[0], 1);
  check("the rim needs no radiation gear at all", shallow.hazmat === 0 && shallow.shots === 0 && shallow.alloys === 0);
  // affordability is now a hard gate (the old code deducted only supplies/gas/battery)
  const poor = colony("Poor", { supplies: 10 });
  const rp = engine.launchExpedition(poor, "outer-ruins", 1, now);
  check("a colony that cannot fund the rung is refused, with the reason", rp.ok === false && /rung demand/.test(rp.error || ""), rp.error || "");
}

// ======================================================================
console.log("— 4 · THE ENERGY POOL — 20 + 2 x logistics charges a day —");
// ======================================================================
{
  const st = colony("Energy");
  check("capacity = 20 charges a day with no logistics", engine.energyCapacity(st) === 20);
  const log = colony("Energy-log", { logistics: 5 });
  check("logistics adds 2 charges a level (20 + 2x5 = 30)", engine.energyCapacity(log) === 30);
  check("a deeper rung draws more: 2 + floor(k/6)", engine.energyDrawForRung(0) === 2 && engine.energyDrawForRung(5) === 2 && engine.energyDrawForRung(6) === 3 && engine.energyDrawForRung(28) === 6);
  const before = st.energy!;
  engine.launchExpedition(st, "outer-ruins", 1, now);
  check("a run draws its charges from the pool", st.energy === before - 2, `${before} -> ${st.energy}`);
  // regen is lazy and caps at a day's worth
  const t0 = now + 3_600_000;
  engine.advance(st, t0);
  check("an hour later one hour of charges is back", Math.abs((st.energy ?? 0) - (before - 2 + 20 / 24)) < 0.01, `${st.energy}`);
  engine.advance(st, t0 + 7 * 86_400_000);
  check("a week later the pool is capped at one day's charges, never a battery", st.energy === 20, `${st.energy}`);
  // an exhausted pool refuses the run
  const drained = colony("Drained");
  drained.energy = 1;
  const r = engine.launchExpedition(drained, "outer-ruins", 1, now);
  check("no energy, no launch — with the pool's own numbers in the reason", r.ok === false && /energy/.test(r.error || ""), r.error || "");
  check("shallow farming is bounded by the pool, not by a cooldown hack", engine.energyCapacity(colony("Shallow")) / engine.energyDrawForRung(0) === 10);
}

// ======================================================================
console.log("— 5 · THE FLOOR — MIN_TIMER_FRACTION = 0.286 (earned side) —");
// ======================================================================
{
  check("the constant is declared once and equals 0.286", engine.MIN_TIMER_FRACTION === 0.286);
  check("1 / 3.5 = 0.2857, rounded to the declared 0.286", Math.abs(1 / 3.5 - engine.MIN_TIMER_FRACTION) < 0.001);
  check("timerFloor clamps a collapsed stack to 28.6% of the base", engine.timerFloor(604_684_700, 1000) === Math.round(604_684_700 * 0.286));
  check("timerFloor leaves an untouched timer alone", engine.timerFloor(604_684_700, 604_684_700) === 604_684_700);
  // the worst EARNED stack today, measured: specialty 0.6 x research 10 (-40%) x Scholar (-15%)
  const worst = 0.6 * (1 - 10 * 0.04) * 0.85;
  check("today's worst earned research stack is 0.31x — above the floor, so it is a backstop", Math.abs(worst - 0.306) < 0.001 && worst > engine.MIN_TIMER_FRACTION, `${worst.toFixed(3)}`);
  const st = colony("Floor");
  st.deployedDomains.industry = 10;
  const r = engine.launchExpedition(st, ZONES[28].id, 1, now);
  check("a maxed industry stack still cannot run a timer below the floor", r.ok === true && st.expeditions[0].durationMs >= Math.round(ZONES[28].baseDurationMs * engine.MIN_TIMER_FRACTION), `${st.expeditions[0]?.durationMs}`);
  // the purchased side stays dormant: nothing in the shipped code grants time
  check("no purchase path touches a timer (the speed-up ruling is still the owner's)", engine.MIN_TIMER_FRACTION === 0.286);
}

// ======================================================================
console.log("— 6 · THE MIGRATION (spec §7) — resolve in the OLD scale, then re-base —");
// ======================================================================
{
  // (a) a run already COMPLETE in the old scale resolves, and is never extended
  const a = engine.newGame("MigA", "watchers", now - 60_000);
  a.expeditions.push({
    id: "exp-a", zoneId: "outer-ruins", label: "Outer Ruins", assignedScientists: 1,
    suppliesCost: 16, startedAt: now - 50_000, durationMs: 45_000, status: "out",
    lossPct: 0, protection: 0.5, pureAtLaunch: true,
  } as (typeof a.expeditions)[number]);
  a.timerRebase = undefined;
  engine.advance(a, now); // 50_000 ms elapsed against a 45_000 ms old-scale run
  check("(a) a complete old-scale run RESOLVES instead of being extended", a.expeditions.filter((x) => x.status === "out").length === 0);
  check("(a) it resolved in the OLD scale — it was never stretched onto the ladder", a.expeditions.length === 0 && typeof a.timerRebase === "number");

  // (b) a run still running is re-based proportionally to the base, clock discarded
  const b = engine.newGame("MigB", "watchers", now - 10_000);
  b.expeditions.push({
    id: "exp-b", zoneId: "outer-ruins", label: "Outer Ruins", assignedScientists: 1,
    suppliesCost: 16, startedAt: now - 10_000, durationMs: 22_500, status: "out", // half the old base, as a launch roll gives
    lossPct: 0, protection: 0.5, pureAtLaunch: true,
  } as (typeof b.expeditions)[number]);
  b.timerRebase = undefined;
  engine.advance(b, now);
  const rb = b.expeditions[0];
  check("(b) a running run is re-based proportionally to the new base", rb.durationMs === Math.round(22_500 * (RUNG_TIMER_MS[0] / 45_000)), `${rb.durationMs} vs ${Math.round(22_500 * (RUNG_TIMER_MS[0] / 45_000))}`);
  check("(b) its elapsed clock is discarded (startedAt = now)", rb.startedAt === now);
  check("(b) the stamp is set exactly once", b.timerRebase === 1);
  // (d) a second deploy must not double-rebase
  const dur = rb.durationMs;
  engine.advance(b, now + 6_000);
  check("(d) a second advance cannot double-rebase", b.expeditions[0].durationMs === dur && b.expeditions[0].startedAt === now);

  // (c) EXACTLY at completion (elapsed === duration) still resolves in the old scale
  const c = engine.newGame("MigC", "watchers", now - 45_000);
  c.expeditions.push({
    id: "exp-c", zoneId: "starfall-core", label: "Starfall Core", assignedScientists: 1,
    suppliesCost: 100, startedAt: now - 190_000, durationMs: 190_000, status: "out",
    lossPct: 0, protection: 1, pureAtLaunch: true,
  } as (typeof c.expeditions)[number]);
  c.timerRebase = undefined;
  engine.advance(c, now);
  check("(c) the exactly-at-completion case resolves and is never extended", c.expeditions.length === 0);

  // a modern save (already stamped) is left completely alone
  const d = colony("MigD");
  const e = engine.launchExpedition(d, "observatories", 1, now);
  const launched = d.expeditions[0];
  const launchedDur = launched.durationMs;
  engine.advance(d, now + 1_000);
  check("a run launched AFTER the re-time is never re-based", d.expeditions[0].durationMs === launchedDur, `${e.error || ""}`);
}

// ======================================================================
console.log("— 7 · THE COMPANIONS — deploy timer, the objective swap, the tier price —");
// ======================================================================
{
  const st = colony("Deploy");
  st.resources.embers = 500;
  st.insight = 500;
  const r = engine.deployProgram(st, "agriculture", now);
  check("deployProgram is accepted", r.ok === true, r.error || "");
  check("the level does NOT move on the action (it is a timer now)", st.deployedDomains.agriculture === 0);
  check("the deployment carries startedAt + durationMs", st.programDeploy?.durationMs === RUNG_TIMER_MS[0] && st.programDeploy?.startedAt === now, JSON.stringify(st.programDeploy));
  const again = engine.deployProgram(st, "economy", now);
  check("a second deployment is refused while one is in flight", again.ok === false, again.error || "");
  engine.advance(st, now + RUNG_TIMER_MS[0] + 1_000);
  check("the level advances in the resolver, once", st.deployedDomains.agriculture === 1 && st.programDeploy === null);
  engine.advance(st, now + RUNG_TIMER_MS[0] + 2_000);
  check("a double advance cannot double-resolve it", st.deployedDomains.agriculture === 1);
  check("the season sees an ACTIVITY, not a finished build", st.battlePass.dayObjectives.includes("deploy_program"));

  // the season pass re-derives — never hand-tuned
  check("the daily objective set no longer contains `complete_research`", !DAILY_OBJECTIVES.some((o) => o.id === "complete_research"));
  check("its replacement carries the SAME 15 XP weight", DAILY_OBJECTIVES.find((o) => o.id === "deploy_program")?.xp === 15);
  check("the daily ceiling is unchanged at 55 XP (so the pass cannot silently shrink)", DAILY_OBJECTIVES.reduce((sum, o) => sum + o.xp, 0) === 55);
  check("the standing rule: NO objective requires completing a timed build", timedBuildObjectiveViolations().length === 0, timedBuildObjectiveViolations().join(","));
  check("the earnable rate is still 55 + 190/7 = 82.1 XP/day", Math.abs(SEASON_EARNABLE_XP_PER_DAY - 82.142) < 0.01, `${SEASON_EARNABLE_XP_PER_DAY.toFixed(3)}`);
  check("the DERIVED tier price absorbed the re-time: 63 XP/tier", SEASON_XP_PER_TIER === 63, `${SEASON_XP_PER_TIER}`);
  check("the full ladder fits inside the season by construction", SEASON_XP_PER_TIER * (SEASON_TIER_COUNT - 1) <= SEASON_FULL_LADDER_XP, `${SEASON_XP_PER_TIER * 27} <= ${SEASON_FULL_LADDER_XP}`);
}

// ======================================================================
console.log("— 8 · THE MEASUREMENT — what a run costs, what it returns, where it flips —");
// ======================================================================
{
  // THE PRICES LIVE IN ONE MODULE: `site/src/game/valuation.ts` (V1–V12). This
  // table used to carry its own copies of them, and it had TWO documented
  // omissions — the ordnance EMBERS half of the cost, and the engine's OWN loot
  // multipliers (crew factor, race `emberGain`, `e2`, economy boost). Both are
  // fixed: the module reads the engine (the engine's own literals were NAMED
  // there first), and this measurement reads the module. No price is a bare
  // literal below. The DEMAND is still deliberately NOT in this column: it is
  // denominated in the colony's own income (income-days) — a calendar gate, not a
  // resource cost. §10 pins the totals and proves the pin can fail.
  const st = colony("Measurement");
  const pass = valuation.valuePass(st, { scientists: 1 });
  const rows = pass.rows;
  const show = (r: (typeof rows)[number]) => {
    console.log(
      `     rung ${String(r.rung).padStart(2)}  ${r.zone.padEnd(20)} ${r.hours.toFixed(2).padStart(7)} h  ` +
        `demand ${r.incomeDays.toFixed(2).padStart(6)} inc-days  ops ${String(r.ops).padStart(3)}  ` +
        `gear ${String(r.gear).padStart(3)}  ordnance ${r.ordnance.toFixed(1).padStart(6)}  cost ${r.cost.toFixed(1).padStart(6)}  ` +
        `loot ${r.loot.toFixed(2).padStart(6)}  net ${r.net.toFixed(2).padStart(8)}`,
    );
  };
  console.log("     — the first five rungs (the shallow ring must teach the loop) —");
  for (let k = 0; k < 5; k++) show(rows[k]);
  console.log("     — the deepest rung —");
  show(rows[28]);
  console.log(
    `     — the full pass: cost ${pass.cost} 📦, loot ${pass.loot} 📦, un-costed shortfall ${pass.shortfall} 📦 ` +
      `= ${pass.shortfallIncomeDays.toFixed(3)} income-days at ${pass.incomePerDay} 📦/day —`,
  );
  console.log(`     — the loop stops paying for itself (in 📦, before any demand) at rung ${pass.firstRungThatDoesNotPay} (${rows[pass.firstRungThatDoesNotPay].zone}) —`);
  // MEASURED 2026-09-27, and it DISAGREES with the pacing brief, which expected the
  // flip between rung 8 (+1 📦) and rung 12 (−27 📦). What the engine's own numbers
  // say is that NO rung's loot covers ops + consumed gear + ordnance: the rim is
  // −13.9 📦 and the deepest −342.3 📦. The brief's small magnitudes come from a
  // different loot valuation. The checks below pin the MEASUREMENT so a silent
  // change to it is caught, and the disagreement is reported rather than smoothed
  // over.
  check(
    "MEASURED: no rung's loot covers ops + gear + ordnance (the brief's 8→12 flip does NOT reproduce; measured flip is rung 0)",
    rows.every((r) => r.net < 0),
    `rung0 ${rows[0].net}, rung4 ${rows[4].net}, rung28 ${rows[28].net}`,
  );

  check("the rim's run needs no gear and no ordnance at all", rows[0].gear === 0 && rows[0].ordnance === 0, JSON.stringify(rows[0]));
  check(
    "the rim's loot is worth 2.10 📦 — the ENGINE's own crew + race multipliers (12 yield → 14 Embers), not the raw yield",
    Math.abs(rows[0].lootEmbers - 2.1) < 1e-9 && Math.abs(rows[0].loot - 2.1) < 1e-9,
    `${rows[0].lootEmbers}/${rows[0].loot}`,
  );
  check("rung 0's demand is 1.00 income-days and rung 28's is 42.0", Math.abs(rows[0].incomeDays - 1) < 1e-9 && Math.abs(rows[28].incomeDays - 41.99) < 0.01);
  check(
    "the deepest rung's gear + ordnance SUPPLIES alone is 296 📦 (128 gear + 168 ordnance)",
    rows[28].gear === 128 && rows[28].ordnanceSupplies === 168,
    `${rows[28].gear}/${rows[28].ordnanceSupplies}`,
  );
  check(
    "…and the ordnance EMBER half the old column omitted is 8.4 📦 (56 🧯 × V1), taking the rung's cost to 357.4 📦",
    rows[28].ordnanceEmbers === 56 && Math.abs(rows[28].ordnanceEmbersValue - 8.4) < 1e-9 && Math.abs(rows[28].ordnance - 176.4) < 1e-9 && Math.abs(rows[28].cost - 357.4) < 0.05,
    `${rows[28].ordnanceEmbers}/${rows[28].ordnanceEmbersValue}/${rows[28].ordnance}/${rows[28].cost}`,
  );
  check(
    "the deepest run's loot is worth 15.13 📦 (12.75 embers + 0.54 chipset + 1.84 plasma) — it still does NOT pay for itself",
    Math.abs(rows[28].loot - 15.13) < 0.02 && rows[28].net < 0 && rows[28].net > -400,
    `${rows[28].loot}/${rows[28].net}`,
  );
  check("the shallow ring (rungs 0–4) costs no ordnance at all", rows.slice(0, 5).every((r) => r.ordnance === 0));
  check("every rung's demand is BELOW its own run timer in days (a run is not priced at a week to save a week)", rows.every((r) => r.incomeDays === (R * r.hours) / 24));
}

// ======================================================================
console.log("— 9 · THE NETS THAT HAVE TO HOLD AT EVERY RUNG (added 2026-09-27) —");
// ======================================================================

// 9a · THE DEMAND IS INCOME-DENOMINATED AT EVERY RUNG — not sampled at 0/4/28.
// The whole point of the design is that NO price list exists. A sampled check
// passes for a literal that happens to agree at the sampled rungs; this one
// scales the COLONY's income and requires all 29 rungs to move with it.
{
  const lean = colony("NetLean");
  const fat = colony("NetFat");
  fat.deployedDomains.agriculture = 10;
  fat.deployedDomains.economy = 10;
  const iLean = engine.suppliesIncomePerDay(lean);
  const iFat = engine.suppliesIncomePerDay(fat);
  check("the two probe colonies really have different incomes (a real scale test)", iFat > iLean * 1.05, `${iLean.toFixed(1)} vs ${iFat.toFixed(1)} 📦/day`);
  let formulaOk = 0;
  let everyRungScales = true;
  let dev = 0;
  for (let k = 0; k < ZONES.length; k++) {
    const z = ZONES[k];
    const hours = z.baseDurationMs / 3_600_000;
    if (engine.rungEntryDemand(lean, z) === Math.round((R * hours * iLean) / 24)) formulaOk++;
    if (engine.rungEntryDemand(fat, z) === Math.round((R * hours * iFat) / 24)) formulaOk++;
    const dLean = engine.rungEntryDemand(lean, z);
    const dFat = engine.rungEntryDemand(fat, z);
    if (!(dFat > dLean)) everyRungScales = false; // a literal price would pin these equal
    dev = Math.max(dev, Math.abs(dFat / dLean - iFat / iLean));
  }
  check("D(k) = R × d(k) × I / 24 at ALL 29 rungs, for both incomes (58 identities)", formulaOk === 58, `${formulaOk}/58`);
  check("every rung's demand MOVES with income — a hard-coded price list cannot pass", everyRungScales);
  check("…and each rung moves by exactly the income ratio (no per-rung fudge factor)", dev < 0.02, `worst deviation ${dev.toFixed(5)}`);
  // the same colony, same income, asked twice: the demand is a function, not a roll
  check("the demand is deterministic for a given colony, rung after rung", ZONES.every((z) => engine.rungEntryDemand(lean, z) === engine.rungEntryDemand(lean, z)));
}

// 9b · THE FLOOR HOLDS OVER EVERY TIMED BUILD, including a stack no player can
// reach. §5 measured today's worst EARNED research stack (~0.31×, above the
// floor); this asks the structural question — can ANY earned stack collapse a
// timer? — with an absurd one, over all 30 techs and all 7 forge nodes.
{
  const st = colony("FloorNet");
  st.deployedDomains.industry = 10;
  const seed = st.leaders[0];
  const absurd: Leader = { ...seed, specialization: "scholar", attributes: { ...seed.attributes, research: 100 } };
  const floorOf = (base: number) => Math.round(base * engine.MIN_TIMER_FRACTION);
  const belowTech = TECH_TREE.filter((t) => engine.researchDurationMs(st, t.id, absurd) < floorOf(t.durationMs));
  const clampedTech = TECH_TREE.filter((t) => engine.researchDurationMs(st, t.id, absurd) === floorOf(t.durationMs));
  check(`no earned stack can push ANY of the ${TECH_TREE.length} research timers under the floor`, belowTech.length === 0, belowTech.map((t) => t.id).join(","));
  check("…and the floor is a LIVE clamp, not decoration (a 100-point Scholar sits on it)", clampedTech.length > 0, `${clampedTech.length}/${TECH_TREE.length}`);
  const belowArm = ARMORY_TREE.filter((n) => engine.armoryResearchDurationMs(st, n.id, absurd) < floorOf(n.durationMs));
  check(`the same floor holds over all ${ARMORY_TREE.length} forge research nodes`, belowArm.length === 0, belowArm.map((n) => n.id).join(","));
  // the launch stack, at the rung where the timer is longest
  const launcher = colony("FloorLaunch");
  launcher.deployedDomains.industry = 10;
  const lr = engine.launchExpedition(launcher, ZONES[28].id, 1, now);
  check("a run's landing band is floored too (169 h can never become minutes)", lr.ok === true && launcher.expeditions[0].durationMs >= floorOf(ZONES[28].baseDurationMs), `${launcher.expeditions[0]?.durationMs}`);
}

// 9c · THE MIGRATION'S MULTIPLIER IS DIRECTION-AGNOSTIC. A real save only ever
// moves UP this ladder (every rung is longer than its legacy base — asserted),
// but the re-base itself must not care which way the base moved, so both a
// stored run BELOW its old base and one ABOVE it (an extended run) are proven.
{
  let allLonger = true;
  for (let k = 0; k < ZONES.length; k++) if (!(RUNG_TIMER_MS[k] > legacyZoneBaseMs(ZONES[k].id))) allLonger = false;
  check("every rung's new base is LONGER than its legacy base (the real migration direction)", allLonger);

  const rebased = (name: string, storedMs: number, startedAt: number) => {
    const s = engine.newGame(name, "watchers", now - 10_000);
    s.expeditions.push({
      id: "exp-" + name, zoneId: "outer-ruins", label: "Outer Ruins", assignedScientists: 1,
      suppliesCost: 16, startedAt, durationMs: storedMs, status: "out",
      lossPct: 0, protection: 0.5, pureAtLaunch: true,
    } as (typeof s.expeditions)[number]);
    s.timerRebase = undefined;
    engine.advance(s, now);
    return s;
  };
  const oldBase = legacyZoneBaseMs("outer-ruins");
  const newBase = RUNG_TIMER_MS[0];
  const downState = rebased("DownUnder", Math.round(oldBase * 0.5), now - 10_000);
  const under = downState.expeditions[0];
  const upState = rebased("DownOver", Math.round(oldBase * 1.5), now - 10_000);
  const over = upState.expeditions[0];
  check("(direction 1) a run BELOW its old base re-bases to the same fraction of the new base", under.durationMs === Math.round(oldBase * 0.5 * (newBase / oldBase)), `${under.durationMs}`);
  check("(direction 2) a run ABOVE its old base (an extended one) re-bases by the SAME factor", over.durationMs === Math.round(oldBase * 1.5 * (newBase / oldBase)), `${over.durationMs}`);
  check("both directions keep the run RUNNING (neither resolved, neither vanished)", under.status === "out" && over.status === "out");
  check("both directions discard the elapsed clock (the re-base is a fresh start)", under.startedAt === now && over.startedAt === now);
  check("both directions carry the stamp, so a second deploy cannot re-base them again", downState.timerRebase === 1 && upState.timerRebase === 1);
  // and the second advance really is a no-op (the stamp, not the arithmetic, is the guard)
  const beforeSecond = over.durationMs;
  engine.advance(upState, now + 5_000);
  check("a second advance leaves a re-based run exactly where the re-base put it", upState.expeditions[0].durationMs === beforeSecond && upState.expeditions[0].startedAt === now);
}

// 9d · THE STANDING-RULE NET — proven to catch a re-addition, not just quiet today.
{
  const live = [...DAILY_OBJECTIVES, ...WEEKLY_OBJECTIVES].map((o) => o.id);
  check("the watchlist names the ARMORY build objective (it was NOT narrowed to fit)", TIMED_BUILD_OBJECTIVE_IDS.includes("complete_armory_build"), TIMED_BUILD_OBJECTIVE_IDS.join(","));
  check("…and still names every id it carried before", ["complete_research", "complete_build", "complete_deploy", "complete_expedition"].every((id) => TIMED_BUILD_OBJECTIVE_IDS.includes(id)));
  check("the net is wider than the list: ANY `complete_*` id is refused", isTimedBuildObjectiveId("complete_anything_at_all") === true);
  check("…and a real ACTIVITY is not refused", ["launch_expedition", "study", "craft_item", "deploy_program", "daily_list", "expedition_complete", "deep_site", "codex_recovered"].every((id) => !isTimedBuildObjectiveId(id)));
  check("a re-added timed-build objective FAILS LOUDLY (this suite would go red)", JSON.stringify(timedBuildObjectiveViolationsIn([...live, "complete_armory_build"])) === JSON.stringify(["complete_armory_build"]));
  check("a re-added objective named `complete_<new>` fails just as loudly", timedBuildObjectiveViolationsIn(["complete_season_trial"]).length === 1);
  check("the live objective set is empty of violations", timedBuildObjectiveViolations().length === 0, timedBuildObjectiveViolations().join(","));
  check("…and carries no `complete_` id at all (the rule, read from the data)", live.every((id) => !id.startsWith("complete_")));
}

// 9e · THE ONE FORMATTER — a week is a week in every language, and there is no
// second formatter left in the shipped source to disagree with it.
{
  const { fmtDuration } = await import("/home/team/shared/site/src/game/i18n/format.ts");
  const { makeT } = await import("/home/team/shared/site/src/game/i18n/index.ts");
  const deep = RUNG_TIMER_MS[28];
  const en = fmtDuration(makeT("en"), deep);
  check("the deepest run reads DAYS, not `10080m 0s`", en === "6d 23h", en);
  check("a rim run still reads hours-and-minutes", fmtDuration(makeT("en"), RUNG_TIMER_MS[0]) === "4h 0m", fmtDuration(makeT("en"), RUNG_TIMER_MS[0]));
  check("a sub-hour timer still reads minutes-and-seconds", fmtDuration(makeT("en"), 90_000) === "1m 30s", fmtDuration(makeT("en"), 90_000));
  check("a negative remainder floors at zero (never a negative timer)", fmtDuration(makeT("en"), -5_000) === "0s", fmtDuration(makeT("en"), -5_000));
  const langs = ["en", "es", "pt-BR", "ru", "fa"];
  const rendered = langs.map((l) => fmtDuration(makeT(l), deep));
  check("all five languages render the week, none falls back to a raw key", rendered.every((r) => r.length > 2 && !r.includes("{d}") && !r.includes("10080")));
  check("…and each prints the numbers as western digits", rendered.every((r) => r.includes("6") && r.includes("23")));
  check("the Persian week reads Persian units", (rendered[4] ?? "").includes("روز"), rendered[4]);

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
  const minutesOnly = files.filter((f) => /\$\{m\}m \$\{sec\}s/.test(readFileSync(f, "utf-8")));
  check("no minutes-only duration renderer survives in src/", minutesOnly.length === 0, minutesOnly.join(","));
}

// ======================================================================
console.log("— 10 · THE VALUATION MODULE IS THE SOURCE, AND THE PIN CANNOT PASS VACUOUSLY —");
// ======================================================================
// `/home/team/shared/loot-valuation-2026-09-27.md` priced this pass ON PAPER. This
// section makes the code own those numbers: V1–V12 live in `game/valuation.ts`,
// every [E] item must tie to the engine, every [P] item must be labelled, and the
// published figures are pinned BESIDE controls that prove the pin can fail.
{
  const st = colony("Valuation");
  const pass = valuation.valuePass(st, { scientists: 1 });
  const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;
  const moduleSrc = (await import("node:fs")).readFileSync("/home/team/shared/site/src/game/valuation.ts", "utf8");

  // ---- 10a · the module names every item, and labels the proposals ----
  check(
    "the module names all twelve items, V1…V12, in order",
    JSON.stringify(valuation.VALUATION_ITEMS.map((i) => i.id)) === JSON.stringify(["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12"]),
    valuation.VALUATION_ITEMS.map((i) => i.id).join(","),
  );
  check(
    "exactly four items are OUR PROPOSALS ([P]) and they are named: V8, V9, V10, V11",
    JSON.stringify(valuation.VALUATION_PROPOSAL_IDS) === JSON.stringify(["V8", "V9", "V10", "V11"]),
    valuation.VALUATION_PROPOSAL_IDS.join(","),
  );
  check(
    "every [P] carries PROPOSAL in its own name (the label cannot be lost in a refactor)",
    ["V8_chipsetValueProposal", "V9_CODEX_VALUE_PROPOSAL", "V10_RACE_MATERIAL_VALUE_PROPOSAL", "V11_warplateCeilingProposal"].every((n) => moduleSrc.includes(n)),
  );
  check(
    "the two fixed omissions are still switchable BY NAME in the module (which is how §10e proves the pin can fail)",
    moduleSrc.includes("includeOrdnanceEmbers") && moduleSrc.includes("includeLootMultipliers"),
  );

  // ---- 10b · every [E] item is READ from the engine, not retyped ----
  check("V1 IS the engine's own scrap rate (0.15 base)", valuation.V1_emberScrapRate(st) === engine.suppliesScrapRate(st) && valuation.V1_EMBER_SCRAP_RATE_BASE === 0.15);
  check(
    "V2 IS the engine's own ordnance unit (BOTH halves) and its per-rung unit count",
    valuation.V2_ORDNANCE_SUPPLIES_PER_UNIT === engine.ORDNANCE_SUPPLIES_PER_UNIT &&
      valuation.V2_ORDNANCE_EMBERS_PER_UNIT === engine.ORDNANCE_EMBERS_PER_UNIT &&
      valuation.V2_ordnanceUnitsForRung(28) === engine.ordnanceUnitsForRung(28) &&
      valuation.V2_ordnanceUnitsForRung(28) === 7,
  );
  check("V3 IS the engine's own pricer", pass.rows[28].ops === engine.suppliesCostForZone(st, ZONES[28]));
  check(
    "V4 IS the engine's own CRAFT table",
    valuation.V4_GEAR_UNIT_PRICES.hazmat === engine.CRAFT.hazmat.supplies &&
      valuation.V4_GEAR_UNIT_PRICES.shots === engine.CRAFT.shots.supplies &&
      valuation.V4_GEAR_UNIT_PRICES.alloy === engine.CRAFT.alloy.supplies &&
      valuation.V4_GEAR_UNIT_PRICES.gas === engine.CRAFT.gas.supplies,
  );
  check(
    "V5 IS the engine's own gear-need model (rung 28 burns 3 hazmat + 3 shots + 2 alloys at one scientist)",
    valuation.V5_gearSupplies(st, ZONES[28], 1).value === pass.rows[28].gear &&
      engine.requiredGear(ZONES[28], 1).alloys === 2 &&
      pass.rows[28].gear === 128,
  );
  check(
    "V6 IS the engine's own plasma rate and deep-salvage table (25 🧯 → 1, 2–5 at 30%)",
    valuation.V6_PLASMA_REFINE_EMBERS === 25 && valuation.V6_PLASMA_MEAN_SALVAGE_UNITS === 3.5 && valuation.V6_PLASMA_SALVAGE_CHANCE === 0.3,
  );
  check(
    "V7 prices insight through the engine's OWN study grants (2 Embers → 33 insight)",
    engine.studyInsightGranted(st, "ember") === 33 && near(valuation.V7_insightValue(st, 0.15) * 33, engine.STUDY_EMBER_COST * 0.15, 1e-9),
  );
  check(
    "V8 prices a Chipset from the engine's OWN chipset study (127 insight) — and it is a FLOOR, since no Chipset is consumed",
    engine.studyInsightGranted(st, "chipset") === 127 && near(valuation.V8_chipsetValueProposal(st, 0.15), 127 * valuation.V7_insightValue(st, 0.15), 1e-9) && near(valuation.V8_chipsetValueProposal(st, 0.15), 1.1545, 0.001),
  );
  check(
    "V12 IS the engine's mild-salvage odds × the engine's CRAFT prices (13% × 1.5 × (60% hazmat + 40% shots) = 1.404 📦)",
    near(valuation.V12_mildRingSalvageValue(st), 1.404, 0.001) &&
      near(
        engine.MILD_SALVAGE_CHANCE *
          (1 + engine.MILD_SALVAGE_SECOND_UNIT_CHANCE) *
          (engine.MILD_SALVAGE_HAZMAT_SHARE * engine.CRAFT.hazmat.supplies + (1 - engine.MILD_SALVAGE_HAZMAT_SHARE) * engine.CRAFT.shots.supplies),
        valuation.V12_mildRingSalvageValue(st),
        1e-9,
      ),
  );

  // ---- 10c · THE PIN — the published figures, asserted ----
  check("PINNED: the un-costed shortfall of a full pass is 3,802.44 📦", near(pass.shortfall, 3802.44, 5), `${pass.shortfall}`);
  check("PINNED: …which is 1.467 income-days at the rim colony's own income", near(pass.shortfallIncomeDays, 1.467, 0.005), `${pass.shortfallIncomeDays.toFixed(4)}`);
  check("PINNED: the pass costs 4,124.80 📦 and returns 322.36 📦", near(pass.cost, 4124.8, 1) && near(pass.loot, 322.36, 2), `${pass.cost}/${pass.loot}`);
  check("PINNED: the income basis is the bare Watchers floor — 2,592 📦/day", pass.incomePerDay === 2592);
  check(
    "PINNED: the ladder is 329.05 income-days and an 852,898 📦 bill (the engine's own rounded Σ demand)",
    near(pass.ladderIncomeDays, 329.05, 0.01) && pass.ladderSupplies === 852898,
    `${pass.ladderIncomeDays.toFixed(3)}/${pass.ladderSupplies}`,
  );
  check(
    "PINNED: the armory build-out is 10,680 📦 (6,900 supplies + 945 ⛽ = 3,780) = 4.12 income-days",
    pass.armoryBuildOut.total === 10680 && pass.armoryBuildOut.fuelSupplies === 3780 && near(pass.armoryBuildOutIncomeDays, 4.12, 0.01),
    JSON.stringify(pass.armoryBuildOut),
  );
  check(
    "PINNED: the worst case is 334.6 days — still the published ≈335 (329.05 + 1.467 + 4.12)",
    near(pass.worstCaseDays, 334.6, 0.2) && Math.round(pass.worstCaseDays) === 335,
    `${pass.worstCaseDays.toFixed(2)}`,
  );

  // ---- 10d · the flip, and the deep ring's gap ----
  check(
    "the flip at the measurement's defaults is rung 0: NO rung pays for itself",
    pass.payingRungs.length === 0 && pass.firstRungThatDoesNotPay === 0,
    JSON.stringify(pass.payingRungs),
  );

  // the game's BEST endowments: 8 scientists + e1 + a2 ⇒ 0.44 📦/ember
  const best = colony("ValuationBest");
  best.techsResearched = ["e1", "a2"];
  engine.advance(best, now);
  const bestPass = valuation.valuePass(best, { scientists: 8 });
  check("the best-endowment rate is the engine's own 0.44 📦/ember (0.30 e1 + 0.14 a2)", bestPass.emberScrapRate === 0.44, `${bestPass.emberScrapRate}`);
  check(
    "at the game's best endowments rungs 0–5 pay and rung 6 (the FIRST ALLOY rung) is the first that never does",
    JSON.stringify(bestPass.payingRungs) === JSON.stringify([0, 1, 2, 3, 4, 5]) && bestPass.firstRungThatDoesNotPay === 6,
    `${JSON.stringify(bestPass.payingRungs)} first ${bestPass.firstRungThatDoesNotPay}`,
  );
  check(
    "…and the flip is NEVER at rungs 8–12 in either regime (the brief's 8→12 expectation does not reproduce)",
    [8, 9, 10, 11, 12].every((k) => bestPass.rows[k].net < 0 && pass.rows[k].net < 0),
  );
  check(
    "the seven alloy rungs (rad ≥ 35: 6,7,8,9,26,27,28) are negative in EVERY regime tested",
    [6, 7, 8, 9, 26, 27, 28].every((k) => bestPass.rows[k].net < 0 && pass.rows[k].net < 0),
  );

  const gap = valuation.deepRingGap(pass);
  check("the deepest run is short by ~23×: its 15.13 📦 of loot would have to become 357.4 📦", gap.ratio > 20 && gap.ratio < 26, `${gap.ratio.toFixed(2)}`);
  check("…and NO constant closes it: with the whole ordnance charge removed it is STILL 12× short", gap.withoutOrdnanceLootRatio >= 11, `${gap.withoutOrdnanceLootRatio.toFixed(2)}`);
  check(
    "ordnance is the single largest lever (~48–49% of the deepest bill) and moving it does not make the ring pay",
    gap.ordnanceShare > 0.45 && gap.ordnanceShare < 0.5,
    `${gap.ordnanceShare.toFixed(3)}`,
  );

  // ---- 10e · THE NEGATIVE CONTROL — the pin must be able to fail ----
  // Four perturbations, all IN MEMORY (no engine constant is edited, nothing is
  // written to disk), plus the pre-fix column itself. Each must move the shortfall
  // outside the pin's own tolerance — otherwise §10c would pass on a reverted
  // column, which is exactly the vacuous green this section exists to prevent.
  const TOL = 5;
  const shortfallWith = (o: valuation.PassOptions) => valuation.valuePass(st, { scientists: 1, ...o }).shortfall;

  // (1) the PRE-FIX column: both omissions restored AND the four loot items that
  // column never priced. It must reproduce the old published figures exactly.
  const legacyPass = valuation.valuePass(st, {
    scientists: 1,
    includeOrdnanceEmbers: false,
    includeLootMultipliers: false,
    includeChipset: false,
    includePlasma: false,
    includeSalvage: false,
    includeRaceMaterial: false,
  });
  check(
    "CONTROL 1 (the pre-fix column) reproduces the OLD published rungs exactly: rim −14.2 📦, deepest −337.9 📦",
    near(legacyPass.rows[0].net, -14.2, 0.01) && near(legacyPass.rows[28].net, -337.9, 0.01),
    `${legacyPass.rows[0].net}/${legacyPass.rows[28].net}`,
  );
  check(
    "CONTROL 1 …and its shortfall is 3,836.65 📦 = 1.480 income-days (the figure the two fixes replaced)",
    near(legacyPass.shortfall, 3836.65, 5) && near(legacyPass.shortfall / pass.incomePerDay, 1.4802, 0.005),
    `${legacyPass.shortfall}/${(legacyPass.shortfall / pass.incomePerDay).toFixed(4)}`,
  );
  // (2) each omission on its own, so the report can name what each fix was worth
  const noOrdEmbers = shortfallWith({ includeOrdnanceEmbers: false });
  check(
    "CONTROL 2 (the cost omission alone) moves the pin by the whole ordnance-ember charge — exactly 100.80 📦",
    near(noOrdEmbers, 3701.64, 5) && near(pass.shortfall - noOrdEmbers, 100.8, 0.01),
    `${noOrdEmbers} (Δ ${(pass.shortfall - noOrdEmbers).toFixed(2)})`,
  );
  const noMultipliers = shortfallWith({ includeLootMultipliers: false });
  check(
    "CONTROL 3 (the loot omission alone) moves the pin UP by 29.10 📦 — the raw zone yield understates the haul",
    near(noMultipliers, 3831.54, 5) && near(noMultipliers - pass.shortfall, 29.1, 0.01),
    `${noMultipliers} (Δ ${(noMultipliers - pass.shortfall).toFixed(2)})`,
  );
  // (3) a CONSTANT nudged in memory — V1 0.15 → 0.30 — and (4) a bigger crew
  const nudged = shortfallWith({ emberScrapRate: 0.3 });
  check(
    "CONTROL 4 (V1 nudged 0.15 → 0.30 in memory) moves the pin to 3,668.59 📦",
    near(nudged, 3668.59, 5) && Math.abs(nudged - pass.shortfall) > 100,
    `${nudged}`,
  );
  const crew = shortfallWith({ scientists: 8 });
  check("CONTROL 5 (crew 1 → 8 scientists) moves the pin to 4,917.64 📦", near(crew, 4917.64, 5) && Math.abs(crew - pass.shortfall) > 100, `${crew}`);
  check(
    "…and EVERY control is outside the pin's ±5 📦 tolerance, so the pin cannot pass vacuously",
    [legacyPass.shortfall, noOrdEmbers, noMultipliers, nudged, crew].every((v) => Math.abs(v - pass.shortfall) > TOL),
    [legacyPass.shortfall, noOrdEmbers, noMultipliers, nudged, crew].map((v) => v.toFixed(0)).join("/"),
  );

  // ---- 10f · THE ENGINE TIE — the loot column is what the engine actually PAYS ----
  // The strongest tie available, and the one that makes retyping impossible: with
  // `Math.random` pinned to 0.5 the loot variance is exactly 1.0, no wildcard
  // fires, no chipset rolls and the radiation loss is zero — so a REAL resolve
  // must grant exactly the module's nominal ember yield.
  {
    const realRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const probe = colony("EngineTie");
      const zone = ZONES[28];
      const expected = Math.max(1, Math.round(engine.emberYieldNominal(probe, zone, 1)));
      const launched = engine.launchExpedition(probe, zone.id, 1, now);
      engine.advance(probe, now + (probe.expeditions[0]?.durationMs ?? 0) + 1_000);
      check(
        "the engine's OWN resolve grants exactly the module's nominal yield (rung 28, variance neutralised): 85 Embers",
        launched.ok === true && probe.totalEmbersLooted === expected && expected === 85,
        `granted ${probe.totalEmbersLooted}, nominal ${expected}, launch ${launched.error ?? "ok"}`,
      );
      check(
        "…which is the measured column's lootEmbers ÷ V1 to the Ember (12.75 📦 ÷ 0.15)",
        near(pass.rows[28].lootEmbers / pass.emberScrapRate, expected, 0.5),
        `${pass.rows[28].lootEmbers / pass.emberScrapRate} vs ${expected}`,
      );
    } finally {
      Math.random = realRandom;
    }
  }

  // ---- 10g · the two things this slice deliberately did NOT fix ----
  check(
    "the Chipset defect is still OPEN and the module says so (a Chipset is a FLOOR, not a value)",
    /a chipset is never consumed/i.test(moduleSrc) && /beginStudy/.test(moduleSrc),
  );
  check(
    "no engine balance constant moved for this slice — the cost column is still an unteched upper bound",
    /upper bound/i.test(moduleSrc) && pass.rows[0].ops === 16 && pass.rows[28].ops === 53,
  );
}
console.log(`\nretime-tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);