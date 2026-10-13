// squad-command.test.ts — the commander's quick-pick domain rules.
// Run: bun test site/src/game/war/squad-command.test.ts
import { describe, expect, test } from "bun:test";
import { coverIneligibility, squadWeaponRangeM } from "./squad-command";

describe("coverIneligibility — who can supply cover (owner 2026-10-13)", () => {
  test("an on-field squad with living troops can cover", () => {
    expect(coverIneligibility({ alive: 12 }, false)).toBe(null);
  });

  test("a squad can't cover itself — the picker never lists it (component contract)", () => {
    // The picker filters the selected squad out of its own list; the rule
    // itself only judges the candidates it is handed.
    expect(coverIneligibility({ alive: 0 }, true)).toBe(null); // current supplier: tappable to release
  });

  test("out of action — shown, with the reason", () => {
    expect(coverIneligibility({ alive: 0 }, false)).toBe("Out of action");
  });

  test("still in staging — not on the field yet", () => {
    expect(coverIneligibility({ alive: 6, onCallReserve: true }, false)).toBe(
      "Still in staging — not on the field yet",
    );
  });

  test("siege never repositions to cover (maneuver legality)", () => {
    expect(coverIneligibility({ alive: 6, hasThunders: true }, false)).toBe(
      "Siege — holds its ground, can't reposition to cover",
    );
  });

  test("the current supplier stays tappable even if it later takes losses", () => {
    expect(coverIneligibility({ alive: 0, hasThunders: true }, true)).toBe(null);
  });

  test("weapon range reads the doctrine table", () => {
    expect(squadWeaponRangeM(["thunder"])).toBe(900);
    expect(squadWeaponRangeM(["bulwark", "longeye"])).toBe(400);
    expect(squadWeaponRangeM([])).toBe(0);
  });
});
