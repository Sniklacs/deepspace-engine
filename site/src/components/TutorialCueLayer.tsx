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
// game/war/tutorial-cues.ts (pure, harness-tested) and all speech lives in
// game/voice/voice-engine.ts (session-local, never a gate).
//
// THE VOICE (design/prologue-voice-direction.md §2.7, §6.3): the plate carries
// the engine's mode as `data-voice-mode` (voiced | silent | shared) and, when
// the voices cannot be heard — globally muted, or no usable synthesis on this
// device — one existing `.chip` reading "sound off", so a player who mutes and
// then taps "Let them speak" is told the truth instead of guessing. Captions are
// unaffected either way: the authored line below is rendered VERBATIM.
import type { TutorialCue, TutorialSpeaker, UiTarget } from "../game/war/tutorial-cues";
import { speakerLabel } from "../game/war/tutorial-cues";
import type { VoiceMode } from "../game/voice/voice-engine";

// THE PLATE'S LINE, as a SHAPE — one plate, two mounts (beat-rail spec §5.3.1).
// The C tier's `TutorialCue` satisfies this structurally, so the Battles mount
// changes not at all; the rail's rows (game/prologue/prologue-cues.ts) arrive as
// this shape too, with no DOM target: a rail line asks for no ring and no scroll.
export interface PlateLine {
  id: string;
  /** Rendered VERBATIM. The plate never transforms its caption. */
  line: string;
  /** Who is speaking. */
  speaker?: { id: string };
  /** The speaker label as the voice sheet writes it ("Kael — the Steward").
   *  Omitted → `speakerLabel(cue.speaker)`; empty → no label row at all. */
  label?: string;
  /** The element a cue lights up. Absent on the rail: no ring, no scroll. */
  pointsAt?: UiTarget | null;
  retireOn?: "supersede" | "decision" | "resolve";
}

export interface TutorialCueLayerProps {
  /** The cue on screen (null = the voices are quiet). */
  cue: PlateLine | null;
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
  /** The sound layer's mute (the Cradle sheet's Sound row) — the first gate. */
  muted?: boolean;
  /** What the voice engine is doing right now (§2.7). */
  voiceMode?: VoiceMode;
  /** What this plate is, for a screen reader: the Battles mount keeps the
   *  ratified "Battle guidance"; the rail's home mount says what it is. */
  ariaLabel?: string;
}

/** Type-level proof that the C tier still satisfies the plate (§8.6): if a
 *  `TutorialCue` ever stops being assignable to `PlateLine`, this line fails to
 *  compile. The Battles mount's props therefore cannot drift. */
export const C_TIER_FITS_PLATE: TutorialCue extends PlateLine ? true : false = true;

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
  muted = false,
  voiceMode = "voiced",
  ariaLabel = "Battle guidance",
}: TutorialCueLayerProps) {
  // §5.3.1: the speaker label is the row's own `label` when it has one, else the
  // cue's speaker table. An empty label omits the label row entirely (a rail S
  // row — `(silence)` — has no speaker and no label).
  const label = cue?.label ?? (cue?.speaker ? speakerLabel(cue.speaker as TutorialSpeaker) : "");
  const hasLabel = !!label && label.trim().length > 0;
  // §6.3: a word, not a colour and not a motion. It renders when the global mute
  // is on or when there is nothing on this device that can speak.
  const soundOff = muted || voiceMode === "silent";
  const soundOffChip = soundOff ? (
    <span data-testid="tutorial-sound-off" className="chip border border-line text-text-3">
      sound off
    </span>
  ) : null;
  return (
    <aside
      aria-label={ariaLabel}
      data-testid="tutorial-cue-layer"
      data-voice-mode={voiceMode}
    >
      {cue ? (
        <div
          data-testid="tutorial-cue"
          data-cue-id={cue.id}
          data-cue-speaker={cue.speaker?.id}
          // §5.3.1: OMITTED (never empty) when the line asks for no target — a
          // rail row renders no ring and no scroll.
          {...(cue.pointsAt ? { "data-cue-target": cue.pointsAt } : {})}
          className="rounded-lg border border-purity/40 bg-surf-3 p-2.5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {hasLabel ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-purity">{label}</p>
            ) : null}
            <p className="text-[11px] text-text-3">
              {waiting > 1 ? `${waiting} lines waiting` : "the Cradle is speaking"}
            </p>
          </div>
          <p className="mt-1 text-sm text-text-1" id="tut-cue-line" aria-live="polite">
            {cue.line}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            {soundOffChip}
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
          {soundOffChip}
        </div>
      )}
    </aside>
  );
}
