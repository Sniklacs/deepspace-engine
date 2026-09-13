// Engine-level verification for the PUBLIC Contribution leaderboard (recognition
// goes visible — precursor to the Server Contribution Award / Emissary seats).
//
// Coverage:
//   1. score formula parity with engine.contributionScore() (no drift)
//   2. leaderboard ordering: score desc; ties by earliest founding (createdAt
//      asc, the documented stand-in for "earliest achievement"), then gameId
//   3. tie handling is fully deterministic
//   4. blank/reset colonies (no race) and no-gameId states are excluded
//   5. contributionPublicView: own rank/score/total, top-10 leaders, own colony
//      always representable (union when not in `all`)
//   6. SILENCE DISCIPLINE: acknowledgedOnce / every revelation field absent
//      from the new public surfaces (view payload + publicState extension)
//   7. real-world data smoke: scoring every saved colony on this server never
//      throws, blank (race-null) colonies are skipped gracefully
//
// Run (pure tests):  cd /home/team/shared/contribution-tests && bun run contribution-verify.ts
// Run (with real-save block): cd /home/team/shared/site && bun /home/team/shared/contribution-tests/contribution-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState, contributionPublicView } from "/home/team/shared/site/src/game/api.ts";
import { loadAllSaves } from "/home/team/shared/site/src/game/store.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
import { existsSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const now = Date.now(); // real clock (per project memory: never mock time)

function colony(name: string, createdAt: number, overrides: Partial<GameState> = {}): GameState {
  const st = engine.newGame(name, "watchers", createdAt);
  st.gameId = "g-" + name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (overrides.completedExpeditions !== undefined) st.completedExpeditions = overrides.completedExpeditions;
  if (overrides.deedsCompleted !== undefined) st.deedsCompleted = overrides.deedsCompleted;
  if (overrides.totalCodicesEarned !== undefined) st.totalCodicesEarned = overrides.totalCodicesEarned;
  if (overrides.techsResearched !== undefined) st.techsResearched = overrides.techsResearched;
  if (overrides.createdAt !== undefined) st.createdAt = overrides.createdAt;
  if (overrides.race !== undefined) st.race = overrides.race;
  if (overrides.gameId !== undefined) st.gameId = overrides.gameId;
  return st;
}

console.log("— 1 · score formula parity (no drift against contributionScore) —");
{
  // exps*2 + deeds*10 + codices*1 + techs*5
  const a = colony("A", now, { completedExpeditions: 5, deedsCompleted: ["d1", "d2"], totalCodicesEarned: 12, techsResearched: ["t1"] });
  check("hand-computed = contributionScore (5*2+2*10+12+1*5 = 47)", engine.contributionScore(a) === 47, `=${engine.contributionScore(a)}`);
  const b = colony("B", now, { completedExpeditions: 0, deedsCompleted: [], totalCodicesEarned: 0, techsResearched: [] });
  check("fresh colony scores 0", engine.contributionScore(b) === 0, `=${engine.contributionScore(b)}`);
  const c = colony("C", now, { completedExpeditions: 50, deedsCompleted: [], totalCodicesEarned: 0, techsResearched: [] });
  check("expeditions-only colony 50*2=100", engine.contributionScore(c) === 100, `=${engine.contributionScore(c)}`);
  // interplay: ranking uses the SAME function result (no separate formula)
  const entries = engine.contributionRanking([b, a, c]);
  check("ranking scores equal contributionScore per colony",
    entries[0].score === 100 && entries[1].score === 47 && entries[2].score === 0,
    JSON.stringify(entries.map((e) => e.score)));
  check("ranking carries colony identity through", entries[1].colonyName === "A" && entries[0].gameId === "g-c");
  // real-gameplay parity: a resolved expedition adds exactly 2 (through advance)
  const st = engine.newGame("Grow", "watchers", now);
  st.resources.supplies = 500;
  st.resources.medkit = 1; st.resources.mechkit = 1; st.resources.armorkit = 1; // step-out gear
  const before = engine.contributionScore(st);
  st.expeditions.push({
    id: "exp-1", zoneId: "outer-ruins", label: "outer-ruins", assignedScientists: 1,
    suppliesCost: 10, startedAt: now, durationMs: 10_000, status: "out", lossPct: 0, protection: 0.9,
  } as (typeof st.expeditions)[number]);
  engine.advance(st, now + 60_000);
  check("advance resolved the expedition (completedExpeditions grew by 1)", st.completedExpeditions === 1, `=${st.completedExpeditions}`);
  // completing a mission may ALSO award the D1 deed (deeds weigh 10) — the score
  // must simply equal the formula over the post-gameplay state (no drift).
  const after = engine.contributionScore(st);
  const recomputed = st.completedExpeditions * 2 + (st.deedsCompleted?.length ?? 0) * 10 + st.totalCodicesEarned + (st.techsResearched?.length ?? 0) * 5;
  check("post-gameplay score still equals the formula (no drift)", after === recomputed && after > 0, `=${after} v ${recomputed}`);
}

console.log("— 2 · leaderboard ordering: score desc —");
{
  const s1 = colony("One", now, { completedExpeditions: 5 });          // 10
  const s2 = colony("Two", now, { completedExpeditions: 10 });         // 20
  const s3 = colony("Three", now, { completedExpeditions: 30 });       // 60
  const s4 = colony("Four", now, { completedExpeditions: 2, techsResearched: ["t"] }); // 9
  const rank = engine.contributionRanking([s1, s2, s3, s4]).map((e) => e.colonyName);
  check("desc by score", JSON.stringify(rank) === JSON.stringify(["Three", "Two", "One", "Four"]), JSON.stringify(rank));
}

console.log("— 3 · ties: earliest founding wins, then gameId (deterministic) —");
{
  const t1 = colony("Same", 1_000, { completedExpeditions: 10 }); // 20
  const t2 = colony("Same", 2_000, { completedExpeditions: 10 }); // 20
  const t3 = colony("Same", 3_000, { completedExpeditions: 10 }); // 20
  const r1 = engine.contributionRanking([t3, t1, t2]);
  check("earliest createdAt ranks first on equal score", r1[0].colonyName === "Same" && r1[0].createdAt === 1_000 && r1[2].createdAt === 3_000, JSON.stringify(r1.map((e) => e.createdAt)));
  // two colonies with same score AND same createdAt → gameId asc breaks the tie
  const x1 = colony("X1", 5_000, { completedExpeditions: 10, gameId: "g-xb" });
  const x2 = colony("X2", 5_000, { completedExpeditions: 10, gameId: "g-xa" });
  const r2 = engine.contributionRanking([x1, x2]);
  check("same score+createdAt → gameId asc, deterministic", r2[0].gameId === "g-xa" && r2[1].gameId === "g-xb", JSON.stringify(r2.map((e) => e.gameId)));
  const r3 = engine.contributionRanking([x2, x1]);
  check("ordering identical regardless of input order", r3[0].gameId === r2[0].gameId && r3[1].gameId === r2[1].gameId);
  // ranks in the view are dense 1..N (ties fully resolved → unique ranks)
  const v = contributionPublicView(null, [t1, t2, t3, x1, x2]);
  const ranks = v.leaders.map((l) => l.rank);
  check("unique dense ranks from 1", JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4, 5]), JSON.stringify(ranks));
}

console.log("— 4 · blank/reset colonies and no-gameId states are excluded —");
{
  const blank = colony("Blank", now, { race: null });
  const noId = engine.newGame("NoId", "watchers", now);
  noId.gameId = "";
  const real = colony("Real", now, { completedExpeditions: 3 });
  const rank = engine.contributionRanking([blank, noId, real]);
  check("only the real colony ranks", rank.length === 1 && rank[0].colonyName === "Real", JSON.stringify(rank));
  const v = contributionPublicView(null, [blank, noId, real]);
  check("view total counts only ranking colonies", v.total === 1 && v.leaders.length === 1);
  check("own colony with null race → me null", contributionPublicView(blank, [real]).me === null);
}

console.log("— 5 · contributionPublicView: me + top-10 leaders + union —");
{
  const all: GameState[] = [];
  for (let i = 0; i < 12; i++) {
    all.push(colony(`Col${i}`, 10_000 + i * 100, { completedExpeditions: i + 1 }));
  }
  const own = all[5]; // score 12, rank far from top... (scores 2..24)
  const v = contributionPublicView(own, all);
  check("leaders capped at top 10", v.leaders.length === 10, `=${v.leaders.length}`);
  check("leaders sorted with ranks 1..10", v.leaders[0].rank === 1 && v.leaders[9].rank === 10 && v.leaders[0].score >= v.leaders[9].score);
  check("me found: rank/score/total consistent", v.me !== null && v.me.score === 12 && v.me.total === 12 && v.me.rank === 12 - 6 + 1, JSON.stringify(v.me));
  check("me rank matches leaders positions where applicable", v.leaders[v.me!.rank - 1]?.score === v.me!.score || v.me!.rank > 10);
  // own NOT in `all` (e.g. fresh colony) → still representable
  const stranger = colony("Stranger", 9_999_999, { completedExpeditions: 200 }); // score 400 → rank 1
  const v2 = contributionPublicView(stranger, all);
  check("own outside `all` is united in with rank 1", v2.me !== null && v2.me.rank === 1 && v2.me.score === 400 && v2.total === 13, JSON.stringify(v2.me));
  check("union keeps leaders at 10 with correct top", v2.leaders[0].colonyName === "Stranger" && v2.leaders.length === 10);
  // me=null when own absent entirely
  const v3 = contributionPublicView(null, all);
  check("me null when own is null", v3.me === null && v3.total === 12);
}

console.log("— 6 · silence discipline: acknowledgedOnce & the revelation track stay server-only —");
{
  // What the CONTRIBUTION surface must never contain (it ships no revelation
  // field at all — not even the public-placeholder hunt flag or the visible set).
  const CONTRIBUTION_FORBIDDEN = [
    "acknowledgedOnce", "revelationCounters", "revelationFirstOpenAt", "revelationChoice",
    "revelationCorruptionGainMult", "revelationDrainPerMin", "revelationChorusMult",
    "revelationHunts", "revelationsResolved", "revelations", "revelationAnswered",
    "cleanRecoveries", "zeroCorruptionSurvivals", "deepCleanLandings",
    "codicesEarnedByDeeds", "maxDomainDepth", "untouchedDayStreak", "cleanStreak",
    "oneTimeWildcardBiasUsed",
  ];
  // What the STATE payload must not leak (matches the existing §8 list — the
  // deliberate public placeholders revelationHunts/revelationsResolved are NOT
  // on it; see api.publicState()).
  const STATE_FORBIDDEN = [
    "acknowledgedOnce", "revelationCounters", "revelationFirstOpenAt", "revelationChoice",
    "revelationCorruptionGainMult", "revelationDrainPerMin", "revelationChorusMult",
    "cleanRecoveries", "zeroCorruptionSurvivals", "deepCleanLandings",
    "codicesEarnedByDeeds", "maxDomainDepth", "untouchedDayStreak", "cleanStreak",
    "oneTimeWildcardBiasUsed",
  ];
  // a fully-evolved colony: ack latched + counters populated + hunt on
  const st = colony("LeakCheck", now, { completedExpeditions: 60, deedsCompleted: ["d1"], techsResearched: ["t1", "t2"] });
  st.acknowledgedOnce = true;
  st.revelationHunts = true;
  st.revelationCounters.cleanRecoveries = 40;
  st.revelationCounters.zeroCorruptionSurvivals = 20;
  st.revelationCounters.deepCleanLandings = 8;
  st.revelationCounters.codicesEarnedByDeeds = 25;
  st.revelationCounters.maxDomainDepth = 6;
  st.revelationFirstOpenAt = 123;
  st.revelationChoice = "open";
  st.revelationCorruptionGainMult = 0.85;
  st.revelationDrainPerMin = 0.5;
  st.revelationChorusMult = 0.75;
  st.revelationsResolved = ["rv1", "rv2", "rv3"];
  // (a) the contribution VIEW (the getContributionFn payload shape)
  const view = contributionPublicView(st, [st, colony("Other", now, { completedExpeditions: 1 })]);
  const viewJson = JSON.stringify(view);
  check("view JSON ships no gameId/account/accountId/key",
    !viewJson.includes("gameId") && !viewJson.includes("account"));
  const leaked = CONTRIBUTION_FORBIDDEN.filter((k) => viewJson.includes(`"${k}"`));
  check("contribution view leaks NO forbidden field", leaked.length === 0, `leaked: ${leaked.join(",")}`);
  check("view does not even contain the word acknowledged", !viewJson.includes("acknowledged"));
  check("view has exactly the allowed top-level keys", Object.keys(view).sort().join() === "leaders,me,total");
  const rowKeys = JSON.stringify(Object.keys(view.leaders[0]).sort());
  check("leader row keys = rank,colonyName,race,score only", rowKeys === '["colonyName","race","rank","score"]', rowKeys);
  const meKeys = JSON.stringify(Object.keys(view.me!).sort());
  check("me keys = rank,colonyName,score,total only", meKeys === '["colonyName","rank","score","total"]', meKeys);
  // (b) the REAL publicState still strips everything (extended leak check)
  const payload = publicState(st) as unknown as Record<string, unknown>;
  const payloadStr = JSON.stringify(payload);
  const leaked2 = STATE_FORBIDDEN.filter((k) => payloadStr.includes(`"${k}"`));
  check("publicState still leaks NO forbidden field (ack latched + hunt on)", leaked2.length === 0, `leaked: ${leaked2.join(",")}`);
  check("publicState keeps the PUBLIC rv3-answered marker", payload.revelationAnswered === true);
  check("publicState keeps public wallet view", typeof payload.currency === "object" && payload.currency !== null);
}

console.log("— 7 · real-world data smoke (skips if cwd has no data/saves) —");
{
  if (!existsSync("data/saves")) {
    console.log("  ⏭  no data/saves under cwd — real-save block skipped (run from /home/team/shared/site for it)");
  } else {
    let scored = 0, skippedBlank = 0, failed = 0;
    const all: GameState[] = [];
    for (const { saves } of await loadAllSaves()) {
      for (const gid in saves.games) {
        const g = saves.games[gid];
        if (!g || typeof g !== "object" || !g.race || !g.gameId) { skippedBlank++; continue; }
        try {
          const clone = JSON.parse(JSON.stringify(g)) as GameState;
          const adv = engine.advance(clone, Date.now());
          if (typeof engine.contributionScore(adv) !== "number") throw new Error("score not a number");
          all.push(adv);
          scored++;
        } catch (e: any) { failed++; console.log("  FAIL colony", gid, e.message); }
      }
    }
    check("every colonized save scores without throwing (0 failures)", failed === 0, `${failed} failed`);
    check("real world has >= 7 ranked colonies", scored >= 7, `scored=${scored}`);
    check("blank race-null slots skipped, not crashed", skippedBlank >= 1, `skippedBlank=${skippedBlank}`);
    const ranked = engine.contributionRanking(all);
    check("real ranking is sorted desc with dense ranks", ranked.every((e, i) => (i === 0 || ranked[i - 1].score >= e.score) && ranked.length === scored));
    const v = contributionPublicView(all[0], all);
    check("real view has me + leaders + total consistent", v.me !== null && v.total === scored && v.leaders.length === Math.min(10, scored));
    check("real view never ships a nice little acknowledgedOnce", !JSON.stringify(v).includes("acknowledged"));
  }
}

console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);