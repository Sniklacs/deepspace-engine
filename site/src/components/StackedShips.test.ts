// Tests for the shared ship-stacking helper (components/StackedShips.tsx)
// — owner 2026-10-04: identical ships (same class + race) stack into one
// row with a quantity badge. Run: bun test site/src/components/StackedShips.test.ts
import { describe, expect, test } from "bun:test";
import { groupShipsByClass, type StackableShip } from "./StackedShips";

function ship(over: Partial<StackableShip> & { id: string }): StackableShip {
  return { class: "frigate", raceId: "draconians", name: "Ashen Claw", ...over };
}

describe("groupShipsByClass", () => {
  test("empty list gives no stacks", () => {
    expect(groupShipsByClass([])).toEqual([]);
  });

  test("identical ships stack into one row", () => {
    const stacks = groupShipsByClass([
      ship({ id: "a" }),
      ship({ id: "b" }),
      ship({ id: "c" }),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].class).toBe("frigate");
    expect(stacks[0].raceId).toBe("draconians");
    expect(stacks[0].ships.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  test("different classes stay separate", () => {
    const stacks = groupShipsByClass([
      ship({ id: "a", class: "frigate" }),
      ship({ id: "b", class: "scout" }),
      ship({ id: "c", class: "frigate" }),
    ]);
    expect(stacks).toHaveLength(2);
    expect(stacks.map((s) => s.class)).toEqual(["frigate", "scout"]);
    expect(stacks[0].ships.map((s) => s.id)).toEqual(["a", "c"]);
  });

  test("same class, different race does not stack", () => {
    const stacks = groupShipsByClass([
      ship({ id: "a", raceId: "draconians" }),
      ship({ id: "b", raceId: "annunaki" }),
    ]);
    expect(stacks).toHaveLength(2);
    expect(stacks.map((s) => s.raceId)).toEqual(["draconians", "annunaki"]);
  });

  test("stacks keep first-seen order", () => {
    const stacks = groupShipsByClass([
      ship({ id: "a", class: "bulwark" }),
      ship({ id: "b", class: "frigate" }),
      ship({ id: "c", class: "bulwark" }),
    ]);
    expect(stacks.map((s) => s.class)).toEqual(["bulwark", "frigate"]);
  });
});
