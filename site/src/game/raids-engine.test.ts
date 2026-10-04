// raids-engine.test.ts — end-to-end raid flow through the engine.
import { describe, expect, test } from "bun:test";
import {
  advance,
  assignRaidShips,
  clearRaidTarget,
  createRaid,
  deployRaid,
  launchRaid,
  loadRaidTroops,
  newGame,
  quickResolveTacticalRaid,
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

    // Touchdown: warning filed, raid waits for player deployment (owner 2026-10-03)
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    const raid = wm.raids[0];
    expect(raid.status).toBe("deploying");
    expect(wm.raidWarnings).toHaveLength(1);
    expect(wm.raidWarnings[0].attackerNames).toEqual(["Hans"]);
    expect(wm.raidWarnings[0].shipCount).toBe(2);

    // Player deploys: 1000 reavers to MAIN, ships hold in orbit
    const dep = deployRaid(s, raidId!, { MAIN: { reaver: 1000 } }, true, NOW + RAID_TRAVEL_MS + 2000);
    expect(dep.ok).toBe(true);
    expect(wm.raids[0].status).toBe("tactical");

    // Next tick: the tactical battle starts (no auto-resolve — owner 2026-10-03)
    advance(s, NOW + RAID_TRAVEL_MS + 3000);
    expect(raid.status).toBe("tactical");
    expect(raid.tacticalBattle).toBeDefined();
    expect(raid.tacticalBattle!.status).toBe("active");
    expect(raid.won).toBeUndefined(); // not decided yet

    // Player issues orders round by round — or quick-resolves
    const qr = quickResolveTacticalRaid(s, raidId!, NOW + RAID_TRAVEL_MS + 4000);
    expect(qr.ok).toBe(true);
    expect(raid.tacticalBattle!.status).not.toBe("active");

    // Next tick: results applied — 1000 reavers vs ~1000 defenders → win
    advance(s, NOW + RAID_TRAVEL_MS + 5000);
    expect(raid.won).toBe(true);
    expect(raid.lootTaken).toBeDefined();
    expect(raid.status).toBe("returning");

    // Defender bled on the map
    const colony = wm.known[key];
    expect(colony.approxTroops!).toBeLessThan(1000);

    // Homecoming: loot delivered, survivors return, ships ready
    advance(s, NOW + RAID_TRAVEL_MS * 2 + 6000);
    expect(wm.raids[0].status).toBe("done");
    expect(wm.shipyard!.ships[0].status).toBe("ready");
    // Survivors came home (tactical battle losses are deterministic)
    const homeFinal = s.troops!.home.roster.cohorts.reduce((a, c) => a + c.count, 0);
    expect(homeFinal).toBe(4000 + 718);
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

    // Touchdown → deploying
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    expect(wm.raids[0].status).toBe("deploying");

    // Deploy and resolve
    deployRaid(s, raidId!, { MAIN: { reaver: 100 } }, true, NOW + RAID_TRAVEL_MS + 2000);
    advance(s, NOW + RAID_TRAVEL_MS + 3000);
    const raid = wm.raids[0];
    expect(raid.status).toBe("tactical");
    expect(raid.tacticalBattle).toBeDefined();
    // Quick-resolve the hopeless battle, then the tick applies the result
    quickResolveTacticalRaid(s, raidId!, NOW + RAID_TRAVEL_MS + 4000);
    advance(s, NOW + RAID_TRAVEL_MS + 5000);
    expect(raid.won).toBe(false);
    const lootTotal = Object.values(raid.lootTaken!).reduce((a, b) => a + b, 0);
    expect(lootTotal).toBe(0);

    advance(s, NOW + RAID_TRAVEL_MS * 2 + 6000);
    expect(wm.raids[0].status).toBe("done");
    // 100 reavers vs 100k defenders — the raid is wiped out, nobody comes home
    const homeFinal = s.troops!.home.roster.cohorts.reduce((a, c) => a + c.count, 0);
    expect(homeFinal).toBe(4900);
  });

  test("deploy blocked with empty deployment", () => {
    const s = testState();
    const wm = ensureWorldMap(s);
    const key = colonyKey("draconians-world", "col-x");
    const { raidId } = createRaid(s, NOW);
    setRaidTarget(s, raidId!, key, NOW);
    assignRaidShips(s, raidId!, ["ship-1"], NOW);
    loadRaidTroops(s, raidId!, "reaver", 100, NOW);
    launchRaid(s, raidId!, NOW);
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    expect(wm.raids[0].status).toBe("deploying");
    // Empty deployment fails
    const res = deployRaid(s, raidId!, {}, true, NOW + RAID_TRAVEL_MS + 2000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least one/i);
    expect(wm.raids[0].status).toBe("deploying"); // still waiting
  });

  test("deploy blocked when not in deploying status", () => {
    const s = testState();
    const { raidId } = createRaid(s, NOW);
    // Still preparing — can't deploy yet
    const res = deployRaid(s, raidId!, { MAIN: { reaver: 10 } }, true, NOW);
    expect(res.ok).toBe(false);
  });

  test("REAR requires 20% warden escort", () => {
    const s = testState();
    ensureWorldMap(s);
    const key = colonyKey("draconians-world", "col-x");
    const { raidId } = createRaid(s, NOW);
    setRaidTarget(s, raidId!, key, NOW);
    assignRaidShips(s, raidId!, ["ship-1", "ship-2"], NOW);
    loadRaidTroops(s, raidId!, "reaver", 500, NOW);
    loadRaidTroops(s, raidId!, "warden", 100, NOW);
    launchRaid(s, raidId!, NOW);
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    // 500 reavers to REAR with 0 wardens → blocked
    const bad = deployRaid(s, raidId!, { REAR: { reaver: 500 } }, true, NOW + RAID_TRAVEL_MS + 2000);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/warden/i);
    // Add wardens: 100 wardens / 500 total = 20% → OK
    const good = deployRaid(s, raidId!, { REAR: { reaver: 400, warden: 100 } }, true, NOW + RAID_TRAVEL_MS + 2000);
    expect(good.ok).toBe(true);
  });

  test("flank surprise bonus improves outcome", () => {
    const s = testState();
    const wm = ensureWorldMap(s);
    const key = colonyKey("draconians-world", "col-x");
    wm.known[key].approxTroops = 1200; // defender slightly stronger than 1000 attackers
    const { raidId } = createRaid(s, NOW);
    setRaidTarget(s, raidId!, key, NOW);
    assignRaidShips(s, raidId!, ["ship-1", "ship-2"], NOW);
    loadRaidTroops(s, raidId!, "reaver", 1000, NOW);
    launchRaid(s, raidId!, NOW);
    advance(s, NOW + RAID_TRAVEL_MS + 1000);
    // Deploy all to FLANK_LEFT (flank surprise on round 1): 1000 reavers
    deployRaid(s, raidId!, { FLANK_LEFT: { reaver: 1000 } }, true, NOW + RAID_TRAVEL_MS + 2000);
    advance(s, NOW + RAID_TRAVEL_MS + 3000);
    expect(wm.raids[0].status).toBe("tactical");
    expect(wm.raids[0].tacticalBattle).toBeDefined();
    // Quick-resolve the tactical battle, then the tick applies the result
    quickResolveTacticalRaid(s, raidId!, NOW + RAID_TRAVEL_MS + 4000);
    advance(s, NOW + RAID_TRAVEL_MS + 5000);
    expect(wm.raids[0].won).toBe(true);
  });
});

describe("clearRaidTarget (engine)", () => {
  test("clears the target while preparing; retarget after clearing works", () => {
    const s = testState();
    const key = colonyKey("draconians-world", "col-x");
    const { raidId } = createRaid(s, NOW);
    expect(setRaidTarget(s, raidId!, key, NOW).ok).toBe(true);
    const wm = ensureWorldMap(s);
    expect(wm.raids[0].targetColonyId).toBe("col-x");

    const cleared = clearRaidTarget(s, raidId!, NOW);
    expect(cleared.ok).toBe(true);
    expect(wm.raids[0].targetColonyId).toBe("");
    expect(wm.raids[0].targetOwnerName).toBe("");

    // Retarget = pick a colony again after clearing.
    expect(setRaidTarget(s, raidId!, key, NOW).ok).toBe(true);
    expect(wm.raids[0].targetColonyId).toBe("col-x");
  });
  test("refuses for an unknown raid", () => {
    const s = testState();
    const res = clearRaidTarget(s, "raid-999", NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });
});
