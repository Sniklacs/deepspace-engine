// world-stage.test.ts — THE WORLD STAGE (owner 2026-10-14): Hans, reacting
// to the tutorial capture: "Take the whole 'the world' section away — like a
// whole fifth of the screen is being used by that. Get rid of that and make
// it the motherfucker INTERACTIVE. Make it full screen… I don't want to see
// a fifth of my screen being used up by a fucking picture that does nothing."
//
// The World tab used to open with a PageBanner (world-banner.webp at h-40 —
// ~19% of a phone viewport — of dead decoration) over a 62dvh globe in a
// scroll column of panels. Now the globe IS the landing: a fixed full stage
// between the ribbon and the nav, the world's name as a scene overlay, and
// every panel behind one ≥44px desk door (the Cradle pattern: the scene is
// a place you stand in; business waits behind a door you press).
//
// These source pins follow the exit-law.test.ts / PlanetSheet.test.ts
// precedent: they guard the structure so the band can't creep back.
// (Assertions use .includes() + toBe — bun:test's Matchers type in this
// tree has no toContain.)
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf-8");
const has = (src: string, needle: string) => src.includes(needle);

describe("World stage — the dead banner band is gone (play.tsx)", () => {
  const src = read("../routes/play.tsx");
  const worldBlock = src.slice(
    src.indexOf('{tab === "world"'),
    src.indexOf('{tab === "battles"'),
  );

  test("the world tab renders no PageBanner", () => {
    expect(has(worldBlock, "<PageBanner")).toBe(false);
  });

  test("the world banner artwork is not referenced by the world tab", () => {
    expect(has(worldBlock, "world-banner.webp")).toBe(false);
  });

  test("the world tab is the WorldMapView stage itself", () => {
    expect(has(worldBlock, "<WorldMapView")).toBe(true);
  });
});

describe("World stage — the globe fills the screen (WorldMapView)", () => {
  const src = read("WorldMapView.tsx");

  test("the stage is a fixed box in the shell's stage geometry", () => {
    expect(has(src, 'data-testid="world-stage"')).toBe(true);
    expect(has(src, "var(--spacing-ribbon)")).toBe(true);
    expect(has(src, "var(--spacing-nav)")).toBe(true);
  });

  test("the old scroll column is gone", () => {
    expect(has(src, "p-4 pb-24")).toBe(false);
  });

  test("the globe renders in fill mode", () => {
    expect(/<WorldGlobe\s+fill/.test(src)).toBe(true);
  });

  test("the world's name and tagline live as a scene overlay", () => {
    expect(has(src, 't("world.title", "The World")')).toBe(true);
    expect(has(src, 't("world.sub"')).toBe(true);
  });

  test("raid warnings ride the stage as a tappable pill", () => {
    expect(has(src, "worldmap.alertWarnings")).toBe(true);
  });

  test("the desk door is a real door — at least 48px tall", () => {
    expect(has(src, 'data-testid="world-desk-door"')).toBe(true);
    expect(has(src, "min-h-[48px]")).toBe(true);
  });
});

describe("World desk — business behind a door, Exit-Law clean", () => {
  const src = read("WorldMapView.tsx");

  test("the desk is its own dialog surface", () => {
    expect(has(src, 'data-testid="world-desk"')).toBe(true);
    expect(has(src, 'role="dialog"')).toBe(true);
  });

  test("the desk has a visible back door at the 44px floor", () => {
    expect(has(src, 't("world.deskBack", "Back to the globe")')).toBe(true);
    expect(has(src, "min-h-[44px]")).toBe(true);
  });

  test("Escape closes the desk", () => {
    expect(has(src, 'e.key === "Escape"')).toBe(true);
  });

  test("globe actions open the desk aimed at their entry", () => {
    expect(has(src, 'setDeskFocus({ kind: "colony", key })')).toBe(true);
    expect(has(src, 'setDeskFocus({ kind: "raid", id: raid.raidId })')).toBe(true);
  });

  test("the planet sheet stays a top-level sibling — never trapped in the desk", () => {
    // Order in the render: desk opens … memorials (the desk's last panel)
    // … and only then the planet sheet, a sibling the globe's system view
    // can open whether or not the desk exists.
    const deskAt = src.indexOf('data-testid="world-desk"');
    const memorialsAt = src.indexOf("<MemorialsView");
    const sheetAt = src.indexOf("<PlanetSheet");
    expect(deskAt).toBeGreaterThan(-1);
    expect(memorialsAt).toBeGreaterThan(deskAt);
    expect(sheetAt).toBeGreaterThan(memorialsAt);
  });
});

describe("World stage — the globe's fill mode (WorldGlobe)", () => {
  const src = read("WorldGlobe.tsx");

  test("fill is an optional prop — the default render is untouched", () => {
    expect(has(src, "fill?: boolean")).toBe(true);
    expect(has(src, 'height: "62dvh"')).toBe(true);
  });

  test("fill swaps the 62dvh box for a full-height wrap", () => {
    expect(has(src, "h-full w-full touch-pan-y")).toBe(true);
    expect(has(src, "mapFullscreen || fill ? undefined")).toBe(true);
  });
});
