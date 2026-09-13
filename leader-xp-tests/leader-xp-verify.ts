// Engine-level play-test for Leader XP/leveling/specialization (V3).
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { getTech } from "/home/team/shared/site/src/game/research.ts";
import { levelFromXp, leaderLevel, xpForLevel, DAILY_XP_CAP, SPECIALIZATION_MILESTONE } from "/home/team/shared/site/src/game/leader-xp.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

console.log("— curve table check —");
check("L1=0", levelFromXp(0) === 1);
check("L2 at 200", levelFromXp(199) === 1 && levelFromXp(200) === 2);
check("L3 at 450", levelFromXp(450) === 3);
check("L4 at 800", levelFromXp(800) === 4);
check("L10 at 5000", levelFromXp(5000) === 10);
check("cap at 99999", levelFromXp(99999) === 10);
check("xpForLevel(3)==450", xpForLevel(3) === 450);

const now = Date.now(); // real clock
const st: GameState = engine.newGame("Test Colony", "grays", now);
const vaera = st.leaders.find((l) => l.id === "ld-vaera")!;

console.log("— new game defaults —");
check("vaera xp 0", vaera.xp === 0);
check("vaera level 1", leaderLevel(vaera) === 1);
check("vaera unspent 0", vaera.unspentPoints === 0);
check("no spec", vaera.specialization === null);
check("day ledger empty", Object.keys(st.leaderXpCaps).length === 0);

console.log("— grant XP via research resolution —");
// Complete a research job to fire the real event path.
const tech = getTech("w1");
st.codices = 100;
const res = engine.beginResearch(st, "w1", vaera.id, now + 1000);
check("beginResearch ok", res.ok === true, res.error || "");
// fast-forward past duration
const dur = res.state! ? st.researchJobs[0]!.durationMs : 0;
engine.advance(st, now + 1000 + dur + 500);
const vaeraAfter = st.leaders.find((l) => l.id === "ld-vaera")!;
check("w1 researched", st.techsResearched.includes("w1"));
check("vaera gained 10 XP", vaeraAfter.xp >= 10, `xp=${vaeraAfter.xp}`);
check("day ledger counts", (st.leaderXpCaps[Object.keys(st.leaderXpCaps)[0]] || 0) >= 10);

console.log("— level-up & unspent points —");
// Force xp to L3 by direct mutation (simulating many events), then advance.
const leader = st.leaders.find((l) => l.id === "ld-vaera")!;
leader.xp = 449; leader.dayXp = 40;
engine.advance(st, now + 10000);
check("level still 2 at 449", leaderLevel(leader) === 2);
leader.xp = 450;
engine.advance(st, now + 20000);
check("level 3 at 450", leaderLevel(leader) === 3);
check("unspent points = 2 (L2+L3)", leader.unspentPoints === 2, `unspent=${leader.unspentPoints}`);

console.log("— daily cap binds —");
leader.dayXp = DAILY_XP_CAP;
leader.xp = 450;
// complete another tech with vaera — XP should be blocked
const res2 = engine.beginResearch(st, "w2", vaera.id, now + 30000);
engine.advance(st, now + 30000 + (res2.state!.researchJobs[0]?.durationMs || 0) + 500);
check("research still completes under cap", st.techsResearched.includes("w2"));
check("xp unchanged when capped", leader.xp === 450, `xp=${leader.xp}`);
check("cap logged", st.log.some((m) => m.includes("cap binds")), st.log[0] || "");

console.log("— L3 specialization choice & lock —");
const res3 = engine.chooseSpecialization(st, vaera.id, "scholar", now + 99999);
check("choose scholar ok", res3.ok === true, res3.error || "");
check("specialization persisted", leader.specialization === "scholar");
const res4 = engine.chooseSpecialization(st, vaera.id, "marshal", now + 100000);
check("second choice rejected (locked)", res4.ok === false && /already walks/.test(res4.error || ""));

console.log("— below-L3 cannot choose —");
const oric = st.leaders.find((l) => l.id === "ld-oric")!;
const res5 = engine.chooseSpecialization(st, oric.id, "marshal", now + 100000);
check("L1 cannot choose", res5.ok === false && /isn't Level 3/.test(res5.error || ""));

console.log("— effects alter engine outcomes —");
// Scholar research speed: pick an aligned tech, compare durations with/without schol.
const senna = st.leaders.find((l) => l.id === "ld-senna")!;
const baseDur = engine.researchDurationMs(st, "i1", senna);
senna.specialization = "scholar";
const scholarDur = engine.researchDurationMs(st, "i1", senna);
senna.specialization = null;
check("scholar −15% duration", scholarDur < baseDur && scholarDur === Math.round(baseDur * 0.85), `base=${baseDur} sc=${scholarDur}`);
senna.specialization = "scholar";
check("scholar breakthrough +5%", Math.abs(engine.breakthroughChance(st, senna) - 0.26 * 1.05) < 0.0001);
senna.specialization = null;
// Steward craft cost: forge medkit with/without a steward.
const medCostBase = engine.craftCost(st, "medkit", now);
const steward = st.leaders.find((l) => l.id === "ld-vaera")!;
steward.specialization = "steward";
const medCostSteward = engine.craftCost(st, "medkit", now);
steward.specialization = null;
check("steward −10% craft", medCostSteward === Math.max(1, Math.round(medCostBase * 0.9)), `base=${medCostBase} st=${medCostSteward}`);
// Marshal mults
st.leaders.forEach((l) => (l.specialization = null));
st.leaders.find((l) => l.id === "ld-oric")!.specialization = "marshal";
check("marshal combat +10%", Math.abs(engine.marshalCombatMult(st) - 1.1) < 0.0001);
check("marshal protection −20%", Math.abs(engine.marshalProtectionMult(st) - 0.8) < 0.0001);
st.leaders.forEach((l) => (l.specialization = null));
// Steward economy on supplies + ember yield
st.leaders.find((l) => l.id === "ld-vaera")!.specialization = "steward";
check("steward economy +10% supplies", Math.abs(engine.stewardEconomyMult(st) - 1.1) < 0.0001);

console.log("— allocate attribute point —");
const oric2 = st.leaders.find((l) => l.id === "ld-oric")!;
oric2.unspentPoints = 1;
const resA = engine.allocateLeaderPoint(st, oric2.id, "combat", now + 100000);
check("allocate ok", resA.ok === true, resA.error || "");
check("combat raised", oric2.attributes.combat === 6, `combat=${oric2.attributes.combat}`);
check("point consumed", oric2.unspentPoints === 0);
const resB = engine.allocateLeaderPoint(st, oric2.id, "combat", now + 100001);
check("no point -> fail", resB.ok === false);

console.log("— old save migration —");
const legacy = engine.newGame("Old", "watchers", now);
(legacy as any).leaders = (legacy as any).leaders.map((l: any) => {
  const { xp, unspentPoints, specialization, day, dayXp, xpPointsGranted, ...rest } = l as any;
  return rest; // strip ALL new fields
});
delete (legacy as any).leaderXpCaps;
engine.advance(legacy, now + 5000);
check("legacy loads, leaders regain defaults", legacy.leaders.length === 3 && (legacy.leaders[0] as any).xp === 0);
check("legacy ledger backfilled", typeof legacy.leaderXpCaps === "object" && legacy.leaderXpCaps !== null);
check("legacy level 1", (legacy.leaders[0] as any).unspentPoints === 0);

console.log("— resolveExpedition runs (wildcard/deep XP path) —");
// Deep zone run with full protection: returns cleanly (randomness: force no wildcard by high protection)
st.resources.supplies = 5000; st.resources.hazmat = 50; st.resources.shots = 50; st.resources.alloys = 50;
st.resources.medkit = 5; st.resources.mechkit = 5; st.resources.armorkit = 5; st.resources.skmech = 10; st.resources.gas = 50; st.resources.battery = 50;
st.scientists = 4;
const lres = engine.launchExpedition(st, "quantum-facility", 4, now + 200000);
if (lres.ok) {
  const e = st.expeditions[0];
  engine.advance(st, now + 200000 + e.durationMs + 1000);
  check("deep expedition resolved", st.expeditions.filter((x) => x.status === "out").length === 0);
}
console.log(`\n=== PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
