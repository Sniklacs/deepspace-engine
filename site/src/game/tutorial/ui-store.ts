// TUTORIAL UI STORE — the live run, React side. Follows the game's
// window-store / scene-ui-store pattern: a plain subscribe/getSnapshot
// module, no provider. The pure machine lives in framework.ts; this store
// only holds the current run + progress, folds bus events into the machine,
// and persists progress as lessons complete (so done lessons never re-nag,
// even across sessions).
import { useSyncExternalStore } from "react";
import {
  actById,
  applyTutEvent,
  confirmTutStep,
  currentLesson,
  isActComplete,
  learnCoachMark,
  loadProgress,
  newRun,
  recordLesson,
  resumeLessonIndex,
  saveProgress,
  skipTutLesson,
  subscribeTutEvents,
  type CoachMarkId,
  type TutProgress,
  type TutRun,
} from "./framework";
import { TUT_ACTS } from "./acts";

export { TUTORIAL_STORAGE_KEY } from "./framework";

export interface TutorialUIState {
  progress: TutProgress;
  /** the active run, if a lesson card should be on screen */
  run: TutRun | null;
  /** the guided-battle scene is mounted (it outlives its lessons: when the
   *  act completes or is left, the scene stays as free-play practice) */
  battleOpen: boolean;
  /** the lesson card is visible (the player can leave the lessons without
   *  leaving a battle they started) */
  cardOpen: boolean;
}

let state: TutorialUIState = {
  progress: loadProgress(),
  run: null,
  battleOpen: false,
  cardOpen: false,
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a broken subscriber must not break the school */
    }
  }
}

function set(patch: Partial<TutorialUIState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeTutorial(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function tutorialSnapshot(): TutorialUIState {
  return state;
}

export function useTutorial(): TutorialUIState {
  return useSyncExternalStore(subscribeTutorial, tutorialSnapshot, tutorialSnapshot);
}

/** Fold a run transition into progress: every lesson the run has passed is
 *  recorded (done or skipped — the record is the same: never teach twice
 *  unless the player asks via Learn). */
function settleRun(run: TutRun | null, progress: TutProgress): TutProgress {
  if (!run) return progress;
  const act = actById(TUT_ACTS, run.actId);
  if (!act) return progress;
  let next = progress;
  const passed = run.status === "complete" ? act.lessons.length : run.lesson;
  for (let i = 0; i < passed; i++) {
    next = recordLesson(next, act.id, act.lessons[i].id, act);
  }
  return next;
}

function withRun(run: TutRun | null): void {
  const progress = settleRun(run, state.progress);
  if (progress !== state.progress) saveProgress(progress);
  set({ run, progress, cardOpen: run ? state.cardOpen : false });
}

/** Start (or resume) an act. Completed lessons are skipped automatically;
 *  a fully completed act replays from the top when the player asks. */
export function startTutorialAct(actId: string): void {
  const act = actById(TUT_ACTS, actId);
  if (!act) return;
  const resume = resumeLessonIndex(state.progress, act);
  const run = newRun(actId, resume >= act.lessons.length ? 0 : resume);
  set({
    run,
    cardOpen: true,
    battleOpen: actId === "battle" ? true : state.battleOpen,
  });
}

/** Leave the lessons (the card closes). A battle scene, if open, stays as
 *  free play — leaving the teacher never ejects the player from the game. */
export function exitTutorialRun(): void {
  withRun(null);
  set({ cardOpen: false });
}

/** The guided-battle scene itself closed (its own ✕ / back): the run ends
 *  with it, progress already earned kept. */
export function closeGuidedBattle(): void {
  withRun(null);
  set({ cardOpen: false, battleOpen: false });
}

export function confirmCurrentStep(): void {
  if (!state.run) return;
  withRun(confirmTutStep(state.run, TUT_ACTS));
}

export function skipCurrentLesson(): void {
  if (!state.run) return;
  withRun(skipTutLesson(state.run, TUT_ACTS));
}

export function dismissTutorialOffer(): void {
  const progress = { ...state.progress, offerDismissed: true };
  saveProgress(progress);
  set({ progress });
}

/** Coach marks: learned by using the real control, or by dismissing the
 *  hint. Silent and global — learned once, on any window, forever. */
export function noteCoachUse(id: CoachMarkId): void {
  const progress = learnCoachMark(state.progress, id);
  if (progress === state.progress) return;
  saveProgress(progress);
  set({ progress });
}

// The bus: observed actions fold into the active run. Subscribed once, at
// module load; with no run active every event is a no-op by construction.
subscribeTutEvents((ev) => {
  if (!state.run || state.run.status !== "active") return;
  const next = applyTutEvent(state.run, TUT_ACTS, ev);
  if (next !== state.run) withRun(next);
});

/** Test/debug surface: is the named act fully complete on this device? */
export function tutorialActComplete(actId: string): boolean {
  const act = actById(TUT_ACTS, actId);
  return act ? isActComplete(state.progress, act) : false;
}

/** The current lesson's id, for hosts that narrate progress. */
export function currentLessonId(): string | null {
  return state.run ? currentLesson(TUT_ACTS, state.run)?.id ?? null : null;
}
