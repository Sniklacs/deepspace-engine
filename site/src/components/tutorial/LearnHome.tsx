// LEARN HOME — the school's front door (War Room tab, next door to the
// Wall). Every act of the whole-game tutorial listed with its PURPOSE, its
// honesty label (fully guided / guided / lessons), and its state on this
// device: done, part-done (resume where you stopped), or new. Starting the
// battle act hands over to the guided scene (the tutorial host mounts it
// full-screen); the other acts ride as a card over the game while the
// player does the steps on the real pages.
import { useT } from "../i18n/I18n";
import { isActComplete, recommendedAct, type ActLevel } from "../../game/tutorial/framework";
import { TUT_ACTS } from "../../game/tutorial/acts";
import { startTutorialAct, useTutorial } from "../../game/tutorial/ui-store";

const LEVEL_LABEL: Record<ActLevel, string> = {
  full: "Fully guided — do it to advance",
  guided: "Guided — real steps, real pages",
  scripted: "Lessons — read at your pace",
};

export default function LearnHome() {
  const t = useT();
  const { progress } = useTutorial();
  const next = recommendedAct(progress, TUT_ACTS);
  const tt = (key: string, fallback: string) => t(`tut.${key}`, fallback);

  return (
    <div data-testid="learn-home" className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-text-1">🖍️ {tt("ui.learnTitle", "Learn — the school of the Wall")}</h3>
        <p className="mt-1 text-xs leading-snug text-text-3">
          {tt(
            "ui.learnIntro",
            "Everything in the game, taught in the order you live it — purpose first, then the taps. Take the acts in order, skip any, come back any time. Nothing here can be failed, and nothing nags twice.",
          )}
        </p>
        <p className="mt-1 text-[11px] text-text-3">
          {tt("ui.coachStatus", "Window coach marks learned:")} {progress.coach.length}/4
        </p>
      </div>
      {TUT_ACTS.map((act) => {
        const done = isActComplete(progress, act);
        const lessonsDone = progress.acts[act.id]?.lessons.length ?? 0;
        const started = lessonsDone > 0 && !done;
        const isNext = next?.id === act.id;
        return (
          <article
            key={act.id}
            data-testid={`learn-act-${act.id}`}
            className={`rounded-lg border p-3 ${isNext ? "border-amber-300/50 bg-amber-400/5" : "border-line bg-surf-3"}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-bold text-text-1">{tt(`${act.id}.title`, act.title)}</h4>
              <span className="text-[11px] font-semibold text-text-3">
                {done ? `✓ ${tt("ui.done", "Done")}` : started ? `${lessonsDone}/${act.lessons.length} ${tt("ui.lessonsWord", "lessons")}` : tt("ui.new", "New")}
                {" · "}
                {tt(`ui.level.${act.level}`, LEVEL_LABEL[act.level])}
              </span>
            </div>
            <p className="mt-1 text-xs italic leading-snug text-amber-100/70">{tt(`${act.id}.purpose`, act.purpose)}</p>
            <div className="mt-2">
              <button
                type="button"
                data-testid={`learn-start-${act.id}`}
                onClick={() => startTutorialAct(act.id)}
                className="min-h-[44px] rounded-lg border border-amber-300/50 bg-amber-400/15 px-4 text-sm font-bold text-amber-100 hover:bg-amber-400/25"
              >
                {done
                  ? tt("ui.replay", "Read it again")
                  : started
                    ? tt("ui.resume", "Resume")
                    : act.id === "battle"
                      ? tt("ui.startBattle", "Start the guided battle")
                      : tt("ui.start", "Start")}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
