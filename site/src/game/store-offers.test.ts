// Tests for the store offers (game/store-offers.ts) — owner direction
// 2026-10-12: daily specials + war bundles + the extraction deal.
// The locked rules, asserted:
//   1. Rotation is a pure function of the UTC day: same day → same three
//      specials (for every player), exactly 3, no duplicates, all from the
//      pool; across a month of days the whole pool surfaces.
//   2. Rotation turns at the UTC dawn (msUntilNextUtcDay).
//   3. Purchases spend Votives through the ledger and grant contents; a
//      retried event can never double-spend or double-grant.
//   4. A daily special is claimable once per player per day — and only
//      while it is on today's board (server clock rules).
//   5. War bundles are repeatable and priced below their standalone sum;
//      the daily featured price undercuts the shelf price.
//   6. The extraction deal: passes/expedites are held counts; the recovery
//      consume hooks burn exactly one, idempotently, and refuse at zero.
//   7. Doctrine: no catalog entry grants a person — grants are goods only,
//      and the fairness assert passes over the whole catalog.
// Run: bun test site/src/game/store-offers.test.ts
import { describe, expect, test } from "bun:test";
import { newGame } from "./engine";
import { grantCurrency, utcDayKey } from "./monetization";
import {
  DAILY_SPECIAL_POOL,
  DAILY_SPECIALS_PER_DAY,
  EXTRACTION_CONTRACT,
  RECOVERY_EXPEDITE,
  WAR_BUNDLES,
  WAR_BUNDLE_BY_ID,
  assertStoreOffersFair,
  bundleSeparateVotives,
  consumeExtractionPass,
  consumeRecoveryExpedite,
  dailySpecials,
  dailySpecialsForDay,
  ensureStoreOffers,
  extractionPassesHeld,
  grantsSeparateVotives,
  msUntilNextUtcDay,
  purchaseDailySpecial,
  purchaseExtractionPass,
  purchaseRecoveryExpedite,
  purchaseWarBundle,
  recoveryExpeditesHeld,
} from "./store-offers";
import type { GameState } from "./types";

const DAY = 24 * 60 * 60 * 1000;
// A fixed Monday noon UTC — deterministic "now" for purchase tests.
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

function richState(votives = 100000): GameState {
  const s = newGame("StoreTester", "draconians", NOW);
  grantCurrency(s, "votives", votives, "test-seed", "test seed", NOW, "grant");
  return s;
}

describe("daily rotation determinism", () => {
  test("same day key → identical specials, twice computed", () => {
    const a = dailySpecialsForDay("2026-10-12");
    const b = dailySpecialsForDay("2026-10-12");
    expect(a.map((o) => o.specialId)).toEqual(b.map((o) => o.specialId));
    expect(a.map((o) => o.priceVotives)).toEqual(b.map((o) => o.priceVotives));
  });

  test("exactly the daily count, no duplicates, all from the pool", () => {
    const poolIds = new Set(DAILY_SPECIAL_POOL.map((d) => d.id));
    for (let i = 0; i < 14; i++) {
      const dayKey = utcDayKey(Date.UTC(2026, 9, 1) + i * DAY);
      const offers = dailySpecialsForDay(dayKey);
      expect(offers.length).toBe(DAILY_SPECIALS_PER_DAY);
      expect(new Set(offers.map((o) => o.specialId)).size).toBe(DAILY_SPECIALS_PER_DAY);
      for (const o of offers) expect(poolIds.has(o.specialId)).toBe(true);
    }
  });

  test("the board actually turns across days and covers the pool in a month", () => {
    const seen = new Set<string>();
    const boards = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const dayKey = utcDayKey(Date.UTC(2026, 9, 1) + i * DAY);
      const offers = dailySpecialsForDay(dayKey);
      boards.add(offers.map((o) => o.specialId).join(","));
      for (const o of offers) seen.add(o.specialId);
    }
    expect(boards.size).toBeGreaterThan(10); // not the same board every day
    expect(seen.size).toBe(DAILY_SPECIAL_POOL.length); // everything surfaces
  });

  test("every offer is a real discount (price below standalone sum)", () => {
    for (let i = 0; i < 30; i++) {
      const dayKey = utcDayKey(Date.UTC(2026, 9, 1) + i * DAY);
      for (const o of dailySpecialsForDay(dayKey)) {
        expect(o.priceVotives).toBeGreaterThan(0);
        expect(o.priceVotives).toBeLessThan(o.separateVotives);
        expect(o.separateVotives).toBe(grantsSeparateVotives(o.grants));
      }
    }
  });

  test("msUntilNextUtcDay lands on the next UTC midnight", () => {
    const noon = Date.UTC(2026, 9, 12, 12, 0, 0);
    expect(msUntilNextUtcDay(noon)).toBe(12 * 60 * 60 * 1000);
    const justAfterMidnight = Date.UTC(2026, 9, 12, 0, 0, 1);
    expect(msUntilNextUtcDay(justAfterMidnight)).toBe(DAY - 1000);
    const { msLeft } = dailySpecials(noon);
    expect(msLeft).toBe(msUntilNextUtcDay(noon));
  });
});

describe("war bundles", () => {
  test("three tiers, each priced below its standalone sum, special below shelf", () => {
    expect(WAR_BUNDLES.map((b) => b.tier)).toEqual(["skirmish", "raid", "war"]);
    for (const b of WAR_BUNDLES) {
      const separate = bundleSeparateVotives(b);
      expect(b.priceVotives).toBeLessThan(separate);
      expect(b.specialPriceVotives).toBeLessThan(b.priceVotives);
    }
  });

  test("purchase spends Votives and lands every content line in stores", () => {
    const s = richState();
    const before = s.currency.votives;
    const bundle = WAR_BUNDLE_BY_ID["skirmish-crate"];
    const suppliesBefore = s.resources.supplies;
    const res = purchaseWarBundle(s, "skirmish-crate", "evt-bundle-1", NOW);
    expect(res.ok).toBe(true);
    expect(s.currency.votives).toBe(before - bundle.priceVotives);
    expect(s.resources.supplies).toBe(suppliesBefore + 120);
    expect(s.resources.gas > 23).toBe(true);
  });

  test("a retried purchase event never double-spends or double-grants", () => {
    const s = richState();
    const first = purchaseWarBundle(s, "raid-crate", "evt-bundle-retry", NOW);
    const vAfter = s.currency.votives;
    const suppliesAfter = s.resources.supplies;
    const second = purchaseWarBundle(s, "raid-crate", "evt-bundle-retry", NOW);
    expect(first.ok && second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(s.currency.votives).toBe(vAfter);
    expect(s.resources.supplies).toBe(suppliesAfter);
  });

  test("bundles are repeatable under fresh events", () => {
    const s = richState();
    expect(purchaseWarBundle(s, "skirmish-crate", "evt-r1", NOW).ok).toBe(true);
    expect(purchaseWarBundle(s, "skirmish-crate", "evt-r2", NOW).ok).toBe(true);
  });

  test("insufficient Votives refuses and grants nothing", () => {
    const s = richState(10);
    const suppliesBefore = s.resources.supplies;
    const res = purchaseWarBundle(s, "war-crate", "evt-poor", NOW);
    expect(res.ok).toBe(false);
    expect(s.resources.supplies).toBe(suppliesBefore);
    expect(s.currency.votives).toBe(10);
  });

  test("unknown bundle refuses", () => {
    const s = richState();
    expect(purchaseWarBundle(s, "nope-crate", "evt-x", NOW).ok).toBe(false);
  });
});

describe("daily special purchases", () => {
  test("claiming an on-board special spends its price and grants contents", () => {
    const s = richState();
    const { offers } = dailySpecials(NOW);
    const offer = offers[0];
    const before = s.currency.votives;
    const suppliesBefore = s.resources.supplies;
    const grantSupplies = offer.grants
      .filter((g) => g.kind === "resource" && g.key === "supplies")
      .reduce((n, g) => n + (g.kind === "resource" ? g.amount : 0), 0);
    const res = purchaseDailySpecial(s, offer.specialId, "evt-special-1", NOW);
    expect(res.ok).toBe(true);
    expect(s.currency.votives).toBe(before - offer.priceVotives);
    expect(s.resources.supplies).toBe(suppliesBefore + grantSupplies);
    expect(s.storeOffers?.dailyBuys[utcDayKey(NOW)]?.includes(offer.specialId)).toBe(true);
  });

  test("once per day: a second claim under a fresh event is refused", () => {
    const s = richState();
    const { offers } = dailySpecials(NOW);
    const offer = offers[0];
    expect(purchaseDailySpecial(s, offer.specialId, "evt-s1", NOW).ok).toBe(true);
    const again = purchaseDailySpecial(s, offer.specialId, "evt-s2", NOW);
    expect(again.ok).toBe(false);
  });

  test("a retry of the same claim event is idempotent, not a refusal", () => {
    const s = richState();
    const { offers } = dailySpecials(NOW);
    const offer = offers[1];
    expect(purchaseDailySpecial(s, offer.specialId, "evt-same", NOW).ok).toBe(true);
    const retry = purchaseDailySpecial(s, offer.specialId, "evt-same", NOW);
    expect(retry.ok).toBe(true);
    expect(retry.idempotent).toBe(true);
  });

  test("an off-board special cannot be bought", () => {
    const s = richState();
    const onBoard = new Set(dailySpecials(NOW).offers.map((o) => o.specialId));
    const offBoard = DAILY_SPECIAL_POOL.find((d) => !onBoard.has(d.id));
    expect(offBoard != null).toBe(true);
    const res = purchaseDailySpecial(s, offBoard!.id, "evt-off", NOW);
    expect(res.ok).toBe(false);
  });

  test("tomorrow the same special may be claimed again (if it is on the board)", () => {
    const s = richState();
    const today = dailySpecials(NOW).offers[0];
    expect(purchaseDailySpecial(s, today.specialId, "evt-day1", NOW).ok).toBe(true);
    // Find a later day whose board carries the same special, claim it there.
    let claimed = false;
    for (let i = 1; i < 30 && !claimed; i++) {
      const t = NOW + i * DAY;
      if (dailySpecials(t).offers.some((o) => o.specialId === today.specialId)) {
        expect(purchaseDailySpecial(s, today.specialId, `evt-day${i}`, t).ok).toBe(true);
        claimed = true;
      }
    }
    expect(claimed).toBe(true);
  });
});

describe("the extraction deal", () => {
  test("buying a contract and an expedite records held counts and spends", () => {
    const s = richState();
    const before = s.currency.votives;
    expect(purchaseExtractionPass(s, "evt-pass-1", NOW).ok).toBe(true);
    expect(purchaseRecoveryExpedite(s, "evt-exp-1", NOW).ok).toBe(true);
    expect(extractionPassesHeld(s)).toBe(1);
    expect(recoveryExpeditesHeld(s)).toBe(1);
    expect(s.currency.votives).toBe(before - EXTRACTION_CONTRACT.priceVotives - RECOVERY_EXPEDITE.priceVotives);
  });

  test("a retried buy event doesn't double-charge or double-hold", () => {
    const s = richState();
    purchaseExtractionPass(s, "evt-pass-retry", NOW);
    const retry = purchaseExtractionPass(s, "evt-pass-retry", NOW);
    expect(retry.idempotent).toBe(true);
    expect(extractionPassesHeld(s)).toBe(1);
  });

  test("consume hooks burn exactly one, idempotently, and refuse at zero", () => {
    const s = richState();
    expect(consumeExtractionPass(s, "evt-use-0", NOW).ok).toBe(false); // none held
    purchaseExtractionPass(s, "evt-pass-2", NOW);
    expect(consumeExtractionPass(s, "evt-use-1", NOW).ok).toBe(true);
    expect(extractionPassesHeld(s)).toBe(0);
    const retry = consumeExtractionPass(s, "evt-use-1", NOW);
    expect(retry.ok).toBe(true);
    expect(retry.idempotent).toBe(true);
    expect(consumeExtractionPass(s, "evt-use-2", NOW).ok).toBe(false); // spent

    purchaseRecoveryExpedite(s, "evt-exp-2", NOW);
    expect(consumeRecoveryExpedite(s, "evt-use-e1", NOW).ok).toBe(true);
    expect(recoveryExpeditesHeld(s)).toBe(0);
    expect(consumeRecoveryExpedite(s, "evt-use-e2", NOW).ok).toBe(false);
  });

  test("ensureStoreOffers migrates a bare state without wiping counts", () => {
    const bare = newGame("Bare", "grays", NOW);
    delete bare.storeOffers;
    const fresh = ensureStoreOffers(bare);
    expect(fresh).toEqual({ extractionPasses: 0, expediteCredits: 0, dailyBuys: {} });
    fresh.extractionPasses = 3;
    expect(ensureStoreOffers(bare).extractionPasses).toBe(3);
  });
});

describe("doctrine + fairness", () => {
  test("the catalog fairness assert passes", () => {
    let threw = false;
    try {
      assertStoreOffersFair();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("no grant anywhere in the catalog is a person or a non-goods kind", () => {
    // The grant vocabulary is goods-only by construction; assert it stays so:
    // every grant in bundles and goods specials is a resource line (the one
    // kind that can only ever be stores/fuel/kits).
    for (const b of WAR_BUNDLES) {
      for (const g of b.grants) expect(g.kind).toBe("resource");
    }
    for (const def of DAILY_SPECIAL_POOL) {
      if (def.kind === "goods") for (const g of def.grants) expect(g.kind).toBe("resource");
    }
  });

  test("the word for a person for sale appears nowhere in catalog copy", () => {
    const copy = [
      ...WAR_BUNDLES.map((b) => `${b.name} ${b.blurb}`),
      EXTRACTION_CONTRACT.name + EXTRACTION_CONTRACT.blurb,
      RECOVERY_EXPEDITE.name + RECOVERY_EXPEDITE.blurb,
    ].join(" ").toLowerCase();
    expect(/\bhero(es)?\b/.test(copy)).toBe(false);
    expect(/\bleader(s)? for sale\b/.test(copy)).toBe(false);
  });
});
