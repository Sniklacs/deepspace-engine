// ============================================================================
// ACT I GUIDED TUTORIAL VERIFICATION — The Fall, Step 3 slice 2
// (opening-prologue-spec.md §12.1–§12.4; design/opening-script.md Beat 1.2 +
// Beat 1.4; battle-side-rvr-spec.md §15 B11/B12).
//
// The cue layer is the diegetic tutorial: the narrator and the Watcher Leaders
// speak over the live battle, in-universe. It OBSERVES the battle and the
// decision seam — it never issues or gates an order. This harness is that
// layer's contract:
//
//   1 · the cue table        — ids unique, every cue names a real speaker and a
//        real UI target, every line is the SCRIPT'S line (verbatim against
//        design/opening-script.md), no rule/monetization vocabulary in
//        player-facing copy (§12: in-universe only).
//   2 · triggers             — every trigger kind resolves to the cue order the
//        script tells; every elapsed mark exists in TUTORIAL_CONFIG; an event no
//        cue matches raises NOTHING; a foreign battle's event raises NOTHING.
//   3 · the observer         — observeBattle derives the log purely from the
//        public view (open → elapsed → windows → chip → resolve), once per fact
//        (re-polling duplicates nothing), our side only, win/loss/standoff read
//        from our side's point of view.
//   4 · §12.2 coverage       — every decision order the panel can post is
//        taught; milestone windows teach reinforce + hold; the edge window (the
//        pummeled moment, §12.3) teaches aid call + withdrawal + retreat.
//   5 · §12.1 scaffolding    — battle one is fully guided, battle two thins to a
//        handful, battle three onward is silent (strictly decreasing).
//   6 · §12.4 controls       — step retires the head, "not now" silences
//        instantly, guidance resumes, replay re-folds the same log to the same
//        sequence; the UI carries the controls + aria-live (static scan).
//   7 · determinism          — same event log → byte-identical state, repeated
//        folds identical, duplicate events queue nothing new (idempotent), no
//        Math.random / Date.now / React reachable in the cue modules.
//
// Run:  cd /home/team/shared/prologue-tests && bun run tutorial-verify.ts
// (pure imports — also runnable unchanged from the site dir; use
//  `env -u DATABASE_URL` in the full battery so store.ts stays on files.)
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { createBattle } from "/home/team/shared/site/src/game/war/battle-engine.ts";
import type { Battle, BattleSide, CommittedForce } from "/home/team/shared/site/src/game/war/war-types.ts";
import {
  CUES,
  TEACHING_CUES,
  TUTORIAL_CONFIG,
  TUTORIAL_SPEAKERS,
  UI_TARGET_BY_ACTION,
  activeCue,
  advanceTutorial,
  cueById,
  cueIsVisible,
  cueSequenceFor,
  cueTarget,
  cuesForEvent,
  decodeTutorialPrefs,
  encodeTutorialPrefs,
  freshTutorialState,
  freshWatch,
  guideTierFor,
  observeBattle,
  outcomeForSide,
  replayTutorial,
  setSuppressed,
  speakerLabel,
  stepTutorial,
  triggerMatches,
  windowIndexFromId,
} from "/home/team/shared/site/src/game/war/tutorial-cues.ts";
import type {
  Chip,
  TutorialAction,
  TutorialEvent,
  TutorialState,
  UiTarget,
} from "/home/team/shared/site/src/game/war/tutorial-cues.ts";

const SITE = "/home/team/shared/site";
const TAB_TSX = `${SITE}/src/components/BattlesTab.tsx`;
const LAYER_TSX = `${SITE}/src/components/TutorialCueLayer.tsx`;
const CUES_TS = `${SITE}/src/game/war/tutorial-cues.ts`;
const SCRIPT_MD = "/home/team/shared/design/opening-script.md";
for (const f of [TAB_TSX, CUES_TS, SCRIPT_MD]) {
  if (!existsSync(f)) {
    console.error(`MISSING SOURCE FILE: ${f}`);
    process.exit(1);
  }
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

const S = 60_000; // one minute in ms
const T0 = 1_700_000_000_000;

/** A synthetic battle entity — fully controlled so the observer's contract is
 *  testable at exact clocks (the engine itself is battle-verify's subject). */
function mkBattle(o: Partial<Battle> = {}): Battle {
  const base: Battle = {
    id: "b1",
    zoneId: "z-ravine",
    zoneName: "The Ravine",
    attacker: { side: "attacker", colonyId: "col-a", colonyName: "The Vigil", heroSquad: [], weapons: [], troops: 400, fobStage: 4 },
    defender: { side: "defender", colonyId: "col-b", colonyName: "Hollow", heroSquad: [], weapons: [], troops: 300, fobStage: 3 },
    forcePower: { attacker: 5000, defender: 4900 }, // gap < 0.1 → stalemate
    durationMs: 60 * S,
    startedAt: T0,
    status: "active",
    result: null,
    casualties: { attacker: 0, defender: 0 },
    windows: [
      { id: "w-milestone-0.25-attacker", kind: "milestone", side: "attacker", opensAt: T0 + 15 * S, closesAt: T0 + 30 * S },
      { id: "w-milestone-0.25-defender", kind: "milestone", side: "defender", opensAt: T0 + 15 * S, closesAt: T0 + 30 * S },
      { id: "w-edge-1-defender", kind: "edge", side: "defender", opensAt: T0 + 5 * S, closesAt: T0 + 20 * S },
    ],
    decisions: [],
    aidCalls: [],
    internal: { committedAt: T0 },
  };
  return { ...base, ...o };
}
const force = (side: BattleSide, colonyId: string, colonyName: string): CommittedForce => ({
  side,
  colonyId,
  colonyName,
  heroSquad: [],
  weapons: [],
  troops: 120,
  fobStage: 4,
});
const chipEv = (chip: Chip, at = T0): TutorialEvent => ({ kind: "chip", battleId: "b1", chip, at });
const decisionEv = (action: TutorialAction, windowId = "w-milestone-0.25-attacker"): TutorialEvent => ({
  kind: "decision",
  battleId: "b1",
  windowId,
  action,
  at: T0 + 20 * S,
});
const milestoneEv = (side: BattleSide = "attacker"): TutorialEvent => ({
  kind: "window-open",
  battleId: "b1",
  windowId: `w-milestone-0.25-${side}`,
  windowKind: "milestone",
  windowIndex: 0,
  at: T0 + 15 * S,
});
const edgeEv = (): TutorialEvent => ({
  kind: "window-open",
  battleId: "b1",
  windowId: "w-edge-1-defender",
  windowKind: "edge",
  windowIndex: 1,
  at: T0 + 5 * S,
});

/** The Beat 1.2 golden path: one battle, played the way the script tells it. */
const GOLDEN: TutorialEvent[] = [
  { kind: "battle-open", battleId: "b1", at: T0 },
  chipEv("stalemate", T0 + S),
  { kind: "elapsed", battleId: "b1", afterMs: 60_000, at: T0 + S },
  { kind: "elapsed", battleId: "b1", afterMs: 90_000, at: T0 + S + 30_000 },
  { kind: "elapsed", battleId: "b1", afterMs: 120_000, at: T0 + 2 * S },
  milestoneEv(),
  decisionEv("reinforce"),
  chipEv("pressing", T0 + 25 * S),
  chipEv("rout-risk", T0 + 32 * S),
  edgeEv(),
  decisionEv("callAid", "w-edge-1-defender"),
  { kind: "resolve", battleId: "b1", outcome: "win", at: T0 + 55 * S },
];

// ============================================================================
// 1 · THE CUE TABLE — ids, speakers, targets, script fidelity, copy discipline
// ============================================================================
console.log("\n1 · the cue table");
check("every cue id is unique", new Set(CUES.map((c) => c.id)).size === CUES.length);
check("the table is non-empty and ordered as written", CUES.length >= 12);
check(
  "every cue names a speaker from the cast (§1 of the script)",
  CUES.every((c) => {
    const found = Object.values(TUTORIAL_SPEAKERS).some((s) => s.id === c.speaker.id && s.name === c.speaker.name);
    return found;
  }),
);
check("every cue carries a spoken line of real length", CUES.every((c) => c.line.trim().length > 30));
check(
  "every cue names at least one guidance tier inside 1..3",
  CUES.every((c) => c.tiers.length > 0 && c.tiers.every((t) => t >= 1 && t <= 3)),
);
check("no cue is visible at the hands-off tier", CUES.every((c) => !c.tiers.includes(TUTORIAL_CONFIG.maxGuidedTier + 1)));
check(
  "every cue points at a published UI target",
  CUES.every((c) => Object.values(UI_TARGET_BY_ACTION).includes(c.pointsAt) || c.pointsAt === "live-state-chip" || c.pointsAt === "battle-line" || c.pointsAt === "force-attacker" || c.pointsAt === "force-defender" || c.pointsAt === "decision-panel" || c.pointsAt === "battle-log"),
);
const targets = Array.from(new Set(CUES.map((c) => c.pointsAt))) as UiTarget[];
const tabSrc = readFileSync(TAB_TSX, "utf8");
/** Every `data-tutorial-target=` attribute value in the view (literal or a
 *  ternary of literals). */
const stamped = tabSrc
  .split("data-tutorial-target=")
  .slice(1)
  .flatMap((chunk) => (chunk.slice(0, 160).match(/"([A-Za-z-]+)"/g) ?? []).map((q) => q.replace(/"/g, "")));
check(
  "every cue's target exists in the Battles view as data-tutorial-target",
  targets.every((t) => stamped.includes(t)),
  `missing: ${targets.filter((t) => !stamped.includes(t)).join(",")}`,
);
check(
  "every order button carries the target its cue lights up",
  Object.values(UI_TARGET_BY_ACTION).every((t) => stamped.includes(t)),
);
check("the chip/line/force/squad targets the script highlights are all stamped", ["live-state-chip", "battle-line", "force-attacker", "decision-panel"].every((t) => stamped.includes(t)));
check(
  "every elapsed trigger uses a published mark",
  CUES.every((c) => c.trigger.kind !== "elapsed" || (TUTORIAL_CONFIG.elapsedMarks as readonly number[]).includes(c.trigger.afterMs as number)),
);
check(
  "Speaker captions read the script's way (name — title)",
  speakerLabel(TUTORIAL_SPEAKERS.serev) === "Serev — the Marshal" && speakerLabel(TUTORIAL_SPEAKERS.narrator) === "The Narrator",
);
check(
  "the Watcher Leaders speak under the owner-locked titles",
  ["Kael", "Serev", "Vyra", "Miren", "Delen"].every((n) => Object.values(TUTORIAL_SPEAKERS).some((s) => s.name === n && s.kind === "leader")),
);

// ---- script fidelity: every line is the script's own line, verbatim ---------
const script = readFileSync(SCRIPT_MD, "utf8").replace(/\*/g, "");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const scriptFlat = squash(script);
check(
  "every cue line appears verbatim in design/opening-script.md (no invented copy)",
  CUES.every((c) => scriptFlat.includes(squash(c.line))),
  CUES.filter((c) => !scriptFlat.includes(squash(c.line))).map((c) => c.id).join(","),
);
check(
  "the script really is the source (the pummeled lesson is written there)",
  scriptFlat.includes("We win this together or we don't win it.") && scriptFlat.includes("Pummeled is survivable"),
);

// ---- copy discipline: no rule/monetization vocabulary in spoken lines ------
const BANNED_COPY = ["purchase", "premium", "storefront", "wallet", "price", "$", "g1", "g2", "g3", "g4", "pay-to-win", "guardrail", "solo win", "you must", "not allowed", "error", "disabled"];
check(
  "spoken copy is in-universe (no rule/monetization vocabulary)",
  CUES.every((c) => !BANNED_COPY.some((w) => c.line.toLowerCase().includes(w))),
  CUES.filter((c) => BANNED_COPY.some((w) => c.line.toLowerCase().includes(w))).map((c) => c.id).join(","),
);
check("no cue line is a bare instruction to the interface (no 'click', no 'button')", CUES.every((c) => !/\bclick\b|\bbutton\b|\bUI\b/i.test(c.line)));

// ============================================================================
// 2 · TRIGGERS — order per trigger, coverage, and silence on non-events
// ============================================================================
console.log("\n2 · triggers");
check("battle-open raises the narrator's framing first", cuesForEvent([{ kind: "battle-open", battleId: "b1", at: T0 }], 1).join(",") === "read-the-fight");
check(
  "the stalemate chip raises the chip lesson",
  cuesForEvent([chipEv("stalemate")], 1).join(",") === "read-the-chip",
);
check(
  "the milestone window raises the narrator then the Marshal (script order)",
  cuesForEvent([milestoneEv()], 1).join(",") === "the-line-is-bending,reinforce-or-hold-why",
);
check(
  "the edge window raises the hero then the Marshal",
  cuesForEvent([edgeEv()], 1).join(",") === "aid-call-rides-the-links,pummeled-is-survivable",
);
check("the rout-risk chip raises the pummeled lesson", cuesForEvent([chipEv("rout-risk")], 1).join(",") === "pummeled-is-a-decision");
check("the pressing chip raises the Marshal's nod", cuesForEvent([chipEv("pressing")], 1).join(",") === "pressing-ours");
check(
  "calling aid raises the turn",
  cuesForEvent([decisionEv("callAid")], 1).join(",") === "watch-it-turn",
);
check(
  "withdrawing raises the turn too",
  cuesForEvent([decisionEv("withdrawal")], 1).join(",") === "withdrew-in-order",
);
check(
  "resolving raises the Steward's recap",
  cuesForEvent([{ kind: "resolve", battleId: "b1", outcome: "win", at: T0 }], 1).join(",") === "the-shape-of-it",
);
check(
  "each elapsed mark raises its own teaching beat, in time order",
  [60_000, 90_000, 120_000].map((m) => cuesForEvent([{ kind: "elapsed", battleId: "b1", afterMs: m, at: T0 }], 1).join(",")).join("|") ===
    "command-the-squad|semira-sees-the-flaw|time-the-skill",
);
check("an order no cue teaches (retreat alone) raises nothing", cuesForEvent([decisionEv("retreat")], 1).length === 0);
check("an order no cue teaches (hold alone) raises nothing", cuesForEvent([decisionEv("hold")], 1).length === 0);
check("an unhandled event kind raises nothing", cuesForEvent([{ kind: "tutorial-skipped" } as unknown as TutorialEvent], 1).length === 0);
check("an event of another kind for another battle still matches only by trigger", cuesForEvent([{ kind: "battle-open", battleId: "bX", at: T0 }], 1).length === 1);
check(
  "triggerMatches is exact on the elapsed mark",
  triggerMatches({ kind: "elapsed", afterMs: 60_000 }, { kind: "elapsed", battleId: "b1", afterMs: 60_000, at: T0 }) &&
    !triggerMatches({ kind: "elapsed", afterMs: 60_000 }, { kind: "elapsed", battleId: "b1", afterMs: 90_000, at: T0 }),
);
check(
  "a chip trigger without a value matches any chip change",
  triggerMatches({ kind: "chip" }, chipEv("pressing")) && !triggerMatches({ kind: "chip" }, milestoneEv()),
);
check(
  "a window-open trigger without a kind matches either window",
  triggerMatches({ kind: "window-open" }, milestoneEv()) && triggerMatches({ kind: "window-open" }, edgeEv()),
);

// ============================================================================
// 3 · THE OBSERVER — events derived purely from the public battle view
// ============================================================================
console.log("\n3 · the observer");
{
  const b = mkBattle();
  const obs = observeBattle(freshWatch(), b, T0);
  check("a first poll opens the battle exactly once", obs.events.filter((e) => e.kind === "battle-open").length === 1);
  check("the watch adopts the battle id", obs.watch.battleId === "b1");
  check("a first poll at the start reports no elapsed mark yet", !obs.events.some((e) => e.kind === "elapsed"));
  check("a first poll reports the opening chip", obs.events.some((e) => e.kind === "chip" && e.chip === "stalemate"));
  const again = observeBattle(obs.watch, b, T0);
  check("re-polling the same clock adds nothing", again.events.length === 0);

  const mine = { ...freshWatch(), side: "attacker" as BattleSide };
  const later = observeBattle(observeBattle(mine, b, T0 + 70_000).watch, b, T0 + 130_000);
  check(
    "time-in-battle marks fire once each, in ascending order",
    later.events.filter((e) => e.kind === "elapsed").map((e) => (e as { afterMs: number }).afterMs).join(",") === "90000,120000",
  );
  check(
    "a poll that crosses every mark at once reports them all, in order",
    observeBattle(mine, b, T0 + 130_000).events.filter((e) => e.kind === "elapsed").map((e) => (e as { afterMs: number }).afterMs).join(",") === "60000,90000,120000",
  );

  const w = observeBattle(mine, mkBattle(), T0 + 16 * S);
  const opened = w.events.filter((e) => e.kind === "window-open");
  check("only OUR side's windows are reported", opened.length === 1 && opened.every((e) => (e as { windowId: string }).windowId.endsWith("-attacker")));
  check("the other side's window is left alone", !w.watch.seenWindows.some((id) => id.endsWith("-defender")));
  check("with no side known yet, every open window is reported", observeBattle(freshWatch(), mkBattle(), T0 + 16 * S).events.filter((e) => e.kind === "window-open").length === 3);
  check("the milestone index is derived from the window id", windowIndexFromId("w-milestone-0.25-attacker") === 0 && windowIndexFromId("w-edge-1-defender") === 1);
  check("the second milestone resolves to index 1", windowIndexFromId("w-milestone-0.5-attacker") === 1 && windowIndexFromId("w-milestone-0.75-attacker") === 2);
  check("an unknown window id degrades to index 0", windowIndexFromId("odd-id") === 0);
  check("a window is reported once, never twice", observeBattle(w.watch, mkBattle(), T0 + 16 * S).events.every((e) => e.kind !== "window-open"));

  const rout = mkBattle({ forcePower: { attacker: 9000, defender: 4000 } });
  const routObs = observeBattle({ ...freshWatch(), side: "defender" }, rout, T0 + 6 * S);
  check("a rout-risk battle reads its chip from the public moment", routObs.events.some((e) => e.kind === "chip" && e.chip === "rout-risk"));
  check(
    "the edge window (the pummeled moment) is reported for the side it opened for",
    routObs.events.some((e) => e.kind === "window-open" && (e as { windowKind: string }).windowKind === "edge" && (e as { windowId: string }).windowId === "w-edge-1-defender"),
  );
  check("the pummeled moment is survivable-first: the edge window opens while the fight is still live", routObs.events.filter((e) => e.kind === "window-open").every((e) => (e as { at: number }).at < T0 + rout.durationMs));

  const done = mkBattle({ status: "resolved", result: { outcome: "attacker_victory", winnerColonyId: "col-a", endedAt: T0 + 60 * S } });
  const attackerObs = observeBattle({ ...freshWatch(), side: "attacker", battleId: "b1" }, done, T0 + 61 * S);
  check("a resolved battle reports the resolution once", attackerObs.events.filter((e) => e.kind === "resolve").length === 1);
  check("winning reads as a win for our side", (attackerObs.events.find((e) => e.kind === "resolve") as { outcome: string }).outcome === "win");
  check("no double resolution on the next poll", observeBattle(attackerObs.watch, done, T0 + 62 * S).events.every((e) => e.kind !== "resolve"));
  const defenderObs = observeBattle({ ...freshWatch(), side: "defender", battleId: "b1" }, done, T0 + 61 * S);
  check("the same entity reads as a loss for the other side", (defenderObs.events.find((e) => e.kind === "resolve") as { outcome: string }).outcome === "loss");
  check("outcomeForSide maps standoff and unknown sides to a standoff", outcomeForSide(mkBattle({ result: { outcome: "standoff", endedAt: T0 } }), "attacker") === "standoff" && outcomeForSide(done, null) === "standoff");
  check(
    "the event order is fixed: open → elapsed → windows → chip → resolve",
    (() => {
      const o = observeBattle(freshWatch(), mkBattle({ status: "resolved", result: { outcome: "defender_victory", endedAt: T0 + 60 * S } }), T0 + 61 * S);
      return o.events.map((e) => e.kind).join(",") === "battle-open,elapsed,elapsed,elapsed,chip,resolve";
    })(),
  );
  check(
    "the observer is deterministic (same watch + entity + clock → identical JSON)",
    JSON.stringify(observeBattle(freshWatch(), mkBattle(), T0 + 16 * S).events) === JSON.stringify(observeBattle(freshWatch(), mkBattle(), T0 + 16 * S).events),
  );
  check("the observer never mutates the battle", (() => { const b2 = mkBattle(); const before = JSON.stringify(b2); observeBattle(freshWatch(), b2, T0 + 61 * S); return JSON.stringify(b2) === before; })());
  check(
    "the observer reads a REAL engine battle (createBattle) without touching it",
    (() => {
      const real = createBattle({ zoneId: "z", zoneName: "Z", attacker: force("attacker", "col-a", "A"), defender: force("defender", "col-b", "B") }, T0);
      const before = JSON.stringify(real);
      const o = observeBattle({ ...freshWatch(), side: "attacker" }, real, T0 + 1);
      return o.events[0]?.kind === "battle-open" && JSON.stringify(real) === before;
    })(),
  );
  check(
    "an ended battle whose side is unknown is not narrated as a win",
    outcomeForSide(mkBattle({ result: { outcome: "attacker_victory", endedAt: T0 } }), null) === "standoff",
  );
}

// ============================================================================
// 4 · §12.2 COVERAGE — every order the panel can post is taught, every window
//      teaches what it means (reinforce/hold; pummeled → aid + withdraw/retreat)
// ============================================================================
console.log("\n4 · what the tutorial teaches (§12.2)");
const ACTIONS: TutorialAction[] = ["reinforce", "hold", "callAid", "withdrawal", "retreat", "respondAid"];
const WINDOW_ACTIONS: TutorialAction[] = ["reinforce", "hold", "callAid", "withdrawal", "retreat"];
check("every order a decision window can issue is taught", WINDOW_ACTIONS.every((a) => TEACHING_CUES[a].length > 0), WINDOW_ACTIONS.filter((a) => TEACHING_CUES[a].length === 0).join(","));
check(
  "answering another colony's beacon is not Act I's lesson (the co-op slice teaches that later)",
  TEACHING_CUES.respondAid.length === 0 && CUES.every((c) => !c.trigger.action || c.trigger.action !== "respondAid"),
);
check(
  "TEACHING_CUES is the exact inverse of every cue's teaches list",
  ACTIONS.every((a) => {
    const expected = CUES.filter((c) => c.teaches.includes(a)).map((c) => c.id);
    return TEACHING_CUES[a].join(",") === expected.join(",");
  }),
);
check(
  "no cue teaches an action it does not name",
  CUES.every((c) => c.teaches.every((a) => ACTIONS.includes(a))),
);
check("reinforce and hold are taught inside a milestone window", CUES.filter((c) => c.tiers.includes(1) && c.trigger.windowKind === "milestone").flatMap((c) => c.teaches).join(",").includes("reinforce") && CUES.some((c) => c.trigger.windowKind === "milestone" && c.teaches.includes("hold")));
check(
  "the edge window (pummeled, §12.3) teaches aid call + withdrawal + retreat",
  ["callAid", "withdrawal", "retreat"].every((a) => CUES.some((c) => c.trigger.kind === "window-open" && c.trigger.windowKind === "edge" && c.teaches.includes(a as TutorialAction))),
);
check("the pummeled lesson is told before the chip turns (on the rout-risk chip, not after the loss)", CUES.some((c) => c.trigger.kind === "chip" && c.trigger.chip === "rout-risk" && c.lesson === "pummeled"));
check(
  "the recap closes the lesson with the full order set",
  (cueById("the-shape-of-it")?.teaches ?? []).join(",") === "reinforce,hold,callAid,withdrawal,retreat",
);
check(
  "the Aid Call is taught as the co-op tool (teammates ride the links)",
  (cueById("aid-call-rides-the-links")?.line ?? "").includes("riding the links"),
);
check(
  "the withdrawal/retreat trade is taught (rearguard cost vs. saving the army)",
  (cueById("aid-call-rides-the-links")?.line ?? "").includes("saves the army"),
);
check(
  "the pummeled moment is taught survivable first, never as a loss",
  (cueById("pummeled-is-survivable")?.line ?? "").startsWith("Pummeled is survivable"),
);
check(
  "UI_TARGET_BY_ACTION covers every order key",
  ACTIONS.every((a) => typeof UI_TARGET_BY_ACTION[a] === "string"),
);

// ============================================================================
// 5 · §12.1 PROGRESSIVE SCAFFOLDING — fully guided → thinned → silent
// ============================================================================
console.log("\n5 · progressive scaffolding (§12.1)");
/** Replay one battle's worth of the golden path for the given ordinal. */
function runBattle(ordinal: number, state: TutorialState, id: string): TutorialState {
  const events: TutorialEvent[] = [
    { kind: "battle-open", battleId: id, at: T0 },
    { kind: "chip", battleId: id, chip: "stalemate", at: T0 + S },
    { kind: "elapsed", battleId: id, afterMs: 60_000, at: T0 + S },
    { kind: "elapsed", battleId: id, afterMs: 90_000, at: T0 + S },
    { kind: "elapsed", battleId: id, afterMs: 120_000, at: T0 + 2 * S },
    { kind: "window-open", battleId: id, windowId: `w-milestone-0.25-attacker`, windowKind: "milestone", windowIndex: 0, at: T0 + 15 * S },
    { kind: "decision", battleId: id, windowId: "w-milestone-0.25-attacker", action: "reinforce", at: T0 + 20 * S },
    { kind: "chip", battleId: id, chip: "rout-risk", at: T0 + 32 * S },
    { kind: "window-open", battleId: id, windowId: `w-edge-1-attacker`, windowKind: "edge", windowIndex: 1, at: T0 + 34 * S },
    { kind: "decision", battleId: id, windowId: "w-edge-1-attacker", action: "callAid", at: T0 + 36 * S },
    { kind: "resolve", battleId: id, outcome: "win", at: T0 + 55 * S },
  ];
  void ordinal;
  return advanceTutorial(state, events);
}
{
  const b1 = runBattle(1, freshTutorialState(), "b1");
  const c1 = b1.shown.length;
  const b2 = runBattle(2, b1, "b2");
  const c2 = b2.shown.length;
  const b3 = runBattle(3, b2, "b3");
  const c3 = b3.shown.length;
  check("battle one is fully guided", b1.guide === 1 && c1 >= 10, `guide=${b1.guide} cues=${c1}`);
  check("battle two is thinned", b2.guide === 2 && c2 > 0 && c2 < c1, `guide=${b2.guide} cues=${c2}`);
  check("battle three onward is silent", b3.guide === 3 && c3 === 0, `guide=${b3.guide} cues=${c3}`);
  check("guidance thins strictly (battle1 > battle2 > battle3 = 0)", c1 > c2 && c2 > c3 && c3 === 0, `${c1} > ${c2} > ${c3}`);
  check("battle two keeps the pummeled lesson", b2.shown.includes("pummeled-is-a-decision") && b2.shown.includes("pummeled-is-survivable"));
  check("battle two keeps the reinforce/hold why", b2.shown.includes("reinforce-or-hold-why"));
  check("battle two opens with the coach stepping back", b2.shown[0] === "you-know-the-shape");
  check("battle two drops the hand-holding beats", !b2.shown.includes("read-the-fight") && !b2.shown.includes("semira-sees-the-flaw") && !b2.shown.includes("time-the-skill"));
  check("battle two does not repeat a cue within itself", new Set(b2.shown).size === b2.shown.length);
  check("guideTierFor steps 1 → 2 → 3 and clamps", guideTierFor(1) === 1 && guideTierFor(2) === 2 && guideTierFor(3) === 3 && guideTierFor(9) === 3 && guideTierFor(0) === 1);
  check("a tier-1 cue is invisible at tier 2 and a tier-2 cue invisible at tier 1", !cueIsVisible(cueById("read-the-fight")!, 2) && !cueIsVisible(cueById("you-know-the-shape")!, 1));
  check("the new battle clears the previous queue", b2.pending.every((id) => id !== "read-the-fight"));
}

// ============================================================================
// 6 · §12.4 CONTROLS — step, skip/off, resume, replay
// ============================================================================
console.log("\n6 · skip, step and replay (§12.4)");
{
  const afterOpen = advanceTutorial(freshTutorialState(), [GOLDEN[0]]);
  check("the queue shows the active cue", activeCue(afterOpen)?.id === "read-the-fight");
  check("the active cue's target is the chip", cueTarget(afterOpen) === "live-state-chip");
  check("step retires exactly the head cue", stepTutorial(afterOpen).pending.length === 0);
  check("stepping an empty queue is a no-op", JSON.stringify(stepTutorial(freshTutorialState())) === JSON.stringify(freshTutorialState()));

  const woven = advanceTutorial(stepTutorial(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 6))), [GOLDEN[6]]);
  check("acting on a window retires the cues that taught it", !woven.pending.includes("the-line-is-bending") && !woven.pending.includes("reinforce-or-hold-why"));
  check("the player's own step survives into the next trigger", (() => {
    const s = advanceTutorial(stepTutorial(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 6))), [GOLDEN[7]]);
    return s.pending.includes("pressing-ours");
  })());

  const off = setSuppressed(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 3)), true);
  check("'not now' empties the queue at once", off.pending.length === 0 && off.suppressed);
  const muted = advanceTutorial(off, GOLDEN.slice(3));
  check("nothing speaks while guidance is off", muted.pending.length === 0);
  check("guidance-off still counts the battles fought (the tier keeps stepping)", muted.battlesSeen >= 1);
  const back = advanceTutorial(setSuppressed(muted, false), [chipEv("pressing")]);
  check("guidance resumes on the next real trigger", back.pending.includes("pressing-ours"));
  check("resuming does not re-play the whole lesson at once", back.pending.length <= 2);

  const replayed = replayTutorial(muted, GOLDEN);
  const original = advanceTutorial(freshTutorialState(), GOLDEN);
  check("replay re-folds the same log to the same queue", JSON.stringify(replayed.pending) === JSON.stringify(original.pending));
  check("replay re-arms a silenced run without touching the battles-seen count", replayed.suppressed === false && replayed.battlesSeen === original.battlesSeen);
  check("replay re-raises every cue that battle one had", replayed.shown.length === original.shown.length);
  check("replay of a replay is identical (idempotent)", JSON.stringify(replayTutorial(replayed, GOLDEN).pending) === JSON.stringify(replayed.pending));

  check("prefs round-trip", (() => { const p = { suppressed: true, battlesSeen: 4 }; return JSON.stringify(decodeTutorialPrefs(encodeTutorialPrefs(p))) === JSON.stringify(p); })());
  check("garbage prefs fall back to guidance-on, zero battles", JSON.stringify(decodeTutorialPrefs("{not json")) === JSON.stringify({ suppressed: false, battlesSeen: 0 }));
  check("a negative or fractional battles-seen count is clamped", decodeTutorialPrefs(encodeTutorialPrefs({ suppressed: false, battlesSeen: -3 })).battlesSeen === 0 && decodeTutorialPrefs(encodeTutorialPrefs({ suppressed: false, battlesSeen: 2.7 })).battlesSeen === 2);
  check("missing prefs fall back to guidance-on", decodeTutorialPrefs(null).suppressed === false && decodeTutorialPrefs(undefined).battlesSeen === 0);
  check("the prefs key is namespaced to the tutorial", TUTORIAL_CONFIG.storageKeys.prefs.includes("tutorial"));
}

// ============================================================================
// 7 · DETERMINISM / IDEMPOTENCE — same log → same sequence, once per fact
// ============================================================================
console.log("\n7 · determinism & idempotence");
{
  const a = cueSequenceFor(GOLDEN).join(",");
  const b = cueSequenceFor(GOLDEN).join(",");
  const c = cueSequenceFor([...GOLDEN]).join(",");
  check("the same event log yields the same cue sequence, run to run", a === b && b === c && a.length > 0);
  const full = advanceTutorial(freshTutorialState(), GOLDEN);
  check("folding in one call equals folding event by event", JSON.stringify(full) === JSON.stringify(GOLDEN.reduce((s, e) => advanceTutorial(s, [e]), freshTutorialState())));
  check("folding never mutates the input state", (() => { const s = freshTutorialState(); const before = JSON.stringify(s); advanceTutorial(s, GOLDEN); return JSON.stringify(s) === before; })());
  check("folding never mutates the event log", (() => { const log = [...GOLDEN]; const before = JSON.stringify(log); advanceTutorial(freshTutorialState(), log); return JSON.stringify(log) === before; })());

  const dupDecision = advanceTutorial(freshTutorialState(), [...GOLDEN.slice(0, 8), GOLDEN[6], GOLDEN[6]]);
  const onceDecision = advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 8));
  check("a re-posted decision queues nothing new", JSON.stringify(dupDecision.pending) === JSON.stringify(onceDecision.pending) && dupDecision.shown.length === onceDecision.shown.length);
  const dupChip = advanceTutorial(freshTutorialState(), [...GOLDEN.slice(0, 9), chipEv("rout-risk")]);
  check("a re-observed chip queues nothing new", dupChip.shown.length === advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 9)).shown.length);
  check("a cue is queued at most once per battle", new Set(full.shown).size === full.shown.length);
  check("no cue duplicates inside the pending queue", new Set(full.pending).size === full.pending.length);

  const other = advanceTutorial(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 3)), [{ kind: "chip", battleId: "bZZZ", chip: "rout-risk", at: T0 }]);
  check("events for a battle we are not tracking raise nothing", !other.pending.includes("pummeled-is-a-decision"));
  const junk = advanceTutorial(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 3)), [{ kind: "nonsense" } as unknown as TutorialEvent]);
  check("an unhandled event leaves the state untouched", JSON.stringify(junk) === JSON.stringify(advanceTutorial(freshTutorialState(), GOLDEN.slice(0, 3))));
  check("an empty log changes nothing", JSON.stringify(advanceTutorial(freshTutorialState(), [])) === JSON.stringify(freshTutorialState()));
  check("activeCue is null on an empty queue and cueTarget follows the head", activeCue(freshTutorialState()) === null && cueTarget(freshTutorialState()) === null);
  const wrapped = advanceTutorial(freshTutorialState({ battlesSeen: 5 }), GOLDEN);
  check("a long-time player who reaches battle six gets no cues at all", wrapped.pending.length === 0 && wrapped.shown.length === 0);
  const mutedFromPrefs = cueSequenceFor(GOLDEN, { suppressed: true });
  check("a run started muted raises nothing at all", mutedFromPrefs.length === 0);
}

// ============================================================================
// 8 · THE UI WIRING — the overlay exists, is reachable, and never blocks a
//      decision; the cue layer stays an OBSERVER (no order posting, no store)
// ============================================================================
console.log("\n8 · UI wiring & discipline");
{
  check("the layer component exists", existsSync(LAYER_TSX));
  const layer = existsSync(LAYER_TSX) ? readFileSync(LAYER_TSX, "utf8") : "";
  check("the overlay carries its own testid + cue id", layer.includes('data-testid="tutorial-cue"') && layer.includes("data-cue-id"));
  check("the overlay has the visible skip/off control (§12.4)", layer.includes('data-testid="tutorial-suppress"'));
  check("the overlay has the replay control (§12.4)", layer.includes('data-testid="tutorial-replay"'));
  check("the overlay has a manual step (keyboard reachable)", layer.includes('data-testid="tutorial-step"'));
  check("the spoken line is announced politely to assistive tech", layer.includes('aria-live="polite"'));
  check("the overlay names the speaker and the line as text (captions, WCAG AA)", layer.includes("speakerLabel") && layer.includes("cue.line"));
  // The plate is ONE component with TWO mounts since the beat-rail slice
  // (design/prologue-beat-rail-spec.md §5.3.1): `ariaLabel` defaults to the
  // Battles mount's ratified words and the rail passes its own. The check is the
  // same claim — the overlay is labelled — with the label now coming in as a prop.
  check("the overlay is labelled for screen readers",
    layer.includes('aria-label="Battle guidance"') || layer.includes("aria-labelledby") ||
    (layer.includes("aria-label={ariaLabel}") && layer.includes('ariaLabel = "Battle guidance"')));
  check("no focus trap in the cue layer (no autofocus, no inert)", !/autoFocus|inert\b/.test(layer) && !/tabIndex=\{-1\}/.test(layer));
  check("the cue layer adds no motion of its own (reduced-motion safe)", !/animate-|transition-/.test(layer));
  check("the cue layer never posts an order (observer only)", !/battleIssueFn|battleRespondFn|issuePayload|respondPayload/.test(layer));
  check("the cue layer imports no store/auth (pure UI over pure data)", !/from ".*(store|auth)"/.test(layer));
  check("the Battles view renders the cue layer", tabSrc.includes("TutorialCueLayer") && tabSrc.includes("useBattleTutorial"));
  check("the Battles view still carries the decision seam untouched", tabSrc.includes("onDecision") && tabSrc.includes('data-testid="decision-reinforce"'));
  check("the Battles view passes the seam's decision event straight through", /onDecision=\{onTutorialDecision\}|onTutorialDecision\(/.test(tabSrc));
  check("no order button is gated by the tutorial (existing disable rules only)", (() => {
    const panel = tabSrc.split("function DecisionPanel")[1]?.split("function BattleDetail")[0] ?? "";
    const disables = panel.match(/disabled=\{[^}]*\}/g) ?? [];
    return disables.length > 0 && disables.every((d) => !/tutorial/i.test(d));
  })());
  const cuesSrc = readFileSync(CUES_TS, "utf8").replace(/\/\/[^\n]*/g, "");
  check("no Math.random reachable in the cue module", !cuesSrc.includes("Math.random"));
  check("no wall-clock reachable in the cue module (time arrives as events)", !cuesSrc.includes("Date.now("));
  check("the cue module imports no React and no DOM", !/from "react"|document\.|window\./.test(cuesSrc));
  check("the cue module imports only the public battle engine + types", /from "\.\/battle-engine"/.test(cuesSrc) && /from "\.\/war-types"/.test(cuesSrc) && !/from "\.\.\/(store|api|auth|engine|monetization)"/.test(cuesSrc));
  check("no guardrail/monetization vocabulary in the cue module's executable copy", !/purchase|premium|storefront|wallet|pay-to-win/i.test(cuesSrc));
  check("the cue module documents the audio seam for the next slice", /audio/i.test(readFileSync(CUES_TS, "utf8")));
}

// ============================================================================
console.log(`\ntutorial-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
