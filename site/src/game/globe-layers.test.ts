// Tests for the world globe's pure layer logic (game/globe-layers.ts).
// Run: bun test site/src/game/globe-layers.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildGlobeMarkers,
  colonyGlobePosition,
  countByLayer,
  declutterMarkers,
  GLOBE_LAYERS,
  projectGlobe,
  siteTier,
  worldSiteGlobePosition,
  type GlobeMarker,
  type ScreenMarker,
} from "./globe-layers";

const NOW = 1_700_000_000_000;

function screenMarker(id: string, priority: number, sx: number, sy: number): ScreenMarker {
  return {
    marker: {
      id,
      layer: "colonies",
      lat: 0,
      lon: 0,
      label: id,
      sublabel: "",
      color: "#fff",
      priority,
      ref: { kind: "home" },
    } as GlobeMarker,
    sx,
    sy,
  };
}

describe("projectGlobe", () => {
  test("origin faces the viewer dead center", () => {
    const p = projectGlobe(0, 0, 0, 0);
    expect(p.visible).toBe(true);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    expect(Math.abs(p.y)).toBeLessThan(1e-9);
    expect(p.z).toBeCloseTo(1, 9);
  });

  test("antipode is culled", () => {
    const p = projectGlobe(0, 180, 0, 0);
    expect(p.visible).toBe(false);
    expect(p.z).toBeCloseTo(-1, 9);
  });

  test("north pole projects up", () => {
    const p = projectGlobe(80, 0, 0, 0);
    expect(p.visible).toBe(true);
    expect(p.y).toBeLessThan(0); // screen y is down-positive
    expect(p.y).toBeLessThan(-0.9);
  });

  test("spin brings the far side around", () => {
    const p = projectGlobe(0, 180, 180, 0);
    expect(p.visible).toBe(true);
    expect(p.z).toBeCloseTo(1, 6);
  });

  test("spin moves a point sideways", () => {
    const p = projectGlobe(0, 80, 0, 0);
    expect(p.visible).toBe(true);
    expect(p.x).toBeGreaterThan(0.9);
  });
});

describe("positions are deterministic", () => {
  test("same colony key → same position", () => {
    const a = colonyGlobePosition("s1:c1");
    const b = colonyGlobePosition("s1:c1");
    expect(a).toEqual(b);
  });

  test("different keys spread apart", () => {
    const a = colonyGlobePosition("s1:c1");
    const b = colonyGlobePosition("s1:c2");
    expect(Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon)).toBeGreaterThan(1);
  });

  test("latitudes stay off the poles", () => {
    for (const k of ["a", "b", "c", "d", "e"]) {
      const p = colonyGlobePosition(k);
      expect(Math.abs(p.lat) <= 68).toBe(true);
      expect(Math.abs(p.lon) <= 180).toBe(true);
    }
  });

  test("world sites cluster by tier", () => {
    const t1 = worldSiteGlobePosition("zone-a", 1);
    const t3 = worldSiteGlobePosition("zone-a", 3);
    // same zone id, different tier → different cluster
    expect(Math.abs(t1.lat - t3.lat)).toBeGreaterThan(20);
  });
});

describe("siteTier", () => {
  test("low risk → T1", () => expect(siteTier(10)).toBe(1));
  test("mid risk → T2", () => expect(siteTier(50)).toBe(2));
  test("high risk → T3", () => expect(siteTier(90)).toBe(3));
  test("boundaries", () => {
    expect(siteTier(33)).toBe(1);
    expect(siteTier(34)).toBe(2);
    expect(siteTier(66)).toBe(2);
    expect(siteTier(67)).toBe(3);
  });
});

describe("declutterMarkers", () => {
  test("higher priority wins an overlap", () => {
    const kept = declutterMarkers(
      [screenMarker("low", 10, 0, 0), screenMarker("high", 90, 5, 5)],
      20,
    );
    expect(kept.map((k) => k.marker.id)).toEqual(["high"]);
  });

  test("separated markers both survive", () => {
    const kept = declutterMarkers(
      [screenMarker("a", 10, 0, 0), screenMarker("b", 20, 100, 100)],
      20,
    );
    expect(kept).toHaveLength(2);
  });

  test("empty in → empty out", () => {
    expect(declutterMarkers([], 20)).toEqual([]);
  });
});

describe("buildGlobeMarkers", () => {
  function baseState(over: Record<string, unknown> = {}) {
    return {
      gameId: "g1",
      playerName: "Hans",
      worldMap: {
        known: {},
        raids: [],
        raidWarnings: [],
        incomingRaids: [],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
      memorials: [],
      ...over,
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  test("always includes the home marker", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const home = ms.find((m) => m.layer === "home");
    expect(home).toBeDefined();
    expect(home!.priority).toBe(100);
    expect(home!.label.includes("Hans")).toBe(true);
  });

  test("includes all 15 Chorus sites with intel", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const chorus = ms.filter((m) => m.layer === "chorus");
    expect(chorus).toHaveLength(15);
    for (const m of chorus) {
      expect(m.ref.kind).toBe("chorus");
      if (m.ref.kind === "chorus") {
        expect(m.ref.site.strength).toBeGreaterThan(0);
        expect(m.ref.site.recommendedReverb).toBeGreaterThan(0);
      }
    }
  });

  test("husks split into the husk layer", () => {
    const st = baseState({
      worldMap: {
        known: {
          "s1:c1": { id: "c1", serverId: "s1", ownerName: "Rival", race: "grays", status: "husk", lastScouted: NOW },
          "s1:c2": { id: "c2", serverId: "s1", ownerName: "Friend", race: "grays", status: "active", lastScouted: NOW },
        },
        raids: [],
        raidWarnings: [],
        incomingRaids: [],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
    });
    const ms = buildGlobeMarkers(st, NOW);
    expect(ms.filter((m) => m.layer === "husks")).toHaveLength(1);
    expect(ms.filter((m) => m.layer === "colonies")).toHaveLength(1);
  });

  test("incoming raids become pulsing markers", () => {
    const st = baseState({
      worldMap: {
        known: {},
        raids: [],
        raidWarnings: [],
        incomingRaids: [
          { raidId: "r1", attackerNames: ["Karg"], landsAt: NOW + 60000, resolved: false },
        ],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
    });
    const ms = buildGlobeMarkers(st, NOW);
    const raids = ms.filter((m) => m.layer === "raids");
    expect(raids).toHaveLength(1);
    expect(raids[0].pulse).toBe(true);
    expect(raids[0].label.includes("Karg")).toBe(true);
  });

  test("countByLayer tallies every layer", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const counts = countByLayer(ms);
    expect(counts.chorus).toBe(15);
    expect(counts.home).toBe(1);
    expect(counts.sites).toBeGreaterThan(0);
    for (const l of GLOBE_LAYERS) {
      expect(typeof counts[l.id]).toBe("number");
    }
  });
});
