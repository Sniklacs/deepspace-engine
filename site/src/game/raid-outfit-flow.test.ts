import { describe, expect, test } from "bun:test";
import { createRaid, setRaidTarget, assignRaidShips, loadRaidTroops, loadRaidSupplies, launchRaid, newGame, advance } from "./engine";
import { colonyKey, ensureWorldMap } from "./worldmap";
import { addCohort } from "./war/troops";
import type { GameState } from "./types";

/**
 * RAID OUTFIT FLOW INTEGRATION TEST (owner 2026-10-04 bug report):
 * Hans reported "can't load troops, can't load supplies, can't pick a target."
 * This test exercises the full UI flow through the engine functions:
 * create → target → ships → troops → supplies → launch.
 */
function makeTestState(): GameState {
  const now = Date.now();
  const st = newGame("TestCommander", "draconians", now);
  advance(st, now); // ensureTroops + ensureWorldMap
  const wm = ensureWorldMap(st, now);
  // Mustard: troops, ships, and a known active colony to raid.
  addCohort(st.troops!.home.roster, "trooper", 500, now);
  addCohort(st.troops!.home.roster, "armored", 200, now);
  st.resources.supplies = 10000;
  st.resources.gas = 10000;
  wm.shipyard = { queue: [], ships: [
    { id: "ship-1", class: "frigate", raceId: "draconians", name: "Ashen Claw", status: "ready" },
    { id: "ship-2", class: "fatcat", raceId: "draconians", name: "Hoard Drake", status: "ready" },
  ], seq: 3 } as unknown as typeof wm.shipyard;
  wm.known[colonyKey("draconians-world", "col-x")] = {
    id: "col-x",
    serverId: "draconians-world",
    ownerName: "Enemy",
    race: "draconians",
    status: "active",
    lastScouted: now,
    approxTroops: 1000,
  } as unknown as (typeof wm.known)[string];
  return st;
}

describe("raid outfit flow (Hans 2026-10-04 bug)", () => {
  test("create → target → ships → troops → supplies → launch", () => {
    const st = makeTestState();
    const now = Date.now();

    // 1. Create raid party
    const created = createRaid(st, now);
    expect(created.ok).toBe(true);
    const raidId = created.state.worldMap!.raids[0].id;
    expect(raidId).toMatch(/^raid-/);

    // 2. Pick a target
    const targeted = setRaidTarget(created.state, raidId, colonyKey("draconians-world", "col-x"), now);
    expect(targeted.ok).toBe(true);
    const raidAfterTarget = targeted.state.worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raidAfterTarget.targetColonyId).toBe("col-x");
    expect(raidAfterTarget.targetOwnerName).toBe("Enemy");

    // 3. Assign ships
    const shipsAssigned = assignRaidShips(targeted.state, raidId, ["ship-1", "ship-2"], now);
    expect(shipsAssigned.ok).toBe(true);
    const raidAfterShips = shipsAssigned.state.worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raidAfterShips.shipIds).toEqual(["ship-1", "ship-2"]);

    // 4. Load troops
    const troopsLoaded = loadRaidTroops(shipsAssigned.state, raidId, "trooper", 100, now);
    expect(troopsLoaded.ok).toBe(true);
    const raidAfterTroops = troopsLoaded.state.worldMap!.raids.find((r) => r.id === raidId)!;
    const leaderId = raidAfterTroops.leaderId;
    expect(raidAfterTroops.troops[leaderId]?.["trooper"]).toBe(100);
    // Troops deducted from home roster
    const homeTrooperCount = troopsLoaded.state.troops!.home.roster.cohorts
      .filter((c) => c.type === "trooper")
      .reduce((sum, c) => sum + c.count, 0);
    expect(homeTrooperCount).toBe(400);

    // 5. Load supplies
    const suppliesLoaded = loadRaidSupplies(troopsLoaded.state, raidId, 500, now);
    expect(suppliesLoaded.ok).toBe(true);
    const raidAfterSupplies = suppliesLoaded.state.worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raidAfterSupplies.supplies).toBe(500);
    expect(suppliesLoaded.state.resources.supplies).toBeCloseTo(9500, 0);

    // 6. Launch (should succeed — has target, ships, troops)
    const launched = launchRaid(suppliesLoaded.state, raidId, now);
    expect(launched.ok).toBe(true);
    const raidAfterLaunch = launched.state.worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raidAfterLaunch.status).not.toBe("preparing");
  });

  test("target on abandoned colony refused", () => {
    const st = makeTestState();
    const now = Date.now();
    // Make the colony abandoned
    const key = colonyKey("draconians-world", "col-x");
    (st.worldMap!.known[key] as unknown as { status: string }).status = "abandoned";

    const created = createRaid(st, now);
    const raidId = created.state.worldMap!.raids[0].id;
    const targeted = setRaidTarget(created.state, raidId, key, now);
    expect(targeted.ok).toBe(false);
    expect(targeted.error).toMatch(/abandoned/i);
  });

  test("load troops fails without ships assigned", () => {
    const st = makeTestState();
    const now = Date.now();

    const created = createRaid(st, now);
    const raidId = created.state.worldMap!.raids[0].id;
    // Skip ship assignment, try to load troops directly
    const troopsLoaded = loadRaidTroops(created.state, raidId, "trooper", 100, now);
    // Should fail — no troop capacity without ships
    expect(troopsLoaded.ok).toBe(false);
  });

  test("load supplies fails with insufficient supplies", () => {
    const st = makeTestState();
    st.resources.supplies = 10; // Almost no supplies
    const now = Date.now();

    const created = createRaid(st, now);
    const raidId = created.state.worldMap!.raids[0].id;
    const suppliesLoaded = loadRaidSupplies(created.state, raidId, 500, now);
    expect(suppliesLoaded.ok).toBe(false);
    expect(suppliesLoaded.error).toMatch(/suppl/i);
  });
});
