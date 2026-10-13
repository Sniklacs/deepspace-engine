// enemy-targeting.test.ts — the itemized target list (owner 2026-10-13).
// Run: bun test site/src/game/war/enemy-targeting.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTargetList } from "./enemy-targeting";
import type { EnemyUnitIntel } from "./squad-command";

const u = (partial: Partial<EnemyUnitIntel> & { id: string }): EnemyUnitIntel => ({
  kind: "warden",
  squadId: "D",
  hp01: 1,
  distM: 300,
  ...partial,
});

describe("buildTargetList — itemized troops, leader pinned", () => {
  test("groups by class, numbered within class, nearest first", () => {
    const list = buildTargetList([
      u({ id: "w2", kind: "warden", distM: 500 }),
      u({ id: "w1", kind: "warden", distM: 200 }),
      u({ id: "b1", kind: "bulwark", distM: 350 }),
    ]);
    expect(list.leader).toBe(null);
    expect(list.total).toBe(3);
    const wardens = list.groups.find((g) => g.kind === "warden");
    expect(wardens?.units.map((x) => x.unit.id)).toEqual(["w1", "w2"]);
    expect(wardens?.units.map((x) => x.n)).toEqual([1, 2]);
  });

  test("the leader is pulled out of its class group and pinned", () => {
    const hero = u({ id: "hero", kind: "reaver", leader: true, name: "Kael the Unbent", distM: 800 });
    const list = buildTargetList([
      u({ id: "r1", kind: "reaver", distM: 100 }),
      hero,
      u({ id: "w1", kind: "warden", distM: 150 }),
    ]);
    expect(list.leader?.id).toBe("hero");
    expect(list.leader?.name).toBe("Kael the Unbent");
    const reavers = list.groups.find((g) => g.kind === "reaver");
    expect(reavers?.units.map((x) => x.unit.id)).toEqual(["r1"]); // hero not double-listed
    expect(list.total).toBe(3);
  });

  test("no leader in the force → no leader row (never faked)", () => {
    const list = buildTargetList([u({ id: "a" }), u({ id: "b", kind: "thunder" })]);
    expect(list.leader).toBe(null);
  });

  test("empty intel → empty list", () => {
    const list = buildTargetList([]);
    expect(list.total).toBe(0);
    expect(list.groups).toEqual([]);
    expect(list.leader).toBe(null);
  });
});

describe("itemized targeting — scene/store wiring pins", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const scene = readFileSync(join(HERE, "../../components/BattleScene/BattleScene.tsx"), "utf-8");
  const body = readFileSync(join(HERE, "../../components/windows/EnemyForcesBody.tsx"), "utf-8");
  const has = (src: string, n: string) => src.includes(n);

  test("the scene publishes per-unit intel once the scout reveals", () => {
    expect(has(scene, "registerEnemyUnitIntel(intel)")).toBe(true);
    expect(has(scene, 'if (scoutRef.current === "revealed")')).toBe(true);
  });

  test("engaged attacker fire concentrates on the focus inside the normal radius", () => {
    expect(has(scene, "const focusFor = (u: SceneUnit): SceneUnit | null =>")).toBe(true);
    expect(has(scene, "focusFor(u) ?? nearestEnemy(u.x, u.y, u.side, 0.45)")).toBe(true);
  });

  test("the field marks the focused unit", () => {
    expect(has(scene, "if (ui.focusTargetId === u.id)")).toBe(true);
  });

  test("rows render from the store and tap toggles the focus", () => {
    expect(has(body, 'data-testid="enemy-target-list"')).toBe(true);
    expect(has(body, "enemy-target-row-${u.id}")).toBe(true);
    expect(has(body, "toggleFocusTarget(u.id)")).toBe(true);
    expect(has(body, "buildTargetList(ui.enemyUnitIntel)")).toBe(true);
  });
});
