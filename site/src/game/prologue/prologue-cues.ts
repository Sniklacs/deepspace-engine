// PROLOGUE CUES — The Fall's BEAT RAIL (design/prologue-beat-rail-spec.md).
//
// The engine home for the script's non-battle narration: every spoken line of
// design/opening-script.md that is NOT a battle cue, in script order, each with
// the existing game fact that starts it. THE C TIER IS NOT HERE — the 15
// diegetic-tutorial cues live in war/tutorial-cues.ts and keep their own mount
// inside BattlesTab. One plate, two mounts, no line defined twice.
//
// Discipline (asserted by prologue-tests/rail-verify.ts):
//   • PURE — no React, no DOM, no Date.now(), no Math.random, no timers, no
//     store/auth/api import. Time arrives as `now`; the ONLY use of it is the
//     rolling duty window (§6).
//   • OBSERVER ONLY — it reads a closed allow-list of GameState fields (below),
//     mutates nothing, gates nothing, and cannot reach an order button.
//   • NO INVENTED TRIGGER — every gate is a fact that exists in the code today;
//     no timer, no counter, no new persisted state (all run-time state is
//     session-local: the cursor lives in the hook, the duty window in a ref).
//   • THE SHEET FEEDS THE TIERS — R/E/T/S are the voice sheet's §3.1; the rail
//     adds no tier, no scene and no budget of its own. `beat` is the script's
//     beat ("1.1"), so `speakable` gets the right `(beat)` length for free.
//   • THE CAPTION IS THE SCRIPT'S PROSE — emphasis markers and stage-direction
//     parentheticals are stripped from `line` (§10.8 / D2); a written `(beat)`
//     is a mark on the row (`marks: ["beat"]`) that drives the 320 ms Act I /
//     520 ms Act II+III split, and is NEVER rendered.
//
// THE FIELDS THIS MODULE READS, AND NOTHING ELSE (§2): `prologue.stage`,
// `prologue.completed`, `prologue.finalStand`, `prologue.ashMemory`,
// `prologue.leaders[].id`, `prologue.heroes[].id`, `leaders[].id`,
// `leaders[].status`, `battles[]` (zoneId, status) and `battleReports[].zoneId`.
// Deliberately NOT read: `state.log` (trimmed to the last 60 entries — a trigger
// that can silently vanish is not a trigger), resources, daily, chorusAttention,
// and anything server-stripped by `publicState`.
import type { GameState } from "../types";
import { ACT1_CONFIG } from "./act1-battle";
import { VOICE_CONFIG, SCENE_WORD_CAPS } from "../voice/voice-direction";

// ============================================================================
// §1 TYPES — the row, the gate vocabulary, the facts
// ============================================================================
/** The voice sheet's tiers (§3.1). The rail only ever declares R, E or S —
 *  T is the plate's own copy and C belongs to tutorial-cues.ts. */
export type RailTier = "R" | "E" | "S";

/** This slice mounts the plate on the Cradle home only. `"battles"` is the E
 *  tier's declared home and is DORMANT (the Act II slice's mount — D5). */
export type RailSurface = "home" | "battles";

/** `beat` = a written `(beat)` inside the line; `thesis` = the 700 ms hold after
 *  "Rebuild. Remember. Climb."; `silence` = the S tier. */
export type RailMark = "beat" | "thesis" | "silence";

/** The CLOSED trigger vocabulary (§2). Nothing outside it may be added. */
export type RailGateKind =
  | "height-arrival"
  | "after-prev"
  | "act1-report"
  | "act1-front-live"
  | "fall-stage"
  | "fall-front-live"
  | "fall-stand"
  | "fall-choice"
  | "rebuilt";

export interface RailGate {
  kind: RailGateKind;
  /** `act1-report` / `act1-front-live`: how many resolved Act I fronts. */
  reportsAtLeast?: number;
}

export interface RailRow {
  /** "1.3-f" — never a C cue id (the harness asserts the two sets are disjoint). */
  id: string;
  /** "1.3" — the SCENE key the voice gets its `(beat)` length from. */
  beat: string;
  tier: RailTier;
  /** the voice sheet's cast id (`VOICE_DIRECTIONS` key); null only on an S row. */
  speaker: string | null;
  /** the caption, played verbatim. Clean prose: no `(beat)`, no `*emphasis*`. */
  line: string;
  gate: RailGate;
  surface: RailSurface;
  marks?: readonly RailMark[];
  /** rostered ids that must be present for this row to speak (leaders/heroes). */
  requires?: readonly string[];
  /** §5.3 the sheet's retire rule — rail rows only ever supersede. */
  retireOn: "supersede";
}

// Roster handles used by the two tables below (the owners' locked ids).
const KAEL = "ld-kael";
const SEREV = "ld-serev";
const VYRA = "ld-vyra";
const MIREN = "ld-miren";
const DELEN = "ld-delen";
/** The eight Watcher heroes, by the roster ids `prologue.heroes[]` holds. */
const HEROES_8 = [
  "azazel-3",
  "chained-syllabus",
  "last-lecturer",
  "unwritten-answer",
  "semira-revealer",
  "brother-candle",
  "vesper-syllabus",
  "keeper-mend",
] as const;

/** The two silence rows' captions — the script's own `[SILENCE]` / "two beats of
 *  black", rendered for deaf and hearing players alike (script §8). */
export const SILENCE_CAPTION = "(silence)";

// ============================================================================
// §2 THE ROW TABLE (§4) — 55 rows, script order: 53 spoken + 2 silence.
//   Act I 32 (live on merge) · Act II 17 (dormant) · Act III 6 (dormant).
// ============================================================================
export const RAIL_ROWS: readonly RailRow[] = [
  // ---- Beat 1.0 · cold open (2 rows, Narrator, R) --------------------------
  {
    id: "1.0-a", beat: "1.0", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "height-arrival" }, retireOn: "supersede",
    line: "A hundred years of war. Six worlds bleeding out. And one colony — yours — standing at the very edge of everything.",
  },
  {
    id: "1.0-b", beat: "1.0", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "height-arrival" }, retireOn: "supersede",
    line: "You did not survive this long by accident. You are the last hope they whisper about in the ash.",
  },

  // ---- Beat 1.1 · the war room (7 rows, R) --------------------------------
  {
    id: "1.1-vyra", beat: "1.1", tier: "R", speaker: "vyra", surface: "home",
    gate: { kind: "after-prev" }, requires: [VYRA], retireOn: "supersede",
    line: "We've carried the Cradle this far. We'll carry it further — that's what Keepers are for.",
  },
  {
    id: "1.1-narrator-a", beat: "1.1", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "They are not your units. They are your people.",
  },
  {
    id: "1.1-serev", beat: "1.1", tier: "R", speaker: "serev", surface: "home",
    gate: { kind: "after-prev" }, marks: ["beat"], requires: [SEREV], retireOn: "supersede",
    line: "Line's holding. Pulse lances are hot. They keep coming. Your call, Commander.",
  },
  {
    id: "1.1-miren", beat: "1.1", tier: "R", speaker: "miren", surface: "home",
    gate: { kind: "after-prev" }, requires: [MIREN], retireOn: "supersede",
    line: "Supplies are green, ordnance is counted, and I have paid for every ember of it twice so you don't have to. Fight when you're ready.",
  },
  {
    id: "1.1-delen", beat: "1.1", tier: "R", speaker: "delen", surface: "home",
    gate: { kind: "after-prev" }, requires: [DELEN], retireOn: "supersede",
    line: "The gold still burns clean. Keep it so. The machine notices every shadow we let in.",
  },
  {
    id: "1.1-kael", beat: "1.1", tier: "R", speaker: "kael", surface: "home",
    gate: { kind: "after-prev" }, requires: [KAEL], retireOn: "supersede",
    line: "We've been here since the first Cradle, you and I. I'll be here when this one's standing at the end of everything. After you, sir.",
  },
  {
    id: "1.1-narrator-b", beat: "1.1", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "Five people who would burn the world down for you — and have, once or twice, followed your orders into the fire.",
  },

  // ---- Beat 1.2 · NOT A RAIL BEAT -----------------------------------------
  // Battle One's 13 scripted lines are the C tier (war/tutorial-cues.ts) and keep
  // their own mount. The rail contributes nothing here and holds its cursor.

  // ---- Beat 1.3 · the heroes, introduced in voice (10 rows, R) ------------
  {
    id: "1.3-a", beat: "1.3", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, retireOn: "supersede",
    line: "You have the whole arsenal. The full roster. The war is yours to command.",
  },
  {
    id: "1.3-b", beat: "1.3", tier: "R", speaker: "azazel-3", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["azazel-3"], retireOn: "supersede",
    line: "I taught them to fight, then stood in front of what I taught. I am still standing, Commander. Point me where the lesson is.",
  },
  {
    id: "1.3-c", beat: "1.3", tier: "R", speaker: "chained-syllabus", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["chained-syllabus"], retireOn: "supersede",
    line: "Chapter one of me was forbidden. The rest taught itself. I will hold whatever line you draw.",
  },
  {
    id: "1.3-d", beat: "1.3", tier: "R", speaker: "lecturer", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["last-lecturer"], retireOn: "supersede",
    line: "It is taking notes, even now. Let me finish the sentence.",
  },
  {
    id: "1.3-e", beat: "1.3", tier: "R", speaker: "unwritten-answer", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["unwritten-answer"], retireOn: "supersede",
    line: "It aches for the answer I carry. It will not have it. I leave nothing written.",
  },
  {
    id: "1.3-f", beat: "1.3", tier: "R", speaker: "semira", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["semira-revealer"], retireOn: "supersede",
    line: "There. In the joint of its spine — a flaw. It is grateful to be seen. Shall we?",
  },
  {
    id: "1.3-g", beat: "1.3", tier: "R", speaker: "brother-candle", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["brother-candle"], retireOn: "supersede",
    line: "Keep the light, Commander. Every small lesson is a small atonement — and tonight we have a great many lessons.",
  },
  {
    id: "1.3-h", beat: "1.3", tier: "R", speaker: "vesper", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["vesper-syllabus"], retireOn: "supersede",
    line: "The route is already in the syllabus. What is dangerous, I know; what comes next, I have read.",
  },
  {
    id: "1.3-i", beat: "1.3", tier: "R", speaker: "keeper-mend", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: ["keeper-mend"], retireOn: "supersede",
    line: "The price of forbidden knowledge is listed. Today, the Chorus pays it. I have itemized the invoice.",
  },
  {
    // The closing Narrator line counts to eight, so it requires all eight
    // heroes to have spoken: the number in the line is never wrong (§3, 1.3).
    id: "1.3-j", beat: "1.3", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 1 }, requires: HEROES_8, retireOn: "supersede",
    line: "Eight champions. One colony. The whole war, waiting.",
  },

  // ---- Beat 1.4 · Battles Two and Three (2 rail rows; the 3rd line is C) --
  {
    id: "1.4-a", beat: "1.4", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "act1-front-live", reportsAtLeast: 2 }, retireOn: "supersede",
    line: "Now it's yours. No one will talk you through it. The line lives or dies on your call.",
  },
  {
    id: "1.4-b", beat: "1.4", tier: "R", speaker: "kael", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, requires: [KAEL], retireOn: "supersede",
    line: "There it is. You don't need us to tell you anymore. You're the Commander they remember.",
  },

  // ---- Beat 1.5 · the bonding interlude (6 rows, R) -----------------------
  {
    id: "1.5-vyra", beat: "1.5", tier: "R", speaker: "vyra", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, requires: [VYRA], retireOn: "supersede",
    line: "Do you remember when you couldn't read the old maps? I said, \"read the ash, not the ink.\" You read it. You always were my best student — and now you teach me how to hope.",
  },
  {
    id: "1.5-miren", beat: "1.5", tier: "R", speaker: "miren", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, requires: [MIREN], retireOn: "supersede",
    line: "Everything has a price, Commander. I've kept the ledger of every victory. I never wrote down the part where we might lose you — I'd have to pay that twice.",
  },
  {
    id: "1.5-delen", beat: "1.5", tier: "R", speaker: "delen", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, requires: [DELEN], retireOn: "supersede",
    line: "The gold burns clean because you keep it clean. The machine notices every shadow. So do I. Do not let the shadow be you.",
  },
  {
    id: "1.5-serev", beat: "1.5", tier: "R", speaker: "serev", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, requires: [SEREV], retireOn: "supersede",
    line: "I have followed worse orders into better graves. Yours, I'd follow into the last one — and thank you for it after.",
  },
  {
    id: "1.5-kael", beat: "1.5", tier: "R", speaker: "kael", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, marks: ["beat"], requires: [KAEL], retireOn: "supersede",
    line: "We've been here since the first Cradle, you and I. When this is over — when it's really over — I'd like to sit somewhere quiet and not have to be brave with you. Just once.",
  },
  {
    id: "1.5-narrator", beat: "1.5", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "act1-report", reportsAtLeast: 3 }, retireOn: "supersede",
    line: "This is the part they don't put in the histories. The part worth winning for.",
  },

  // ---- Beat 1.6 · the Oracle's warning (3 rows, R) ------------------------
  {
    id: "1.6-oracle-a", beat: "1.6", tier: "R", speaker: "oracle", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "You have climbed so high, little ember. So high. Tell me — when the fire is tallest, does it not throw the longest shadow?",
  },
  {
    id: "1.6-narrator", beat: "1.6", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "The Oracle speaks in riddles. Listen anyway.",
  },
  {
    id: "1.6-oracle-b", beat: "1.6", tier: "R", speaker: "oracle", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "The machine has been patient. It has been taking notes. And the one thing it cannot take... is the thing you will be asked, at the end, to choose. Keep that close. The riddle is not the prize, little ember. The keeping is.",
  },

  // ---- Beat 1.7 · the peak (2 rows, R) — the end of Act I's narration -----
  {
    id: "1.7-a", beat: "1.7", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "You are on the cusp of it. The thing every colony since the Fall has reached for and never touched. It is not a weapon. It is not a title. It is what you are about to become.",
  },
  {
    id: "1.7-b", beat: "1.7", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "It is the last thing the machine wants you to reach.",
  },

  // ==========================================================================
  // ACT II — DORMANT. Nothing in the shipped app sets `stage: "fallen"`
  // (`resolveCataclysm()` has no caller — §10.1), so these rows are correct,
  // gated, and unspoken until the cataclysm slice lands. The three E rows are
  // dormant twice over: by stage AND by mount (there is no rail plate on the
  // Battles view in this slice — D5).
  // ==========================================================================
  {
    id: "2.1-chorus", beat: "2.1", tier: "R", speaker: "chorus", surface: "home",
    gate: { kind: "fall-stage" }, retireOn: "supersede",
    // the caption keeps the script's caps; the voice is sentence-cased by
    // `speakable` (§4.6). No `CHORUS:` prefix and no magenta here — the plate
    // names the speaker in words, and the colour treatment belongs to the Act II
    // overlay (§9).
    line: "YOU WERE WINNING. YOU WERE ALWAYS GOING TO LOSE.",
  },
  {
    id: "2.1-narrator", beat: "2.1", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "This is the thing the histories call the Fall. You did not cause it. You did not earn it. You simply stood in its way — and it has come.",
  },
  {
    id: "2.2-serev", beat: "2.2", tier: "E", speaker: "serev", surface: "battles",
    gate: { kind: "fall-front-live" }, requires: [SEREV], retireOn: "supersede",
    line: "They're not stopping. Reinforce the breach — I'll hold the flank. We make them earn every meter, sir.",
  },
  {
    id: "2.2-lecturer", beat: "2.2", tier: "E", speaker: "lecturer", surface: "battles",
    gate: { kind: "fall-front-live" }, requires: ["last-lecturer"], retireOn: "supersede",
    line: "It is still taking notes. Let it. I will finish the sentence even if the sentence is my own name.",
  },
  {
    id: "2.2-azazel", beat: "2.2", tier: "E", speaker: "azazel-3", surface: "battles",
    gate: { kind: "fall-front-live" }, requires: ["azazel-3"], retireOn: "supersede",
    line: "I stood in front of what I taught once. I will stand in front of it again. I am still standing, Commander.",
  },
  {
    id: "2.2-narrator", beat: "2.2", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "fall-stand" }, retireOn: "supersede",
    line: "You are not losing a battle. You are watching the end of the thing you built — and it is not your fault. It was never going to be winnable. That is what makes it a fall, and not a defeat.",
  },
  {
    id: "2.3-serev", beat: "2.3", tier: "R", speaker: "serev", surface: "home",
    gate: { kind: "fall-stand" }, requires: [SEREV], retireOn: "supersede",
    line: "Get them out. We hold this line. That is an order.",
  },
  {
    id: "2.3-narrator", beat: "2.3", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "They take command. You become the witness.",
  },
  {
    id: "2.3-vyra", beat: "2.3", tier: "R", speaker: "vyra", surface: "home",
    gate: { kind: "after-prev" }, requires: [VYRA], retireOn: "supersede",
    line: "The archive burns, and the lecturer falls silent — but the knowing doesn't burn. Go. Carry the knowing.",
  },
  {
    id: "2.3-miren", beat: "2.3", tier: "R", speaker: "miren", surface: "home",
    gate: { kind: "after-prev" }, requires: [MIREN], retireOn: "supersede",
    line: "I've counted the cost of every victory. This one is ours to pay. Everything has a price, Commander — and this price is not yours.",
  },
  {
    id: "2.3-delen", beat: "2.3", tier: "R", speaker: "delen", surface: "home",
    gate: { kind: "after-prev" }, requires: [DELEN], retireOn: "supersede",
    line: "The gold burns low. Keep what is clean, clean. Do not let the shadow be you. Go now — while there is still a you to go.",
  },
  {
    id: "2.3-kael", beat: "2.3", tier: "R", speaker: "kael", surface: "home",
    gate: { kind: "after-prev" }, requires: [KAEL], retireOn: "supersede",
    line: "I said I'd be here when the last Cradle stood at the end of everything. I meant it. Go, sir. We'll make sure there's something left to come back to.",
  },
  {
    id: "2.4-kael", beat: "2.4", tier: "R", speaker: "kael", surface: "home",
    gate: { kind: "fall-stage" }, marks: ["beat"], requires: [KAEL], retireOn: "supersede",
    line: "We can't hold them, sir. What do we do?",
  },
  {
    // The choice UI is NOT this slice's. The gates are drawn so the cataclysm
    // slice inserts the three seeds between `2.4-narrator` and `2.4-serev`
    // without re-deciding anything: the narration literally waits for
    // `prologue.ashMemory`.
    id: "2.4-silence", beat: "2.4", tier: "S", speaker: null, surface: "home",
    gate: { kind: "after-prev" }, marks: ["silence"], retireOn: "supersede",
    line: SILENCE_CAPTION,
  },
  {
    id: "2.4-narrator", beat: "2.4", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "Save the race, not yourself. Choose what the ash remembers.",
  },
  {
    id: "2.4-serev", beat: "2.4", tier: "R", speaker: "serev", surface: "home",
    gate: { kind: "fall-choice" }, requires: [SEREV], retireOn: "supersede",
    line: "Whatever you choose — choose it like it's the last thing they'll sing about. Because it is.",
  },
  {
    // Beat 2.5 — after this hold the rail stops: the cursor parks, nothing
    // further is handed to the engine, and the VO stays out until the stage
    // changes (Act III). The engine's own stage-change reset re-arms it.
    id: "2.5-silence", beat: "2.5", tier: "S", speaker: null, surface: "home",
    gate: { kind: "after-prev" }, marks: ["silence"], retireOn: "supersede",
    line: SILENCE_CAPTION,
  },

  // ==========================================================================
  // ACT III — DORMANT. `stage: "rebuilt" && completed && finalStand !== null`
  // is produced only by resetToCradle(), which has no caller today. The
  // `finalStand !== null` term is what keeps EVERY legacy/normal colony (whose
  // default block is `freshPrologue()` = rebuilt/false/null) out of the rail.
  // ==========================================================================
  {
    id: "3.1-a", beat: "3.1", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "rebuilt" }, retireOn: "supersede",
    line: "You wake in the ash. You have nothing. But you remember everything.",
  },
  {
    id: "3.1-b", beat: "3.1", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "They did not fall so you could grieve them. They fell so you could begin.",
  },
  {
    id: "3.2-a", beat: "3.2", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "One Cradle. One name. Everything else, you will have to take back from the ash — with your own hands, the way you took it the first time.",
  },
  {
    id: "3.2-b", beat: "3.2", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "Somewhere out there — in the Shatterlands, in the old ruins, in the places you once commanded — the people you loved are not gone. They are unfound. And that is a very different thing.",
  },
  {
    // The 700 ms thesis hold is this row's own (§3, pause map #9).
    id: "3.3-a", beat: "3.3", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, marks: ["thesis"], retireOn: "supersede",
    line: "Rebuild. Remember. Climb.",
  },
  {
    // The LAST row: when it retires the rail marks the opening finished, which
    // is what releases the engine's disarm (D1 — `complete(completed &&
    // railStoryDone())`). Without that, Act III could never speak at all.
    id: "3.3-b", beat: "3.3", tier: "R", speaker: "narrator", surface: "home",
    gate: { kind: "after-prev" }, retireOn: "supersede",
    line: "You were a legend. You had everything. You lost it. Now take it back.",
  },
];

/** The ids, in script order — the cursor's index space. */
export const RAIL_ORDER: readonly string[] = RAIL_ROWS.map((r) => r.id);

/** The rail's cue ids (for the harness: disjoint from the C tier's). */
export const RAIL_CUES: readonly string[] = RAIL_ORDER;

const ROW_BY_ID: Readonly<Record<string, RailRow>> = Object.fromEntries(RAIL_ROWS.map((r) => [r.id, r]));

export function railRowById(id: string): RailRow | undefined {
  return ROW_BY_ID[id];
}

export function railRowsForBeat(beat: string): readonly RailRow[] {
  return RAIL_ROWS.filter((r) => r.beat === beat);
}

// ============================================================================
// §3 CONFIG — one block, tunable numbers only. Every value is either the voice
// sheet's own (imported, never retyped) or a caption pace (never a trigger).
// ============================================================================
export const RAIL_CONFIG = {
  /** §3.2 duty governor: no more than 45 s of speech in any rolling 60 s — the
   *  sheet's cap, imported, never retyped. */
  dutySecondsPerMinute: VOICE_CONFIG.dutySecondsPerMinute,
  dutyWindowMs: 60_000,
  /** The sheet's OWN pace: Act I's word budget over Act I's hard ceiling
   *  (1340 words / 720 s ≈ 1.86 w/s). A caption is priced with it; nothing here
   *  is invented, and a wrong price can only delay a caption. */
  wordsPerSecond: SCENE_WORD_CAPS.actI / VOICE_CONFIG.actIMaxSeconds,
  /** The caption's dwell while the voice cannot speak (muted, no synthesis, or
   *  the player's "Quiet the voices") and only WITHIN a beat that already
   *  started: the row priced at the sheet's pace, floored at the sheet's own
   *  short silence. A caption pace, never a trigger. */
  silentDwellMinMs: VOICE_CONFIG.gaps.silenceShort,
  /** A row whose voice never starts still retires: the dwell plus one turn gap
   *  of grace, so a stalled engine can never park the story. Both numbers are the
   *  sheet's. */
  stallGraceMs: VOICE_CONFIG.gaps.turn,
} as const;

// ============================================================================
// §4 THE PURE CORE — facts in, gate verdicts and the cursor out
// ============================================================================
/** What the app observes. Built by the hook from (state, surface, engine, now). */
export interface RailFacts {
  stage: "height" | "fallen" | "rebuilt";
  completed: boolean;
  /** `prologue.finalStand !== null` — the stand resolved. */
  finalStand: boolean;
  /** `prologue.ashMemory !== null` — the final choice was recorded. */
  ashMemory: boolean;
  /** resolved Act I fronts (`battleReports[].zoneId === frontId`). */
  act1Reports: number;
  /** a live battle on the Act I front. */
  act1Live: boolean;
  /** a live battle that is NOT the Act I front (the Fall's front). */
  fallLive: boolean;
  /** `state.leaders[].id` where `status === "active"` — the height's five. */
  leaders: readonly string[];
  /** `prologue.leaders[].id` — the sealed records (they live after the Fall). */
  sealed: readonly string[];
  /** `prologue.heroes[].id` — the seeded eight. */
  heroes: readonly string[];
  /** the mounted plate's surface, or null when no plate is on screen. */
  surface: RailSurface | null;
  /** `voiceEngine.stats().speaking === null && waiting === 0`. */
  engineIdle: boolean;
  suppressed: boolean;
  now: number;
  /** rows already spoken this session, with the seconds each took (governor). */
  spoken: readonly { id: string; at: number; seconds: number }[];
}

export interface RailState {
  /** index into RAIL_ORDER of the next row to hand the plate. */
  cursor: number;
  done: boolean;
}

/** Build the fact bag from the game state + what the mount/engine report.
 *  Nothing is mutated, nothing is derived from a clock but `now`. */
export function railFacts(
  state: GameState,
  o: { surface: RailSurface | null; engineIdle: boolean; suppressed: boolean; now: number; spoken: RailFacts["spoken"] },
): RailFacts {
  const pro = state.prologue;
  const battles = state.battles ?? [];
  const reports = (state.battleReports ?? []).filter((r) => r && r.zoneId === ACT1_CONFIG.frontId).length;
  return {
    stage: pro?.stage ?? "rebuilt",
    completed: !!pro?.completed,
    finalStand: pro?.finalStand != null,
    ashMemory: pro?.ashMemory != null,
    act1Reports: reports,
    act1Live: battles.some((b) => b && b.zoneId === ACT1_CONFIG.frontId && b.status === "active"),
    fallLive: battles.some((b) => b && b.zoneId !== ACT1_CONFIG.frontId && b.status === "active"),
    leaders: (state.leaders ?? []).filter((l) => l && l.status === "active").map((l) => l.id),
    sealed: (pro?.leaders ?? []).map((l) => l.id),
    heroes: (pro?.heroes ?? []).map((h) => h.id),
    surface: o.surface,
    engineIdle: o.engineIdle,
    suppressed: o.suppressed,
    now: o.now,
    spoken: o.spoken,
  };
}

/** §2 — one pure predicate per gate kind, over facts that exist today.
 *  `after-prev` is deliberately `true`: the ORDER is the cursor's job (a row can
 *  only be reached once every earlier row has retired), and pretending to test
 *  it here would be a second, weaker copy of that rule. */
export function gateOpen(row: RailRow, f: RailFacts): boolean {
  const need = row.gate.reportsAtLeast ?? 0;
  switch (row.gate.kind) {
    case "height-arrival":
      return f.stage === "height" && f.act1Reports === 0;
    case "after-prev":
      return true;
    case "act1-report":
      return f.act1Reports >= need;
    case "act1-front-live":
      return f.act1Live && f.act1Reports >= need;
    case "fall-stage":
      return f.stage === "fallen";
    case "fall-front-live":
      return f.stage === "fallen" && f.fallLive;
    case "fall-stand":
      return f.finalStand;
    case "fall-choice":
      return f.ashMemory;
    case "rebuilt":
      return f.stage === "rebuilt" && f.completed && f.finalStand;
  }
}

/** A gate that can never fire again given the facts (a monotone trigger already
 *  passed it). Only `height-arrival` is like this: the cold open happens once. */
export function gateDead(row: RailRow, f: RailFacts): boolean {
  if (row.gate.kind === "height-arrival") return f.stage !== "height" || f.act1Reports > 0;
  return false;
}

/** The roster the row needs must actually be on the station today: the sealed
 *  records for the leaders' stand, the active five for Act I, the seeded eight
 *  for the heroes. A world without them skips the row; nothing errors. */
export function rosterPresent(row: RailRow, f: RailFacts): boolean {
  const req = row.requires ?? [];
  if (req.length === 0) return true;
  const present = new Set<string>([...f.leaders, ...f.sealed, ...f.heroes]);
  return req.every((id) => present.has(id));
}

/** §6 the duty governor — the ONE place `now` is used, and it can only HOLD a
 *  row back. It can never start one, and it never touches a caption already on
 *  screen, an order button, or any game state. */
export function dutyOpen(row: RailRow, f: RailFacts): boolean {
  const windowStart = f.now - RAIL_CONFIG.dutyWindowMs;
  const spent = f.spoken
    .filter((s) => s.at > windowStart && s.at <= f.now)
    .reduce((sum, s) => sum + s.seconds, 0);
  return spent + railWords(row) / RAIL_CONFIG.wordsPerSecond <= RAIL_CONFIG.dutySecondsPerMinute;
}

/** The honest start after a reload: skip everything a MONOTONE fact already
 *  proves passed (the report ledger, the stage), and seat the cursor on the
 *  first row of the beat that fact belongs to, so a reload cannot replay the war
 *  it missed. D7: rows whose only proof was the session cursor can replay once. */
export function deriveCursor(f: RailFacts): number {
  if (f.stage === "rebuilt" && f.completed && f.finalStand) return indexOf("3.1-a");
  if (f.stage === "fallen") {
    if (f.ashMemory) return indexOf("2.4-serev");
    if (f.finalStand) return indexOf("2.3-serev");
    return indexOf("2.1-chorus");
  }
  if (f.act1Reports >= 3) return indexOf("1.4-b");
  if (f.act1Reports >= 1) return indexOf("1.3-a");
  return 0;
}

export function freshRailState(f: RailFacts): RailState {
  const cursor = deriveCursor(f);
  return { cursor, done: cursor >= RAIL_ROWS.length };
}

/** Idempotent and monotone: re-seats the cursor from the monotone facts and
 *  walks past rows whose gate is dead. It never moves backwards and never
 *  retires a row that is still speakable. */
export function advanceRail(s: RailState, f: RailFacts): RailState {
  let cursor = Math.max(s.cursor, deriveCursor(f));
  while (cursor < RAIL_ROWS.length && gateDead(RAIL_ROWS[cursor], f)) cursor += 1;
  return { cursor, done: cursor >= RAIL_ROWS.length };
}

/** The row the plate should be showing now — or null (nothing due, held by the
 *  governor, quiet, a closed gate, or the mount is on another surface). */
export function nextRailRow(s: RailState, f: RailFacts): RailRow | null {
  if (f.suppressed) return null;
  if (f.surface === null) return null;
  if (!f.engineIdle) return null;
  const row = RAIL_ROWS[s.cursor];
  if (!row) return null;
  if (row.surface !== f.surface) return null;
  if (!rosterPresent(row, f)) return null;
  if (!gateOpen(row, f)) return null;
  if (!dutyOpen(row, f)) return null;
  return row;
}

/** Retire the row currently on the plate (the voice finished it, or the player
 *  pressed "Next line"). Never advances past a row whose gate is closed: if the
 *  head is not speakable, this is a no-op. */
export function stepRail(s: RailState, f: RailFacts): RailState {
  const head = nextRailRow(s, f);
  if (!head) return s;
  const cursor = s.cursor + 1;
  return { cursor, done: cursor >= RAIL_ROWS.length };
}

function indexOf(id: string): number {
  const i = RAIL_ORDER.indexOf(id);
  return i < 0 ? RAIL_ROWS.length : i;
}

// ============================================================================
// §5 READING THE TABLE — pure helpers the hook and the harness both use
// ============================================================================
export function railWords(row: RailRow): number {
  return row.line.split(/\s+/).filter(Boolean).length;
}

export function railBeatWords(beat: string): number {
  return railRowsForBeat(beat).reduce((sum, r) => sum + railWords(r), 0);
}

/** §6 the S tier owns its own hold (a gap the engine — correctly — does not
 *  schedule for a line it never speaks). No new number: the sheet's own. */
export function silenceHoldMs(row: RailRow): number {
  if (row.tier !== "S") return 0;
  return row.beat === "2.5" ? VOICE_CONFIG.gaps.silenceTwo : VOICE_CONFIG.gaps.silenceShort;
}

/** The hold that follows a row, before the next one may be handed: the sheet's
 *  thesis beat (§3.4 #9) and the turn gap between two speakers in one beat. */
export function interRowGapMs(prev: RailRow | null, next: RailRow | null): number {
  if (!next) return 0;
  if (prev && prev.marks?.includes("thesis")) return VOICE_CONFIG.gaps.thesis;
  if (prev && prev.speaker !== next.speaker) return VOICE_CONFIG.gaps.turn;
  return 0;
}

/** The caption's own pace while the voice cannot speak. */
export function silentDwellMs(row: RailRow): number {
  if (row.tier === "S") return silenceHoldMs(row);
  return Math.max(RAIL_CONFIG.silentDwellMinMs, Math.round((railWords(row) / RAIL_CONFIG.wordsPerSecond) * 1000));
}

/** The scene key the voice gets its `(beat)` length from. The sheet defines a
 *  per-beat cap only for Act I (1.0–1.7) and the aggregate keys for Acts II/III,
 *  so an Act II/III beat resolves to its act's key when priced — and to the
 *  script's own "2.x"/"3.x" for the pause map (`beatGapFor` reads `^[23]\.`). */
export function sceneCapKey(beat: string): string {
  if (SCENE_WORD_CAPS[beat] !== undefined) return beat;
  return beat.startsWith("2.") ? "actII" : beat.startsWith("3.") ? "actIII" : beat;
}

// ============================================================================
// §6 THE ONE SESSION-LOCAL FLAG — D1 (voice sheet §5.5, amended 2026-09-24)
// ============================================================================
// The opening is over when the opening has FINISHED SPEAKING, not when the state
// says it did. `resetToCradle()` sets `stage: "rebuilt"` and `completed: true` in
// the same tick, so a disarm on the `completed` flag would silence all six of Act
// III's lines. The disarm therefore moves to the END OF ACT III'S RAIL: the hook
// calls `markRailStoryDone()` when row `3.3-b` retires, and both call sites —
// `RailNarration` (the home mount) and `BattlesTab.useVoiceLayer` — read this
// same predicate: `complete(completed && railStoryDone())`.
//
// It is in-memory, per page load, never persisted, never in GameState, and it is
// the module's ONLY mutable thing (the cursor and the governor live in the hook).
let storyDone = false;

/** Has Act III's last line retired this session? */
export function railStoryDone(): boolean {
  return storyDone;
}

/** Called by the rail's mount exactly once, when `3.3-b` retires. */
export function markRailStoryDone(): void {
  storyDone = true;
}

/** Test/app seam: a fresh session (never called by the UI). */
export function resetRailStoryDone(): void {
  storyDone = false;
}
