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
  DECISION_ACTIONS,
  answerableAidCalls,
  clientReserves,
  decidedSummary,
  decisionRows,
  issuePayload,
  ourSide,
  plainDecisionError,
  respondPayload,
} from "../game/battle-decisions";
import { familyFor } from "../game/armory";
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
  TutorialEvent,
  TutorialPrefs,
  TutorialState,
  UiTarget,
} from "../game/war/tutorial-cues";

const CHIP_META: Record<string, { label: string; cls: string }> = {
  stalemate: { label: "Stalemate", cls: "bg-sky-400/15 text-sky-200 border-sky-400/30" },
  pressing: { label: "Pressing", cls: "bg-amber-400/15 text-amber-200 border-amber-400/30" },
  "rout-risk": { label: "Rout risk", cls: "bg-red-400/15 text-red-200 border-red-400/30" },
};

/** mm:ss / h:mm:ss clock for elapsed & ETA. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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
        <li key={h.id} className="text-xs text-gray-300">
          <span className="text-gray-400">{h.role} · L{h.level}</span> {h.name}
          {h.specialization ? <span className="text-purple-300"> — {h.specialization}</span> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-gray-500">No hero squad committed.</p>
  );
  const weapons = force.weapons.length > 0 ? (
    <ul className="space-y-0.5">
      {force.weapons.map((k, i) => (
        <li key={i} className="text-xs text-gray-300">{weaponLabel(state, k)}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-gray-500">No weapon kits fielded.</p>
  );
  return (
    <div
      className={`rounded-lg border border-white/10 bg-black/30 p-3 ${tutorialRing(focusTarget ?? null, tag === "attacker" ? "force-attacker" : "force-defender")}`}
      data-tutorial-target={tag === "attacker" ? "force-attacker" : "force-defender"}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${tag === "attacker" ? "text-amber-200" : "text-cyan-200"}`}>
          {tag === "attacker" ? "⚔️ Attacker" : "🛡️ Defender"}
        </span>
        <span className="truncate text-xs text-gray-400">{force.colonyName}</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Hero squad</p>
          {squad}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Weapons</p>
          {weapons}
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span className="text-gray-400">Troops <b className="text-gray-200">{Math.trunc(force.troops)}</b></span>
          <span className="text-gray-400">FOB <b className="text-gray-200">{fobLabel(force.fobStage)}</b></span>
          <span className="text-gray-400">Power <b className="text-gray-200">{power}</b></span>
        </div>
      </div>
    </div>
  );
}

/** The live list + detail for ongoing battles. */
function ActiveBattles({ state, now, token, onDecision, tutorialEnabled }: {
  state: GameState;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  tutorialEnabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = (state.battles ?? []).filter((b) => b.status === "active").sort((a, b) => a.startedAt - b.startedAt);
  const selected = active.find((b) => b.id === selectedId) ?? active[0] ?? null;

  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center">
        <p className="text-3xl">⚔️</p>
        <p className="mt-2 text-sm text-gray-300">No battles are running on your fronts.</p>
        <p className="mt-1 text-xs text-gray-500">
          When a march meets a defending force, the battle opens here as a real-time entity — strength in, strength out,
          casualties ticking per resolution interval, a report when it falls. This is the engine The Fall is built on.
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
                selected?.id === b.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-100">{b.zoneName || b.zoneId}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${chip.cls}`}>{chip.label}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {b.attacker.colonyName} <span className="text-gray-600">vs</span> {b.defender.colonyName}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {Math.trunc(b.attacker.troops)}/{Math.max(0, b.defender.troops)} troops · {fmtClock(m.elapsedMs)} elapsed · {fmtClock(m.remainingMs)} left
              </p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
          <BattleDetail state={state} battle={selected} now={now} token={token} onDecision={onDecision} tutorialEnabled={tutorialEnabled} />
        </div>
      )}
    </div>
  );
}


// ============================================================================
// DECISION PANEL (The Fall Step 3 slice 1 — battle-side §15 B11/B12).
//
// Renders the live decision window(s) for OUR side of a battle: a gold-bordered
// panel, one live clock per open window, and one button per reachable action
// (reinforce / hold / callAid / withdrawal / retreat). Unreachable actions
// render DISABLED with their reason — never hidden silently. Incoming aid
// beacons (teammate side, B11) render March-to-aid / Decline.
//
// TUTORIAL SEAM (Step 3 slice 2 owns the narrator cues — NO tutorial copy here):
// every button carries a stable `data-testid` + `data-action`, each open window
// container carries `data-testid="decision-window" data-window-id=<id>`, and the
// panel accepts an optional `onDecision` callback fired AFTER a successful post
// with { battleId, side, windowId, action }. The prologue tutorial layer can
// (a) query these attributes to highlight/sequence buttons, and (b) pass
// onDecision to advance its beat machine. Props `token`/`colonyId`/`colonyName`
// default to the local session (localStorage token, state's own identity) so
// existing call sites keep working; tests inject them directly.
function DecisionPanel({
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
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAid, setConfirmAid] = useState<string | null>(null);
  const [confirmRetreat, setConfirmRetreat] = useState<string | null>(null);
  const [troopsByWindow, setTroopsByWindow] = useState<Record<string, string>>({});
  const [aidTroops, setAidTroops] = useState<string>("");

  const effToken = token ?? (() => { try { return localStorage.getItem("deepspace_session_token") ?? ""; } catch { return ""; } })();
  const me = {
    colonyId: colonyId ?? state.gameId ?? "",
    colonyName: colonyName ?? state.playerName ?? "Unnamed Colony",
  };
  const reserves = clientReserves({
    reserveTroops: state.warReserve?.troops ?? 0,
    energy: state.warReserve?.energy ?? 0,
  });
  const rows = decisionRows(battle, side, now, reserves);
  const decided = battle.windows
    .filter((w) => w.side === side)
    .map((w) => {
      const d = (battle.decisions ?? []).find((dd) => dd.windowId === w.id);
      return d ? { id: w.id, text: decidedSummary({ id: w.id, kind: w.kind, side: w.side, open: false, decided: true, action: d.action, issuedAt: d.issuedAt, opensAt: w.opensAt, closesAt: w.closesAt }) } : null;
    })
    .filter((x): x is { id: string; text: string } => !!x);
  const aidCalls = answerableAidCalls(battle, now).filter((c) => c.callerSide !== side);
  const busy = busyKey !== null;

  async function postIssue(windowId: string, action: "reinforce" | "hold" | "withdrawal" | "retreat" | "callAid", troops: number) {
    // respondAid never rides the issue endpoint (it posts via battleRespondFn) —
    // the type guard keeps the row renderer honest if the engine ever lists it.
    if (action === "respondAid") return;
    const key = `issue:${windowId}:${action}`;
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await battleIssueFn({ data: issuePayload({ token: effToken, battleId: battle.id, side, windowId, action, troops }) });
      if (res && (res as { ok?: boolean }).ok) {
        setNotice(action === "callAid" ? "Beacon lit — a teammate can march to you now." : action === "retreat" ? "Retreat sounded — the army breaks off." : "Order sent — watch the next poll.");
        setConfirmAid(null);
        setConfirmRetreat(null);
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
      // Decline is local-only: no march, no lock, no server write — the beacon
      // stays open for another teammate. Announced so the choice is visible.
      setNotice("Passed — the beacon stays lit for another colony.");
      setError(null);
      return;
    }
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const res = await battleRespondFn({ data: respondPayload({ token: effToken, battleId: battle.id, aidCallId, me, troops: Math.max(0, Math.trunc(Number(aidTroops)) || 0) }) });
      if (res && (res as { ok?: boolean }).ok) {
        setNotice("Marching — your force joins the fight when travel time lands.");
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

  const meta = Object.fromEntries(DECISION_ACTIONS.map((a) => [a.action, a]));
  return (
    <section
      aria-label="Battle orders"
      data-testid="decision-panel"
      data-battle-id={battle.id}
      data-side={side}
      data-tutorial-target="decision-panel"
      className={`rounded-xl border border-amber-400/50 bg-amber-400/5 p-3 ${tutorialRing(focusTarget ?? null, "decision-panel")}`}
    >
      <h4 className="text-sm font-semibold text-amber-100">Battle orders</h4>
      <p className="mt-0.5 text-[11px] text-gray-400">
        Reserve: {reserves.reserveTroops} troops · {reserves.energy} war energy. Orders land on the next poll.
      </p>

      {rows.length === 0 && (
        <p className="mt-2 text-xs text-gray-500" data-testid="decision-quiet">
          No open order windows right now — the next milestone opens one. Decided orders stand below.
        </p>
      )}

      {rows.map(({ window: w, actions, msLeft }) => (
        <div key={w.id} data-testid="decision-window" data-window-id={w.id} className="mt-2 rounded-lg border border-amber-400/30 bg-black/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-200">
              {w.kind === "edge" ? "Rout-risk opening" : "Milestone opening"} · your {side} force
            </span>
            <span className="text-xs text-amber-200" aria-live="polite" data-testid={`window-clock-${w.id}`}>
              closes in {fmtClock(msLeft)}
            </span>
          </div>

          {/* Reinforce / hold / aid go first (the taught beats); withdrawal then retreat. */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {actions.map(({ action, eligible, reason }) => {
              const m = meta[action];
              const k = `issue:${w.id}:${action}`;
              const isBusy = busyKey === k;
              const disabled = !eligible || busy;
              if (action === "callAid") {
                return (
                  <button
                    key={action}
                    type="button"
                    data-testid="decision-callAid"
                    data-action={action}
                    data-window-id={w.id}
                    data-tutorial-target="decision-callAid"
                    disabled={disabled}
                    title={eligible ? m.hint : reason ?? ""}
                    aria-label={eligible ? m.label : `${m.label} (unavailable: ${reason ?? "not now"})`}
                    onClick={() => (confirmAid === w.id ? postIssue(w.id, action, 0) : (setConfirmAid(w.id), setError(null)))}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                      eligible ? "border-amber-400/60 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20" : "cursor-not-allowed border-white/10 bg-white/5 text-gray-500"
                    } ${tutorialRing(focusTarget ?? null, "decision-callAid")}`}
                  >
                    {isBusy ? "Lighting..." : confirmAid === w.id ? "Confirm \u2014 light it?" : <><span aria-hidden="true">🕯️</span> {m.label}</>}
                  </button>
                );
              }
              if (action === "retreat") {
                return (
                  <button
                    key={action}
                    type="button"
                    data-testid="decision-retreat"
                    data-action={action}
                    data-window-id={w.id}
                    data-tutorial-target="decision-retreat"
                    disabled={disabled}
                    title={eligible ? m.hint : reason ?? ""}
                    aria-label={eligible ? m.label : `${m.label} (unavailable: ${reason ?? "not now"})`}
                    onClick={() => (confirmRetreat === w.id ? postIssue(w.id, action, 0) : (setConfirmRetreat(w.id), setError(null)))}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                      eligible ? "border-red-400/60 bg-red-400/10 text-red-100 hover:bg-red-400/20" : "cursor-not-allowed border-white/10 bg-white/5 text-gray-500"
                    } ${tutorialRing(focusTarget ?? null, "decision-retreat")}`}
                  >
                    {isBusy ? "Sounding…" : confirmRetreat === w.id ? "Confirm — break off?" : m.label}
                  </button>
                );
              }
              if (action === "reinforce") {
                return (
                  <div key={action} className="col-span-2 sm:col-span-1">
                    <div className="flex gap-1.5">
                      <label className="sr-only" htmlFor={`troops-${w.id}`}>Reserve troops to send</label>
                      <input
                        id={`troops-${w.id}`}
                        data-testid={`reinforce-troops-${w.id}`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Troops"
                        value={troopsByWindow[w.id] ?? ""}
                        onChange={(e) => setTroopsByWindow((t) => ({ ...t, [w.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                        disabled={!eligible || busy}
                        className="w-20 rounded-lg border border-white/10 bg-black/50 px-2 py-2 text-xs text-gray-100 placeholder:text-gray-600 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        data-testid="decision-reinforce"
                        data-action={action}
                        data-window-id={w.id}
                        data-tutorial-target="decision-reinforce"
                        disabled={disabled || isBusy}
                        title={eligible ? m.hint : reason ?? ""}
                        aria-label={eligible ? m.label : `${m.label} (unavailable: ${reason ?? "not now"})`}
                        onClick={() => postIssue(w.id, action, Math.max(0, Math.trunc(Number(troopsByWindow[w.id])) || 0))}
                        className={`flex-1 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                          eligible ? "border-amber-400/60 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20" : "cursor-not-allowed border-white/10 bg-white/5 text-gray-500"
                        } ${tutorialRing(focusTarget ?? null, "decision-reinforce")}`}
                      >
                        {isBusy ? "Sending…" : m.label}
                      </button>
                    </div>
                    {!eligible && reason && <p className="mt-1 text-[11px] text-gray-500">{reason}</p>}
                  </div>
                );
              }
              return (
                <button
                  key={action}
                  type="button"
                  data-testid={action === "hold" ? "decision-hold" : "decision-withdrawal"}
                  data-action={action}
                  data-window-id={w.id}
                  data-tutorial-target={action === "hold" ? "decision-hold" : "decision-withdrawal"}
                  disabled={disabled}
                  title={eligible ? m.hint : reason ?? ""}
                  aria-label={eligible ? m.label : `${m.label} (unavailable: ${reason ?? "not now"})`}
                  onClick={() => postIssue(w.id, action, 0)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                    eligible ? "border-white/20 bg-white/5 text-gray-100 hover:bg-white/10" : "cursor-not-allowed border-white/10 bg-white/5 text-gray-500"
                  } ${tutorialRing(focusTarget ?? null, action === "hold" ? "decision-hold" : "decision-withdrawal")}`}
                >
                  {isBusy ? "Sending…" : m.label}
                </button>
              );
            })}
          </div>
          {/* Reasons for disabled non-reinforce actions (reinforce renders its own). */}
          {actions.filter((a) => a.action !== "reinforce" && !a.eligible && a.reason).map(({ action, reason }) => (
            <p key={action} className="mt-1 text-[11px] text-gray-500" data-testid={`decision-reason-${action}`}>
              {meta[action].label}: {reason}
            </p>
          ))}
          {confirmAid === w.id && (
            <p className="mt-1.5 text-[11px] text-amber-200/90" data-testid={`aid-confirm-${w.id}`}>
              Lighting the beacon costs 10 war energy. Press again to confirm — a teammate can then march to you.
            </p>
          )}
          {confirmRetreat === w.id && (
            <p className="mt-1.5 text-[11px] text-red-200/90" data-testid={`retreat-confirm-${w.id}`}>
              Retreat ends this battle as a loss, most of the army lives. Press again to confirm.
            </p>
          )}
        </div>
      ))}

      {/* Incoming aid beacons from teammates (B11) — answerable by anyone viewing. */}
      {aidCalls.length > 0 && (
        <div
          className={`mt-2 rounded-lg border border-sky-400/30 bg-sky-400/5 p-2.5 ${tutorialRing(focusTarget ?? null, "aid-panel")}`}
          data-testid="aid-panel"
          data-tutorial-target="aid-panel"
        >
          <p className="text-xs font-medium text-sky-100">Aid beacons — a teammate needs you</p>
          {aidCalls.map((c) => (
            <div key={c.id} data-testid="aid-call" data-aid-call-id={c.id} className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-gray-300">
                {c.callerSide === "attacker" ? "Attacker" : "Defender"} beacon · help arrives in {fmtClock(Math.max(0, c.arrivalAt - now))}
              </span>
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
                className="w-20 rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-600 disabled:opacity-50"
              />
              <button
                type="button"
                data-testid="aid-accept"
                data-action="respondAid"
                data-aid-call-id={c.id}
                disabled={busy}
                onClick={() => postRespond(c.id, true)}
                className="rounded-lg border border-sky-400/60 bg-sky-400/10 px-2.5 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/20 disabled:opacity-50"
              >
                {busyKey === `respond:${c.id}:accept` ? "Marching…" : "March to aid"}
              </button>
              <button
                type="button"
                data-testid="aid-decline"
                data-action="declineAid"
                data-aid-call-id={c.id}
                disabled={busy}
                onClick={() => postRespond(c.id, false)}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Decided orders stand (settled state, not actions). */}
      {decided.length > 0 && (
        <ul className="mt-2 space-y-0.5" data-testid="decision-history">
          {decided.map((d) => (
            <li key={d.id} className="text-[11px] text-gray-500">✓ {d.text}</li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {error && <p className="mt-2 text-xs text-red-300" data-testid="decision-error" role="alert">{error}</p>}
        {notice && <p className="mt-2 text-xs text-emerald-300" data-testid="decision-notice">{notice}</p>}
      </div>
    </section>
  );
}

/** The detail pane — composition both sides, ticking casualties, the line. */
function BattleDetail({ state, battle, now, token, onDecision, tutorialEnabled = true }: {
  state: GameState;
  battle: Battle;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  tutorialEnabled?: boolean;
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
  /** The page's own decision hook and the tutorial's listener, in that order. */
  const onTutorialDecision = (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => {
    tutorial.onDecision(d);
    onDecision?.(d);
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-100">{battle.zoneName || battle.zoneId}</h3>
          <p className="text-xs text-gray-500">Power {battle.forcePower.attacker} vs {battle.forcePower.defender} · gap {Math.round(m.gap * 100)}%</p>
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
          onStep={tutorial.step}
          onSuppress={tutorial.suppress}
          onResume={tutorial.resume}
          onReplay={tutorial.replay}
        />
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
        <span>Elapsed <b className="text-gray-200">{fmtClock(m.elapsedMs)}</b></span>
        <span>Ends in <b className="text-gray-200">{fmtClock(m.remainingMs)}</b></span>
        <span className="text-gray-400">Casualties tick per ~1 min resolution interval</span>
        <span className="text-right">Wall-clock end {new Date(end).toLocaleTimeString()}</span>
      </div>

      {/* the shifting line */}
      <div data-tutorial-target="battle-line" className={tutorialRing(tutorial.target, "battle-line")}>
        <div className="flex items-center justify-between text-xs">
          <span className="text-amber-200">{battle.attacker.colonyName}</span>
          <span className="text-gray-400">line — attacker {linePct}%</span>
          <span className="text-cyan-200">{battle.defender.colonyName}</span>
        </div>
        <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`Attacker win probability ${linePct} percent`}>
          <div className="bg-amber-400/80 transition-all duration-1000" style={{ width: `${linePct}%` }} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <ForceBlock state={state} force={battle.attacker} power={battle.forcePower.attacker} tag="attacker" focusTarget={tutorial.target} />
          <p className="mt-1 text-right text-xs text-gray-400">{aCas} casualties</p>
        </div>
        <div>
          <ForceBlock state={state} force={battle.defender} power={battle.forcePower.defender} tag="defender" focusTarget={tutorial.target} />
          <p className="mt-1 text-right text-xs text-gray-400">{dCas} casualties</p>
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
      <p className="text-xs text-gray-500">
        No battles decided yet. Every resolved battle appends a report here — the History Book starts with these.
      </p>
    );
  }
  const sorted = [...reports].sort((a, b) => b.resolvedAt - a.resolvedAt);
  return (
    <ul className="space-y-2" data-tutorial-target="battle-log">
      {sorted.map((r) => (
        <li key={r.battleId} className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-100">{r.zoneName || r.zoneId}</span>
            <span className={`text-xs font-semibold ${
              r.outcome === "attacker_victory" ? "text-amber-200"
                : r.outcome === "defender_victory" ? "text-cyan-200"
                  : "text-gray-400"
            }`}>
              {r.outcome === "attacker_victory" ? `⚔️ ${r.attacker.colonyName} wins`
                : r.outcome === "defender_victory" ? `🛡️ ${r.defender.colonyName} holds`
                  : "Standoff — both sides break off"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Fought {fmtClock(r.durationMs)} · power {r.attacker.power} vs {r.defender.power} · casualties{" "}
            {r.attacker.casualties}/{r.defender.casualties}
          </p>
          <p className="mt-1 text-[11px] text-gray-600">
            {r.attacker.heroNames.join(", ") || "no squad"} vs {r.defender.heroNames.join(", ") || "no squad"} ·{" "}
            {r.attacker.troops} vs {r.defender.troops} troops · {new Date(r.resolvedAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The Battles tab root: live list + detail, then the report log below. */
export default function BattlesTab({ state, now, token, onDecision, tutorial }: {
  state: GameState;
  now: number;
  token?: string;
  onDecision?: (d: { battleId: string; side: BattleSide; windowId: string; action: string }) => void;
  /** The Act I guided narration (§12) — on by default, skippable in the view. */
  tutorial?: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">⚔️ Battles</h2>
        <p className="text-xs text-gray-500">
          Real-time battles on your fronts — live over the 4 s poll, no websockets. Watch, learn how the enemy fields,
          and rebuild your squad against what you observe.
        </p>
      </div>
      <ActiveBattles state={state} now={now} token={token} onDecision={onDecision} tutorialEnabled={tutorial ?? true} />
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Battle log</h3>
        <BattleLog reports={state.battleReports ?? []} />
      </div>
    </div>
  );
}