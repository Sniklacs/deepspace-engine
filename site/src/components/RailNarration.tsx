// RAIL NARRATION — the beat rail's MOUNT (design/prologue-beat-rail-spec.md §5.4).
//
// One plate, two mounts, never simultaneous. The narration plate itself is
// `TutorialCueLayer` — untouched apart from accepting the rail's line shape —
// and this component is only its home-mount wiring: it hands the plate ONE row
// at a time, hands the voice engine the SAME object, and owns the rail's
// session-local state (the cursor, the governor history, the turn gaps).
//
//   • presentation only — it renders the plate between the Act I plate and the
//     Cradle plate, reads GameState through `railFacts` (a closed allow-list),
//     writes nothing, gates nothing, and cannot reach an order button;
//   • no new state, no new noun, no new colour, no timer that can START a beat:
//     the only clock here is the page's own `now`, and the rail can only ever
//     HOLD a row whose gate already fired;
//   • the suppression flag is the EXISTING `deepspace_tutorial` device blob —
//     one brake, both surfaces (the same "Quiet the voices" the battle mount
//     uses). No new storage key, no migration, no GameState field;
//   • D1: the engine's disarm is `complete(completed && railStoryDone())` —
//     Act III must speak, so the opening is over when the rail's LAST row has
//     retired, not when `resetToCradle()` flips the flag.
import { useEffect, useRef, useState } from "react";
import TutorialCueLayer from "./TutorialCueLayer";
import type { PlateLine } from "./TutorialCueLayer";
import { voiceEngine } from "../game/voice/voice-engine";
import type { VoiceCue, VoiceMode } from "../game/voice/voice-engine";
import { voiceDirectionFor } from "../game/voice/voice-direction";
import {
  TUTORIAL_CONFIG,
  decodeTutorialPrefs,
  encodeTutorialPrefs,
} from "../game/war/tutorial-cues";
import type { TutorialPrefs } from "../game/war/tutorial-cues";
import {
  RAIL_CONFIG,
  RAIL_ORDER,
  RAIL_ROWS,
  advanceRail,
  freshRailState,
  interRowGapMs,
  markRailStoryDone,
  nextRailRow,
  railFacts,
  railStoryDone,
  railWords,
  silentDwellMs,
  stepRail,
} from "../game/prologue/prologue-cues";
import type { RailFacts, RailRow, RailState } from "../game/prologue/prologue-cues";
import type { GameState } from "../game/types";

/** The last row of the whole opening — its retirement releases the disarm (D1). */
const LAST_ROW_ID = "3.3-b";

/** The plate's own ratified words for this mount. */
const RAIL_ARIA_LABEL = "The Fall — the Cradle is speaking";

function loadRailPrefs(): TutorialPrefs {
  try {
    return decodeTutorialPrefs(localStorage.getItem(TUTORIAL_CONFIG.storageKeys.prefs));
  } catch {
    return { suppressed: false, battlesSeen: 0 };
  }
}

function saveRailPrefs(prefs: TutorialPrefs): void {
  try {
    localStorage.setItem(TUTORIAL_CONFIG.storageKeys.prefs, encodeTutorialPrefs(prefs));
  } catch {
    /* a player with storage blocked just gets the voices afresh next visit */
  }
}

/** One row → the plate's line (the same object the voice is handed). A rail row
 *  carries NO `pointsAt`: no ring, no scroll — the script's medallion push is a
 *  metaphor we do not fake with chrome. */
export function railPlateLine(row: RailRow): PlateLine & VoiceCue {
  const dir = row.speaker ? voiceDirectionFor(row.speaker) : undefined;
  return {
    id: row.id,
    line: row.line,
    speaker: row.speaker ? { id: row.speaker } : undefined,
    label: dir?.label,
    scene: row.beat,
    surface: "rail",
    retireOn: "supersede",
  } as PlateLine & VoiceCue;
}

/** The ceiling on a row's caption while the voice is carrying its own pace: the
 *  sheet's own word model plus one grace, so a stalled synthesiser can never
 *  park the story. Never a trigger — only a fallback. */
function captionCeilingMs(row: RailRow): number {
  return Math.round((railWords(row) / RAIL_CONFIG.wordsPerSecond) * 1000) + RAIL_CONFIG.stallGraceMs;
}

export default function RailNarration({
  state,
  now,
  muted,
}: {
  state: GameState;
  /** the page's tick (the 4 s poll + the 1 s panel ticker) — never a trigger. */
  now: number;
  /** the Cradle sheet's Sound row (the first gate). */
  muted: boolean;
}) {
  const [, bump] = useState(0);
  const [suppressed, setSuppressed] = useState<boolean>(() => loadRailPrefs().suppressed);
  const [active, setActive] = useState<RailRow | null>(null);
  const rail = useRef<RailState | null>(null);
  const factsRef = useRef<RailFacts | null>(null);
  /** §6 the duty governor's only memory: what this session has already said. */
  const spoken = useRef<{ id: string; at: number; seconds: number }[]>([]);
  const handedAt = useRef(0);
  const holdUntil = useRef(0);
  /** the page's own clock, kept in a ref so the button paths share ONE clock. */
  const clock = useRef(now);
  clock.current = now;

  const stage = state.prologue?.stage ?? null;
  const completed = !!state.prologue?.completed;

  // the plate carries the engine's mode as data-voice-mode (§2.7)
  useEffect(() => voiceEngine.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => {
    voiceEngine.surface("rail");
    return () => {
      // §5.4: cue(null) BEFORE leaving the surface, or the engine re-speaks the
      // rail's last line on the way into the Battles view (`surface("battles")`
      // re-enqueues `current`).
      voiceEngine.cue(null);
      voiceEngine.surface("home");
    };
  }, []);
  useEffect(() => voiceEngine.setMuted(muted), [muted]);
  useEffect(() => voiceEngine.quiet(suppressed), [suppressed]);
  useEffect(() => voiceEngine.stage(stage), [stage]);
  // D1 — the disarm point is the END OF ACT III'S RAIL, never the `completed`
  // flag (which flips in the same tick as `resetToCradle`).
  useEffect(() => {
    voiceEngine.complete(completed && railStoryDone());
  });

  // ---- the one tick the rail runs on --------------------------------------
  useEffect(() => {
    const stats = voiceEngine.stats();
    const engineIdle = stats.speaking === null && stats.waiting === 0;
    const voiceSilent = suppressed || muted || stats.mode === "silent" || !stats.armed;
    const facts = railFacts(state, {
      surface: "home",
      engineIdle,
      suppressed,
      now,
      spoken: spoken.current,
    });
    factsRef.current = facts;
    if (!rail.current) rail.current = freshRailState(facts);
    rail.current = advanceRail(rail.current, facts);
    const cur = rail.current;

    // 1 · the player's own brake: the cursor FREEZES and the plate goes quiet.
    if (suppressed) {
      if (active) setActive(null);
      voiceEngine.cue(null);
      return;
    }

    // 2 · retire the row on the plate — the voice finished it, the hold elapsed,
    //     or the player pressed "Next line" (which steps it directly).
    if (active) {
      const started = stats.spoken.includes(active.id) || stats.speaking === active.id;
      const ready = voiceSilent
        ? now - handedAt.current >= silentDwellMs(active)
        : started
          ? engineIdle
          : now - handedAt.current >= captionCeilingMs(active);
      if (ready && now - handedAt.current >= 400) {
        spoken.current = [
          ...spoken.current,
          { id: active.id, at: now, seconds: railWords(active) / RAIL_CONFIG.wordsPerSecond },
        ];
        retire(active, cur, facts);
      }
      return;
    }

    // 3 · hand the next row: one line at a time, and never before a turn gap.
    if (now < holdUntil.current) return;
    const row = nextRailRow(cur, facts);
    if (!row) return;
    handedAt.current = now;
    holdUntil.current = 0;
    setActive(row);
    // An S row is a caption with NO utterance at all (§6): the plate shows
    // `(silence)` and the voice is handed nothing.
    if (row.tier === "S" || !row.speaker) voiceEngine.cue(null);
    else voiceEngine.cue(railPlateLine(row));
  });

  const voiceMode: VoiceMode = voiceEngine.stats().mode;
  const cursor = rail.current?.cursor ?? 0;
  const rowsLeft = cursor < RAIL_ORDER.length;
  // The plate is on the Cradle only while it has something true to say — an
  // active line, or the player's quiet state with rows still ahead of it. After
  // Act I's narration the home is silent by design (§6).
  const show = !!active || (suppressed && rowsLeft);
  // §5.4: "N lines waiting" = the rows left in the ACTIVE row's beat (the head
  // counts — the C tier's `waiting` counts the same way).
  const waiting = active
    ? RAIL_ROWS.filter(
        (r) => r.beat === active.beat && RAIL_ORDER.indexOf(r.id) >= RAIL_ORDER.indexOf(active.id),
      ).length
    : 1;

  /** Retire a row: the cursor moves past it, the beat gap is taken, the plate
   *  goes quiet until the next row's turn. */
  function retire(row: RailRow, cur: RailState, facts: RailFacts) {
    if (row.id === LAST_ROW_ID) markRailStoryDone();
    const next = stepRail(cur, facts);
    rail.current = next;
    holdUntil.current = clock.current + interRowGapMs(row, RAIL_ROWS[next.cursor] ?? null);
    setActive(null);
    voiceEngine.cue(null);
  }

  /** The player's "Next line": the same retirement, priced as unspoken. */
  function stepActive() {
    if (!active) return;
    const facts = factsRef.current;
    if (!facts) return;
    spoken.current = [...spoken.current, { id: active.id, at: clock.current, seconds: 0 }];
    retire(active, rail.current ?? freshRailState(facts), facts);
  }

  return (
    <div data-testid="rail-narration" data-rail-stage={stage ?? "none"} data-rail-row={active?.id ?? ""}>
      {show ? (
        <TutorialCueLayer
          cue={active ? railPlateLine(active) : null}
          waiting={waiting}
          suppressed={suppressed}
          muted={muted}
          voiceMode={voiceMode}
          ariaLabel={RAIL_ARIA_LABEL}
          onStep={stepActive}
          onSuppress={() => {
            setSuppressed(true);
            saveRailPrefs({ suppressed: true, battlesSeen: 0 });
          }}
          onResume={() => {
            setSuppressed(false);
            saveRailPrefs({ suppressed: false, battlesSeen: 0 });
          }}
          onReplay={() => active && voiceEngine.replay(active.id)}
        />
      ) : null}
    </div>
  );
}
