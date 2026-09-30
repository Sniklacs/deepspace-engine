// Tests for the cross-account alliance transaction layer
// (site/src/game/alliance-transact.ts): colony lookup, per-account
// serialization, request-scope nesting, outbox durability, and idempotent fx
// delivery — all against an in-memory ColonyStore (no disk, no network).
// Run: bun test src/game/alliance-transact.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
  applyAllianceFx,
  clearColonyAccountCache,
  commitOutbox,
  evictColonyAccount,
  findColonyAccountId,
  gameStateFor,
  runWithAccountSaves,
  transactColony,
  withAccountLock,
  ColonyNotFoundError,
  type ColonyStore,
} from "./alliance-transact";
import type { AccountSaves } from "./store";
import type { GameState } from "./types";
import { drainAllianceFx, guestsAt, queueAllianceFx } from "./war/alliances";
import type { AllianceFx } from "./war/alliances";

const NOW = 1_800_000_000_000;

function fakeState(gameId: string): GameState {
  return {
    gameId,
    seasonId: "s1",
    resources: { supplies: 1000 },
    leaders: [],
    techsResearched: [],
    lastTick: 0,
    log: [],
    allianceFx: [],
    battles: [],
    deployedDomains: {},
    studies: [],
    expeditions: [],
    researchJobs: [],
  } as unknown as GameState;
}

interface MemStore extends ColonyStore {
  data: Map<string, AccountSaves>;
  writes: string[];
}

/** In-memory ColonyStore that deep-clones on load, like a real disk read. */
function memStore(): MemStore {
  const data = new Map<string, AccountSaves>();
  const writes: string[] = [];
  return {
    data,
    writes,
    async loadAccountSaves(accountId) {
      const s = data.get(accountId);
      return s ? (structuredClone(s) as AccountSaves) : null;
    },
    async saveAccountSaves(accountId, saves) {
      writes.push(accountId);
      data.set(accountId, structuredClone(saves) as AccountSaves);
    },
    async loadAllSaves() {
      return [...data.entries()].map(([accountId, saves]) => ({ accountId, saves }));
    },
  };
}

function savesWith(colonies: { gameId: string; mapKey?: string }[]): AccountSaves {
  const games: Record<string, GameState> = {};
  for (const c of colonies) games[c.mapKey ?? c.gameId] = fakeState(c.gameId);
  const first = colonies[0];
  return { version: 2, activeGameId: first ? (first.mapKey ?? first.gameId) : null, games };
}

function mirrorFx(colonyId: string, id: string): AllianceFx {
  return {
    kind: "create-guest-mirror",
    colonyId,
    mirror: {
      id,
      fromColonyId: "col-a",
      fromColonyName: "Alpha",
      weight: 10,
      troopsByType: { bulwark: 10, reaver: 0, longeye: 0, thunder: 0, warden: 0 },
      heroes: [],
      sentAt: NOW,
    },
  };
}

beforeEach(() => {
  clearColonyAccountCache();
});

describe("gameStateFor", () => {
  test("finds a colony by its map key", () => {
    const saves = savesWith([{ gameId: "col-a" }]);
    expect(gameStateFor(saves, "col-a")?.gameId).toBe("col-a");
  });

  test("finds a colony by state.gameId when the map key differs", () => {
    const saves = savesWith([{ gameId: "col-a", mapKey: "slot-0" }]);
    expect(gameStateFor(saves, "col-a")?.gameId).toBe("col-a");
  });

  test("returns undefined for an unknown colony", () => {
    const saves = savesWith([{ gameId: "col-a" }]);
    expect(gameStateFor(saves, "col-x")).toBeUndefined();
  });
});

describe("findColonyAccountId", () => {
  test("resolves an account by map key and by state.gameId", async () => {
    const store = memStore();
    store.data.set("acct-a", savesWith([{ gameId: "col-a" }]));
    store.data.set("acct-b", savesWith([{ gameId: "col-b", mapKey: "0" }]));
    expect(await findColonyAccountId("col-a", store)).toBe("acct-a");
    expect(await findColonyAccountId("col-b", store)).toBe("acct-b");
    expect(await findColonyAccountId("col-x", store)).toBeNull();
  });

  test("a stale positive cache hit is evicted on demand", async () => {
    const store = memStore();
    store.data.set("acct-a", savesWith([{ gameId: "col-a" }]));
    expect(await findColonyAccountId("col-a", store)).toBe("acct-a");
    // The colony moves accounts (restore, migration, whatever): the cache
    // still points at the old account until evicted.
    store.data.set("acct-a", savesWith([]));
    store.data.set("acct-b", savesWith([{ gameId: "col-a" }]));
    expect(await findColonyAccountId("col-a", store)).toBe("acct-a"); // stale
    evictColonyAccount("col-a");
    expect(await findColonyAccountId("col-a", store)).toBe("acct-b");
  });
});

describe("transactColony", () => {
  test("explicit local saves mutate in place without touching the store", async () => {
    const store = memStore();
    const saves = savesWith([{ gameId: "col-a" }]);
    const v = await transactColony(
      "col-a",
      (st) => {
        (st as unknown as { marker?: string }).marker = "touched";
        return 42;
      },
      { local: { accountId: "acct-a", saves }, store },
    );
    expect(v).toBe(42);
    expect((saves.games["col-a"] as unknown as { marker?: string }).marker).toBe("touched");
    expect(store.writes).toHaveLength(0);
  });

  test("a foreign account loads, mutates, and saves", async () => {
    const store = memStore();
    store.data.set("acct-a", savesWith([{ gameId: "col-a" }]));
    await transactColony(
      "col-a",
      (st) => {
        (st as unknown as { marker?: string }).marker = "touched";
      },
      { store },
    );
    expect(store.writes.includes("acct-a")).toBe(true);
    const reloaded = await store.loadAccountSaves("acct-a");
    expect((gameStateFor(reloaded!, "col-a") as unknown as { marker?: string }).marker).toBe("touched");
  });

  test("an unknown colony throws ColonyNotFoundError", async () => {
    const store = memStore();
    store.data.set("acct-a", savesWith([{ gameId: "col-a" }]));
    let caught: unknown = null;
    try {
      await transactColony("col-x", () => {}, { store });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ColonyNotFoundError);
  });

  test("concurrent transactions on one account serialize — no lost updates", async () => {
    const store = memStore();
    store.data.set("acct-a", savesWith([{ gameId: "col-a" }]));
    // Prime the counter.
    await transactColony("col-a", (st) => { (st as unknown as { n?: number }).n = 0; }, { store });
    const bump = () =>
      transactColony(
        "col-a",
        async (st) => {
          const s = st as unknown as { n?: number };
          const read = s.n ?? 0;
          await new Promise((r) => setTimeout(r, 30));
          s.n = read + 1;
        },
        { store },
      );
    await Promise.all([bump(), bump()]);
    const reloaded = await store.loadAccountSaves("acct-a");
    expect((gameStateFor(reloaded!, "col-a") as unknown as { n?: number }).n).toBe(2);
  });

  test("nested scope transactions resolve in-memory — A→B→A never re-locks", async () => {
    const store = memStore();
    const savesA = savesWith([{ gameId: "col-a" }]);
    const savesB = savesWith([{ gameId: "col-b" }]);
    store.data.set("acct-a", savesA);
    store.data.set("acct-b", savesB);
    const chain = runWithAccountSaves("acct-a", savesA, () =>
      transactColony(
        "col-b",
        async () => {
          // Deep inside B's frame, touch A again: the scope serves it from
          // memory instead of re-acquiring A's lock (the old 8s-timeout bug).
          await transactColony("col-a", (st) => {
            (st as unknown as { ping?: boolean }).ping = true;
          }, { store });
        },
        { store },
      ),
    );
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("deadlock: nested scope transaction re-locked")), 3000),
    );
    await Promise.race([chain, timeout]);
    expect((savesA.games["col-a"] as unknown as { ping?: boolean }).ping).toBe(true);
  });
});

describe("commitOutbox", () => {
  test("the origin persists before any foreign fx is delivered", async () => {
    const events: string[] = [];
    const inner = memStore();
    const store: ColonyStore = {
      ...inner,
      async saveAccountSaves(accountId, saves) {
        events.push(`save:${accountId}`);
        return inner.saveAccountSaves(accountId, saves);
      },
    };
    const savesA = savesWith([{ gameId: "col-a" }]);
    inner.data.set("acct-a", savesA);
    inner.data.set("acct-b", savesWith([{ gameId: "col-b" }]));
    const stA = gameStateFor(savesA, "col-a")!;
    queueAllianceFx(stA, mirrorFx("col-b", "m-1"));
    (stA as unknown as { marker?: string }).marker = "origin-mutation";
    await commitOutbox(savesA, "acct-a", { store });
    // First event must be the origin save — the mutation and queued fx are
    // durable before the foreign colony is ever touched.
    expect(events[0]).toBe("save:acct-a");
    expect(events.includes("save:acct-b")).toBe(true);
    expect(events.indexOf("save:acct-b")).toBeGreaterThan(0);
    // And the fx actually landed on B.
    const savesB = await inner.loadAccountSaves("acct-b");
    expect(guestsAt(gameStateFor(savesB!, "col-b")!)).toHaveLength(1);
  });

  test("a dead target drops the fx with a log line; the outbox is not stuck", async () => {
    const store = memStore();
    const savesA = savesWith([{ gameId: "col-a" }]);
    store.data.set("acct-a", savesA);
    const stA = gameStateFor(savesA, "col-a")!;
    queueAllianceFx(stA, mirrorFx("col-gone", "m-dead"));
    const stats = await commitOutbox(savesA, "acct-a", { store });
    expect(stats.dropped).toBe(1);
    expect(stats.applied).toBe(0);
    expect(drainAllianceFx(stA)).toHaveLength(0);
    expect(stA.log.join(" ").includes("gone")).toBe(true);
  });

  test("a contended target requeues the fx — parked fx survive for a later request", async () => {
    const store = memStore();
    const savesA = savesWith([{ gameId: "col-a" }]);
    store.data.set("acct-a", savesA);
    store.data.set("acct-b", savesWith([{ gameId: "col-b" }]));
    // Hold B's lock for the whole drain so delivery can't proceed.
    let releaseLock!: () => void;
    const gate = new Promise<void>((res) => { releaseLock = res; });
    const holder = withAccountLock("acct-b", () => gate);
    try {
      const stA = gameStateFor(savesA, "col-a")!;
      queueAllianceFx(stA, mirrorFx("col-b", "m-parked"));
      const stats = await applyAllianceFx(savesA, { store, lockTimeoutMs: 50 });
      expect(stats.requeued).toBe(1);
      expect(stats.applied).toBe(0);
      // The fx is still on the origin outbox — a later request retries it,
      // and the previously-parked filter can't silently delete it.
      const again = await applyAllianceFx(savesA, { store, lockTimeoutMs: 50 });
      expect(again.requeued).toBe(1);
      expect(stA.allianceFx).toHaveLength(1); // non-destructive: still queued
    } finally {
      releaseLock();
      await holder;
    }
    // Once the target frees, the parked fx delivers.
    const stats = await applyAllianceFx(savesA, { store, lockTimeoutMs: 5000 });
    expect(stats.applied).toBe(1);
    const savesB = await store.loadAccountSaves("acct-b");
    expect(guestsAt(gameStateFor(savesB!, "col-b")!)).toHaveLength(1);
  });

  test("redelivery is idempotent — the same fx applied twice lands once", async () => {
    const store = memStore();
    const savesA = savesWith([{ gameId: "col-a" }]);
    const savesB = savesWith([{ gameId: "col-b" }]);
    store.data.set("acct-a", savesA);
    store.data.set("acct-b", savesB);
    const stA = gameStateFor(savesA, "col-a")!;
    const fx = mirrorFx("col-b", "m-idem");
    queueAllianceFx(stA, fx);
    queueAllianceFx(stA, { ...fx }); // same mirror id, queued twice
    const stats = await commitOutbox(savesA, "acct-a", { store });
    expect(stats.applied).toBe(2); // both deliveries ran…
    const reloadedB = await store.loadAccountSaves("acct-b");
    expect(guestsAt(gameStateFor(reloadedB!, "col-b")!)).toHaveLength(1); // …but the mirror landed once
  });
});
