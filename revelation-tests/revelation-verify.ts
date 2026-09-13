// Engine-level play-test for the Hidden Unbound Revelation Track (V4) +
// owner §8 "acknowledged by the world" gate (F8 policy a: contribution score).
// Run: cd /home/team/shared/revelation-tests && bun run revelation-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState, contributionPublicView } from "/home/team/shared/site/src/game/api.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

/** Deterministic randomness: run fn with Math.random pinned to `v`. */
function withRand<T>(v: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => v;
  try { return fn(); } finally { Math.random = orig; }
}

/** Push a fabricated in-flight expedition and resolve it deterministically. */
function runExpedition(st: GameState, zoneId: string, lossPct: number, pureAtLaunch: boolean, base: number) {
  const id = "exp-t-" + st.expeditions.length;
  st.expeditions.push({
    id, zoneId, label: zoneId, assignedScientists: 2, suppliesCost: 10,
    startedAt: base, durationMs: 60_000, status: "out", lossPct,
    protection: 0.9, pureAtLaunch,
  } as (typeof st.expeditions)[number]);
  withRand(0.999, () => engine.advance(st, base + 61_000)); // 0.999 ⇒ no wildcard, deterministic
}

const now = Date.now(); // real clock (per project memory: never mock time)

console.log("— 0 · new-game defaults (V4 + §8) —");
const st0 = engine.newGame("AckTest", "watchers", now);
check("acknowledgedOnce false at birth", st0.acknowledgedOnce === false);
check("counters all zero at birth", st0.revelationCounters.cleanRecoveries === 0 && st0.revelationCounters.zeroCorruptionSurvivals === 0 && st0.revelationCounters.deepCleanLandings === 0);
check("hunts false", st0.revelationHunts === false);
check("revelations empty", st0.revelations.length === 0 && st0.revelationsResolved.length === 0);
check("contributionScore starts 0", engine.contributionScore(st0) === 0);

console.log("— 1 · counters increment ONLY via the specified actions —");
const st = engine.newGame("AckTest", "watchers", now);
const c = st.revelationCounters;
let base = now + 10_000;
runExpedition(st, "outer-ruins", 0, true, base); base += 70_000; // clean #1
runExpedition(st, "outer-ruins", 0, true, base); base += 70_000; // clean #2
runExpedition(st, "outer-ruins", 0, true, base); base += 70_000; // clean #3
check("3 clean recoveries", c.cleanRecoveries === 3, `=${c.cleanRecoveries}`);
check("clean streak 3", c.cleanStreak === 3, `=${c.cleanStreak}`);
check("no deep landings yet", c.deepCleanLandings === 0);
check("3 zero-corruption survivals (pure at launch)", c.zeroCorruptionSurvivals === 3, `=${c.zeroCorruptionSurvivals}`);
check("unpure clean run NOT counted as zero-survival", (() => {
  // same clean geometry, but launched while corruption > 0
  const stP = engine.newGame("notpure", "watchers", now);
  stP.corruption = 5;
  runExpedition(stP, "outer-ruins", 0, false, now + 10_000);
  return stP.revelationCounters.cleanRecoveries === 1 && stP.revelationCounters.zeroCorruptionSurvivals === 0;
})());
// tainted run: radiation loss on a deep site
runExpedition(st, "quantum-facility", 100, true, base); base += 70_000;
check("tainted run breaks the clean streak", c.cleanStreak === 0, `=${c.cleanStreak}`);
check("tainted run does NOT add cleanRecoveries", c.cleanRecoveries === 3, `=${c.cleanRecoveries}`);
check("tainted run does NOT add zeroCorruptionSurvivals", c.zeroCorruptionSurvivals === 3);
check("tainted run sets lastCorruptionDay (untouched-day bookkeeping)", typeof c.lastCorruptionDay === "string");
check("untouchedDayStreak still 0 after taint", c.untouchedDayStreak === 0);
// clean deep run
runExpedition(st, "quantum-facility", 0, true, base); base += 70_000;
check("4 clean recoveries", c.cleanRecoveries === 4);
check("1 deep clean landing (rad>=60 site)", c.deepCleanLandings === 1, `=${c.deepCleanLandings}`);
check("5 completed expeditions total", st.completedExpeditions === 5);
// deeds stream: first_clean(2) + deep_clean(2) + five_expeditions(3) = 7
check("codicesEarnedByDeeds = 7 from deeds only", c.codicesEarnedByDeeds === 7, `=${c.codicesEarnedByDeeds}`);
// advancing with NOTHING happening changes no counter
const before = JSON.stringify(c);
engine.advance(st, base + 5_000_000);
check("offline advance changes no counter", before === JSON.stringify(c));
// maxDomainDepth only via deployProgram
const stDep = engine.newGame("deploy", "watchers", now);
stDep.resources.embers = 10_000;
stDep.resources.supplies = 10_000;
stDep.insight = 10_000;
for (let i = 0; i < 5; i++) engine.deployProgram(stDep, "weaponry", now + 1000 + i * 1000);
check("maxDomainDepth=5 after five deploys", stDep.revelationCounters.maxDomainDepth === 5, `=${stDep.revelationCounters.maxDomainDepth}`);
const stNodep = engine.newGame("nodeploy", "watchers", now);
engine.advance(stNodep, now + 5_000_000);
check("maxDomainDepth stays 0 without deploys", stNodep.revelationCounters.maxDomainDepth === 0);

console.log("— 2 · stage1 fires exactly once at 12 clean / 15 zero-survivals —");
const st2 = engine.newGame("stage1", "watchers", now);
st2.revelationCounters.cleanRecoveries = 11;
st2.revelationCounters.zeroCorruptionSurvivals = 15;
engine.advance(st2, now + 60_000);
check("11/15 does NOT fire stage1", typeof st2.revelationFirstOpenAt !== "number");
check("no Chronicle line yet", st2.log.filter((m) => m.includes("a page no machine wrote")).length === 0);
check("rv1 not visible", !engine.visibleRevelations(st2).includes("rv1") && !st2.revelations.includes("rv1"));
st2.revelationCounters.cleanRecoveries = 12;
engine.advance(st2, now + 120_000);
check("12/15 fires stage1", typeof st2.revelationFirstOpenAt === "number");
check("rv1 now visible + publicly shipped", st2.revelations.includes("rv1") && engine.revelationAvailable(st2, "rv1"));
check("exactly ONE Chronicle beat", st2.log.filter((m) => m.includes("a page no machine wrote")).length === 1);
const firstStamp = st2.revelationFirstOpenAt;
engine.advance(st2, now + 180_000);
engine.advance(st2, now + 240_000);
check("re-advancing does not re-fire (idempotent)", st2.revelationFirstOpenAt === firstStamp && st2.log.filter((m) => m.includes("a page no machine wrote")).length === 1);
check("rv2 NOT visible until rv1 resolves", !st2.revelations.includes("rv2"));
check("stage2 alone doesn't show anything extra", engine.visibleRevelations(st2).join(",") === "rv1");

console.log("— 3 · chain order rv1 → rv2 → rv3 (with §8 ack gate) —");
const st3 = engine.newGame("chain", "watchers", now);
st3.revelationCounters.cleanRecoveries = 12;
st3.revelationCounters.zeroCorruptionSurvivals = 15;
st3.codices = 500;
st3.resources.embers = 50;
st3.resources.supplies = 500;
st3.insight = 500;
engine.advance(st3, now + 1000);
const ld = st3.leaders[0];
// rv1 researchable → resolve it
check("rv1 researchable after stage1", engine.revelationAvailable(st3, "rv1"));
let r = engine.beginRevelation(st3, "rv1", ld.id, now + 2000);
check("beginRevelation rv1 ok", r.ok === true, r.error || "");
engine.advance(st3, now + 2000 + (st3.researchJobs.find((j) => j.techId === "rv1")?.durationMs || 0) + 500);
check("rv1 resolved", engine.hasRevelation(st3, "rv1"));
check("rv1 payoff: corruption mult 0.85", st3.revelationCorruptionGainMult === 0.85 && engine.corruptionMult(st3) === 0.85 * 1);
check("rv1 payoff: +0.5/min soul drain", st3.revelationDrainPerMin === 0.5);
check("hunts now true", st3.revelationHunts === true);
check("rv2 now visible", st3.revelations.includes("rv2") && engine.revelationAvailable(st3, "rv2"));
check("rv2 Chronicle line present", st3.log.some((m) => m.includes("The page was written before the machines")));
// rv2 researchable → resolve it
r = engine.beginRevelation(st3, "rv2", ld.id, now + 5000);
check("beginRevelation rv2 ok", r.ok === true, r.error || "");
engine.advance(st3, now + 5000 + (st3.researchJobs.find((j) => j.techId === "rv2")?.durationMs || 0) + 500);
check("rv2 resolved", engine.hasRevelation(st3, "rv2"));
// §8: rv3 must NOT be visible despite stage3-countable progress, until acknowledgedOnce
st3.revelationCounters.maxDomainDepth = 5;
st3.revelationCounters.codicesEarnedByDeeds = 20;
ld.xp = 450; ld.specialization = "scholar"; // L3-specialized (scholar)
engine.advance(st3, now + 9000);
check("stage3 counters hold", engine.revelationStage3(st3) === true);
check("ack still false", st3.acknowledgedOnce === false);
check("rv3 HIDDEN without acknowledgement (owner §8)", !st3.revelations.includes("rv3") && !engine.visibleRevelations(st3).includes("rv3") && !engine.revelationAvailable(st3, "rv3"));
check("beginRevelation rv3 refuses without ack (withheld visibility)", (() => {
  const stNo = engine.newGame("noack", "watchers", now);
  stNo.codices = 100; // costs satisfied — the refusal must come from visibility
  stNo.revelationFirstOpenAt = now;
  stNo.revelationsResolved.push("rv1", "rv2");
  stNo.revelations.push("rv1", "rv2"); // server-side visible array has NO rv3 yet
  const rr = engine.beginRevelation(stNo, "rv3", stNo.leaders[0].id, now + 1000);
  return rr.ok === false && /Nothing answers/.test(rr.error || "");
})());
// now the world acknowledges the colony (contribution score 100)
st3.completedExpeditions = 50; // 50*2 = 100
check("score hits exactly 100", engine.contributionScore(st3) === 100);
engine.advance(st3, now + 10_000);
check("acknowledgedOnce latches true at score 100", st3.acknowledgedOnce === true);
check("rv3 THEN visible (stage3 + ack)", st3.revelations.includes("rv3") && engine.revelationAvailable(st3, "rv3") && engine.visibleRevelations(st3).includes("rv3"));
// permanence: even if the inputs were later removed, the ack stays latched
st3.completedExpeditions = 0; st3.deedsCompleted = []; st3.totalCodicesEarned = 0; st3.techsResearched = [];
engine.advance(st3, now + 11_000);
check("ack is permanent once set", st3.acknowledgedOnce === true);

console.log("— 4 · the normal-order reconcile fix (rv2 resolves BEFORE stage3/ack) —");
const st4 = engine.newGame("late", "watchers", now);
st4.revelationCounters.cleanRecoveries = 12;
st4.revelationCounters.zeroCorruptionSurvivals = 15;
st4.codices = 500;
engine.advance(st4, now + 1000);
engine.beginRevelation(st4, "rv1", st4.leaders[0].id, now + 2000);
engine.advance(st4, now + 2000 + 30_000_000); // rv1 done (5min)
engine.beginRevelation(st4, "rv2", st4.leaders[0].id, now + 30_100_000);
engine.advance(st4, now + 30_100_000 + 40_000_000); // rv2 done (10min), NO stage3 yet
check("rv2 resolved before stage3", engine.hasRevelation(st4, "rv2") && !engine.revelationStage3(st4));
check("rv3 not pushed at rv2-resolve (stage3 missing)", !st4.revelations.includes("rv3"));
// stage3 arrives LATER (AI path grinding) — reconcile must then publish rv3
st4.revelationCounters.maxDomainDepth = 5;
st4.revelationCounters.codicesEarnedByDeeds = 20;
st4.leaders[0].xp = 450; st4.leaders[0].specialization = "steward";
st4.completedExpeditions = 50;
engine.advance(st4, now + 70_200_000);
check("reconcile publishes rv3 once BOTH gates flip late", st4.revelations.includes("rv3") && engine.revelationAvailable(st4, "rv3"));
check("ack also latched", st4.acknowledgedOnce === true);

console.log("— 5 · rv2 one-shot benign bias consumes + clears —");
const st5 = engine.newGame("bias", "watchers", now);
check("no bias without rv2", engine.applyRevelationBias(st5, "lost") === "lost");
st5.revelationsResolved.push("rv2");
const c5 = st5.revelationCounters;
c5.oneTimeWildcardBiasUsed = false;
check("bias shifts lost→mauled once", engine.applyRevelationBias(st5, "lost") === "mauled");
check("flag consumed", c5.oneTimeWildcardBiasUsed === true);
check("second surprise NOT shifted", engine.applyRevelationBias(st5, "mauled") === "mauled");
check("null surprise never consumes", (() => {
  const s = engine.newGame("bias2", "watchers", now);
  s.revelationsResolved.push("rv2");
  s.revelationCounters.oneTimeWildcardBiasUsed = false;
  const out = engine.applyRevelationBias(s, null);
  return out === null && s.revelationCounters.oneTimeWildcardBiasUsed === false;
})());

console.log("— 6 · rv3 one-time modal choice: fires once, different Chronicle lines —");
const st6 = engine.newGame("choice", "watchers", now);
st6.revelationsResolved.push("rv3");
st6.codices = 100;
const cr = engine.chooseRevelation(st6, "sealed", now + 5000);
check("sealed choice ok", cr.ok === true, cr.error || "");
check("sealed → chorusMult 0.75 (watched differently)", st6.revelationChorusMult === 0.75);
check("sealed Chronicle line", st6.log.some((m) => m.includes("sealed in bone")));
check("second choice rejected (once per game)", engine.chooseRevelation(st6, "open", now + 6000).ok === false);
const st6b = engine.newGame("choice2", "watchers", now);
st6b.revelationsResolved.push("rv3");
const cr2 = engine.chooseRevelation(st6b, "open", now + 5000);
check("open choice ok", cr2.ok === true);
check("open → chorusMult unchanged", st6b.revelationChorusMult === 1);
check("open Chronicle line", st6b.log.some((m) => m.includes("left open")));
check("chooseRevelation refuses before rv3", (() => {
  const s = engine.newGame("pre", "watchers", now);
  return engine.chooseRevelation(s, "sealed", now + 1000).ok === false;
})());

console.log("— 7 · hunt multipliers apply —");
// attention decay halves while revelationHunts (0.3 → 0.15 per minute)
const stA = engine.newGame("decayA", "watchers", now);
stA.chorusAttention = 50;
engine.advance(stA, now + 600_000); // 10 min idle
const stB = engine.newGame("decayB", "watchers", now);
stB.chorusAttention = 50;
stB.revelationHunts = true;
engine.advance(stB, now + 600_000);
check("normal decay ≈3.0 over 10min", Math.abs(stA.chorusAttention - 47.0) < 0.02, `=${stA.chorusAttention}`);
check("hunt decay ≈1.5 over 10min (−50%)", Math.abs(stB.chorusAttention - 48.5) < 0.05, `=${stB.chorusAttention} (normal=${stA.chorusAttention})`);
// deep-zone chorusRisk +50% on rad>=60 sites while hunting.
// chorusGain = zone.chorusRisk * 100 * chorusResist(1.2 for watchers) * weaponryShield(1)
//            * chorusMult(1) * huntHeat(1 or 1.5). The advance() also decays
//            attention (0.3 or 0.15 per min) — remove that to read the gain.
function deepGain(hunt: boolean): number {
  const s = engine.newGame("deep", "watchers", now);
  s.revelationHunts = hunt;
  s.corruption = 0;
  s.expeditions.push({ id: "x", zoneId: "quantum-facility", label: "q", assignedScientists: 2, suppliesCost: 10, startedAt: now, durationMs: 60_000, status: "out", lossPct: 0, protection: 0.9, pureAtLaunch: true } as (typeof s.expeditions)[number]);
  withRand(0.999, () => engine.advance(s, now + 61_000));
  const decay = (hunt ? 0.15 : 0.3) * (61_000 / 60_000);
  return s.chorusAttention + decay;
}
const gBase = deepGain(false), gHunt = deepGain(true);
check("deep zone does attract attention (base > 0)", gBase > 0, `=${gBase}`);
check("deep chorus gain ratio ≈1.5 hunt/base (+50%)", Math.abs(gHunt / gBase - 1.5) < 0.01, `${gHunt}/${gBase}=${gHunt / gBase}`);

console.log("— 8 · silence discipline: the client payload NEVER leaks the track —");
const st8 = engine.newGame("leak", "watchers", now);
st8.revelationCounters.cleanRecoveries = 12;
st8.revelationCounters.zeroCorruptionSurvivals = 15;
st8.revelationCounters.deepCleanLandings = 6;
st8.revelationCounters.maxDomainDepth = 5;
st8.revelationCounters.codicesEarnedByDeeds = 20;
st8.revelationCounters.untouchedDayStreak = 3;
st8.revelationCounters.cleanStreak = 2;
st8.acknowledgedOnce = true;
st8.revelationFirstOpenAt = now;
st8.revelationHunts = true;
st8.revelationChoice = "sealed";
st8.revelationCorruptionGainMult = 0.85;
st8.revelationDrainPerMin = 0.5;
st8.revelationChorusMult = 0.75;
st8.revelationsResolved.push("rv1", "rv2");
st8.revelations.push("rv1", "rv2", "rv3");
st8.leaders[0].xp = 450; st8.leaders[0].specialization = "marshal"; // L3 so stage3 holds
const payload = publicState(st8) as unknown as Record<string, unknown>;
const payloadStr = JSON.stringify(payload);
// Design-shipped PUBLIC fields (always present, always filtered): revelations,
// revelationsResolved (resolved subset), revelationAnswered, revelationHunts
// (constant false). Everything else must never appear.
const forbidden = ["revelationCounters", "acknowledgedOnce", "revelationFirstOpenAt", "revelationChoice", "revelationCorruptionGainMult", "revelationDrainPerMin", "revelationChorusMult", "cleanRecoveries", "zeroCorruptionSurvivals", "deepCleanLandings", "codicesEarnedByDeeds", "maxDomainDepth", "untouchedDayStreak", "cleanStreak", "oneTimeWildcardBiasUsed"];
for (const k of forbidden) check(`payload has no "${k}"`, !payloadStr.includes(`"${k}"`));
check("payload revelations = intersection with visible", JSON.stringify(payload.revelations) === JSON.stringify(["rv1", "rv2", "rv3"]));
check("payload revelationAnswered = true (choice recorded)", payload.revelationAnswered === true);
// §8 no-leak: server-side state may HOLd rv3, but a not-yet-acknowledged
// colony's payload still never ships it.
const st8c = engine.newGame("leak3", "watchers", now);
st8c.revelationCounters.maxDomainDepth = 5;
st8c.revelationCounters.codicesEarnedByDeeds = 20;
st8c.leaders[0].xp = 450; st8c.leaders[0].specialization = "scholar";
st8c.revelationsResolved.push("rv1", "rv2");
st8c.revelations.push("rv1", "rv2", "rv3"); // server-side visible array already contains rv3
st8c.revelationFirstOpenAt = now;
check("stage3 holds but ack=false", engine.revelationStage3(st8c) && st8c.acknowledgedOnce === false);
const payloadC = publicState(st8c);
check("§8: payload omits rv3 while ack=false (+ no acknowledgedOnce)", JSON.stringify(payloadC.revelations) === JSON.stringify(["rv1", "rv2"]) && !JSON.stringify(payloadC).includes("acknowledgedOnce"));
// a never-unlocked colony ships an empty set — no branch, no stray glyph
const st8b = engine.newGame("leak2", "watchers", now);
const payloadB = publicState(st8b);
check("un-unlocked payload ships empty revelations only", Array.isArray(payloadB.revelations) && payloadB.revelations.length === 0 && payloadB.revelationsResolved.length === 0);
check("un-unlocked payload still ships NO counters", !JSON.stringify(payloadB).includes("revelationCounters") && !JSON.stringify(payloadB).includes("acknowledgedOnce"));
// §8a — the NEW public recognition surface (contribution leaderboard) must be
// leak-free the same way: it ships ONLY rank/colony identity/score, no raw
// state, no acknowledgedOnce, no revelation field of any kind.
{
  st8.gameId = "g-leak"; st8c.gameId = "g-leak3"; st8b.gameId = "g-leak2";
  const view = contributionPublicView(st8, [st8, st8c, st8b]);
  const vJson = JSON.stringify(view);
  check("contribution view leaks no acknowledgedOnce/revelation field", !vJson.includes("acknowledged") && !vJson.includes("revelation"));
  check("contribution view top-level keys = leaders,me,total", Object.keys(view).sort().join(",") === "leaders,me,total");
  check("contribution row keys = colonyName,race,rank,score", Object.keys(view.leaders[0]).sort().join(",") === "colonyName,race,rank,score");
  check("contribution view ships no raw state (no currency/log/resources)", !vJson.includes("\"currency\"") && !vJson.includes("\"resources\"") && !vJson.includes("\"log\""));
  check("contribution ranks dense from 1", view.leaders.every((l, i) => l.rank === i + 1) && view.total === 3);
}

console.log("— 9 · V3-era save migration (no revelation fields) —");
const st9 = engine.newGame("old", "watchers", now) as unknown as Record<string, unknown>;
delete st9.revelationCounters; delete st9.revelations; delete st9.revelationsResolved;
delete st9.revelationHunts; delete st9.revelationFirstOpenAt; delete st9.revelationChoice;
delete st9.revelationCorruptionGainMult; delete st9.revelationDrainPerMin; delete st9.revelationChorusMult;
delete st9.acknowledgedOnce;
let threw = false;
try { engine.advance(st9 as unknown as GameState, now + 5000); } catch (e) { threw = true; console.log("  THREW", e); }
check("old save advances with zero errors", !threw);
const st9s = st9 as unknown as GameState;
check("migrates ack=false", st9s.acknowledgedOnce === false);
check("migrates zeroed counters", st9s.revelationCounters.cleanRecoveries === 0 && st9s.revelationCounters.maxDomainDepth === 0);
check("migrates empty arrays + no hunt", st9s.revelations.length === 0 && st9s.revelationsResolved.length === 0 && st9s.revelationHunts === false);
check("reward mults neutral", st9s.revelationCorruptionGainMult === 1 && st9s.revelationDrainPerMin === 0 && st9s.revelationChorusMult === 1);

console.log("— 10 · no-regression smoke (research / breakthrough / deploy / expedition) —");
const stR = engine.newGame("smoke", "watchers", now);
stR.codices = 100; stR.resources.embers = 500; stR.resources.supplies = 500; stR.insight = 500;
stR.scientists = 3;
const ldr = stR.leaders[0];
let rr = engine.beginResearch(stR, "w1", ldr.id, now + 1000);
check("beginResearch ok", rr.ok === true, rr.error || "");
engine.advance(stR, now + 1000 + (stR.researchJobs.find((j) => j.techId === "w1")?.durationMs || 0) + 500);
check("w1 researched (tech path intact)", stR.techsResearched.includes("w1"));
check("leader gained XP", (stR.leaders.find((l) => l.id === ldr.id)?.xp || 0) > 0);
stR.resources.embers = 2000;
for (let i = 0; i < 3; i++) engine.deployProgram(stR, "economy", now + 3000 + i * 1000);
check("deployProgram ok, depth 3", stR.deployedDomains.economy === 3);
check("expedition loop exercised fine (§1 ran 5 resolves)", st.completedExpeditions === 5);
check("untouched-day streak grows on a clean day", (() => {
  const s = engine.newGame("streak", "watchers", now);
  s.revelationCounters.lastCorruptionDay = "2000-01-01"; // in the ancient past
  engine.advance(s, now + 1000);
  const after = s.revelationCounters.untouchedDayStreak;
  engine.advance(s, now + 2000); // same day again
  return after === 1 && s.revelationCounters.untouchedDayStreak === 1;
})());

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);