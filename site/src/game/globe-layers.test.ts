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
  playerAlliance,
  projectGlobe,
  ridgeAxisAngle,
  satelliteWatchPosition,
  shadeTerrainGrid,
  shorelineRadius,
  siteMarkerIcon,
  siteTier,  terrainColor,
  terrainElevation,
  terrainPeaks,
  TERRAIN_TUNING,
  terrainSizeClass,
  terrainSpriteSize,
  valueNoise2D,
  worldSiteGlobePosition,
  type GlobeIconId,
  type GlobeMarker,
  type ScreenMarker,
} from "./globe-layers";
import { ZONES } from "./zones";
import { chorusSiteIntel } from "./chorus-intel";
import { drawGlobeIconGlyph } from "../components/WorldGlobe";

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

  test("alliance layer: member colonies wear the shield, others don't", () => {
    const st = baseState({
      alliances: {
        a1: {
          id: "a1",
          name: "Ashen Band",
          members: [{ colonyId: "g1" }, { colonyId: "c2" }],
        },
      },
      worldMap: {
        known: {
          "s1:c2": { id: "c2", serverId: "s1", ownerName: "Friend", race: "grays", status: "active", lastScouted: NOW },
          "s1:c3": { id: "c3", serverId: "s1", ownerName: "Stranger", race: "grays", status: "active", lastScouted: NOW },
          "s1:c4": { id: "c4", serverId: "s1", ownerName: "Dead Ally", race: "grays", status: "husk", lastScouted: NOW },
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
    const ally = ms.filter((m) => m.layer === "alliance");
    // Only the living member colony — not the stranger, not the husk.
    expect(ally).toHaveLength(1);
    expect(ally[0].id).toBe("ally:s1:c2");
    expect(ally[0].icon).toBe("shield");
    expect(ally[0].sublabel.includes("Ashen Band")).toBe(true);
    expect(ally[0].ref.kind).toBe("colony");
    // The shield outranks the plain hut at the same position.
    const hut = ms.find((m) => m.id === "colony:s1:c2");
    expect(hut).toBeDefined();
    expect(ally[0].priority).toBeGreaterThan(hut!.priority);
    expect(ally[0].lat).toBe(hut!.lat);
    expect(ally[0].lon).toBe(hut!.lon);
  });

  test("alliance layer: own sub colonies count as holdings", () => {
    const st = baseState({
      alliances: {
        a1: { id: "a1", name: "Ashen Band", members: [{ colonyId: "g1" }] },
      },
      worldMap: {
        known: {
          "s1:c9": {
            id: "c9", serverId: "s1", ownerName: "Hans", race: "draconians",
            status: "sub_colony", lastScouted: NOW,
            subClaim: { claimedAt: NOW },
          },
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
    const ally = ms.filter((m) => m.layer === "alliance");
    expect(ally).toHaveLength(1);
    expect(ally[0].sublabel.includes("Your holding")).toBe(true);
  });

  test("alliance layer: no alliance → no shield markers, never throws", () => {
    const ms = buildGlobeMarkers(baseState(), NOW);
    expect(ms.filter((m) => m.layer === "alliance")).toHaveLength(0);
    expect(playerAlliance(baseState())).toBeNull();
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
    const cls = terrainSizeClass(size); // small
    const grid = buildElevationGrid(11, size);
    const at = (x: number, y: number) => grid[y * size + x];
    // center
    expect(at(16, 16)).toBeCloseTo(terrainElevation(11, 0, 0, cls), 6);
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

  test("Chorus heart sits on the heart zone (dark-matter-observatory), not on sort order", () => {
    const heart = chorusHeartGlobePosition();
    const heartSite = chorusSiteIntel().find((s) => s.isHeart)!;
    expect(heartSite.zoneId).toBe("dark-matter-observatory");
    expect(heart.lat).toBe(heartSite.lat);
    expect(heart.lon).toBe(heartSite.lon);
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

describe("WS3 zero-dots audit (Hans, Oct 4 2026)", () => {
  // Hans: shape carries the meaning, not color — colorblind players can't
  // tell colored dots apart. Every marker kind on the globe canvas and every
  // legend row must resolve to a defined icon kind. This is the regression
  // guard: representative game state covering ALL kinds, asserting each one
  // resolves to a real icon — no dot/circle fallback allowed anywhere.
  function auditState() {
    return {
      gameId: "g1",
      playerName: "Hans",
      // The audit player flies a war-band banner and "Friend" (active1) is
      // a member — so the alliance shield rides a marker in this fixture.
      alliances: {
        a1: {
          id: "a1",
          name: "Audit Band",
          members: [{ colonyId: "g1" }, { colonyId: "active1" }],
        },
      },
      worldMap: {
        known: {
          "s1:active1": {
            id: "active1",
            serverId: "s1",
            ownerName: "Friend",
            race: "grays",
            status: "active",
            lastScouted: NOW,
          },
          "s1:husk1": {
            id: "husk1",
            serverId: "s1",
            ownerName: "Rival",
            race: "draconians",
            status: "husk",
            lastScouted: NOW,
          },
        },
        raids: [],
        raidWarnings: [],
        incomingRaids: [
          {
            raidId: "r1",
            attackerWorldId: "w2",
            attackerWorldName: "World 2",
            attackerNames: ["Raider"],
            targetColonyId: "c1",
            shipCount: 3,
            troopCount: 500,
            landsAt: NOW + 60_000,
            launchedAt: NOW - 60_000,
            seen: false,
          },
        ],
        reports: {},
        probes: [],
        lastActive: NOW,
      },
      memorials: [
        {
          id: "m1",
          battleId: "b1",
          nodeId: "n1",
          siteName: "Site",
          season: "S1",
          at: NOW,
          attackerName: "A",
          defenderName: "D",
          attackerLosses: 100,
          defenderLosses: 100,
          fallenHeroes: [],
          victor: "draw",
          epitaph: null,
          epitaphBy: null,
        },
      ],
    } as unknown as Parameters<typeof buildGlobeMarkers>[0];
  }

  /** The full icon vocabulary — every GlobeIconId that may ride a marker. */
  const ALL_ICONS: GlobeIconId[] = [
    "home",
    "raid",
    "chorus",
    "hut",
    "ember",
    "chipset",
    "husk",
    "monument",
    "satellite",
    "beachhead",
    "shield",
    "arena",
  ];

  /** No dot/circle/default fallback may ever ride a marker or legend row. */
  const FORBIDDEN = ["dot", "circle", "default", "unknown", "placeholder", "none"];

  test("all twelve marker kinds resolve to a defined icon", () => {
    const ms = buildGlobeMarkers(auditState(), NOW);
    const byId = new Map(ms.map((m) => [m.id, m]));

    // home — the player's colony, bigger unmistakable settlement
    expect(byId.get("home")?.icon).toBe("home");
    // colony — another player's active colony, the hut
    expect(ms.find((m) => m.layer === "colonies")?.icon).toBe("hut");
    // husk — dead colony, broken hut
    expect(ms.find((m) => m.layer === "husks")?.icon).toBe("husk");
    // chorus — every Chorus site carries the sigil
    const chorus = ms.filter((m) => m.layer === "chorus");
    expect(chorus.length).toBeGreaterThan(0);
    for (const m of chorus) expect(m.icon).toBe("chorus");
    // T1 / T2 — ember; T3 — chipset (chipsets only drop in T3s)
    const sites = ms.filter((m) => m.layer === "sites");
    const t1 = sites.find((m) => m.ref.kind === "site" && m.ref.tier === 1);
    const t2 = sites.find((m) => m.ref.kind === "site" && m.ref.tier === 2);
    const t3 = sites.find((m) => m.ref.kind === "site" && m.ref.tier === 3);
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();
    expect(t1!.icon).toBe("ember");
    expect(t2!.icon).toBe("ember");
    expect(t3!.icon).toBe("chipset");
    // raid — crossed swords
    expect(byId.get("raid:r1")?.icon).toBe("raid");
    // memorial — obelisk
    expect(ms.find((m) => m.layer === "memorials")?.icon).toBe("monument");
    // satellite — dish next to every site + the Chorus heart
    const sats = ms.filter((m) => m.layer === "satellites");
    expect(sats.length).toBeGreaterThan(0);
    for (const m of sats) expect(m.icon).toBe("satellite");
    // beachhead — banner, open geography
    expect(byId.get("beachhead")?.icon).toBe("beachhead");
    // arena — stadium silhouette (globe blits the full stadium sprite)
    expect(byId.get("arena")?.icon).toBe("arena");
  });

  test("no marker anywhere falls back to a dot/circle", () => {
    const ms = buildGlobeMarkers(auditState(), NOW);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(ALL_ICONS.includes(m.icon)).toBe(true);
      for (const f of FORBIDDEN) {
        expect(m.icon.toLowerCase().includes(f)).toBe(false);
      }
    }
    // and every icon kind in the vocabulary actually rides at least one
    // marker — dead glyphs are how dot fallbacks hide.
    const seen = new Set(ms.map((m) => m.icon));
    for (const k of ALL_ICONS) {
      expect(seen.has(k)).toBe(true);
    }
  });

  test("every legend row carries a defined icon — no CSS-dot rows", () => {
    expect(GLOBE_LAYERS.length).toBeGreaterThan(0);
    for (const l of GLOBE_LAYERS) {
      expect(ALL_ICONS.includes(l.icon)).toBe(true);
      for (const f of FORBIDDEN) {
        expect(l.icon.toLowerCase().includes(f)).toBe(false);
      }
    }
  });
});

describe("WAVE 3 — irregular coastlines (no discs)", () => {
  test("shorelineRadius is deterministic per seed and angle", () => {
    expect(shorelineRadius(7, 1.2)).toBe(shorelineRadius(7, 1.2));
    expect(shorelineRadius(7, 1.2)).not.toBe(shorelineRadius(8, 1.2));
    expect(shorelineRadius(7, 1.2)).not.toBe(shorelineRadius(7, 2.4));
  });

  test("shoreline is seamless at θ = ±π", () => {
    for (let seed = 0; seed < 12; seed++) {
      expect(shorelineRadius(seed, Math.PI)).toBeCloseTo(shorelineRadius(seed, -Math.PI), 9);
    }
  });

  test("coastline radius varies substantially around every landmass — no discs", () => {
    // (max − min) / mean over 72 angles. Empirically every one of the 46
    // landmass seeds clears 0.33; the 0.25 bar leaves margin.
    for (let seed = 0; seed < 46; seed++) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let k = 0; k < 72; k++) {
        const r = shorelineRadius(seed, (k / 72) * Math.PI * 2);
        mn = Math.min(mn, r);
        mx = Math.max(mx, r);
      }
      expect((mx - mn) / ((mn + mx) / 2)).toBeGreaterThan(0.25);
    }
  });

  test("shoreline stays inside the sprite disc with beach room", () => {
    const t = TERRAIN_TUNING;
    for (let seed = 0; seed < 46; seed++) {
      for (let k = 0; k < 24; k++) {
        const r = shorelineRadius(seed, (k / 24) * Math.PI * 2);
        expect(r >= t.coastMinRadius).toBe(true);
        expect(r <= t.coastMaxRadius).toBe(true);
      }
    }
  });

  test("elevation is exactly 0 outside the shoreline (real geography, not a blob)", () => {
    for (let seed = 0; seed < 8; seed++) {
      for (let k = 0; k < 16; k++) {
        const theta = (k / 16) * Math.PI * 2;
        const R = shorelineRadius(seed, theta);
        // just outside the shoreline → ocean
        const u = Math.cos(theta) * (R + 0.02);
        const v = Math.sin(theta) * (R + 0.02);
        expect(terrainElevation(seed, u, v, "large")).toBe(0);
        // just inside the shoreline → land (beach band)
        const u2 = Math.cos(theta) * (R - 0.03);
        const v2 = Math.sin(theta) * (R - 0.03);
        expect(terrainElevation(seed, u2, v2, "large")).toBeGreaterThan(0);
      }
    }
  });
});

describe("WAVE 3 — directional ridges + snow peaks", () => {
  test("ridgeAxisAngle is deterministic and spans the half-circle", () => {
    expect(ridgeAxisAngle(3)).toBe(ridgeAxisAngle(3));
    expect(ridgeAxisAngle(3)).not.toBe(ridgeAxisAngle(4));
    const angles = new Set<number>();
    for (let seed = 0; seed < 46; seed++) {
      const a = ridgeAxisAngle(seed);
      expect(a >= 0).toBe(true);
      expect(a).toBeLessThan(Math.PI);
      angles.add(Math.round(a * 8));
    }
    // axes spread out — not all ranges pointing the same way
    expect(angles.size).toBeGreaterThan(10);
  });

  test("large landmasses reach the snow line", () => {
    // 102px bake grids = the large sprite class (128px sprites).
    for (const seed of [0, 1, 2, 3, 4, 5, 10, 20, 30, 40]) {
      const grid = buildElevationGrid(seed, 102);
      let mx = 0;
      for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
      expect(mx >= TERRAIN_TUNING.snowLine).toBe(true);
    }
  });

  test("medium landmasses reach the snow line too", () => {
    for (const seed of [0, 7, 13, 29, 44]) {
      const grid = buildElevationGrid(seed, 77);
      let mx = 0;
      for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
      expect(mx >= TERRAIN_TUNING.snowLine).toBe(true);
    }
  });

  test("small islets get a high point that usually stops at rock, not snow", () => {
    let snowCount = 0;
    for (let seed = 0; seed < 46; seed++) {
      const grid = buildElevationGrid(seed, 51);
      let mx = 0;
      for (let i = 0; i < grid.length; i++) mx = Math.max(mx, grid[i]);
      expect(mx).toBeGreaterThan(0.5); // a real high point exists
      if (mx >= TERRAIN_TUNING.snowLine) snowCount++;
    }
    // small islets shouldn't ALL be snow-capped
    expect(snowCount).toBeLessThan(46);
  });

  test("peak anchors sit on the ridge axis, inside the shoreline", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const cls of ["small", "medium", "large"] as const) {
        const peaks = terrainPeaks(seed, cls);
        expect(peaks.length).toBeGreaterThan(0);
        for (const p of peaks) {
          const r = Math.hypot(p.x, p.y);
          // well inside the minimum shoreline radius — never pokes the coast
          expect(r).toBeLessThan(TERRAIN_TUNING.coastMinRadius - 0.05);
          // strung along the ridge axis: |cross| small vs |along|
          const phi = ridgeAxisAngle(seed);
          const along = Math.abs(p.x * Math.cos(phi) + p.y * Math.sin(phi));
          const cross = Math.abs(-p.x * Math.sin(phi) + p.y * Math.cos(phi));
          expect(along * along + cross * cross).toBeCloseTo(r * r, 9);
          expect(cross).toBeLessThan(0.25);
        }
      }
    }
  });

  test("peak counts grow with size class", () => {
    expect(terrainPeaks(5, "small")).toHaveLength(1);
    expect(terrainPeaks(5, "medium")).toHaveLength(2);
    expect(terrainPeaks(5, "large")).toHaveLength(3);
  });

  test("snow-line elevation renders near-white", () => {
    for (const j of [-1, 0, 1]) {
      const [r, g, b] = terrainColor(0.97, j);
      expect(r).toBeGreaterThan(225);
      expect(g).toBeGreaterThan(225);
      expect(b).toBeGreaterThan(205);
    }
  });
});

describe("WAVE 3 — beach + biome palettes", () => {
  test("low elevation reads as warm beach sand, not grass", () => {
    const [r, g, b] = terrainColor(0.03, 0);
    expect(r).toBeGreaterThan(b + 25); // warm, not blue-green
    expect(r + g + b).toBeGreaterThan(500); // pale (old "shore is pale" contract)
  });

  test("biome families differ: arid / verdant / temperate", () => {
    const arid = terrainColor(0.3, -1);
    const verdant = terrainColor(0.3, 1);
    const temperate = terrainColor(0.3, 0);
    expect(arid).not.toEqual(verdant);
    expect(arid).not.toEqual(temperate);
    expect(verdant).not.toEqual(temperate);
    // all still in the same neighborhood — a shift, not a recolor
    for (const c of [arid, verdant]) {
      const dist = Math.hypot(c[0] - temperate[0], c[1] - temperate[1], c[2] - temperate[2]);
      expect(dist).toBeGreaterThan(0);
      expect(dist).toBeLessThan(60);
    }
    // arid is warmer (more red vs blue) than verdant at the same elevation
    expect(arid[0] - arid[2]).toBeGreaterThan(verdant[0] - verdant[2]);
  });

  test("mountains and snow ignore the biome shift", () => {
    const rockA = terrainColor(0.75, -1);
    const rockB = terrainColor(0.75, 1);
    const dist = Math.hypot(rockA[0] - rockB[0], rockA[1] - rockB[1], rockA[2] - rockB[2]);
    expect(dist).toBeLessThan(15);
  });

  test("great-plains band sits between lowland green and highland amber", () => {
    const warmth = (e: number): number => {
      const [r, , b] = terrainColor(e, 0);
      return r - b;
    };
    // the hue marches warm: lowland green → golden plains → amber highland
    expect(warmth(0.4)).toBeGreaterThan(warmth(0.24));
    expect(warmth(0.56)).toBeGreaterThan(warmth(0.4));
    // and pale rock still lifts brightness above the highlands
    const lum = (e: number): number => {
      const [r, g, b] = terrainColor(e, 0);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    expect(lum(0.86)).toBeGreaterThan(lum(0.56));
  });

  test("beach alpha feathers from elevation — shoreline follows the real coast", () => {
    const t = TERRAIN_TUNING;
    const grid = buildElevationGrid(9, 64);
    const px = shadeTerrainGrid(grid, 64, 0);
    let partial = 0;
    let full = 0;
    for (let i = 0; i < grid.length; i++) {
      const e = grid[i];
      const s = e <= 0 ? 0 : Math.min(1, e / t.shoreFeather);
      const expected = Math.round(255 * (s * s * (3 - 2 * s)));
      const a = px[i * 4 + 3];
      expect(Math.abs(a - expected) <= 1).toBe(true);
      if (a > 0 && a < 255) partial++;
      if (a === 255) full++;
    }
    // a real feathered fringe exists between water and full land
    expect(partial).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
  });
});

describe("WAVE 3 — determinism + size classes", () => {
  test("elevation is deterministic per seed, coords, and size class", () => {
    for (const cls of ["small", "medium", "large"] as const) {
      expect(terrainElevation(3, 0.2, -0.4, cls)).toBe(terrainElevation(3, 0.2, -0.4, cls));
    }
  });

  test("different size classes give different peak fields", () => {
    // same seed/coords, small vs large differ at a peak anchor
    const peaks = terrainPeaks(3, "large");
    const p = peaks[0];
    expect(terrainElevation(3, p.x, p.y, "large")).toBeGreaterThan(
      terrainElevation(3, p.x, p.y, "small") + 0.05,
    );
  });

  test("terrainSizeClass mirrors the sprite bake sizes", () => {
    expect(terrainSizeClass(51)).toBe("small");
    expect(terrainSizeClass(77)).toBe("medium");
    expect(terrainSizeClass(102)).toBe("large");
  });

  test("elevation stays in [0, 1] across seeds, coords, and classes", () => {
    for (const cls of ["small", "medium", "large"] as const) {
      for (let i = 0; i < 60; i++) {
        const u = (hash2i(i, 1, 99) * 2 - 1) * 1.2;
        const v = (hash2i(i, 2, 99) * 2 - 1) * 1.2;
        const e = terrainElevation(7, u, v, cls);
        expect(e >= 0 && e <= 1).toBe(true);
      }
    }
  });
});

describe("WS3 visual-QA: globe icon glyph paths — every case draws a distinct non-trivial path", () => {
  // drawGlobeIconGlyph lives in WorldGlobe.tsx (canvas-only; the module has
  // no top-level DOM, so it imports cleanly under bun). Trace every canvas
  // call per GlobeIconId with a mock 2d context.
  const ALL_ICONS: GlobeIconId[] = [
    "home",
    "raid",
    "chorus",
    "hut",
    "ember",
    "chipset",
    "husk",
    "monument",
    "satellite",
    "beachhead",
    "shield",
    "arena",
  ];

  function traceGlyph(kind: GlobeIconId, size = 24): string[] {
    const calls: string[] = [];
    const fmt = (v: unknown) =>
      typeof v === "number" ? v.toFixed(3) : String(v);
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.map(fmt).join(",")})`);
        };
      },
      set(_t, prop: string, value: unknown) {
        calls.push(`set:${prop}=${fmt(value)}`);
        return true;
      },
    });
    drawGlobeIconGlyph(
      ctx as unknown as CanvasRenderingContext2D,
      kind,
      size,
    );
    return calls;
  }

  const traces = () =>
    new Map<GlobeIconId, string[]>(ALL_ICONS.map((k) => [k, traceGlyph(k)]));

  test("every GlobeIconId case draws something non-trivial (no empty/dot case)", () => {
    for (const kind of ALL_ICONS) {
      const calls = traceGlyph(kind);
      const paints = calls.some(
        (c) =>
          c.startsWith("fill(") ||
          c.startsWith("stroke(") ||
          c.startsWith("fillRect("),
      );
      expect(paints).toBe(true);
    }
  });

  test("every kind has a distinct recorded path (shape carries meaning, not color)", () => {
    const sigs = [...traces().values()].map((c) => c.join(";"));
    expect(new Set(sigs).size).toBe(ALL_ICONS.length);
  });

  test("satellite renders a bold dish: crescent bowl (annular sector) + stub mast", () => {
    const calls = traceGlyph("satellite");
    // bowl — outer + inner arcs of the annular sector (the dish cup)
    const arcs = calls.filter((c) => c.startsWith("arc("));
    expect(arcs.length).toBeGreaterThan(1);
    // stub mast — a stroked line with a thick width (no sub-pixel details)
    expect(calls.filter((c) => c.startsWith("stroke(")).length).toBeGreaterThan(
      0,
    );
    const widths = calls
      .filter((c) => c.startsWith("set:lineWidth="))
      .map((c) => parseFloat(c.slice("set:lineWidth=".length)));
    expect(Math.max(...widths) >= 3).toBe(true);
    // base foot
    expect(calls.some((c) => c.startsWith("fillRect("))).toBe(true);
    // no tilt transform and no tiny feed dot — the previous pass's
    // fine details vanished below 24px and read as a dot
    expect(calls.some((c) => c.startsWith("rotate("))).toBe(false);
  });

  test("satellite dish reads at small size (s=16): bowl radius and mast stay chunky", () => {
    const calls = traceGlyph("satellite", 16);
    // bowl outer arc radius ≥ 6px at s=16 (the crescent must survive)
    const radii = calls
      .filter((c) => c.startsWith("arc("))
      .map((c) => parseFloat(c.slice("arc(".length).split(",")[2]));
    expect(Math.max(...radii) >= 6).toBe(true);
    // mast lineWidth ≥ 3px at s=16
    const widths = calls
      .filter((c) => c.startsWith("set:lineWidth="))
      .map((c) => parseFloat(c.slice("set:lineWidth=".length)));
    expect(Math.max(...widths) >= 3).toBe(true);
    // still paints a non-trivial path (bowl fill + mast stroke + foot)
    const paints = calls.filter(
      (c) =>
        c.startsWith("fill(") ||
        c.startsWith("stroke(") ||
        c.startsWith("fillRect("),
    );
    expect(paints.length).toBeGreaterThan(2);
  });

  test("chorus sigil is bold: ring + core arcs with thick line widths and a filled core", () => {
    const calls = traceGlyph("chorus");
    const arcs = calls.filter((c) => c.startsWith("arc("));
    // ring + filled core
    expect(arcs.length).toBeGreaterThan(1);
    expect(calls.some((c) => c.startsWith("fill("))).toBe(true);
    const widths = calls
      .filter((c) => c.startsWith("set:lineWidth="))
      .map((c) => parseFloat(c.slice("set:lineWidth=".length)));
    expect(Math.max(...widths) >= 3).toBe(true);
  });
});
