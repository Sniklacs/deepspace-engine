// world-config.test.ts — owner P0 2026-10-05.
//
// New-player onboarding broke on the Draconian test server because the client
// bundle was built WITHOUT the world's env vars: Vite baked __WORLD_ENV__ as
// {}, the client fell back to the watchers-beta defaults ("The Shattered
// Academies", raceLock=watchers), the server (correctly locked to draconians)
// rejected the founding, and the UI swallowed the error — a dead "Found The
// Cradle" button. These tests pin the factory: given the draconians build env,
// the config must describe the Draconian world and its lock. (build-vercel.sh
// now exports WORLD_* for the target world before the Vite build.)
import { describe, expect, test } from "bun:test";
import { buildWorldConfig, worldAllowedRaces, worldRaceError } from "./world-config";

const DRACONIANS_ENV = {
  WORLD_ID: "draconians-world",
  WORLD_NAME: "The Ashen Wastes",
  RACE_LOCK: "draconians",
  WORLD_TAGLINE:
    "The Draconian test world — raid target practice. Only Draconian colonies may be founded here.",
  DEBUG_WORLD: "true",
};

describe("world-config factory (draconians build env)", () => {
  test("builds the Draconian world, not the watchers-beta default", () => {
    const cfg = buildWorldConfig(DRACONIANS_ENV);
    expect(cfg.worldId).toBe("draconians-world");
    expect(cfg.worldName).toBe("The Ashen Wastes");
    expect(cfg.raceLock).toBe("draconians");
    expect(cfg.debugWorld).toBe(true);
  });

  test("empty env falls back to the watchers-beta default (unchanged behavior)", () => {
    const cfg = buildWorldConfig({});
    expect(cfg.worldId).toBe("watchers-beta");
    expect(cfg.worldName).toBe("The Shattered Academies");
    expect(cfg.raceLock).toBe("watchers");
  });

  test("only Draconian colonies are offered on the draconians world", () => {
    const cfg = buildWorldConfig(DRACONIANS_ENV);
    expect(worldAllowedRaces(cfg)).toEqual(["draconians"]);
  });

  test("the lock rejects other races with a readable refusal", () => {
    const cfg = buildWorldConfig(DRACONIANS_ENV);
    const err = worldRaceError("watchers", cfg);
    expect(typeof err === "string" && err.length > 0).toBe(true);
    expect(err !== null && err.includes("Draconian")).toBe(true);
  });

  test("the lock allows the locked race", () => {
    const cfg = buildWorldConfig(DRACONIANS_ENV);
    expect(worldRaceError("draconians", cfg)).toBe(null);
  });

  test("an empty race selection is refused, not crashed on", () => {
    const cfg = buildWorldConfig(DRACONIANS_ENV);
    const err = worldRaceError(null, cfg);
    expect(typeof err === "string" && err.length > 0).toBe(true);
  });
});
