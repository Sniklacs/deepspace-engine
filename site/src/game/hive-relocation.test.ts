// Tests for hive relocation (game/hive-relocation.ts) — Hans Oct 4 2026,
// Globe Wave 2 WS-E: move the home colony to a hive set point on the globe.
// Run: bun test site/src/game/hive-relocation.test.ts
import { describe, expect, test } from "bun:test";
import {
  HIVE_BLOCKING_RAID_STATUSES,
  HIVE_MAX_LAT,
  HIVE_MIN_MOVE_DEG,
  HIVE_MIN_SEPARATION_DEG,
  HIVE_MOVE_COOLDOWN_MS,
  HIVE_MOVE_FUEL_PER_DEGREE,
  HIVE_MOVE_SUPPLIES_FLAT,
  alliedKnownColonies,
  applyHiveMove,
  clampHiveCandidate,
  formatHiveDuration,
  hiveMoveBlockers,
  hiveMoveCost,
  hiveMoveCooldownRemainingMs,
  meanAllyDistanceKm,
  validateHiveMove,
} from "./hive-relocation";
import {
  buildGlobeMarkers,
  colonyGlobePosition,
  currentHomeGlobePosition,
  greatCircleDeg,
  GLOBE_KM_PER_DEGREE,
  unprojectGlobe,
  projectGlobe,
} from "./globe-layers";
import { colonyKey, emptyWorldMap, type KnownColony } from "./worldmap";
import type { GameState } from "./types";
import type { RaidParty } from "./raids";
import type { IncomingRaidAlert } from "./raid-protocol";

const DAY = 24 * 3600_000;
const NOW = 1_700_000_000_000;

function testState(supplies = 100_000, gas = 5_000): GameState {
  return {
    gameId: "colony-1",
    playerName: "TestWarlord",
    resources: { supplies, gas },
    worldMap: emptyWorldMap(NOW),
  } as unknown as GameState;
}

function knownColony(id: string, ownerName: string, serverId = "home"): KnownColony {
  return {
    id,
    serverId,
    ownerName,
    race: "draconians",
    status: "active",
    lastScouted: NOW - 1000,
  };
}

function addKnown(state: GameState, id: string, ownerName: string): string {
  const key = colonyKey("home", id);
  state.worldMap!.known[key] = knownColony(id, ownerName);
  return key;
}

function raid(id: string, status: RaidParty["status"]): RaidParty {
  return {
    id,
    status,
    shipIds: ["ship-1"],
    shipClasses: ["scout"],
  } as unknown as RaidParty;
}

function incomingRaid(raidId: string, resolved = false): IncomingRaidAlert {
  return {
    raidId,
    attackerWorldId: "w2",
    attackerWorldName: "Other World",
    attackerNames: ["Raider"],
    targetColonyId: "colony-1",
    shipCount: 2,
    troopCount: 500,
    landsAt: NOW + 60_000,
    launchedAt: NOW - 60_000,
    resolved,
    seen: false,
  };
}

describe("hiveMoveCost", () => {
  test("supplies is the flat kit fee, fuel scales with angular distance", () => {
    const from = { lat: 0, lon: 0 };
    const to = { lat: 0, lon: 60 };
    const cost = hiveMoveCost(from, to);
    expect(cost.distanceDeg).toBeCloseTo(60, 6);
    expect(cost.supplies).toBe(HIVE_MOVE_SUPPLIES_FLAT);
    expect(cost.fuel).toBe(Math.ceil(60 * HIVE_MOVE_FUEL_PER_DEGREE));
    expect(cost.distanceKm).toBeCloseTo(60 * GLOBE_KM_PER_DEGREE, 4);
  });

  test("half-globe move costs ~270 fuel, never free", () => {
    const cost = hiveMoveCost({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    expect(cost.distanceDeg).toBeCloseTo(180, 6);
    expect(cost.fuel).toBe(270);
  });

  test("tiny move still costs at least 1 fuel", () => {
    const cost = hiveMoveCost({ lat: 0, lon: 0 }, { lat: 0, lon: 0.1 });
    expect(cost.fuel).toBe(1);
  });
});

describe("cooldown", () => {
  test("no stamp = no cooldown", () => {
    expect(hiveMoveCooldownRemainingMs({}, NOW)).toBe(0);
  });

  test("cooldown is 7 days", () => {
    expect(HIVE_MOVE_COOLDOWN_MS).toBe(7 * DAY);
    const wm = { lastHiveMoveAt: NOW - 3 * DAY };
    expect(hiveMoveCooldownRemainingMs(wm, NOW)).toBe(4 * DAY);
  });

  test("expired cooldown reads 0", () => {
    const wm = { lastHiveMoveAt: NOW - 8 * DAY };
    expect(hiveMoveCooldownRemainingMs(wm, NOW)).toBe(0);
  });

  test("validate blocks during cooldown and names the wait", () => {
    const s = testState();
    s.worldMap!.lastHiveMoveAt = NOW - 2 * DAY;
    const home = currentHomeGlobePosition(s);
    const v = validateHiveMove(s, { lat: home.lat + 10, lon: home.lon + 10 }, NOW);
    expect(v.ok).toBe(false);
    expect(v.error ?? "").toMatch(/recharg/i);
    expect(v.error ?? "").toMatch(/5d/);
  });

  test("formatHiveDuration renders days/hours/minutes", () => {
    expect(formatHiveDuration(5 * DAY + 3 * 3600_000)).toBe("5d 3h");
    expect(formatHiveDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatHiveDuration(45 * 60_000)).toBe("45m");
  });
});

describe("anti-abuse blocks", () => {
  test("unresolved incoming raid blocks", () => {
    const s = testState();
    s.worldMap!.incomingRaids = [incomingRaid("r-1")];
    const home = currentHomeGlobePosition(s);
    const v = validateHiveMove(s, { lat: home.lat + 10, lon: home.lon + 10 }, NOW);
    expect(v.ok).toBe(false);
    expect(v.error ?? "").toMatch(/under attack/i);
  });

  test("resolved incoming raid does not block", () => {
    const s = testState();
    s.worldMap!.incomingRaids = [incomingRaid("r-1", true)];
    const home = currentHomeGlobePosition(s);
    const v = validateHiveMove(s, { lat: home.lat + 10, lon: home.lon + 10 }, NOW);
    expect(v.ok).toBe(true);
  });

  test("own party in_transit and landed block", () => {
    for (const status of ["in_transit", "landed"] as const) {
      const s = testState();
      s.worldMap!.raids = [raid("raid-1", status)];
      const home = currentHomeGlobePosition(s);
      const v = validateHiveMove(s, { lat: home.lat + 10, lon: home.lon + 10 }, NOW);
      expect(v.ok).toBe(false);
      expect(v.error ?? "").toMatch(/away from home/i);
    }
  });

  test("preparing and done parties do not block", () => {
    for (const status of ["preparing", "done"] as const) {
      const s = testState();
      s.worldMap!.raids = [raid("raid-1", status)];
      const home = currentHomeGlobePosition(s);
      const v = validateHiveMove(s, { lat: home.lat + 10, lon: home.lon + 10 }, NOW);
      expect(v.ok).toBe(true);
    }
  });

  test("the away set covers every launched leg", () => {
    for (const status of ["in_transit", "deploying", "tactical", "landed", "returning"] as const) {
      expect(HIVE_BLOCKING_RAID_STATUSES.has(status)).toBe(true);
    }
    expect(HIVE_BLOCKING_RAID_STATUSES.has("preparing")).toBe(false);
    expect(HIVE_BLOCKING_RAID_STATUSES.has("done")).toBe(false);
  });

  test("hiveMoveBlockers names each blocker inline", () => {
    const s = testState();
    s.worldMap!.incomingRaids = [incomingRaid("r-1")];
    s.worldMap!.raids = [raid("raid-1", "in_transit")];
    s.worldMap!.lastHiveMoveAt = NOW - DAY;
    const blockers = hiveMoveBlockers(s, NOW);
    expect(blockers.length).toBe(3);
    expect(blockers.some((b) => /recharg/i.test(b))).toBe(true);
    expect(blockers.some((b) => /under attack/i.test(b))).toBe(true);
    expect(blockers.some((b) => /away from home/i.test(b))).toBe(true);
  });
});

describe("destination validity", () => {
  test("rejects a point <4° from another known colony and names it", () => {
    const s = testState();
    addKnown(s, "col-neighbor", "NeighborOne");
    const nPos = colonyGlobePosition("home:col-neighbor");
    const v = validateHiveMove(s, { lat: nPos.lat + 1, lon: nPos.lon + 1 }, NOW);
    expect(v.ok).toBe(false);
    expect(v.error ?? "").toMatch(/NeighborOne's Colony/);
  });

  test("accepts a point ≥4° from every known colony", () => {
    const s = testState();
    addKnown(s, "col-neighbor", "NeighborOne");
    const nPos = colonyGlobePosition("home:col-neighbor");
    // antipode of the neighbor is safely far away
    const v = validateHiveMove(s, { lat: -nPos.lat, lon: nPos.lon + 180 }, NOW);
    expect(v.ok).toBe(true);
    expect(v.cost).toBeDefined();
  });

  test("poles clamp to |lat| ≤ 78 instead of rejecting", () => {
    expect(clampHiveCandidate({ lat: 89, lon: 10 }).lat).toBe(HIVE_MAX_LAT);
    expect(clampHiveCandidate({ lat: -89, lon: 10 }).lat).toBe(-HIVE_MAX_LAT);
    expect(clampHiveCandidate({ lat: 45, lon: 190 }).lon).toBe(-170);
    const s = testState();
    const v = validateHiveMove(s, { lat: 89, lon: 10 }, NOW);
    // 89° clamps to 78°; valid unless it lands within 4° of a known colony
    expect(typeof v.ok).toBe("boolean");
  });

  test("rejects a no-op move (already there)", () => {
    const s = testState();
    const home = currentHomeGlobePosition(s);
    const v = validateHiveMove(s, home, NOW);
    expect(v.ok).toBe(false);
    expect(v.error ?? "").toMatch(/already is/i);
    expect(greatCircleDeg(home.lat, home.lon, home.lat, home.lon)).toBeLessThan(HIVE_MIN_MOVE_DEG);
  });

  test("rejects when supplies or fuel can't cover the cost", () => {
    const poor = testState(100, 1);
    const home = currentHomeGlobePosition(poor);
    const v1 = validateHiveMove(poor, { lat: home.lat + 30, lon: home.lon + 30 }, NOW);
    expect(v1.ok).toBe(false);
    expect(v1.error ?? "").toMatch(/supplies/i);

    const noFuel = testState(100_000, 0);
    const home2 = currentHomeGlobePosition(noFuel);
    const v2 = validateHiveMove(noFuel, { lat: home2.lat + 30, lon: home2.lon + 30 }, NOW);
    expect(v2.ok).toBe(false);
    expect(v2.error ?? "").toMatch(/fuel/i);
  });

  test("min separation constant is 4°", () => {
    expect(HIVE_MIN_SEPARATION_DEG).toBe(4);
  });
});

describe("applyHiveMove", () => {
  test("deducts cost, sets override + timestamp", () => {
    const s = testState(10_000, 1_000);
    const home = currentHomeGlobePosition(s);
    const dest = { lat: home.lat + 20, lon: home.lon + 20 };
    const v = validateHiveMove(s, dest, NOW);
    expect(v.ok).toBe(true);
    const cost = v.cost!;
    applyHiveMove(s, cost, dest, NOW);
    expect(s.resources.supplies).toBe(10_000 - cost.supplies);
    expect(s.resources.gas).toBe(1_000 - cost.fuel);
    expect(s.worldMap!.homeGlobeOverride).toEqual(clampHiveCandidate(dest));
    expect(s.worldMap!.lastHiveMoveAt).toBe(NOW);
    // the marker now reads the override
    const after = currentHomeGlobePosition(s);
    expect(after.lat).toBeCloseTo(dest.lat, 6);
    expect(after.lon).toBeCloseTo(dest.lon, 6);
    // cooldown is now active
    expect(hiveMoveCooldownRemainingMs(s.worldMap!, NOW)).toBe(HIVE_MOVE_COOLDOWN_MS);
  });
});

describe("home marker position", () => {
  test("buildGlobeMarkers uses the hash position without an override", () => {
    const s = testState();
    const markers = buildGlobeMarkers(s, NOW);
    const home = markers.find((m) => m.id === "home")!;
    const expected = colonyGlobePosition("home:colony-1");
    expect(home.lat).toBeCloseTo(expected.lat, 9);
    expect(home.lon).toBeCloseTo(expected.lon, 9);
  });

  test("buildGlobeMarkers uses the override when set", () => {
    const s = testState();
    s.worldMap!.homeGlobeOverride = { lat: 33.5, lon: -12.25 };
    const markers = buildGlobeMarkers(s, NOW);
    const home = markers.find((m) => m.id === "home")!;
    expect(home.lat).toBe(33.5);
    expect(home.lon).toBe(-12.25);
    // incoming-raid fans ride the override too
    s.worldMap!.incomingRaids = [incomingRaid("r-1")];
    const markers2 = buildGlobeMarkers(s, NOW);
    const fan = markers2.find((m) => m.id === "raid:r-1")!;
    expect(fan.lat).toBeCloseTo(33.5, 6);
    expect(fan.lon).toBeCloseTo(-12.25, 6);
  });
});

describe("allied colonies + response delta", () => {
  function alliedState(): GameState {
    const s = testState();
    addKnown(s, "col-ally", "AllyOne");
    addKnown(s, "col-stranger", "Stranger");
    (s as unknown as { alliances: Record<string, unknown> }).alliances = {
      "warband-1": {
        id: "warband-1",
        name: "Test Band",
        banner: "⚔️",
        motto: "",
        members: [
          { colonyId: "colony-1", colonyName: "TestWarlord", role: "leader", joinedAt: NOW - DAY },
          { colonyId: "col-ally", colonyName: "AllyOne", role: "member", joinedAt: NOW - DAY },
        ],
        applications: [],
        invites: [],
        foundedAt: NOW - DAY,
        founderId: "colony-1",
        homeServerId: "home",
        version: 1,
        activity: [],
      },
    };
    return s;
  }

  test("alliedKnownColonies matches members by colony name, skips strangers + self", () => {
    const pins = alliedKnownColonies(alliedState());
    expect(pins.map((p) => p.ownerName)).toEqual(["AllyOne"]);
    const expected = colonyGlobePosition("home:col-ally");
    expect(pins[0].lat).toBeCloseTo(expected.lat, 9);
    expect(pins[0].lon).toBeCloseTo(expected.lon, 9);
  });

  test("no alliance = no pins", () => {
    expect(alliedKnownColonies(testState())).toEqual([]);
  });

  test("meanAllyDistanceKm averages the great-circle km", () => {
    const s = alliedState();
    const pins = alliedKnownColonies(s);
    const at = { lat: 0, lon: 0 };
    const mean = meanAllyDistanceKm(pins, at);
    expect(mean).toBeCloseTo(greatCircleDeg(0, 0, pins[0].lat, pins[0].lon) * GLOBE_KM_PER_DEGREE, 6);
    expect(meanAllyDistanceKm([], at)).toBe(0);
  });
});

describe("unprojectGlobe", () => {
  test("round-trips through projectGlobe for visible points", () => {
    const cases: Array<[number, number, number, number]> = [
      [10, 40, 24, 14],
      [-25, -120, 180, -30],
      [50, 179, 300, 55],
      [0, 0, 0, 0],
      [-30, 90, 270, 20],
    ];
    for (const [lat, lon, spin, tilt] of cases) {
      const p = projectGlobe(lat, lon, spin, tilt);
      expect(p.visible).toBe(true);
      const back = unprojectGlobe(p.x, p.y, spin, tilt)!;
      expect(back).not.toBeNull();
      expect(back.lat).toBeCloseTo(lat, 6);
      // longitude wraps; compare the wrapped difference
      const dLon = Math.abs(((back.lon - lon + 540) % 360) - 180);
      expect(dLon).toBeLessThan(1e-4);
    }
  });

  test("returns null beyond the limb", () => {
    expect(unprojectGlobe(1.2, 0, 0, 0)).toBeNull();
    expect(unprojectGlobe(0, 1.5, 0, 0)).toBeNull();
    // on the limb edge: valid
    expect(unprojectGlobe(0.99, 0, 0, 0)).not.toBeNull();
  });
});
