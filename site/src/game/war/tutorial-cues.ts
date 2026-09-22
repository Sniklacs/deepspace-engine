// TUTORIAL CUES — The Fall, Step 3 slice 2: the Act I guided in-battle tutorial
// (opening-prologue-spec.md §12.1–§12.4; battle-side-rvr-spec.md §15 B11/B12).
//
// The owner's directive (§12): "when we throw them into the middle of this we
// need a tutorial to lay it all out — what they're supposed to do, how to do
// it, when to send reinforcements, when to ask for reinforcements, and what to
// do when they're getting pummeled." §12 resolves the tension by making the
// tutorial DIEGETIC: the narrator and the Watcher Leaders speak over the live
// battle, in-universe, in character. No manual, no instruction screen.
//
// THIS MODULE IS THE CUE + COPY LAYER ONLY. Every line here is the voice-acted
// script's own text (design/opening-script.md, Beat 1.2 "Battle One — the
// diegetic tutorial" + Beat 1.4 "guidance fades"), tagged with the speaker the
// script gives it. Nothing is invented; nothing speaks that the script doesn't.
// The audio pass (slice 3+) reads `cue.speaker.id` + `cue.line` off this same
// table and plays the matching recorded take — no audio files here.
//
// Discipline of this module (all asserted by prologue-tests/tutorial-verify.ts):
//   • PURE — no React, no DOM, no Math.random, no Date.now(), no store/auth
//     import. `observeBattle` + `advanceTutorial` are fold functions over an
//     append-only event log: the same log ALWAYS yields the same cue sequence.
//   • OBSERVER ONLY — it never issues, validates or gates a battle decision.
//     It reads the public battle entity (battleMoment / windowsForView) and
//     reports cues; the decision engine is untouched.
//   • PROGRESSIVE SCAFFOLDING (§12.1) — battle one is fully guided, battle two
//     thins to a handful of cues, battle three onward is silent. See CUES[].tiers.
//   • SURVIVABLE FIRST (§12.3) — the pummeled lesson (rout-risk chip + edge
//     window) is taught in a fight the player can still win, so that when the
//     unwinnable Fall comes the tools are already known.
//   • SKIP / REPLAY (§12.4) — suppressing is instant and total, replay re-folds
//     the battle's own event log from the top. Nothing is ever locked away.
//   • NO PLAYER-FACING RULE LANGUAGE — the copy is in-universe; guardrail words
//     (never in the script) are kept out by construction (harness-scanned).
// Pure module: imports only the public battle engine + its types.
import { battleMoment, windowsForView } from "./battle-engine";
import { BATTLES_CONFIG } from "./war-types";
import type { Battle, BattleSide } from "./war-types";

// ============================================================================
// §0 CONFIG — one block, tunable numbers only (rules below never change with
// calibration).
// ============================================================================
export const TUTORIAL_CONFIG = {
  /** Battle-one marks at which the "command" teaching beats land: squad
   *  composition first, the skill-timing nudge last (Beat 1.2 order). */
  elapsedMarks: [60_000, 90_000, 120_000] as const,
  /** Guidance tiers: 1 = fully guided (battle one), 2 = thinned (battle two),
   *  3 = hands-off (battle three onward — the engine plays honestly, no cues). */
  maxGuidedTier: 2,
  /** Where the player's skip/off choice + battles-seen count persist (one
   *  encoded blob — see encodeTutorialPrefs). */
  storageKeys: {
    prefs: "deepspace_tutorial",
  },
} as const;

// ============================================================================
// §1 SPEAKERS — the cast the script gives these lines (opening-script §1).
// `id` is the audio-pass handle; `name`/`title` are the caption the player sees.
// ============================================================================
export type SpeakerKind = "narrator" | "leader" | "hero";
export interface TutorialSpeaker {
  id: string;
  name: string;
  /** The script's honorific form — "the Marshal", "the Steward". */
  title?: string;
  kind: SpeakerKind;
}

export const TUTORIAL_SPEAKERS: Record<string, TutorialSpeaker> = {
  narrator: { id: "narrator", name: "The Narrator", kind: "narrator" },
  kael: { id: "kael", name: "Kael", title: "the Steward", kind: "leader" },
  serev: { id: "serev", name: "Serev", title: "the Marshal", kind: "leader" },
  vyra: { id: "vyra", name: "Vyra", title: "the Scholar", kind: "leader" },
  miren: { id: "miren", name: "Miren", title: "the Quartermaster", kind: "leader" },
  delen: { id: "delen", name: "Delen", title: "the Purifier", kind: "leader" },
  semira: { id: "semira", name: "Semira the Revealer", kind: "hero" },
  vesper: { id: "vesper", name: "Vesper the Syllabus", kind: "hero" },
};

/** The caption line the UI renders above the spoken text. */
export function speakerLabel(speaker: TutorialSpeaker): string {
  return speaker.title ? `${speaker.name} — ${speaker.title}` : speaker.name;
}

// ============================================================================
// §2 WHAT THE TUTORIAL TEACHES (§12.2) — the decision windows, one action key
// per order the decision panel can post, plus the two reading lessons.
// ============================================================================
export type TutorialAction = "reinforce" | "hold" | "callAid" | "withdrawal" | "retreat" | "respondAid";
export type Chip = "stalemate" | "pressing" | "rout-risk";
/** The lesson families — one cue per family per trigger, so a lesson is never
 *  told twice in the same battle. */
export type TutorialLesson = "read" | "read-chip" | "command" | "reinforce-hold" | "pummeled" | "recap";

/** Every UI element a cue may point at. Each one is stamped on the real DOM in
 *  BattlesTab.tsx as `data-tutorial-target="<target>"` — the harness asserts the
 *  two halves stay in sync, so a cue can never point at nothing. */
export type UiTarget =
  | "live-state-chip"
  | "battle-line"
  | "force-attacker"
  | "force-defender"
  | "decision-panel"
  | "decision-reinforce"
  | "decision-hold"
  | "decision-callAid"
  | "decision-withdrawal"
  | "decision-retreat"
  | "aid-panel"
  | "battle-log";

/** The element that lights up when a cue teaches this order. */
export const UI_TARGET_BY_ACTION: Record<TutorialAction, UiTarget> = {
  reinforce: "decision-reinforce",
  hold: "decision-hold",
  callAid: "decision-callAid",
  withdrawal: "decision-withdrawal",
  retreat: "decision-retreat",
  respondAid: "aid-panel",
};

// ============================================================================
// §3 TRIGGERS — what makes a cue speak. Every kind is observable from the
// public battle view (or from the decision the seam already reports).
// ============================================================================
export interface TutorialTrigger {
  kind: "battle-open" | "elapsed" | "window-open" | "chip" | "decision" | "resolve";
  /** elapsed: the exact mark (see TUTORIAL_CONFIG.elapsedMarks). */
  afterMs?: number;
  /** window-open: milestone (reinforce/hold/aid/withdraw/retreat) vs edge (the
   *  rout-risk opening — the pummeled moment). */
  windowKind?: "milestone" | "edge";
  /** chip: a specific live-state chip value. */
  chip?: Chip;
  /** decision: the order the player picked (any order when omitted). */
  action?: TutorialAction;
}

export interface TutorialCue {
  id: string;
  /** Which of the guidance tiers show this cue (1 = battle one, 2 = battle two). */
  tiers: readonly number[];
  lesson: TutorialLesson;
  trigger: TutorialTrigger;
  speaker: TutorialSpeaker;
  /** The script's line, verbatim (design/opening-script.md Beat 1.2/1.4). */
  line: string;
  pointsAt: UiTarget;
  teaches: readonly TutorialAction[];
  /** When the cue stops being the active one: a newer cue arriving
   *  ("supersede" — the voice keeps talking; only the latest line stands), the
   *  player acting on the window it teaches ("decision"), or the battle ending
   *  ("resolve"). The player may always step a cue by hand (stepTutorial). */
  retireOn: "supersede" | "decision" | "resolve";
}

// ============================================================================
// §4 THE CUE SCRIPT — ordered. Battle one (tier 1) is fully guided: read the
// fight → read the chip → command the squad → time the skill → reinforce/hold →
// get pummeled → aid call + withdrawal/retreat → the turn → the recap.
// Battle two (tier 2) keeps only the two lessons worth repeating plus the
// coach's one-line hand-off. Battle three onward: nothing (tier 3 is silent).
// ============================================================================
export const CUES: readonly TutorialCue[] = [
  {
    id: "read-the-fight",
    tiers: [1],
    lesson: "read",
    trigger: { kind: "battle-open" },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "Read the fight before you move. Sides, numbers, and the state of the line. That chip tells you the truth of it.",
    pointsAt: "live-state-chip",
    teaches: [],
    retireOn: "supersede",
  },
  {
    id: "read-the-chip",
    tiers: [1],
    lesson: "read-chip",
    trigger: { kind: "chip", chip: "stalemate" },
    speaker: TUTORIAL_SPEAKERS.serev,
    line: "Green on your side, red on theirs. The chip says Stalemate — no one's winning yet. When it tips to Pressing, someone is. When it turns Rout risk, that's you bleeding.",
    pointsAt: "live-state-chip",
    teaches: [],
    retireOn: "supersede",
  },
  {
    id: "command-the-squad",
    tiers: [1],
    lesson: "command",
    trigger: { kind: "elapsed", afterMs: 60_000 },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "Now command. Squad composition is the decision before the decision — choose who fights, and which skill to time.",
    pointsAt: "force-attacker",
    teaches: [],
    retireOn: "supersede",
  },
  {
    id: "semira-sees-the-flaw",
    tiers: [1],
    lesson: "command",
    trigger: { kind: "elapsed", afterMs: 90_000 },
    speaker: TUTORIAL_SPEAKERS.semira,
    line: "I see the flaw, Commander. Put me where it bends — the enemy's guard will open like a book it forgot it wrote.",
    pointsAt: "force-attacker",
    teaches: [],
    retireOn: "supersede",
  },
  {
    id: "time-the-skill",
    tiers: [1],
    lesson: "command",
    trigger: { kind: "elapsed", afterMs: 120_000 },
    speaker: TUTORIAL_SPEAKERS.kael,
    line: "Time the skill, don't spam it. One decision at the right second beats ten in a panic. We'll hold while you choose.",
    pointsAt: "decision-panel",
    teaches: [],
    retireOn: "decision",
  },
  {
    id: "the-line-is-bending",
    tiers: [1],
    lesson: "reinforce-hold",
    trigger: { kind: "window-open", windowKind: "milestone" },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "The line is bending. Reinforce, or hold — feed the fight, or trust the position. Decide.",
    pointsAt: "decision-reinforce",
    teaches: ["reinforce", "hold"],
    retireOn: "decision",
  },
  {
    id: "reinforce-or-hold-why",
    tiers: [1, 2],
    lesson: "reinforce-hold",
    trigger: { kind: "window-open", windowKind: "milestone" },
    speaker: TUTORIAL_SPEAKERS.serev,
    line: "Reinforce puts more weight on the line; hold spends nothing and trusts the ground. When it's a knife-fight at the breach, feed it. When the ground's worth more than the bodies, hold.",
    pointsAt: "decision-hold",
    teaches: ["reinforce", "hold"],
    retireOn: "decision",
  },
  {
    id: "pressing-ours",
    tiers: [1],
    lesson: "read-chip",
    trigger: { kind: "chip", chip: "pressing" },
    speaker: TUTORIAL_SPEAKERS.serev,
    line: "Pressing — ours. Good. Now the hard lesson while you're still winning it.",
    pointsAt: "live-state-chip",
    teaches: [],
    retireOn: "supersede",
  },
  {
    id: "pummeled-is-a-decision",
    tiers: [1, 2],
    lesson: "pummeled",
    trigger: { kind: "chip", chip: "rout-risk" },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "And now — you're getting pummeled. This is not the end. This is a decision. Two tools, both honest: call your world to the fight, or pull back in good order.",
    pointsAt: "decision-panel",
    teaches: ["callAid", "withdrawal", "retreat"],
    retireOn: "decision",
  },
  {
    id: "aid-call-rides-the-links",
    tiers: [1],
    lesson: "pummeled",
    trigger: { kind: "window-open", windowKind: "edge" },
    speaker: TUTORIAL_SPEAKERS.vesper,
    line: "The route back is in the syllabus, Commander. A steady withdrawal costs a rearguard but saves the army; a rout saves neither. Call aid and it comes riding the links — but it takes time to arrive. Time you buy by not breaking.",
    pointsAt: "decision-withdrawal",
    teaches: ["withdrawal", "retreat", "callAid"],
    retireOn: "decision",
  },
  {
    id: "pummeled-is-survivable",
    tiers: [1, 2],
    lesson: "pummeled",
    trigger: { kind: "window-open", windowKind: "edge" },
    speaker: TUTORIAL_SPEAKERS.serev,
    line: "Pummeled is survivable — if you choose before the chip turns. Withdraw to the high ground and call the world. We win this together or we don't win it.",
    pointsAt: "decision-callAid",
    teaches: ["callAid", "withdrawal", "retreat"],
    retireOn: "decision",
  },
  {
    id: "watch-it-turn",
    tiers: [1, 2],
    lesson: "pummeled",
    trigger: { kind: "decision", action: "callAid" },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "You were losing it. You chose. Now watch it turn.",
    pointsAt: "battle-line",
    teaches: [],
    retireOn: "resolve",
  },
  {
    id: "withdrew-in-order",
    tiers: [1, 2],
    lesson: "pummeled",
    trigger: { kind: "decision", action: "withdrawal" },
    speaker: TUTORIAL_SPEAKERS.narrator,
    line: "You were losing it. You chose. Now watch it turn.",
    pointsAt: "battle-line",
    teaches: [],
    retireOn: "resolve",
  },
  {
    id: "the-shape-of-it",
    tiers: [1, 2],
    lesson: "recap",
    trigger: { kind: "resolve" },
    speaker: TUTORIAL_SPEAKERS.kael,
    line: "That's the shape of it, sir. You read it, you fed it, you bent it back, and you called us when it mattered. We win the next one the same way — and the one after.",
    pointsAt: "battle-log",
    teaches: ["reinforce", "hold", "callAid", "withdrawal", "retreat"],
    retireOn: "supersede",
  },
  {
    id: "you-know-the-shape",
    tiers: [2],
    lesson: "recap",
    trigger: { kind: "battle-open" },
    speaker: TUTORIAL_SPEAKERS.serev,
    line: "You know the shape. Read it, feed it, call if it breaks. I'll say less now.",
    pointsAt: "decision-panel",
    teaches: ["reinforce", "hold", "callAid", "withdrawal", "retreat"],
    retireOn: "supersede",
  },
];

const CUE_BY_ID: Record<string, TutorialCue> = Object.fromEntries(CUES.map((c) => [c.id, c]));

export function cueById(id: string): TutorialCue | undefined {
  return CUE_BY_ID[id];
}

/** Every order key the seam can report (the five a window can issue + the
 *  co-op answer to someone else's beacon, which Act I's solo opening does not
 *  teach — that lesson belongs to the later co-op slice). */
export const TUTORIAL_ACTIONS: readonly TutorialAction[] = [
  "reinforce",
  "hold",
  "callAid",
  "withdrawal",
  "retreat",
  "respondAid",
];

/** Which cue teaches which order — the §12.2 promise, made checkable: every
 *  order a decision window can issue is taught somewhere. */
export const TEACHING_CUES: Record<TutorialAction, readonly string[]> = TUTORIAL_ACTIONS.reduce(
  (acc, a) => {
    acc[a] = CUES.filter((c) => c.teaches.includes(a)).map((c) => c.id);
    return acc;
  },
  {} as Record<TutorialAction, readonly string[]>,
);

// ============================================================================
// §5 EVENTS — the append-only log. `observeBattle` writes it from the public
// battle view; the decision seam (BattlesTab onDecision) contributes the
// "decision" entries. Nothing else may append.
// ============================================================================
export type TutorialOutcome = "win" | "loss" | "standoff";

export type TutorialEvent =
  | { kind: "battle-open"; battleId: string; at: number }
  | { kind: "elapsed"; battleId: string; afterMs: number; at: number }
  | { kind: "window-open"; battleId: string; windowId: string; windowKind: "milestone" | "edge"; windowIndex: number; at: number }
  | { kind: "chip"; battleId: string; chip: Chip; at: number }
  | { kind: "decision"; battleId: string; windowId: string; action: TutorialAction; at: number }
  | { kind: "resolve"; battleId: string; outcome: TutorialOutcome; at: number };

/** What a cue is waiting for — a trigger matches an event on its own terms. */
export function triggerMatches(trigger: TutorialTrigger, ev: TutorialEvent): boolean {
  if (trigger.kind !== ev.kind) return false;
  switch (ev.kind) {
    case "battle-open":
    case "resolve":
      return true;
    case "elapsed":
      return trigger.afterMs === ev.afterMs;
    case "window-open":
      return trigger.windowKind === undefined || trigger.windowKind === ev.windowKind;
    case "chip":
      return trigger.chip === undefined || trigger.chip === ev.chip;
    case "decision":
      return trigger.action === undefined || trigger.action === ev.action;
  }
}

// ============================================================================
// §6 OBSERVER — derive the event log from the public battle entity. Pure: given
// the same (watch, battle, now) it returns the same events. It never mutates
// the battle and never issues an order.
// ============================================================================
export interface BattleWatch {
  battleId: string | null;
  /** our side, so a resolution can be read as win / loss / standoff. */
  side: BattleSide | null;
  seenWindows: string[];
  lastChip: Chip | null;
  seenElapsedMarks: number[];
  resolvedReported: boolean;
}

export interface BattleObservation {
  watch: BattleWatch;
  events: TutorialEvent[];
}

export function freshWatch(): BattleWatch {
  return { battleId: null, side: null, seenWindows: [], lastChip: null, seenElapsedMarks: [], resolvedReported: false };
}

/** The milestone/edge index inside a window id (`w-milestone-0.25-attacker`,
 *  `w-edge-1-defender`) — used only for the event record, never for gating. */
export function windowIndexFromId(id: string): number {
  const parts = id.split("-");
  const frac = parts[2];
  if (parts[1] === "milestone") {
    const i = (BATTLES_CONFIG.windowMilestoneFracs as readonly number[]).indexOf(Number(frac));
    return i >= 0 ? i : 0;
  }
  const n = Number(frac);
  return Number.isFinite(n) ? n : 0;
}

/** Read one poll of the battle against the watch: emits the events that have
 *  newly become true, in a fixed order (open → elapsed → windows → chip →
 *  resolve) so the cue sequence is stable regardless of poll cadence. */
export function observeBattle(watch: BattleWatch, battle: Battle, now: number): BattleObservation {
  const events: TutorialEvent[] = [];
  let next: BattleWatch = watch;

  if (watch.battleId !== battle.id) {
    events.push({ kind: "battle-open", battleId: battle.id, at: now });
    next = { ...freshWatch(), battleId: battle.id, side: watch.side };
  }

  // time-in-battle marks
  const elapsed = Math.max(0, now - battle.startedAt);
  for (const mark of TUTORIAL_CONFIG.elapsedMarks) {
    if (elapsed >= mark && !next.seenElapsedMarks.includes(mark)) {
      events.push({ kind: "elapsed", battleId: battle.id, afterMs: mark, at: now });
      next = { ...next, seenElapsedMarks: [...next.seenElapsedMarks, mark] };
    }
  }

  // windows that just opened for our side (closesAt order = the panel's order)
  const openedNow = windowsForView(battle, now)
    .filter((w) => w.open && (w.side === watch.side || watch.side === null))
    .sort((a, b) => a.closesAt - b.closesAt)
    .filter((w) => !next.seenWindows.includes(w.id));
  for (const w of openedNow) {
    events.push({
      kind: "window-open",
      battleId: battle.id,
      windowId: w.id,
      windowKind: w.kind,
      windowIndex: windowIndexFromId(w.id),
      at: now,
    });
    next = { ...next, seenWindows: [...next.seenWindows, w.id] };
  }

  // the live state chip
  const chip = battleMoment(battle, now).chip;
  if (next.lastChip !== chip) {
    events.push({ kind: "chip", battleId: battle.id, chip, at: now });
    next = { ...next, lastChip: chip };
  }

  // resolution
  if (battle.status === "resolved" && !next.resolvedReported) {
    events.push({ kind: "resolve", battleId: battle.id, outcome: outcomeForSide(battle, next.side), at: now });
    next = { ...next, resolvedReported: true };
  }

  return { watch: next, events };
}

/** How the battle ended, from OUR side's point of view. */
export function outcomeForSide(battle: Battle, side: BattleSide | null): TutorialOutcome {
  const outcome = battle.result?.outcome ?? "standoff";
  if (outcome === "standoff") return "standoff";
  if (!side) return "standoff";
  const won = outcome === "attacker_victory" ? "attacker" : "defender";
  return won === side ? "win" : "loss";
}

// ============================================================================
// §7 THE FOLD — the tutorial's whole state machine. Pure, deterministic, and
// idempotent: re-folding the same log yields the same state, and a duplicate
// event (a re-posted decision, a re-polled chip) queues nothing new.
// ============================================================================
export interface TutorialState {
  /** which battle this run belongs to (null before the first battle opens). */
  battleId: string | null;
  /** battles opened so far — drives the guidance tier (§12.1 thinning). */
  battlesSeen: number;
  /** the tier currently in force (1 fully guided · 2 thinned · 3 silent). */
  guide: number;
  /** cue ids waiting to be shown, in order. */
  pending: string[];
  /** cue ids already queued in THIS battle — one telling per lesson, never twice. */
  shown: string[];
  /** the player turned guidance off (§12.4). Nothing queues while true. */
  suppressed: boolean;
}

export function freshTutorialState(battlesSeen = 0, suppressed = false): TutorialState {
  return { battleId: null, battlesSeen, guide: guideTierFor(battlesSeen + 1), pending: [], shown: [], suppressed };
}

/** Which tier a battle gets, by how many the player has already fought: the
 *  first is fully guided, the second thinned, the third onward silent. */
export function guideTierFor(battleOrdinal: number): number {
  return Math.min(TUTORIAL_CONFIG.maxGuidedTier + 1, Math.max(1, battleOrdinal));
}

export function cueIsVisible(cue: TutorialCue, guide: number): boolean {
  return cue.tiers.includes(guide);
}

/** Every cue an event could raise for the tier in force, in script order. A cue
 *  already queued in this battle is skipped (dedupe by id, never by lesson —
 *  two Leaders may share a lesson on purpose: the lesson and the why). */
export function cuesForEvent(events: readonly TutorialEvent[], guide: number): string[] {
  const out: string[] = [];
  for (const ev of events) {
    for (const cue of CUES) {
      if (cueIsVisible(cue, guide) && triggerMatches(cue.trigger, ev)) out.push(cue.id);
    }
  }
  return out;
}

function applyEvent(state: TutorialState, ev: TutorialEvent): TutorialState {
  if (ev.kind === "battle-open") {
    // A new battle: reset the per-battle dedupe and the queue, step the tier.
    const battlesSeen = state.battlesSeen + 1;
    const base: TutorialState = {
      ...state,
      battleId: ev.battleId,
      battlesSeen,
      guide: guideTierFor(battlesSeen),
      pending: [],
      shown: [],
    };
    return state.suppressed ? base : queueFor(base, [ev]);
  }
  // Events about a battle we are not tracking, or a muted run: no cue.
  if (state.battleId !== ev.battleId || state.suppressed) return state;

  let next = state;
  if (ev.kind === "decision") {
    next = { ...next, pending: next.pending.filter((id) => cueById(id)?.retireOn !== "decision") };
  } else if (ev.kind === "resolve") {
    next = {
      ...next,
      pending: next.pending.filter((id) => {
        const r = cueById(id)?.retireOn;
        return r !== "decision" && r !== "resolve";
      }),
    };
  }
  return queueFor(next, [ev]);
}

function queueFor(state: TutorialState, events: readonly TutorialEvent[]): TutorialState {
  const add = cuesForEvent(events, state.guide).filter((id) => !state.shown.includes(id));
  if (add.length === 0) return state;
  // A newly raised cue supersedes the single-line narration sitting in front of
  // it (the voice keeps talking); the decision-bearing cues stay readable until
  // the player acts.
  const pending = state.pending.filter((id) => cueById(id)?.retireOn !== "supersede");
  return { ...state, pending: [...pending, ...add], shown: [...state.shown, ...add] };
}

/** The one entry point the UI folds through. Never mutates its input. */
export function advanceTutorial(state: TutorialState, events: readonly TutorialEvent[]): TutorialState {
  let s = state;
  for (const ev of events) s = applyEvent(s, ev);
  return s;
}

/** Same event log → same cue sequence. The determinism contract, callable. */
export function cueSequenceFor(events: readonly TutorialEvent[], opts: { battlesSeen?: number; suppressed?: boolean } = {}): string[] {
  return advanceTutorial(freshTutorialState(opts.battlesSeen ?? 0, opts.suppressed ?? false), events).pending;
}

// ============================================================================
// §8 PLAYER CONTROLS (§12.4) — step, skip, replay. All pure.
// ============================================================================
/** Retire the active cue by choice (the "next" affordance). */
export function stepTutorial(state: TutorialState): TutorialState {
  return state.pending.length === 0 ? state : { ...state, pending: state.pending.slice(1) };
}

/** "Not now" — guidance off. Instant, total, and reversible: nothing the
 *  tutorial says is ever required to play on. */
export function setSuppressed(state: TutorialState, suppressed: boolean): TutorialState {
  return suppressed
    ? { ...state, suppressed: true, pending: [] }
    : { ...state, suppressed: false, pending: [], shown: [] };
}

/** Replay: re-fold this battle's own log from the top, exactly as it happened
 *  (§12.4 "replayable"). Returns a fresh state — the caller swaps it in. */
export function replayTutorial(state: TutorialState, events: readonly TutorialEvent[]): TutorialState {
  const before = { ...state, battlesSeen: Math.max(0, state.battlesSeen - 1) };
  return advanceTutorial({ ...freshTutorialState(before.battlesSeen, false), battleId: null }, events);
}

/** The cue on screen right now (the head of the queue), if any. */
export function activeCue(state: TutorialState): TutorialCue | null {
  const id = state.pending[0];
  return id ? cueById(id) ?? null : null;
}

/** The UI target a cue asks the view to light up. */
export function cueTarget(state: TutorialState): UiTarget | null {
  return activeCue(state)?.pointsAt ?? null;
}

// ============================================================================
// §9 PERSISTENCE CODECS — the skip choice + the battles-seen count survive a
// reload (never the queue: guidance re-arms from live observation). Pure string
// in / string out so the harness can test them without a DOM.
// ============================================================================
export interface TutorialPrefs {
  suppressed: boolean;
  battlesSeen: number;
}

export function encodeTutorialPrefs(prefs: TutorialPrefs): string {
  return JSON.stringify({ off: prefs.suppressed ? 1 : 0, seen: Math.max(0, Math.trunc(prefs.battlesSeen) || 0) });
}

export function decodeTutorialPrefs(raw: string | null | undefined): TutorialPrefs {
  const fallback: TutorialPrefs = { suppressed: false, battlesSeen: 0 };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { off?: unknown; seen?: unknown };
    return {
      suppressed: parsed.off === 1 || parsed.off === true,
      battlesSeen: Math.max(0, Math.trunc(Number(parsed.seen)) || 0),
    };
  } catch {
    return fallback;
  }
}
