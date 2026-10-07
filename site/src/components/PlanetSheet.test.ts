// PlanetSheet.test.ts — regression pin for the bottom-nav occlusion found
// by live QA (2026-10-06): the "Send scout probe" button sat at the very
// bottom of the fixed sheet and the 64px bottom nav painted over it; only
// keyboard Enter could reach it. The fix: the sheet's content wrapper pads
// its bottom by the app's clearance formula (nav + dock + safe-area inset,
// app.css .shell-body / .win-frame), so the primary action always rests
// above the nav. Source-pins follow the server-build.test.ts precedent.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "PlanetSheet.tsx"), "utf-8");

describe("PlanetSheet bottom-nav clearance", () => {
  test("content wrapper pads by nav + dock + safe-area inset (app clearance formula)", () => {
    expect(src).toMatch(
      /pb-\[calc\(var\(--spacing-nav\)\+var\(--dock-h,0px\)\+env\(safe-area-inset-bottom\)/,
    );
  });

  test("sheet does not rely on the bare safe-area inset alone", () => {
    expect(src.includes("pb-[env(safe-area-inset-bottom)]")).toBe(false);
  });

  test("sheet layout caps are unchanged (72dvh, scrollable)", () => {
    expect(src.includes("max-h-[72dvh]")).toBe(true);
    expect(src.includes("overflow-y-auto")).toBe(true);
  });
});
