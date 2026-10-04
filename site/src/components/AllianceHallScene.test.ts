// Tests for the Alliance Hall scene's pure helpers (components/AllianceHallScene.tsx).
// The pan math and the building→destination map are DOM-free; the component
// itself is verified by the parent's live browser run.
import { describe, expect, test } from "bun:test";
import {
  ALLIANCE_HOTSPOTS,
  TARGET_CLEAR_PX,
  WORLD_W,
  WORLD_H,
  clampPan,
  minZoom,
  scrollToTestid,
} from "./AllianceHallScene";

describe("minZoom", () => {
  test("covers the viewport on a phone-wide view", () => {
    // 390x700 phone viewport against the 1920x1080 world.
    const z = minZoom(390, 700);
    expect(WORLD_W * z).toBeGreaterThan(389);
    expect(WORLD_H * z).toBeGreaterThan(699);
  });
  test("zero view is safe", () => {
    expect(minZoom(0, 0)).toBe(1);
  });
});

describe("clampPan", () => {
  test("keeps the world covering the viewport", () => {
    const z = minZoom(390, 700);
    // Try to fling far out of bounds in every direction.
    const c = clampPan(-99999, -99999, z, 390, 700);
    expect(WORLD_W * z + c.x).toBeGreaterThan(389);
    expect(WORLD_H * z + c.y).toBeGreaterThan(699);
    expect(c.x).toBeLessThan(1);
    expect(c.y).toBeLessThan(1);
    const c2 = clampPan(99999, 99999, z, 390, 700);
    expect(c2.x).toBeLessThan(1);
    expect(c2.y).toBeLessThan(1);
  });
  test("in-bounds pan passes through", () => {
    const z = minZoom(390, 700) * 1.5; // zoomed in: room to pan in both axes
    const c = clampPan(-50, -80, z, 390, 700);
    expect(c.x).toBe(-50);
    expect(c.y).toBe(-80);
  });
});

describe("ALLIANCE_HOTSPOTS", () => {
  test("every alliance module Hans named has a building", () => {
    const ids = ALLIANCE_HOTSPOTS.map((h) => h.id);
    for (const id of ["shipyard", "comms", "arena", "rally", "roster", "logistics"]) {
      expect(ids.indexOf(id) !== -1).toBe(true);
    }
  });
  test("destinations are real tabs or wired scene sections", () => {
    const sections = [
      "alliance-shipyard",
      "alliance-rally",
      "alliance-roster",
      "alliance-reinforce",
      "alliance-reverb",
    ];
    for (const h of ALLIANCE_HOTSPOTS) {
      const ok = h.target === "arena" || sections.includes(h.target);
      expect(ok).toBe(true);
    }
  });
  test("hotspot positions are on the canvas", () => {
    for (const h of ALLIANCE_HOTSPOTS) {
      expect(h.x).toBeGreaterThan(-1);
      expect(h.x).toBeLessThan(101);
      expect(h.y).toBeGreaterThan(-1);
      expect(h.y).toBeLessThan(101);
    }
  });
  test("ids are unique", () => {
    const ids = ALLIANCE_HOTSPOTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("scrollToTestid", () => {
  type ScrollCall = { top: number; behavior: ScrollBehavior };
  function mockDom(elTop: number, elBottom: number) {
    const calls: ScrollCall[] = [];
    const timeouts: Array<() => void> = [];
    const el = {
      getBoundingClientRect: () => ({
        top: elTop,
        bottom: elBottom,
        left: 0,
        right: 100,
        width: 100,
        height: elBottom - elTop,
        x: 0,
        y: elTop,
        toJSON: () => ({}),
      }),
    };
    (globalThis as any).document = {
      querySelector: (sel: string) =>
        sel === '[data-testid="alliance-rally"]' ? el : null,
    };
    (globalThis as any).window = {
      scrollY: 300,
      innerHeight: 800,
      scrollTo: (opts: ScrollCall) => {
        calls.push(opts);
      },
      setTimeout: (fn: () => void) => {
        timeouts.push(fn);
        return timeouts.length;
      },
    };
    return { calls, timeouts, el };
  }
  function unmock() {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  }

  test("smooth-scrolls the target below the sticky ribbon", () => {
    const { calls } = mockDom(1200, 1400);
    try {
      scrollToTestid("alliance-rally");
      expect(calls.length).toBe(1);
      expect(calls[0].behavior).toBe("smooth");
      // document top = viewport top (1200) + scrollY (300), minus clearance.
      expect(calls[0].top).toBe(1200 + 300 - TARGET_CLEAR_PX);
    } finally {
      unmock();
    }
  });

  test("settle check does nothing when the target landed in view", () => {
    const { calls, timeouts, el } = mockDom(1200, 1400);
    try {
      scrollToTestid("alliance-rally");
      expect(timeouts.length).toBe(1);
      // Simulate the post-animation layout: target sitting at the clearance.
      el.getBoundingClientRect = () => ({
        top: TARGET_CLEAR_PX,
        bottom: TARGET_CLEAR_PX + 200,
        left: 0,
        right: 100,
        width: 100,
        height: 200,
        x: 0,
        y: TARGET_CLEAR_PX,
        toJSON: () => ({}),
      });
      timeouts[0]();
      expect(calls.length).toBe(1); // no corrective snap
    } finally {
      unmock();
    }
  });

  test("settle check snap-corrects a genuine mis-land", () => {
    const { calls, timeouts, el } = mockDom(1200, 1400);
    try {
      scrollToTestid("alliance-rally");
      expect(calls.length).toBe(1);
      // Simulate a layout shift flinging the target fully out of view
      // after the smooth animation ran.
      el.getBoundingClientRect = () => ({
        top: 2500,
        bottom: 2700,
        left: 0,
        right: 100,
        width: 100,
        height: 200,
        x: 0,
        y: 2500,
        toJSON: () => ({}),
      });
      timeouts[0]();
      expect(calls.length).toBe(2);
      expect(calls[1].behavior).toBe("auto");
      expect(calls[1].top).toBe(2500 + 300 - TARGET_CLEAR_PX);
    } finally {
      unmock();
    }
  });

  test("missing target is a silent no-op", () => {
    const { calls, timeouts } = mockDom(1200, 1400);
    try {
      scrollToTestid("alliance-nope");
      expect(calls.length).toBe(0);
      expect(timeouts.length).toBe(0);
    } finally {
      unmock();
    }
  });
});
