/**
 * MATERIAL EXPLANATIONS — coverage lock (owner 2026-10-14).
 *
 * Every material a player can hold MUST explain itself: a complete
 * what / does / how in RESOURCE_TIPS, an icon, and a name — because the
 * explanation box (components/MaterialSheet.tsx) renders straight from
 * these tables, and a missing entry would render nothing at all. When a
 * new resource lands in types.ts, add its id here and write its copy —
 * this test is the reminder that cannot be forgotten.
 */
import { describe, expect, test } from "bun:test";
import { RESOURCE_TIPS } from "./tooltips";
import { MATERIAL_ICONS, MATERIAL_NAMES } from "../components/MaterialSheet";
import type { MaterialSheetId } from "./material-sheet";

/** every key of state.resources (types.ts) + the two knowledge currencies */
const ALL_MATERIAL_IDS: MaterialSheetId[] = [
  "supplies",
  "embers",
  "chipsets",
  "warplate",
  "plasma",
  "mats",
  "alloy", // state.resources.alloys — the registry's name for it
  "hazmat",
  "shots",
  "medkit",
  "mechkit",
  "armorkit",
  "skmech",
  "gas",
  "battery",
  "insight",
  "codices",
];

describe("material explanations cover every material", () => {
  test("every material has a complete what/does/how in the registry", () => {
    for (const id of ALL_MATERIAL_IDS) {
      const block = RESOURCE_TIPS[id];
      if (!block) throw new Error(`RESOURCE_TIPS.${id} is missing`);
      expect(block.what.length).toBeGreaterThan(10);
      expect(block.does.length).toBeGreaterThan(10);
      expect(block.how.length).toBeGreaterThan(10);
    }
  });

  test("every material has an icon and a display name for the sheet", () => {
    for (const id of ALL_MATERIAL_IDS) {
      if (!MATERIAL_ICONS[id]) throw new Error(`no icon for ${id}`);
      expect(MATERIAL_NAMES[id]?.length ?? 0).toBeGreaterThan(2);
    }
  });
});
