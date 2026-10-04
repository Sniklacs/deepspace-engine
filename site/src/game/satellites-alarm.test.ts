// Raid alarm (satellite klaxon) tests — owner 2026-10-03.
// Stage-gated intel: stage 1 = presence only, stage 2 = identity + partial
// ships (never 100%), stage 3 = full picture.

import { describe, test, expect } from "bun:test";
import {
  checkRaidAlarm,
  partialShipIntel,
  sweepRaidAlarms,
  colonyNodeId,
  setSatelliteStage,
  satelliteTechFor,
} from "./satellites";
import type { IncomingRaidAlert } from "./raid-protocol";
import type { ShipClass } from "./worldmap";

function fakeState(nodeId: string, stage: 0 | 1 | 2 | 3): any {
  return {
    gameId: "colony-test-1",
    playerName: "Test",
    homeNodeId: nodeId,
    satellites: { seasonId: "s0", stages: { [nodeId]: stage }, restored: [] },
    worldMap: { incomingRaids: [] },
    raidAlarm: null,
  };
}

function fakeRaid(over: Partial<IncomingRaidAlert> = {}): IncomingRaidAlert {
  return {
    raidId: "raid-9",
    attackerWorldId: "watcher-world",
    attackerWorldName: "The Watchers",
    attackerNames: ["Alice", "Bob"],
    targetColonyId: "colony-test-1",
    shipCount: 4,
    shipClasses: ["scout", "frigate", "bulwark", "vanguard"] as ShipClass[],
    troopCount: 5000,
    landsAt: Date.now() + 600_000,
    launchedAt: Date.now(),
    seen: false,
    ...over,
  };
}

describe("checkRaidAlarm", () => {
  test("stage 0 (blind) fires nothing", () => {
    const st = fakeState("rim-1", 0);
    expect(checkRaidAlarm(st, fakeRaid(), Date.now())).toBeNull();
  });

  test("stage 1: UNIDENTIFIED SIGNATURE + node only — no identity, no ships", () => {
    const st = fakeState("rim-1", 1);
    const a = checkRaidAlarm(st, fakeRaid(), Date.now());
    expect(a).not.toBeNull();
    expect(a!.intel).toBe("presence");
    expect(a!.nodeId).toBe("rim-1");
    expect(a!.attackerNames).toBeUndefined();
    expect(a!.attackerWorldName).toBeUndefined();
    expect(a!.revealedShipClasses).toBeUndefined();
    expect(a!.shipCount).toBeUndefined();
    expect(a!.troopCount).toBeUndefined();
  });

  test("stage 2: identity + partial ships, never all", () => {
    const st = fakeState("rim-1", 2);
    const a = checkRaidAlarm(st, fakeRaid(), Date.now());
    expect(a).not.toBeNull();
    expect(a!.intel).toBe("identity");
    expect(a!.attackerNames).toEqual(["Alice", "Bob"]);
    expect(a!.attackerWorldName).toBe("The Watchers");
    const revealed = a!.revealedShipClasses ?? [];
    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.length).toBeLessThan(4); // never 100% of 4 classes
    expect(a!.shipsPartial).toBe(true);
    expect(a!.shipCount).toBeUndefined(); // counts stay hidden at stage 2
    expect(a!.troopCount).toBeUndefined();
  });

  test("stage 3: full identity + all ships + counts", () => {
    const st = fakeState("rim-1", 3);
    const a = checkRaidAlarm(st, fakeRaid(), Date.now());
    expect(a).not.toBeNull();
    expect(a!.intel).toBe("full");
    expect(a!.attackerNames).toEqual(["Alice", "Bob"]);
    expect(a!.revealedShipClasses).toEqual(["scout", "frigate", "bulwark", "vanguard"]);
    expect(a!.shipsPartial).toBe(false);
    expect(a!.shipCount).toBe(4);
    expect(a!.troopCount).toBe(5000);
  });

  test("already-fired and resolved raids never re-fire", () => {
    const st = fakeState("rim-1", 3);
    expect(checkRaidAlarm(st, fakeRaid({ alarmFired: true }), Date.now())).toBeNull();
    expect(checkRaidAlarm(st, fakeRaid({ resolved: true }), Date.now())).toBeNull();
  });

  test("landed raids never fire", () => {
    const st = fakeState("rim-1", 3);
    expect(
      checkRaidAlarm(st, fakeRaid({ landsAt: Date.now() - 1000 }), Date.now()),
    ).toBeNull();
  });
});

describe("partialShipIntel", () => {
  test("deterministic: same raidId, same reveal", () => {
    const classes: ShipClass[] = ["scout", "frigate", "bulwark", "vanguard", "herald"];
    const a = partialShipIntel(classes, "raid-x");
    const b = partialShipIntel(classes, "raid-x");
    expect(a).toEqual(b);
  });

  test("never reveals all classes when more than one present", () => {
    const classes: ShipClass[] = ["scout", "frigate", "bulwark", "vanguard", "herald", "fatcat"];
    for (let i = 0; i < 20; i++) {
      const r = partialShipIntel(classes, `raid-${i}`);
      expect(r.length).toBeGreaterThan(0);
      expect(r.length).toBeLessThan(classes.length);
    }
  });

  test("single class is shown (nothing else to hide behind)", () => {
    expect(partialShipIntel(["scout"], "raid-y")).toEqual(["scout"]);
  });

  test("empty/missing classes reveal nothing", () => {
    expect(partialShipIntel([], "raid-z")).toEqual([]);
    expect(partialShipIntel(undefined, "raid-z")).toEqual([]);
  });
});

describe("sweepRaidAlarms", () => {
  test("fires once, marks alarmed, second sweep is quiet", () => {
    const st = fakeState("rim-1", 2);
    st.worldMap.incomingRaids = [fakeRaid()];
    const now = Date.now();
    const fired = sweepRaidAlarms(st, now);
    expect(fired).not.toBeNull();
    expect(st.raidAlarm).not.toBeNull();
    expect(st.worldMap.incomingRaids[0].alarmFired).toBe(true);
    expect(sweepRaidAlarms(st, now)).toBeNull(); // one klaxon at a time
  });

  test("blind raids stay silent through the sweep", () => {
    const st = fakeState("rim-1", 0);
    st.worldMap.incomingRaids = [fakeRaid()];
    expect(sweepRaidAlarms(st, Date.now())).toBeNull();
    expect(st.raidAlarm).toBeNull();
  });

  test("clears a live alarm whose raid resolved", () => {
    const st = fakeState("rim-1", 2);
    const raid = fakeRaid();
    st.worldMap.incomingRaids = [raid];
    sweepRaidAlarms(st, Date.now());
    expect(st.raidAlarm).not.toBeNull();
    raid.resolved = true;
    sweepRaidAlarms(st, Date.now());
    expect(st.raidAlarm).toBeNull();
  });
});

describe("colonyNodeId", () => {
  test("backfills deterministically and sticks", () => {
    const st: any = { gameId: "colony-abc", playerName: "X" };
    const a = colonyNodeId(st);
    expect(typeof a).toBe("string");
    expect(st.homeNodeId).toBe(a);
    expect(colonyNodeId(st)).toBe(a); // stable
  });

  test("setSatelliteStage upgrades the watch", () => {
    const st = fakeState("rim-1", 0);
    expect(checkRaidAlarm(st, fakeRaid(), Date.now())).toBeNull();
    setSatelliteStage(st, "rim-1", 2);
    expect(checkRaidAlarm(st, fakeRaid(), Date.now())?.intel).toBe("identity");
  });
});

describe("satellite research durations (owner 2026-10-04)", () => {
  test("stage durations are 3h / 12h / 24h", () => {
    expect(satelliteTechFor("node-x", 1).durationMs).toBe(3 * 3_600_000);
    expect(satelliteTechFor("node-x", 2).durationMs).toBe(12 * 3_600_000);
    expect(satelliteTechFor("node-x", 3).durationMs).toBe(24 * 3_600_000);
  });

  test("codices costs are unchanged", () => {
    expect(satelliteTechFor("node-x", 1).codicesCost).toBe(4);
    expect(satelliteTechFor("node-x", 2).codicesCost).toBe(8);
    expect(satelliteTechFor("node-x", 3).codicesCost).toBe(15);
  });
});
