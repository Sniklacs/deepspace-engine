// Tests for the world map view's pure logic (components/WorldMapView.tsx) —
// design/abandoned-colonies-world-map.md §2. Run: bun test site/src/components/WorldMapView.test.ts
import { describe, expect, test } from "bun:test";
import { abandonCountdownText, sortColonies, statusColor, toggleAccordion } from "./WorldMapView";
import { colonyMarkerName, type KnownColony } from "../game/worldmap";

const NOW = 1_700_000_000_000;

function colony(over: Partial<KnownColony> & { ownerName: string }): KnownColony {
  return {
    id: "c1",
    serverId: "s1",
    race: "grays",
    status: "active",
    lastScouted: NOW,
    ...over,
  };
}

describe("statusColor", () => {
  test("active is green", () => {
    expect(statusColor("active")).toBe("#34d399");
  });
  test("abandoned is amber", () => {
    expect(statusColor("abandoned")).toBe("#fbbf24");
  });
  test("husk is gray", () => {
    expect(statusColor("husk")).toBe("#6b7280");
  });
});

describe("colonyMarkerName", () => {
  test("possessive owner name", () => {
    expect(colonyMarkerName("Hans")).toBe("Hans's Colony");
  });
  test("multi-word owner name", () => {
    expect(colonyMarkerName("Mira Solenne")).toBe("Mira Solenne's Colony");
  });
});

describe("sortColonies", () => {
  test("abandoned first, then active, then husk", () => {
    const input = [
      colony({ ownerName: "Husk Guy", status: "husk" }),
      colony({ ownerName: "Active Gal", status: "active" }),
      colony({ ownerName: "Abandoned Al", status: "abandoned" }),
    ];
    const sorted = sortColonies(input);
    expect(sorted.map((c) => c.status)).toEqual(["abandoned", "active", "husk"]);
  });
  test("alphabetical within the same status", () => {
    const input = [
      colony({ ownerName: "Zed", status: "abandoned" }),
      colony({ ownerName: "Amy", status: "abandoned" }),
    ];
    const sorted = sortColonies(input);
    expect(sorted.map((c) => c.ownerName)).toEqual(["Amy", "Zed"]);
  });
  test("does not mutate the input", () => {
    const input = [colony({ ownerName: "B", status: "active" }), colony({ ownerName: "A", status: "abandoned" })];
    sortColonies(input);
    expect(input[0].ownerName).toBe("B");
  });
});

describe("abandonCountdownText", () => {
  test("days and hours", () => {
    expect(abandonCountdownText(2 * 86_400_000 + 5 * 3_600_000)).toBe("2d 5h");
  });
  test("hours and minutes under a day", () => {
    expect(abandonCountdownText(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
  });
  test("minutes only", () => {
    expect(abandonCountdownText(45 * 60_000)).toBe("45m");
  });
  test("zero or negative clamps", () => {
    expect(abandonCountdownText(0)).toBe("0");
    expect(abandonCountdownText(-1000)).toBe("0");
  });
});

describe("toggleAccordion", () => {
  test("tapping a closed row opens its action box", () => {
    expect(toggleAccordion(null, "s1:c1")).toBe("s1:c1");
  });
  test("tapping the open row collapses it", () => {
    expect(toggleAccordion("s1:c1", "s1:c1")).toBe(null);
  });
  test("tapping a different row switches — the first collapses (single-open)", () => {
    expect(toggleAccordion("s1:c1", "s1:c2")).toBe("s1:c2");
  });
  test("opening from empty then switching twice lands on the last tapped", () => {
    let open: string | null = null;
    open = toggleAccordion(open, "s1:a");
    open = toggleAccordion(open, "s1:b");
    open = toggleAccordion(open, "s1:c");
    expect(open).toBe("s1:c");
  });
});
