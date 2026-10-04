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

  test("legacy rows with `shipClass` instead of `class` normalize (2026-10-04 crash)", () => {
    // The QA seed wrote ships as { shipClass: "frigate", ... } — the old
    // code grouped them under class `undefined`, labeled the stack
    // "Expand undefined", and crashed TurretThumb on expand
    // ("Cannot read properties of undefined (reading 'art')").
    const legacy = [
      { id: "s1", shipClass: "frigate", raceId: "draconians", name: "frigate-1" },
      { id: "s2", shipClass: "frigate", raceId: "draconians", name: "frigate-2" },
      { id: "s3", shipClass: "scout", raceId: "draconians", name: "scout-1" },
    ] as unknown as StackableShip[];
    const stacks = groupShipsByClass(legacy);
    expect(stacks).toHaveLength(2);
    expect(stacks[0].class).toBe("frigate");
    expect(stacks[0].ships).toHaveLength(2);
    // Normalized: every downstream read (s.class, TurretThumb, combat
    // lines) sees the real class, never undefined.
    for (const st of stacks) {
      expect(st.class).toBeDefined();
      for (const s of st.ships) expect(s.class).toBe(st.class);
    }
    expect(stacks[1].class).toBe("scout");
  });
});
