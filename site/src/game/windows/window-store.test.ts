// window-store.test.ts — the window manager's contracts.
//
// Owner 2026-10-01: windows stay open until HE closes them. These tests pin
// the behaviors that make that true: dedupe-by-kind+key, focus-not-duplicate,
// minimize parks (never closes), and close is the only dismissal.
import { describe, expect, test, beforeEach } from "bun:test";
import {
  openWindow,
  closeWindow,
  closeWindowsOfKind,
  minimizeWindow,
  restoreWindow,
  focusWindow,
  resizeWindow,
  resetWindowSize,
  isWindowOpen,
  visibleWindows,
  minimizedWindows,
  resetWindows,
  windowSnapshot,
  WIN_MIN_W,
  WIN_MIN_H,
} from "./window-store";

beforeEach(() => {
  resetWindows();
});

describe("openWindow", () => {
  test("opens a window with a stable id", () => {
    const id = openWindow("chat");
    expect(id).toBe("chat::chat");
    expect(isWindowOpen("chat")).toBe(true);
    expect(windowSnapshot().windows).toHaveLength(1);
  });

  test("opening the same kind+key focuses instead of duplicating", () => {
    openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    expect(windowSnapshot().windows).toHaveLength(1);
  });

  test("different keys are different windows", () => {
    openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    openWindow("satellite-research", { key: "rim-7", props: { nodeId: "rim-7" } });
    expect(windowSnapshot().windows).toHaveLength(2);
  });

  test("reopening a minimized window restores it", () => {
    const id = openWindow("chat");
    minimizeWindow(id);
    expect(isWindowOpen("chat")).toBe(false);
    openWindow("chat");
    expect(isWindowOpen("chat")).toBe(true);
    expect(minimizedWindows()).toHaveLength(0);
  });
});

describe("stacking", () => {
  test("later windows render above earlier ones; focus brings to front", () => {
    const a = openWindow("chat");
    const b = openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    let vis = visibleWindows();
    expect(vis[vis.length - 1].id).toBe(b);
    focusWindow(a);
    vis = visibleWindows();
    expect(vis[vis.length - 1].id).toBe(a);
  });
});

describe("minimize", () => {
  test("minimize parks the window — it is not closed", () => {
    const id = openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    minimizeWindow(id);
    expect(windowSnapshot().windows).toHaveLength(1); // still registered
    expect(isWindowOpen("satellite-research", "rim-3")).toBe(false); // not visible
    expect(minimizedWindows()).toHaveLength(1);
  });

  test("restore brings it back to the front, visible", () => {
    const id = openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    minimizeWindow(id);
    restoreWindow(id);
    expect(isWindowOpen("satellite-research", "rim-3")).toBe(true);
    expect(minimizedWindows()).toHaveLength(0);
  });

  test("minimizing twice is a no-op", () => {
    const id = openWindow("chat");
    minimizeWindow(id);
    minimizeWindow(id);
    expect(minimizedWindows()).toHaveLength(1);
  });
});

describe("close", () => {
  test("close removes the window", () => {
    const id = openWindow("chat");
    closeWindow(id);
    expect(windowSnapshot().windows).toHaveLength(0);
    expect(isWindowOpen("chat")).toBe(false);
  });

  test("closing an unknown id is a no-op", () => {
    closeWindow("chat::nope");
    expect(windowSnapshot().windows).toHaveLength(0);
  });

  test("closeWindowsOfKind closes every window of the kind", () => {
    openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    openWindow("satellite-research", { key: "rim-7", props: { nodeId: "rim-7" } });
    openWindow("chat");
    closeWindowsOfKind("satellite-research");
    expect(windowSnapshot().windows).toHaveLength(1);
    expect(isWindowOpen("chat")).toBe(true);
  });
});

describe("persistence across navigation", () => {
  test("windows survive a store read cycle — nothing auto-closes", () => {
    // Navigation unmounts the host; the store is the truth. Re-reading the
    // snapshot (what a remount does) must show the same windows.
    openWindow("chat");
    const id = openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    minimizeWindow(id);
    const before = windowSnapshot();
    // simulate remount: fresh reads, no writes
    const after = windowSnapshot();
    expect(after.windows).toHaveLength(before.windows.length);
    expect(after.windows.map((w) => w.id).sort()).toEqual(before.windows.map((w) => w.id).sort());
    expect(after.windows.find((w) => w.id === id)?.minimized).toBe(true);
  });
});

describe("resize", () => {
  test("resizeWindow sets an explicit size", () => {
    const id = openWindow("chat");
    resizeWindow(id, 500, 400);
    expect(windowSnapshot().windows.find((w) => w.id === id)?.size).toEqual({ w: 500, h: 400 });
  });

  test("resize clamps to the minimum size", () => {
    const id = openWindow("chat");
    resizeWindow(id, 10, 10);
    expect(windowSnapshot().windows.find((w) => w.id === id)?.size).toEqual({ w: WIN_MIN_W, h: WIN_MIN_H });
  });

  test("resizing an unknown id is a no-op", () => {
    resizeWindow("chat::nope", 500, 400);
    expect(windowSnapshot().windows).toHaveLength(0);
  });

  test("size is remembered per kind and restored on reopen", () => {
    const id = openWindow("chat");
    resizeWindow(id, 520, 430);
    closeWindow(id);
    openWindow("chat");
    expect(isWindowOpen("chat")).toBe(true);
    expect(windowSnapshot().windows[0]?.size).toEqual({ w: 520, h: 430 });
  });

  test("sizes are per-kind: satellite keeps its own", () => {
    const chat = openWindow("chat");
    resizeWindow(chat, 520, 430);
    const sat = openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    resizeWindow(sat, 700, 600);
    closeWindow(chat);
    closeWindow(sat);
    openWindow("chat");
    openWindow("satellite-research", { key: "rim-3", props: { nodeId: "rim-3" } });
    const wins = windowSnapshot().windows;
    expect(wins.find((w) => w.kind === "chat")?.size).toEqual({ w: 520, h: 430 });
    expect(wins.find((w) => w.kind === "satellite-research")?.size).toEqual({ w: 700, h: 600 });
  });

  test("resetWindowSize forgets the custom size", () => {
    const id = openWindow("chat");
    resizeWindow(id, 520, 430);
    resetWindowSize(id);
    expect(windowSnapshot().windows.find((w) => w.id === id)?.size).toBeNull();
    closeWindow(id);
    openWindow("chat");
    expect(windowSnapshot().windows[0]?.size).toBeNull();
  });

  test("resetWindows clears remembered sizes (test isolation)", () => {
    const id = openWindow("chat");
    resizeWindow(id, 520, 430);
    closeWindow(id);
    resetWindows();
    openWindow("chat");
    expect(windowSnapshot().windows[0]?.size).toBeNull();
  });
});
