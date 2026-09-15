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
import { battleMoment, reachableActions, windowsForView } from "./war/battle-engine";
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

/** Decision rows for OUR side only, open windows first (live clock per row).
 *  Closed/decided windows contribute no actions here — the panel shows their
 *  settled state separately (see decidedSummary). Derived purely from public
 *  battle fields via windowsForView + reachableActions. */
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
      const actions = reachableActions(battle, side, w, now, reserves).filter(
        (a): a is { action: IssueAction; eligible: boolean; reason?: string } => a.action !== "respondAid",
      );
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
