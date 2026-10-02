// Tests for the world map data model (game/worldmap.ts) —
// design/abandoned-colonies-world-map.md.
// Run: bun test site/src/game/worldmap.test.ts
import { describe, expect, test } from "bun:test";
import {
  ABANDON_MS,
  SCOUT_DURATION_MS,
  abandonmentIn,
  colonyKey,
  colonyMarkerName,
  collectProbe,
  emptyWorldMap,
  generateScoutReport,
  isAbandoned,
  isHusk,
  launchProbe,
  lootAfterTake,
  lootTotal,
  probeReady,
  EMPTY_LOOT,
  type ColonyLoot,
} from "./worldmap";

const DAY = 24 * 3600_000;
const NOW = 1_700_000_000_000;

describe("abandonment", () => {
  test("not abandoned before 30 days", () => {
    expect(isAbandoned(NOW - 29 * DAY, NOW)).toBe(false);
  });
  test("abandoned at exactly 30 days", () => {
    expect(isAbandoned(NOW - 30 * DAY, NOW)).toBe(true);
  });
  test("abandoned after 30 days", () => {
    expect(isAbandoned(NOW - 45 * DAY, NOW)).toBe(true);
  });
  test("ABANDON_MS is 30 days", () => {
    expect(ABANDON_MS).toBe(30 * DAY);
  });
  test("abandonmentIn counts down", () => {
    expect(abandonmentIn(NOW - 29 * DAY, NOW)).toBe(1 * DAY);
  });
  test("abandonmentIn is 0 when already abandoned", () => {
    expect(abandonmentIn(NOW - 60 * DAY, NOW)).toBe(0);
  });
});

describe("colony keys and names", () => {
  test("colonyKey joins server and colony", () => {
    expect(colonyKey("ashtar-prime", "col-7")).toBe("ashtar-prime:col-7");
  });
  test("colonyMarkerName is possessive", () => {
    expect(colonyMarkerName("Hans")).toBe("Hans's Colony");
  });
});

describe("scout probes", () => {
  test("launch consumes one probe and creates an in-flight record", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 2;
    const res = launchProbe(wm, "ashtar-prime", NOW);
    expect(res.ok).toBe(true);
    expect(res.probe!.targetServerId).toBe("ashtar-prime");
    expect(res.probe!.returnsAt).toBe(NOW + SCOUT_DURATION_MS);
    expect(res.probe!.status).toBe("inflight");
    expect(wm.probes).toBe(1);
    expect(wm.inflight).toHaveLength(1);
  });
  test("launch fails with no probes", () => {
    const wm = emptyWorldMap(NOW);
    const res = launchProbe(wm, "ashtar-prime", NOW);
    expect(res.ok).toBe(false);
    expect(res.error!.indexOf("No scout probes")).toBeGreaterThan(-1);
  });
  test("probe is not ready before its return time", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 1;
    const { probe } = launchProbe(wm, "ashtar-prime", NOW);
    expect(probeReady(probe!, NOW + SCOUT_DURATION_MS - 1)).toBe(false);
  });
  test("probe is ready at its return time", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 1;
    const { probe } = launchProbe(wm, "ashtar-prime", NOW);
    expect(probeReady(probe!, NOW + SCOUT_DURATION_MS)).toBe(true);
  });
  test("collect files the report and marks the probe returned", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 1;
    const { probe } = launchProbe(wm, "ashtar-prime", NOW);
    const res = collectProbe(wm, probe!.id, NOW + SCOUT_DURATION_MS);
    expect(res.ok).toBe(true);
    expect(res.report!.serverId).toBe("ashtar-prime");
    expect(wm.reports["ashtar-prime"]).toBe(res.report);
    expect(probe!.status).toBe("returned");
  });
  test("collect fails while in flight", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 1;
    const { probe } = launchProbe(wm, "ashtar-prime", NOW);
    const res = collectProbe(wm, probe!.id, NOW);
    expect(res.ok).toBe(false);
  });
  test("collect fails for unknown probe", () => {
    const wm = emptyWorldMap(NOW);
    const res = collectProbe(wm, "probe-999", NOW);
    expect(res.ok).toBe(false);
  });
});

describe("scout reports (mock)", () => {
  test("report has player vs colony counts", () => {
    const r = generateScoutReport("ashtar-prime", NOW, "probe-1");
    expect(r.serverId).toBe("ashtar-prime");
    expect(r.playerCount).toBeGreaterThan(0);
    expect(r.colonyCount - r.playerCount).toBeGreaterThan(-1);
    expect(r.abandonedCount).toBeGreaterThan(-1);
    expect(r.colonyCount - r.abandonedCount).toBeGreaterThan(-1);
    expect(r.receivedAt).toBe(NOW);
  });
  test("report is deterministic per server", () => {
    const a = generateScoutReport("ashtar-prime", NOW, "probe-1");
    const b = generateScoutReport("ashtar-prime", NOW + 9999, "probe-2");
    expect(a.playerCount).toBe(b.playerCount);
    expect(a.colonyCount).toBe(b.colonyCount);
    expect(a.abandonedCount).toBe(b.abandonedCount);
  });
  test("different servers get different reports", () => {
    const a = generateScoutReport("ashtar-prime", NOW, "probe-1");
    const b = generateScoutReport("draconis", NOW, "probe-1");
    // Not guaranteed by contract, but overwhelmingly likely with the hash.
    expect(
      a.playerCount !== b.playerCount ||
        a.colonyCount !== b.colonyCount ||
        a.abandonedCount !== b.abandonedCount,
    ).toBe(true);
  });
  test("abandoned count is a plausible fraction", () => {
    const r = generateScoutReport("ashtar-prime", NOW, "probe-1");
    const frac = r.abandonedCount / r.colonyCount;
    expect(frac - 0.04).toBeGreaterThan(-0.001);
    expect(0.26 - frac).toBeGreaterThan(-0.001);
  });
});

describe("loot math", () => {
  const loot: ColonyLoot = {
    ...EMPTY_LOOT,
    supplies: 1000,
    embers: 50,
    fuel: 20,
  };
  test("lootTotal sums everything", () => {
    expect(lootTotal(loot)).toBe(1070);
    expect(lootTotal(EMPTY_LOOT)).toBe(0);
  });
  test("lootAfterTake subtracts without going negative", () => {
    const rest = lootAfterTake(loot, { ...EMPTY_LOOT, supplies: 400, embers: 60 });
    expect(rest.supplies).toBe(600);
    expect(rest.embers).toBe(0); // clamped, not -10
    expect(rest.fuel).toBe(20); // untouched
  });
  test("isHusk when nothing remains and no mercenaries", () => {
    expect(isHusk(EMPTY_LOOT, null)).toBe(true);
    expect(isHusk(loot, null)).toBe(false);
  });
  test("not a husk while mercenaries remain", () => {
    const band = { id: "band-1", serverId: "s", sourceColony: "c", cohorts: [], createdAt: NOW };
    expect(isHusk(EMPTY_LOOT, band)).toBe(false);
  });
});

describe("emptyWorldMap", () => {
  test("initializes cleanly", () => {
    const wm = emptyWorldMap(NOW);
    expect(wm.lastActive).toBe(NOW);
    expect(wm.probes).toBe(0);
    expect(wm.inflight).toHaveLength(0);
    expect(wm.seq).toBe(1);
  });
});
