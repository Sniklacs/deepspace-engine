// Tests for the world globe's pure layer logic (game/globe-layers.ts).
// Run: bun test site/src/game/globe-layers.test.ts
import { describe, expect, test } from "bun:test";
import {
  applyGlobeFilters,
  arenaGlobePosition,
  beachheadGlobePosition,
  buildElevationGrid,
  buildGlobeMarkers,
  chorusHeartGlobePosition,
  colonyGlobePosition,
  countByLayer,
  declutterMarkers,
  DEFAULT_GLOBE_FILTERS,
  fbm2D,
  GLOBE_LAYERS,
  GLOBE_SITE_TIER_COLOR,
  hash2i,
  projectGlobe,
  satelliteWatchPosition,
  shadeTerrainGrid,
  siteMarkerIcon,
  siteTier,  terrainColor,
  terrainElevation,
  terrainSpriteSize,
  valueNoise2D,
  worldSiteGlobePosition,
  type GlobeIconId,
  type GlobeMarker,
  type ScreenMarker,
} from "./globe-layers";
import { ZONES } from "./zones";
import { chorusSiteIntel } from "./chorus-intel";

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

describe("home marker tappability (regression 2026-10-04)", () => {
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

  // Mirror the component's render-loop + hitTest math (WorldGlobe.tsx).
  function tapPipeline(state: Parameters<typeof buildGlobeMarkers>[0], spin = 24, tilt = 14) {
    const w = 736, h = 480;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.4;
    const layersOn = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.defaultOn]));
    const markers = buildGlobeMarkers(state, NOW);
    const projected: ScreenMarker[] = [];
    for (const m of markers) {
      if (!layersOn[m.layer as keyof typeof layersOn]) continue;
      const p = projectGlobe(m.lat, m.lon, spin, tilt);
      if (!p.visible) continue;
      projected.push({ marker: m, sx: cx + p.x * R, sy: cy + p.y * R });
    }
    const shown = declutterMarkers(projected, 26);
    const screenPos = new Map<string, { x: number; y: number; r: number }>();
    for (const s of shown) {
      screenPos.set(s.marker.id, { x: s.sx, y: s.sy, r: Math.max(20, 10 + 8) });
    }
    const hitTest = (x: number, y: number): string | null => {
      const entries = [...screenPos.entries()].sort((a, b) => {
        const ma = markers.find((m) => m.id === a[0]);
        const mb = markers.find((m) => m.id === b[0]);
        return (mb?.priority ?? 0) - (ma?.priority ?? 0);
      });
      for (const [id, p] of entries) {
        const dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy <= p.r * p.r) return id;
      }
      return null;
    };
    return { markers, shown, screenPos, hitTest };
  }

  test("home marker carries the sheet's ref kind", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const home = ms.find((m) => m.id === "home");
    expect(home).toBeDefined();
    expect(home!.ref.kind).toBe("home");
  });

  test("home survives projection + declutter and hit-tests at its dot", () => {
    const { shown, screenPos, hitTest } = tapPipeline(baseState());
    expect(shown.some((s) => s.marker.id === "home")).toBe(true);
    const pos = screenPos.get("home");
    expect(pos).toBeDefined();
    // Dead-center tap on the drawn dot must resolve to the home marker.
    expect(hitTest(pos!.x, pos!.y)).toBe("home");
  });

  test("home stays tappable with raids fanned around it", () => {
    const st = baseState({
      worldMap: {
        known: {},
        raids: [],
        raidWarnings: [],
        incomingRaids: [
          { raidId: "r1", attackerNames: ["Karg"], landsAt: NOW + 60000, resolved: false },
          { raidId: "r2", attackerNames: ["Vex"], landsAt: NOW + 120000, resolved: false },
        ],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
    });
    const { shown, screenPos, hitTest } = tapPipeline(st);
    expect(shown.some((s) => s.marker.id === "home")).toBe(true);
    const pos = screenPos.get("home");
    expect(pos).toBeDefined();
    expect(hitTest(pos!.x, pos!.y)).toBe("home");
  });
});

describe("terrain elevation", () => {
  test("deterministic for the same seed and coords", () => {
    expect(terrainElevation(3, 0.2, -0.4)).toBe(terrainElevation(3, 0.2, -0.4));
  });

  test("different seeds give different terrain", () => {
    expect(terrainElevation(3, 0.2, -0.4)).not.toBe(terrainElevation(4, 0.2, -0.4));
  });

  test("elevation stays in [0, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const u = (hash2i(i, 1, 99) * 2 - 1) * 1.2;
      const v = (hash2i(i, 2, 99) * 2 - 1) * 1.2;
      const e = terrainElevation(7, u, v);
      expect(e >= 0 && e <= 1).toBe(true);
    }
  });

  test("zero outside the unit disc", () => {
    expect(terrainElevation(7, 1, 0)).toBe(0);
    expect(terrainElevation(7, 0.8, 0.8)).toBe(0);
    expect(terrainElevation(7, -1.2, 0)).toBe(0);
  });

  test("radial falloff: center higher than the coast", () => {
    // every landmass seed should read as an island, not a donut
    for (let seed = 0; seed < 46; seed++) {
      const center = terrainElevation(seed, 0, 0);
      const coast = terrainElevation(seed, 0.97, 0);
      expect(center).toBeGreaterThan(coast);
      expect(coast).toBeLessThan(0.25);
    }
  });

  test("noise functions are deterministic and bounded", () => {
    expect(valueNoise2D(5, 1.5, -2.5)).toBe(valueNoise2D(5, 1.5, -2.5));
    expect(fbm2D(5, 1.5, -2.5)).toBe(fbm2D(5, 1.5, -2.5));
    for (let i = 0; i < 50; i++) {
      const n = fbm2D(5, i * 0.37, -i * 0.11);
      expect(n >= 0 && n <= 1).toBe(true);
    }
  });
});

describe("buildElevationGrid", () => {
  test("size and determinism", () => {
    const a = buildElevationGrid(11, 32);
    const b = buildElevationGrid(11, 32);
    expect(a.length).toBe(32 * 32);
    expect(a).toEqual(b);
  });

  test("matches terrainElevation at sample points", () => {
    const size = 33;
    const grid = buildElevationGrid(11, size);
    const at = (x: number, y: number) => grid[y * size + x];
    // center
    expect(at(16, 16)).toBeCloseTo(terrainElevation(11, 0, 0), 6);
    // corner is outside the disc → 0
    expect(at(0, 0)).toBe(0);
    expect(at(32, 32)).toBe(0);
  });
});

describe("terrainColor", () => {
  test("shore is pale, peaks are near-white", () => {
    const [r0, g0, b0] = terrainColor(0, 0);
    const [r1, g1, b1] = terrainColor(1, 0);
    // shore: pale (high channels)
    expect(r0 + g0 + b0).toBeGreaterThan(500);
    // peak: near-white
    expect(r1).toBeGreaterThan(220);
    expect(g1).toBeGreaterThan(220);
    expect(b1).toBeGreaterThan(200);
  });

  test("brightness rises with elevation", () => {
    const lum = (e: number): number => {
      const [r, g, b] = terrainColor(e, 0);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    expect(lum(1)).toBeGreaterThan(lum(0.5));
    expect(lum(0.5)).toBeGreaterThan(lum(0.15));
  });

  test("hue jitter shifts the palette per landmass", () => {
    const a = terrainColor(0.4, 0);
    const b = terrainColor(0.4, 1);
    expect(a).not.toEqual(b);
    // but stays in the same neighborhood (small shift, not a recolor)
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(60);
  });
});

describe("shadeTerrainGrid", () => {
  test("output shape and determinism", () => {
    const grid = buildElevationGrid(21, 24);
    const a = shadeTerrainGrid(grid, 24, 0.5);
    const b = shadeTerrainGrid(grid, 24, 0.5);
    expect(a.length).toBe(24 * 24 * 4);
    expect(a).toEqual(b);
  });

  test("transparent outside the disc, opaque-ish at the center", () => {
    const size = 33;
    const grid = buildElevationGrid(21, size);
    const px = shadeTerrainGrid(grid, size, 0);
    const corner = 0 * 4 + 3;
    expect(px[corner]).toBe(0); // top-left corner, outside disc
    const center = (16 * size + 16) * 4 + 3;
    expect(px[center]).toBeGreaterThan(200);
  });

  test("no NaN/Infinity in output", () => {
    const grid = buildElevationGrid(21, 32);
    const px = shadeTerrainGrid(grid, 32, -0.7);
    for (let i = 0; i < px.length; i++) {
      expect(Number.isFinite(px[i])).toBe(true);
    }
  });

  test("flat grid shades uniformly without artifacts", () => {
    const grid = new Float32Array(16 * 16).fill(0.4);
    const px = shadeTerrainGrid(grid, 16, 0);
    const center = (8 * 16 + 8) * 4;
    expect(px[center + 3]).toBe(255);
    expect(Number.isFinite(px[center])).toBe(true);
  });
});

describe("terrainSpriteSize", () => {
  test("scales with blob radius", () => {
    expect(terrainSpriteSize(5)).toBe(64);
    expect(terrainSpriteSize(10)).toBe(96);
    expect(terrainSpriteSize(15)).toBe(128);
  });
});

describe("WS2 icon metadata — every layer has an icon, every marker carries one", () => {
  function baseState(over: Record<string, unknown> = {}) {
    return {
      gameId: "g1",
      playerName: "Hans",
      worldMap: {
        known: {
          "s1:c1": { id: "c1", serverId: "s1", ownerName: "Rival", race: "grays", status: "active", lastScouted: NOW },
          "s1:c2": { id: "c2", serverId: "s1", ownerName: "Ghost", race: "grays", status: "husk", lastScouted: NOW },
        },
        raids: [],
        raidWarnings: [],
        incomingRaids: [{ raidId: "r1", attackerNames: ["Karg"], landsAt: NOW + 60000, resolved: false }],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
      memorials: [],
      ...over,
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  test("layer meta carries a representative icon per layer", () => {
    const kinds = new Set<string>();
    for (const l of GLOBE_LAYERS) {
      expect(typeof l.icon).toBe("string");
      expect((l.icon as string).length).toBeGreaterThan(0);
      kinds.add(l.id);
    }
    // spot-check Hans's mapping
    const byId = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.icon]));
    expect(byId.home).toBe("home");
    expect(byId.colonies).toBe("hut");
    expect(byId.husks).toBe("husk");
    expect(byId.chorus).toBe("chorus");
    expect(byId.sites).toBe("ember");
    expect(byId.satellites).toBe("satellite");
    expect(byId.memorials).toBe("monument");
    expect(byId.raids).toBe("raid");
    // eight layers, eight distinct representative icons (shape carries meaning)
    const icons = GLOBE_LAYERS.map((l) => l.icon);
    expect(new Set(icons).size).toBe(GLOBE_LAYERS.length);
  });

  test("every built marker carries a valid icon", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(typeof m.icon).toBe("string");
    }
  });

  test("marker icons match Hans's mapping", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const iconOf = (id: string): GlobeIconId | undefined => ms.find((m) => m.id === id)?.icon;
    expect(iconOf("home")).toBe("home");
    expect(iconOf("raid:r1")).toBe("raid");
    expect(iconOf("beachhead")).toBe("beachhead");
    // husks get the broken hut, active colonies the hut
    const huskIcon = ms.find((m) => m.layer === "husks")?.icon;
    const colonyIcon = ms.find((m) => m.layer === "colonies")?.icon;
    expect(huskIcon).toBe("husk");
    expect(colonyIcon).toBe("hut");
    // all chorus markers carry the Chorus sigil
    for (const m of ms.filter((m) => m.layer === "chorus")) {
      expect(m.icon).toBe("chorus");
    }
    // all satellite watchers carry the satellite icon
    for (const m of ms.filter((m) => m.layer === "satellites" && m.ref.kind === "satellite")) {
      expect(m.icon).toBe("satellite");
    }
  });

  test("siteMarkerIcon: T3 → chipset, T1/T2 → ember", () => {
    expect(siteMarkerIcon(1)).toBe("ember");
    expect(siteMarkerIcon(2)).toBe("ember");
    expect(siteMarkerIcon(3)).toBe("chipset");
  });

  test("built site markers carry tier-matching icons", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    for (const m of ms.filter((m) => m.layer === "sites")) {
      if (m.ref.kind !== "site") throw new Error("site layer marker without site ref");
      expect(m.icon).toBe(siteMarkerIcon(m.ref.tier));
    }
    // the tier mapping is risk-driven: <34 → T1, <67 → T2, else T3
    expect(siteTier(10)).toBe(1);
    expect(siteTier(50)).toBe(2);
    expect(siteTier(90)).toBe(3);
  });

  test("tier colors exist for the legend chips", () => {
    expect(GLOBE_SITE_TIER_COLOR[1]).toBe("#7dd3fc");
    expect(GLOBE_SITE_TIER_COLOR[2]).toBe("#a78bfa");
    expect(GLOBE_SITE_TIER_COLOR[3]).toBe("#f472b6");
  });
});

describe("WS3 satellites + beachhead", () => {
  function baseState(over: Record<string, unknown> = {}) {
    return {
      gameId: "g1",
      playerName: "Hans",
      worldMap: { known: {}, raids: [], raidWarnings: [], incomingRaids: [], reports: {}, probes: [], lastActive: NOW },
      memorials: [],
      ...over,
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  test("one satellite watch per world site + the Chorus heart", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const sats = ms.filter((m) => m.layer === "satellites" && m.ref.kind === "satellite");
    expect(sats).toHaveLength(ZONES.length + 1);
    expect(sats.some((m) => m.id === "sat:heart")).toBe(true);
    for (const z of ZONES) {
      expect(sats.some((m) => m.id === `sat:${z.id}`)).toBe(true);
    }
  });

  test("beachhead marker is fixed and openly marked", () => {
    const a = beachheadGlobePosition();
    const b = beachheadGlobePosition();
    expect(a).toEqual(b);
    expect(a).toEqual({ lat: 12, lon: 100 });
    const ms = buildGlobeMarkers(baseState(), NOW);
    const bh = ms.find((m) => m.id === "beachhead");
    expect(bh).toBeDefined();
    expect(bh!.icon).toBe("beachhead");
    expect(bh!.lat).toBe(12);
    expect(bh!.lon).toBe(100);
    // WS8: rides its own default-on layer, never the satellites toggle.
    expect(bh!.layer).toBe("beachhead");
    expect(bh!.priority).toBeGreaterThan(64);
  });

  test("beachhead layer exists and is default-on", () => {
    const meta = GLOBE_LAYERS.find((l) => l.id === "beachhead");
    expect(meta).toBeDefined();
    expect(meta!.defaultOn).toBe(true);
    expect(meta!.label).toBe("Beachhead");
    expect(meta!.icon).toBe("beachhead");
    const counts = countByLayer(buildGlobeMarkers(baseState(), NOW));
    expect(counts.beachhead).toBe(1);
  });

  test("satellites layer is default-on (GLOBE WAVE 3 WS2)", () => {
    const meta = GLOBE_LAYERS.find((l) => l.id === "satellites");
    expect(meta).toBeDefined();
    expect(meta!.defaultOn).toBe(true);
    expect(meta!.label).toBe("Satellites");
    expect(meta!.icon).toBe("satellite");
  });

  test("satellites layer no longer contains the beachhead marker", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    expect(ms.some((m) => m.layer === "satellites" && m.id === "beachhead")).toBe(false);
    expect(ms.some((m) => m.layer === "satellites" && m.ref.kind === "beachhead")).toBe(false);
    // satellites layer is still intact: one watch per zone + the heart
    const sats = ms.filter((m) => m.layer === "satellites");
    expect(sats).toHaveLength(ZONES.length + 1);
    expect(sats.every((m) => m.ref.kind === "satellite")).toBe(true);
  });

  test("satellite watch positions sit next to their sites", () => {
    for (const z of ZONES) {
      const tier = siteTier(z.risk);
      const site = worldSiteGlobePosition(z.id, tier);
      const sat = satelliteWatchPosition(z.id, tier);
      // near enough to read as "next to", far enough to never stack
      const dist = Math.abs(sat.lat - site.lat) + Math.abs(sat.lon - site.lon);
      expect(dist).toBeGreaterThan(2);
      expect(dist).toBeLessThan(20);
      expect(Math.abs(sat.lat) <= 78).toBe(true);
      expect(Math.abs(sat.lon) <= 180).toBe(true);
    }
  });

  test("satellite watch positions are deterministic", () => {
    expect(satelliteWatchPosition("zone-a", 2)).toEqual(satelliteWatchPosition("zone-a", 2));
  });

  test("Chorus heart sits on the grade-V site", () => {
    const heart = chorusHeartGlobePosition();
    const g5 = chorusSiteIntel().find((s) => s.grade === 5)!;
    expect(heart.lat).toBe(g5.lat);
    expect(heart.lon).toBe(g5.lon);
  });
});

describe("WS7 applyGlobeFilters", () => {
  function baseState(over: Record<string, unknown> = {}) {
    return {
      gameId: "g1",
      playerName: "Hans",
      worldMap: { known: {}, raids: [], raidWarnings: [], incomingRaids: [], reports: {}, probes: [], lastActive: NOW },
      memorials: [],
      ...over,
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  test("defaults keep everything", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const out = applyGlobeFilters(ms, DEFAULT_GLOBE_FILTERS);
    expect(out).toBe(ms); // all-on fast path returns the same array
    expect(out.length).toBe(ms.length);
  });

  test("empty/unknown filters never hide anything", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    expect(applyGlobeFilters(ms, {})).toHaveLength(ms.length);
    expect(applyGlobeFilters(ms, { siteTiers: { 1: true, 2: true, 3: true } })).toHaveLength(ms.length);
  });

  test("T3 off hides only T3 site markers", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const t3 = ms.filter((m) => m.ref.kind === "site" && m.ref.tier === 3);
    expect(t3.length).toBeGreaterThan(0);
    const out = applyGlobeFilters(ms, { siteTiers: { 1: true, 2: true, 3: false } });
    expect(out.some((m) => m.ref.kind === "site" && m.ref.tier === 3)).toBe(false);
    expect(out.some((m) => m.ref.kind === "site" && m.ref.tier === 1)).toBe(true);
    expect(out.some((m) => m.ref.kind === "site" && m.ref.tier === 2)).toBe(true);
    expect(out).toHaveLength(ms.length - t3.length);
  });

  test("non-site layers are never touched by tier filters", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const out = applyGlobeFilters(ms, { siteTiers: { 1: false, 2: false, 3: false } });
    for (const l of GLOBE_LAYERS.map((x) => x.id).filter((id) => id !== "sites")) {
      const want = ms.filter((m) => m.layer === l).length;
      expect(out.filter((m) => m.layer === l)).toHaveLength(want);
    }
    expect(out.some((m) => m.layer === "sites")).toBe(false);
  });
});

describe("declutter with icons", () => {
  function iconMarker(id: string, icon: GlobeIconId, priority: number, sx: number, sy: number): ScreenMarker {
    return {
      marker: {
        id,
        layer: "colonies",
        lat: 0,
        lon: 0,
        label: id,
        sublabel: "",
        color: "#fff",
        icon,
        priority,
        ref: { kind: "home" },
      } as GlobeMarker,
      sx,
      sy,
    };
  }

  test("26px declutter keeps higher priority regardless of icon", () => {
    const kept = declutterMarkers(
      [iconMarker("low", "hut", 10, 0, 0), iconMarker("high", "beachhead", 90, 5, 5)],
      26,
    );
    expect(kept.map((k) => k.marker.id)).toEqual(["high"]);
  });

  test("icon markers at 26px+ separation all survive", () => {
    const kept = declutterMarkers(
      [
        iconMarker("a", "hut", 70, 0, 0),
        iconMarker("b", "ember", 55, 30, 0),
        iconMarker("c", "chipset", 55, 0, 30),
      ],
      26,
    );
    expect(kept).toHaveLength(3);
  });
});

describe("WS-A arena stadium (Hans, Oct 4 2026)", () => {
  function baseState(over: Record<string, unknown> = {}) {
    return {
      gameId: "g1",
      playerName: "Hans",
      worldMap: { known: {}, raids: [], raidWarnings: [], incomingRaids: [], reports: {}, probes: [], lastActive: NOW },
      memorials: [],
      ...over,
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  test("arena layer exists, on by default, open to everybody", () => {
    const meta = GLOBE_LAYERS.find((l) => l.id === "arena");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("Arena");
    expect(meta!.defaultOn).toBe(true);
    expect(meta!.blurb.toLowerCase().includes("everybody")).toBe(true);
    expect(meta!.icon).toBe("arena");
  });

  test("arena color is distinct from every other layer's color", () => {
    const arenaColor = GLOBE_LAYERS.find((l) => l.id === "arena")!.color.toLowerCase();
    const others = GLOBE_LAYERS.filter((l) => l.id !== "arena").map((l) => l.color.toLowerCase());
    expect(others.includes(arenaColor)).toBe(false);
    // shape still carries the meaning: every layer keeps a unique icon
    const icons = GLOBE_LAYERS.map((l) => l.icon);
    expect(new Set(icons).size).toBe(GLOBE_LAYERS.length);
  });

  test("arenaGlobePosition is fixed, equatorial, and clear of the beachhead", () => {
    const a = arenaGlobePosition();
    const b = arenaGlobePosition();
    expect(a).toEqual(b);
    expect(a).toEqual({ lat: -8, lon: -40 });
    expect(Math.abs(a.lat) <= 20).toBe(true); // equatorial
    // well clear of the beachhead (12, 100)
    const bh = beachheadGlobePosition();
    const dist = Math.abs(a.lat - bh.lat) + Math.abs(a.lon - bh.lon);
    expect(dist).toBeGreaterThan(100);
    expect(Math.abs(a.lat) <= 78).toBe(true);
    expect(Math.abs(a.lon) <= 180).toBe(true);
  });

  test("arena marker is built with the stadium rendering path", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    const arena = ms.find((m) => m.id === "arena");
    expect(arena).toBeDefined();
    expect(arena!.layer).toBe("arena");
    expect(arena!.ref.kind).toBe("arena");
    expect(arena!.icon).toBe("arena");
    expect(arena!.label).toBe("The Arena");
    expect(arena!.sublabel.toLowerCase().includes("everybody")).toBe(true);
    expect(arena!.lat).toBe(-8);
    expect(arena!.lon).toBe(-40);
    // prominent: below raids/home, above the colony fan
    expect(arena!.priority >= 70).toBe(true);
    const counts = countByLayer(ms);
    expect(counts.arena).toBe(1);
  });

  test("saved prefs without the arena id still default it on (graceful)", () => {
    // mirrors WorldGlobe.tsx's layersOn init: saved prefs are partial, new
    // ids fall back to their defaultOn from GLOBE_LAYERS.
    const saved = { home: false } as Partial<Record<string, boolean>>;
    const init: Record<string, boolean> = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.defaultOn]));
    for (const l of GLOBE_LAYERS) {
      if (typeof saved[l.id] === "boolean") init[l.id] = saved[l.id]!;
    }
    expect(init.arena).toBe(true);
    expect(init.home).toBe(false);
  });

  test("satellites merge: explicit off survives, absent key defaults on (WAVE 3 WS2)", () => {
    // mirrors WorldGlobe.tsx's layersOn init.
    const merge = (saved: Partial<Record<string, boolean>>) => {
      const init: Record<string, boolean> = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.defaultOn]));
      for (const l of GLOBE_LAYERS) {
        if (typeof saved[l.id] === "boolean") init[l.id] = saved[l.id]!;
      }
      return init;
    };
    // no stored pref at all → new default applies
    expect(merge({}).satellites).toBe(true);
    // user explicitly toggled it off → choice preserved, not bulldozed
    expect(merge({ satellites: false }).satellites).toBe(false);
    expect(merge({ satellites: true }).satellites).toBe(true);
  });
});
