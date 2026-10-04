import { describe, expect, test } from "bun:test";
import { SHIP_CLASSES } from "./worldmap";
import {
  SHIP_FIREPOWER,
  SHIP_HULL,
  HERALD_COORDINATION_BONUS,
  HERALD_COORDINATION_CAP,
  fleetFirepower,
  fleetSoak,
  shipFirepower,
  shipSoak,
} from "./raids";
import {
  TURRETS,
  TURRET_BY_CLASS,
  classTurret,
  classTurretMods,
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

describe("turret combat modifiers (owner 2026-10-04: real numbers, not display-only)", () => {
  test("every mount has non-negative damage/shield/armor", () => {
    for (const t of TURRETS) {
      expect(t.mods.damage).toBeGreaterThan(-1);
      expect(t.mods.shield).toBeGreaterThan(-1);
      expect(t.mods.armor).toBeGreaterThan(-1);
    }
  });

  test("shipFirepower = hull base + mount damage", () => {
    expect(shipFirepower("frigate")).toBe(SHIP_FIREPOWER.frigate + 40);
    expect(shipFirepower("vanguard")).toBe(SHIP_FIREPOWER.vanguard + 70);
    expect(shipFirepower("scout")).toBe(SHIP_FIREPOWER.scout + 10);
    expect(shipFirepower("bulwark")).toBe(SHIP_FIREPOWER.bulwark + 20);
    expect(shipFirepower("fatcat")).toBe(SHIP_FIREPOWER.fatcat + 30);
    // Herald's array carries no guns — damage 0.
    expect(classTurretMods("herald").damage).toBe(0);
    expect(shipFirepower("herald")).toBe(SHIP_FIREPOWER.herald);
  });

  test("shipSoak = hull + mount armor + shield", () => {
    expect(shipSoak("bulwark")).toBe(SHIP_HULL.bulwark + 60 + 80);
    expect(shipSoak("scout")).toBe(SHIP_HULL.scout + 0 + 10);
    expect(shipSoak("fatcat")).toBe(SHIP_HULL.fatcat + 40 + 40);
  });

  test("fleetFirepower sums effective firepower", () => {
    expect(fleetFirepower(["vanguard", "frigate"])).toBe(210 + 120);
    expect(fleetFirepower([])).toBe(0);
  });

  test("herald coordination multiplies fleet firepower (capped)", () => {
    const oneHerald = fleetFirepower(["frigate", "herald"]); // (120+40) * 1.05
    expect(oneHerald).toBe(Math.floor(160 * (1 + HERALD_COORDINATION_BONUS)));
    expect(oneHerald).toBeGreaterThan(fleetFirepower(["frigate"]));
    const three = fleetFirepower(["frigate", "herald", "herald", "herald"]);
    const four = fleetFirepower(["frigate", "herald", "herald", "herald", "herald"]);
    expect(three).toBe(
      Math.floor((120 + 40 * 3) * (1 + HERALD_COORDINATION_CAP * HERALD_COORDINATION_BONUS)),
    );
    // Cap holds on the multiplier (4th herald adds its own guns, not more coordination).
    expect(four).toBe(Math.floor((120 + 40 * 4) * (1 + HERALD_COORDINATION_CAP * HERALD_COORDINATION_BONUS)));
  });

  test("fleetSoak sums effective soak", () => {
    expect(fleetSoak(["scout", "scout"])).toBe(2 * (SHIP_HULL.scout + 10));
  });
});
