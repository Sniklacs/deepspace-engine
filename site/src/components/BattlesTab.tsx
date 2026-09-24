// BATTLES TAB — the live battle view (battle-side-rvr-spec.md §15.4, B2
// ratified 2026-09-12). The strategic tool: every battle your colony is in,
// its committed composition (hero squad by name, weapon families/tiers, troop
// counts, FOB stage), casualties ticking per resolution interval, the shifting
// line, and the after-action report ledger that closes the loop (§15.6).
//
// DECISION-CAPABLE over the existing 4 s poll: this component renders
// `state.battles` / `state.battleReports` plus a client-side `now` clock, derives
// EVERY live number (elapsed/ETA, chip, ticks, line) through the SAME pure
// functions the server resolves with (battle-engine battleMoment/…), and posts
// mid-battle orders through battleIssueFn / battleRespondFn (game/api.ts).
// All gating math lives in game/battle-decisions.ts (pure, harness-tested) —
// this file only renders rows and posts payloads, never server internals.
//
// The designer polishes the visuals later (visual-pass-1-style brief); this is
// the clean minimal shell with the design-system tokens.
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "../game/types";
import type { Battle, BattleReport, BattleSide, CommittedForce } from "../game/war/war-types";
import { battleMoment, battleEndAt } from "../game/war/battle-engine";
import { battleIssueFn, battleRespondFn } from "../game/api";
import {
  CONFIRM_CANCEL_LABEL,
  DECISION_ACTIONS,
  aidMarchLine,
  aidRowLabel,
  answerableAidCalls,
  clientReserves,
  confirmButtonAriaLabel,
  confirmButtonLabel,
  confirmCancelAriaLabel,
  confirmGroupLabel,
  confirmReducer,
  confirmSentence,
  decidedSummary,
  decisionRows,
  fmtClock,
  issuePayload,
  lineAriaLabel,
  lineLabel,
  nextClockAnnouncement,
  orderBusyLabel,
  orderEffectLine,
  orderNoticeText,
  orderReason,
  ourSide,
  plainDecisionError,
  quietStateText,
  reserveLine,
  respondPayload,
  windowClockLabel,
  windowTitle,
} from "../game/battle-decisions";
import type { ConfirmState, IssueAction, OrderLinePart } from "../game/battle-decisions";
import { familyFor } from "../game/armory";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import TutorialCueLayer from "./TutorialCueLayer";
import {
  TUTORIAL_CONFIG,
  activeCue,
  advanceTutorial,
  decodeTutorialPrefs,
  encodeTutorialPrefs,
  freshTutorialState,
  freshWatch,
  observeBattle,
  replayTutorial,
  setSuppressed,
  stepTutorial,
} from "../game/war/tutorial-cues";
import type {
  BattleWatch,
  TutorialAction,
  TutorialCue,
  TutorialEvent,
  TutorialPrefs,
  TutorialState,
  UiTarget,
} from "../game/war/tutorial-cues";
import { voiceEngine } from "../game/voice/voice-engine";

const CHIP_META: Record<string, { label: string; cls: string }> = {
  stalemate: { label: "Stalemate", cls: "bg-sky-400/15 text-sky-200 border-sky-400/30" },
  pressing: { label: "Pressing", cls: "bg-ember/15 text-ember-soft border-ember/30" },
  "rout-risk": { label: "Rout risk", cls: "bg-danger/15 text-danger-soft border-danger/30" },
};

// The panel's clock format lives in game/battle-decisions.ts (fmtClock) so the
// view and the harness read the same string — imported above.

// ============================================================================
// ACT I GUIDED TUTORIAL — the narration layer (The Fall Step 3 slice 2,
// opening-prologue-spec §12). It OBSERVES the battle and the decision seam and
// narrates; it never issues, gates or alters an order.
//
// The event log comes from two places and nowhere else:
//   • `observeBattle` reads the public entity every render (battle start,
//     time-in-battle marks, windows opening, the chip turning, the resolution);
//   • the decision panel's own `onDecision` seam contributes the player's
//     orders AFTER a successful post.
// Both are folded through the pure machine in game/war/tutorial-cues.ts, which
// owns the cue script, the progressive-scaffolding tiers (§12.1) and the
// skip/step/replay controls (§12.4).
// ============================================================================
interface TutorialRun {
  state: TutorialState;
  watch: BattleWatch;
  events: TutorialEvent[];
}

function loadTutorialPrefs(): TutorialPrefs {
  try {
    return decodeTutorialPrefs(localStorage.getItem(TUTORIAL_CONFIG.storageKeys.prefs));
  } catch {
    return { suppressed: false, battlesSeen: 0 };
  }
}

function saveTutorialPrefs(prefs: TutorialPrefs): void {
  try {
    localStorage.setItem(TUTORIAL_CONFIG.storageKeys.prefs, encodeTutorialPrefs(prefs));
  } catch {
    /* a player with storage blocked just gets the guidance afresh next visit */
  }
}

function useBattleTutorial(battle: Battle | null, side: BattleSide | null, now: number, enabled: boolean) {
  const prefs = useRef<TutorialPrefs | null>(null);
  if (prefs.current === null) prefs.current = loadTutorialPrefs();
  const run = useRef<TutorialRun | null>(null);
  if (run.current === null) {
    run.current = {
      state: freshTutorialState(prefs.current.battlesSeen, prefs.current.suppressed),
      watch: freshWatch(),
      events: [],
    };
  }
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  // Observe the live battle. Idempotent: a poll that shows nothing new leaves
  // the run untouched and never re-renders.
  useEffect(() => {
    if (!enabled || !battle) return;
    const current = run.current as TutorialRun;
    const { watch, events } = observeBattle({ ...current.watch, side: side ?? current.watch.side }, battle, now);
    if (events.length === 0) {
      if (watch !== current.watch) run.current = { ...current, watch };
      return;
    }
    const state = advanceTutorial(current.state, events);
    run.current = { ...current, watch, events: [...current.events, ...events], state };
    saveTutorialPrefs({ suppressed: state.suppressed, battlesSeen: state.battlesSeen });
    rerender();
  });

  /** The decision seam's event, verbatim — this layer only listens to it. */
  const onDecision = useCallback(
    (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => {
      if (!enabled || !battle || d.battleId !== battle.id) return;
      const current = run.current as TutorialRun;
      const ev: TutorialEvent = {
        kind: "decision",
        battleId: d.battleId,
        windowId: d.windowId,
        action: d.action as TutorialAction,
        at: Date.now(),
      };
      const state = advanceTutorial(current.state, [ev]);
      run.current = { ...current, events: [...current.events, ev], state };
      rerender();
    },
    [enabled, battle, rerender],
  );

  const state = run.current.state;
  const cue = enabled && battle ? activeCue(state) : null;
  const showControls = enabled && !!battle && state.battlesSeen > 0 && (state.battlesSeen <= TUTORIAL_CONFIG.maxGuidedTier + 1 || state.suppressed);

  return {
    cue,
    waiting: state.pending.length,
    suppressed: state.suppressed,
    showControls,
    /** The UI element the active cue asks the view to light up (§12.1). */
    target: (cue?.pointsAt ?? null) as UiTarget | null,
    onDecision,
    step: () => {
      const current = run.current as TutorialRun;
      run.current = { ...current, state: stepTutorial(current.state) };
      rerender();
    },
    suppress: () => {
      const current = run.current as TutorialRun;
      const next = setSuppressed(current.state, true);
      run.current = { ...current, state: next };
      saveTutorialPrefs({ suppressed: true, battlesSeen: next.battlesSeen });
      rerender();
    },
    resume: () => {
      const current = run.current as TutorialRun;
      const next = setSuppressed(current.state, false);
      run.current = { ...current, state: next };
      saveTutorialPrefs({ suppressed: false, battlesSeen: next.battlesSeen });
      rerender();
    },
    /** Replay: re-fold this battle's own log from the top (§12.4). */
    replay: () => {
      const current = run.current as TutorialRun;
      const next = replayTutorial(current.state, current.events);
      run.current = { ...current, state: next };
      rerender();
    },
  };
}

/** The highlight ring the active cue puts on the element it points at. */
const TUTORIAL_RING = "ring-2 ring-purity/70";
function tutorialRing(target: UiTarget | null, mine: UiTarget): string {
  return target === mine ? TUTORIAL_RING : "";
}

// ============================================================================
// THE VOICE — The Fall's spoken prologue (design/prologue-voice-direction.md).
//
// The engine is handed the SAME cue object the plate renders, and nothing else:
// no second observer of the battle log, no invented line, no extra fetch. It is
// session-local (no GameState field, no migration) and it is an ENHANCEMENT —
// with no voices, no gesture or a muted device the plate renders and every order
// button works exactly as before.
// ============================================================================
function useVoiceLayer({
  cue,
  battleId,
  muted,
  suppressed,
  stage,
  completed,
}: {
  cue: TutorialCue | null;
  battleId: string;
  muted: boolean;
  suppressed: boolean;
  stage: string | null;
  completed: boolean;
}) {
  const [, bump] = useState(0);
  // the plate carries the engine's mode as data-voice-mode (§2.7)
  useEffect(() => voiceEngine.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => {
    voiceEngine.surface("battles");
    return () => voiceEngine.surface("home");
  }, []);
  useEffect(() => voiceEngine.battle(battleId), [battleId]);
  useEffect(() => voiceEngine.setMuted(muted), [muted]);
  useEffect(() => voiceEngine.quiet(suppressed), [suppressed]);
  useEffect(() => voiceEngine.stage(stage), [stage]);
  useEffect(() => voiceEngine.complete(completed), [completed]);
  // THE WIRE: the plate's own cue prop, verbatim.
  useEffect(() => voiceEngine.cue(cue && { id: cue.id, line: cue.line, speaker: { id: cue.speaker.id }, retireOn: cue.retireOn }), [cue]);
  return { mode: voiceEngine.mode() };
}

function weaponLabel(state: GameState, kit: { family: string; tier: number; count: number }): string {
  const fam = state.race ? familyFor(state.race, kit.family) : undefined;
  const base = fam ? fam.name : kit.family;
  return `${base} T${kit.tier} × ${kit.count}`;
}

function fobLabel(stage: number): string {
  const names = ["No FOB", "Landing Pad", "Garrison", "Foundry", "Arsenal/Citadel"];
  return names[Math.max(0, Math.min(4, stage))] ?? names[0];
}

/** One side's committed composition — the observable facts of the fight. */
function ForceBlock({ state, force, power, tag, focusTarget }: { state: GameState; force: CommittedForce; power: number; tag: string; focusTarget?: UiTarget | null }) {
  const squad = force.heroSquad.length > 0 ? (
    <ul className="space-y-0.5">
      {force.heroSquad.map((h) => (
        <li key={h.id} className="text-xs text-text-2">
          <span className="text-text-3">{h.role} · L{h.level}</span> {h.name}
          {h.specialization ? <span className="text-corrupt-text"> — {h.specialization}</span> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-text-3">No hero squad committed.</p>
  );
  const weapons = force.weapons.length > 0 ? (
    <ul className="space-y-0.5">
      {force.weapons.map((k, i) => (
        <li key={i} className="text-xs text-text-2">{weaponLabel(state, k)}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-text-3">No weapon kits fielded.</p>
  );
  const isAttacker = tag === "attacker";
  return (
    <div
      className={`rounded-lg border border-line bg-surf-2/60 p-3 ${tutorialRing(focusTarget ?? null, isAttacker ? "force-attacker" : "force-defender")}`}
      data-tutorial-target={isAttacker ? "force-attacker" : "force-defender"}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${isAttacker ? "text-ember-soft" : "text-hazard-soft"}`}>
          <Icon name={isAttacker ? "sword" : "shield"} size={16} /> {isAttacker ? "Attacker" : "Defender"}
        </span>
        <span className="truncate text-xs text-text-3">{force.colonyName}</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-3">Hero squad</p>
          {squad}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-3">Weapons</p>
          {weapons}
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span className="text-text-2">Troops <b className="text-text-1">{Math.trunc(force.troops)}</b></span>
          <span className="text-text-2">FOB <b className="text-text-1">{fobLabel(force.fobStage)}</b></span>
          <span className="text-text-2">Power <b className="text-text-1">{power}</b></span>
        </div>
      </div>
    </div>
  );
}

/** The live list + detail for ongoing battles. */
function ActiveBattles({ state, now, token, onDecision, tutorialEnabled, muted = false }: {
  state: GameState;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  tutorialEnabled?: boolean;
  muted?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = (state.battles ?? []).filter((b) => b.status === "active").sort((a, b) => a.startedAt - b.startedAt);
  const selected = active.find((b) => b.id === selectedId) ?? active[0] ?? null;

  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surf-2/60 p-6 text-center">
        <Icon name="sword" size={28} className="mx-auto text-ember-soft" />
        <p className="mt-2 text-sm text-text-2">Nothing is fighting on your fronts.</p>
        <p className="mt-1 text-xs text-text-3">
          When a march meets a defending force the fight opens here; it runs whether or not you are watching, and it
          leaves a report either way.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {active.map((b) => {
          const m = battleMoment(b, now);
          const chip = CHIP_META[m.chip];
          return (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              aria-pressed={selected?.id === b.id}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selected?.id === b.id ? "border-ember/40 bg-surf-3" : "border-line bg-surf-2/60 hover:bg-surf-4"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-text-1">{b.zoneName || b.zoneId}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${chip.cls}`}>{chip.label}</span>
              </div>
              <p className="mt-1 text-xs text-text-2">
                {b.attacker.colonyName} <span className="text-text-3">vs</span> {b.defender.colonyName}
              </p>
              <p className="mt-1 text-xs text-text-3">
                {Math.trunc(b.attacker.troops)}/{Math.max(0, b.defender.troops)} troops · {fmtClock(m.elapsedMs)} elapsed · {fmtClock(m.remainingMs)} left
              </p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-line bg-surf-2/60 p-4">
          <BattleDetail state={state} battle={selected} now={now} token={token} onDecision={onDecision} tutorialEnabled={tutorialEnabled} muted={muted} />
        </div>
      )}
    </div>
  );
}


// ============================================================================
// DECISION PANEL (battle-side §15 B11/B12; hardened per
// design/battles-panel-and-narration-spec.md Part A, 2026-09-23).
//
// Renders the live decision window(s) for OUR side: one live clock per open
// window and the five orders in the TAUGHT order (decisionRows sorts by
// DECISION_ACTIONS — the engine's own order is untouched), each a two-line
// tile whose second line is the cost/effect of taking it or, when it is not
// yet legal, why not. Unreachable orders are never hidden silently.
//
// DISCIPLINE (asserted by prologue-tests/decision-panel-verify.ts):
//   • OBSERVER + POSTER ONLY — every number comes from the public battle
//     entity and BATTLES_CONFIG through game/battle-decisions.ts. The panel
//     never re-implements an engine rule and never intercepts one.
//   • `aria-disabled`, never the HTML `disabled` attribute, on order buttons:
//     a button that flips keeps focus, and its reason stays readable.
//   • the confirm beat (aid, retreat) has a real Cancel, answers Escape, and
//     dies with its window; the order fires only from the confirm row's button.
//   • the panel owns three live regions: the notice line, the error (role
//     ="alert"), and the once-only window-clock announcements.
// TUTORIAL SEAM (Step 3 slice 2 owns the narrator cues — NO tutorial copy here):
// stable `data-testid` + `data-action` + `data-window-id` + `data-eligible` /
// `data-reason`, and an optional `onDecision` fired AFTER a successful post.
// Props `token`/`colonyId`/`colonyName` default to the local session.
// ============================================================================
const ORDER_BASE = "flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors";
type OrderFamily = "free" | "cost" | "ally" | "move" | "break" | "off";
/** Order families (§A.1): neutral = the zero-cost default, ember = spend,
 *  sky = your world's co-op path, danger = ends the fight, off = not legal. */
const ORDER_FAMILY: Record<OrderFamily, string> = {
  free: "border-line-strong bg-surf-3 text-text-1 hover:bg-surf-4",
  cost: "border-ember/50 bg-ember/10 text-ember-soft hover:bg-ember/20",
  ally: "border-sky-400/50 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20",
  move: "border-line-strong bg-surf-3 text-text-1 hover:bg-surf-4",
  break: "border-danger/60 bg-danger/10 text-danger-soft hover:bg-danger/20",
  off: "border-line bg-surf-2 text-text-2 cursor-not-allowed",
};
const ORDER_FAMILY_BY_ACTION: Record<IssueAction, OrderFamily> = {
  reinforce: "cost",
  hold: "free",
  callAid: "ally",
  withdrawal: "move",
  retreat: "break",
};
/** Line icons, never emoji (§A.6). */
const ORDER_ICON: Record<IssueAction, IconName> = {
  reinforce: "march",
  hold: "shield",
  callAid: "beacon",
  withdrawal: "armor",
  retreat: "emblem",
};
/** The stable per-order hooks other suites and the tutorial read (§A.1).
 *  Stamped at runtime as data-testid={ORDER_TESTID[action]} and
 *  data-tutorial-target={ORDER_TESTID[action]} — spelled out here because the
 *  tutorial harness reads the view's source statically (no React runtime):
 *    data-tutorial-target="decision-reinforce"  data-testid="decision-reinforce"
 *    data-tutorial-target="decision-hold"       data-testid="decision-hold"
 *    data-tutorial-target="decision-callAid"    data-testid="decision-callAid"
 *    data-tutorial-target="decision-withdrawal" data-testid="decision-withdrawal"
 *    data-tutorial-target="decision-retreat"    data-testid="decision-retreat" */
const ORDER_TESTID: Record<IssueAction, string> = {
  reinforce: "decision-reinforce",
  hold: "decision-hold",
  callAid: "decision-callAid",
  withdrawal: "decision-withdrawal",
  retreat: "decision-retreat",
};
/** The 48px pair — the two orders that carry an inline confirm (§A.1). */
const ORDER_TALL: ReadonlySet<IssueAction> = new Set<IssueAction>(["callAid", "retreat"]);
function orderHeight(action: IssueAction): string {
  return ORDER_TALL.has(action) ? "min-h-12 py-2.5" : "min-h-11";
}
/** The button's second line: cost/effect when legal, the reason when not. */
function OrderLine({ id, parts, testId }: { id: string; parts: readonly OrderLinePart[]; testId: string }) {
  return (
    <span id={id} data-testid={testId} className="text-[11px] leading-snug text-text-2">
      {parts.map((p, i) =>
        p.num ? (
          <span key={i} className="num text-ember-soft">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function DecisionPanel({
  state,
  battle,
  now,
  side,
  token,
  colonyId,
  colonyName,
  onDecision,
  focusTarget,
}: {
  state: GameState;
  battle: Battle;
  now: number;
  side: BattleSide;
  token?: string;
  colonyId?: string;
  colonyName?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  /** The Act I tutorial's highlighted element (§12) — a ring only, never a gate. */
  focusTarget?: UiTarget | null;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; info?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [troopsByWindow, setTroopsByWindow] = useState<Record<string, string>>({});
  const [aidTroops, setAidTroops] = useState<string>("");
  const [announce, setAnnounce] = useState<string>("");
  const [tickNow, setTickNow] = useState<number>(() => now);
  const lastAnnounce = useRef<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // DISPLAY-ONLY ticker (§A.5): the clock under each window advances every
  // second without a single request — `now` still arrives on the page's poll.
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const displayNow = Math.max(now, tickNow);

  const effToken = token ?? (() => { try { return localStorage.getItem("deepspace_session_token") ?? ""; } catch { return ""; } })();
  const me = {
    colonyId: colonyId ?? state.gameId ?? "",
    colonyName: colonyName ?? state.playerName ?? "Unnamed Colony",
  };
  const reserves = clientReserves({
    reserveTroops: state.warReserve?.troops ?? 0,
    energy: state.warReserve?.energy ?? 0,
  });
  const rows = decisionRows(battle, side, displayNow, reserves);
  const decided = battle.windows
    .filter((w) => w.side === side)
    .sort((a, b) => a.opensAt - b.opensAt)
    .map((w) => {
      const d = (battle.decisions ?? []).find((dd) => dd.windowId === w.id);
      return d ? { id: w.id, text: decidedSummary({ id: w.id, kind: w.kind, side: w.side, open: false, decided: true, action: d.action, issuedAt: d.issuedAt, opensAt: w.opensAt, closesAt: w.closesAt }) } : null;
    })
    .filter((x): x is { id: string; text: string } => !!x);
  const aidCalls = answerableAidCalls(battle, displayNow).filter((c) => c.callerSide !== side);
  const busy = busyKey !== null;
  const meta = Object.fromEntries(DECISION_ACTIONS.map((a) => [a.action, a]));

  // One announcement per (window, threshold), for the soonest-closing window
  // only (§A.5) — silence in between, and no aria-live on the clock itself.
  const soonest = rows[0] ?? null;
  useEffect(() => {
    const next = nextClockAnnouncement(
      lastAnnounce.current,
      soonest ? { windowId: soonest.window.id, msLeft: soonest.msLeft } : null,
    );
    if (!next) return;
    lastAnnounce.current = next.key;
    setAnnounce(next.text);
  }, [soonest?.window.id, soonest?.msLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // A confirm never outlives the window it belongs to (§A.4).
  const openWindowIds = rows.map((r) => r.window.id).join(",");
  useEffect(() => {
    setConfirm((c) => confirmReducer(c, { type: "rows", openWindowIds: openWindowIds ? openWindowIds.split(",") : [] }));
  }, [openWindowIds]);

  async function postIssue(windowId: string, action: IssueAction, troops: number) {
    // IssueAction is exactly the five actions the issue endpoint accepts —
    // respondAid is never an issue action (it posts via battleRespondFn below).
    const key = `issue:${windowId}:${action}`;
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await battleIssueFn({ data: issuePayload({ token: effToken, battleId: battle.id, side, windowId, action, troops }) });
      if (res && (res as { ok?: boolean }).ok) {
        setNotice({
          text: action === "callAid"
            ? "Beacon lit — a teammate can march to you now."
            : action === "retreat"
              ? "Retreat sounded — the army breaks off."
              : "Order sent — it reaches the front at once.",
        });
        setConfirm((c) => confirmReducer(c, { type: "posted" }));
        onDecision?.({ battleId: battle.id, side, windowId, action });
      } else {
        setError(plainDecisionError((res as { error?: string })?.error ?? ""));
      }
    } catch {
      setError("The order didn't go through — check your connection and try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function postRespond(aidCallId: string, accept: boolean) {
    const key = `respond:${aidCallId}:${accept ? "accept" : "decline"}`;
    if (busyKey) return;
    if (!accept) {
      // Hold back is local-only: no march, no lock, no server write — the
      // beacon stays open for another colony. Announced so the choice is visible.
      setNotice({ text: "You stay put — another colony can still answer." });
      setError(null);
      return;
    }
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await battleRespondFn({ data: respondPayload({ token: effToken, battleId: battle.id, aidCallId, me, troops: Math.max(0, Math.trunc(Number(aidTroops)) || 0) }) });
      if (res && (res as { ok?: boolean }).ok) {
        setNotice({ text: "Marching — your force joins the fight when travel time lands." });
        onDecision?.({ battleId: battle.id, side, windowId: `aid-${aidCallId}`, action: "respondAid" });
      } else {
        setError(plainDecisionError((res as { error?: string })?.error ?? ""));
      }
    } catch {
      setError("The order didn't go through — check your connection and try again.");
    } finally {
      setBusyKey(null);
    }
  }

  /** A press on an order button: legal → post (or open its confirm); not yet
   *  legal → explain itself in the panel's own notice line (§A.3). */
  function onOrderPress(windowId: string, action: IssueAction, legal: boolean, playerReason: string, typed: number) {
    if (!legal) {
      setNotice({ text: orderNoticeText(action, playerReason), info: true });
      setError(null);
      return;
    }
    if (busy) return;
    setError(null);
    if (action === "callAid" || action === "retreat") {
      setConfirm((c) => confirmReducer(c, { type: "trigger", windowId, action }));
      return;
    }
    postIssue(windowId, action, action === "reinforce" ? typed : 0);
  }

  return (
    <section
      aria-label="Battle orders"
      data-testid="decision-panel"
      data-battle-id={battle.id}
      data-side={side}
      data-tutorial-target="decision-panel"
      className={`rounded-xl border border-ember/40 bg-ember/5 p-3 ${tutorialRing(focusTarget ?? null, "decision-panel")}`}
    >
      <h4 className="text-sm font-semibold text-ember-soft">Battle orders</h4>
      <p className="mt-0.5 text-[11px] text-text-2">{reserveLine(reserves)}</p>

      {rows.length === 0 && (
        <p className="mt-2 text-xs text-text-2" data-testid="decision-quiet">
          {quietStateText(battle, side, displayNow)}
        </p>
      )}

      {rows.map(({ window: w, actions, msLeft }) => {
        const confirmHere = confirm && confirm.windowId === w.id ? confirm : null;
        const lastMoments = msLeft <= 30_000;
        return (
          <div
            key={w.id}
            data-testid="decision-window"
            data-window-id={w.id}
            className="mt-2 scroll-mb-40 scroll-mt-32 rounded-lg border border-ember/30 border-l-2 border-l-ember bg-surf-2/70 p-2.5"
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !confirmHere) return;
              e.stopPropagation();
              setConfirm((c) => confirmReducer(c, { type: "escape" }));
              // Focus stays where it was given: back on the trigger that opened it.
              triggerRefs.current[`${w.id}:${confirmHere.action}`]?.focus();
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-2">{windowTitle(w.kind, side)}</span>
              <span
                data-testid={`window-clock-${w.id}`}
                className={`num text-sm font-semibold transition-none ${lastMoments ? "text-danger-soft" : "text-ember-soft"}`}
              >
                {windowClockLabel(msLeft)}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {actions.map(({ action, eligible, reason }) => {
                const typed = Math.max(0, Math.trunc(Number(troopsByWindow[w.id])) || 0);
                // Client-only gate (a typed number over the reserve) — the engine
                // still owns every server-side rule.
                const overReserve = action === "reinforce" && typed > reserves.reserveTroops;
                const legal = eligible && !overReserve;
                const playerReason = orderReason({ action, reason, battle, typedTroops: typed, reserves });
                const k = `${w.id}:${action}`;
                const isBusy = busyKey === k;
                const reasonId = `order-line-${w.id}-${action}`;
                const parts: OrderLinePart[] = legal
                  ? orderEffectLine({ action, battle, side, typedTroops: typed })
                  : [{ text: playerReason }];
                const expanded = confirmHere?.action === action || undefined;
                const button = (
                  <button
                    key={action}
                    type="button"
                    ref={(el) => { triggerRefs.current[k] = el; }}
                    data-testid={ORDER_TESTID[action]}
                    data-action={action}
                    data-window-id={w.id}
                    data-tutorial-target={ORDER_TESTID[action] as UiTarget}
                    data-eligible={legal ? "true" : "false"}
                    data-reason={legal ? undefined : playerReason}
                    aria-disabled={!legal || busy || undefined}
                    aria-busy={isBusy || undefined}
                    aria-describedby={reasonId}
                    aria-expanded={expanded}
                    aria-controls={expanded ? `confirm-${w.id}` : undefined}
                    title={legal ? meta[action].hint : playerReason}
                    onClick={() => onOrderPress(w.id, action, legal, playerReason, typed)}
                    className={`${ORDER_BASE} ${legal ? ORDER_FAMILY[ORDER_FAMILY_BY_ACTION[action]] : ORDER_FAMILY.off} ${orderHeight(action)} ${tutorialRing(focusTarget ?? null, ORDER_TESTID[action] as UiTarget)}`}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                      <Icon name={ORDER_ICON[action]} size={16} />
                      {isBusy ? orderBusyLabel(action) : meta[action].label}
                    </span>
                    <OrderLine id={reasonId} parts={parts} testId={`decision-reason-${action}`} />
                  </button>
                );
                if (action !== "reinforce") return button;
                return (
                  <div key={action} className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                    <label className="sr-only" htmlFor={`troops-${w.id}`}>Reserve troops to send</label>
                    <input
                      id={`troops-${w.id}`}
                      data-testid={`reinforce-troops-${w.id}`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      max={reserves.reserveTroops}
                      placeholder="Troops"
                      value={troopsByWindow[w.id] ?? ""}
                      onChange={(e) => setTroopsByWindow((t) => ({ ...t, [w.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                      readOnly={!eligible || busy}
                      aria-disabled={!eligible || busy || undefined}
                      aria-describedby={reasonId}
                      className="w-full rounded-lg border border-line-strong bg-surf-4 px-2 py-2 text-xs text-text-1 placeholder:text-text-3 read-only:opacity-60"
                    />
                    {button}
                  </div>
                );
              })}
            </div>

            {confirmHere && (
              <div
                id={`confirm-${w.id}`}
                role="group"
                aria-label={confirmGroupLabel(confirmHere.action)}
                data-testid={`confirm-${confirmHere.action}-${w.id}`}
                className="mt-2 rounded-lg border border-line-strong bg-surf-3/80 p-2.5"
              >
                <p className="text-[11px] text-text-2">{confirmSentence(confirmHere.action, battle, side)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid={`confirm-go-${confirmHere.action}`}
                    aria-label={confirmButtonAriaLabel(confirmHere.action, battle, side)}
                    aria-disabled={busy || undefined}
                    aria-busy={busyKey === `issue:${w.id}:${confirmHere.action}` || undefined}
                    onClick={() => {
                      const action = confirmHere.action;
                      setConfirm((c) => confirmReducer(c, { type: "posted" }));
                      postIssue(w.id, action, 0);
                    }}
                    className={`${ORDER_BASE} min-h-12 w-auto ${confirmHere.action === "callAid" ? ORDER_FAMILY.ally : ORDER_FAMILY.break}`}
                  >
                    <span className="text-[13px] font-semibold">
                      {busyKey === `issue:${w.id}:${confirmHere.action}` ? orderBusyLabel(confirmHere.action) : confirmButtonLabel(confirmHere.action)}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid={`confirm-cancel-${confirmHere.action}`}
                    aria-label={confirmCancelAriaLabel(confirmHere.action)}
                    onClick={() => {
                      setConfirm((c) => confirmReducer(c, { type: "cancel" }));
                      triggerRefs.current[`${w.id}:${confirmHere.action}`]?.focus();
                    }}
                    className={`${ORDER_BASE} min-h-11 w-auto ${ORDER_FAMILY.free}`}
                  >
                    <span className="text-[13px] font-semibold">{CONFIRM_CANCEL_LABEL}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Incoming aid beacons from teammates (B11) — answerable by anyone viewing. */}
      {aidCalls.length > 0 && (
        <div
          className={`mt-2 rounded-lg border border-sky-400/30 bg-sky-400/5 p-2.5 ${tutorialRing(focusTarget ?? null, "aid-panel")}`}
          data-testid="aid-panel"
          data-tutorial-target="aid-panel"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-sky-100">
            <Icon name="beacon" size={14} /> Aid beacons · your world is calling
          </p>
          {aidCalls.map((c) => (
            <div key={c.id} data-testid="aid-call" data-aid-call-id={c.id} className="mt-1.5 flex flex-wrap items-end gap-1.5">
              <span className="text-[11px] text-text-2">{aidRowLabel(c, displayNow)}</span>
              <label className="sr-only" htmlFor={`aid-troops-${c.id}`}>Troops to march to the beacon</label>
              <input
                id={`aid-troops-${c.id}`}
                data-testid={`aid-troops-${c.id}`}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Troops"
                value={aidTroops}
                onChange={(e) => setAidTroops(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={busy}
                className="w-20 rounded-lg border border-line-strong bg-surf-4 px-2 py-1.5 text-xs text-text-1 placeholder:text-text-3 disabled:opacity-50"
              />
              <button
                type="button"
                data-testid="aid-accept"
                data-action="respondAid"
                data-aid-call-id={c.id}
                data-eligible="true"
                disabled={busy}
                onClick={() => postRespond(c.id, true)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-sky-400/60 bg-sky-400/10 px-3 py-2 text-left text-sky-100 transition-colors hover:bg-sky-400/20 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                  <Icon name="march" size={16} /> {busyKey === `respond:${c.id}:accept` ? "Marching…" : "March to aid"}
                </span>
                <span className="text-[11px] leading-snug text-text-2">{aidMarchLine(Math.max(0, Math.trunc(Number(aidTroops)) || 0), c, displayNow)}</span>
              </button>
              <button
                type="button"
                data-testid="aid-decline"
                data-action="declineAid"
                data-aid-call-id={c.id}
                disabled={busy}
                onClick={() => postRespond(c.id, false)}
                className="min-h-11 rounded-lg border border-line-strong bg-surf-3 px-3 py-2 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surf-4 hover:text-text-1 disabled:opacity-50"
              >
                Hold back
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Decided orders stand (settled state, not actions). */}
      {decided.length > 0 && (
        <ul className="mt-2 space-y-0.5" data-testid="decision-history">
          {decided.map((d) => (
            <li key={d.id} className="flex items-center gap-1.5 text-[11px] text-text-3">
              <Icon name="check" size={12} /> {d.text}
            </li>
          ))}
        </ul>
      )}

      {/* The once-only window-clock announcements (§A.5) — silent in between,
          and never a second announcement for the same threshold. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="window-clock-announce">
        {announce}
      </p>

      <div aria-live="polite">
        {notice && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ember-soft" data-testid="decision-notice">
            <Icon name={notice.info ? "lock" : "check"} size={14} /> {notice.text}
          </p>
        )}
      </div>
      <div role="alert">
        {error && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-danger-soft" data-testid="decision-error">
            <Icon name="x" size={14} /> {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** The detail pane — composition both sides, ticking casualties, the line. */
function BattleDetail({ state, battle, now, token, onDecision, tutorialEnabled = true, muted = false }: {
  state: GameState;
  battle: Battle;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  tutorialEnabled?: boolean;
  /** The sound layer's mute (the Cradle sheet's Sound row). */
  muted?: boolean;
}) {
  const m = battleMoment(battle, now);
  const chip = CHIP_META[m.chip];
  const end = battleEndAt(battle);
  const aCas = Math.min(m.casualties.attacker, Math.trunc(battle.attacker.troops));
  const dCas = Math.min(m.casualties.defender, Math.trunc(battle.defender.troops));
  const linePct = Math.round(m.attackerWinProb * 100);
  const me = { colonyId: state.gameId ?? "", colonyName: state.playerName ?? "" };
  const side = ourSide(battle, me);
  // The tutorial narrates only OUR fight (§12.1) and only while it is live.
  const tutorial = useBattleTutorial(battle, side, now, tutorialEnabled && side !== null && battle.status === "active");
  // The voice reads the same cue the plate renders — no second observer.
  const voice = useVoiceLayer({
    cue: tutorial.cue,
    battleId: battle.id,
    muted,
    suppressed: tutorial.suppressed,
    stage: state.prologue?.stage ?? null,
    completed: state.prologue?.completed ?? false,
  });
  /** The page's own decision hook and the tutorial's listener, in that order. */
  const onTutorialDecision = (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => {
    tutorial.onDecision(d);
    onDecision?.(d);
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-1">{battle.zoneName || battle.zoneId}</h3>
          <p className="text-xs text-text-3">Power {battle.forcePower.attacker} vs {battle.forcePower.defender} · gap {Math.round(m.gap * 100)}%</p>
        </div>
        <span
          data-tutorial-target="live-state-chip"
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${chip.cls} ${tutorialRing(tutorial.target, "live-state-chip")}`}
        >
          {chip.label}
        </span>
      </div>

      {/* The narrator, the Leaders and the heroes speak here (§12.4). */}
      {(tutorial.cue || tutorial.showControls) && (
        <TutorialCueLayer
          cue={tutorial.cue}
          waiting={tutorial.waiting}
          suppressed={tutorial.suppressed}
          muted={muted}
          voiceMode={voice.mode}
          onStep={tutorial.step}
          onSuppress={tutorial.suppress}
          onResume={tutorial.resume}
          onReplay={() => {
            tutorial.replay();
            voiceEngine.replay(tutorial.cue?.id ?? null);
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-text-2">
        <span>Elapsed <b className="text-text-1">{fmtClock(m.elapsedMs)}</b></span>
        <span>Ends in <b className="text-text-1">{fmtClock(m.remainingMs)}</b></span>
        <span>Casualties are counted every minute</span>
        <span className="text-right">Ends by {new Date(end).toLocaleTimeString()}</span>
      </div>

      {/* the shifting line */}
      <div data-tutorial-target="battle-line" className={tutorialRing(tutorial.target, "battle-line")}>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-ember-soft"><Icon name="sword" size={14} /> {battle.attacker.colonyName}</span>
          <span className="text-text-3">{lineLabel(battle.attacker.colonyName, linePct)}</span>
          <span className="flex items-center gap-1.5 text-hazard-soft"><Icon name="shield" size={14} /> {battle.defender.colonyName}</span>
        </div>
        <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-surf-4" role="img" aria-label={lineAriaLabel(battle.attacker.colonyName, linePct)}>
          <div className="bg-ember/80 transition-all duration-1000" style={{ width: `${linePct}%` }} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <ForceBlock state={state} force={battle.attacker} power={battle.forcePower.attacker} tag="attacker" focusTarget={tutorial.target} />
          <p className="mt-1 text-right text-xs text-text-2">{aCas} casualties</p>
        </div>
        <div>
          <ForceBlock state={state} force={battle.defender} power={battle.forcePower.defender} tag="defender" focusTarget={tutorial.target} />
          <p className="mt-1 text-right text-xs text-text-2">{dCas} casualties</p>
        </div>
      </div>

      {battle.status === "active" && side && (
        <DecisionPanel
          state={state}
          battle={battle}
          now={now}
          side={side}
          token={token}
          colonyId={state.gameId ?? ""}
          colonyName={state.playerName ?? ""}
          onDecision={onTutorialDecision}
          focusTarget={tutorial.target}
        />
      )}
    </>
  );
}

/** The append-only report ledger, newest first (the §7 History Book's raw
 *  material — composition, duration, casualties, result). */
function BattleLog({ reports }: { reports: BattleReport[] }) {
  if (reports.length === 0) {
    return (
      <p className="text-xs text-text-3">
        No battles decided yet. Every resolved battle appends a report here — the History Book starts with these.
      </p>
    );
  }
  const sorted = [...reports].sort((a, b) => b.resolvedAt - a.resolvedAt);
  return (
    <ul className="space-y-2" data-tutorial-target="battle-log">
      {sorted.map((r) => (
        <li key={r.battleId} className="rounded-lg border border-line bg-surf-2/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-1">{r.zoneName || r.zoneId}</span>
            <span className={`text-xs font-semibold ${
              r.outcome === "attacker_victory" ? "text-ember-soft"
                : r.outcome === "defender_victory" ? "text-hazard-soft"
                  : "text-text-2"
            }`}>
              {r.outcome === "attacker_victory" ? `${r.attacker.colonyName} wins`
                : r.outcome === "defender_victory" ? `${r.defender.colonyName} holds`
                  : "Standoff — both sides break off"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-3">
            Fought {fmtClock(r.durationMs)} · power {r.attacker.power} vs {r.defender.power} · casualties{" "}
            {r.attacker.casualties}/{r.defender.casualties}
          </p>
          <p className="mt-1 text-[11px] text-text-3">
            {r.attacker.heroNames.join(", ") || "no squad"} vs {r.defender.heroNames.join(", ") || "no squad"} ·{" "}
            {r.attacker.troops} vs {r.defender.troops} troops · {new Date(r.resolvedAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The Battles tab root: live list + detail, then the report log below. */
export default function BattlesTab({ state, now, token, onDecision, tutorial, muted = false }: {
  state: GameState;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  /** The Act I guided narration (§12) — on by default, skippable in the view. */
  tutorial?: boolean;
  /** The sound layer's mute (the Cradle sheet's Sound row) — the voice gate. */
  muted?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-1"><Icon name="sword" size={20} /> Battles</h2>
        <p className="text-xs text-text-2">
          The fights running on your fronts. Watch how the enemy fields their force — every report teaches you
          something worth bringing next time.
        </p>
      </div>
      <ActiveBattles state={state} now={now} token={token} onDecision={onDecision} tutorialEnabled={tutorial ?? true} muted={muted} />
      <div className="rounded-xl border border-line bg-surf-2/40 p-4">
        <h3 className="mb-2 text-sm font-semibold text-text-1">Battle log</h3>
        <BattleLog reports={state.battleReports ?? []} />
      </div>
    </div>
  );
}