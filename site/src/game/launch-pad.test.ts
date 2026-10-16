// THE GLOBE BUILD — launch pads, the everything-index, and presence
// minimums (owner 2026-10-16).
//
// REDUNDANCY BY DESIGN: the shared site launch pad (SiteLaunchPad) reads
// ONE eligibility mirror (expeditionEligibility in client-utils). These
// tests pin the mirror to the engine itself: on a stocked colony every
// zone the pad calls eligible, launchExpedition accepts — and each
// refusal kind fires exactly when its gate trips, with the pad's
// numbers equal to the engine's. The index grouping and the beachhead
// presence floor (no presence mark under 24px at its band's working
// zoom — the "dinky flag" ban) are pinned here too, plus source locks
// that the pad is actually mounted at the globe sheet and the circuit
// map, and that the circuit alert surface + klaxon hardening shipped.
// Run: bun test site/src/game/launch-pad.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZONES, getZone } from "./zones";
import {
  energyCapacity,
  launchExpedition,
  maxConcurrentExpeditionsState,
  newGame,
} from "./engine";
import { engineHelpers, expeditionBill, expeditionEligibility } from "./client-utils";
import { globeIndexGroups, type GlobeMarker } from "./globe-layers";
import {
  bunkerGlyphSize,
  holderColor,
  presenceBand,
  standardHeight,
  BUNKER_GLYPH_CAP_PX,
  BUNKER_GLYPH_FLOOR_PX,
  SECTOR_STANDARD_MAX_PX,
  SECTOR_STANDARD_MIN_PX,
  STANDARD_MIN_PX,
} from "./war/beachhead-presence";
import type { GameState } from "./types";

const NOW = 1_760_000_000_000;
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

/** The stocked fixture (expedition-bill.test.ts pattern): every gate
 *  passes, so only the condition under test can refuse. */
function stocked(developed = true): GameState {
  const s = newGame("Pad Test", "watchers", NOW);
  s.resources.supplies = 10_000_000;
  s.resources.embers = 100_000;
  s.resources.gas = 100_000;
  s.resources.battery = 100_000;
  s.resources.skmech = 100_000;
  s.resources.hazmat = 1_000;
  s.resources.shots = 1_000;
  s.resources.alloys = 1_000;
  s.resources.medkit = 1;
  s.resources.mechkit = 1;
  s.resources.armorkit = 1;
  if (developed) {
    s.deployedDomains.agriculture = 10;
    s.deployedDomains.economy = 10;
    s.deployedDomains.industry = 5;
    s.deployedDomains.logistics = 3;
  }
  return s;
}

/** Find a zone where zeroing `resource` makes the pad refuse with
 *  `kind` — discovered through the mirror itself, so the test follows
 *  the game's own zone table instead of hardcoding ids. */
function zoneRefusingWhen(
  resource: "gas" | "battery" | "skmech",
  kind: string,
) {
  return ZONES.find((z) => {
    const s = stocked();
    s.resources[resource] = 0;
    return expeditionEligibility(s, z).reason === kind;
  });
}

describe("launch pad — the eligibility mirror IS the engine", () => {
  test("stocked colony: pad-eligible ⟺ launchExpedition accepts, on every zone", () => {
    const s = stocked();
    for (const zone of ZONES) {
      const e = expeditionEligibility(s, zone);
      const trial = launchExpedition(structuredClone(s), zone.id, 1, NOW);
      expect(e.ok).toBe(trial.ok);
      if (e.ok) {
        expect(e.bill.totalSupplies).toBe(expeditionBill(s, zone).totalSupplies);
        expect(e.needsRiskConfirm).toBe(engineHelpers.isDeep(zone));
      }
    }
  });

  test("no race chosen → noRace", () => {
    const s = stocked();
    s.race = null;
    const e = expeditionEligibility(s, ZONES[0]!);
    expect(e.ok).toBe(false);
    expect(e.reason).toBe("noRace");
  });

  test("all slots out → slots, with the engine's own counts", () => {
    const s = stocked();
    const max = maxConcurrentExpeditionsState(s);
    for (let i = 0; i < max; i++) {
      s.expeditions.push({ status: "out" } as GameState["expeditions"][number]);
    }
    const e = expeditionEligibility(s, ZONES[0]!);
    expect(e.reason).toBe("slots");
    expect(e.activeCount).toBe(max);
    expect(e.maxSlots).toBe(max);
    expect(launchExpedition(structuredClone(s), ZONES[0]!.id, 1, NOW).ok).toBe(false);
  });

  test("short supplies → supplies, quoting the FULL bill (never operations alone)", () => {
    const s = stocked();
    const zone = getZone("hollow-warrens");
    const bill = expeditionBill(s, zone);
    s.resources.supplies = bill.totalSupplies - 1;
    const e = expeditionEligibility(s, zone);
    expect(e.reason).toBe("supplies");
    expect(e.need).toBe(bill.totalSupplies);
    expect(e.have).toBe(bill.totalSupplies - 1);
  });

  test("short embers on an ordnance rung → embers", () => {
    const s = stocked();
    const zone = ZONES.find((z) => expeditionBill(s, z).ordnanceEmbers > 0)!;
    expect(zone).toBeDefined();
    s.resources.embers = expeditionBill(s, zone).ordnanceEmbers - 1;
    const e = expeditionEligibility(s, zone);
    expect(e.reason).toBe("embers");
  });

  test("empty energy pool → energy; unset pool reads as capacity", () => {
    const s = stocked();
    s.energy = 0;
    const e = expeditionEligibility(s, ZONES[0]!);
    expect(e.reason).toBe("energy");
    expect(e.have).toBe(0);
    const s2 = stocked();
    s2.energy = undefined;
    expect(expeditionEligibility(s2, ZONES[0]!).ok).toBe(true);
    expect(energyCapacity(s2)).toBeGreaterThan(0);
  });

  test("no step-out kits → stepOut", () => {
    const s = stocked();
    s.resources.medkit = 0;
    const e = expeditionEligibility(s, ZONES[0]!);
    expect(e.reason).toBe("stepOut");
  });

  test("convoy gates refuse as fuel, battery, mechanics on the zones that need them", () => {
    const fuelZone = zoneRefusingWhen("gas", "fuel");
    const battZone = zoneRefusingWhen("battery", "battery");
    const mechZone = zoneRefusingWhen("skmech", "mechanics");
    expect(!!(fuelZone && battZone && mechZone)).toBe(true);
    // And the engine agrees those launches are refused.
    const sf = stocked();
    sf.resources.gas = 0;
    expect(launchExpedition(structuredClone(sf), fuelZone!.id, 1, NOW).ok).toBe(false);
  });

  test("deep zones flag the risk confirmation; backyard zones don't", () => {
    const s = stocked();
    const deep = ZONES.find((z) => engineHelpers.isDeep(z));
    const mild = ZONES.find((z) => !engineHelpers.isDeep(z));
    expect(!!(deep && mild)).toBe(true);
    expect(expeditionEligibility(s, deep!).needsRiskConfirm).toBe(true);
    expect(expeditionEligibility(s, mild!).needsRiskConfirm).toBe(false);
  });
});

describe("everything-index — grouping from a fixture sky", () => {
  const mk = (over: Partial<GlobeMarker>): GlobeMarker => ({
    id: "x",
    layer: "sites",
    lat: 10,
    lon: 20,
    label: "Place",
    sublabel: "",
    color: "#fff",
    icon: "ember",
    priority: 1,
    ref: { kind: "site", zone: ZONES[0]!, tier: 1 },
    ...over,
  });
  const colony = (name: string) => ({ name }) as never;

  test("every marker lands in exactly one group; alliance colonies leave the plain list", () => {
    // Mirrors buildGlobeMarkers: your sub colonies fly the ALLIANCE layer
    // (the shield), allied members too; the plain colonies loop repeats
    // allied keys, and the grouper dedupes them into Alliance.
    const markers = [
      mk({ id: "home", layer: "home", ref: { kind: "home" } }),
      mk({ id: "ally", layer: "alliance", ref: { kind: "colony", colony: colony("Ally"), key: "ally" } }),
      mk({ id: "ally-dup", layer: "colonies", ref: { kind: "colony", colony: colony("Ally"), key: "ally" } }),
      mk({ id: "foe", layer: "colonies", ref: { kind: "colony", colony: colony("Foe"), key: "foe" } }),
      mk({ id: "site", layer: "sites" }),
      mk({ id: "heart", layer: "chorus", ref: { kind: "chorus", site: {} as never } }),
      mk({ id: "bh", layer: "beachhead", ref: { kind: "beachhead" } }),
      mk({ id: "arena", layer: "arena", ref: { kind: "arena" } }),
      mk({ id: "raid", layer: "raids", ref: { kind: "raid", raid: {} as never }, pulse: true }),
      mk({ id: "husk", layer: "husks", ref: { kind: "colony", colony: colony("Dead"), key: "dead" } }),
      mk({ id: "mem", layer: "memorials", ref: { kind: "memorial", nodeId: "n1", name: "Plaque" } }),
      mk({ id: "sat", layer: "satellites", ref: { kind: "satellite", zoneId: "z", zoneName: "Z" } }),
    ];
    const groups = globeIndexGroups(markers);
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.markers.map((m) => m.id)]));
    expect(byId.yours).toEqual(["home"]);
    expect(byId.alliance).toEqual(["ally"]);
    expect(byId.colonies).toEqual(["foe"]);
    expect(byId.sites).toEqual(["site"]);
    expect(byId.chorus).toEqual(["heart"]);
    expect(byId.places).toEqual(["bh", "arena"]);
    expect(byId.raids).toEqual(["raid"]);
    expect(byId.memorials).toEqual(["husk", "mem"]);
    expect(byId.satellites).toEqual(["sat"]);
    const total = groups.reduce((n, g) => n + g.markers.length, 0);
    expect(total).toBe(markers.length - 1); // the one duplicate colony, deduped
  });

  test("empty groups are omitted — the directory never shows hollow headings", () => {
    const groups = globeIndexGroups([mk({ id: "only-site" })]);
    expect(groups.map((g) => g.id)).toEqual(["sites"]);
  });
});

describe("beachhead presence — the anti-dinky-flag floor", () => {
  test("glyphs: 14px floor at fit, never over the 48px structure cap", () => {
    expect(BUNKER_GLYPH_FLOOR_PX).toBe(14);
    expect(BUNKER_GLYPH_CAP_PX).toBe(48);
    expect(bunkerGlyphSize(1)).toBe(14);
    for (const ratio of [0.5, 1, 1.9, 2, 4, 6, 10, 14]) {
      const g = bunkerGlyphSize(ratio);
      expect(g >= BUNKER_GLYPH_FLOOR_PX).toBe(true);
      expect(g <= BUNKER_GLYPH_CAP_PX).toBe(true);
    }
  });

  test("standards: Band 1 leaders fly 56–88px; Bands 2–3 never under the 24px flag ban", () => {
    expect(STANDARD_MIN_PX).toBe(24);
    expect(SECTOR_STANDARD_MIN_PX).toBe(56);
    expect(SECTOR_STANDARD_MAX_PX).toBe(88);
    for (const ratio of [1, 1.4, 1.9]) {
      const leader = standardHeight(ratio, bunkerGlyphSize(ratio), true);
      expect(leader >= SECTOR_STANDARD_MIN_PX).toBe(true);
      expect(leader <= SECTOR_STANDARD_MAX_PX).toBe(true);
      // Band 1 raises standards only for sector leaders — by design.
      expect(standardHeight(ratio, bunkerGlyphSize(ratio), false)).toBe(0);
    }
    for (const ratio of [2, 3.5, 6, 9, 14]) {
      const h = standardHeight(ratio, bunkerGlyphSize(ratio), false);
      expect(h >= STANDARD_MIN_PX).toBe(true);
      expect(h <= 40).toBe(true);
    }
  });

  test("bands read off the zoom ratio; holder colors are stable and varied", () => {
    expect(presenceBand(1)).toBe(1);
    expect(presenceBand(1.99)).toBe(1);
    expect(presenceBand(2)).toBe(2);
    expect(presenceBand(5.99)).toBe(2);
    expect(presenceBand(6)).toBe(3);
    const colors = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(holderColor));
    expect(colors.size).toBeGreaterThan(3);
    expect(holderColor("colony-7")).toBe(holderColor("colony-7"));
  });
});

describe("globe build — source locks", () => {
  test("the pad is mounted at the globe sheet and the circuit node sheet; play wires both doors", () => {
    const globe = src("components/WorldGlobe.tsx");
    expect(globe.includes("<SiteLaunchPad")).toBe(true);
    expect(globe.includes("bakeBeachheadStrongholdSprite")).toBe(true); // arena-scale stronghold, not a chip
    expect(globe.includes("<GlobeIndex")).toBe(true);
    const circuit = src("components/CircuitPage.tsx");
    expect(circuit.includes("<SiteLaunchPad")).toBe(true);
    expect(circuit.includes("CircuitAlertStrip")).toBe(true);
    expect(circuit.includes("RaidDefendButton")).toBe(true);
    const play = src("routes/play.tsx");
    expect(play.includes("onLaunchSite=")).toBe(true);
    expect(play.includes("onLaunchExpedition=")).toBe(true);
    expect(play.includes("onRespondToRaid=")).toBe(true);
    expect(play.includes("subscribeGlobeFocus")).toBe(true);
  });

  test("chat chips and the klaxon: tap-to-fly wired, siren follows the mute", () => {
    const row = src("components/chat/MessageRow.tsx");
    expect(row.includes("splitCoordSegments")).toBe(true);
    expect(row.includes("requestGlobeFocus")).toBe(true);
    const overlay = src("components/RaidAlarmOverlay.tsx");
    expect(overlay.includes("onMuteChange")).toBe(true);
    expect(overlay.includes("sirenStart")).toBe(true);
    expect(overlay.includes("sirenStop")).toBe(true);
  });
});
