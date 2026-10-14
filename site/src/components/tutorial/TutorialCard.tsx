// TUTORIAL CARD — the lesson on screen. One card, chalk voice (the War
// Room's boards are the house style): the lesson's PURPOSE first, in plain
// words, then the step, then — for a doing step — the "your move" line and
// nothing else to press: the game itself advances the lesson when the
// action is observed. Read steps carry one honest button ("Got it").
//
// THE EXIT LAW APPLIES TO TUTORIALS TOO (owner doctrine): the Leave
// control is always here, always ≥44px, and leaving the lessons never
// ejects the player from the game (or the battle) they were in. Skipping
// a lesson is likewise one press, forgiven in the record, never faked.
import { useT } from "../i18n/I18n";
import { actById, currentLesson, currentStep } from "../../game/tutorial/framework";
import { TUT_ACTS } from "../../game/tutorial/acts";
import {
  confirmCurrentStep,
  exitTutorialRun,
  skipCurrentLesson,
  useTutorial,
} from "../../game/tutorial/ui-store";

const BTN =
  "min-h-[44px] rounded-lg border border-line bg-surf-4 px-3 text-xs font-semibold text-text-2 hover:bg-surf-3 hover:text-text-1";
const BTN_PRIMARY =
  "min-h-[44px] flex-1 rounded-lg border border-amber-300/50 bg-amber-400/15 px-3 text-sm font-bold text-amber-100 hover:bg-amber-400/25";

export default function TutorialCard() {
  const t = useT();
  const { run } = useTutorial();
  if (!run) return null;
  const act = actById(TUT_ACTS, run.actId);
  if (!act) return null;
  const tt = (key: string, fallback: string) => t(`tut.${key}`, fallback);

  if (run.status === "complete") {
    return (
      <section
        data-testid="tutorial-card"
        data-tutorial-act={act.id}
        aria-label={tt("ui.lessons", "Lessons")}
        className="rounded-xl border border-amber-200/40 bg-[#0d1420]/95 p-3.5 shadow-2xl"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-amber-200/80">
          {tt(`${act.id}.title`, act.title)}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-text-1">
          {tt("ui.actComplete", "Act complete. The Wall keeps what you learned — it's in Learn whenever you want it again.")}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" data-testid="tutorial-close" onClick={exitTutorialRun} className={BTN_PRIMARY}>
            {tt("ui.close", "Close")}
          </button>
        </div>
      </section>
    );
  }

  const lesson = currentLesson(TUT_ACTS, run);
  const step = currentStep(TUT_ACTS, run);
  if (!lesson || !step) return null;
  const lessonNo = run.lesson + 1;

  return (
    <section
      data-testid="tutorial-card"
      data-tutorial-act={act.id}
      data-tutorial-lesson={lesson.id}
      data-tutorial-step={step.id}
      aria-label={tt("ui.lessons", "Lessons")}
      className="rounded-xl border border-amber-200/40 bg-[#0d1420]/95 p-3.5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-amber-200/80">
          {tt(`${act.id}.title`, act.title)} · {tt("ui.lessonOf", "Lesson")} {lessonNo}/{act.lessons.length}
        </p>
        <button
          type="button"
          data-testid="tutorial-leave"
          onClick={exitTutorialRun}
          aria-label={tt("ui.leaveLessons", "Leave the lessons")}
          className="-mr-1.5 -mt-1.5 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-text-3 hover:bg-white/5 hover:text-text-1"
        >
          ✕
        </button>
      </div>
      <h3 className="mt-1 text-base font-bold text-text-1">{tt(`${act.id}.${lesson.id}.title`, lesson.title)}</h3>
      <p className="mt-1 text-[13px] italic leading-snug text-amber-100/75">
        {tt(`${act.id}.${lesson.id}.purpose`, lesson.purpose)}
      </p>
      <p className="mt-2 text-sm leading-snug text-text-1" aria-live="polite">
        {tt(`${act.id}.${lesson.id}.${step.id}`, step.body)}
      </p>
      {step.done.kind === "event" && (
        <p className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-400/10 px-2.5 py-2 text-[13px] font-semibold text-amber-100" data-testid="tutorial-your-move">
          <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />
          {tt("ui.yourMove", "Your move:")} {step.doLabel ? tt(`${act.id}.${lesson.id}.${step.id}.do`, step.doLabel) : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {step.done.kind === "read" && (
          <button type="button" data-testid="tutorial-got-it" onClick={confirmCurrentStep} className={BTN_PRIMARY}>
            {tt("ui.gotIt", "Got it →")}
          </button>
        )}
        {step.done.kind === "finish" && (
          <button type="button" data-testid="tutorial-finish" onClick={confirmCurrentStep} className={BTN_PRIMARY}>
            {tt("ui.finish", "Finish the lessons")}
          </button>
        )}
        <button type="button" data-testid="tutorial-skip-lesson" onClick={skipCurrentLesson} className={BTN}>
          {tt("ui.skipLesson", "Skip lesson")}
        </button>
      </div>
    </section>
  );
}
