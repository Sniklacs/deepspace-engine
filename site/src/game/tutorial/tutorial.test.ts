// TUTORIAL FRAMEWORK — the school's contract.
// The machine is patient (only the CURRENT step can be satisfied), honest
// (event steps can't be buttoned through), and forgiving (skip is always
// available, completion persists, done never re-nags). The acts data is
// audited like doctrine: purpose before mechanics, everywhere, and the
// battle act provably teaches the owner's seven curriculum points.
import { describe, expect, test } from "bun:test";
import {
  applyTutEvent,
  confirmTutStep,
  currentStep,
  decodeProgress,
  encodeProgress,
  freshProgress,
  isActComplete,
  learnCoachMark,
  newRun,
  nextCoachMark,
  recordLesson,
  recommendedAct,
  resumeLessonIndex,
  skipTutLesson,
  type TutRun,
} from "./framework";
import { TUT_ACTS, BATTLE_ACT } from "./acts";
import { eventsFromSceneSnapshots } from "./battle-observer";
import { buildTrainingScene } from "./training-scene";
import { buildDemoScene } from "../war/battle-scene-model";
import { sceneUISnapshot, type SceneUIState } from "../war/battle-scene-ui-store";

function runAt(actId: string, lesson: number, step: number): TutRun {
  return { actId, lesson, step, status: "active" };
}

/** Structural event membership (the guard's matcher typing lacks the
 *  containment matchers — a boolean keeps this suite inside the budget). */
function hasEvent(evs: unknown[], want: unknown): boolean {
  const w = JSON.stringify(want);
  return evs.some((e) => JSON.stringify(e) === w);
}

describe("step machine", () => {
  test("a read step advances on confirm; an event step refuses the button", () => {
    // battle lesson 0 step 0 is a read
    let run = newRun("battle");
    expect(currentStep(TUT_ACTS, run)?.done.kind).toBe("read");
    run = confirmTutStep(run, TUT_ACTS);
    expect([run.lesson, run.step]).toEqual([0, 1]);
    // step 1 is the squad-selection event — confirm must NOT advance it
    expect(currentStep(TUT_ACTS, run)?.done.kind).toBe("event");
    const refused = confirmTutStep(run, TUT_ACTS);
    expect([refused.lesson, refused.step]).toEqual([0, 1]);
  });

  test("only a matching event advances an event step", () => {
    const run = runAt("battle", 0, 1); // "touch a squad"
    const wrong = applyTutEvent(run, TUT_ACTS, { name: "order", orderKind: "move", vector: "MAIN" });
    expect([wrong.lesson, wrong.step]).toEqual([0, 1]);
    const right = applyTutEvent(run, TUT_ACTS, { name: "squad", vector: "MAIN" });
    expect([right.lesson, right.step]).toEqual([1, 0]);
  });

  test("vector matching honors a list (either flank satisfies the flank step)", () => {
    const run = runAt("battle", 2, 1); // entries: swing a flank
    const main = applyTutEvent(run, TUT_ACTS, { name: "order", orderKind: "move", vector: "MAIN" });
    expect([main.lesson, main.step]).toEqual([2, 1]);
    const flank = applyTutEvent(run, TUT_ACTS, { name: "order", orderKind: "move", vector: "FLANK_RIGHT" });
    expect([flank.lesson, flank.step]).toEqual([2, 2]);
  });

  test("order kind must match — a plain move is not a hot drop", () => {
    const run = runAt("battle", 2, 2); // entries: hot-drop the reserve
    const move = applyTutEvent(run, TUT_ACTS, { name: "order", orderKind: "move", vector: "RESERVE" });
    expect([move.lesson, move.step]).toEqual([2, 2]);
    const drop = applyTutEvent(run, TUT_ACTS, { name: "order", orderKind: "hotdrop", vector: "RESERVE" });
    expect([drop.lesson, drop.step]).toEqual([2, 3]);
  });

  test("skip lesson forgives the rest of the lesson and lands on the next", () => {
    const run = skipTutLesson(runAt("battle", 3, 0), TUT_ACTS);
    expect([run.lesson, run.step, run.status]).toEqual([4, 0, "active"]);
  });

  test("the finish step completes the act", () => {
    const last = BATTLE_ACT.lessons.length - 1;
    const run = confirmTutStep(runAt("battle", last, 0), TUT_ACTS);
    expect(run.status).toBe("complete");
  });

  test("a completed run ignores further events", () => {
    const done: TutRun = { actId: "battle", lesson: 0, step: 0, status: "complete" };
    expect(applyTutEvent(done, TUT_ACTS, { name: "squad" })).toBe(done);
  });
});

describe("progress + persistence", () => {
  test("codec round-trips and tolerates garbage", () => {
    let p = freshProgress();
    p = recordLesson(p, "battle", "vectors", BATTLE_ACT);
    p = { ...learnCoachMark(p, "drag"), offerDismissed: true };
    const back = decodeProgress(encodeProgress(p));
    expect(back.acts["battle"]?.lessons).toEqual(["vectors"]);
    expect(back.offerDismissed).toBe(true);
    expect(back.coach).toEqual(["drag"]);
    expect(decodeProgress("not json")).toEqual(freshProgress());
    expect(decodeProgress(null)).toEqual(freshProgress());
    expect(decodeProgress('{"acts":{"x":{"status":"bogus","lessons":[]}}}').acts).toEqual({});
  });

  test("resume index is the first unfinished lesson; completion is total", () => {
    let p = freshProgress();
    expect(resumeLessonIndex(p, BATTLE_ACT)).toBe(0);
    p = recordLesson(p, "battle", "vectors", BATTLE_ACT);
    expect(resumeLessonIndex(p, BATTLE_ACT)).toBe(1);
    expect(isActComplete(p, BATTLE_ACT)).toBe(false);
    for (const l of BATTLE_ACT.lessons) p = recordLesson(p, "battle", l.id, BATTLE_ACT);
    expect(isActComplete(p, BATTLE_ACT)).toBe(true);
    expect(p.acts["battle"]?.status).toBe("done");
    expect(resumeLessonIndex(p, BATTLE_ACT)).toBe(BATTLE_ACT.lessons.length);
  });

  test("the recommended act is the first incomplete one in lived order", () => {
    const founding = TUT_ACTS[0];
    let p = freshProgress();
    expect(recommendedAct(p, TUT_ACTS)?.id).toBe("founding");
    for (const l of founding.lessons) p = recordLesson(p, "founding", l.id, founding);
    expect(recommendedAct(p, TUT_ACTS)?.id).toBe("cradle");
  });
});

describe("coach marks", () => {
  test("they introduce in order, learn once, and never repeat", () => {
    let p = freshProgress();
    expect(nextCoachMark(p)).toBe("drag");
    p = learnCoachMark(p, "drag");
    expect(nextCoachMark(p)).toBe("resize");
    expect(learnCoachMark(p, "drag")).toBe(p); // idempotent — same object
    p = learnCoachMark(learnCoachMark(p, "resize"), "opacity");
    expect(nextCoachMark(p)).toBe("appearance");
    p = learnCoachMark(p, "appearance");
    expect(nextCoachMark(p)).toBeNull();
  });
});

describe("acts data — the comprehensibility audit, enforced", () => {
  test("every act and lesson states its purpose before its mechanics", () => {
    for (const act of TUT_ACTS) {
      expect(act.purpose.length).toBeGreaterThan(40);
      expect(act.lessons.length).toBeGreaterThan(0);
      const stepIds = new Set<string>();
      for (const lesson of act.lessons) {
        expect(lesson.purpose.length).toBeGreaterThan(30);
        expect(lesson.steps.length).toBeGreaterThan(0);
        for (const step of lesson.steps) {
          expect(step.body.length).toBeGreaterThan(20);
          expect(stepIds.has(`${lesson.id}/${step.id}`)).toBe(false);
          stepIds.add(`${lesson.id}/${step.id}`);
          if (step.done.kind === "event") expect(step.doLabel?.length ?? 0).toBeGreaterThan(10);
        }
      }
    }
  });

  test("the battle act teaches the owner's seven curriculum points", () => {
    const ids = BATTLE_ACT.lessons.map((l) => l.id);
    for (const want of ["vectors", "tap-move", "entries", "cover", "targeting", "modes", "commitment"]) {
      expect(ids.includes(want)).toBe(true);
    }
    const events = BATTLE_ACT.lessons.flatMap((l) =>
      l.steps.filter((s) => s.done.kind === "event").map((s) => JSON.stringify(s.done)),
    );
    // entries: flank move, reserve hot-drop, rear combat drop
    expect(events.some((e) => e.includes('"jumpdrop"'))).toBe(true);
    expect(events.some((e) => e.includes('"hotdrop"'))).toBe(true);
    expect(events.some((e) => e.includes("FLANK"))).toBe(true);
    // cover, focus, and taking the helm in MANUAL
    expect(events.some((e) => e.includes('"cover"'))).toBe(true);
    expect(events.some((e) => e.includes('"focus"'))).toBe(true);
    expect(events.some((e) => e.includes('"mode"') && e.includes('"manual"'))).toBe(true);
    // the hero trap is taught (Hans's own corollary)
    const targeting = BATTLE_ACT.lessons.find((l) => l.id === "targeting");
    expect(targeting?.steps.some((s) => s.body.includes("hero") && s.body.includes("trap") || s.id === "the-hero-trap")).toBe(true);
  });
});

describe("battle observer", () => {
  const base = (): SceneUIState => sceneUISnapshot();

  test("an accepted judged order becomes an order event with kind + vector", () => {
    const prev = base();
    const next: SceneUIState = {
      ...prev,
      squads: [{ id: "A0", name: "Main Squad", alive: 10, total: 14 }],
      orderLog: [{ id: 99, squadName: "Main Squad", dest: "north", verdict: "accepted", kind: "move" }],
    };
    const evs = eventsFromSceneSnapshots(prev, next);
    expect(hasEvent(evs, { name: "order", orderKind: "move", vector: "MAIN" })).toBe(true);
  });

  test("a rejected order is an order-rejected event; comms chatter is ignored", () => {
    const prev = base();
    const next: SceneUIState = {
      ...prev,
      orderLog: [
        { id: 5, squadName: "Rear", dest: "—", verdict: "accepted", kind: "comms" },
        { id: 6, squadName: "Rear", dest: "north", verdict: "rejected", kind: "move", reason: "committed" },
      ],
    };
    const evs = eventsFromSceneSnapshots(prev, next);
    expect(evs).toEqual([{ name: "order-rejected" }]);
  });

  test("cover, focus (with the leader flag), selection, and mode flips are observed", () => {
    const prev = base();
    const next: SceneUIState = {
      ...prev,
      selectedSquadId: "A4",
      squadCover: { A1: "A0" },
      focusTargetId: "e7",
      enemyUnitIntel: [
        { id: "e7", squadId: "D", kind: "warden", hp01: 1, distToFriendly: 0.2, leader: true, name: "Kael" } as never,
      ],
      manual: true,
    };
    const evs = eventsFromSceneSnapshots(prev, next);
    expect(hasEvent(evs, { name: "squad", vector: "RESERVE" })).toBe(true);
    expect(hasEvent(evs, { name: "cover" })).toBe(true);
    expect(hasEvent(evs, { name: "focus", leader: true })).toBe(true);
    expect(hasEvent(evs, { name: "mode", orderKind: "manual" })).toBe(true);
  });

  test("no diff, no events — and a null prev teaches nothing", () => {
    const s = base();
    expect(eventsFromSceneSnapshots(s, s)).toEqual([]);
    expect(eventsFromSceneSnapshots(null, s)).toEqual([]);
  });
});

describe("training scene", () => {
  test("attacker waves arrive at teaching pace; the reserve waits for the hand", () => {
    const scene = buildTrainingScene(1_000_000);
    const atk = scene.units.filter((u) => u.side === "attacker");
    const byVector = (v: string) => atk.filter((u) => u.vector === v);
    expect(byVector("MAIN").every((u) => u.enterAtS === 4)).toBe(true);
    expect(byVector("FLANK_LEFT").every((u) => u.enterAtS === 7)).toBe(true);
    expect(byVector("REAR").every((u) => u.enterAtS === 20)).toBe(true);
    expect(byVector("RESERVE").every((u) => u.onCall === true && u.enterAtS >= 3600)).toBe(true);
  });

  test("the garrison is forgiving — half the demo's strength, same engine", () => {
    const now = 1_000_000;
    const demo = buildDemoScene(now);
    const training = buildTrainingScene(now);
    const demoDef = demo.units.filter((u) => u.side === "defender");
    const trainDef = training.units.filter((u) => u.side === "defender");
    expect(trainDef.length).toBe(demoDef.length);
    for (let i = 0; i < demoDef.length; i++) {
      expect(trainDef[i].hp01).toBeCloseTo(Math.max(0.1, demoDef[i].hp01 * 0.5), 5);
    }
    expect(training.id).toBe("guided-first-battle");
  });
});
