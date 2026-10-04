// MODULES — unit tests (spec: design/modules-build.md).
import { describe, expect, test } from "bun:test";
import {
  MODULE_CONFIG,
  MODULE_LINES,
  MODULE_RECIPES,
  MARKET_CONFIG,
  STORE_MODULE_POLICY,
  craftModuleItem,
  getModuleRecipe,
  makeListing,
  marketFee,
  marketListingExpired,
  marketSellerProceeds,
  moduleBroken,
  moduleConditionLabel,
  moduleCraftScripValue,
  moduleDisplayName,
  moduleLine,
  moduleMeltRefund,
  moduleStatsFor,
  moduleTierForIndustry,
  seizableModules,
  storeModuleAllowed,
  storeModuleMinPrice,
  tickModuleBattle,
  tickModuleIdle,
  transferModule,
  validateListing,
  type ModuleItem,
} from "./modules";
import { weightedPower } from "./forge";

function testModule(over: Partial<ModuleItem> = {}): ModuleItem {
  const recipe = getModuleRecipe("siege-coil")!;
  return craftModuleItem({
    recipe,
    tier: 2,
    race: null,
    ownerId: "acct-1",
    ownerName: "Hans",
    gameId: "g1",
    seq: 7,
    now: 1_000_000,
    ...{},
  }) as ModuleItem && {
    ...craftModuleItem({ recipe, tier: 2, race: null, ownerId: "acct-1", ownerName: "Hans", gameId: "g1", seq: 7, now: 1_000_000 }),
    ...over,
  };
}

describe("the commodity contract", () => {
  test("four lines, four tiers — the table is the single source of truth", () => {
    expect(MODULE_LINES.map((l) => l.id)).toEqual(["siege-coil", "aegis-plate", "warden-mesh", "striker-rig"]);
    expect(MODULE_RECIPES.map((r) => r.id)).toEqual(["siege-coil", "aegis-plate", "warden-mesh", "striker-rig"]);
  });

  test("same (line, tier) → byte-identical stats (no rolls, no grades)", () => {
    for (const line of MODULE_LINES) {
      for (const tier of [1, 2, 3, 4] as const) {
        const a = moduleStatsFor(line.id, tier, 10_000);
        const b = moduleStatsFor(line.id, tier, 10_000);
        expect(a).toEqual(b);
      }
    }
  });

  test("profiles: coil = pure power, plate = pure guard, hybrids mix", () => {
    const coil = moduleStatsFor("siege-coil", 4, 10_000);
    expect(coil.power).toBeGreaterThan(0);
    expect(coil.guard).toBe(0);
    const plate = moduleStatsFor("aegis-plate", 4, 10_000);
    expect(plate.guard).toBeGreaterThan(0);
    expect(plate.power).toBe(0);
    const mesh = moduleStatsFor("warden-mesh", 4, 10_000);
    expect(mesh.guard).toBeGreaterThan(mesh.power);
    expect(mesh.power).toBeGreaterThan(0);
    const rig = moduleStatsFor("striker-rig", 4, 10_000);
    expect(rig.power).toBeGreaterThan(rig.guard);
    expect(rig.guard).toBeGreaterThan(0);
  });

  test("v1 lines use only power/guard — no precision/logistics", () => {
    for (const line of MODULE_LINES) {
      const s = moduleStatsFor(line.id, 3, 10_000);
      expect(s.precision).toBe(0);
      expect(s.logistics).toBe(0);
    }
  });

  test("tier-4 single-axis stays well under the makeshift forge band (0.45 of ceiling)", () => {
    // spec §1.3: modules supplement a hero, never replace the weapon
    const coil = moduleStatsFor("siege-coil", 4, 10_000);
    expect(coil.power).toBeLessThan(0.45 * 10_000);
  });

  test("module power is priced by the same formula as forge weapons", () => {
    const s = moduleStatsFor("striker-rig", 2, 10_000);
    expect(weightedPower(s)).toBeGreaterThan(0);
  });

  test("names are generated, never player-set", () => {
    expect(moduleDisplayName("siege-coil", 1)).toBe("Siege Coil Mk I");
    expect(moduleDisplayName("warden-mesh", 4)).toBe("Warden Mesh Mk IV");
  });

  test("unknown line falls back to the first line", () => {
    expect(moduleLine("nope").id).toBe("siege-coil");
  });
});

describe("crafting — deterministic", () => {
  test("tier = min(4, industry level): no roll, no floor, no weights", () => {
    expect(moduleTierForIndustry(1)).toBe(1);
    expect(moduleTierForIndustry(2)).toBe(2);
    expect(moduleTierForIndustry(3)).toBe(3);
    expect(moduleTierForIndustry(9)).toBe(4);
    expect(moduleTierForIndustry(0)).toBe(1);
  });

  test("craft materializes a complete item at condition 100", () => {
    const m = testModule();
    expect(m.id).toMatch(/^md-/);
    expect(m.line).toBe("siege-coil");
    expect(m.tier).toBe(2);
    expect(m.condition).toBe(100);
    expect(m.equippedBy).toBeNull();
    expect(m.listedId).toBeNull();
    expect(m.power).toBe(weightedPower(m.stats));
    expect(m.provenance.seq).toBe(7);
  });

  test("craft records what it spent (melt-back reads this)", () => {
    const m = testModule({ tier: 3 });
    // note: testModule always crafts tier 2; override via explicit craft
    const m3 = craftModuleItem({
      recipe: getModuleRecipe("striker-rig")!,
      tier: 3,
      race: null,
      ownerId: "a",
      ownerName: "b",
      gameId: null,
      seq: 1,
      now: 5,
    });
    expect(m3.warplateSpent).toBe(7);
    expect(m3.suppliesSpent).toBe(200);
    expect(m3.embersSpent).toBe(55);
    expect(m.line).toBe("siege-coil");
  });

  test("unlock gates: basics at industry 1, hybrids at industry 2", () => {
    expect(getModuleRecipe("siege-coil")!.unlock.level).toBe(1);
    expect(getModuleRecipe("aegis-plate")!.unlock.level).toBe(1);
    expect(getModuleRecipe("warden-mesh")!.unlock.level).toBe(2);
    expect(getModuleRecipe("striker-rig")!.unlock.level).toBe(2);
  });
});

describe("deterioration — the replacement loop", () => {
  test("broken is derived from condition, never stored", () => {
    expect(moduleBroken({ condition: 0 })).toBe(true);
    expect(moduleBroken({ condition: 1 })).toBe(false);
  });

  test("battle tick: −5 per battle while equipped; unequipped modules immune", () => {
    const worn = testModule({ equippedBy: { kind: "hero", id: "h1", slot: "module1" } });
    tickModuleBattle(worn);
    expect(worn.condition).toBe(95);
    const racked = testModule();
    tickModuleBattle(racked);
    expect(racked.condition).toBe(100);
  });

  test("~20 battles of frontline life", () => {
    const worn = testModule({ equippedBy: { kind: "hero", id: "h1", slot: "module1" } });
    for (let i = 0; i < 19; i++) tickModuleBattle(worn);
    expect(worn.condition).toBe(5);
    expect(moduleBroken(worn)).toBe(false);
    tickModuleBattle(worn);
    expect(worn.condition).toBe(0);
    expect(moduleBroken(worn)).toBe(true);
  });

  test("idle tick: −1 per 24h while equipped; racked modules immortal", () => {
    const now = 1_000_000;
    const worn = testModule({
      equippedBy: { kind: "hero", id: "h1", slot: "module1" },
      lastIdleTickAt: now - 3 * 86_400_000,
    });
    tickModuleIdle(worn, now);
    expect(worn.condition).toBe(97);
    const racked = testModule({ lastIdleTickAt: now - 30 * 86_400_000 });
    tickModuleIdle(racked, now);
    expect(racked.condition).toBe(100);
  });

  test("condition labels: worn ≤20, failing ≤5, broken at 0", () => {
    expect(moduleConditionLabel(100)).toBe("fine");
    expect(moduleConditionLabel(21)).toBe("fine");
    expect(moduleConditionLabel(20)).toBe("worn");
    expect(moduleConditionLabel(6)).toBe("worn");
    expect(moduleConditionLabel(5)).toBe("failing");
    expect(moduleConditionLabel(1)).toBe("failing");
    expect(moduleConditionLabel(0)).toBe("broken");
  });
});

describe("melt-down — the scrap loop", () => {
  test("normal refund: warplate scaled by tier, quarter of supplies", () => {
    const m = testModule(); // tier 2: spent 4 warplate, 110 supplies
    const r = moduleMeltRefund(m);
    // 0.5 × 4 × (0.8 + 0.4) = 2.4 → 2
    expect(r.warplate).toBe(2);
    expect(r.supplies).toBe(Math.round(110 * 0.25));
  });

  test("broken modules melt for 25% of the normal refund", () => {
    const whole = moduleMeltRefund(testModule());
    const broken = moduleMeltRefund(testModule({ condition: 0 }));
    expect(broken.warplate).toBe(Math.max(1, Math.round(whole.warplate * 0.25)));
    expect(broken.supplies).toBe(Math.round(whole.supplies * 0.25));
  });

  test("melt never returns zero warplate", () => {
    const r = moduleMeltRefund(testModule({ condition: 0, warplateSpent: 2, tier: 1 }));
    expect(r.warplate >= 1).toBe(true);
  });
});

describe("loot seams — cargo-only", () => {
  test("only field modules in cargo are seizable; equipped ones are destroyed not looted", () => {
    const field = testModule({ location: "field" });
    const equipped = testModule({ location: "field", equippedBy: { kind: "hero", id: "h", slot: "module1" } });
    const racked = testModule({ location: "cradle" });
    const out = seizableModules([field, equipped, racked]);
    expect(out.map((m) => m.id)).toEqual([field.id]);
  });

  test("transfer moves the same identity, resets to stores, strips equip+listing", () => {
    const m = testModule({
      equippedBy: { kind: "hero", id: "h", slot: "module1" },
      listedId: "mk-x",
      location: "field",
    });
    const t = transferModule(m, "acct-2", "Rae", 999);
    expect(t.id).toBe(m.id);
    expect(t.ownerId).toBe("acct-2");
    expect(t.location).toBe("cradle");
    expect(t.equippedBy).toBeNull();
    expect(t.listedId).toBeNull();
  });
});

describe("the market", () => {
  test("5% fee destroyed on sale; seller keeps 95%", () => {
    expect(marketFee(1000)).toBe(50);
    expect(marketSellerProceeds(1000)).toBe(950);
    expect(marketFee(99)).toBe(4); // floors
  });

  test("listings expire after 7 days", () => {
    const l = makeListing({ item: testModule(), sellerId: "a", sellerName: "A", price: 500, now: 1_000_000 });
    expect(l.expiresAt).toBe(1_000_000 + 7 * 86_400_000);
    expect(marketListingExpired(l, 1_000_000 + 7 * 86_400_000)).toBe(true);
    expect(marketListingExpired(l, 1_000_000 + 7 * 86_400_000 - 1)).toBe(false);
  });

  test("validation: broken/equipped/listed/non-rack modules rejected", () => {
    const good = testModule();
    expect(validateListing(good, 500, 0)).toBeNull();
    expect(validateListing(testModule({ condition: 0 }), 500, 0)).toMatch(/Broken/);
    expect(validateListing(testModule({ equippedBy: { kind: "hero", id: "h", slot: "module1" } }), 500, 0)).toMatch(/worn/);
    expect(validateListing(testModule({ location: "field" }), 500, 0)).toMatch(/racks/);
    expect(validateListing(testModule({ listedId: "mk-x" }), 500, 0)).toMatch(/already listed/);
    expect(validateListing(good, 0, 0)).toMatch(/at least 1/);
    expect(validateListing(good, 500, MARKET_CONFIG.maxListings)).toMatch(/live listings/);
  });

  test("listing snapshots the commodity — line, tier, stats, condition", () => {
    const m = testModule({ condition: 73 });
    const l = makeListing({ item: m, sellerId: "a", sellerName: "A", price: 500, now: 1 });
    expect(l.moduleId).toBe(m.id);
    expect(l.line).toBe(m.line);
    expect(l.tier).toBe(m.tier);
    expect(l.condition).toBe(73);
    expect(l.stats).toEqual(m.stats);
  });
});

describe("the store boundary", () => {
  test("v1 store: Mk I–II of the two basic lines only", () => {
    expect(storeModuleAllowed("siege-coil", 1)).toBe(true);
    expect(storeModuleAllowed("siege-coil", 2)).toBe(true);
    expect(storeModuleAllowed("aegis-plate", 2)).toBe(true);
    expect(storeModuleAllowed("siege-coil", 3)).toBe(false);
    expect(storeModuleAllowed("warden-mesh", 1)).toBe(false);
    expect(storeModuleAllowed("striker-rig", 2)).toBe(false);
  });

  test("store price floor ≥ 150% of craft cost", () => {
    const floor = storeModuleMinPrice("siege-coil", 1);
    const craft = moduleCraftScripValue("siege-coil", 1);
    expect(floor).toBe(Math.ceil(craft * STORE_MODULE_POLICY.minPriceVsCraft));
    expect(floor).toBeGreaterThan(craft);
  });
});

describe("config sanity", () => {
  test("battle decay × 20 battles ≈ full life", () => {
    expect(MODULE_CONFIG.battleDecay * 20).toBe(100);
  });
  test("rack bound exists", () => {
    expect(MODULE_CONFIG.maxModules).toBe(48);
  });
});
