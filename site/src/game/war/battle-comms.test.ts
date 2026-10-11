import { describe, expect, test } from "bun:test";
import {
  COMMS_EVENT_KINDS,
  COMMS_SHOWN,
  commsFor,
  commsView,
  criticalPingFor,
  dismissBubble,
  MAX_COMMS,
  pushBubble,
  REPORT_ARROW_LEN,
  REPORT_PROGRESS,
  watchProgress,
  watchShouldReport,
  type CommsBubble,
  type MoveWatch,
} from "./battle-comms";

const mk = (id: number, critical = false): CommsBubble => ({
  id,
  source: "TEST",
  message: `message ${id}`,
  critical,
  atS: id * 10,
});

describe("battle comms queue", () => {
  test("bubbles persist until tapped — dismiss removes only that bubble", () => {
    let q: CommsBubble[] = [];
    q = pushBubble(q, mk(1));
    q = pushBubble(q, mk(2));
    q = pushBubble(q, mk(3));
    expect(q.length).toBe(3);
    q = dismissBubble(q, 2);
    expect(q.map((b) => b.id)).toEqual([1, 3]);
    // tapping a missing id is a no-op
    q = dismissBubble(q, 99);
    expect(q.length).toBe(2);
  });

  test("queue caps at MAX_COMMS — oldest unread age out", () => {
    let q: CommsBubble[] = [];
    for (let i = 1; i <= MAX_COMMS + 3; i++) q = pushBubble(q, mk(i));
    expect(q.length).toBe(MAX_COMMS);
    expect(q[0].id).toBe(4);
  });

  test("view shows ~3 with overflow count and unread badge", () => {
    let q: CommsBubble[] = [];
    for (let i = 1; i <= 5; i++) q = pushBubble(q, mk(i));
    const v = commsView(q);
    expect(v.shown.length).toBe(COMMS_SHOWN);
    expect(v.overflow).toBe(5 - COMMS_SHOWN);
    expect(v.unread).toBe(5);
  });

  test("no overflow line when the queue fits", () => {
    const q = [mk(1), mk(2)];
    const v = commsView(q);
    expect(v.shown.length).toBe(2);
    expect(v.overflow).toBe(0);
    expect(v.unread).toBe(2);
  });

  test("critical styling flag survives the queue", () => {
    let q: CommsBubble[] = [];
    q = pushBubble(q, mk(1, true));
    q = pushBubble(q, mk(2, false));
    const v = commsView(q);
    expect(v.shown[0].critical).toBe(true);
    expect(v.shown[1].critical).toBe(false);
  });
});

describe("comms event specs", () => {
  test("every comms event produces a bubble AND a log entry (source + message)", () => {
    for (const kind of COMMS_EVENT_KINDS) {
      const spec = commsFor(kind, "Flank L");
      // bubble
      expect(spec.source.length > 0).toBe(true);
      expect(spec.message.length > 0).toBe(true);
      // log entry fields derive from the same spec — nothing to lose
      const logEntry = { squadName: spec.source, reason: spec.message };
      expect(logEntry.squadName).toBe(spec.source);
      expect(logEntry.reason).toBe(spec.message);
    }
  });

  test("critical alerts pulse: movement, scout loss, chorus attacks, clock-1/end", () => {
    const critical: Record<string, boolean> = {
      movement: true,
      "scout-lost": true,
      "scout-ok": false,
      wave: true,
      counter: true,
      spoiling: true,
      envelop: true,
      "clock-3": false,
      "clock-1": true,
      "clock-end": true,
      phase: false,
      reserve: false,
    };
    for (const kind of COMMS_EVENT_KINDS) {
      expect(commsFor(kind, "Flank L").critical).toBe(critical[kind]);
    }
  });

  test("movement report names the reporting sector", () => {
    const spec = commsFor("movement", "FLANK L");
    expect(spec.source.includes("FLANK L")).toBe(true);
    expect(spec.message.includes("FLANK L")).toBe(true);
    // the report shows direction, not a perfect destination readout
    expect(spec.message.includes("pushing toward")).toBe(true);
  });
});

describe("movement watches", () => {
  const watch = (over: Partial<MoveWatch> = {}): MoveWatch => ({
    units: [
      { x: 0.5, y: 0.5, state: "advancing" },
      { x: 0.5, y: 0.5, state: "advancing" },
    ],
    fromX: 0.5,
    fromY: 0.8,
    toX: 0.5,
    toY: 0.2,
    destVector: "MAIN",
    startsAt: 100,
    reported: false,
    ...over,
  });

  test("progress tracks the live centroid along the move", () => {
    const w = watch();
    expect(watchProgress(w)).toBeCloseTo(0.5, 6); // halfway
    const early = watch({ units: [{ x: 0.5, y: 0.75, state: "advancing" }] });
    expect(watchProgress(early)).toBeLessThan(0.5);
    const late = watch({ units: [{ x: 0.5, y: 0.3, state: "advancing" }] });
    expect(watchProgress(late)).toBeGreaterThan(0.5);
  });

  test("no report before step-off, report at ~50%, never twice", () => {
    const w = watch();
    expect(watchShouldReport(w, 99)).toBe(false); // still plotting
    expect(watchShouldReport(w, 100)).toBe(true); // stepped off, at 50%
    const done = watch({ reported: true });
    expect(watchShouldReport(done, 500)).toBe(false);
  });

  test("dead units don't drag the centroid — the report follows the living", () => {
    const w = watch({
      units: [
        { x: 0.5, y: 0.8, state: "dead" },
        { x: 0.5, y: 0.2, state: "advancing" },
      ],
    });
    expect(watchProgress(w)).toBeCloseTo(1, 6);
    expect(watchShouldReport(w, 100)).toBe(true);
  });

  test("the arrow is a fixed-length direction vector, not a destination readout", () => {
    expect(REPORT_ARROW_LEN).toBe(0.18);
    expect(REPORT_PROGRESS).toBe(0.5);
  });
});

describe("criticalPingFor — the world-level critical ping (pure)", () => {
  test("null for an empty queue — no ping, no noise", () => {
    expect(criticalPingFor("b1", [])).toBe(null);
  });

  test("null when nothing in the queue is critical", () => {
    const q = [mk(1), mk(2), mk(3)];
    expect(criticalPingFor("b1", q)).toBe(null);
  });

  test("returns the latest UNREAD critical bubble, carrying its identity", () => {
    const q = [mk(1, true), mk(2, false), mk(3, true), mk(4, false)];
    const ping = criticalPingFor("b7", q);
    expect(ping).toBeDefined();
    expect(ping).toEqual({
      battleId: "b7",
      bubbleId: 3, // the originating bubble — the globe's dedupe key
      source: "TEST",
      message: "message 3",
      atS: 30,
    });
  });

  test("does not mutate the queue — the bubbles stay unread until tapped", () => {
    const q = [mk(1, true), mk(2)];
    const before = q.map((b) => b.id);
    criticalPingFor("b1", q);
    expect(q.map((b) => b.id)).toEqual(before);
    expect(q).toHaveLength(2);
  });

  test("tapping the bubble (the confirmed read) clears the ping", () => {
    let q = [mk(1, false), mk(2, true)];
    expect(criticalPingFor("b1", q)).toBeDefined();
    q = dismissBubble(q, 2);
    expect(criticalPingFor("b1", q)).toBe(null);
  });

  test("with several criticals unread, the next-latest surfaces after the tap", () => {
    let q = [mk(1, true), mk(2, true)];
    expect(criticalPingFor("b1", q)?.bubbleId).toBe(2);
    q = dismissBubble(q, 2);
    expect(criticalPingFor("b1", q)?.bubbleId).toBe(1);
  });
});
