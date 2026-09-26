// ACT I ENTRY VERIFICATION — The Fall, Step 3 slice 3: making the height
// REACHABLE and its first battle PLAYABLE (opening-prologue-spec §3 Act I,
// §4 the full-power state, §9 Step 2 the prologue wrapper, §12.1 "the tutorial
// is Act I's first battle").
//
// The gap this slice closes: prologueEngine.prologueState() existed and was
// tested but nothing called it; createBattle() had no caller outside its own
// module; so no player could ever see a battle. This harness is the contract
// for the entry that fixes that:
//
//   1 · ONE LIVE BATTLE      — the height seeds EXACTLY ONE battle on the real
//        engine, with an open decision window (the rout-risk edge window the
//        engine stamps for the weaker side), a live clock, a state chip, both
//        committed forces and the odds line — all engine output, no stubs.
//   2 · NORMAL COLONIES SAFE — a colony that is not at the height seeds nothing
//        (`state.battles = []` keeps meaning "nothing on your fronts"), and
//        advance() on such a save still creates none.
//   3 · PERSISTENCE          — the battle survives a REAL store round-trip (the
//        fs backend store.ts uses when the DB is not configured) and ADVANCES
//        across it (lazy-advance): same id, same startedAt, the clock moves,
//        a pre-reload order stays recorded, and it resolves exactly once.
//   4 · IDEMPOTENT           — entering twice never stacks a seed or a second
//        front; a resolved front stays in the ledger and the next entry opens
//        a fresh one.
//   5 · NO PURCHASE SURFACE  — no wallet/store vocabulary is reachable from the
//        entry or the seeder; balances ride through untouched; the storefront
//        is still off.
//   6 · REACHABLE + NARRATED — the entry route and the in-game exit exist and
//        are wired to the server functions; the tutorial cue machine (which
//        observes the public battle view) lights up on this front BY ITSELF —
//        its contract is unchanged, `ourSide` already resolves it.
//
// Run:  cd /home/team/shared/prologue-tests && env -u DATABASE_URL bun run act1-entry-verify.ts
// The store round-trip needs `env -u DATABASE_URL` (filesystem backend) and
// runs in a throwaway temp dir, so it never touches the real saves.
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import { prologueState, resolveCataclysm, resetToCradle } from "/home/team/shared/site/src/game/prologue/prologue-engine.ts";
import {
  ACT1_CONFIG,
  ACT1_ENGINE,
  act1Forces,
  act1LiveBattle,
  act1Squad,
  act1Weapons,
  isAct1Battle,
  msUntilFirstWindow,
  openAct1Front,
  seedAct1Battle,
  snapshotHero,
} from "/home/team/shared/site/src/game/prologue/act1-battle.ts";
import {
  PROLOGUE_CONFIG,
  PROLOGUE_SQUAD,
} from "/home/team/shared/site/src/game/prologue/prologue-state.ts";
import {
  BATTLES_CONFIG,
  type Battle,
} from "/home/team/shared/site/src/game/war/war-types.ts";
import {
  battleMoment,
  battleEndAt,
  computeForcePower,
  issueDecision,
  windowsForView,
} from "/home/team/shared/site/src/game/war/battle-engine.ts";
import { ourSide } from "/home/team/shared/site/src/game/battle-decisions.ts";
import {
  activeCue,
  advanceTutorial,
  cueSequenceFor,
  freshTutorialState,
  freshWatch,
  guideTierFor,
  observeBattle,
} from "/home/team/shared/site/src/game/war/tutorial-cues.ts";
import { MONETIZATION_CONFIG } from "/home/team/shared/site/src/game/monetization.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}
const T0 = 1_700_000_000_000; // fixed epoch: every seed below is deterministic
/** A save standing at the height, on the Act I slot — what an entry produces. */
function heightState(now = T0): GameState {
  const st = prologueState(now, ACT1_CONFIG.race);
  st.gameId = ACT1_CONFIG.gameId;
  return st;
}
function read(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}
// ===========================================================================
section("1 · THE SEED OPENS ONE LIVE BATTLE — on the real engine, with an open window");
// ===========================================================================
const st = heightState();
const battle = seedAct1Battle(st, T0);
const live = battle as Battle;
check("seeding the height opens exactly one battle", st.battles.length === 1 && !!live);
check("the battle is the Act I front", isAct1Battle(live) && live.zoneId === ACT1_CONFIG.frontId && live.zoneName === ACT1_CONFIG.frontName);
check("the front is live (active, unresolved, null result)", live.status === "active" && live.result === null);
check("act1LiveBattle finds it; nothing else in the slot is an Act I front", act1LiveBattle(st) === live);
check("the colony is the DEFENDER at the Ashline", live.defender.side === "defender");
check("our side is the player's own colony (id + name)", live.defender.colonyId === st.gameId && live.defender.colonyName === st.playerName && st.playerName === PROLOGUE_CONFIG.heightColonyName);
check("the attacker is the Chorus", live.attacker.colonyName === ACT1_CONFIG.chorusName && live.attacker.colonyId === ACT1_CONFIG.chorusColonyId);
check("our squad IS the seed's own squad, in order", live.defender.heroSquad.map((h) => h.id).join(",") === PROLOGUE_SQUAD.join(","));
check("the whole squad reads L10 (the height's level, flattened off xp)", live.defender.heroSquad.every((h) => h.level === PROLOGUE_CONFIG.maxLevel));
check("the squad carries its skills into the fight", live.defender.heroSquad.some((h) => h.skills.length > 0));
check("our kits are every built family at its own tier (4 at the height)", live.defender.weapons.length === 5 && live.defender.weapons.every((k) => k.tier === PROLOGUE_CONFIG.armoryTierAtHeight));
check("our FOB is the seed's Citadel (stage 4)", live.defender.fobStage === PROLOGUE_CONFIG.fobStageAtHeight);
check("our committed troops are a vanguard under the FOB's field ceiling", live.defender.troops === ACT1_CONFIG.ourTroops && live.defender.troops <= BATTLES_CONFIG.fobTroopCapByStage[4]);
check("the reserve behind us is the seed's war supply", st.warReserve.troops === PROLOGUE_CONFIG.warReserveTroops && st.warReserve.energy === PROLOGUE_CONFIG.warReserveEnergy);
check("the Chorus brings the same five roles as cells, ids that are NOT our heroes'", live.attacker.heroSquad.length === live.defender.heroSquad.length && live.attacker.heroSquad.every((c) => !live.defender.heroSquad.some((h) => h.id === c.id)) && live.attacker.heroSquad.map((c) => c.role).join(",") === live.defender.heroSquad.map((h) => h.role).join(","));
check("the Chorus's power is engine-computed, not declared", live.forcePower.attacker === computeForcePower(live.attacker) && live.forcePower.defender === computeForcePower(live.defender));
const m0 = battleMoment(live, T0);
check("the fight is a REAL fight: a real power gap", m0.gap > 0 && m0.gap < 1);
check("the chip is engine-derived and reads rout-risk (the §12.3 pummeling)", m0.chip === "rout-risk" && m0.gap >= ACT1_ENGINE.edgeWindowGap);
check("the odds line is shown, not hidden (0..1, ours is the underdog)", m0.attackerWinProb > 0.5 && m0.attackerWinProb < 0.95);
check("the odds line moves with the grind (deterministic, time-revealed)", battleMoment(live, T0 + live.durationMs / 2).attackerWinProb > m0.attackerWinProb);
check("the duration is the engine's curve, inside its clamp", live.durationMs === battleMoment(live, T0).remainingMs && live.durationMs >= ACT1_ENGINE.minDurationMs && live.durationMs <= ACT1_ENGINE.maxDurationMs);
check("casualties are committed up front and bounded by the troops present", live.casualties.attacker > 0 && live.casualties.defender > 0 && live.casualties.defender <= live.defender.troops && live.casualties.attacker <= live.attacker.troops);
check("no window is open at the whistle (the engine opens them at milestones)", windowsForView(live, T0).filter((w) => w.open).length === 0);
check("the first window is the engine's edge window, 30s after the whistle", msUntilFirstWindow(live, T0) === BATTLES_CONFIG.edgeWindowDelayMs);
const wOpen = windowsForView(live, T0 + 31_000).filter((w) => w.open);
check("exactly ONE window is open a moment later — and it is OURS", wOpen.length === 1 && wOpen[0].side === "defender" && wOpen[0].kind === "edge");
check("that window has a live clock (opens/closes inside the battle)", wOpen[0].opensAt === T0 + BATTLES_CONFIG.edgeWindowDelayMs && wOpen[0].closesAt - wOpen[0].opensAt >= ACT1_ENGINE.windowMinMs && wOpen[0].closesAt - wOpen[0].opensAt <= ACT1_ENGINE.windowMaxMs);
check("our side of the fight is resolved by the shipped helper (state identity)", ourSide(live, { colonyId: st.gameId ?? "", colonyName: st.playerName }) === "defender");
check("the whole schedule is deterministic (both sides, 3 milestones each)", live.windows.length === 7 && live.windows.filter((w) => w.kind === "milestone").length === 6);
check("the front is written into the Chronicle", st.log.some((l) => l.includes(ACT1_CONFIG.frontName)));
// the first order lands, and it CHANGES the fight (no fake progress bars)
const oursBefore = live.forcePower.defender;
const res = issueDecision(live, "defender", wOpen[0].id, "reinforce", T0 + 31_000, { reserveHeroIds: [], reserveTroops: st.warReserve.troops, energy: st.warReserve.energy }, { heroes: [], troops: ACT1_CONFIG.ourTroops });
const m1 = battleMoment(live, T0 + 32_000);
check("an order is accepted by the engine in that window", res.ok === true);
check("the order's power is engine-stamped and visible", res.ok && (res as { decision: { effects: { kind: string; powerAdded?: number } } }).decision.effects.kind === "reinforce" && live.forcePower.defender === oursBefore + 120);
check("one full reinforcement CHIPS the rout-risk back to pressing (§12.3: survivable)", m1.gap < ACT1_ENGINE.edgeWindowGap && m1.chip === "pressing");
check("the casualties re-price honestly when we feed the fight (more troops, more toll)", live.casualties.defender > m0.casualties.defender);
check("the window is consumed by the order (one order per window per side)", windowsForView(live, T0 + 32_000).filter((w) => w.open).length === 0);
// determinism: same inputs → same battle, always
const st2 = heightState();
const b2 = seedAct1Battle(st2, T0) as Battle;
const st4 = heightState();
const b4 = seedAct1Battle(st4, T0) as Battle;
check("the seed is deterministic (same now, same input → byte-identical battle)", JSON.stringify(b2) === JSON.stringify(b4));
check("the seeded battle's composition is reproducible field by field", JSON.stringify(b2.windows) === JSON.stringify(b4.windows) && JSON.stringify(b2.forcePower) === JSON.stringify(b4.forcePower) && JSON.stringify(b2.casualties) === JSON.stringify(b4.casualties) && b2.durationMs === b4.durationMs);
const st3 = heightState(T0 + 60_000);
const b3 = seedAct1Battle(st3, T0 + 60_000) as Battle;
check("a later entry stamps a later battle (time is the only input that moves)", b3.id !== b2.id && b3.startedAt === T0 + 60_000);
const act1Src = read("/home/team/shared/site/src/game/prologue/act1-battle.ts");
const act1Code = act1Src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
check("no Math.random reachable in the seeder", !act1Code.includes("Math.random"));
check("no wall-clock read in the seeder (time arrives as `now`)", !act1Code.includes("Date.now") && !act1Code.includes("new Date"));
check("the seeder drives the SHIPPED engine (createBattle + openBattle)", act1Code.includes("createBattle(") && act1Code.includes("openBattle(") && act1Code.includes('from "../war/battle-engine"'));
check("the decision engine stays unaware of Act I (no prologue/act1 import in it)", !/from "[^"]*prologue/.test(read("/home/team/shared/site/src/game/war/battle-engine.ts")) && !read("/home/team/shared/site/src/game/war/battle-engine.ts").includes("ACT1_CONFIG"));
// ===========================================================================
section("2 · NORMAL COLONIES STILL GET NO BATTLES — `state.battles = []` keeps its meaning");
// ===========================================================================
const normal = engine.newGame("Cradle Nine", ACT1_CONFIG.race, T0);
check("a brand-new colony carries no battles and no Act I front", (normal.battles ?? []).length === 0 && act1LiveBattle(normal) === null);
check("seeding a brand-new colony is a no-op", seedAct1Battle(normal, T0) === null && normal.battles.length === 0);
check("a brand-new colony has no Act I forces at all", act1Forces(normal) === null);
const advanced = engine.advance(normal, T0 + 6 * 60 * 60_000);
check("advance() over six offline hours still invents no battle", (advanced.battles ?? []).length === 0 && (advanced.battleReports ?? []).length === 0);
const rebuilt = heightState();
rebuilt.prologue!.stage = "rebuilt";
check("a rebuilt (post-Wake) colony seeds nothing", seedAct1Battle(rebuilt, T0) === null && (rebuilt.battles ?? []).length === 0);
const fallen = heightState();
resolveCataclysm(fallen, "names", T0 + 1000);
check("a FALLEN colony seeds nothing (the cataclysm clears the front)", fallen.prologue!.stage === "fallen" && seedAct1Battle(fallen, T0) === null && fallen.battles.length === 0);
check("the cataclysm's clean slate is the seed's own contract, untouched by this slice", fallen.battleReports.length === 0 && fallen.warReserve.troops === 0);
const woken = resetToCradle(fallen, T0 + 2000);
check("the Wake hands back a colony that also seeds nothing", seedAct1Battle(woken, T0) === null && (woken.battles ?? []).length === 0);
check("only the height has Act I forces", act1Forces(heightState()) !== null && act1Forces(woken) === null && act1Forces(fallen) === null);
check("the Wake keeps the sealed roster but opens no front (memory, not an army)", act1Squad(woken).length === PROLOGUE_SQUAD.length && act1Weapons(woken).length === 0 && (woken.battles ?? []).length === 0);
// ===========================================================================
section("3 · PERSISTENCE — the battle survives a real save/load and ADVANCES across it");
// ===========================================================================
const scratch = mkdtempSync(path.join(tmpdir(), "act1-entry-"));
process.chdir(scratch);
const store = await import("/home/team/shared/site/src/game/store.ts");
const ACCT = "act1-verify";
const saved = heightState();
const savedBattle = seedAct1Battle(saved, T0) as Battle;
const saves: { games: Record<string, GameState>; activeGameId: string | null } = { games: {}, activeGameId: null };
saves.games[ACT1_CONFIG.gameId] = saved;
saves.activeGameId = ACT1_CONFIG.gameId;
await store.saveAccountSaves(ACCT, saves as never);
const reloaded = await store.loadAccountSaves(ACCT);
check("the store round-trip returns the account's slot", !!reloaded && !!reloaded.games[ACT1_CONFIG.gameId]);
const slot = reloaded!.games[ACT1_CONFIG.gameId];
check("the active slot survives the round-trip", reloaded!.activeGameId === ACT1_CONFIG.gameId);
check("the battle survives the reload with its identity intact", slot.battles.length === 1 && slot.battles[0].id === savedBattle.id && slot.battles[0].startedAt === savedBattle.startedAt && slot.battles[0].durationMs === savedBattle.durationMs);
check("its window schedule survives (same ids, same clock times)", JSON.stringify(slot.battles[0].windows) === JSON.stringify(savedBattle.windows));
check("the prologue block survives the reload (still at the height)", slot.prologue?.stage === "height" && slot.prologue.heroes.length === 8 && slot.prologue.squad.length === 5);
const afterReload = engine.advance(slot, T0 + 5 * 60_000);
const liveAfter = afterReload.battles[0];
check("the reloaded battle ADVANCES — it is not reset by the round-trip", liveAfter.startedAt === savedBattle.startedAt && battleMoment(liveAfter, T0 + 5 * 60_000).elapsedMs === 5 * 60_000);
check("its clock keeps running across the reload (remaining time shrinks)", battleMoment(liveAfter, T0 + 5 * 60_000).remainingMs === savedBattle.durationMs - 5 * 60_000 && battleMoment(liveAfter, T0 + 5 * 60_000).remainingMs < battleMoment(liveAfter, T0).remainingMs);
check("no second battle appears on reload", afterReload.battles.length === 1);
// an order issued before the reload is still recorded after it (lazy-advance discipline)
const orderReload = heightState();
const ob = seedAct1Battle(orderReload, T0) as Battle;
const w = windowsForView(ob, T0 + 31_000).filter((x) => x.open)[0];
const first = issueDecision(ob, "defender", w.id, "hold", T0 + 31_000, { reserveHeroIds: [], reserveTroops: 0, energy: 0 });
check("an order before the reload is recorded", first.ok === true && ob.decisions.length === 1);
const again = issueDecision(ob, "defender", w.id, "reinforce", T0 + 40_000, { reserveHeroIds: [], reserveTroops: 999, energy: 999 }, { heroes: [], troops: 100 });
check("re-issuing that window after a reload is a no-op, never a double order", again.ok === true && !!(again as { duplicate?: boolean }).duplicate && ob.decisions.length === 1);
// resolution is exactly once, and the ledger keeps the dead
const late = engine.advance(slot, T0 + savedBattle.durationMs + 60_000);
check("past its end the battle resolves (one day later, offline — the world kept playing)", late.battles[0].status === "resolved" && !!late.battles[0].result);
check("a resolved battle owns ONE ledger report (idempotent, no double-post)", late.battleReports.filter((r) => r.battleId === savedBattle.id).length === 1);
const twice = engine.advance(late, T0 + savedBattle.durationMs + 120_000);
check("advancing again resolves nothing twice", twice.battleReports.length === late.battleReports.length && twice.battles[0].status === "resolved");
const payload = publicState(late);
check("the public payload ships the battle (and strips the server-only internals)", payload.battles.length === 1 && !("internal" in (payload.battles[0] as object)));
check("the public payload ships the reserve the order buttons read", payload.warReserve.troops > 0 && payload.warReserve.energy > 0);
// ===========================================================================
section("4 · ENTERING IS IDEMPOTENT — twice is the same seat, never two seeds");
// ===========================================================================
const entryA = openAct1Front(null, T0, () => prologueState(T0, ACT1_CONFIG.race));
check("a first entry builds the height and seeds the front", entryA.seeded === true && entryA.state.prologue?.stage === "height" && entryA.state.battles.length === 1);
check("the entry stamps the Act I slot id", entryA.state.gameId === ACT1_CONFIG.gameId);
const entryB = openAct1Front(entryA.state, T0 + 90_000, () => prologueState(T0 + 90_000, ACT1_CONFIG.race));
check("a second entry RESUMES (no new seed)", entryB.seeded === false && entryB.state === entryA.state);
check("entering twice does not duplicate the battle", entryB.state.battles.length === 1);
check("nor restack the seed (start time and identity unchanged)", entryB.state.battles[0].startedAt === T0 && entryB.state.battles[0].id === entryA.state.battles[0].id);
check("nor double-write the Chronicle line", entryB.state.log.filter((l) => l.includes(ACT1_CONFIG.frontName)).length === 1);
const entryC = openAct1Front(entryA.state, T0 + 200_000, () => prologueState(T0 + 200_000, ACT1_CONFIG.race));
check("a third entry is still one battle (idempotent by construction)", entryC.state.battles.length === 1 && entryC.seeded === false);
// a finished front is history, not a dead end
const done = entryA.state;
engine.advance(done, T0 + done.battles[0].durationMs + 1000);
check("the front resolves while the player is away", done.battles[0].status === "resolved" && act1LiveBattle(done) === null);
const entryD = openAct1Front(done, T0 + 4 * 60 * 60_000, () => prologueState(T0, ACT1_CONFIG.race));
check("re-entering after a finished front opens a FRESH front", entryD.state.battles.length === 2 && entryD.state.battles.filter((b) => b.status === "active").length === 1);
check("the finished battle stays in the ledger — with its report", entryD.state.battles[0].status === "resolved" && entryD.state.battleReports.some((r) => r.battleId === entryD.state.battles[0].id));
check("the fresh front is the same front (same zone), a new engagement", isAct1Battle(entryD.state.battles[1]) && entryD.state.battles[1].id !== entryD.state.battles[0].id);
check("resuming a resolved front still does not re-seed over the live one", openAct1Front(entryD.state, T0 + 5 * 60 * 60_000, () => prologueState(T0, ACT1_CONFIG.race)).state.battles.length === 2);
// ===========================================================================
section("5 · REACHABILITY WIRING — the entry route, the exit, and no purchase surface");
// ===========================================================================
const apiSrc = read("/home/team/shared/site/src/game/api.ts");
const fallSrc = read("/home/team/shared/site/src/routes/the-fall.tsx");
const playSrc = read("/home/team/shared/site/src/routes/play.tsx");
const indexSrc = read("/home/team/shared/site/src/routes/index.tsx");
// 2026-09-26 — RE-POINTED. The old form required `leaveActOneFn,\n};`, i.e. that the
// export object ENDED with that name. That is a position pin, not a claim about wiring:
// any later slice appending its own exports (chat A1 appended three) turns this red while
// the entry/exit wiring is untouched. The claim is "both are exported as list entries".
check("the server exports an entry and an exit", apiSrc.includes("const enterActOneFn") && apiSrc.includes("const leaveActOneFn") && /\n\s+enterActOneFn,\n/.test(apiSrc) && /\n\s+leaveActOneFn,\n/.test(apiSrc));
check("the entry handler calls the pure entry core (the same code the harness runs)", apiSrc.includes("openAct1Front(") && apiSrc.includes("prologueState(at, ACT1_CONFIG.race)"));
check("the entry writes the Act I slot through the ordinary save path", apiSrc.includes("saves.games[ACT1_CONFIG.gameId] = st") && apiSrc.includes("saves.activeGameId = ACT1_CONFIG.gameId") && apiSrc.includes("publicState(st)"));
check("the exit hands the account back to a colony of its own", apiSrc.includes("homeId") && apiSrc.includes("saves.activeGameId = homeId"));
check("the exit can never strand a player with no other colony", apiSrc.includes("if (!homeId)"));
check("the Act I slot does not consume a colony slot (MAX_GAMES is about colonies)", apiSrc.includes("filter((id) => id !== ACT1_CONFIG.gameId).length"));
check("the entry route exists and posts the entry", fallSrc.includes('createFileRoute("/the-fall")') && fallSrc.includes("enterActOneFn({ data: { token } })"));
check("the entry route hands off to the game", fallSrc.includes('window.location.assign("/play")'));
check("the landing page links the way in", indexSrc.includes('to="/the-fall"'));
  // Amendment A6 (game-ui-shell-spec §10): the Act I door is now the HOME
  // screen's top plate, not a banner above every tab — gated on the height.
  const cradleSrc = readFileSync("/home/team/shared/site/src/components/screens/CradleScreen.tsx", "utf8");
  // The gate is hoisted into a local (`atHeight`) rather than written inline, so
  // bind the variable name from the stage expression: the plate must still be
  // gated on the height AND be the whole of that gate's branch — `{atHeight ? (`
  // … `<Panel testid="act1-banner">` … `) : null}`.
  const gateVar = /const\s+(\w+)\s*=\s*state\.prologue\?\.stage === "height"/.exec(cradleSrc)?.[1];
  const plateUnderGate = gateVar
    ? new RegExp(
        `\\{${gateVar} \\? \\(\\s*<Panel[\\s\\S]{0,200}?testid="act1-banner"` +
        `[\\s\\S]{0,2000}?data-slot="height-clock"[\\s\\S]{0,2000}?testid="act1-open-front"` +
        `[\\s\\S]{0,2000}?</Panel>\\s*\\) : null\\}`).test(cradleSrc)
    : false;
  check("the game renders the Act I plate only at the height (A6)",
    !!gateVar && plateUnderGate && (cradleSrc.match(/testid="act1-banner"/g) ?? []).length === 1);
check("the way out of the height is a real, server-verified leave (A6)",
  cradleSrc.includes('testid="act1-leave"') &&
  /onClick=\{onLeaveHeight\}/.test(cradleSrc) &&
  playSrc.includes("onLeaveHeight={doLeaveAct1}") &&
  playSrc.includes("leaveActOneFn({ data: { token: token! } })"));
check("the Act I plate opens the front in the shipped Battles view (A6)",
  cradleSrc.includes('testid="act1-open-front"') &&
  /onClick=\{onField\}/.test(cradleSrc) &&
  playSrc.includes('onField={() => switchTab("battles")}'));
check("the Battles view is mounted with its decision seam wired (token + onDecision + guidance)", playSrc.includes('<BattlesTab') && playSrc.includes('token={token ?? undefined}') && playSrc.includes('onDecision={() => { void refresh(); }}'));
check("the decision seam is untouched — the view still owns its own post", read("/home/team/shared/site/src/components/BattlesTab.tsx").includes("battleIssueFn({ data: issuePayload("));
check("no purchase surface is reachable from the entry", !/storefront|purchase|buy|price|wallet|currency/i.test(fallSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")));
check("the seeder carries no store vocabulary either", !/storefront|purchase|wallet|currency|balance|price/i.test(act1Code));
check("the storefront is still off (nothing in this slice turns it on)", MONETIZATION_CONFIG.storefrontEnabled === false);
const cash0 = JSON.stringify(heightState().currency);
const ent0 = JSON.stringify(heightState().entitlements);
const seededWallet = openAct1Front(null, T0, () => prologueState(T0, ACT1_CONFIG.race)).state;
check("the height's wallet state is byte-identical to the seed's (the entry buys nothing)", JSON.stringify(seededWallet.currency) === cash0 && JSON.stringify(seededWallet.entitlements) === ent0);
check("the front never deducts from the reserve at commit (no cost is invented)", seededWallet.warReserve.troops === PROLOGUE_CONFIG.warReserveTroops && seededWallet.warReserve.energy === PROLOGUE_CONFIG.warReserveEnergy);
// ===========================================================================
section("6 · THE TUTORIAL LIGHTS UP ON ITS OWN — the cue layer is unchanged and still speaks");
// ===========================================================================
const tutSrc = read("/home/team/shared/site/src/game/war/tutorial-cues.ts");
const tutCode = tutSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const tutBattle = seedAct1Battle(heightState(), T0) as Battle;
let cueState = freshTutorialState(0, false);
const step1 = observeBattle({ ...freshWatch(), side: "defender" }, tutBattle, T0);
check("the cue machine fires on this battle with NO Act I hook added", step1.events.length > 0 && step1.events.some((e) => e.kind === "battle-open"));
cueState = advanceTutorial(cueState, step1.events);
const cue1 = activeCue(cueState);
check("the opening cue is a spoken caption (narrator/leader/hero)", !!cue1 && typeof (cue1 as { line?: unknown }).line === "string" && !!(cue1 as { speaker?: unknown }).speaker);
check("the opening cue points at a real element of the Battles view", !!cue1 && typeof (cue1 as { pointsAt?: unknown }).pointsAt === "string");
check("the chip beat reads the rout-risk state our front actually opens in", step1.events.some((e) => e.kind === "chip" && (e as { chip?: string }).chip === "rout-risk") && cue1?.lesson === "pummeled");
const step2 = observeBattle(step1.watch, tutBattle, T0 + 31_000);
check("the pummeled beat fires when OUR edge window opens (window-open/edge)", step2.events.some((e) => e.kind === "window-open" && (e as { windowKind?: string }).windowKind === "edge"));
cueState = advanceTutorial(cueState, step2.events);
check("the cue queue fills up from the front alone (no injected events)", cueState.pending.length > 0);
check("the cue sequence is deterministic for this battle (same log → same cues)", JSON.stringify(cueSequenceFor([...step1.events, ...step2.events])) === JSON.stringify(cueState.pending));
check("a first battle still gets the FULL guided tier (\u00a712.1 scaffolding)", guideTierFor(1) === 1 && guideTierFor(3) === 3);
check("the tutorial cues it points at are stamped on the real Battles view", read("/home/team/shared/site/src/components/BattlesTab.tsx").includes("data-tutorial-target"));
check("the cue layer still observes the PUBLIC entity only (no order, no store, no server)", tutCode.includes('from "./battle-engine"') && !tutCode.includes("issueDecision") && !tutCode.includes("store") && !tutCode.includes("fetch("));
check("this slice added no Act I special-case to the cue layer (contract unchanged)", !tutSrc.includes("ACT1_CONFIG") && !tutSrc.includes("act1-battle") && !cueState.suppressed);
check("the cue machine counts this as the player's FIRST battle (battlesSeen 0 → tier 1)", freshTutorialState(0, false).battlesSeen === 0 && cueState.guide === 1);
// ===========================================================================
console.log(`\nact1-entry-tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
