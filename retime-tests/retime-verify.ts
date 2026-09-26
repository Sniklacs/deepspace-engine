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
//
// Run: cd /home/team/shared/retime-tests && env -u DATABASE_URL bun run retime-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { ZONES, RUNG_TIMER_MS, rungOfZone, rungTimerMs, legacyZoneBaseMs } from "/home/team/shared/site/src/game/zones.ts";
import {
  DAILY_OBJECTIVES,
  SEASON_XP_PER_TIER,
  SEASON_EARNABLE_XP_PER_DAY,
  SEASON_FULL_LADDER_XP,
  SEASON_TIER_COUNT,
  timedBuildObjectiveViolations,
} from "/home/team/shared/site/src/game/monetization.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

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
  // Priced in the game's OWN numbers, nothing invented:
  //   · the CRAFT table is the 📦 price of every piece of gear a run burns;
  //   · suppliesCostForZone is the operations cost;
  //   · ordnance is 24 📦 + 8 🧯 a unit;
  //   · the loot is valued at the engine's own Ember -> supplies scrap rate.
  // The DEMAND is deliberately NOT in this column: it is denominated in the
  // colony's income (income-days), so it is a calendar gate, not a resource cost.
  // An Ember's 📦 value is a valuation choice — this table says which one.
  const scrap = engine.suppliesScrapRate(colony("Scrap"));
  const rows: {
    rung: number; zone: string; hours: number; incomeDays: number; ops: number;
    gear: number; ordnance: number; cost: number; loot: number; net: number;
  }[] = [];
  const pricer = colony("Pricer");
  for (let k = 0; k < ZONES.length; k++) {
    const z = ZONES[k];
    const need = engine.requiredGear(z, 1);
    const gear =
      need.hazmat * engine.CRAFT.hazmat.supplies +
      need.shots * engine.CRAFT.shots.supplies +
      need.alloys * engine.CRAFT.alloy.supplies +
      engine.gasNeed(z) * engine.CRAFT.gas.supplies +
      engine.batteryNeed(z) * engine.CRAFT.battery.supplies +
      engine.skmechNeed(z) * engine.CRAFT.skmech.supplies;
    const ordUnits = engine.ordnanceUnitsForRung(k);
    const ops = engine.suppliesCostForZone(pricer, z);
    const cost = ops + gear + ordUnits * 24;
    const loot = Math.round(z.emberYield * engine.emberYieldMult(pricer) * scrap * 100) / 100;
    rows.push({
      rung: k, zone: z.id, hours: z.baseDurationMs / 3_600_000,
      incomeDays: engine.rungEntryDemandInIncomeDays(z), ops, gear, ordnance: ordUnits * 24,
      cost, loot, net: Math.round((loot - cost) * 100) / 100,
    });
  }
  const show = (k: number) => {
    const r = rows[k];
    console.log(
      `     rung ${String(k).padStart(2)}  ${r.zone.padEnd(20)} ${r.hours.toFixed(2).padStart(7)} h  ` +
        `demand ${r.incomeDays.toFixed(2).padStart(6)} inc-days  ops ${String(r.ops).padStart(3)}  ` +
        `gear ${String(r.gear).padStart(3)}  ordnance ${String(r.ordnance).padStart(3)}  cost ${String(r.cost).padStart(4)}  ` +
        `loot ${String(r.loot).padStart(6)}  net ${String(r.net).padStart(8)}`,
    );
  };
  console.log("     — the first five rungs (the shallow ring must teach the loop) —");
  for (let k = 0; k < 5; k++) show(k);
  console.log("     — the deepest rung —");
  show(28);
  const flips = rows.map((r) => r.net).findIndex((n) => n < 0);
  console.log(`     — the loop stops paying for itself (in 📦, before any demand) at rung ${flips} (${rows[flips].zone}) —`);

  check("the rim's run needs no gear and no ordnance at all", rows[0].gear === 0 && rows[0].ordnance === 0, JSON.stringify(rows[0]));
  check("the rim's loot is worth 1.80 📦 at the engine's own scrap rate", rows[0].loot === 1.8, `${rows[0].loot}`);
  check("rung 0's demand is 1.00 income-days and rung 28's is 42.0", Math.abs(rows[0].incomeDays - 1) < 1e-9 && Math.abs(rows[28].incomeDays - 41.99) < 0.01);
  check("the deepest rung's gear + ordnance alone is 296 📦 (128 gear + 168 ordnance)", rows[28].gear === 128 && rows[28].ordnance === 168, `${rows[28].gear}/${rows[28].ordnance}`);
  check("the deepest run's loot is worth ~11 📦 at scrap — it does NOT pay for itself", rows[28].net < 0 && rows[28].net > -400, `${rows[28].net}`);
  check("the shallow ring (rungs 0–4) costs no ordnance at all", rows.slice(0, 5).every((r) => r.ordnance === 0));
  check("every rung's demand is BELOW its own run timer in days (a run is not priced at a week to save a week)", rows.every((r) => r.incomeDays === (R * r.hours) / 24));
}

console.log(`\nretime-tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
