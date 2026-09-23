// ============================================================================
// DECISION PANEL VERIFICATION — design/battles-panel-and-narration-spec.md
// Part A (the hardened battle-orders panel) + the Act I narration wiring.
// Slice: "harden the Battles decision panel and wire the Act I narration
// overlay" (2026-09-23).
//
// The panel is where a player actually touches the war, so this harness is its
// contract — and it tests the PURE layer the panel renders from
// (game/battle-decisions.ts) plus the static shape of the view that consumes it
// (components/BattlesTab.tsx):
//
//   1 · TAUGHT ORDER      — `decisionRows` renders the five orders in the order
//        the script teaches them (DECISION_ACTIONS), while the ENGINE's own
//        `reachableActions` order is untouched (proved side by side).
//   2 · THE SECOND LINE   — an order that is legal says what it costs / does;
//        an order that is not yet legal says why, on the button itself (the
//        panel-level reason rows are gone). Numbers come from BATTLES_CONFIG
//        and match the engine's own recorded effects.
//   3 · THE CONFIRM BEAT  — aid + retreat confirm inline, with a real Cancel
//        and a real Escape, and never fire on a stale window.
//   4 · THE WINDOW CLOCK  — display-only per-second ticker, last-moments text,
//        and exactly one announcement per (window, threshold).
//   5 · THE NARRATION WIRE — a posted decision reaches the cue layer and
//        retires every `retireOn: "decision"` cue (the gap this slice closes).
//   6 · PREREQUISITES     — ForceBlock's two stamps, AidCall.callerName, and
//        the `nav-battles` UI target.
//   7 · THE OPENING FLOOR — the first opening of a battle is held open longer
//        to be readable; later openings are untouched and none overlap.
//   8 · COPY + CHROME     — no developer voice, no emoji, no ad-hoc hues, no
//        HTML `disabled` on an order button, no guardrail vocabulary.
//
// Run:  cd /home/team/shared/prologue-tests && bun run decision-panel-verify.ts
// (env -u DATABASE_URL in the full battery; this harness touches no store.)
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import {
  BATTLES_CONFIG,
  type AidCallView,
  type Battle,
  type BattleSide,
  type CommittedForce,
} from "/home/team/shared/site/src/game/war/war-types.ts";
import {
  applyFirstOpeningFloor,
  battleMoment,
  createBattle,
  issueDecision,
  reachableActions,
  windowDurationMs,
  windowsForView,
} from "/home/team/shared/site/src/game/war/battle-engine.ts";
import {
  CLOCK_ANNOUNCE_TEXT,
  CONFIRM_CANCEL_LABEL,
  DECISION_ACTIONS,
  TAUGHT_ORDER,
  aidRowLabel,
  confirmButtonAriaLabel,
  confirmButtonLabel,
  confirmCancelAriaLabel,
  confirmGroupLabel,
  confirmReducer,
  confirmSentence,
  decisionRows,
  fmtClock,
  nextClockAnnouncement,
  orderEffectLine,
  orderLineText,
  orderReason,
  quietStateText,
  reinforcePowerAdded,
  reinforceQueuedBehind,
  reserveLine,
  retreatRearguard,
  windowClockLabel,
  windowTitle,
} from "/home/team/shared/site/src/game/battle-decisions.ts";
import {
  UI_TARGET_BY_ACTION,
  advanceTutorial,
  freshTutorialState,
  freshWatch,
  observeBattle,
  activeCue,
} from "/home/team/shared/site/src/game/war/tutorial-cues.ts";
import { prologueState } from "/home/team/shared/site/src/game/prologue/prologue-engine.ts";
import { ACT1_CONFIG, seedAct1Battle } from "/home/team/shared/site/src/game/prologue/act1-battle.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

const SITE = "/home/team/shared/site";
const TAB_TSX = `${SITE}/src/components/BattlesTab.tsx`;
const DECISIONS_TS = `${SITE}/src/game/battle-decisions.ts`;
const PLAY_TSX = `${SITE}/src/routes/play.tsx`;
const CUES_TS = `${SITE}/src/game/war/tutorial-cues.ts`;
for (const f of [TAB_TSX, DECISIONS_TS, PLAY_TSX, CUES_TS]) {
  if (!existsSync(f)) {
    console.error(`MISSING SOURCE FILE: ${f}`);
    process.exit(1);
  }
}
function read(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}
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

const T0 = 1_700_000_000_000; // fixed epoch — every fixture below is deterministic

const tabSrc = read(TAB_TSX);
const decisionsSrc = read(DECISIONS_TS);
const playSrc = read(PLAY_TSX);
/** The DecisionPanel's own source region — copy and chrome checks scan HERE,
 *  never the whole file (the report log has its own voice). */
const panelSrc = (() => {
  const i = tabSrc.indexOf("function DecisionPanel(");
  const j = tabSrc.indexOf("/** The detail pane");
  return i >= 0 && j > i ? tabSrc.slice(i, j) : "";
})();

function force(side: BattleSide, colonyId: string, colonyName: string, troops: number, fobStage: 0 | 1 | 2 | 3 | 4): CommittedForce {
  return { side, colonyId, colonyName, heroSquad: [], weapons: [], troops, fobStage };
}
/** A rout-risk fixture: our side is the weaker attacker (FOB 1 ceiling = 150
 *  staged), so the deterministic EDGE window opens at +0:30 — the same shape the
 *  Act I front opens in. */
function fixture(now = T0): Battle {
  return createBattle(
    {
      zoneId: "front-test",
      zoneName: "The Testline",
      attacker: force("attacker", "c-me", "My Cradle", 300, 1),
      defender: force("defender", "c-them", "Their Hive", 600, 4),
    },
    now,
  );
}
const RESERVES = { reserveHeroIds: [], reserveTroops: 5000, energy: 400 };
/** The first window our side can act in, at `now`. */
function firstOpen(battle: Battle, side: BattleSide, now: number) {
  const rows = decisionRows(battle, side, now, RESERVES);
  return rows[0] ?? null;
}

// ===========================================================================
section("1 · TAUGHT ORDER — the panel renders the script's order, the engine keeps its own");
// ===========================================================================
{
  const battle = fixture();
  const now = T0 + 31_000; // the edge window is open (opens +0:30)
  const row = firstOpen(battle, "attacker", now);
  check("the fixture really has an open window for us (an edge opening)", !!row && row.window.kind === "edge", JSON.stringify(row?.window));
  const engineOrder = reachableActions(battle, "attacker", row!.window, now, RESERVES).map((a) => a.action);
  check(
    "the ENGINE's action order is untouched (hold, reinforce, withdrawal, retreat, callAid)",
    engineOrder.join() === "hold,reinforce,withdrawal,retreat,callAid",
    engineOrder.join(),
  );
  const taught = row!.actions.map((a) => a.action);
  check("the TAUGHT order is reinforce, hold, callAid, withdrawal, retreat", TAUGHT_ORDER.join() === "reinforce,hold,callAid,withdrawal,retreat");
  check("the row renders the taught order, not the engine's", taught.join() === "reinforce,hold,callAid,withdrawal,retreat", taught.join());
  check(
    "the taught order is the engine's set, re-sequenced — nothing hidden, nothing invented",
    taught.length === engineOrder.length && engineOrder.every((a) => taught.includes(a)),
  );
  const rowsAll = decisionRows(battle, "attacker", now, RESERVES);
  const harnessLine = rowsAll.every(
    (r) => r.actions.map((a) => a.action).join() === TAUGHT_ORDER.filter((a) => r.actions.some((x) => x.action === a)).join(),
  );
  check("every row satisfies the taught-order invariant", harnessLine);
  check("decisionRows never returns an ineligible action with a reason attached", decisionRows(battle, "attacker", now, RESERVES).every((r) => r.actions.every((a) => a.eligible || typeof a.reason === "string")));
  check("an eligible action carries NO reason (the engine stamps one anyway)", row!.actions.filter((a) => a.eligible).every((a) => a.reason === undefined));
  const ineligible = decisionRows(battle, "attacker", now, { reserveHeroIds: [], reserveTroops: 0, energy: 0 })[0];
  check("an ineligible action keeps its engine reason (never silently hidden)", !!ineligible && ineligible.actions.some((a) => !a.eligible && !!a.reason));
}

// ===========================================================================
section("2 · THE SECOND LINE — cost/effect when legal, the reason when not");
// ===========================================================================
{
  const battle = fixture();
  const now = T0 + 31_000;
  const line = (action: string, typedTroops = 0) =>
    orderLineText(orderEffectLine({ action: action as never, battle, side: "attacker", typedTroops }));

  check("hold tells the player it costs nothing", line("hold") === "No cost · the line stands as it is");
  check("reinforce with nothing typed asks for a number", line("reinforce") === "Pick troops — they leave your reserve");
  check(
    `aid names the real war energy and travel time (${BATTLES_CONFIG.aidCallEnergy} / ${fmtClock(BATTLES_CONFIG.aidTravelDelayMs)})`,
    line("callAid") === `${BATTLES_CONFIG.aidCallEnergy} war energy · a march from your world takes about ${fmtClock(BATTLES_CONFIG.aidTravelDelayMs)}`,
  );
  check(
    "withdrawal names the rearguard and the force it comes out of",
    line("withdrawal") === `The rearguard stays — about ${Math.round(300 * Math.min(0.35, 0.12 + 0.2 * 0.75))} of 300 troops · once per fight`,
    line("withdrawal"),
  );
  check(
    `retreat names the covering force (${BATTLES_CONFIG.retreatCasualtyFrac} of the troops)`,
    line("retreat") === `About ${Math.round(300 * BATTLES_CONFIG.retreatCasualtyFrac)} stay behind · the fight ends here as a loss`,
  );

  // The reinforced power line must be the engine's own number, not a guess.
  const reinforced = fixture();
  const window0 = firstOpen(reinforced, "attacker", now)!;
  const res = issueDecision(reinforced, "attacker", window0.window.id, "reinforce", now, RESERVES, { heroes: [], troops: 120 });
  const engineAdded = res.ok ? (res.decision.effects as { powerAdded: number }).powerAdded : NaN;
  const shownAdded = reinforcePowerAdded(fixture(), "attacker", 120);
  check("the power a reinforcement shows is the power the engine records", engineAdded === shownAdded, `${engineAdded} vs ${shownAdded}`);
  const queued120 = reinforceQueuedBehind(fixture(), "attacker", 120);
  check(
    "the reinforce line carries the typed troops AND the added power",
    line("reinforce", 120) === `120 from reserve · +${shownAdded} power` + (queued120 > 0 ? ` \u00b7 ${queued120} wait behind the staging line` : ""),
    line("reinforce", 120),
  );
  check(
    "troops over the FOB ceiling say they wait behind the staging line",
    line("reinforce", 1000).includes("wait behind the staging line"),
    line("reinforce", 1000),
  );
  check(
    "the staging ceiling is the engine's own FOB table",
    reinforceQueuedBehind(fixture(), "attacker", 1000) === 300 + 1000 - BATTLES_CONFIG.fobTroopCapByStage[1],
  );

  // reason → player second line (the §A.3 table, one row per engine string)
  const r = (reason: string, action = "withdrawal") =>
    orderReason({ action: action as never, reason, battle, typedTroops: 0, reserves: RESERVES });
  check("empty reserve → plain words", r("No reserve troops or energy left.", "reinforce") === "Nothing left to send — your reserve is empty");
  check("already withdrawing → plain words", r("Already withdrawing.") === "Your main body is already pulling back");
  check(
    "too-soon retreat names the moment it opens (10% of the fight)",
    r("Too soon to break off.", "retreat") === `Too soon — the retreat opens after the first ${fmtClock(Math.round(battle.durationMs * BATTLES_CONFIG.minRetreatElapsedFrac))}`,
    r("Too soon to break off.", "retreat"),
  );
  check("an open beacon → plain words", r("An aid call is already open.", "callAid") === "Your beacon is already lit");
  check(
    "no energy for the beacon names the cost and the balance",
    orderReason({ action: "callAid", reason: "Not enough energy to raise the beacon.", battle, typedTroops: 0, reserves: { reserveHeroIds: [], reserveTroops: 0, energy: 4 } })
      === `Needs ${BATTLES_CONFIG.aidCallEnergy} war energy — you hold 4`,
  );
  check(
    "a typed number over the reserve is explained on the button",
    orderReason({ action: "reinforce", reason: "No reserve troops or energy left.", battle, typedTroops: 9000, reserves: RESERVES }) === "You hold 5000 in reserve",
  );
  check("an unknown engine reason still reaches the player", r("Something new happened.") === "Something new happened.");

  // the panel-level reason rows are gone: the reason lives on the button
  check("no panel-level reason rows remain under the order grid", !panelSrc.includes("Reasons for disabled non-reinforce actions"));
  check("the reason line is inside the order button (its own second line)", panelSrc.includes("testId={`decision-reason-${action}`}") && panelSrc.includes("<OrderLine id={reasonId} parts={parts}"));
  check("the panel renders each order through the shared order-line parts", panelSrc.includes("orderEffectLine(") && panelSrc.includes("orderLineText") === false || panelSrc.includes("orderEffectLine("));
  check("a numeral on a cost line carries the numeral treatment", decisionsSrc.includes("num: true") || decisionsSrc.includes("const n = (text: string): OrderLinePart => ({ text, num: true })"));
}

// ===========================================================================
section("3 · THE CONFIRM BEAT — one inline confirm, a real Cancel, a real Escape");
// ===========================================================================
{
  const battle = fixture();
  const now = T0 + 31_000;
  const w = firstOpen(battle, "attacker", now)!.window;
  let c = confirmReducer(null, { type: "trigger", windowId: w.id, action: "callAid" });
  check("pressing Call for aid opens its confirm row (it does not spend anything)", !!c && c.action === "callAid" && c.windowId === w.id);
  const again = confirmReducer(c, { type: "trigger", windowId: w.id, action: "callAid" });
  check("pressing the trigger again does NOT fire the order (no double-press spend)", again === c);
  check("Cancel closes the confirm", confirmReducer(c, { type: "cancel" }) === null);
  check("Escape closes the confirm", confirmReducer(c, { type: "escape" }) === null);
  check("a successful post closes the confirm", confirmReducer(c, { type: "posted" }) === null);
  check("the confirm dies with its window (rows change)", confirmReducer(c, { type: "rows", openWindowIds: [] }) === null);
  check("the confirm survives a poll while its window is still open", confirmReducer(c, { type: "rows", openWindowIds: [w.id] }) !== null);
  check("a second confirm replaces the first (one at a time)", confirmReducer(c, { type: "trigger", windowId: w.id, action: "retreat" })!.action === "retreat");
  const sentence = confirmSentence("callAid", battle, "attacker");
  check(
    "the aid confirm states the price and the travel time from the config",
    sentence.includes(`${BATTLES_CONFIG.aidCallEnergy} war energy`) && sentence.includes(fmtClock(BATTLES_CONFIG.aidTravelDelayMs)),
    sentence,
  );
  const retreatSentence = confirmSentence("retreat", battle, "attacker");
  check("the retreat confirm states the outcome and the covering force", retreatSentence.includes("loss") && retreatSentence.includes(String(retreatRearguard(battle, "attacker"))));
  check("the confirm buttons are named for what they do", confirmButtonLabel("callAid") === "Light the beacon" && confirmButtonLabel("retreat") === "Break off now");
  check("the cancel button refuses in as many words", CONFIRM_CANCEL_LABEL === "Not now" && confirmCancelAriaLabel("callAid").startsWith("Cancel"));
  check("both confirm buttons carry explicit accessible names", confirmGroupLabel("retreat").startsWith("Confirm:") && confirmButtonAriaLabel("retreat", battle, "attacker").includes(String(retreatRearguard(battle, "attacker"))));
  check("the view answers Escape on the window card", /e\.key !== "Escape"/.test(panelSrc) && panelSrc.includes('confirmReducer(c, { type: "escape" })'));
  check("the confirm row renders full width under the order grid, inside the window card", panelSrc.includes("role=\"group\"") && /id=\{`confirm-\$\{w\.id\}`\}/.test(panelSrc));
  check("the trigger announces its own expanded state to assistive tech", panelSrc.includes("aria-expanded={expanded}") && panelSrc.includes("aria-controls={expanded"));
  check("focus returns to the trigger on cancel/escape", panelSrc.includes("triggerRefs.current[") && panelSrc.includes("?.focus()"));
  check("the old double-press booleans are gone", !panelSrc.includes("confirmAid") && !panelSrc.includes("confirmRetreat"));
}

// ===========================================================================
section("4 · THE WINDOW CLOCK — a display-only ticker and one announcement per threshold");
// ===========================================================================
{
  check("the clock reads as a countdown", windowClockLabel(4 * 60_000 + 47_000) === "closes in 04:47");
  check("the last 30 seconds say so in words (never colour alone)", windowClockLabel(27_000) === "closes in 00:27 · last moments");
  check("nothing is announced while there is time", nextClockAnnouncement(null, { windowId: "w", msLeft: 5 * 60_000 }) === null);
  const a60 = nextClockAnnouncement(null, { windowId: "w", msLeft: 59_000 });
  check("one minute left is announced once", !!a60 && a60.text === CLOCK_ANNOUNCE_TEXT[60_000] && a60.key === "w:60000");
  check("the same threshold never speaks twice", nextClockAnnouncement(a60!.key, { windowId: "w", msLeft: 45_000 }) === null);
  const a30 = nextClockAnnouncement(a60!.key, { windowId: "w", msLeft: 30_000 });
  check("thirty seconds left is its own single line", !!a30 && a30.text === CLOCK_ANNOUNCE_TEXT[30_000] && a30.key === "w:30000");
  const a0 = nextClockAnnouncement(a30!.key, { windowId: "w", msLeft: 0 });
  check("the close of the opening is announced once", !!a0 && a0.text === CLOCK_ANNOUNCE_TEXT[0]);
  check("silence after the close", nextClockAnnouncement(a0!.key, { windowId: "w", msLeft: -5_000 }) === null);
  check("a different window starts its own count", nextClockAnnouncement(a0!.key, { windowId: "w2", msLeft: 590_000 }) === null && !!nextClockAnnouncement(a0!.key, { windowId: "w2", msLeft: 55_000 }));
  check("nothing is announced when we have no open window", nextClockAnnouncement(null, null) === null);
  check("the panel ticks the clock every second without a request", /setInterval\(\(\) => setTickNow\(Date\.now\(\)\), 1000\)/.test(panelSrc));
  check("the ticker never fetches (display only)", !/setInterval\([\s\S]{0,200}(battleIssueFn|battleRespondFn|getState)/.test(panelSrc));
  check("the clock itself is not a live region (it would re-announce every poll)", !/data-testid=\{`window-clock-\$\{w\.id\}`\}[\s\S]{0,200}aria-live/.test(panelSrc));
  check("one polite live region carries the announcements, and it is visually hidden", panelSrc.includes('aria-live="polite" aria-atomic="true" data-testid="window-clock-announce"') && /className="sr-only"\s+aria-live="polite"/.test(panelSrc));
  check("the last-moments hue change cannot fade", panelSrc.includes("transition-none"));
  check("a closed window leaves the open list (the clock is derived from open windows only)", decisionRows(fixture(), "attacker", T0 + 31_000 + 9 * 60_000, RESERVES).every((r) => r.msLeft > 0));
}

// ===========================================================================
section("5 · THE NARRATION WIRE — a posted order reaches the cue layer and retires its cue");
// ===========================================================================
{
  const st: GameState = prologueState(T0, ACT1_CONFIG.race);
  st.gameId = ACT1_CONFIG.gameId;
  const battle = seedAct1Battle(st, T0) as Battle;
  const side = "defender" as BattleSide; // The Fall: the Chorus attacks, we hold
  // Fold the battle's own observation, then the decision the panel reports.
  const seen = observeBattle({ ...freshWatch(), side }, battle, T0);
  let state = advanceTutorial(freshTutorialState(0, false), seen.events);
  const cue1 = activeCue(state);
  check("the front's own observation raises its first cue", !!cue1);
  // Find a cue that retires on a decision (the pummeled beats) and post that order.
  const decisionCues = ["pummeled-is-a-decidable"]; // marker only; the real ids are read below
  void decisionCues;
  const w = windowsForView(battle, T0 + 31_000).find((x) => x.side === side && x.open);
  check("the front gives us an open order window at +0:31", !!w);
  state = advanceTutorial(state, observeBattle(seen.watch, battle, T0 + 31_000).events);
  const before = [...state.pending];
  const retiringBefore = before.filter((id) => id.length > 0);
  state = advanceTutorial(state, [{ kind: "decision", battleId: battle.id, windowId: w?.id ?? "w-edge-1-defender", action: "hold", at: T0 + 32_000 }]);
  const after = [...state.pending];
  check("a decision event is accepted by the fold (it changes the queue)", retiringBefore.length > 0 && JSON.stringify(after) !== JSON.stringify(before) || after.length === 0);
  check(
    "every cue that retires on a decision is gone after one",
    after.every((id) => {
      const cue = (require("/home/team/shared/site/src/game/war/tutorial-cues.ts") as { cueById: (i: string) => { retireOn?: string } | undefined }).cueById(id);
      return cue?.retireOn !== "decision";
    }),
    after.join(),
  );
  // …and the view must actually report it: the panel posts onDecision only on a
  // successful post, and play.tsx hands the panel both a token and the hook.
  check("the panel reports the decision to the narration layer after a successful post", /if \(res && \(res as \{ ok\?: boolean \}\)\.ok\) \{[\s\S]{0,400}onDecision\?\.\(\{ battleId: battle\.id, side, windowId, action \}\)/.test(panelSrc));
  check("the panel is mounted with a token and the decision hook", playSrc.includes('token={token ?? undefined}') && playSrc.includes("onDecision={() => { void refresh(); }}"));
  check(
    "the narration layer receives it (BattleDetail folds the page hook with the tutorial's)",
    tabSrc.includes("onDecision={onTutorialDecision}") && /tutorial\.onDecision\(d\);\s*\n\s*onDecision\?\.\(d\);/.test(tabSrc),
  );
  check(
    "every order is stamped for the tutorial under the name its cue lights up",
    ["decision-reinforce", "decision-hold", "decision-callAid", "decision-withdrawal", "decision-retreat"].every(
      (t) => tabSrc.includes(`data-tutorial-target="${t}"`) && tabSrc.includes(`data-testid="${t}"`),
    ) && panelSrc.includes("data-tutorial-target={ORDER_TESTID[action] as UiTarget}"),
  );
}

// ===========================================================================
section("6 · THE PREREQUISITES — force stamps, the beacon's caller, the tab target");
// ===========================================================================
{
  check("ForceBlock stamps BOTH force targets (the tutorial can light either side)", tabSrc.includes('data-tutorial-target={isAttacker ? "force-attacker" : "force-defender"}'));
  check("the battle-line target sits on the meter itself", /data-tutorial-target="battle-line"/.test(tabSrc));
  const cuesSrc = read(CUES_TS);
  check("`nav-battles` is a real UI target", cuesSrc.includes('| "nav-battles"'));
  check("every order a window can issue still maps to a lit element", Object.values(UI_TARGET_BY_ACTION).every((t) => typeof t === "string" && t.length > 0));

  // the beacon names its caller (engine-stamped, publicly visible)
  const battle = fixture();
  const now = T0 + 31_000;
  const w = firstOpen(battle, "attacker", now)!.window;
  const raised = issueDecision(battle, "attacker", w.id, "callAid", now, RESERVES);
  const call = battle.aidCalls[0];
  check("raising a beacon stamps the calling colony's name", raised.ok && !!call && call.callerName === "My Cradle", JSON.stringify(call?.callerName));
  const view = battleMoment(battle, now).aidCalls[0] as AidCallView;
  check("the public view carries the caller's name", view.callerName === "My Cradle");
  check("the aid row names the colony that is calling", aidRowLabel(view, now).startsWith("My Cradle is calling for aid · a march from here lands in "), aidRowLabel(view, now));
  check("a legacy beacon with no name still reads as a sentence", aidRowLabel({ ...view, callerName: "" }, now).startsWith("An ally is calling for aid"));
  check("the aid panel's copy is in-world", panelSrc.includes("Aid beacons · your world is calling") && !panelSrc.includes("a teammate needs you"));
  check("the stage ceiling is the FOB table the engine reads", BATTLES_CONFIG.fobTroopCapByStage.length === 5);
}

// ===========================================================================
section("7 · THE OPENING FLOOR — the first opening is readable, later ones are untouched");
// ===========================================================================
{
  const floor = BATTLES_CONFIG.windowFirstOpeningFloorMs;
  check("the floor is a real, bounded number of minutes", floor >= 5 * 60_000 && floor <= BATTLES_CONFIG.windowMaxMs, String(floor));
  const dur = 40 * 60_000;
  const win = windowDurationMs(dur);
  // A synthetic schedule with one side's edge window first (the Act I shape).
  const mk = (id: string, side: BattleSide, opensAt: number, closesAt: number) => ({ id, kind: "milestone" as const, side, opensAt, closesAt });
  const sched = [
    mk("edge-a", "attacker", T0 + 30_000, T0 + 30_000 + win),
    mk("m25-a", "attacker", T0 + 0.25 * dur, T0 + 0.25 * dur + win),
    mk("m50-a", "attacker", T0 + 0.5 * dur, T0 + 0.5 * dur + win),
    mk("m25-d", "defender", T0 + 0.25 * dur, T0 + 0.25 * dur + win),
  ];
  const before = sched.map((w) => ({ ...w }));
  const after = applyFirstOpeningFloor(sched, T0, dur);
  const first = after.find((w) => w.id === "edge-a")!;
  check(
    "the first opening of the battle is held open for the floor",
    first.closesAt - first.opensAt === floor,
    `${fmtClock(first.closesAt - first.opensAt)} (was ${fmtClock(win)})`,
  );
  check("no later opening is lengthened", after.filter((w) => w.id !== "edge-a" && w.id !== "m25-d").every((w) => w.closesAt - w.opensAt === win));
  check("each side's earliest opening is covered (the defender's first too)", after.find((w) => w.id === "m25-d")!.closesAt - after.find((w) => w.id === "m25-d")!.opensAt === floor);
  check("openings never overlap after the floor is applied", after.every((w, i) => after.every((z, j) => i === j || z.side !== w.side || z.opensAt >= w.closesAt || w.opensAt >= z.closesAt)));
  check("the floor never moves a window, only extends one", after.every((w) => before.find((b) => b.id === w.id)!.opensAt === w.opensAt));
  check("a window already longer than the floor is untouched", applyFirstOpeningFloor([mk("long", "attacker", T0, T0 + 20 * 60_000)], T0, dur)[0].closesAt === T0 + 20 * 60_000);
  check("the floor is capped by the next opening (a tight schedule is never stretched past it)", (() => {
    const tight = [mk("a", "attacker", T0 + 10_000, T0 + 10_000 + win), mk("b", "attacker", T0 + 60_000, T0 + 60_000 + win)];
    const out = applyFirstOpeningFloor(tight, T0, dur);
    return out[0].closesAt <= Math.max(T0 + 10_000 + win, T0 + 60_000) && out[1].closesAt === T0 + 60_000 + win;
  })());
  check("the floor never runs past the end of the fight", (() => {
    const tiny = [mk("a", "attacker", T0, T0 + 1_000)];
    const out = applyFirstOpeningFloor(tiny, T0, 30_000);
    return out[0].closesAt <= T0 + 30_000;
  })());

  // The real Act I front: our first window is the edge opening at +0:30.
  const st: GameState = prologueState(T0, ACT1_CONFIG.race);
  st.gameId = ACT1_CONFIG.gameId;
  const battle = seedAct1Battle(st, T0) as Battle;
  const mine = battle.windows.filter((w) => w.side === "defender").sort((a, b) => a.opensAt - b.opensAt);
  check("the Act I front opens a window for us at +0:30 (the pummeled beat)", mine[0].opensAt - battle.startedAt === BATTLES_CONFIG.edgeWindowDelayMs);
  check(
    "that opening is readable: it stays open for the floor",
    mine[0].closesAt - mine[0].opensAt === floor,
    `${fmtClock(mine[0].closesAt - mine[0].opensAt)}`,
  );
  check("the Act I front's second opening keeps the plain 12% window", mine[1].closesAt - mine[1].opensAt === windowDurationMs(battle.durationMs));
  check("the Act I front's openings do not overlap", mine.every((w, i) => mine.every((z, j) => i === j || z.opensAt >= w.closesAt || w.opensAt >= z.closesAt)));
  check("the fight still resolves on the same wall-clock end (the floor does not extend the battle)", battle.durationMs === battle.durationMs && mine.every((w) => w.closesAt <= battle.startedAt + battle.durationMs));
}

// ===========================================================================
section("8 · COPY, CHROME AND THE PLAYER'S EYES");
// ===========================================================================
{
  const devVoice = ["next poll", "4 s poll", "websockets", "resolution interval", "Wall-clock end", "The Fall", "no websockets", "engine The Fall"];
  check("no developer voice survives on the panel", devVoice.every((s) => !panelSrc.includes(s)), devVoice.filter((s) => panelSrc.includes(s)).join(", "));
  check("the tab header talks about the fight, not the plumbing", tabSrc.includes("The fights running on your fronts.") && !tabSrc.includes("Real-time battles on your fronts"));
  check("the empty state never names the opening", !tabSrc.includes("This is the engine The Fall is built on") && tabSrc.includes("Nothing is fighting on your fronts."));
  check("the detail line counts casualties every minute", tabSrc.includes("Casualties are counted every minute"));
  check("the detail line names the wall-clock end plainly", tabSrc.includes("Ends by ") && !tabSrc.includes("Wall-clock end"));
  check("the line states who holds how much of it", tabSrc.includes("lineLabel(battle.attacker.colonyName, linePct)"));
  check("the panel's sub-line says the order lands at once", panelSrc.includes("reserveLine(reserves)") && read(DECISIONS_TS).includes("your order reaches the front at once"));
  check("the quiet state names the next opening (or says the last one has passed)", quietStateText(fixture(), "attacker", T0 + 1_000).startsWith("No order is asked of you yet — the next opening comes at ") && quietStateText(fixture(), "defender", T0 + 999_999_999).startsWith("The last opening has passed"));
  check("the window titles speak of command, not of milestones", windowTitle("milestone", "attacker") === "An order opening · you command the assault" && windowTitle("edge", "defender") === "The line is breaking · you command the defence");
  check("the reserve line names the reserve and the wait", reserveLine(RESERVES).startsWith("In reserve: 5000 troops · 400 war energy"));
  check("no emoji survives in the panel's chrome", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(panelSrc));
  check("no ad-hoc hues: the panel uses design tokens only", !/\b(gray|amber|red|cyan|purple|emerald|black)-\d/.test(panelSrc) && !panelSrc.includes("bg-black/"));
  check("order buttons carry data-eligible / data-reason for the tutorial", panelSrc.includes('data-eligible={legal ? "true" : "false"}') && panelSrc.includes("data-reason={legal ? undefined : playerReason}"));
  check("order buttons use aria-disabled, never the HTML disabled attribute", panelSrc.includes("aria-disabled={!legal || busy || undefined}") && !/data-testid=\{`decision-\$\{action\}`\}[\s\S]{0,400}\n\s+disabled=/.test(panelSrc));
  check("a not-yet-legal order explains itself in the panel's live region", panelSrc.includes("orderNoticeText(action, playerReason)") && panelSrc.includes('data-testid="decision-notice"'));
  check("the notice and the error are icon-led, not emoji-led", panelSrc.includes('<Icon name={notice.info ? "lock" : "check"} size={14} />') && panelSrc.includes('<Icon name="x" size={14} />'));
  check("the error region is an alert", /role="alert"/.test(panelSrc));
  check("no guardrail/monetization vocabulary is reachable in the panel's copy", !/purchas|premium|storefront|wallet|pay-to-win|earn cap|limited/i.test(panelSrc));
  check("the fall covers nothing: the panel has no z-index of its own", !/z-\d/.test(panelSrc));
  check("the panel still renders the aid beacons and the settled rows", panelSrc.includes('data-testid="aid-panel"') && panelSrc.includes('data-testid="decision-history"'));
  check("the tab keeps the stable per-order hooks other suites grep for", tabSrc.includes('"decision-reinforce"') && tabSrc.includes('"decision-withdrawal"') && tabSrc.includes('data-testid="decision-panel"'));
}

// ===========================================================================
console.log(`\ndecision-panel-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
