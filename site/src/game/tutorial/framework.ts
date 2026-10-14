// TUTORIAL FRAMEWORK — the reusable lesson engine for the whole game
// (owner ruling, Oct 14 2026: "we're going to have to have a tutorial — the
// only reason I know what's going on is because I'm building it"; expanded
// the same night: "a tutorial about everything — the whole fucking game";
// standard: "If it can't be explained, people aren't going to play it").
//
// PURPOSE BEFORE MECHANICS is the house rule baked into the data shape:
// every act and every lesson carries a `purpose` — what this IS and what it
// is FOR, in plain words — and the card renders the purpose ahead of the
// taps. A lesson that cannot state its purpose does not belong in the data;
// the build report flags those as design questions instead of papering over
// them with flavor.
//
// SHAPE OF THE MACHINE
//   · Acts contain lessons; lessons contain steps.
//   · A step completes one of three ways:
//       "event"  — the player actually DID the thing (the game observed it
//                  on the tutorial bus — do-it-to-advance, never a timer);
//       "read"   — a pure concept: the player presses "Got it";
//       "finish" — the act's closing step: pressing it completes the act.
//   · Lessons complete in order; acts complete when their last lesson does.
//   · SKIP IS ALWAYS AVAILABLE (the Exit Law applies to tutorials too):
//     skip a lesson, or leave the whole run — progress already earned is
//     kept, and nothing re-nags: completed lessons never reopen.
//   · Progress persists in one localStorage blob (pure codecs below).
//
// THE BUS: surfaces that can observe a real player action call
// `noteTutEvent(...)` (a tab opened, an order judged, a colony founded).
// The framework never reaches into a surface; it only listens. Events that
// don't match the current step are ignored — doing things "early" is never
// punished, the lesson simply waits for its own moment.
//
// This module is pure (no React, no DOM reads) apart from the bus's listener
// set and the guarded localStorage helpers at the bottom, which follow the
// same try/catch pattern as the rest of the game's small stores.

// ============================================================================
// §1 CONTENT TYPES
// ============================================================================

/** A real, observed player action. `name` is the coarse verb ("order",
 *  "tab", "cover", ...); the optional fields narrow it for a step's match. */
export interface TutEvent {
  name: string;
  /** for order events: the OrderKind the judge logged (move/hotdrop/...). */
  orderKind?: string;
  /** for order/selection events: the squad's maneuver vector. */
  vector?: string;
  /** for focus events: the focused unit is the enemy leader/hero. */
  leader?: boolean;
}

export type StepDone =
  | { kind: "event"; event: string; orderKind?: string; vector?: string | readonly string[] }
  | { kind: "read" }
  | { kind: "finish" };

export interface TutStep {
  id: string;
  /** The chalk line — short, warm, plain. Purpose rides on the lesson. */
  body: string;
  /** For event steps: the "your move" instruction ("Tap your MAIN squad,
   *  then tap the ground ahead of it"). */
  doLabel?: string;
  done: StepDone;
}

export interface TutLesson {
  id: string;
  title: string;
  /** PURPOSE BEFORE MECHANICS: what this is and what it's for. */
  purpose: string;
  steps: readonly TutStep[];
}

/** How honestly guided an act is in this build — reported, never hidden:
 *    "full"     — every mechanic step waits for the real action;
 *    "guided"   — the act's spine is action-gated; concept steps are reads;
 *    "scripted" — the lessons are complete and runnable, but most steps are
 *                 reads because the surface exposes no observation seam yet. */
export type ActLevel = "full" | "guided" | "scripted";

export interface TutAct {
  id: string;
  title: string;
  /** PURPOSE BEFORE MECHANICS, for the whole act. */
  purpose: string;
  level: ActLevel;
  lessons: readonly TutLesson[];
}

// ============================================================================
// §2 THE BUS — surfaces report real actions; the machine only listens.
// ============================================================================

type TutListener = (ev: TutEvent) => void;
const listeners = new Set<TutListener>();

/** Report one real player action. Safe to call from anywhere, any time —
 *  with no run active it is a no-op. */
export function noteTutEvent(ev: TutEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(ev);
    } catch {
      /* a listener must never break the surface that reported the action */
    }
  }
}

export function subscribeTutEvents(fn: TutListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ============================================================================
// §3 THE RUN STATE MACHINE — pure folds over the act data.
// ============================================================================

export interface TutRun {
  actId: string;
  /** index into the act's lessons */
  lesson: number;
  /** index into the current lesson's steps */
  step: number;
  status: "active" | "complete";
}

export function newRun(actId: string, resumeAtLesson = 0): TutRun {
  return { actId, lesson: Math.max(0, resumeAtLesson), step: 0, status: "active" };
}

export function actById(acts: readonly TutAct[], id: string): TutAct | undefined {
  return acts.find((a) => a.id === id);
}

export function currentLesson(acts: readonly TutAct[], run: TutRun): TutLesson | null {
  const act = actById(acts, run.actId);
  return act?.lessons[run.lesson] ?? null;
}

export function currentStep(acts: readonly TutAct[], run: TutRun): TutStep | null {
  return currentLesson(acts, run)?.steps[run.step] ?? null;
}

/** Does this observed event satisfy this step's completion spec? */
export function stepMatchesEvent(step: TutStep, ev: TutEvent): boolean {
  const d = step.done;
  if (d.kind !== "event" || d.event !== ev.name) return false;
  if (d.orderKind !== undefined && d.orderKind !== ev.orderKind) return false;
  if (d.vector !== undefined) {
    const wanted = Array.isArray(d.vector) ? d.vector : [d.vector as string];
    if (!ev.vector || !wanted.includes(ev.vector)) return false;
  }
  return true;
}

function advance(run: TutRun, acts: readonly TutAct[]): TutRun {
  const act = actById(acts, run.actId);
  if (!act) return { ...run, status: "complete" };
  const lesson = act.lessons[run.lesson];
  if (!lesson) return { ...run, status: "complete" };
  if (run.step + 1 < lesson.steps.length) return { ...run, step: run.step + 1 };
  if (run.lesson + 1 < act.lessons.length) return { ...run, lesson: run.lesson + 1, step: 0 };
  return { ...run, status: "complete" };
}

/** Fold one observed event into the run. Non-matching events change
 *  nothing — the machine is patient by design. */
export function applyTutEvent(run: TutRun, acts: readonly TutAct[], ev: TutEvent): TutRun {
  if (run.status !== "active") return run;
  const step = currentStep(acts, run);
  if (!step || !stepMatchesEvent(step, ev)) return run;
  return advance(run, acts);
}

/** The player pressed the card's button on a read/finish step. Event steps
 *  refuse the button — doing is the only way through those. */
export function confirmTutStep(run: TutRun, acts: readonly TutAct[]): TutRun {
  if (run.status !== "active") return run;
  const step = currentStep(acts, run);
  if (!step) return run;
  if (step.done.kind === "finish") return { ...run, status: "complete" };
  if (step.done.kind === "read") return advance(run, acts);
  return run;
}

/** Skip the current lesson (its remaining steps are forgiven, not faked:
 *  the progress record marks the lesson skipped, never done-by-doing). */
export function skipTutLesson(run: TutRun, acts: readonly TutAct[]): TutRun {
  if (run.status !== "active") return run;
  const act = actById(acts, run.actId);
  if (!act) return { ...run, status: "complete" };
  if (run.lesson + 1 < act.lessons.length) return { ...run, lesson: run.lesson + 1, step: 0 };
  return { ...run, status: "complete" };
}

// ============================================================================
// §4 PROGRESS + PERSISTENCE — what a player has finished, kept across
// sessions. Done steps never re-nag: a completed act stays completed, a
// completed lesson is skipped when its act is replayed.
// ============================================================================

export interface TutActProgress {
  status: "done" | "skipped";
  /** lesson ids completed (by finishing their steps or by skipping). */
  lessons: string[];
}

export interface TutProgress {
  v: 1;
  acts: Record<string, TutActProgress>;
  /** the first-battle offer banner was dismissed — don't re-nag. */
  offerDismissed: boolean;
  /** window coach marks already learned — per control, never shown twice. */
  coach: string[];
}

export function freshProgress(): TutProgress {
  return { v: 1, acts: {}, offerDismissed: false, coach: [] };
}

export function encodeProgress(p: TutProgress): string {
  return JSON.stringify(p);
}

export function decodeProgress(raw: string | null | undefined): TutProgress {
  if (!raw) return freshProgress();
  try {
    const parsed = JSON.parse(raw) as Partial<TutProgress>;
    if (!parsed || typeof parsed !== "object" || !parsed.acts || typeof parsed.acts !== "object") {
      return freshProgress();
    }
    const acts: Record<string, TutActProgress> = {};
    for (const [id, rec] of Object.entries(parsed.acts)) {
      const r = rec as Partial<TutActProgress>;
      if (r && (r.status === "done" || r.status === "skipped")) {
        acts[id] = { status: r.status, lessons: Array.isArray(r.lessons) ? r.lessons.filter((x) => typeof x === "string") : [] };
      }
    }
    return {
      v: 1,
      acts,
      offerDismissed: parsed.offerDismissed === true,
      coach: Array.isArray(parsed.coach) ? parsed.coach.filter((x) => typeof x === "string") : [],
    };
  } catch {
    return freshProgress();
  }
}

/** The lesson a run should resume at: the first one not already completed. */
export function resumeLessonIndex(progress: TutProgress, act: TutAct): number {
  const done = new Set(progress.acts[act.id]?.lessons ?? []);
  const i = act.lessons.findIndex((l) => !done.has(l.id));
  return i === -1 ? act.lessons.length : i;
}

export function isActComplete(progress: TutProgress, act: TutAct): boolean {
  const done = new Set(progress.acts[act.id]?.lessons ?? []);
  return act.lessons.every((l) => done.has(l.id));
}

/** Record a finished lesson (done by doing, or skipped) into progress. */
export function recordLesson(progress: TutProgress, actId: string, lessonId: string, act: TutAct): TutProgress {
  const prev = progress.acts[actId] ?? { status: "skipped" as const, lessons: [] };
  const lessons = prev.lessons.includes(lessonId) ? prev.lessons : [...prev.lessons, lessonId];
  const complete = act.lessons.every((l) => lessons.includes(l.id));
  return {
    ...progress,
    acts: { ...progress.acts, [actId]: { status: complete ? "done" : prev.status, lessons } },
  };
}

/** The next act worth offering: the first incomplete one in table order. */
export function recommendedAct(progress: TutProgress, acts: readonly TutAct[]): TutAct | null {
  return acts.find((a) => !isActComplete(progress, a)) ?? null;
}

// ============================================================================
// §5 WINDOW COACH MARKS — discoverability by touch (owner, Oct 14 2026):
// "even down to the windows that drag up and down, resize and opacity… when
// somebody opens a window, we need something showing an arrow: drag here, or
// resize here, or opacity — change colors — customize your windows."
// The first time a player opens any floating window, one anchored hint at a
// time points at the REAL control. A mark is learned by using the control
// or by dismissing the hint (≥44px), is persisted per control, and never
// shows twice. The marks teach the chrome in the moment, not in a manual.
// ============================================================================

export type CoachMarkId = "drag" | "resize" | "opacity" | "appearance";

/** The order the marks introduce themselves — one at a time, in the order a
 *  player's hands meet the chrome: move it, size it, fade it, make it yours. */
export const COACH_MARK_ORDER: readonly CoachMarkId[] = ["drag", "resize", "opacity", "appearance"];

export const COACH_MARKS: Record<CoachMarkId, { title: string; body: string }> = {
  drag: {
    title: "↔ Drag here",
    body: "Grab the title bar and put this window where you want it. Double-tap the bar to snap it home.",
  },
  resize: {
    title: "⤢ Resize here",
    body: "Pull the corner grip to make the window bigger or smaller. Double-tap it to reset the size. It remembers.",
  },
  opacity: {
    title: "◐ See-through",
    body: "The ◐ button fades THIS window — park it over the fight and watch the war through it.",
  },
  appearance: {
    title: "🎨 Make it yours",
    body: "These windows are YOURS. Tint every window's colors in Settings → Window Look — arrange them, size them, fade them, make them yours.",
  },
};

/** The next mark this player should meet (null = the chrome is learned). */
export function nextCoachMark(progress: TutProgress): CoachMarkId | null {
  return COACH_MARK_ORDER.find((id) => !progress.coach.includes(id)) ?? null;
}

/** Record a mark as learned (by doing or by dismissing). Pure. */
export function learnCoachMark(progress: TutProgress, id: CoachMarkId): TutProgress {
  if (progress.coach.includes(id)) return progress;
  return { ...progress, coach: [...progress.coach, id] };
}

// ---- storage (guarded, same pattern as the game's other small stores) ----

export const TUTORIAL_STORAGE_KEY = "unbound-tutorial-progress";

export function loadProgress(): TutProgress {
  try {
    return decodeProgress(window.localStorage.getItem(TUTORIAL_STORAGE_KEY));
  } catch {
    return freshProgress();
  }
}

export function saveProgress(p: TutProgress): void {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, encodeProgress(p));
  } catch {
    /* storage is a courtesy, never a gate */
  }
}
