// raids-engine.test.ts — end-to-end raid flow through the engine.
import { describe, expect, test } from "bun:test";
import {
  advance,
  assignRaidShips,
  createRaid,
  launchRaid,
  loadRaidTroops,
  newGame,
  setRaidTarget,
} from "./engine";
import { ensureWorldMap, colonyKey } from "./worldmap";
import { RAID_TRAVEL_MS } from "./raids";
import { addCohort } from "./war/troops";

const NOW = 1_700_000_000_000;

function testState() {
  const s = newGame("Hans", "draconians", NOW);
  advance(s, NOW); // ensureTroops + ensureWorldMap
  // Mustard: troops, ships, and a known active colony to raid.
  const wm = ensureWorldMap(s, NOW);
  addCohort(s.troops!.home.roster, "reaver", 5000, NOW);
  s.resources.supplies = 100_000;
  s.resources.gas = 10_000;
  wm.shipyard = { queue: [], ships: [
    { id: "ship-1", class: "frigate", raceId: "draconians", name: "Ashen Claw", status: "ready" },
    { id: "ship-2", class: "fatcat", raceId: "draconians", name: "Hoard Drake", status: "ready" },
  ], seq: 3 };
  wm.known[colonyKey("draconians-world", "col-x")] = {
    id: "col-x",
    serverId: "draconians-world",
    ownerName: "Ashkar",
    race: "draconians",
    status: "active",
    lastScouted: NOW,
    approxTroops: 1000,
  };
  return s;
}

describe("full raid flow", () => {
  test("create → target → ships → troops → launch → land → return → done", () => {
    const s = testState();
    const key = colonyKey("draconians-world", "col-x");

    // Form the party
    const c = createRaid(s, NOW);
    expect(c.ok).toBe(true);
    const raidId = c.raidId!;
    const wm = ensureWorldMap(s);
    expect(wm.raids).toHaveLength(1);

    // Target the colony
    expect(setRaidTarget(s, raidId, key, NOW).ok).toBe(true);
    expect(wm.raids[0].targetOwnerName).toBe("Ashkar");

    // Assign ships
    expect(assignRaidShips(s, raidId, ["ship-1", "ship-2"], NOW).ok).toBe(true);
    expect(wm.raids[0].shipIds).toEqual(["ship-1", "ship-2"]);

    // Load troops (5000 reavers available, frigate+fatcat carry 1300)
    expect(loadRaidTroops(s, raidId, "reaver", 1000, NOW).ok).toBe(true);
    expect(loadRaidTroops(s, raidId, "reaver", 500, NOW).ok).toBe(false); // over capacity
    const homeAfter = s.troops!.home.roster.cohorts.reduce((a, c) => a + c.count, 0);
    expect(homeAfter).toBe(4000); // 1000 moved to the raid

    // Launch: jump charge deducted (2 ships × 200 supplies, 2 × 10 fuel)
    const suppliesBefore = s.resources.supplies;
    const gasBefore = s.resources.gas;
    expect(launchRaid(s, raidId, NOW).ok).toBe(true);
    expect(s.resources.supplies).toBe(suppliesBefore - 400);
    expect(s.resources.gas).toBe(gasBefore - 20);
    expect(wm.raids[0].status).toBe("in_transit");
    expect(wm.shipyard!.ships[0].status).toBe("deployed");

    // Not yet landed
    advance(s, NOW + RAID_TRAVEL_MS - 1000);
    expect(wm.raids[0].status).toBe("in_transit");

    // Touchdown: warning filed, battle resolved, returning
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    const raid = wm.raids[0];
    expect(raid.status).toBe("returning");
    expect(wm.raidWarnings).toHaveLength(1);
    expect(wm.raidWarnings[0].attackerNames).toEqual(["Hans"]);
    expect(wm.raidWarnings[0].shipCount).toBe(2);
    // 1000 reavers vs ~1000 defenders → win (ratio ≥ 1)
    expect(raid.won).toBe(true);
    expect(raid.lootTaken).toBeDefined();

    // Defender bled on the map
    const colony = wm.known[key];
    expect(colony.approxTroops!).toBeLessThan(1000);

    // Homecoming: loot delivered, survivors return, ships ready
    advance(s, NOW + RAID_TRAVEL_MS * 2 + 2000);
    expect(wm.raids[0].status).toBe("done");
    expect(wm.shipyard!.ships[0].status).toBe("ready");
    // Survivors came home (1000 loaded, 25% lost in a win = 750 back)
    const homeFinal = s.troops!.home.roster.cohorts.reduce((a, c) => a + c.count, 0);
    expect(homeFinal).toBe(4000 + 750);
  });

  test("launch blocked without target/ships/troops", () => {
    const s = testState();
    const { raidId } = createRaid(s, NOW);
    // No target, no ships, no troops
    const res = launchRaid(s, raidId!, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/target colony/);
  });

  test("raid on abandoned colony refused", () => {
    const s = testState();
    const wm = ensureWorldMap(s);
    const key = colonyKey("draconians-world", "col-y");
    wm.known[key] = {
      id: "col-y", serverId: "draconians-world", ownerName: "Quiet",
      race: "draconians", status: "abandoned", lastScouted: NOW,
    };
    const { raidId } = createRaid(s, NOW);
    const res = setRaidTarget(s, raidId!, key, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ACTIVE/);
  });

  test("weak raid loses: no loot, heavy casualties", () => {
    const s = testState();
    const wm = ensureWorldMap(s);
    const key = colonyKey("draconians-world", "col-x");
    // Overwhelming defender
    wm.known[key].approxTroops = 100_000;

    const { raidId } = createRaid(s, NOW);
    setRaidTarget(s, raidId!, key, NOW);
    assignRaidShips(s, raidId!, ["ship-1"], NOW);
    loadRaidTroops(s, raidId!, "reaver", 100, NOW); // 100 vs 100k
    launchRaid(s, raidId!, NOW);

    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    const raid = wm.raids[0];
    expect(raid.won).toBe(false);
    const lootTotal = Object.values(raid.lootTaken!).reduce((a, b) => a + b, 0);
    expect(lootTotal).toBe(0);

    advance(s, NOW + RAID_TRAVEL_MS * 2 + 2000);
    expect(wm.raids[0].status).toBe("done");
    // 90% of 100 lost = 10 survivors
    const homeFinal = s.troops!.home.roster.cohorts.reduce((a, c) => a + c.count, 0);
    expect(homeFinal).toBe(4900 + 10);
  });
});
