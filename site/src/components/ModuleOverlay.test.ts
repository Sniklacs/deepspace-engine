// Tests for the module overlay URL helpers (components/ModuleOverlay.tsx) —
// Phase 2, slice 11: ?module= round-trips, unknown ids, param preservation.
// Run: bun test site/src/components/ModuleOverlay.test.ts
import { describe, expect, test } from "bun:test";
import {
  CRADLE_MODULE_LABEL,
  cradleModuleIds,
  cradleModuleLabel,
  MODULE_PARAM,
  readModuleParam,
  withModuleParam,
} from "./ModuleOverlay";

const BASE = "https://the-unbound-chi.vercel.app/play";

describe("readModuleParam", () => {
  test("reads a valid module id", () => {
    expect(readModuleParam(`${BASE}?module=troops`)).toBe("troops");
    expect(readModuleParam(`${BASE}?module=warroom`)).toBe("warroom");
  });

  test("null when absent, empty, or unknown (never throws, never trusts)", () => {
    expect(readModuleParam(BASE)).toBe(null);
    expect(readModuleParam(`${BASE}?module=`)).toBe(null);
    expect(readModuleParam(`${BASE}?module=nope`)).toBe(null);
    expect(readModuleParam(`${BASE}?module=../../../etc`)).toBe(null);
    expect(readModuleParam("not a url")).toBe(null);
  });

  test("reads through other params", () => {
    expect(readModuleParam(`${BASE}?tab=world&module=forge`)).toBe("forge");
  });
});

describe("withModuleParam", () => {
  test("sets the param, preserving path, other params, and hash", () => {
    const out = withModuleParam(`${BASE}?tab=world#top`, "laboratory");
    const u = new URL(out);
    expect(u.searchParams.get(MODULE_PARAM)).toBe("laboratory");
    expect(u.searchParams.get("tab")).toBe("world");
    expect(u.hash).toBe("#top");
    expect(u.pathname).toBe("/play");
  });

  test("replaces an existing module param (switches don't stack history)", () => {
    const out = withModuleParam(`${BASE}?module=troops`, "forge");
    expect(new URL(out).searchParams.get(MODULE_PARAM)).toBe("forge");
  });

  test("null strips only the module param", () => {
    const out = withModuleParam(`${BASE}?module=troops&tab=world`, null);
    const u = new URL(out);
    expect(u.searchParams.get(MODULE_PARAM)).toBe(null);
    expect(u.searchParams.get("tab")).toBe("world");
  });

  test("round-trips: with → read", () => {
    for (const id of cradleModuleIds()) {
      expect(readModuleParam(withModuleParam(BASE, id))).toBe(id);
    }
    expect(readModuleParam(withModuleParam(`${BASE}?module=troops`, null))).toBe(null);
  });
});

describe("module labels", () => {
  test("every module id has a label", () => {
    for (const id of cradleModuleIds()) {
      expect(cradleModuleLabel(id)).toBe(CRADLE_MODULE_LABEL[id]);
      expect(typeof CRADLE_MODULE_LABEL[id]).toBe("string");
    }
    expect(cradleModuleIds().length).toBeGreaterThan(0);
  });
});
