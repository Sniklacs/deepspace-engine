// ============================================================================
// BATTLE ENGINE VERIFICATION — design/battle-side-rvr-spec.md §15 (B1/B4
// ratified 2026-09-12) · opening-prologue-spec §5/§15 ("the real engine").
//
// The real-time battle engine: persistent battle entities resolving over real
// time from strength inputs — offline-safe, deterministic, with a live view
// and an append-only report ledger. This harness is the engine's contract:
//
//   1 · duration curve (B1)   — the ratified formula shape, the [5 min, 8 h]
//        clamp bounds (max clamp ENGAGES exactly), monotonicity in size and
//        gap, the "one-sided ends in minutes" feel.
//   2 · strength (B4)         — power is monotonically increasing in EVERY
//        ratified input (hero stats/level/skills/spec, weapon family/tier/kits,
//        troop counts, FOB-stage ceiling); outcomes follow power (stronger side
//        wins); equal power is a standoff; leader/loser casualty classes by gap;
//        squad-skill cross-terms (damage reduction / guard penalty) land.
//   3 · DETERMINISM           — byte-identical entities, moments and reports
//        across repeated runs at fixed clocks; zero Math.random reachable in
//        the war modules (comment-aware scan).
//   4 · offline resolution    — advanceBattles/engine.advance resolve exactly
//        once per battle (idempotent: no double-report, no double-log),
//        lazily (nothing resolves before its wall-clock end), and the ledger
//        report is append-only and matches the entity.
//   5 · NO PURCHASABLE TERM   — the §9/B4 static + behavioral guarantee: the
//        formula's ONLY inputs are the committed-force snapshot fields (hero
//        stats/skills, weapon family/tier, FOB stage, supply-weighted troops).
//        Comment-aware forbidden-vocabulary scan of both war modules; wallet-
//        shaped extra fields on the input change ZERO outputs; imports are
//        pure-only (armory data + types, never server/storefront modules).
//   6 · live view (B2)        — battleMoment bounds (elapsed/ETA/probability/
//        gap), the Stalemate/Pressing/Rout-risk chip, casualties ticking per
//        resolution interval toward the commit-determined final, publicState
//        stripping battle internals (server-only `internal` never ships).
//   7 · migration/backfill    — V8-era saves advance to V9 with zero errors
//        (empty battle arrays); resolved-but-unreported battles get their
//        ledger entry exactly once (ensureBattles reconcile); newGame/blank
//        carry empty arrays; the contribution FORMULA is untouched (battles
//        feed nothing into it — the Unbound gate stays fixed).
//
// Run:  cd /home/team/shared/battle-tests && bun run battle-verify.ts
// (pure imports — also runnable unchanged from the site dir; use
//  `env -u DATABASE_URL` in the full battery so store.ts stays on files.)
import { readFileSync } from "node:fs";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import {
  BATTLES_CONFIG,
  type Battle,
  type BattleHeroSnapshot,
  type BattleReserves,
  type CommittedForce,
} from "/home/team/shared/site/src/game/war/war-types.ts";
import {
  advanceAidArrivals,
  advanceBattles,
  appendReportOnce,
  battleDurationMs,
  battleEndAt,
  battleMoment,
  battlePublicView,
  buildWindows,
  casualtyFraction,
  computeForcePower,
  createBattle,
  effectiveWeaponTier,
  ensureBattles,
  finalCasualties,
  heroUnitPower,
  issueDecision,
  kitPower,
  liveCasualties,
  openBattle,
  outcomeFor,
  powerGap,
  reachableActions,
  reinforceCost,
  respondToAid,
  stateChip,
  windowDurationMs,
  windowsForView,
} from "/home/team/shared/site/src/game/war/battle-engine.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
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
const MIN = BATTLES_CONFIG.minDurationMs;
const MAX = BATTLES_CONFIG.maxDurationMs;

function hero(id: string, name: string, role: BattleHeroSnapshot["role"], attrs: Partial<BattleHeroSnapshot["attributes"]>, level = 1, specialization: BattleHeroSnapshot["specialization"] = null, skills: BattleHeroSnapshot["skills"] = []): BattleHeroSnapshot {
  return {
    id,
    name,
    role,
    level,
    attributes: { power: 3, guard: 3, craft: 2, presence: 3, ...attrs },
    specialization,
    skills,
  };
}
function force(side: "attacker" | "defender", colonyId: string, colonyName: string, o: Partial<CommittedForce> = {}): CommittedForce {
  return { side, colonyId, colonyName, heroSquad: [], weapons: [], troops: 0, fobStage: 4, ...o };
}
/** One battle's worth of forces; returns {attacker, defender}. */
function rivalPair(a: Partial<CommittedForce> = {}, d: Partial<CommittedForce> = {}) {
  return {
    attacker: force("attacker", "col-a", "The Vigil", a),
    defender: force("defender", "col-b", "Hollow Colony", d),
  };
}

// ============================================================================
// 1 · Duration curve (B1 — owner-ratified form, clamped [5 min, 8 h])
// ============================================================================
console.log("— 1 · duration curve (B1) —");
// Exact formula shape at hand-computed points: base(20min) × (1+log2(1+P/k)) ÷ (1+3·gap)
{
  const k = BATTLES_CONFIG.sizeScaleK;
  const base = BATTLES_CONFIG.baseDurationMs;
  const expect = (pa: number, pd: number) => {
    const total = pa + pd;
    const gap = Math.abs(pa - pd) / Math.max(pa, pd, 1);
    const raw = (base * (1 + Math.log2(1 + total / k))) / (1 + 3 * gap);
    return Math.max(MIN, Math.min(MAX, Math.round(raw)));
  };
  // spot-check the formula body across a grid
  const grid = [
    [1, 0], [30, 5], [100, 100], [500, 480], [1000, 999], [5000, 5000], [9101, 9101], [1e6, 1e6], [1e12, 1e12], [1e12, 0],
  ] as const;
  check("duration matches the ratified curve exactly across a 10-point grid", grid.every(([a, b]) => battleDurationMs(a, b) === expect(a, b)));
  check("clamp bounds hold across the grid: every duration ∈ [5 min, 8 h]", grid.every(([a, b]) => { const d = battleDurationMs(a, b); return d >= MIN && d <= MAX; }));
  check("max clamp ENGAGES exactly: (1e12,1e12) → 8 h", battleDurationMs(1e12, 1e12) === MAX);
  check("huge one-sided fight still bounded by 8 h", battleDurationMs(1e12, 0) <= MAX);
  check("all-durations sweep (0..50k powers) stays in [5 min, 8 h]", (() => {
    for (let a = 0; a <= 50_000; a += 137) for (let b = 0; b <= 50_000; b += 3_137) {
      const d = battleDurationMs(a, b);
      if (d < MIN || d > MAX) return false;
      if (!Number.isFinite(d)) return false;
    }
    return true;
  })());
  check("tiny one-sided fight ends in minutes: (100, 0) < 7 min", battleDurationMs(100, 0) < 7 * 60_000);
  check("(1, 0) sits within 5% of the 5 min floor (the floor is a guard, not the curve's resting point)", Math.abs(battleDurationMs(1, 0) - MIN) < MIN * 0.05);
  // monotonicity: at near-equal gap, duration grows with total power
  const sizeDurs = [10, 100, 1_000, 10_000, 100_000].map((n) => battleDurationMs(n, n));
  check("duration ∝ force size at even gap: non-decreasing across 10→100k", sizeDurs.every((d, i) => i === 0 || d >= sizeDurs[i - 1]));
  check("bigger even fights grind (100k vs 100k > 2× the 10 vs 10 fight)", sizeDurs[4] > sizeDurs[0] * 2);
  // monotonicity: at fixed total, duration shrinks as the gap widens
  const gapDurs = [
    battleDurationMs(500, 500),
    battleDurationMs(600, 400),
    battleDurationMs(750, 250),
    battleDurationMs(900, 100),
    battleDurationMs(999, 1),
  ];
  check("duration ∝ 1/strength gap: non-increasing as the fight gets one-sided", gapDurs.every((d, i) => i === 0 || d <= gapDurs[i - 1]));
  check("even fight takes the long road; one-sided takes short (1000 total)", gapDurs[4] < gapDurs[0] / 3);
}

// ============================================================================
// 2 · Strength (B4 — hero stats+skills, weapons, FOB ceiling, troops)
// ============================================================================
console.log("— 2 · strength formula (B4 inputs only) —");
{
  const baseHero = hero("h1", "Test Hero", "damage", { power: 6, guard: 2, craft: 2, presence: 2 }, 1);
  const heroOnly = force("attacker", "a", "A", { heroSquad: [baseHero] });
  const p0 = computeForcePower(heroOnly);
  check("power > 0 from a lone level-1 hero", p0 > 0);
  check("hero term grows with level (L1 < L5 < L10)", (() => {
    const l1 = computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 }, 1)] }));
    const l5 = computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 }, 5)] }));
    const l10 = computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 }, 10)] }));
    return l1 < l5 && l5 < l10;
  })());
  check("hero term grows with attribute points (power 6 vs power 12)", computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 })] })) < computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 12 })] })));
  check("squad skills add power (strength 0.15 skill fires)", (() => {
    const plain = hero("h", "H", "damage", { power: 6 }, 1);
    const skilled = hero("h", "H", "damage", { power: 6 }, 1, null, [{ id: "s", name: "Sustained Argument", strength: 0.15 }]);
    return computeForcePower(force("attacker", "a", "A", { heroSquad: [plain] })) < computeForcePower(force("attacker", "a", "A", { heroSquad: [skilled] }));
  })());
  check("L3 specialization raises power only per its mandate (vanguard > hearthward > courser)", (() => {
    const mk = (spec: "vanguard" | "hearthward" | "courser") => computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 }, 5, spec)] }));
    return mk("vanguard") > mk("hearthward") && mk("hearthward") > mk("courser") && mk("courser") === computeForcePower(force("attacker", "a", "A", { heroSquad: [hero("h", "H", "damage", { power: 6 }, 5, null)] }));
  })());
  check("weapon kits add power; more kits = more power", (() => {
    const none = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [] }));
    const one = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [{ family: "assault", tier: 1, count: 1 }] }));
    const two = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [{ family: "assault", tier: 1, count: 2 }] }));
    return none < one && one < two;
  })());
  check("weapon tiers scale power (T1 < T2 < T4 at equal counts)", (() => {
    const t1 = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [{ family: "siege", tier: 1, count: 5 }] }));
    const t2 = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [{ family: "siege", tier: 2, count: 5 }] }));
    const t4 = computeForcePower(force("attacker", "a", "A", { heroSquad: [baseHero], weapons: [{ family: "siege", tier: 4, count: 5 }] }));
    return t1 < t2 && t2 < t4;
  })());
  check("weapon families differ in power (siege-heavy vs engine-light at equal tier)", (() => {
    const p = (f: "siege" | "engine") => computeForcePower(force("attacker", "a", "A", { weapons: [{ family: f, tier: 1, count: 10 }] }));
    return p("siege") > p("engine");
  })());
  check("troops add power linearly within the FOB cap", (() => {
    const p = (n: number) => computeForcePower(force("attacker", "a", "A", { troops: n, fobStage: 4 }));
    return p(100) < p(200) && p(200) - p(100) === p(300) - p(200);
  })());
  check("FOB-stage ceiling: T4 kits at a Landing Pad field at T1 strength (tier capped)", (() => {
    const fob1 = computeForcePower(force("attacker", "a", "A", { weapons: [{ family: "assault", tier: 4, count: 10 }], fobStage: 1 }));
    const fob4 = computeForcePower(force("attacker", "a", "A", { weapons: [{ family: "assault", tier: 4, count: 10 }], fobStage: 4 }));
    const t1val = computeForcePower(force("attacker", "a", "A", { weapons: [{ family: "assault", tier: 1, count: 10 }], fobStage: 4 }));
    return fob1 < fob4 && fob1 === t1val && effectiveWeaponTier(4, 1) === 1 && effectiveWeaponTier(4, 4) === 4;
  })());
  check("FOB-stage ceiling: troops beyond the staging cap add no combat power", (() => {
    const cap = BATTLES_CONFIG.fobTroopCapByStage[1]; // Landing Pad
    const at = computeForcePower(force("attacker", "a", "A", { troops: cap, fobStage: 1 }));
    const over = computeForcePower(force("attacker", "a", "A", { troops: cap * 10, fobStage: 1 }));
    return at === over;
  })());
  check("outcome follows power: stronger side wins, equal power is a standoff", (() => {
    return outcomeFor(100, 50) === "attacker_victory" && outcomeFor(50, 100) === "defender_victory" && outcomeFor(50, 50) === "standoff";
  })());
  check("createBattle outcome matches the strength comparison (both directions)", (() => {
    const t = 1_700_000_000_000;
    const strong = force("attacker", "a", "A", { troops: 400, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] });
    const weak = force("defender", "d", "D", { troops: 30, fobStage: 1 });
    const b1 = createBattle({ zoneId: "z", zoneName: "Z", attacker: strong, defender: weak }, t);
    const b2 = createBattle({ zoneId: "z", zoneName: "Z", attacker: weak, defender: strong }, t);
    return b1.forcePower.attacker > b1.forcePower.defender && b2.forcePower.defender > b2.forcePower.attacker
      && outcomeFor(b1.forcePower.attacker, b1.forcePower.defender) === "attacker_victory"
      && outcomeFor(b2.forcePower.attacker, b2.forcePower.defender) === "defender_victory";
  })());
  check("casualties respect class: winner bleeds less than loser in a lopsided fight", (() => {
    const t = 1_700_000_000_000;
    const pair = rivalPair(
      { troops: 500, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] },
      { troops: 100, fobStage: 1 },
    );
    const b = createBattle({ zoneId: "z", zoneName: "Z", ...pair }, t);
    return b.casualties.attacker < b.casualties.defender && b.casualties.defender <= b.defender.troops && b.casualties.attacker <= b.attacker.troops;
  })());
  check("standoff: equal power bleeds both sides identically (0.22 of troops)", (() => {
    const t = 1_700_000_000_000;
    const pair = rivalPair({ troops: 200 }, { troops: 200 });
    const b = createBattle({ zoneId: "z", zoneName: "Z", ...pair }, t);
    return b.casualties.attacker === b.casualties.defender
      && b.casualties.attacker === Math.round(200 * BATTLES_CONFIG.casualtyStandoff);
  })());
  check("casualty fraction = published curve at gap 0 and gap 1", (() => {
    const winEven = casualtyFraction(100, 100); // standoff class, gap 0
    const winLopsided = casualtyFraction(1000, 0); // gap exactly 1
    const loseLopsided = casualtyFraction(0, 1000); // gap exactly 1, loser class
    return winEven === BATTLES_CONFIG.casualtyStandoff
      && Math.abs(winLopsided - (BATTLES_CONFIG.casualtyWinBase - BATTLES_CONFIG.casualtyWinGapDrop)) < 0.001
      && Math.abs(loseLopsided - (BATTLES_CONFIG.casualtyLoseBase + BATTLES_CONFIG.casualtyLoseGapRise)) < 0.001;
  })());
  check("squad-skill cross-terms: own damageReduction lowers own casualties; enemy guardPenalty raises them", (() => {
    const t = 1_700_000_000_000;
    const azazel = hero("az", "Azazel", "tank", { power: 3, guard: 6 }, 1, null, [{ id: "s1", name: "Front of the Lecture", damageReduction: 0.1 }]);
    const semira = hero("se", "Semira", "support", { presence: 7 }, 1, null, [{ id: "s2", name: "The Flaw Revealed", guardPenalty: 0.1 }]);
    const mk = (aHeroes: BattleHeroSnapshot[], dHeroes: BattleHeroSnapshot[]) =>
      createBattle({ zoneId: "z", zoneName: "Z", attacker: force("attacker", "a", "A", { troops: 300, heroSquad: aHeroes }), defender: force("defender", "d", "D", { troops: 300, heroSquad: dHeroes }) }, t);
    const base = mk([], []);
    const withDr = mk([azazel], []);
    const withGp = mk([], [semira]);
    return withDr.casualties.attacker < base.casualties.attacker
      && withGp.casualties.attacker > base.casualties.attacker;
  })());
}

// ============================================================================
// 3 · determinism — byte-identical, zero randomness
// ============================================================================
console.log("— 3 · determinism —");
{
  const t = 1_700_000_000_000;
  const pair = rivalPair(
    { troops: 400, weapons: [{ family: "assault", tier: 3, count: 12 }], heroSquad: [hero("h", "H", "damage", { power: 7 }, 9, "vanguard")] },
    { troops: 250, weapons: [{ family: "frontline", tier: 2, count: 8 }], heroSquad: [hero("g", "G", "tank", { guard: 7 }, 6, null, [{ id: "s", name: "Stand", strength: 0.15 }])] },
  );
  const b1 = createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t);
  const b2 = createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t);
  check("createBattle is byte-identical across repeated runs at a fixed clock", JSON.stringify(b1) === JSON.stringify(b2));
  const m1 = battleMoment(b1, t + 123_456);
  const m2 = battleMoment(b1, t + 123_456);
  check("battleMoment is deterministic at a fixed now", JSON.stringify(m1) === JSON.stringify(m2));
  const s1 = { battles: [createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t)], battleReports: [], log: [] } as any;
  const s2 = { battles: [createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t)], battleReports: [], log: [] } as any;
  advanceBattles(s1, t + 10_000_000_000);
  advanceBattles(s2, t + 10_000_000_000);
  check("resolution + report + log are byte-identical across identical worlds", JSON.stringify(s1.battles) === JSON.stringify(s2.battles) && JSON.stringify(s1.battleReports) === JSON.stringify(s2.battleReports) && JSON.stringify(s1.log) === JSON.stringify(s2.log));
  const src = [readFileSync("/home/team/shared/site/src/game/war/battle-engine.ts", "utf8"), readFileSync("/home/team/shared/site/src/game/war/war-types.ts", "utf8")];
  const stripComments = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const executable = src.map(stripComments).join("\n");
  check("no Math.random anywhere in the war modules' EXECUTABLE code (comment-aware scan)", !executable.includes("Math.random") && !/\brandom\s*\(/.test(executable));
}

// ============================================================================
// 4 · offline resolution — lazy, exactly-once, append-only
// ============================================================================
console.log("— 4 · offline resolution —");
{
  const t = 1_700_000_000_000;
  const pair = rivalPair(
    { troops: 400, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] },
    { troops: 60, fobStage: 1 },
  );
  const b = createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t);
  const st = { battles: [b], battleReports: [], log: [] } as any;
  check("nothing resolves before its wall-clock end", advanceBattles(st, t + b.durationMs - 1) === 0 && b.status === "active");
  const resolved = advanceBattles(st, t + b.durationMs + 1);
  check("resolves exactly once at/after the end", resolved === 1 && b.status === "resolved");
  check("result = the strength outcome + winner stamp", b.result?.outcome === "attacker_victory" && b.result?.winnerColonyId === "col-a" && b.result?.endedAt === battleEndAt(b));
  check("report appended exactly once to the append-only ledger", st.battleReports.length === 1 && st.battleReports[0].battleId === b.id);
  check("report matches the entity (duration, casualties, zones, outcome)", (() => {
    const r = st.battleReports[0];
    return r.zoneId === "qz" && r.zoneName === "Quarry Edge" && r.durationMs === b.durationMs
      && r.outcome === "attacker_victory" && r.winnerColonyName === "The Vigil"
      && r.attacker.casualties === b.casualties.attacker && r.defender.casualties === b.casualties.defender
      && r.attacker.heroNames.includes("H") && r.attacker.troops === 400 && r.defender.fobStage === 1;
  })());
  check("report records the committed composition (weapons + power per side)", (() => {
    const r = st.battleReports[0];
    return Array.isArray(r.attacker.weapons) && r.defender.weapons.length === 0 && r.attacker.power === b.forcePower.attacker && r.defender.power === b.forcePower.defender;
  })());
  check("Chronicle line written for the resolution", st.log.length === 1 && st.log[0].includes("Quarry Edge"));
  check("repeated ticks never double-resolve or double-report (idempotent)", advanceBattles(st, t + 99_999_999_999) === 0 && st.battleReports.length === 1 && st.log.length === 1);
  // offline: state built at T, first read at T+D+big — resolves then and only then
  const offline = { battles: [createBattle({ zoneId: "z2", zoneName: "Deep Vaults", ...rivalPair({ troops: 900, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] }, { troops: 300 }) }, t)], battleReports: [], log: [] } as any;
  const n = advanceBattles(offline, t + 100 * 24 * 60 * 60 * 1000);
  check("an offline world resolves due battles on the next read (persistent-world rule)", n === 1 && offline.battles[0].status === "resolved" && offline.battleReports.length === 1);
}

// ============================================================================
// 5 · no-purchasable-term — the §9/B4 guarantee, statically AND behaviorally
// ============================================================================
console.log("— 5 · no-purchasable term (B4/§9) —");
{
  const files = [
    "/home/team/shared/site/src/game/war/war-types.ts",
    "/home/team/shared/site/src/game/war/battle-engine.ts",
  ];
  const stripComments = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/\b(?:case|return|const|let|var)\s+\w+\s*:\s*(?:[A-Z]\w*)+/g, " "); // type annotations like `power: number` are not commerce
  const FORBIDDEN = /gacha|loot.?box|purchas|storefront|paywall|wallet|currency|scrip|votive|for.?sale|price|priced|shop|bundle|\bsell\b|\bbuy\b/i;
  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    const code = stripComments(raw);
    const hits = (code.match(FORBIDDEN) ?? []).slice(0, 3);
    check(`${f.split("/").pop()} executable code contains zero wallet/commerce vocabulary`, hits.length === 0, hits.join(" | "));
  }
  // Behavioral: wallet-shaped extra fields on the committed force change NOTHING,
  // because the formula reads only the §15 B4 snapshot fields.
  const pair = rivalPair(
    { troops: 250, weapons: [{ family: "assault", tier: 3, count: 10 }], heroSquad: [hero("h", "H", "damage", { power: 6 }, 5)] },
    { troops: 200, fobStage: 2 },
  );
  const clean = computeForcePower(pair.attacker);
  const polluted = computeForcePower({ ...pair.attacker, scrip: 999_999, votives: 999_999, whalePowerBonus: 1e9, boughtTier: 4 } as unknown as CommittedForce);
  check("wallet-shaped extra fields on the input change the power output by ZERO", clean === polluted && polluted > 0);
  check("hero snapshots are value-copy inputs — the formula never imports hero/currency modules", (() => {
    const imports = readFileSync("/home/team/shared/site/src/game/war/battle-engine.ts", "utf8").match(/import[^;]+;/g) ?? [];
    const joined = imports.join("\n");
    return !/monetization|store\b|auth|api|routes\/|react|@tanstack/.test(joined) && joined.includes("../armory");
  })());
  check("forcePower is a pure function of the committed force (same force → same number every call)", (() => {
    const a = computeForcePower(pair.attacker);
    const b2 = computeForcePower(pair.attacker);
    const c = computeForcePower(pair.attacker);
    return a === b2 && b2 === c;
  })());
}

// ============================================================================
// 6 · live view (B2) — moments, ticks, chips, public strip
// ============================================================================
console.log("— 6 · live view (B2) —");
{
  const t = 1_700_000_000_000;
  const pair = rivalPair(
    { troops: 500, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] },
    { troops: 120, fobStage: 1 },
  );
  const b = createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t);
  const m0 = battleMoment(b, t);
  check("elapsed/ETA are consistent: elapsed + remaining = duration while active", m0.elapsedMs + m0.remainingMs === b.durationMs + 0 || Math.abs(m0.elapsedMs + m0.remainingMs - b.durationMs) <= 1);
  check("elapsedFrac ∈ [0,1] and grows toward 1", m0.elapsedFrac < 0.01 && battleMoment(b, t + b.durationMs / 2).elapsedFrac > 0.4 && battleMoment(b, t + b.durationMs / 2).elapsedFrac < 0.6);
  check("attacker win probability ∈ [0.05, 0.95] at all times", [0, 0.25, 0.5, 0.75, 1].every((f) => { const p = battleMoment(b, t + b.durationMs * f).attackerWinProb; return p >= 0.05 && p <= 0.95; }));
  check("the line shifts: the stronger attacker's probability rises as the grind unfolds", (() => {
    const early = battleMoment(b, t + b.durationMs * 0.1).attackerWinProb;
    const late = battleMoment(b, t + b.durationMs * 0.9).attackerWinProb;
    return late > early;
  })());
  check("equal powers keep the line at 0.5 forever", (() => {
    const e = createBattle({ zoneId: "z", zoneName: "Z", ...rivalPair({ troops: 300 }, { troops: 300 }) }, t);
    return battleMoment(e, t).attackerWinProb === 0.5 && battleMoment(e, t + e.durationMs / 2).attackerWinProb === 0.5;
  })());
  check("state chips: Stalemate below 0.1 gap, Pressing below 0.4, Rout risk above", stateChip(0.03) === "stalemate" && stateChip(0.2) === "pressing" && stateChip(0.7) === "rout-risk" && battleMoment(b, t).chip === "rout-risk");
  check("a near-even big fight reads Stalemate", (() => {
    const e = createBattle({ zoneId: "z", zoneName: "Z", ...rivalPair({ troops: 500 }, { troops: 490 }) }, t);
    return battleMoment(e, t).chip === "stalemate";
  })());
  // casualties tick per resolution interval toward the commit-determined final
  check("live casualties tick up across intervals and cap at the final", (() => {
    const finalA = b.casualties.attacker;
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.99].map((f) => liveCasualties(b, "attacker", t + b.durationMs * f));
    const monotone = samples.every((v, i) => i === 0 || v >= samples[i - 1]);
    const capped = samples.every((v) => v <= finalA);
    const ended = liveCasualties(b, "attacker", t + b.durationMs + 1) === finalA;
    return monotone && capped && ended && samples[0] < finalA;
  })());
  check("casualties stay within committed troop counts (never negative, never over)", (() => {
    for (let f = 0; f <= 1; f += 0.13) {
      const m = battleMoment(b, t + b.durationMs * f);
      if (m.casualties.attacker < 0 || m.casualties.attacker > Math.trunc(b.attacker.troops)) return false;
      if (m.casualties.defender < 0 || m.casualties.defender > Math.trunc(b.defender.troops)) return false;
    }
    return true;
  })());
  // publicState strips battle internals (server-only `internal` block)
  const st = engine.newGame("Legacy", "watchers", t);
  st.gameId = "g1";
  openBattle(st, createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...pair }, t));
  st.battles[0].internal = { committedAt: t, serverOnlySecret: "NEVER_SHIP" } as any;
  const pub = publicState(st);
  check("publicState strips the battle `internal` block (server-only)", !("internal" in pub.battles[0]) && !JSON.stringify(pub).includes("NEVER_SHIP"));
  check("publicState keeps the observable battle (power, composition, ticks data)", (() => {
    const p = pub.battles[0];
    return typeof p.forcePower.attacker === "number" && p.attacker.heroSquad.length === 1 && p.zoneName === "Quarry Edge" && Array.isArray(p.defender.weapons);
  })());
  check("battlePublicView mapper agrees", !("internal" in battlePublicView(st.battles[0])));
  check("report ledger is public (composition, duration, casualties, result — §15.6)", (() => {
    const st2 = engine.newGame("L", "watchers", t);
    st2.gameId = "g2";
    openBattle(st2, createBattle({ zoneId: "z", zoneName: "Z", ...pair }, t));
    advanceBattles(st2, t + 10_000_000_000);
    const p2 = publicState(st2);
    return p2.battleReports.length === 1 && typeof p2.battleReports[0].attacker.casualties === "number" && typeof p2.battleReports[0].outcome === "string";
  })());
}

// ============================================================================
// 7 · migration / backfill — V8-era saves, exactly-once reconcile, gate safety
// ============================================================================
console.log("— 7 · migration & backfill —");
{
  const t = 1_700_000_000_000;
  // A V8-era save: full state WITHOUT the battle fields.
  const legacy = engine.newGame("Legacy Colony", "watchers", t) as any;
  legacy.version = 8;
  delete legacy.battles;
  delete legacy.battleReports;
  legacy.gameId = "g-legacy";
  const before = JSON.stringify(legacy);
  engine.advance(legacy, t + 60_000);
  check("V8-era save advances with zero errors and gains empty battle arrays", Array.isArray(legacy.battles) && legacy.battles.length === 0 && Array.isArray(legacy.battleReports) && legacy.battleReports.length === 0);
  check("migration is additive — no legacy field was dropped or rewritten", (() => {
    const after = JSON.parse(before) as any;
    engine.advance(after, t + 60_000);
    const keepers = ["playerName", "race", "resources", "leaders", "deployedDomains", "expeditions", "studies", "revelationCounters"];
    // deep VALUE equality — JSON.stringify compares object key INSERTION order
    // too, which is a structural artifact, not save content. So compare values.
    const deepEq = (a: unknown, b: unknown): boolean => {
      if (a === b) return true;
      if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      // ignore undefined-valued keys: JSON drops them (e.g. an optional
      // `lastCorruptionDay: undefined` default), so they are not save content.
      const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
      const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
      if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
      return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    };
    return keepers.every((k) => deepEq(after[k], legacy[k]));
  })());
  const fresh = engine.newGame("Fresh", "watchers", t);
  check("newGame carries VERSION 11 + empty battle arrays", fresh.version === 11 && fresh.battles.length === 0 && fresh.battleReports.length === 0);
  check("blankColony carries empty battle arrays", engine.blankColony(t).battles.length === 0 && engine.blankColony(t).battleReports.length === 0);
  // resolved-but-unreported battle: ensureBattles backfills its report exactly once
  const orphan = { battles: [createBattle({ zoneId: "z", zoneName: "Z", ...rivalPair({ troops: 300 }, { troops: 50, fobStage: 1 }) }, t)], battleReports: [], log: [] } as any;
  orphan.battles[0].status = "resolved";
  orphan.battles[0].result = { outcome: "attacker_victory", winnerColonyId: "col-a", endedAt: battleEndAt(orphan.battles[0]) };
  ensureBattles(orphan);
  check("ensureBattles backfills a resolved battle's ledger report exactly once", orphan.battleReports.length === 1 && orphan.battleReports[0].battleId === orphan.battles[0].id);
  ensureBattles(orphan);
  check("ensureBattles is idempotent (no duplicate reports on re-run)", orphan.battleReports.length === 1);
  // engine.advance integration resolves battles lazily + never double-reports
  const st = engine.newGame("Warden", "watchers", t);
  st.gameId = "g-war";
  const b = createBattle({ zoneId: "qz", zoneName: "Quarry Edge", ...rivalPair({ troops: 400, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] }, { troops: 40, fobStage: 1 }) }, t);
  openBattle(st, b);
  engine.advance(st, t + b.durationMs - 1);
  check("engine.advance leaves an unfinished battle active", st.battles[0].status === "active" && st.battleReports.length === 0);
  engine.advance(st, t + b.durationMs + 1);
  check("engine.advance resolves the battle + appends the report once", st.battles[0].status === "resolved" && st.battleReports.length === 1);
  engine.advance(st, t + 99_999_999_999);
  check("engine.advance re-runs clean (no double-report, report survives reload)", st.battleReports.length === 1);
  // contribution formula untouched — battles feed NOTHING into the Unbound gate
  const sc = engine.newGame("Scorer", "watchers", t);
  sc.gameId = "g-sc";
  openBattle(sc, createBattle({ zoneId: "z", zoneName: "Z", ...rivalPair({ troops: 900 }, { troops: 100 }) }, t));
  const beforeScore = engine.contributionScore(sc);
  engine.advance(sc, t + 10_000_000_000);
  check("battle resolution feeds NOTHING into contributionScore (Unbound gate stays fixed)", engine.contributionScore(sc) === beforeScore);
  check("hero XP/level data is never touched by the engine path (battles consume snapshots only)", (() => {
    // the battle module itself performs no hero-progression writes — snapshot fields are read-only inputs
    const src = readFileSync("/home/team/shared/site/src/game/war/battle-engine.ts", "utf8");
    return !/grantXp|levelUp|capture\s*\+|xp\s*\+=\s*10/.test(src);
  })());
}

// ============================================================================
// 8 · DECISION WINDOWS (B12) & AID CALLS (B11) — windows, not APM
// ============================================================================
console.log("— 8 · decision windows & aid calls (B12/B11) —");
{
  const T = 1_700_000_000_000;
  const rich = (energy = 500): BattleReserves => ({
    reserveHeroIds: ["r1", "r2", "r3", "a1", "a2"],
    reserveTroops: 10_000,
    energy,
  });
  // a long, near-even fight: every milestone window is comfortably separated
  const big = rivalPair(
    { troops: 1000, heroSquad: [hero("h1", "H1", "damage", { power: 6 })] },
    { troops: 900, heroSquad: [hero("h2", "H2", "damage", { power: 6 })] },
  );
  const b = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
  const dur = b.durationMs;
  const wDur = windowDurationMs(dur);

  // ---- window schedule + open/close timing ----
  check("milestone windows stamped for BOTH sides at 25/50/75% of the duration", (() => {
    const wids = b.windows.map((w) => w.id).sort();
    const expect = ["w-milestone-0.25-attacker", "w-milestone-0.25-defender", "w-milestone-0.5-attacker", "w-milestone-0.5-defender", "w-milestone-0.75-attacker", "w-milestone-0.75-defender"].sort();
    return JSON.stringify(wids) === JSON.stringify(expect);
  })());
  check("windows open at their milestone, close after windowDurationMs (clamped law)", (() => {
    const w = b.windows[0];
    return w.opensAt === T + Math.round(dur * 0.25) && w.closesAt - w.opensAt === wDur && wDur >= BATTLES_CONFIG.windowMinMs && wDur <= BATTLES_CONFIG.windowMaxMs;
  })());
  check("even fight: no edge window at commit (no rout-risk yet)", !b.windows.some((w) => w.kind === "edge"));
  check("nothing is open before the first milestone, first milestone open at its moment", (() => {
    const before = windowsForView(b, T + Math.round(dur * 0.25) - 1);
    const at = windowsForView(b, T + Math.round(dur * 0.25));
    return before.every((w) => !w.open) && at.some((w) => w.open && w.id === "w-milestone-0.25-attacker");
  })());
  check("a window closes after its close time", (() => {
    const w = b.windows.find((x) => x.id === "w-milestone-0.25-attacker")!;
    return !windowsForView(b, w.closesAt + 1).some((x) => x.id === w.id && x.open);
  })());
  check("battleMoment carries the windows + aid-call views (live view, same math)", (() => {
    const m = battleMoment(b, T + Math.round(dur * 0.25));
    return Array.isArray(m.windows) && m.windows.length === b.windows.length && Array.isArray(m.aidCalls) && m.aidCalls.length === 0;
  })());

  // ---- hold & one-decision-per-window idempotency ----
  const holdT = T + Math.round(dur * 0.25);
  const hold = issueDecision(b, "attacker", "w-milestone-0.25-attacker", "hold", holdT, rich());
  check("hold is always available and records the decision", hold.ok === true && hold.decision.action === "hold" && hold.decision.windowId === "w-milestone-0.25-attacker");
  check("hold changes nothing about power or casualties", b.forcePower.attacker === createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T).forcePower.attacker);
  const dup = issueDecision(b, "attacker", "w-milestone-0.25-attacker", "reinforce", holdT, rich(), { heroes: [], troops: 10 });
  check("re-issuing the same window is a deterministic no-op (idempotent duplicate)", dup.ok === true && dup.duplicate === true && dup.decision.action === "hold" && b.decisions.length === 1);
  const wrongSide = issueDecision(b, "defender", "w-milestone-0.25-attacker", "hold", holdT, rich());
  check("the other side cannot use this side's window", wrongSide.ok === false);
  check("decisions are append-only: exactly one entry per window per side", b.decisions.length === 1 && b.decisions[0].id === "d-w-milestone-0.25-attacker");

  // ---- reinforce: effect + real cost ----
  const re = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
  const ren = issueDecision(re, "defender", "w-milestone-0.25-defender", "reinforce", T + Math.round(dur * 0.25), rich(), {
    heroes: [hero("r1", "Reinforce One", "tank", { guard: 8 }, 5)],
    troops: 400,
  });
  check("reinforce succeeds against a full reserve", ren.ok === true && ren.decision.effects.kind === "reinforce");
  const rfx = ren.decision.effects;
  if (rfx.kind === "reinforce") {
    const addedPower = Math.round(heroUnitPower(hero("r1", "Reinforce One", "tank", { guard: 8 }, 5)));
    const baseDef = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T).forcePower.defender;
    check("reinforce adds exactly the committed force's power (troops beyond the FOB cap add zero)", rfx.powerAdded === addedPower && re.forcePower.defender === baseDef + rfx.powerAdded);
    check("reinforce costs the §6 march energy (20/hero) and the troops from reserve", rfx.energySpent === BATTLES_CONFIG.reinforcementEnergyPerHero && rfx.troopsAdded === 400);
    check("reinforced heroes are recorded by name in the decision", rfx.heroNames[0] === "Reinforce One");
  }
  check("reinforced force is committed (hero squad + troops on the entity)", re.defender.heroSquad.length === 2 && re.defender.troops === 900 + 400);
  check("outcome can FLIP from a strong reinforcement (the owner's 'result shifts while it runs')", outcomeFor(re.forcePower.attacker, re.forcePower.defender) === "defender_victory");
  check("reinforce is refused without reserve troops / energy / unlocked heroes", (() => {
    const poor = issueDecision(createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T), "attacker", "w-milestone-0.25-attacker", "reinforce", T + Math.round(dur * 0.25), { reserveHeroIds: ["x"], reserveTroops: 0, energy: 0 }, { heroes: [], troops: 50 });
    const locked = issueDecision(createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T), "attacker", "w-milestone-0.25-attacker", "reinforce", T + Math.round(dur * 0.25), rich(), { heroes: [hero("not-mine", "N", "damage", {})], troops: 1 });
    return poor.ok === false && (locked.ok === false);
  })());

  // ---- withdrawal: rearguard cost vs. the saved army (B10) ----
  const wd = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
  const preWd = wd.forcePower.attacker;
  const wdRes = issueDecision(wd, "attacker", "w-milestone-0.25-attacker", "withdrawal", T + Math.round(dur * 0.25), rich());
  check("steady withdrawal is issued and charges a rearguard IMMEDIATELY", wdRes.ok === true && wdRes.decision.effects.kind === "withdrawal");
  const wfx = wdRes.decision.effects;
  if (wfx.kind === "withdrawal") {
    check("rearguard toll > 0, remaining troops reduced, power never rises", wfx.rearguardCasualties > 0 && wfx.troopsRemaining === 1000 - wfx.rearguardCasualties && wfx.powerAfter <= preWd);
    check("rearguard toll is inside the committed force (never negative, never over)", wfx.rearguardCasualties <= 1000 && wfx.troopsRemaining >= 0);
  }
  check("the live ticker FLOORS at the rearguard toll the moment it lands", (() => {
    const cas = liveCasualties(wd, "attacker", T + Math.round(dur * 0.25) + 1);
    return cas >= (wfx.kind === "withdrawal" ? wfx.rearguardCasualties : 0);
  })());
  check("withdrawal is one per side — a second order is refused", issueDecision(wd, "attacker", "w-milestone-0.5-attacker", "withdrawal", T + Math.round(dur * 0.5), rich()).ok === false);
  check("withdrawal under heavier pressure bleeds a bigger rearguard", (() => {
    const lopsided = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 300, fobStage: 1 }, { troops: 1000, heroSquad: [hero("h", "H", "damage", { power: 8 }, 10)] }) }, T);
    const pummeled = issueDecision(lopsided, "attacker", lopsided.windows.find((w) => w.side === "attacker" && w.kind === "edge")?.id ?? "w-milestone-0.25-attacker", "withdrawal", lopsided.startedAt + BATTLES_CONFIG.edgeWindowDelayMs + 1, rich());
    // compare stuck-at-base (no pressure) vs under rout-risk pressure fractions
    const gapHere = powerGap(lopsided.forcePower.attacker, lopsided.forcePower.defender);
    const frac = Math.min(BATTLES_CONFIG.withdrawalRearguardMaxFrac, BATTLES_CONFIG.withdrawalRearguardBase + BATTLES_CONFIG.withdrawalRearguardGapRise * gapHere);
    return pummeled.ok === true && pummeled.decision.effects.kind === "withdrawal"
      && Math.abs(pummeled.decision.effects.rearguardCasualties - Math.round(300 * frac)) <= 1
      && frac > BATTLES_CONFIG.withdrawalRearguardBase;
  })());

  // ---- retreat: never free, never instant (B10) ----
  const rt = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
  const early = issueDecision(rt, "defender", "w-milestone-0.25-defender", "retreat", T + Math.round(dur * 0.05), rich());
  check("retreat is refused before the minimum elapsed time (10%)", early.ok === false && rt.status === "active");
  const rtT = T + Math.round(dur * 0.2);
  check("retreat never needs a window — the abort beacon is always lit after the floor", issueDecision(rt, "defender", "w-milestone-0.25-defender", "retreat", rtT, rich()).ok === true);
  const retreat = issueDecision(rt, "defender", "w-milestone-0.25-defender", "retreat", rtT + 1, rich());
  check("retreat after the floor ends the battle as a LOSS for that side", retreat.ok === true && rt.status === "resolved" && rt.result?.outcome === "attacker_victory" && rt.result?.winnerColonyId === "col-a");
  check("a re-issued retreat is an idempotent no-op (one record per side)", retreat.duplicate === true && rt.decisions.filter((d) => d.action === "retreat").length === 1);
  check("retreat records endedBy 'retreat' and the reduced rearguard toll", rt.result?.endedBy === "retreat" && rt.result?.endedAt === rtT);
  check("retreat saves the army: casualties ≈ retreatCasualtyFrac of committed, never the full rout", (() => {
    const cas = rt.casualties.defender;
    const fracCas = Math.round(900 * BATTLES_CONFIG.retreatCasualtyFrac);
    return cas <= Math.max(fracCas, 1) + 1 && cas > 0;
  })());
  check("the winning side carries its ticked toll so far (they held, they didn't chase)", rt.casualties.attacker <= Math.trunc(rt.attacker.troops) && rt.casualties.attacker > 0);
  check("appendReportOnce finalizes the retreat ledger exactly once; advanceBattles skips the resolved battle", (() => {
    const st = { battles: [rt], battleReports: [], log: [] } as any;
    appendReportOnce(st, rt);
    appendReportOnce(st, rt);
    advanceBattles(st, T + 99_999_999_999);
    return st.battleReports.length === 1 && st.battleReports[0].endedBy === "retreat";
  })());
  check("resolution report carries the append-only decision trail", (() => {
    const st = { battles: [rt], battleReports: [], log: [] } as any;
    appendReportOnce(st, rt);
    return Array.isArray(st.battleReports[0].decisions) && st.battleReports[0].decisions.some((d: any) => d.action === "retreat");
  })());
  check("retreat from a battle a side is WINNING still ends it as that side's loss (no ground gained)", (() => {
    const strongRetreat = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 1000 }, { troops: 120, fobStage: 1 }) }, T);
    const r2 = issueDecision(strongRetreat, "attacker", "w-milestone-0.25-attacker", "retreat", T + Math.round(strongRetreat.durationMs * 0.2), rich());
    const r3 = issueDecision(strongRetreat, "attacker", "w-milestone-0.25-attacker", "retreat", T + Math.round(strongRetreat.durationMs * 0.25), rich());
    return r2.ok === true && r3.duplicate === true && strongRetreat.result?.outcome === "defender_victory" && strongRetreat.result?.winnerColonyId === "col-b";
  })());

  // ---- aid calls (B11): real commitment, delayed arrival ----
  const ad = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
  const callT = T + Math.round(dur * 0.25);
  const call = issueDecision(ad, "attacker", "w-milestone-0.25-attacker", "callAid", callT, rich());
  check("callAid raises a beacon and costs the caller's energy", call.ok === true && call.decision.effects.kind === "callAid" && ad.aidCalls.length === 1 && ad.aidCalls[0].status === "awaiting");
  const cefx = call.decision.effects;
  check("the call's arrival rides the travel delay (B3/B11)", cefx.kind === "callAid" && cefx.arrivalAt === callT + BATTLES_CONFIG.aidTravelDelayMs && ad.aidCalls[0].arrivalAt === cefx.arrivalAt);
  check("a pending beacon blocks a second call for the same side (maxAidPerSide)", issueDecision(ad, "attacker", "w-milestone-0.5-attacker", "callAid", T + Math.round(dur * 0.5), rich()).ok === false);
  const beforeArrival = ad.forcePower.attacker;
  const aidHeroes = [hero("a1", "Aid One", "support", { presence: 9 }, 7)];
  const resp = respondToAid(ad, ad.aidCalls[0].id, { colonyId: "col-c", colonyName: "Covenant", heroes: aidHeroes, weapons: [], troops: 0, fobStage: 4 }, callT + 1000, rich());
  check("a responder locks in immediately (heroes committed, power computed)", resp.ok === true && resp.decision.effects.kind === "respondAid" && ad.aidCalls[0].status === "locked" && ad.aidCalls[0].power > 0);
  check("before arrival the battle power does NOT change", ad.forcePower.attacker === beforeArrival);
  check("a locked call cannot be answered twice (first-come)", respondToAid(ad, ad.aidCalls[0].id, { colonyId: "col-d", colonyName: "Other", heroes: [hero("a2", "Aid Two", "tank", {})], weapons: [], troops: 0, fobStage: 4 }, callT + 2000, rich()).ok === false);
  check("responder heroes are locked against re-commit to the same battle", (() => {
    // a second reinforce attempt using the same hero id must be refused
    const later = issueDecision(ad, "attacker", "w-milestone-0.75-attacker", "reinforce", T + Math.round(dur * 0.75), rich(), { heroes: [hero("a1", "Aid One", "support", { presence: 9 }, 7)], troops: 0 });
    return later.ok === false;
  })());
  const n = advanceAidArrivals(ad, callT + BATTLES_CONFIG.aidTravelDelayMs + 1);
  check("the aid force lands at arrivalAt: power jumps by the responder's force", n === 1 && ad.aidCalls[0].status === "arrived" && ad.forcePower.attacker === beforeArrival + ad.aidCalls[0].power);
  check("an offline world lands landed aid on its next advance (persistent-world rule)", (() => {
    const off = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
    const offT = T + Math.round(dur * 0.25);
    issueDecision(off, "attacker", "w-milestone-0.25-attacker", "callAid", offT, rich());
    respondToAid(off, off.aidCalls[0].id, { colonyId: "col-c", colonyName: "Covenant", heroes: aidHeroes, weapons: [], troops: 0, fobStage: 4 }, offT + 1000, rich());
    const baseOff = off.forcePower.attacker;
    const st = { battles: [off], battleReports: [], log: [] } as any;
    advanceBattles(st, offT + BATTLES_CONFIG.aidTravelDelayMs + 1);
    const landedOff = off.forcePower.attacker;
    return off.aidCalls[0].status === "arrived" && landedOff >= baseOff && Math.abs(landedOff - baseOff - off.aidCalls[0].power) <= 2;
  })());
  check("aid arrival can FLIP a hopeless fight (arrival before the wall-clock end)", (() => {
    const hop = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 100, fobStage: 1 }, { troops: 1000, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] }) }, T);
    const ht = T + Math.round(hop.durationMs * 0.25);
    issueDecision(hop, "attacker", "w-milestone-0.25-attacker", "callAid", ht, rich());
    respondToAid(hop, hop.aidCalls[0].id, { colonyId: "col-c", colonyName: "Covenant", heroes: [hero("a1", "Aid One", "damage", { power: 9 }, 10), hero("a2", "Aid Two", "tank", { guard: 9 }, 10)], weapons: [], troops: 1500, fobStage: 4 }, ht + 1000, rich());
    advanceAidArrivals(hop, ht + BATTLES_CONFIG.aidTravelDelayMs + 1);
    return outcomeFor(hop.forcePower.attacker, hop.forcePower.defender) === "attacker_victory";
  })());

  // ---- edge windows: the "getting pummeled" teaching moment (§12.3) ----
  check("a rout-risk opening gap stamps an edge window for the weaker side", (() => {
    const lop = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 1000, heroSquad: [hero("h", "H", "damage", { power: 7 }, 10)] }, { troops: 120, fobStage: 1 }) }, T);
    const edge = lop.windows.find((w) => w.kind === "edge");
    return !!edge && edge.side === "defender" && edge.opensAt === lop.startedAt + BATTLES_CONFIG.edgeWindowDelayMs;
  })());
  check("a reinforcement that routs the OTHER side opens ITS edge window", (() => {
    const ed = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 1000, heroSquad: [hero("h1", "H1", "damage", { power: 6 })] }, { troops: 392, heroSquad: [hero("h2", "H2", "damage", { power: 6 })] }) }, T);
    const before = ed.windows.length;
    const reinfAt = T + Math.round(ed.durationMs * 0.25);
    issueDecision(ed, "attacker", "w-milestone-0.25-attacker", "reinforce", reinfAt, rich(), { heroes: [hero("r1", "R", "damage", { power: 10 }, 10), hero("r2", "R2", "damage", { power: 10 }, 10)], troops: 0 });
    return before === 6 && ed.windows.length === 7 && ed.windows.some((w) => w.kind === "edge" && w.side === "defender");
  })());
  check("edge windows are actionable (open + reachable actions list them)", (() => {
    const ed = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 1000, heroSquad: [hero("h1", "H1", "damage", { power: 6 })] }, { troops: 392, heroSquad: [hero("h2", "H2", "damage", { power: 6 })] }) }, T);
    const reinfAt = T + Math.round(ed.durationMs * 0.25);
    issueDecision(ed, "attacker", "w-milestone-0.25-attacker", "reinforce", reinfAt, rich(), { heroes: [hero("r1", "R", "damage", { power: 10 }, 10), hero("r2", "R2", "damage", { power: 10 }, 10)], troops: 0 });
    const edge = ed.windows.find((w) => w.kind === "edge")!;
    const at = windowsForView(ed, edge.opensAt + 1);
    const openEdge = at.find((w) => w.id === edge.id);
    return openEdge?.open === true && reachableActions(ed, "defender", openEdge, edge.opensAt + 1, rich()).some((a) => a.action === "retreat" && a.eligible);
  })());

  // ---- determinism + migration ----
  check("identical decision sequences produce byte-identical battles", (() => {
    const mk = () => {
      const x = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...rivalPair({ troops: 1000 }, { troops: 900 }) }, T);
      issueDecision(x, "attacker", "w-milestone-0.25-attacker", "reinforce", T + Math.round(dur * 0.25), rich(), { heroes: [hero("r1", "R", "tank", { guard: 8 }, 5)], troops: 300 });
      issueDecision(x, "defender", "w-milestone-0.25-defender", "hold", T + Math.round(dur * 0.25) + 5000, rich());
      return x;
    };
    return JSON.stringify(mk()) === JSON.stringify(mk()) && JSON.stringify(battleMoment(mk(), T + Math.round(dur * 0.3))) === JSON.stringify(battleMoment(mk(), T + Math.round(dur * 0.3)));
  })());
  check("ensureBattles backfills windows/decisions/aidCalls/warReserve on an older save, exactly once", (() => {
    const legacy = { battles: [{ ...createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T), windows: undefined, decisions: undefined, aidCalls: undefined }], battleReports: [], log: [] } as any;
    ensureBattles(legacy);
    ensureBattles(legacy);
    return Array.isArray(legacy.battles[0].windows) && legacy.battles[0].windows.length === 6
      && Array.isArray(legacy.battles[0].decisions) && Array.isArray(legacy.battles[0].aidCalls)
      && legacy.warReserve && typeof legacy.warReserve.troops === "number" && legacy.warReserve.lockedHeroes && typeof legacy.warReserve.lockedHeroes === "object";
  })());
  check("buildWindows is deterministic at fixed inputs; window ids are unique per battle", (() => {
    const w1 = buildWindows(100, 100, T, dur);
    const w2 = buildWindows(100, 100, T, dur);
    const ids = w1.map((w) => w.id);
    return JSON.stringify(w1) === JSON.stringify(w2) && new Set(ids).size === ids.length;
  })());
  check("decision costs mirror the §6 action table (march 20 / participation floor 10)", (() => {
    const c = reinforceCost([hero("r", "R", "tank", {})], 0);
    return c.energy === BATTLES_CONFIG.reinforcementEnergyPerHero && BATTLES_CONFIG.reinforcementEnergyPerHero === 20 && BATTLES_CONFIG.aidCallEnergy === 10 && BATTLES_CONFIG.aidRespondEnergyPerHero === 20;
  })());
  check("public view ships windows + decisions + aid calls (observable), strips internal only", (() => {
    const st = engine.newGame("L", "watchers", T);
    st.gameId = "g-win";
    st.warReserve = { troops: 100, energy: 60, cycleId: "c1", aidCredits: 0, lockedHeroes: { secretH: { battleId: "b1", until: 5 } } };
    const pub = createBattle({ zoneId: "dz", zoneName: "Decision Grounds", ...big }, T);
    openBattle(st, pub);
    const p = publicState(st);
    return Array.isArray(p.battles[0].windows) && Array.isArray(p.battles[0].decisions) && Array.isArray(p.battles[0].aidCalls)
      && !("internal" in p.battles[0]) && p.warReserve.lockedHeroes && Object.keys(p.warReserve.lockedHeroes).length === 0;
  })());
}

// ============================================================================
console.log(`\nbattle-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);