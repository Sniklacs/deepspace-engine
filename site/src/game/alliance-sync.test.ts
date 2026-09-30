// Multi-account integration tests for alliance + rally synchronization
// (site/src/game/alliance-transact.ts + war/alliances.ts + war/rallies.ts).
//
// Two accounts — acct-a holds col-a, acct-b holds col-b — against an
// in-memory ColonyStore that deep-clones on load like a real disk read.
// Every cross-account step goes through transactColony, so the outbox,
// request-scope nesting, and idempotency ledger behave like production.
// Run: bun test src/game/alliance-sync.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearColonyAccountCache,
  transactColony,
  type ColonyStore,
} from "./alliance-transact";
import type { AccountSaves } from "./store";
import type { GameState } from "./types";
import {
  acceptMembership,
  allianceById,
  allianceOf,
  applyToAlliance,
  createAlliance,
  disbandAlliance,
  inviteToAlliance,
  kickMember,
  leaveAllianceLocal,
  queueAllianceFx,
  removeAllianceMemberRecord,
  removeAllianceMirror,
} from "./war/alliances";
import {
  addRemotePledge,
  advanceRallies,
  cancelRally,
  createRally,
  departRalliesFor,
  launchRally,
  lockPledgeLocal,
  rallyOf,
  unpledgeLocal,
} from "./war/rallies";
import { applyAllianceFx, scanAllianceDirectory } from "./alliance-transact";
import { addCohort, availableWeight, emptyTroopHome } from "./war/troops";

const NOW = 1_800_000_000_000;

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}

/** A colony that survives engine.advance(Date.now()) — real clocks, troops, supplies. */
function fakeColony(gameId: string, name: string): GameState {
  const st = {
    gameId,
    playerName: name,
    seasonId: "s1",
    resources: { supplies: 5000 },
    leaders: [],
    techsResearched: [],
    lastTick: Date.now(),
    log: [],
    allianceFx: [],
    battles: [],
    deployedDomains: {},
    studies: [],
    expeditions: [],
    researchJobs: [],
    troops: { home: emptyTroopHome(Date.now()), bands: [], history: [] },
  } as unknown as GameState;
  addCohort(st.troops!.home.roster, "bulwark", 600, NOW);
  return st;
}

interface MemStore extends ColonyStore {
  data: Map<string, AccountSaves>;
}

function memStore(entries: Record<string, AccountSaves>): MemStore {
  const data = new Map(Object.entries(entries));
  return {
    data,
    async loadAccountSaves(accountId) {
      const s = data.get(accountId);
      return s ? (structuredClone(s) as AccountSaves) : null;
    },
    async saveAccountSaves(accountId, saves) {
      data.set(accountId, structuredClone(saves) as AccountSaves);
    },
    async loadAllSaves() {
      return [...data.entries()].map(([accountId, saves]) => ({ accountId, saves }));
    },
  };
}

function world() {
  const savesA = { games: { "col-a": fakeColony("col-a", "Alpha") } } as unknown as AccountSaves;
  const savesB = { games: { "col-b": fakeColony("col-b", "Beta") } } as unknown as AccountSaves;
  const store = memStore({ "acct-a": savesA, "acct-b": savesB });
  return { store };
}

async function colonyOf(store: MemStore, accountId: string, colonyId: string): Promise<GameState> {
  const saves = await store.loadAccountSaves(accountId);
  return (saves as AccountSaves).games[colonyId] as GameState;
}

/** Founder creates the alliance on acct-a; returns its id. */
async function foundAlliance(store: MemStore): Promise<string> {
  const aid = await transactColony(
    "col-a",
    (st) => must(createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "War Band" }, NOW)).id,
    { store },
  );
  return aid;
}

/** col-b applies (canonical write on the founder's account) and col-a accepts. */
async function befriend(store: MemStore, aid: string): Promise<void> {
  await transactColony(
    "col-a",
    (fst) => must(applyToAlliance(fst, aid, { id: "col-b", name: "Beta" }, NOW)),
    { store },
  );
  await transactColony(
    "col-a",
    (fst) => must(acceptMembership(fst, aid, "col-a", "col-b", NOW)),
    { store },
  );
}

beforeEach(() => {
  clearColonyAccountCache();
});

describe("cross-account membership", () => {
  test("apply → accept: the applicant's save converges to full member", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);

    // col-b applies — the canonical write runs on the founder's account.
    await transactColony(
      "col-a",
      (fst) => must(applyToAlliance(fst, aid, { id: "col-b", name: "Beta" }, NOW)),
      { store },
    );
    let b = await colonyOf(store, "acct-b", "col-b");
    let mirror = allianceById(b, aid)!;
    expect(mirror).toBeDefined();
    expect(mirror.applications.some((x) => x.colonyId === "col-b")).toBe(true);
    expect(allianceOf(b, "col-b")).toBeNull(); // applied, not yet a member

    // Founder accepts — col-b becomes a member on both saves.
    await transactColony(
      "col-a",
      (fst) => must(acceptMembership(fst, aid, "col-a", "col-b", NOW)),
      { store },
    );
    b = await colonyOf(store, "acct-b", "col-b");
    expect(allianceOf(b, "col-b")!.members.some((m) => m.colonyId === "col-b")).toBe(true);
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(allianceOf(a, "col-a")!.members.map((m) => m.colonyId).sort()).toEqual(["col-a", "col-b"]);
  });

  test("invite → accept: the invited colony accepts its own invite", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);
    await transactColony(
      "col-a",
      (fst) => must(inviteToAlliance(fst, aid, "col-a", { id: "col-b", name: "Beta" }, NOW)),
      { store },
    );
    let b = await colonyOf(store, "acct-b", "col-b");
    expect(allianceById(b, aid)!.invites.some((x) => x.colonyId === "col-b")).toBe(true);
    // col-b accepts its own invite — canonical write still lands on the founder.
    await transactColony(
      "col-a",
      (fst) => must(acceptMembership(fst, aid, "col-b", "col-b", NOW)),
      { store },
    );
    b = await colonyOf(store, "acct-b", "col-b");
    expect(allianceOf(b, "col-b")!.members.some((m) => m.colonyId === "col-b")).toBe(true);
  });

  test("kick: the member's save is cleaned and the roll converges", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);
    await befriend(store, aid);
    await transactColony(
      "col-a",
      (fst) => must(kickMember(fst, aid, "col-a", "col-b", NOW)),
      { store },
    );
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(allianceOf(b, "col-b")).toBeNull();
    expect(allianceById(b, aid)).toBeNull();
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(allianceOf(a, "col-a")!.members.map((m) => m.colonyId)).toEqual(["col-a"]);
  });

  test("leave → rejoin → leave: departure is never swallowed by the ledger", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);
    for (let round = 0; round < 2; round++) {
      await befriend(store, aid);
      let b = await colonyOf(store, "acct-b", "col-b");
      expect(allianceOf(b, "col-b")).toBeDefined();
      // col-b leaves: local cleanup on its own save, canonical roll on the founder's.
      await transactColony("col-b", async (st) => {
        const a = allianceOf(st, "col-b")!;
        departRalliesFor(st, "col-b", a.id, a.members.map((m) => m.colonyId));
        leaveAllianceLocal(st, "col-b");
        removeAllianceMirror(st, a.id);
        return transactColony("col-a", (fst) => removeAllianceMemberRecord(fst, a.id, "col-b"), { store });
      }, { store });
      b = await colonyOf(store, "acct-b", "col-b");
      expect(allianceOf(b, "col-b")).toBeNull();
      const a = await colonyOf(store, "acct-a", "col-a");
      expect(allianceOf(a, "col-a")!.members.map((m) => m.colonyId)).toEqual(["col-a"]);
    }
  });

  test("disband: every member's save forgets the alliance", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);
    await befriend(store, aid);
    await transactColony(
      "col-a",
      (fst) => must(disbandAlliance(fst, aid, "col-a")),
      { store },
    );
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(allianceById(b, aid)).toBeNull();
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(allianceById(a, aid)).toBeNull();
  });
});

describe("cross-account rallies", () => {
  /** Alliance + open rally called by col-a; both saves have the rally. */
  async function withRally(store: MemStore) {
    const aid = await foundAlliance(store);
    await befriend(store, aid);
    const rid = await transactColony(
      "col-a",
      (st) =>
        must(
          createRally(
            st,
            { id: "col-a", name: "Alpha" },
            aid,
            { name: "Rally", target: { kind: "chorus-site", label: "Hive", zoneId: "z" }, launchAt: NOW + 3_600_000 },
            NOW,
          ),
        ).id,
      { store },
    );
    return { aid, rid };
  }

  /** col-b's pledge flow: lock locally, mirror to the caller's account. */
  async function pledgeAs(store: MemStore, rid: string, colonyId: string, troops: number) {
    return transactColony(
      colonyId,
      (st) => {
        const r = rallyOf(st, rid)!;
        const locked = must(
          lockPledgeLocal(st, r, { id: colonyId, name: colonyId === "col-a" ? "Alpha" : "Beta" }, troops, [], NOW),
        );
        if (r.callerId !== colonyId) {
          queueAllianceFx(st, {
            kind: "mirror-rally-pledge",
            colonyId: r.callerId,
            rallyId: r.id,
            pledge: locked,
            key: `pledge:${r.id}:${locked.id}`,
          });
        } else {
          const a = allianceOf(st, colonyId)!;
          must(addRemotePledge(st, rid, locked, a.members.map((m) => m.colonyId)));
        }
        return locked;
      },
      { store },
    );
  }

  test("remote pledge: lock on the pledger's save, canonical mirror on the caller's", async () => {
    const { store } = world();
    const { rid } = await withRally(store);
    // Sanity: col-b sees the rally mirror before pledging.
    let b = await colonyOf(store, "acct-b", "col-b");
    expect(rallyOf(b, rid)!.state).toBe("open");

    await pledgeAs(store, rid, "col-b", 200);
    // The lock sits on col-b's save…
    b = await colonyOf(store, "acct-b", "col-b");
    expect(b.troops!.home.roster.committedWeight).toBe(200);
    expect(availableWeight(b.troops!.home.roster)).toBe(400);
    // …and the canonical record on col-a's account carries the pledge…
    const a = await colonyOf(store, "acct-a", "col-a");
    const canonical = rallyOf(a, rid)!;
    expect(canonical.pledges.some((p) => p.colonyId === "col-b" && p.troops === 200)).toBe(true);
    // …and col-b's mirror converged back through sync-rally.
    b = await colonyOf(store, "acct-b", "col-b");
    expect(rallyOf(b, rid)!.pledges.some((p) => p.colonyId === "col-b")).toBe(true);
  });

  test("duplicate mirror-rally-pledge delivery never double-adds", async () => {
    const { store } = world();
    const { rid } = await withRally(store);
    const locked = await pledgeAs(store, rid, "col-b", 200);
    // Deliver the same mirror fx again (retry / duplicate drain).
    await transactColony(
      "col-a",
      (st) => {
        const res = addRemotePledge(st, rid, locked, ["col-a", "col-b"]);
        expect(res.ok).toBe(true); // idempotent: ok, no duplicate
        return res;
      },
      { store },
    );
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(rallyOf(a, rid)!.pledges.filter((p) => p.colonyId === "col-b").length).toBe(1);
  });

  test("unpledge: the lock returns on the pledger's save, the mirror drops", async () => {
    const { store } = world();
    const { rid } = await withRally(store);
    const locked = await pledgeAs(store, rid, "col-b", 200);
    await transactColony(
      "col-b",
      (st) => {
        const r = rallyOf(st, rid)!;
        const local = must(unpledgeLocal(st, rid, "col-b"));
        queueAllianceFx(st, {
          kind: "mirror-rally-unpledge",
          colonyId: r.callerId,
          rallyId: r.id,
          pledgerId: "col-b",
          pledgeId: local.id,
          key: `unpledge:${r.id}:${local.id}`,
        });
        return local;
      },
      { store },
    );
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(b.troops!.home.roster.committedWeight).toBe(0);
    expect(availableWeight(b.troops!.home.roster)).toBe(600);
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(rallyOf(a, rid)!.pledges.some((p) => p.colonyId === "col-b")).toBe(false);
    void locked;
  });

  test("cancel: every pledger's lock releases on their own save", async () => {
    const { store } = world();
    const { rid } = await withRally(store);
    await pledgeAs(store, rid, "col-a", 300);
    await pledgeAs(store, rid, "col-b", 200);
    await transactColony("col-a", (st) => must(cancelRally(st, rid, "col-a")), { store });
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(rallyOf(a, rid)!.state).toBe("cancelled");
    expect(a.troops!.home.roster.committedWeight).toBe(0);
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(b.troops!.home.roster.committedWeight).toBe(0);
    expect(availableWeight(b.troops!.home.roster)).toBe(600);
    expect(rallyOf(b, rid)!.state).toBe("cancelled");
  });

  test("launch + resolve: loot lands on each account exactly once", async () => {
    const { store } = world();
    const { rid } = await withRally(store);
    await pledgeAs(store, rid, "col-a", 400);
    await pledgeAs(store, rid, "col-b", 200);
    const battleId = await transactColony(
      "col-a",
      (st) => {
        const battle = must(launchRally(st, rid, "col-a", NOW));
        // The fight happens off-screen: attacker wins with 10% casualties.
        battle.casualties.attacker = Math.round(battle.attacker.troops * 0.1);
        battle.attacker.troops = 600;
        battle.status = "resolved";
        battle.result = { outcome: "attacker_victory", endedAt: NOW + 600_000 };
        st.battles!.push(battle);
        return battle.id;
      },
      { store },
    );
    void battleId;
    await transactColony("col-a", (st) => { advanceRallies(st, NOW + 700_000); }, { store });

    const a = await colonyOf(store, "acct-a", "col-a");
    expect(rallyOf(a, rid)!.state).toBe("resolved");
    // 600 pledged × 0.5 loot/weight = 300, split 2:1 → 200 / 100.
    // col-a: 5000 − 500 (founding) + 200 = 4700; col-b: 5000 + 100 = 5100.
    expect(Math.round(a.resources.supplies)).toBe(4700);
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(Math.round(b.resources.supplies)).toBe(5100);

    // Draining again changes nothing — the ledger dedupes the loot.
    const savesA = await store.loadAccountSaves("acct-a");
    await applyAllianceFx(savesA as AccountSaves, { store });
    const savesB = await store.loadAccountSaves("acct-b");
    await applyAllianceFx(savesB as AccountSaves, { store });
    const a2 = await colonyOf(store, "acct-a", "col-a");
    const b2 = await colonyOf(store, "acct-b", "col-b");
    expect(Math.round(a2.resources.supplies)).toBe(4700);
    expect(Math.round(b2.resources.supplies)).toBe(5100);
  });

  test("departure mid-rally: the leaver's pledge returns, the rally survives", async () => {
    const { store } = world();
    const { aid, rid } = await withRally(store);
    await pledgeAs(store, rid, "col-b", 200);
    // col-b leaves the alliance while pledged.
    await transactColony("col-b", async (st) => {
      const al = allianceOf(st, "col-b")!;
      departRalliesFor(st, "col-b", aid, al.members.map((m) => m.colonyId));
      leaveAllianceLocal(st, "col-b");
      removeAllianceMirror(st, aid);
      return transactColony("col-a", (fst) => removeAllianceMemberRecord(fst, aid, "col-b"), { store });
    }, { store });
    const b = await colonyOf(store, "acct-b", "col-b");
    expect(b.troops!.home.roster.committedWeight).toBe(0);
    expect(allianceOf(b, "col-b")).toBeNull();
    // The canonical rally dropped col-b's pledge; col-a can still launch solo.
    const a = await colonyOf(store, "acct-a", "col-a");
    expect(rallyOf(a, rid)!.pledges.some((p) => p.colonyId === "col-b")).toBe(false);
  });
});

describe("alliance directory", () => {
  test("scanAllianceDirectory lists every alliance across accounts", async () => {
    const { store } = world();
    const aid = await foundAlliance(store);
    const entries = await scanAllianceDirectory(store);
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe(aid);
    expect(entries[0].name).toBe("War Band");
    expect(entries[0].memberCount).toBe(1);
    expect(entries[0].founderId).toBe("col-a");
  });
});
