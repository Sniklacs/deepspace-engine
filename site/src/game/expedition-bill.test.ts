// THE BILL — launch-price disclosure (owner report 2026-10-16).
//
// The owner launched into the Hollow Warrens and ~6,000 📦 vanished with no
// surface ever quoting the amount: every launch surface priced a run at the
// OPERATIONS cost (suppliesCostForZone) while launchExpedition actually
// charges operations + the rung's entry demand + ordnance — the demand being
// the bulk on deep rungs, itemized only inside the insufficient-funds
// refusal. These tests pin the fix: the bill helper itemizes the engine's
// own numbers, its total IS runPrice on every zone, a real launch deducts
// exactly the bill, and play.tsx renders the bill at the points of decision
// (RiskModal block, Commit button total, zone cost chips) with no
// operations-only quote left standing.
// Run: bun test site/src/game/expedition-bill.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZONES, getZone, rungOfZone } from "./zones";
import {
  energyCapacity,
  launchExpedition,
  newGame,
  ORDNANCE_EMBERS_PER_UNIT,
  ORDNANCE_SUPPLIES_PER_UNIT,
  ordnanceUnitsForZone,
} from "./engine";
import { engineHelpers, expeditionBill } from "./client-utils";
import type { GameState } from "./types";

const NOW = 1_760_000_000_000;

/** A stocked colony that can actually field any run: step-out gear, convoy
 *  stores, deep pockets — so launchExpedition's gates all pass and only the
 *  price is under test. */
function stocked(supplies: number, developed = false): GameState {
  const s = newGame("Bill Test", "watchers", NOW);
  s.resources.supplies = supplies;
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
    // A grown colony earns far more per day — and the rung demand is priced
    // in that income, so this is where the demand dwarfs operations.
    s.deployedDomains.agriculture = 10;
    s.deployedDomains.economy = 10;
    s.deployedDomains.industry = 5;
    s.deployedDomains.logistics = 3;
  }
  return s;
}

describe("expedition bill — itemization", () => {
  test("every zone: the lines sum to the total, and the total IS runPrice", () => {
    for (const developed of [false, true]) {
      const state = stocked(10_000_000, developed);
      for (const zone of ZONES) {
        const bill = expeditionBill(state, zone);
        expect(bill.operations).toBe(engineHelpers.suppliesCost(state, zone));
        expect(bill.demand).toBe(engineHelpers.rungDemand(state, zone));
        expect(bill.ordnanceSupplies).toBe(ordnanceUnitsForZone(zone.id) * ORDNANCE_SUPPLIES_PER_UNIT);
        expect(bill.ordnanceEmbers).toBe(ordnanceUnitsForZone(zone.id) * ORDNANCE_EMBERS_PER_UNIT);
        expect(bill.operations + bill.demand + bill.ordnanceSupplies).toBe(bill.totalSupplies);
        expect(bill.totalSupplies).toBe(engineHelpers.runPrice(state, zone));
        expect(bill.energyDraw).toBe(engineHelpers.energyDraw(state, zone));
      }
    }
  });

  test("the owner's case: on a grown colony the Hollow Warrens demand dwarfs operations", () => {
    const state = stocked(10_000_000, true);
    const bill = expeditionBill(state, getZone("hollow-warrens"));
    expect(bill.demand).toBeGreaterThan(bill.operations);
    expect(bill.affordable).toBe(true);
    expect(bill.afterSupplies).toBe(bill.heldSupplies - bill.totalSupplies);
  });

  test("deep rungs draw ordnance in supplies AND Embers; shallow rungs draw none", () => {
    const state = stocked(10_000_000, true);
    const deepest = ZONES.reduce((a, b) => (rungOfZone(b.id) > rungOfZone(a.id) ? b : a));
    const deepBill = expeditionBill(state, deepest);
    expect(ordnanceUnitsForZone(deepest.id)).toBeGreaterThan(0);
    expect(deepBill.ordnanceSupplies).toBeGreaterThan(0);
    expect(deepBill.ordnanceEmbers).toBeGreaterThan(0);
    const shallowBill = expeditionBill(state, getZone("outer-ruins"));
    expect(shallowBill.ordnanceSupplies).toBe(0);
    expect(shallowBill.ordnanceEmbers).toBe(0);
  });

  test("affordability is the engine's own edge: one 📦 short refuses", () => {
    const zone = getZone("hollow-warrens");
    const total = expeditionBill(stocked(10_000_000, true), zone).totalSupplies;
    const short = expeditionBill(stocked(total - 1, true), zone);
    expect(short.affordable).toBe(false);
    expect(short.afterSupplies).toBe(-1);
    const exact = expeditionBill(stocked(total, true), zone);
    expect(exact.affordable).toBe(true);
    expect(exact.afterSupplies).toBe(0);
  });
});

describe("expedition bill — the engine charges exactly the quoted bill", () => {
  test("a real launch deducts the bill's supplies, Embers, and energy — nothing more", () => {
    for (const zoneId of ["outer-ruins", "hollow-warrens"]) {
      const state = stocked(10_000_000, true);
      const zone = getZone(zoneId);
      const bill = expeditionBill(state, zone);
      const suppliesBefore = state.resources.supplies;
      const embersBefore = state.resources.embers;
      const energyBefore = state.energy ?? energyCapacity(state);
      const res = launchExpedition(state, zone.id, 1, NOW);
      expect(res.ok).toBe(true);
      expect(suppliesBefore - state.resources.supplies).toBe(bill.totalSupplies);
      expect(embersBefore - state.resources.embers).toBe(bill.ordnanceEmbers);
      expect(energyBefore - (state.energy ?? energyCapacity(state))).toBe(bill.energyDraw);
    }
  });

  test("a launch the bill calls unaffordable is refused by the engine too", () => {
    const zone = getZone("hollow-warrens");
    const total = expeditionBill(stocked(10_000_000, true), zone).totalSupplies;
    const state = stocked(total - 1, true);
    expect(expeditionBill(state, zone).affordable).toBe(false);
    const res = launchExpedition(state, zone.id, 1, NOW);
    expect(res.ok).toBe(false);
    expect(res.error?.includes(`${total} 📦`)).toBe(true);
  });
});

describe("expedition bill — the surfaces render it (source lock)", () => {
  const play = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../routes/play.tsx"), "utf-8");

  test("the RiskModal renders the itemized bill block from the helper", () => {
    expect(play.includes("play.risk.billTitle")).toBe(true);
    expect(play.includes("play.risk.billDemandGloss")).toBe(true);
    expect(play.includes("play.risk.billHold")).toBe(true);
    expect(play.includes("engineHelpers.runBill(state, zone)")).toBe(true);
  });

  test("the Commit button carries the selected run's total", () => {
    expect(play.includes("play.exp.commitPrice")).toBe(true);
    expect(play.includes("selBill.totalSupplies")).toBe(true);
  });

  test("no launch surface in play.tsx still quotes the operations cost alone", () => {
    expect(play.includes("suppliesCost")).toBe(false);
    // the commit pre-check and every zone cost chip quote the full price
    expect(play.includes("engineHelpers.runPrice(state, zone)")).toBe(true);
    expect(play.includes("engineHelpers.runPrice(state, z)")).toBe(true);
  });
});
