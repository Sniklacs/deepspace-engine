// Tests for the Cradle entry state machine (game/world/cradle-entry.ts) —
// the spec §10 normative contract: every transition, interruption safety,
// the z-guards, background recovery, and the spread-hint show cap.
// Run: bun test site/src/game/world/cradle-entry.test.ts
import { describe, expect, test } from "bun:test";
import { BAND_Z2, BAND_Z4 } from "./zoom-bands";
import {
  CRADLE_ENTRY_INITIAL,
  HOVER_PAN_AWAY_DEG,
  isCradleModuleId,
  panBreaksHover,
  recoverFromBackground,
  recordSpreadHint,
  shouldShowSpreadHint,
  SPREAD_HINT_KEY,
  SPREAD_HINT_MAX,
  spreadHintCount,
  syncWithZoom,
  transition,
  type CradleEntryContext,
  type CradleEntryEvent,
  type HintStore,
} from "./cradle-entry";

function ctx(entry: CradleEntryContext["entry"]): CradleEntryContext {
  return { entry, module: null };
}
function send(entry: CradleEntryContext["entry"], type: CradleEntryEvent["type"]): CradleEntryContext {
  return transition(ctx(entry), { type } as CradleEntryEvent);
}

/** No-op assertion: the machine must return the SAME object (callers rely
 *  on reference equality to skip re-renders and history churn). */
function expectNoop(entry: CradleEntryContext["entry"], type: CradleEntryEvent["type"]): void {
  const input = ctx(entry);
  expect(transition(input, { type } as CradleEntryEvent)).toBe(input);
}

/** In-memory HintStore — localStorage shape, no DOM needed. */
function fakeStore(initial: Record<string, string> = {}): HintStore & { raw(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    raw: () => Object.fromEntries(m),
  };
}

describe("transition — the entry chain", () => {
  test("FREE → FOCUSING on TAP_CRADLE; everything else is a no-op", () => {
    const next = send("FREE", "TAP_CRADLE");
    expect(next.entry).toBe("FOCUSING");
    expect(next.module).toBe(null);
    for (const type of ["EASE_DONE", "SPREAD", "PINCH_OUT", "PAN_AWAY", "TAP_ELSEWHERE", "CLOSE_MODULE"] as const) {
      expectNoop("FREE", type);
    }
  });

  test("FOCUSING → HOVERING on EASE_DONE or a second TAP_CRADLE", () => {
    expect(send("FOCUSING", "EASE_DONE").entry).toBe("HOVERING");
    expect(send("FOCUSING", "TAP_CRADLE").entry).toBe("HOVERING");
  });

  test("FOCUSING → DESCENDING on an eager SPREAD (skips the rest of the ease)", () => {
    expect(send("FOCUSING", "SPREAD").entry).toBe("DESCENDING");
  });

  test("FOCUSING interruptions cancel back to FREE", () => {
    expect(send("FOCUSING", "PAN_AWAY").entry).toBe("FREE");
    expect(send("FOCUSING", "TAP_ELSEWHERE").entry).toBe("FREE");
    expect(send("FOCUSING", "PINCH_OUT").entry).toBe("FREE");
  });

  test("HOVERING → DESCENDING on SPREAD or TAP_CRADLE (tap = enter-equivalent)", () => {
    expect(send("HOVERING", "SPREAD").entry).toBe("DESCENDING");
    expect(send("HOVERING", "TAP_CRADLE").entry).toBe("DESCENDING");
  });

  test("HOVERING → FREE on PINCH_OUT, PAN_AWAY, TAP_ELSEWHERE", () => {
    expect(send("HOVERING", "PINCH_OUT").entry).toBe("FREE");
    expect(send("HOVERING", "PAN_AWAY").entry).toBe("FREE");
    expect(send("HOVERING", "TAP_ELSEWHERE").entry).toBe("FREE");
  });

  test("DESCENDING: pinch-out reverses to ASCENDING; pan/spread hold position", () => {
    expect(send("DESCENDING", "PINCH_OUT").entry).toBe("ASCENDING");
    // mid-DESCENDING hold: lifting fingers (no event) keeps the state —
    // pan re-targets the region view, never cancels a committed descent.
    expectNoop("DESCENDING", "PAN_AWAY");
    expectNoop("DESCENDING", "SPREAD");
    expectNoop("DESCENDING", "TAP_ELSEWHERE");
  });

  test("INSIDE → ASCENDING on PINCH_OUT", () => {
    expect(send("INSIDE", "PINCH_OUT").entry).toBe("ASCENDING");
  });

  test("ASCENDING: spread dives back in; the z-guard (not gestures) lands FREE", () => {
    expect(send("ASCENDING", "SPREAD").entry).toBe("DESCENDING");
    expect(send("ASCENDING", "TAP_CRADLE").entry).toBe("DESCENDING");
    expectNoop("ASCENDING", "PINCH_OUT");
    expectNoop("ASCENDING", "PAN_AWAY");
  });
});

describe("transition — module overlay (slice 11)", () => {
  test("ENTER_MODULE opens a valid module only in INSIDE", () => {
    const open = transition(ctx("INSIDE"), { type: "ENTER_MODULE", module: "troops" });
    expect(open.entry).toBe("INSIDE");
    expect(open.module).toBe("troops");
    // unknown ids and wrong states are no-ops
    expect(transition(ctx("INSIDE"), { type: "ENTER_MODULE", module: "nope" }).entry).toBe("INSIDE");
    expect(transition(ctx("FREE"), { type: "ENTER_MODULE", module: "troops" }).entry).toBe("FREE");
    expect(transition(ctx("DESCENDING"), { type: "ENTER_MODULE", module: "troops" }).entry).toBe("DESCENDING");
  });

  test("ENTER_MODULE with the already-open module is a no-op (no history churn)", () => {
    const open: CradleEntryContext = { entry: "INSIDE", module: "forge" };
    expect(transition(open, { type: "ENTER_MODULE", module: "forge" })).toBe(open);
  });

  test("CLOSE_MODULE clears; closing with none open is a no-op", () => {
    const open: CradleEntryContext = { entry: "INSIDE", module: "troops" };
    const closed = transition(open, { type: "CLOSE_MODULE" });
    expect(closed.entry).toBe("INSIDE");
    expect(closed.module).toBe(null);
    expect(transition(ctx("INSIDE"), { type: "CLOSE_MODULE" }).entry).toBe("INSIDE");
  });

  test("leaving INSIDE drops the module (it cannot outlive the ground)", () => {
    const open: CradleEntryContext = { entry: "INSIDE", module: "troops" };
    const next = transition(open, { type: "PINCH_OUT" });
    expect(next.entry).toBe("ASCENDING");
    expect(next.module).toBe(null);
  });

  test("isCradleModuleId guards the URL param", () => {
    expect(isCradleModuleId("troops")).toBe(true);
    expect(isCradleModuleId("warroom")).toBe(true);
    expect(isCradleModuleId("../../../etc")).toBe(false);
    expect(isCradleModuleId("")).toBe(false);
  });
});

describe("syncWithZoom — the camera is the truth", () => {
  test("DESCENDING → INSIDE at the Z4 floor", () => {
    expect(syncWithZoom(ctx("DESCENDING"), BAND_Z4).entry).toBe("INSIDE");
    expect(syncWithZoom(ctx("DESCENDING"), BAND_Z4 + 4).entry).toBe("INSIDE");
  });

  test("mid-DESCENDING hold: z between the boundaries changes nothing", () => {
    const mid = (BAND_Z2 + BAND_Z4) / 2;
    expect(syncWithZoom(ctx("DESCENDING"), mid).entry).toBe("DESCENDING");
    expect(syncWithZoom(ctx("ASCENDING"), mid).entry).toBe("ASCENDING");
  });

  test("ASCENDING → FREE crossing back above the Z1/Z2 boundary", () => {
    expect(syncWithZoom(ctx("ASCENDING"), BAND_Z2 - 0.5).entry).toBe("FREE");
    expect(syncWithZoom(ctx("ASCENDING"), 1).entry).toBe("FREE");
  });

  test("ASCENDING back above the Z4 floor returns to INSIDE", () => {
    expect(syncWithZoom(ctx("ASCENDING"), BAND_Z4).entry).toBe("INSIDE");
  });

  test("programmatic zoom-out from INSIDE follows the camera to ASCENDING (module drops)", () => {
    const open: CradleEntryContext = { entry: "INSIDE", module: "troops" };
    const next = syncWithZoom(open, BAND_Z4 - 1);
    expect(next.entry).toBe("ASCENDING");
    expect(next.module).toBe(null);
  });

  test("programmatic zoom-out from DESCENDING settles HOVERING at the boundary", () => {
    expect(syncWithZoom(ctx("DESCENDING"), BAND_Z2 - 0.5).entry).toBe("HOVERING");
  });

  test("stable states ignore the guard; non-finite z is ignored", () => {
    expect(syncWithZoom(ctx("FREE"), 99).entry).toBe("FREE");
    expect(syncWithZoom(ctx("HOVERING"), 99).entry).toBe("HOVERING");
    expect(syncWithZoom(ctx("INSIDE"), 99).entry).toBe("INSIDE");
    expect(syncWithZoom(ctx("DESCENDING"), NaN).entry).toBe("DESCENDING");
  });
});

describe("recoverFromBackground — nearest stable band", () => {
  test("transient states settle by z", () => {
    expect(recoverFromBackground(ctx("FOCUSING"), BAND_Z4 + 1).entry).toBe("INSIDE");
    expect(recoverFromBackground(ctx("DESCENDING"), (BAND_Z2 + BAND_Z4) / 2).entry).toBe("HOVERING");
    expect(recoverFromBackground(ctx("ASCENDING"), 1).entry).toBe("FREE");
  });

  test("stable states are untouched; the module survives at the ground", () => {
    expect(recoverFromBackground(ctx("FREE"), 5).entry).toBe("FREE");
    expect(recoverFromBackground(ctx("HOVERING"), 5).entry).toBe("HOVERING");
    const open: CradleEntryContext = { entry: "INSIDE", module: "troops" };
    expect(recoverFromBackground(open, BAND_Z4)).toBe(open);
    // …but not halfway down
    const dropped = recoverFromBackground(open, (BAND_Z2 + BAND_Z4) / 2);
    expect(dropped.entry).toBe("HOVERING");
    expect(dropped.module).toBe(null);
  });

  test("non-finite z falls back to FREE", () => {
    expect(recoverFromBackground(ctx("DESCENDING"), NaN).entry).toBe("FREE");
  });
});

describe("panBreaksHover", () => {
  test("drift past the threshold breaks the hold", () => {
    expect(panBreaksHover(0, 0, HOVER_PAN_AWAY_DEG + 1, 0)).toBe(true);
    expect(panBreaksHover(0, 0, 0, -(HOVER_PAN_AWAY_DEG + 1))).toBe(true);
  });

  test("drift within the threshold holds", () => {
    expect(panBreaksHover(0, 0, HOVER_PAN_AWAY_DEG - 1, 0)).toBe(false);
    expect(panBreaksHover(10, 5, 12, 7)).toBe(false);
  });

  test("spin wraps the short way (359° vs 1° is 2°, not 358°)", () => {
    expect(panBreaksHover(359, 0, 1, 0)).toBe(false);
    expect(panBreaksHover(350, 0, 10, 0)).toBe(true);
  });
});

describe("spread-hint show cap (max 3 lifetime shows, then never)", () => {
  test("shows for counts 0–2, never at 3+", () => {
    expect(shouldShowSpreadHint(0)).toBe(true);
    expect(shouldShowSpreadHint(1)).toBe(true);
    expect(shouldShowSpreadHint(2)).toBe(true);
    expect(shouldShowSpreadHint(3)).toBe(false);
    expect(shouldShowSpreadHint(99)).toBe(false);
    expect(SPREAD_HINT_MAX).toBe(3);
  });

  test("recordSpreadHint increments and persists", () => {
    const store = fakeStore();
    expect(recordSpreadHint(store)).toBe(1);
    expect(recordSpreadHint(store)).toBe(2);
    expect(recordSpreadHint(store)).toBe(3);
    expect(spreadHintCount(store)).toBe(3);
    expect(store.raw()[SPREAD_HINT_KEY]).toBe("3");
    // the 4th show is recorded but never displayed
    expect(recordSpreadHint(store)).toBe(4);
    expect(shouldShowSpreadHint(spreadHintCount(store))).toBe(false);
  });

  test("missing/corrupt counts read as 0", () => {
    expect(spreadHintCount(fakeStore())).toBe(0);
    expect(spreadHintCount(fakeStore({ [SPREAD_HINT_KEY]: "banana" }))).toBe(0);
    expect(spreadHintCount(fakeStore({ [SPREAD_HINT_KEY]: "-4" }))).toBe(0);
    expect(spreadHintCount(fakeStore({ [SPREAD_HINT_KEY]: "2" }))).toBe(2);
  });

  test("a throwing store never breaks the game", () => {
    const bad: HintStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(spreadHintCount(bad)).toBe(0);
    expect(recordSpreadHint(bad)).toBe(1);
  });
});

describe("initial context", () => {
  test("starts FREE with no module", () => {
    expect(CRADLE_ENTRY_INITIAL.entry).toBe("FREE");
    expect(CRADLE_ENTRY_INITIAL.module).toBe(null);
  });
});
