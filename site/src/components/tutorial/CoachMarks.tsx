// COACH MARKS — first-open window hints (owner, Oct 14 2026: "when somebody
// opens a window, we need something showing an arrow: drag here, or resize
// here, or opacity — change colors — customize your windows… just make it
// all there to be touched").
//
// Rendered inside every window frame. Shows ONE mark at a time — the next
// unlearned control in drag → resize → opacity → appearance order — as a
// small chalk chip anchored beside the real control, with an arrow in its
// title. The layer never intercepts touches (pointer-events: none; only
// the chip's own Got-it button is live, ≥44px). A mark is learned by USING
// the control (WindowFrame calls noteCoachUse from the real handlers) or
// by dismissing the chip; the record is per-control, persisted in the
// tutorial progress, and never shows twice, on any window, ever.
import { useEffect } from "react";
import { useT } from "../i18n/I18n";
import { COACH_MARKS, nextCoachMark, type CoachMarkId } from "../../game/tutorial/framework";
import { noteCoachUse, useTutorial } from "../../game/tutorial/ui-store";
import {
  DEFAULT_APPEARANCE,
  getWindowAppearance,
  subscribeWindowAppearance,
} from "../../game/windows/window-appearance";

const CHIP_POS: Record<CoachMarkId, string> = {
  // under the title bar, left — the bar itself is the drag handle
  drag: "left-2 top-11",
  // up-left of the corner grip
  resize: "bottom-10 right-2",
  // under the ◐ chrome button, top-right
  opacity: "right-2 top-11",
  // centered under the title bar — the frame's own face
  appearance: "left-1/2 top-11 -translate-x-1/2",
};

export default function CoachMarks() {
  const t = useT();
  const { progress } = useTutorial();
  const next = nextCoachMark(progress);

  // "Appearance" is learned by actually changing the look (tint or global
  // opacity in Settings → Window Look) — doing beats dismissing.
  useEffect(
    () =>
      subscribeWindowAppearance(() => {
        const a = getWindowAppearance();
        if (a.tint !== DEFAULT_APPEARANCE.tint || a.opacity !== DEFAULT_APPEARANCE.opacity) {
          noteCoachUse("appearance");
        }
      }),
    [],
  );

  if (!next) return null;
  const mark = COACH_MARKS[next];
  return (
    <div className="pointer-events-none absolute inset-0 z-[80]" aria-hidden={false}>
      <div
        data-testid={`coach-mark-${next}`}
        className={`pointer-events-auto absolute w-60 max-w-[70vw] rounded-lg border border-amber-200/40 bg-[#0d1420]/95 p-2.5 shadow-xl ${CHIP_POS[next]}`}
      >
        <p className="text-xs font-bold text-amber-100">{t(`tut.coach.${next}.title`, mark.title)}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-text-2">{t(`tut.coach.${next}.body`, mark.body)}</p>
        <button
          type="button"
          data-testid="coach-mark-got-it"
          onClick={() => noteCoachUse(next)}
          className="mt-1.5 min-h-[44px] w-full rounded-md border border-amber-300/40 bg-amber-400/10 px-3 text-xs font-bold text-amber-100 hover:bg-amber-400/20"
        >
          {t("tut.coach.gotIt", "Got it")}
        </button>
      </div>
    </div>
  );
}
