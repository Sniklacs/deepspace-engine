// window-appearance.test.ts — the player's window chrome settings.
import { describe, expect, test, beforeEach } from "bun:test";
import {
  DEFAULT_APPEARANCE,
  TINT_PRESETS,
  getWindowAppearance,
  initWindowAppearance,
  resetWindowAppearance,
  setWindowAppearance,
} from "./window-appearance";

beforeEach(() => {
  // bun's test env has no DOM storage; a minimal in-memory stand-in.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>)["localStorage"] = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const props = new Map<string, string>();
  (globalThis as Record<string, unknown>)["document"] = {
    documentElement: {
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
        getPropertyValue: (k: string) => props.get(k) ?? "",
        cssText: "",
      },
    },
  };
  localStorage.clear();
  initWindowAppearance();
});

describe("window-appearance", () => {
  test("defaults to the shipped solid look", () => {
    expect(getWindowAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE.opacity).toBe(1);
  });

  test("opacity clamps to the readable range", () => {
    expect(setWindowAppearance({ opacity: 0.1 }).opacity).toBe(0.35);
    expect(setWindowAppearance({ opacity: 2 }).opacity).toBe(1);
    expect(setWindowAppearance({ opacity: NaN }).opacity).toBe(1);
  });

  test("tint must be a hex color; junk is ignored", () => {
    const before = getWindowAppearance().tint;
    setWindowAppearance({ tint: "not-a-color" });
    expect(getWindowAppearance().tint).toBe(before);
    setWindowAppearance({ tint: "#12202e" });
    expect(getWindowAppearance().tint).toBe("#12202e");
  });

  test("paints CSS variables the window chrome reads", () => {
    setWindowAppearance({ opacity: 0.7, tint: "#12202e" });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--win-bg")).toMatch("rgba(18, 32, 46, 0.70)");
    // the titlebar sits a touch more solid for readability
    expect(root.style.getPropertyValue("--win-titlebar-bg")).toMatch("0.82");
  });

  test("persists across inits and resets to default", () => {
    setWindowAppearance({ opacity: 0.6, tint: "#2b1418" });
    expect(initWindowAppearance()).toEqual({ opacity: 0.6, tint: "#2b1418" });
    expect(resetWindowAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  test("presets are valid hex tints", () => {
    expect(TINT_PRESETS.length).toBeGreaterThan(0);
    for (const p of TINT_PRESETS) {
      expect(p.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
