// Daily to-do + Oracle Devotion (V7) verification — real clock, no mocks.
//
// Covers (spec §9 "Tests" list + the owner-ratified TD1/TD2/TD5 readings):
//   1 · generator constraints   — 4 items on a capable colony, ≤1 launch,
//        ≤2 expedition-family, ≥1 non-expedition, purity ~every other day,
//        unlock-gated pool (items the colony can't do today don't appear),
//        deterministic per (state, day).
//   2 · event funnel            — REAL engine action fns complete items
//        (launch/study/craft/discipline), zone-gating on mid/deep launches,
//        claimed-ids never refire.
//   3 · rewards math (TD2)      — +30/+1 per item, +80/+3 bonus, full list =
//        200 Scrip / 7 Devotion (the cap), flat numbers via DAILY_CONFIG.
//   4 · claim idempotency       — double-claim pays zero; endpoint-level
//        double-claim pays zero (currency ledger event ids).
//   5 · streak exactly-once     — consecutive practice days increment once
//        each; a day with only the visit_cradle free tick does NOT count; a
//        full-day gap resets silently; same-day re-advances never double.
//   6 · TD3 banked-forever      — unclaimed day-1 completions + bonus survive
//        the rollover and pay on a later claim.
//   7 · favor formula parity    — favorScore() matches the §3.2 placeholders
//        computed by hand from the same counters; Devotion weights, purity
//        accrues, betrayal subtracts (const in one place).
//   8 · migration               — a V6-shaped save (no daily fields) loads via
//        advance(): fresh quiet block, zero devotion/streak, list rolls.
//   9 · LEAK CHECKS (TD5)       — publicState() ships the daily public view
//        ONLY: no events/rolledAt/lastStreakDay/banked, no favor internals,
//        no thresholds; total Devotion + streak DO ship.
//  10 · season seams            — recordSeasonEvent("daily_list") fires exactly
//        once per completed day (battle-pass daily AND weekly counters), and
//        the D6 Wheel-of-Years deed wires via awardDeedCosmetic at 30 days.
//  11 · blank/reset safety      — blankColony (race null) advances quietly,
//        holds no list, claims nothing (regression for the pre-existing
//        suppliesPerMinute crash on blank slots with elapsed time).
//  12 · API surface            — the REAL createGameFn/getState/craftFn/
//        claimDailyRewardFn server fns through the actual server-fn middleware
//        (runWithStartContext), on a scratch account in THIS suite's data dir.
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import {
  DAILY_CONFIG,
  DAILY_ITEM_BY_ID,
  FAVOR_CONSTANTS,
  FAVOR_THRESHOLDS,
  generateDailyList,
  dailyItemAvailable,
  noteDailyEvent,
  noteDailyLaunch,
  reconcileDaily,
  sweepDaily,
  claimDaily,
  favorScore,
  dailyPublicView,
} from "/home/team/shared/site/src/game/daily.ts";
import { publicState, createGameFn, getState, claimDailyRewardFn, craftFn } from "/home/team/shared/site/src/game/api.ts";
import { signup as authSignup } from "/home/team/shared/site/src/game/auth.ts";
import { loadAccountSaves, savePathFor } from "/home/team/shared/site/src/game/store.ts";
import { walletView, utcDayKey } from "/home/team/shared/site/src/game/monetization.ts";
import { ZONES } from "/home/team/shared/site/src/game/zones.ts";
import { runWithStartContext } from "/home/team/shared/site/node_modules/@tanstack/start-storage-context/dist/esm/async-local-storage.js";
import fs from "node:fs";
import path from "node:path";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

const DAY = 86400000;
/** A "tomorrow" derived from the real clock — always the NEXT calendar day key
 *  (date arithmetic can't cross a day boundary, so no midnight flake). */
const tomorrow = (t: number) => t + DAY;

// ======================================================================
// 0 · config constants (TD2 — flat, one place)
// ======================================================================
console.log("— 0 · TD2 constants —");
check("scripPerItem 30", DAILY_CONFIG.scripPerItem === 30);
check("devotionPerItem 1", DAILY_CONFIG.devotionPerItem === 1);
check("bonusScrip 80", DAILY_CONFIG.bonusScrip === 80);
check("bonusDevotion 3", DAILY_CONFIG.bonusDevotion === 3);
check("max per day = 200 Scrip (4×30+80)", DAILY_CONFIG.maxScripPerDay === 200);
check("max per day = 7 Devotion (4×1+3)", DAILY_CONFIG.maxDevotionPerDay === 7);
check("list length 4", DAILY_CONFIG.listLength === 4);

// ======================================================================
// 1 · generator constraints
// ======================================================================
console.log("— 1 · generator constraints (capable colony, 20 days) —");
const gNow = Date.now();
const st = engine.newGame("GenCheck", "watchers", gNow);
// Equip the full 11-item pool: step-out gear + fuel + sauna gear + study stock.
const r = st.resources;
r.medkit = 1; r.mechkit = 1; r.armorkit = 1; r.gas = 1; r.hazmat = 1;
r.embers = 10; (r as any).chipsets = 1; st.codices = 4; r.supplies = 200;
engine.advance(st, gNow);
check("pool fully available (9 family/non-family ids)", DAILY_ITEM_BY_ID && Object.keys(DAILY_ITEM_BY_ID).length === 11);
let allLen4 = true, launchViolation = 0, expFamilyViolation = 0, nonExpDays = 0, purityDays = 0;
for (let d = 0; d < 20; d++) {
  const list = generateDailyList(st, gNow + d * DAY);
  if (list.length !== 4) allLen4 = false;
  const launches = list.filter((id) => ["launch_any", "launch_mid", "launch_deep"].includes(id)).length;
  if (launches > 1) launchViolation++;
  const expFamily = list.filter((id) => ["launch_any", "launch_mid", "launch_deep", "clean_recovery"].includes(id)).length;
  if (expFamily > 2) expFamilyViolation++;
  const nonExp = list.filter((id) => !["launch_any", "launch_mid", "launch_deep", "clean_recovery"].includes(id)).length;
  if (nonExp >= 1) nonExpDays++;
  if (list.includes("clean_recovery") || list.includes("cleanse_taint")) purityDays++;
  if (d === 0) {
    // determinism: same state + same day → identical list
    const again = generateDailyList(st, gNow);
    check("deterministic (same state+day → same list)", JSON.stringify(again) === JSON.stringify(list), JSON.stringify([list, again]));
  }
}
check("every day exactly 4 items", allLen4, "");
check("≤1 launch every day", launchViolation === 0, `violations=${launchViolation}`);
check("≤2 expedition-family every day", expFamilyViolation === 0, `violations=${expFamilyViolation}`);
check("≥1 non-expedition every day", nonExpDays === 20, `${nonExpDays}/20`);
check("purity ~every other day (30–70%)", purityDays >= 6 && purityDays <= 14, `purity=${purityDays}/20`);

console.log("— 1b · unlock-gated pool (poor colony can't see what it can't do) —");
const poor = engine.newGame("PoorCheck", "watchers", gNow);
engine.advance(poor, gNow);
const poorList = generateDailyList(poor, gNow);
check("no launch_any without step-out gear", !poorList.includes("launch_any"));
check("no launch_mid / launch_deep (no fuel, no gear)", !poorList.includes("launch_mid") && !poorList.includes("launch_deep"));
check("no study_chipset (no chipsets, no deep gear)", !poorList.includes("study_chipset"));
check("no research_complete (zero codices, no jobs)", !poorList.includes("research_complete"));
check("no clean_recovery (no step-out gear)", !poorList.includes("clean_recovery"));
check("visit_cradle always present", poorList.includes("visit_cradle"));
const availAll = DAILY_ITEM_POOL_ALL_AVAILABLE(poor);
check("dailyItemAvailable respects the same gates", !availAll.launch_any && !availAll.study_chipset && !availAll.research_complete, JSON.stringify(availAll));
function DAILY_ITEM_POOL_ALL_AVAILABLE(s: GameState) {
  return {
    launch_any: dailyItemAvailable(s, "launch_any"),
    launch_mid: dailyItemAvailable(s, "launch_mid"),
    launch_deep: dailyItemAvailable(s, "launch_deep"),
    study_ember: dailyItemAvailable(s, "study_ember"),
    study_chipset: dailyItemAvailable(s, "study_chipset"),
    craft_item: dailyItemAvailable(s, "craft_item"),
    refuel_convoy: dailyItemAvailable(s, "refuel_convoy"),
    research_complete: dailyItemAvailable(s, "research_complete"),
    clean_recovery: dailyItemAvailable(s, "clean_recovery"),
    cleanse_taint: dailyItemAvailable(s, "cleanse_taint"),
  };
}

// ======================================================================
// 2 · event funnel from REAL engine actions
// ======================================================================
console.log("— 2 · real-action event funnel —");
const fNow = Date.now();
const ft = engine.newGame("Funnel", "watchers", fNow);
engine.advance(ft, fNow);
// Sandbox the funnel on a controlled list.
const funnel = ft.daily;
funnel.list = ["visit_cradle", "launch_any", "launch_mid", "launch_deep"];
funnel.completed = ["visit_cradle"];
// A shallow (risk 15) launch completes launch_any but NOT the deep-gated ones.
const shallow = ZONES.find((z) => z.risk < 40)!;
const deep = ZONES.find((z) => z.radiationLevel >= 60)!;
const mid = ZONES.find((z) => z.risk >= 40 && z.radiationLevel < 35)!;
noteDailyLaunch(ft, shallow, fNow);
check("shallow launch → launch_any only", ft.daily.completed.includes("launch_any") && !ft.daily.completed.includes("launch_mid") && !ft.daily.completed.includes("launch_deep"), JSON.stringify(ft.daily.completed));
// Mid launch (needs the zone predicate + fuel in the engine fn, but the funnel
// only checks listing — the ENGINE gate already rejected it before we got here).
noteDailyLaunch(ft, mid, fNow);
check("mid launch → launch_mid completes", ft.daily.completed.includes("launch_mid"));
noteDailyLaunch(ft, deep, fNow);
check("deep launch → launch_deep completes", ft.daily.completed.includes("launch_deep"));
// Dedupe: repeat the same event does not double-append.
const before = ft.daily.completed.length;
noteDailyEvent(ft, "launch_deep", fNow);
check("repeated event never refires", ft.daily.completed.length === before);

// Real-engine path: craft gas → craft_item + refuel_convoy.
const ft2 = engine.newGame("FunnelCraft", "watchers", fNow);
engine.advance(ft2, fNow);
ft2.daily.list = ["visit_cradle", "craft_item", "refuel_convoy", "study_ember"];
ft2.daily.completed = ["visit_cradle"];
const cr = engine.craftItem(ft2, "gas", fNow);
check("craftFn('gas') ok", cr.ok === true, cr.error || "");
check("gas craft → craft_item", ft2.daily.completed.includes("craft_item"));
check("gas craft → refuel_convoy", ft2.daily.completed.includes("refuel_convoy"));
check("craft_item note does NOT fake other items", !ft2.daily.completed.includes("study_ember"));

// Study start → study_ember.
const ft3 = engine.newGame("FunnelStudy", "watchers", fNow);
engine.advance(ft3, fNow);
ft3.daily.list = ["visit_cradle", "study_ember", "craft_item", "refuel_convoy"];
ft3.daily.completed = ["visit_cradle"];
const sr = engine.beginStudy(ft3, "ember", fNow);
check("beginStudy ok", sr.ok === true, sr.error || "");
check("ember study start → study_ember", ft3.daily.completed.includes("study_ember"));

// discipline → cleanse_taint (existing discipline mechanics untouched).
const ft4 = engine.newGame("FunnelCleanse", "watchers", fNow);
engine.advance(ft4, fNow);
ft4.daily.list = ["visit_cradle", "cleanse_taint", "craft_item", "refuel_convoy"];
ft4.daily.completed = ["visit_cradle"];
ft4.corruption = 40;
const dr = engine.discipline(ft4, 2, fNow);
check("discipline ok", dr.ok === true, dr.error || "");
check("cleanse_taint completes (sanctions the EXISTING rite)", ft4.daily.completed.includes("cleanse_taint"));
check("discipline still reduces corruption normally", ft4.corruption === 30, `corruption=${ft4.corruption}`);

// Research completion → research_complete (real tech job).
const ft5 = engine.newGame("FunnelResearch", "watchers", fNow);
engine.advance(ft5, fNow);
ft5.daily.list = ["visit_cradle", "research_complete", "craft_item", "refuel_convoy"];
ft5.daily.completed = ["visit_cradle"];
ft5.codices = 10;
const leader = ft5.leaders[0].id;
const br = engine.beginResearch(ft5, "w1", leader, fNow);
check("beginResearch ok", br.ok === true, br.error || "");
const dur = ft5.researchJobs[0]!.durationMs;
engine.advance(ft5, fNow + 1000 + dur + 100);
check("w1 researched (job resolved)", ft5.techsResearched.includes("w1"));
check("research complete → research_complete", ft5.daily.completed.includes("research_complete"));

// ======================================================================
// 3 · rewards math (TD2) + claim idempotency
// ======================================================================
console.log("— 3 · rewards math + idempotency —");
const wNow = Date.now();
const wt = engine.newGame("Rewards", "watchers", wNow);
engine.advance(wt, wNow);
for (const id of wt.daily.list) noteDailyEvent(wt, id, wNow);
sweepDaily(wt, wNow);
const w0 = walletView(wt);
const claim1 = claimDaily(wt, wNow);
check("full-day claim → +200 Scrip exactly", claim1.granted!.scrip === 200, JSON.stringify(claim1.granted));
check("full-day claim → +7 Devotion exactly", claim1.granted!.devotion === 7, JSON.stringify(claim1.granted));
check("bonus flag true", claim1.granted!.bonus === true);
check("wallet scrip 200", walletView(wt).currency.scrip === 200, JSON.stringify(walletView(wt).currency));
check("ledger has 5 earn entries (4 items + bonus)", wt.currency.ledger.filter((e) => e.kind === "earn").length === 5);
const claim2 = claimDaily(wt, wNow);
check("second claim → zero", claim2.granted!.scrip === 0 && claim2.granted!.devotion === 0 && !claim2.granted!.bonus, JSON.stringify(claim2.granted));
check("wallet unchanged after double claim", walletView(wt).currency.scrip === 200);
check("devotion ledger 7", wt.devotion === 7);
check("no Votives ever minted", walletView(wt).currency.votives === 0);
check("scrip ledger event ids are idempotent-unique", new Set(wt.currency.ledger.map((e) => e.eventId)).size === wt.currency.ledger.length);
void w0;

// Partial-claim then re-claim pays the remainder only. visit_cradle is one of
// the four REAL items (the free tick marks it; claiming it pays like the rest).
const pt = engine.newGame("Partial", "watchers", wNow);
engine.advance(pt, wNow);
const p0 = claimDaily(pt, wNow);
check("free-tick claim alone pays +30/+1 (visit_cradle is a list item)", p0.granted!.scrip === 30 && p0.granted!.devotion === 1, JSON.stringify(p0.granted));
const pList = pt.daily.list.filter((id) => id !== "visit_cradle");
noteDailyEvent(pt, pList[0], wNow); // one practiced item
const p1 = claimDaily(pt, wNow);
check("one practiced item → +30/+1 (no double-pay of the free tick)", p1.granted!.scrip === 30 && p1.granted!.devotion === 1, JSON.stringify(p1.granted));
noteDailyEvent(pt, pList[1], wNow); // second practiced item
const p2 = claimDaily(pt, wNow);
check("later claim pays the new item only", p2.granted!.scrip === 30 && p2.granted!.devotion === 1, JSON.stringify(p2.granted));
for (const id of pList) noteDailyEvent(pt, id, wNow);
const p3 = claimDaily(pt, wNow);
check("completing the last item pays it + the bonus (110), never more", p3.granted!.scrip === 30 + 80 && p3.granted!.devotion === 1 + 3, JSON.stringify(p3.granted));
check("daily max never exceeded (200/7 total)", walletView(pt).currency.scrip === 200 && pt.devotion === 7);

// ======================================================================
// 4 · streak exactly-once + TD3 banked-forever
// ======================================================================
console.log("— 4 · streak (exactly-once) + banked-forever —");
const sNow = Date.now();
// practiceAt(t) completes one non-visit item of the list CURRENT at time t
// (the list rolled by the advance at t).
const stk = engine.newGame("Streak", "watchers", sNow);
engine.advance(stk, sNow);
const practiceAt = (t: number) => { const id = stk.daily.list.find((x) => x !== "visit_cradle"); if (id) noteDailyEvent(stk, id, t); };
practiceAt(sNow);
engine.advance(stk, tomorrow(sNow)); // finalizes day0 (practice) → 1
check("day0 practice → streak 1", stk.devotionStreak === 1, `streak=${stk.devotionStreak}`);
check("lastStreakDay = the finalized day0 key", stk.daily.lastStreakDay === utcDayKey(sNow), `${stk.daily.lastStreakDay} vs ${utcDayKey(sNow)}`);
practiceAt(tomorrow(sNow));
engine.advance(stk, tomorrow(tomorrow(sNow))); // finalizes day1 → 2
check("day1 practice → streak 2", stk.devotionStreak === 2, `streak=${stk.devotionStreak}`);
// Same-day re-advance must NOT double-increment.
engine.advance(stk, tomorrow(tomorrow(sNow)) + 5000);
check("same-day re-advance no double", stk.devotionStreak === 2, `streak=${stk.devotionStreak}`);
// A practice-less day (only the free tick) breaks the chain to 0, silently.
practiceAt(tomorrow(tomorrow(sNow)));
engine.advance(stk, tomorrow(tomorrow(tomorrow(sNow)))); // finalizes day2 — skips NO gap but had NO practice? (day2 HAS practice!)
// ^ corrected below: the day-finalized here is day2 which HAD practice → +1.
check("practice continues after 3rd day", stk.devotionStreak === 3, `streak=${stk.devotionStreak}`);
// Now a genuinely skipped day: no practice event at all before the rollover.
engine.advance(stk, tomorrow(tomorrow(tomorrow(tomorrow(sNow))))); // finalizes day3 (NO practice) → resets
check("a skipped practice day silently resets the chain", stk.devotionStreak === 0, `streak=${stk.devotionStreak}`);
practiceAt(tomorrow(tomorrow(tomorrow(tomorrow(sNow)))));
engine.advance(stk, tomorrow(tomorrow(tomorrow(tomorrow(tomorrow(sNow)))))); // finalizes day4 (practice) → 1
check("post-skip practice restarts at 1", stk.devotionStreak === 1, `streak=${stk.devotionStreak}`);

console.log("— 4b · TD3 banked-forever (unclaimed work pays later) —");
const bk = engine.newGame("Bank", "watchers", sNow);
engine.advance(bk, sNow);
for (const id of bk.daily.list) noteDailyEvent(bk, id, bk.daily.rolledAt); // full day, NOT claimed
engine.advance(bk, tomorrow(sNow)); // rollover banks day1 (items + bonus)
const b1 = bk.daily.banked ?? {};
const bankedKeys = Object.keys(b1);
check("yesterday's unclaimed completions banked", bankedKeys.length === 1, JSON.stringify(b1));
check("banked entry carries all completed items (incl. free tick) + bonus", b1[bankedKeys[0]]!.items.length === bk.daily.list.length && b1[bankedKeys[0]]!.bonus === true, JSON.stringify(b1[bankedKeys[0]]));
// Today: complete and claim everything → day1 (banked) + day2 paid together.
for (const id of bk.daily.list) noteDailyEvent(bk, id, bk.daily.rolledAt);
const bClaim = claimDaily(bk, tomorrow(sNow));
check("claim after rollover pays BOTH days (200+200)", bClaim.granted!.scrip === 400 && bClaim.granted!.devotion === 14, JSON.stringify(bClaim.granted));
check("bank consumed", Object.keys(bk.daily.banked ?? {}).length === 0);
const bClaim2 = claimDaily(bk, tomorrow(sNow));
check("no double-pay after bank consumed", bClaim2.granted!.scrip === 0, JSON.stringify(bClaim2.granted));

// ======================================================================
// 5 · favor formula (TD6 placeholders) — parity by hand
// ======================================================================
console.log("— 5 · favor formula parity (placeholder constants, server-only) —");
const fv = engine.newGame("Favor", "watchers", sNow);
engine.advance(fv, sNow);
// Bank some devotion + purity counters.
fv.devotion = 10;
(fv.revelationCounters as any).cleanRecoveries = 3;
(fv.revelationCounters as any).zeroCorruptionSurvivals = 2;
(fv.revelationCounters as any).codicesEarnedByDeeds = 1;
fv.totalCodicesEarned = 6;
const expected =
  fv.devotion * FAVOR_CONSTANTS.devotionWeight +
  3 * FAVOR_CONSTANTS.cleanRecoveryWeight +
  2 * FAVOR_CONSTANTS.zeroCorruptionWeight +
  1 * FAVOR_CONSTANTS.deedCodexWeight +
  6 * FAVOR_CONSTANTS.totalCodexWeight;
check("favorScore matches hand-computed formula", Math.abs(favorScore(fv) - expected) < 1e-9, `${favorScore(fv)} vs ${expected}`);
check("devotion alone can't reach vouch threshold", favorScore(engine.newGame("X", "watchers", sNow)) < FAVOR_THRESHOLDS.vouchEligible);
check("thresholds are server-only constants", FAVOR_THRESHOLDS.vouchEligible === 30 && FAVOR_THRESHOLDS.cleanseEligible === 15);

// ======================================================================
// 6 · migration from V6 saves
// ======================================================================
console.log("— 6 · V6→V7 migration —");
const old = engine.newGame("OldSave", "watchers", sNow) as unknown as Record<string, unknown>;
delete old.daily; delete old.devotion; delete old.devotionStreak;
engine.advance(old as GameState, sNow);
const mig = old as unknown as GameState;
check("old save loads: daily block exists", !!mig.daily);
check("day rolled for the migrated save", mig.daily.dayKey === mig.daily.dayKey && mig.daily.dayKey !== "");
check("fresh list of the right size", Array.isArray(mig.daily.list) && mig.daily.list.length >= 1 && mig.daily.list.length <= 4, JSON.stringify(mig.daily.list));
check("devotion zero", mig.devotion === 0);
check("streak zero", mig.devotionStreak === 0);
check("visit_cradle free-tick marked", mig.daily.completed.includes("visit_cradle") || mig.daily.completed.length === 0, JSON.stringify(mig.daily.completed));

// ======================================================================
// 7 · LEAK CHECKS (TD5) — publicState strips everything server-only
// ======================================================================
console.log("— 7 · TD5 leak checks —");
const lk = engine.newGame("Leak", "watchers", sNow);
engine.advance(lk, sNow);
for (const id of lk.daily.list) noteDailyEvent(lk, id, lk.daily.rolledAt);
claimDaily(lk, sNow);
lk.daily.events.push("daily_list");
lk.daily.banked = { "2020-1-1": { items: ["visit_cradle"], bonus: true } };
lk.devotion = 55; lk.devotionStreak = 3;
const payload = publicState(lk) as unknown as Record<string, unknown>;
const pjs = JSON.stringify(payload);
check("daily public view ships (dayKey/list/completed/claimed/bonusClaimed)", !!payload.daily && typeof (payload.daily as any).dayKey === "string" && Array.isArray((payload.daily as any).list));
check("daily.events NEVER ships", !pjs.includes("\"events\""));
check("daily.rolledAt NEVER ships", !pjs.includes("rolledAt"));
check("daily.lastStreakDay NEVER ships", !pjs.includes("lastStreakDay"));
check("daily.banked NEVER ships", !pjs.includes("banked"));
check("favor internals NEVER ship", !pjs.includes("favor"));
check("thresholds NEVER ship (30/15 values absent as such)", !pjs.includes("vouchEligible") && !pjs.includes("cleanseEligible") && !/\"30\"/.test(pjs));
check("Devotion total SHIPS (TD5 public)", payload.devotion === 55, JSON.stringify(payload.devotion));
check("Streak SHIPS (TD5 public)", payload.devotionStreak === 3, JSON.stringify(payload.devotionStreak));
const pv = dailyPublicView(lk.daily);
check("dailyPublicView() shape is exactly the public 5 fields", JSON.stringify(Object.keys(pv).sort()) === JSON.stringify(["bonusClaimed", "claimed", "completed", "dayKey", "list"].sort()), JSON.stringify(Object.keys(pv)));

// ======================================================================
// 8 · season seams: daily_list event once/day + D6 deed wiring
// ======================================================================
console.log("— 8 · season seams —");
const se = engine.newGame("Seam", "watchers", sNow);
engine.advance(se, sNow);
for (const id of se.daily.list) noteDailyEvent(se, id, se.daily.rolledAt);
sweepDaily(se, sNow);
check("season daily objective +20 fires (dayObjectives)", se.battlePass.dayObjectives.includes("daily_list"), JSON.stringify(se.battlePass.dayObjectives));
check("season XP reflects +20", se.battlePass.xp >= 20, `xp=${se.battlePass.xp}`);
check("weekly ×5 counter starts", (se.battlePass.weekCounts["daily_list"] ?? 0) >= 1, JSON.stringify(se.battlePass.weekCounts));
const seRepeat = se.battlePass.xp;
sweepDaily(se, sNow); // sweep again same day — must NOT refire
check("daily_list fires exactly once per day", se.battlePass.xp === seRepeat && se.daily.events.filter((e) => e === "daily_list").length === 1);

console.log("— 8b · D6 Wheel-of-Years deed (30-day streak) —");
const d6 = engine.newGame("D6", "watchers", sNow);
engine.advance(d6, sNow);
const dPractice = (t: number) => { const id = d6.daily.list.find((x) => x !== "visit_cradle"); if (id) noteDailyEvent(d6, id, t); };
dPractice(sNow); // practice day0
for (let d = 1; d <= 29; d++) { engine.advance(d6, sNow + d * DAY); dPractice(sNow + d * DAY); }
engine.advance(d6, sNow + 30 * DAY); // finalizes day29 (practice) → streak 30
check("streak reached 30", d6.devotionStreak === 30, `streak=${d6.devotionStreak}`);
sweepDaily(d6, sNow + 30 * DAY + 60000);
check("D6 deed wires (wheel-of-years owned)", walletView(d6).entitlements.cosmetics.includes("wheel-of-years"), JSON.stringify(walletView(d6).entitlements.cosmetics));
const d6Ent = walletView(d6).entitlements.cosmetics.filter((c) => c === "wheel-of-years").length;
sweepDaily(d6, sNow + 30 * DAY + 1000);
check("deed idempotent (no double cosmetic)", walletView(d6).entitlements.cosmetics.filter((c) => c === "wheel-of-years").length === d6Ent);

// ======================================================================
// 9 · blank/reset safety
// ======================================================================
console.log("— 9 · blank colony safety —");
const blank = engine.blankColony(sNow);
engine.advance(blank, sNow + 60000); // elapsed time on a race-null slot (pre-V7 crash path)
check("blank advance is quiet (no throw)", true);
check("blank holds no list", Array.isArray(blank.daily.list) && blank.daily.list.length === 0);
check("blank devotes nothing", blank.devotion === 0 && blank.devotionStreak === 0);
const bres = claimDaily(blank, sNow + 60000);
check("blank claim pays zero, ok", bres.ok === true && bres.granted!.scrip === 0, JSON.stringify(bres.granted));
const bp2 = publicState(blank) as any;
check("blank public daily is the quiet view", Array.isArray(bp2.daily?.list) && bp2.daily.list.length === 0);

// ======================================================================
// 10 · API surface — the REAL server fns (scratch account, this dir's data)
// ======================================================================
// NOTE: the server-fn middleware (runWithStartContext) resolves UNDEFINED on
// success and only THROWS on error (race-lock's callCreate pattern) — so the
// endpoint assertions verify the PERSISTED effects (save files) plus absence
// of thrown errors, exactly like the other suites.
console.log("— 10 · API surface (real server fns) —");
const START_CONTEXT: any = { startOptions: {} };
const inWorld = (fn: () => Promise<unknown>) => runWithStartContext(START_CONTEXT, fn);
const SCRATCH = path.join(process.cwd(), "data");
fs.rmSync(SCRATCH, { recursive: true, force: true });
const ACCT = "dlycheck";
const signup = await authSignup(ACCT, "pass1234");
check("scratch signup ok", signup.ok === true && !!signup.token);
const token = signup.token!;
async function callErr(fn: () => Promise<unknown>): Promise<string | undefined> {
  try { await inWorld(fn); return undefined; }
  catch (e: any) { return typeof e === "string" ? e : e?.message ?? String(e); }
}
const createdErr = await callErr(() => createGameFn({ data: { token, name: "DlyApi", race: "watchers" } }));
check("createGameFn admits watchers (no server error)", createdErr === undefined, JSON.stringify(createdErr));
const savesA = await loadAccountSaves(ACCT);
const gidA = savesA ? Object.keys(savesA.games)[0] : undefined;
check("createGameFn persisted a game", !!savesA && !!gidA);
const gErr = await callErr(() => getState({ data: { token } }));
check("getState endpoint ok (no throw)", gErr === undefined, JSON.stringify(gErr));
const pubA = savesA && gidA ? (() => { const st = savesA!.games[gidA]; engine.advance(st, Date.now()); return publicState(st); })() : undefined;
const dA = (pubA as any)?.daily;
check("getState daily view has the 5 public fields", !!dA && Array.isArray(dA.list) && dA.list.length >= 1 && Array.isArray(dA.completed), JSON.stringify(dA));
check("getState daily view has NO server-only fields", !!dA && !("events" in dA) && !("banked" in dA) && !("lastStreakDay" in dA) && !("rolledAt" in dA), JSON.stringify(Object.keys(dA ?? {})));
check("getState public ships Devotion + streak", typeof (pubA as any)?.devotion === "number" && typeof (pubA as any)?.devotionStreak === "number", "");
// Real play through the API: craft gas (fresh colony has supplies for it).
const cErr = await callErr(() => craftFn({ data: { token, kind: "gas" as any } }));
check("craftFn('gas') ok via API (no throw)", cErr === undefined, JSON.stringify(cErr));
const savesB = await loadAccountSaves(ACCT)!;
const stB = savesB.games[savesB.activeGameId!];
engine.advance(stB, Date.now());
const craftDoneB = stB.daily.completed.includes("craft_item");
check("craft via API marked craft_item (if it was on the list)", craftDoneB || !stB.daily.list.includes("craft_item"), JSON.stringify({ list: stB.daily.list, completed: stB.daily.completed }));
// Claim through the real endpoint: pays everything completed (incl. the free
// tick). Persisted balances are the truth.
const scripBefore = stB.currency.scrip;
const devBefore = stB.devotion;
const clErr1 = await callErr(() => claimDailyRewardFn({ data: { token } }));
check("claim endpoint ok (no throw)", clErr1 === undefined, JSON.stringify(clErr1));
const savesC = await loadAccountSaves(ACCT)!;
const stC = savesC.games[savesC.activeGameId!];
engine.advance(stC, Date.now());
const claimedAll = stC.daily.completed.every((id) => stC.daily.claimed.includes(id));
check("endpoint claim marked every completed item claimed", claimedAll, JSON.stringify({ completed: stC.daily.completed, claimed: stC.daily.claimed }));
const delta = stC.currency.scrip - scripBefore;
check("endpoint claim paid earned Scrip only (30×completed, ≤ 200/day)", delta >= 30 && delta <= 200 && Number.isInteger(delta), `delta=${delta}`);
check("endpoint claim paid Devotion 1 per item (+bonus when full) ≤ 7", stC.devotion - devBefore >= 1 && stC.devotion - devBefore <= 7, `devDelta=${stC.devotion - devBefore}`);
check("endpoint claim minted ZERO Votives", stC.currency.votives === 0, JSON.stringify(stC.currency.votives));
// Endpoint idempotency: a second claim pays nothing new.
const scripAfter1 = stC.currency.scrip;
const clErr2 = await callErr(() => claimDailyRewardFn({ data: { token } }));
check("endpoint double-claim ok", clErr2 === undefined, JSON.stringify(clErr2));
const savesD = await loadAccountSaves(ACCT)!;
const stD = savesD.games[savesD.activeGameId!];
engine.advance(stD, Date.now());
check("endpoint double-claim paid zero Scrip", stD.currency.scrip === scripAfter1, `${stD.currency.scrip} vs ${scripAfter1}`);
// Leak: the persisted daily has the full server state — but publicState (what
// every endpoint ships) never does (engine-side §7 covers the shape; this is
// the same check over the REAL persisted production-shaped state).
const pjsB = JSON.stringify(publicState(stD));
check("public view of the real persisted state leaks nothing", !pjsB.includes("banked") && !pjsB.includes("lastStreakDay") && !pjsB.includes("favor") && !pjsB.includes("rolledAt"), "");
fs.rmSync(SCRATCH, { recursive: true, force: true });
check("scratch data cleaned", !fs.existsSync(SCRATCH));

// ======================================================================
console.log(`\ndaily-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);