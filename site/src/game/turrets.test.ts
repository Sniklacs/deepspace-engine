import { describe, expect, test } from "bun:test";
import { SHIP_CLASSES } from "./worldmap";
import {
  TURRETS,
  TURRET_BY_CLASS,
  classTurret,
  turretArtUrl,
  turretCoverageOk,
} from "./turrets";

describe("turrets", () => {
  test("every ship class has exactly one signature mount", () => {
    expect(turretCoverageOk()).toBe(true);
    expect(TURRETS).toHaveLength(SHIP_CLASSES.length);
  });

  test("ids are unique and art paths follow convention", () => {
    const ids = TURRETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TURRETS) {
      expect(t.art).toBe(`/art/turrets/${t.id}.webp`);
      expect(t.armamentLine.length).toBeGreaterThan(0);
      expect(t.flavor.length).toBeGreaterThan(0);
    }
  });

  test("herald carries a system, not a weapon (no guns by design)", () => {
    expect(TURRET_BY_CLASS.herald.kind).toBe("system");
    for (const c of SHIP_CLASSES) {
      if (c === "herald") continue;
      expect(TURRET_BY_CLASS[c].kind).toBe("weapon");
    }
  });

  test("Hans's direction: fatcat chain-guns, frigate light turrets", () => {
    expect(classTurret("fatcat").id).toBe("chain-gun-battery");
    expect(classTurret("frigate").id).toBe("light-turret");
  });

  test("turretArtUrl resolves and nulls cleanly", () => {
    expect(turretArtUrl("siege-cannon")).toBe("/art/turrets/siege-cannon.webp");
    expect(turretArtUrl("nope")).toBeNull();
  });
});
