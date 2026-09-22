// TUTORIAL CUE OVERLAY — The Fall, Step 3 slice 2 (opening-prologue-spec §12).
//
// The visible half of the diegetic tutorial: one caption card, in the Battles
// view, carrying the narrator's / a Leader's / a hero's line about the fight in
// front of the player. It is the SAME text the voice pass will say (§11.4), so
// captions and audio can never drift — the spoken line IS the caption.
//
// §12.4 accessibility, by construction:
//   • the line is a live region (aria-live="polite") — arriving guidance is
//     announced, changes do not interrupt the player mid-order;
//   • every prompt has a text twin and the card is plain text + real buttons;
//   • the player can step a line, silence the voices ("Quiet the voices") and
//     bring them back / hear the lesson again ("Hear it again") — nothing is
//     ever locked away, and skipping is one press;
//   • no focus trap, no autofocus, no motion of its own (the design system's
//     reduced-motion block already zeroes every transition globally);
//   • the card sits ABOVE the order panel in normal flow — it never covers or
//     intercepts the decision buttons.
// The layer renders state and calls back; all cue logic lives in
// game/war/tutorial-cues.ts (pure, harness-tested).
import type { TutorialCue } from "../game/war/tutorial-cues";
import { speakerLabel } from "../game/war/tutorial-cues";

export interface TutorialCueLayerProps {
  /** The cue on screen (null = the voices are quiet). */
  cue: TutorialCue | null;
  /** How many lines are queued (1 = this is the only one). */
  waiting: number;
  /** Guidance is off (§12.4 skip). */
  suppressed: boolean;
  /** Retire the cue on screen. */
  onStep: () => void;
  /** Silence the voices. */
  onSuppress: () => void;
  /** Voices on again. */
  onResume: () => void;
  /** Replay this battle's lesson from the top. */
  onReplay: () => void;
}

const BTN =
  "rounded-lg border border-line bg-surf-4 px-2 py-1 text-[11px] font-semibold text-text-2 hover:bg-surf-3 hover:text-text-1";

export default function TutorialCueLayer({
  cue,
  waiting,
  suppressed,
  onStep,
  onSuppress,
  onResume,
  onReplay,
}: TutorialCueLayerProps) {
  return (
    <aside aria-label="Battle guidance" data-testid="tutorial-cue-layer">
      {cue ? (
        <div
          data-testid="tutorial-cue"
          data-cue-id={cue.id}
          data-cue-speaker={cue.speaker.id}
          data-cue-target={cue.pointsAt}
          className="rounded-lg border border-purity/40 bg-surf-3 p-2.5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-purity">{speakerLabel(cue.speaker)}</p>
            <p className="text-[11px] text-text-3">
              {waiting > 1 ? `${waiting} lines waiting` : "the Cradle is speaking"}
            </p>
          </div>
          <p className="mt-1 text-sm text-text-1" aria-live="polite">
            {cue.line}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {waiting > 1 && (
              <button type="button" data-testid="tutorial-step" onClick={onStep} className={BTN}>
                Next line
              </button>
            )}
            <button type="button" data-testid="tutorial-replay" onClick={onReplay} className={BTN}>
              Hear it again
            </button>
            <button type="button" data-testid="tutorial-suppress" onClick={onSuppress} className={BTN}>
              Quiet the voices
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" data-testid="tutorial-quiet">
          <p className="text-[11px] text-text-3">
            {suppressed ? "The voices are quiet. The battle is yours." : "The voices have said their piece for this battle."}
          </p>
          {suppressed && (
            <button type="button" data-testid="tutorial-resume" onClick={onResume} className={BTN}>
              Let them speak
            </button>
          )}
          <button type="button" data-testid="tutorial-replay" onClick={onReplay} className={BTN}>
            {suppressed ? "Hear the lesson again" : "Hear it again"}
          </button>
          {!suppressed && (
            <button type="button" data-testid="tutorial-suppress" onClick={onSuppress} className={BTN}>
              Quiet the voices
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
