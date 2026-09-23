// BATTLE DECISION HELPERS — pure client-side logic for the Battles tab's
// decision windows (battle-side-rvr-spec.md §15 B11/B12; The Fall Step 3 slice 1).
//
// This module owns everything the DecisionPanel UI needs that is NOT a React
// render: which side the player fights on, which reserve numbers gate the
// buttons, the payload shapes posted to battleIssueFn / battleRespondFn, and
// the plain-language error map. It imports ONLY public engine math
// (windowsForView / reachableActions / battleMoment) plus public war types —
// never server-only reserve internals, never store/auth. Kept separate from
// BattlesTab.tsx so the verification harness can import it directly (bun,
// no JSX) and assert the client contract: gating, clock math, payload shapes.
import { battleMoment, powerGap, reachableActions, windowsForView } from "./war/battle-engine";
import { BATTLES_CONFIG } from "./war/war-types";
import type {
  AidCallView,
  Battle,
  BattleReserves,
  BattleSide,
  BattleWindowView,
} from "./war/war-types";

/** Minimal public colony identity the client can see (playerName + gameId ride
 *  publicState; no server internals). */
export interface ColonyIdentity {
  colonyId: string;
  colonyName: string;
}

/** Which side of a battle is "ours" — matched by colony identity against both
 *  committed forces. Null when neither side is ours (spectating a foreign
 *  front, e.g. a world-level ledger entry): the panel renders read-only. */
export function ourSide(battle: Battle, me: ColonyIdentity | null): BattleSide | null {
  if (!me) return null;
  if (battle.attacker.colonyId === me.colonyId || battle.attacker.colonyName === me.colonyName) return "attacker";
  if (battle.defender.colonyId === me.colonyId || battle.defender.colonyName === me.colonyName) return "defender";
  return null;
}

/** The client-visible reserve numbers. publicState ships warReserve with
 *  troops + energy (+ aidCredits); lockedHeroes is always stripped to {} on
 *  the wire, so the client treats the hero list as empty (the server is the
 *  authority — it re-validates every hero id against its own ledger). */
export function clientReserves(args: {
  reserveTroops: number;
  energy: number;
}): BattleReserves {
  return {
    reserveHeroIds: [],
    reserveTroops: Math.max(0, Math.trunc(args.reserveTroops) || 0),
    energy: Math.max(0, Math.trunc(args.energy) || 0),
  };
}

/** The five orders the issue endpoint accepts (respondAid rides the
 *  separate aid-respond endpoint — never an issue action). */
export type IssueAction = "reinforce" | "hold" | "withdrawal" | "retreat" | "callAid";

/** One row the DecisionPanel renders: the window, its reachable actions
 *  (enabled/disabled + reason, never silently hidden), and the live clock. */
export interface DecisionRow {
  window: BattleWindowView;
  actions: { action: IssueAction; eligible: boolean; reason?: string }[];
  msLeft: number;
}

/** mm:ss / h:mm:ss clock — the panel's ONE clock format (elapsed, ETA, window
 *  close, march arrival). Exported here so the view and the harness read the
 *  same string. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Decision rows for OUR side only, open windows first (live clock per row).
 *  Closed/decided windows contribute no actions here — the panel shows their
 *  settled state separately (see decidedSummary). Derived purely from public
 *  battle fields via windowsForView + reachableActions.
 *
 *  Two disciplines live HERE, in one place, so the panel, the harness and the
 *  tutorial all see the same thing (spec §A.2/§A.3):
 *   • the TAUGHT order (DECISION_ACTIONS) — the ENGINE's own order is untouched;
 *   • `reason` is normalised to `undefined` when the order is eligible (the
 *     engine stamps a reason unconditionally on withdrawal/retreat/callAid, so
 *     no render site may print a reason for an order that is legal). */
export function decisionRows(
  battle: Battle,
  side: BattleSide,
  now: number,
  reserves: BattleReserves,
): DecisionRow[] {
  return windowsForView(battle, now)
    .filter((w) => w.side === side && w.open)
    .map((w) => {
      // respondAid is never issued through a window (it rides battleRespondFn),
      // so rows carry only the five issue-endpoint actions.
      const actions = reachableActions(battle, side, w, now, reserves)
        .filter((a): a is { action: IssueAction; eligible: boolean; reason?: string } => a.action !== "respondAid")
        .map((a) => ({ action: a.action, eligible: a.eligible, reason: a.eligible ? undefined : a.reason }))
        .sort((a, b) => TAUGHT_ORDER.indexOf(a.action) - TAUGHT_ORDER.indexOf(b.action));
      return { window: w, actions, msLeft: Math.max(0, w.closesAt - now) };
    })
    .sort((a, b) => a.window.closesAt - b.window.closesAt);
}

/** Human one-liner for a decided window ("Held the line · 12:04"). */
export function decidedSummary(w: BattleWindowView): string {
  const label =
    w.action === "reinforce" ? "Reinforced"
    : w.action === "hold" ? "Hold: held the line"
    : w.action === "withdrawal" ? "Withdrew in order"
    : w.action === "retreat" ? "Retreated"
    : w.action === "callAid" ? "Called for aid"
    : w.action === "respondAid" ? "Answered an aid call"
    : "Decided";
  return label;
}

/** Incoming aid beacons a teammate raised that still need an answer
 *  (awaiting only — locked/arrived are settled). Rendered for ANY viewer:
 *  answering is the co-op path, not the participant path. */
export function answerableAidCalls(battle: Battle, now: number): AidCallView[] {
  return battleMoment(battle, now).aidCalls.filter((c) => c.status === "awaiting");
}

/** Payload posted to battleIssueFn — mirrors the server validator exactly
 *  (token/battleId/side/windowId/action + optional heroes/troops). */
export interface IssuePayload {
  token: string;
  battleId: string;
  side: BattleSide;
  windowId: string;
  action: "reinforce" | "hold" | "withdrawal" | "retreat" | "callAid";
  heroes?: never[];
  troops?: number;
}

export function issuePayload(args: {
  token: string;
  battleId: string;
  side: BattleSide;
  windowId: string;
  action: IssueAction;
  troops?: number;
}): IssuePayload {
  const p: IssuePayload = {
    token: args.token,
    battleId: args.battleId,
    side: args.side,
    windowId: args.windowId,
    action: args.action,
  };
  // Reinforce carries the troop count; the hero roster arrives with the war
  // Phase-1 roster surface (today: troops-only orders + always-legal orders).
  if (args.action === "reinforce") p.troops = Math.max(0, Math.trunc(args.troops ?? 0) || 0);
  return p;
}

/** Payload posted to battleRespondFn — mirrors the server validator exactly.
 *  Slice 1 answers with troops only (no hero picker yet); heroes: [] keeps
 *  the call well-formed and costs nothing (energy is per-hero). */
export interface RespondPayload {
  token: string;
  battleId: string;
  aidCallId: string;
  colonyId: string;
  colonyName: string;
  heroes: never[];
  troops: number;
}

export function respondPayload(args: {
  token: string;
  battleId: string;
  aidCallId: string;
  me: ColonyIdentity;
  troops: number;
}): RespondPayload {
  return {
    token: args.token,
    battleId: args.battleId,
    aidCallId: args.aidCallId,
    colonyId: args.me.colonyId,
    colonyName: args.me.colonyName,
    heroes: [],
    troops: Math.max(0, Math.trunc(args.troops) || 0),
  };
}

/** Engine error → plain colony-speak (no engine jargon: no "window", no
 *  "idempotent", no "validator"). Unknown strings pass through untouched. */
export function plainDecisionError(err: string): string {
  const s = (err || "").toLowerCase();
  if (s.includes("not signed in") || s.includes("signed out")) return "Your session expired — sign in again.";
  if (s.includes("start a colony")) return "Found your Cradle first — no colony, no orders.";
  if (s.includes("isn't running") || s.includes("already decided")) return "That battle is already over — no more orders to give.";
  if (s.includes("other side")) return "Those orders belong to the other side.";
  if (s.includes("window is closed") || s.includes("unknown decision")) return "Too late — that order's moment has passed.";
  if (s.includes("too soon to break off") || s.includes("hold the line")) return "Too soon to break off — hold the line a little longer.";
  if (s.includes("already withdrawing")) return "Your main body is already pulling back.";
  if (s.includes("aid call is already open")) return "Your beacon is already lit — wait for an answer.";
  if (s.includes("not enough war energy to raise the beacon") || s.includes("not enough war energy this week"))
    return "Not enough war energy — earn more in the war week before ordering that.";
  if (s.includes("not enough war energy to march")) return "Not enough war energy to march that force.";
  if (s.includes("not enough reserve troops")) return "Not enough reserve troops — pull fewer soldiers into this fight.";
  if (s.includes("send something")) return "Send something — troops at least, heroes when the roster arrives.";
  if (s.includes("already committed, locked, or not in your reserve")) return "One of those heroes is already fighting or locked elsewhere.";
  if (s.includes("already answered") || s.includes("already arrived")) return "Someone already answered that call.";
  if (s.includes("unknown aid call")) return "That aid call is gone.";
  return err || "The order didn't go through — try again.";
}

/** Button metadata — diegetic labels + tutorial-stable action keys. The
 *  ACTION_ORDER (reinforce/hold first, then aid, then withdrawal/retreat)
 *  mirrors the opening script's teaching beats (Beat 1.2). */
export const DECISION_ACTIONS: {
  action: IssueAction;
  label: string;
  hint: string;
}[] = [
  { action: "reinforce", label: "Reinforce", hint: "Send reserve troops into the fight." },
  { action: "hold", label: "Hold the line", hint: "Stay the course — no extra cost." },
  { action: "callAid", label: "Call for aid", hint: `Raise the beacon (${BATTLES_CONFIG.aidCallEnergy} war energy) — a teammate can march to you.` },
  { action: "withdrawal", label: "Withdraw in order", hint: "Concede ground to save the army — the rearguard bleeds now." },
  { action: "retreat", label: "Sound the retreat", hint: "Break off now — the battle ends as a loss, most of the army lives." },
];

/** The order the player is TAUGHT the orders in (opening-script Beat 1.2) —
 *  reinforce, hold, aid, withdrawal, retreat. `decisionRows` renders rows in
 *  this order; the engine's own `reachableActions` order is never touched. */
export const TAUGHT_ORDER: readonly IssueAction[] = DECISION_ACTIONS.map((a) => a.action);

// ============================================================================
// §A ORDER COPY — the two lines every order button carries (spec Part A §A.1/
// §A.3/§A.7). Pure: numbers derive from BATTLES_CONFIG + the public battle
// entity, so a calibration change moves the copy with it and the button can
// never advertise a cost the engine does not charge.
//
// A line is a LIST OF PARTS so a numeral can carry the mono/ember treatment
// (`<span className="num text-ember-soft">`) without the panel re-parsing text
// and without the harness testing JSX.
// ============================================================================
export interface OrderLinePart {
  text: string;
  /** true → render in the numeral treatment (mono tabular, cost hue). */
  num?: boolean;
}

/** The plain text of a line — what a player reads, and what a screen reader
 *  announces (the parts are styling, never content). */
export function orderLineText(parts: readonly OrderLinePart[]): string {
  return parts.map((p) => p.text).join("");
}

const t = (text: string): OrderLinePart => ({ text });
const n = (text: string): OrderLinePart => ({ text, num: true });

/** `{n} from reserve · +{p} power` — the power the engine will add for `n`
 *  troops right now. Same math as computeForcePower on the troop term alone
 *  (only troops change), including the FOB stage's field ceiling. */
export function reinforcePowerAdded(battle: Battle, side: BattleSide, troops: number): number {
  const force = battle[side];
  const cap = BATTLES_CONFIG.fobTroopCapByStage[Math.max(0, Math.min(4, force.fobStage))];
  const held = Math.max(0, Math.trunc(force.troops) || 0);
  const want = Math.max(0, Math.trunc(troops) || 0);
  const effective = Math.min(held, cap);
  const after = Math.min(held + want, cap);
  return Math.round(BATTLES_CONFIG.troopPowerPerTroop * (after - effective));
}

/** Troops that would queue behind the staging line for a reinforcement of `n`
 *  (the FOB's ceiling — real supply, no combat power). */
export function reinforceQueuedBehind(battle: Battle, side: BattleSide, troops: number): number {
  const force = battle[side];
  const cap = BATTLES_CONFIG.fobTroopCapByStage[Math.max(0, Math.min(4, force.fobStage))];
  const held = Math.max(0, Math.trunc(force.troops) || 0);
  const want = Math.max(0, Math.trunc(troops) || 0);
  return Math.max(0, held + want - cap);
}

/** The rearguard a steady withdrawal leaves behind, from the committed troops
 *  and the pressure on us (battle-engine's own formula, mirrored for display). */
export function withdrawalRearguard(battle: Battle, side: BattleSide): number {
  const other: BattleSide = side === "attacker" ? "defender" : "attacker";
  const gap = powerGap(battle.forcePower[side], battle.forcePower[other]);
  const frac = Math.min(
    BATTLES_CONFIG.withdrawalRearguardMaxFrac,
    BATTLES_CONFIG.withdrawalRearguardBase + BATTLES_CONFIG.withdrawalRearguardGapRise * gap,
  );
  const troops = Math.max(0, Math.trunc(battle[side].troops) || 0);
  return Math.min(troops, Math.round(troops * frac));
}

/** The covering force a retreat leaves behind (retreatCasualtyFrac). */
export function retreatRearguard(battle: Battle, side: BattleSide): number {
  const troops = Math.max(0, Math.trunc(battle[side].troops) || 0);
  return Math.round(troops * BATTLES_CONFIG.retreatCasualtyFrac);
}

/** The second line of a LEGAL order button — the cost/effect of taking it.
 *  `typedTroops` is the client-side number in the reinforce input (0/absent =
 *  nothing typed yet). */
export function orderEffectLine(args: {
  action: IssueAction;
  battle: Battle;
  side: BattleSide;
  typedTroops?: number;
}): OrderLinePart[] {
  const { action, battle, side } = args;
  switch (action) {
    case "hold":
      return [t("No cost · the line stands as it is")];
    case "reinforce": {
      const typed = Math.max(0, Math.trunc(args.typedTroops ?? 0) || 0);
      if (typed <= 0) return [t("Pick troops — they leave your reserve")];
      const added = reinforcePowerAdded(battle, side, typed);
      const queued = reinforceQueuedBehind(battle, side, typed);
      const parts: OrderLinePart[] = [n(String(typed)), t(" from reserve · +"), n(String(added)), t(" power")];
      if (queued > 0) parts.push(t(" · "), n(String(queued)), t(" wait behind the staging line"));
      return parts;
    }
    case "callAid":
      return [
        n(String(BATTLES_CONFIG.aidCallEnergy)),
        t(" war energy · a march from your world takes about "),
        n(fmtClock(BATTLES_CONFIG.aidTravelDelayMs)),
      ];
    case "withdrawal": {
      const rearguard = withdrawalRearguard(battle, side);
      const troops = Math.max(0, Math.trunc(battle[side].troops) || 0);
      return [
        t("The rearguard stays — about "),
        n(String(rearguard)),
        t(" of "),
        n(String(troops)),
        t(" troops · once per fight"),
      ];
    }
    case "retreat": {
      const rearguard = retreatRearguard(battle, side);
      return [t("About "), n(String(rearguard)), t(" stay behind · the fight ends here as a loss")];
    }
  }
}

/** Engine reason → the player's second line (spec §A.3). The engine's strings
 *  are the keys; a string we do not know passes through untouched, never
 *  blank — the reason is always readable. */
export function orderReason(args: {
  action: IssueAction;
  reason?: string;
  battle: Battle;
  /** the client-side typed number, for the reinforce-only over-reserve case. */
  typedTroops?: number;
  reserves: BattleReserves;
}): string {
  const reason = args.reason ?? "";
  if (args.action === "reinforce") {
    const typed = Math.max(0, Math.trunc(args.typedTroops ?? 0) || 0);
    if (typed > args.reserves.reserveTroops) return `You hold ${args.reserves.reserveTroops} in reserve`;
  }
  if (reason.startsWith("No reserve troops or energy left")) return "Nothing left to send — your reserve is empty";
  if (reason.startsWith("Already withdrawing")) return "Your main body is already pulling back";
  if (reason.startsWith("Too soon to break off")) {
    const opensAfter = Math.round(
      (args.battle.durationMs ?? 0) * BATTLES_CONFIG.minRetreatElapsedFrac,
    );
    return `Too soon — the retreat opens after the first ${fmtClock(opensAfter)}`;
  }
  if (reason.startsWith("An aid call is already open")) return "Your beacon is already lit";
  if (reason.startsWith("Not enough energy to raise the beacon")) {
    return `Needs ${BATTLES_CONFIG.aidCallEnergy} war energy — you hold ${args.reserves.energy}`;
  }
  return reason || "Not available just now";
}

/** The first line of an order button while it is posting. */
export function orderBusyLabel(action: IssueAction): string {
  switch (action) {
    case "callAid":
      return "Lighting the beacon…";
    case "retreat":
      return "Sounding the retreat…";
    case "reinforce":
      return "Sending…";
    case "hold":
    case "withdrawal":
      return "Sending…";
  }
}

/** Clicking an order that is not yet legal explains itself in the panel's own
 *  live-region notice line (§A.3) instead of doing nothing. */
export function orderNoticeText(action: IssueAction, playerReason: string): string {
  const label = DECISION_ACTIONS.find((a) => a.action === action)?.label ?? "That order";
  return `${label}: ${playerReason}`;
}

// ============================================================================
// §B THE WINDOW CLOCK — display-only ticker + one-time announcements (§A.5).
// ============================================================================
/** The clock under a window: `closes in 07:12`; inside the last 30 s the state
 *  word is appended (text, never colour alone). */
export function windowClockLabel(msLeft: number): string {
  const clock = fmtClock(msLeft);
  return msLeft <= 30_000 ? `closes in ${clock} · last moments` : `closes in ${clock}`;
}

/** The thresholds that speak once each, per window (soonest-closing only). */
export const CLOCK_ANNOUNCE_MS = [60_000, 30_000, 0] as const;
export const CLOCK_ANNOUNCE_TEXT: Record<number, string> = {
  60_000: "One minute left on this order opening.",
  30_000: "Thirty seconds left.",
  0: "That order opening has closed.",
};

/** Which threshold `msLeft` has reached (null = nothing to say yet). */
export function clockThreshold(msLeft: number): number | null {
  if (msLeft <= 0) return 0;
  if (msLeft <= 30_000) return 30_000;
  if (msLeft <= 60_000) return 60_000;
  return null;
}

export interface ClockAnnouncement {
  /** `${windowId}:${threshold}` — the once-only key the caller remembers. */
  key: string;
  text: string;
}

/** The announcement to make RIGHT NOW, or null for silence. `lastKey` is the
 *  previously announced key (the caller keeps one). One line per
 *  (window, threshold), and only ever for the soonest-closing open window. */
export function nextClockAnnouncement(
  lastKey: string | null,
  soonest: { windowId: string; msLeft: number } | null,
): ClockAnnouncement | null {
  if (!soonest) return null;
  const threshold = clockThreshold(soonest.msLeft);
  if (threshold === null) return null;
  const key = `${soonest.windowId}:${threshold}`;
  if (key === lastKey) return null;
  return { key, text: CLOCK_ANNOUNCE_TEXT[threshold] };
}

// ============================================================================
// §C THE CONFIRM BEAT (§A.4) — one confirm at a time, dismissible, and never
// fired on a stale window. Pure reducer so the harness can test Cancel, Escape
// and "the window closed while the confirm was open" without a DOM.
// ============================================================================
export type ConfirmAction = "callAid" | "retreat";
export interface ConfirmState {
  windowId: string;
  action: ConfirmAction;
}

export type ConfirmEvent =
  | { type: "trigger"; windowId: string; action: ConfirmAction }
  | { type: "cancel" }
  | { type: "escape" }
  | { type: "posted" }
  | { type: "rows"; openWindowIds: readonly string[] };

export function confirmReducer(state: ConfirmState | null, ev: ConfirmEvent): ConfirmState | null {
  switch (ev.type) {
    case "trigger":
      // Pressing the trigger again is NOT the order — the order fires only from
      // the confirm row's own button, so a double-press cannot spend anything.
      return state && state.windowId === ev.windowId && state.action === ev.action
        ? state
        : { windowId: ev.windowId, action: ev.action };
    case "cancel":
    case "escape":
    case "posted":
      return null;
    case "rows":
      return state && !ev.openWindowIds.includes(state.windowId) ? null : state;
  }
}

/** What the confirm row asks — the consequence, in full (§A.4). */
export function confirmSentence(action: ConfirmAction, battle: Battle, side: BattleSide): string {
  if (action === "callAid") {
    return `Raise the beacon? It costs ${BATTLES_CONFIG.aidCallEnergy} war energy, and your world can answer — a march from the links takes about ${fmtClock(BATTLES_CONFIG.aidTravelDelayMs)}.`;
  }
  return `Sound the retreat? The fight ends here as a loss, and about ${retreatRearguard(battle, side)} troops stay behind as the rearguard. The rest come home.`;
}

/** The confirm button's own words, per order. */
export function confirmButtonLabel(action: ConfirmAction): string {
  return action === "callAid" ? "Light the beacon" : "Break off now";
}

export function confirmButtonAriaLabel(action: ConfirmAction, battle: Battle, side: BattleSide): string {
  return action === "callAid"
    ? `Confirm — raise the aid beacon (${BATTLES_CONFIG.aidCallEnergy} war energy)`
    : `Confirm — sound the retreat (about ${retreatRearguard(battle, side)} troops stay behind)`;
}

export function confirmGroupLabel(action: ConfirmAction): string {
  return action === "callAid" ? "Confirm: call for aid" : "Confirm: sound the retreat";
}

export const CONFIRM_CANCEL_LABEL = "Not now";
export function confirmCancelAriaLabel(action: ConfirmAction): string {
  return action === "callAid" ? "Cancel — do not raise the beacon" : "Cancel — do not sound the retreat";
}

// ============================================================================
// §D PANEL / VIEW COPY (§A.5/§A.7) — every player-facing sentence the hardened
// panel renders, in one place so the harness can assert the words and no
// developer voice can creep back into a render site.
// ============================================================================
/** Which side is commanding what: attacker = the assault, defender = the
 *  defence. */
export function commandLabel(side: BattleSide): string {
  return side === "attacker" ? "assault" : "defence";
}

/** The window title — the milestone beat vs. the line-breaking beat. */
export function windowTitle(kind: "milestone" | "edge", side: BattleSide): string {
  return kind === "edge"
    ? `The line is breaking · you command the ${commandLabel(side)}`
    : `An order opening · you command the ${commandLabel(side)}`;
}

/** The panel's sub-line: what is in reserve, and when an order lands. */
export function reserveLine(reserves: BattleReserves): string {
  return `In reserve: ${reserves.reserveTroops} troops · ${reserves.energy} war energy · your order reaches the front at once, the view catches up within a few seconds.`;
}

/** The quiet state: no order window is open for us. Names the next opening (as
 *  time into the fight), or says the fight is now decided by what stands. */
export function quietStateText(battle: Battle, side: BattleSide, now: number): string {
  const next = windowsForView(battle, now)
    .filter((w) => w.side === side && !w.decided && w.opensAt > now)
    .sort((a, b) => a.opensAt - b.opensAt)[0];
  if (next) {
    return `No order is asked of you yet — the next opening comes at ${fmtClock(next.opensAt - battle.startedAt)} into the fight. Orders already given stand below.`;
  }
  return "The last opening has passed — this fight is decided by what is already on the field.";
}

/** The aid beacon row: the colony that raised it, and when its march lands. */
export function aidRowLabel(call: AidCallView, now: number): string {
  const who = (call.callerName ?? "").trim() || "An ally";
  return `${who} is calling for aid · a march from here lands in ${fmtClock(Math.max(0, call.arrivalAt - now))}`;
}

/** The march button's second line — the force the player is sending. */
export function aidMarchLine(typedTroops: number, call: AidCallView, now: number): string {
  const typed = Math.max(0, Math.trunc(typedTroops) || 0);
  const landing = fmtClock(Math.max(0, call.arrivalAt - now));
  return typed > 0 ? `Send ${typed} troops · they land in ${landing}` : `Send troops · they land in ${landing}`;
}

/** The line the meter reads: who holds how much of it. */
export function lineLabel(attackerColony: string, pct: number): string {
  return `the line · ${attackerColony} ${pct}%`;
}

/** The meter's accessible name — the same fact, said as a sentence. */
export function lineAriaLabel(colonyName: string, pct: number): string {
  return `${colonyName} holds ${pct}% of the line`;
}

/** Settled-order row prefix (the check icon carries the tick now). */
export const SETTLED_ORDER_ARIA = "Order already given: ";
