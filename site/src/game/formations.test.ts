// Tests for game/formations.ts — the loadout/formation model + reverb rating.
//
// A formation is a pre-built battle group ready to roll: a name, a type,
// a REQUIRED hero leader, reserved jump ships each loaded with troops
// (capacity-respecting), and staged supplies.
//
// Reverb (owner 2026-10-04): every troop, ship, and piece of equipment
// contributes reverb on the battle engine's force-power scale, so the
// loadout total is directly comparable to a Chorus site's recommended
// reverb (chorus-intel.ts).
//
// Run: bun test src/game/formations.test.ts
import { describe, expect, test } from "bun:test";
import {
  assignFormationShip,
  createFormation,
  emptyFormationsState,
  equipmentReverb,
  formationReverb,
  formationSiteReadiness,
  formationTroopCapacity,
  formationDeployBlocker,
  formationTroopCount,
  formationTroopsByType,
  loadFormationShipTroops,
  removeFormationShip,
  shipReverb,
  troopReverb,
  unloadFormationShipTroops,
  type Formation,
} from "./formations";

function freshFormation(): Formation {
  const res = createFormation("Dawn Hammer", "raid", "hero-1", "Ilyra Voss", 0, Date.now());
  expect(res.ok).toBe(true);
  expect(res.formation).toBeDefined();
  return res.formation!;
}

describe("createFormation", () => {
  test("creates a formation with a hero leader", () => {
    const f = freshFormation();
    expect(f.name).toBe("Dawn Hammer");
    expect(f.type).toBe("raid");
    expect(f.heroId).toBe("hero-1");
    expect(f.heroName).toBe("Ilyra Voss");
    expect(f.status).toBe("standby");
    expect(f.ships).toEqual([]);
    expect(f.supplies).toBe(0);
  });

  test("rejects a formation with no hero (no hero = no formation)", () => {
    const res = createFormation("Nameless", "raid", "", "", 0, Date.now());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/hero/i);
  });

  test("rejects a formation with a blank name", () => {
    const res = createFormation("   ", "raid", "hero-1", "Ilyra", 0, Date.now());
    expect(res.ok).toBe(false);
  });

  test("assigns unique ids per seq", () => {
    const a = createFormation("A", "raid", "h1", "H1", 0, Date.now()).formation!;
    const b = createFormation("B", "raid", "h2", "H2", 1, Date.now()).formation!;
    expect(a.id).not.toBe(b.id);
  });
});

describe("assignFormationShip / removeFormationShip", () => {
  test("reserves a ship into a standby formation", () => {
    const f = freshFormation();
    const res = assignFormationShip(f, "ship-1", "frigate");
    expect(res.ok).toBe(true);
    expect(f.ships).toHaveLength(1);
    expect(f.ships[0].shipId).toBe("ship-1");
    expect(f.ships[0].class).toBe("frigate");
    expect(f.ships[0].troops).toEqual({});
  });

  test("rejects a duplicate ship reservation", () => {
    const f = freshFormation();
    expect(assignFormationShip(f, "ship-1", "frigate").ok).toBe(true);
    const res = assignFormationShip(f, "ship-1", "frigate");
    expect(res.ok).toBe(false);
  });

  test("rejects assigning to a deployed formation", () => {
    const f = freshFormation();
    f.status = "deployed";
    expect(assignFormationShip(f, "ship-1", "frigate").ok).toBe(false);
  });

  test("releases a ship and returns its troops", () => {
    const f = freshFormation();
    assignFormationShip(f, "ship-1", "frigate");
    loadFormationShipTroops(f, "ship-1", "reaver", 40);
    const res = removeFormationShip(f, "ship-1");
    expect(res.ok).toBe(true);
    expect(res.removed?.shipId).toBe("ship-1");
    expect(res.removed?.troops.reaver).toBe(40);
    expect(f.ships).toHaveLength(0);
  });
});

describe("loadFormationShipTroops / unloadFormationShipTroops", () => {
  test("loads troops up to ship capacity", () => {
    const f = freshFormation();
    assignFormationShip(f, "ship-1", "scout"); // capacity 200
    const res = loadFormationShipTroops(f, "ship-1", "reaver", 60);
    expect(res.ok).toBe(true);
    expect(f.ships[0].troops.reaver).toBe(60);
  });

  test("stacks loads onto the same ship", () => {
    const f = freshFormation();
    assignFormationShip(f, "ship-1", "frigate");
    loadFormationShipTroops(f, "ship-1", "reaver", 40);
    loadFormationShipTroops(f, "ship-1", "bulwark", 20);
    expect(f.ships[0].troops.reaver).toBe(40);
    expect(f.ships[0].troops.bulwark).toBe(20);
  });

  test("rejects loading past capacity", () => {
    const f = freshFormation();
    assignFormationShip(f, "ship-1", "scout"); // capacity 200
    loadFormationShipTroops(f, "ship-1", "reaver", 200);
    const res = loadFormationShipTroops(f, "ship-1", "reaver", 10);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/200/);
  });

  test("unloads troops back (partial and all)", () => {
    const f = freshFormation();
    assignFormationShip(f, "ship-1", "frigate");
    loadFormationShipTroops(f, "ship-1", "reaver", 100);
    const partial = unloadFormationShipTroops(f, "ship-1", "reaver", 30);
    expect(partial.ok).toBe(true);
    expect(partial.unloaded).toBe(30);
    expect(f.ships[0].troops.reaver).toBe(70);
    const all = unloadFormationShipTroops(f, "ship-1", "reaver", 999);
    expect(all.ok).toBe(true);
    expect(all.unloaded).toBe(70);
    expect(f.ships[0].troops.reaver ?? 0).toBe(0);
  });
});

describe("formationDeployBlocker", () => {
  test("requires a hero, a ship, and troops", () => {
    const f = freshFormation();
    expect(formationDeployBlocker(f)).toMatch(/ship/i);

    assignFormationShip(f, "ship-1", "frigate");
    expect(formationDeployBlocker(f)).toMatch(/troop/i);

    loadFormationShipTroops(f, "ship-1", "reaver", 40);
    expect(formationDeployBlocker(f)).toBeNull();
  });

  test("blocks a formation that already deployed", () => {
    const f = freshFormation();
    f.status = "deployed";
    expect(formationDeployBlocker(f)).toMatch(/already deployed/i);
  });

  test("still requires the hero on the model", () => {
    const f = freshFormation();
    f.heroId = "";
    expect(formationDeployBlocker(f)).toMatch(/hero/i);
  });
});

describe("aggregates", () => {
  test("counts troops across ships", () => {
    const f = freshFormation();
    assignFormationShip(f, "s1", "frigate");
    assignFormationShip(f, "s2", "frigate");
    loadFormationShipTroops(f, "s1", "reaver", 40);
    loadFormationShipTroops(f, "s2", "bulwark", 30);
    expect(formationTroopCount(f)).toBe(70);
    expect(formationTroopsByType(f)).toEqual({ reaver: 40, bulwark: 30 });
  });

  test("sums capacity across ships", () => {
    const f = freshFormation();
    assignFormationShip(f, "s1", "scout"); // 200
    assignFormationShip(f, "s2", "frigate"); // 800
    expect(formationTroopCapacity(f)).toBe(1000);
  });
});

describe("reverb", () => {
  test("troop reverb follows the battle engine scale (0.4 × supply weight)", () => {
    // reaver: weight 1 → 100 × 1 × 0.4 = 40
    expect(troopReverb("reaver", 100)).toBe(40);
    // thunder: weight 2 → 100 × 2 × 0.4 = 80 (counts double, like the engine)
    expect(troopReverb("thunder", 100)).toBe(80);
    expect(troopReverb("reaver", 0)).toBe(0);
  });

  test("ship reverb is firepower + hull", () => {
    // vanguard: 140 firepower + 220 hull
    expect(shipReverb("vanguard")).toBe(360);
    // scout: 20 firepower + 40 hull
    expect(shipReverb("scout")).toBe(60);
  });

  test("equipment reverb sums forge piece power", () => {
    expect(equipmentReverb([10, 25.5, undefined])).toBe(35.5);
    expect(equipmentReverb([])).toBe(0);
  });

  test("formation reverb totals ships + troops + equipment", () => {
    const f = freshFormation();
    assignFormationShip(f, "s1", "scout"); // 60 reverb
    loadFormationShipTroops(f, "s1", "reaver", 100); // 40 reverb
    // 60 + 40 + 25 equipment = 125
    expect(formationReverb(f, 25)).toBe(125);
    expect(formationReverb(f)).toBe(100);
  });

  test("reverb is deterministic", () => {
    const f = freshFormation();
    assignFormationShip(f, "s1", "frigate");
    loadFormationShipTroops(f, "s1", "thunder", 50);
    expect(formationReverb(f, 10)).toBe(formationReverb(f, 10));
  });

  test("site readiness maps reverb to the highest beatable Chorus grade", () => {
    // Grades: I=21, II=100, III=186, IV=345, V=1330
    expect(formationSiteReadiness(10)).toBeNull();
    expect(formationSiteReadiness(21)?.grade).toBe(1);
    expect(formationSiteReadiness(200)?.grade).toBe(3);
    expect(formationSiteReadiness(1500)?.grade).toBe(5);
    const ready = formationSiteReadiness(200)!;
    expect(ready.siteName.length).toBeGreaterThan(0);
    expect(ready.gradeLabel).toBe("III");
  });
});

describe("emptyFormationsState", () => {
  test("starts empty", () => {
    const s = emptyFormationsState();
    expect(s.formations).toEqual([]);
    expect(s.seq).toBe(1);
  });
});
