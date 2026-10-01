// 2026-10-01 supply economy: 10,000 starting supplies + daily devotion supply bonus.
// Owner direction — regression tests for the founding stockpile and the login boost.
import { describe, expect, test } from "bun:test";
import { advance, blankColony, newGame, STARTING_SUPPLIES } from "./engine";
import { claimDaily, DAILY_CONFIG } from "./daily";

describe("starting supplies", () => {
  test("new colony starts with exactly 10,000 supplies", () => {
    const s = newGame("Test", "grays", Date.now());
    expect(s.resources.supplies).toBe(10000);
    expect(s.resources.supplies).toBe(STARTING_SUPPLIES);
  });

  test("legacy 60-supply colony gets one-time top-up on advance", () => {
    const s = newGame("Test", "grays", Date.now());
    // simulate a pre-change save: low supplies, no flag
    s.resources.supplies = 60;
    delete (s as any).startingSuppliesGranted;
    advance(s, Date.now() + 60_000);
    // topped up to the founding stockpile (plus a minute of passive income)
    expect(s.resources.supplies > 10000 || s.resources.supplies === 10000).toBe(true);
    expect((s as any).startingSuppliesGranted).toBe(true);
    // second advance after spending: no re-grant
    s.resources.supplies = 9900; // spend some
    advance(s, Date.now() + 120_000);
    expect(s.resources.supplies).toBeLessThan(10000);
  });

  test("colony already above 10,000 is not reduced", () => {
    const s = newGame("Test", "grays", Date.now());
    s.resources.supplies = 25000;
    delete (s as any).startingSuppliesGranted;
    advance(s, Date.now() + 60_000);
    expect(s.resources.supplies >= 25000).toBe(true);
  });

  test("blank colony stays at zero", () => {
    const s = blankColony(Date.now());
    advance(s, Date.now() + 60_000);
    expect(s.resources.supplies).toBe(0);
  });
});

describe("daily supply bonus", () => {
  test("a cleared day's claim pays 2,000 supplies, idempotent", () => {
    const now = Date.now();
    const s = newGame("Test", "grays", now);
    advance(s, now + 1000); // sweep the daily list (the real flow advances first)
    const d = s.daily!;
    expect(d.list.length).toBeGreaterThan(0);
    // complete the whole list
    d.completed = [...d.list];
    const before = s.resources.supplies;
    const r1 = claimDaily(s, now);
    expect(r1.ok).toBe(true);
    const expected = d.list.length * DAILY_CONFIG.suppliesPerItem + DAILY_CONFIG.bonusSupplies;
    expect(expected).toBe(2000);
    expect(r1.granted!.supplies).toBe(expected);
    expect(s.resources.supplies).toBe(before + expected);
    // re-claim: nothing more
    const r2 = claimDaily(s, now);
    expect(r2.granted!.supplies).toBe(0);
    expect(s.resources.supplies).toBe(before + expected);
  });
});
