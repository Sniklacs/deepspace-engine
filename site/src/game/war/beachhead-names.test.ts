// Tests for beachhead site naming (design/forward-base.md §9.1).
import { describe, expect, test } from "bun:test";
import { abandonAllForwardBases } from "./forward-bases";
import {
  battleWeight,
  biggestContributor,
  CONTRIBUTION_KILL_MULTIPLIER,
  emptyBeachheadNames,
  ensureBeachheadNames,
  epithetFor,
  freshSiteName,
  namingAnnouncementBody,
  namingAnnouncementSubject,
  phoneticForSite,
  recordSiteBattle,
  recordSiteBattleOnState,
  renameSiteEpithet,
  contributionScore,
  siteFor,
  type SiteBattleInput,
} from "./beachhead-names";

function input(over: Partial<SiteBattleInput> = {}): SiteBattleInput {
  return {
    siteKey: "draconians-world",
    battleId: "b-1",
    season: "s1",
    at: 1000,
    attacker: { colonyId: "c-att", colonyName: "Drakkar", side: "attacker", weightCommitted: 5000, kills: 200 },
    defender: { colonyId: "c-def", colonyName: "Vex", side: "defender", weightCommitted: 3000, kills: 100 },
    winner: "attacker",
    baseDestroyed: false,
    ...over,
  };
}

describe("scoring", () => {
  test("battleWeight sums both sides", () => {
    expect(battleWeight(input())).toBe(8000);
  });
  test("contributionScore = weight + 10 × kills", () => {
    expect(contributionScore({ colonyId: "x", colonyName: "X", side: "attacker", weightCommitted: 100, kills: 5 }))
      .toBe(100 + CONTRIBUTION_KILL_MULTIPLIER * 5);
  });
  test("biggestContributor picks higher score (either side can win)", () => {
    // Attacker: 5000 + 2000 = 7000. Defender: 3000 + 1000 = 4000.
    expect(biggestContributor(input()).colonyName).toBe("Drakkar");
    const flipped = input({
      defender: { colonyId: "c-def", colonyName: "Vex", side: "defender", weightCommitted: 9000, kills: 500 },
    });
    expect(biggestContributor(flipped).colonyName).toBe("Vex");
  });
  test("ties go to the attacker", () => {
    const tied = input({
      defender: { colonyId: "c-def", colonyName: "Vex", side: "defender", weightCommitted: 5000, kills: 200 },
    });
    expect(biggestContributor(tied).side).toBe("attacker");
  });
});

describe("epithets", () => {
  test("base destroyed → Fall", () => {
    expect(epithetFor(input({ baseDestroyed: true, winner: "attacker" }))).toBe("Fall");
    expect(epithetFor(input({ baseDestroyed: true, winner: "defender" }))).toBe("Fall");
  });
  test("defender held → Stand", () => {
    expect(epithetFor(input({ winner: "defender" }))).toBe("Stand");
  });
  test("attacker won → Landing", () => {
    expect(epithetFor(input({ winner: "attacker" }))).toBe("Landing");
  });
  test("standoff follows the bigger contributor's side", () => {
    expect(epithetFor(input({ winner: "standoff" }))).toBe("Landing"); // Drakkar (attacker) bigger
    const flipped = input({
      winner: "standoff",
      defender: { colonyId: "c-def", colonyName: "Vex", side: "defender", weightCommitted: 9000, kills: 500 },
    });
    expect(epithetFor(flipped)).toBe("Stand");
  });
});

describe("naming", () => {
  test("fresh site gets a phonetic designation, deterministic", () => {
    const a = freshSiteName("draconians-world");
    expect(a.name).toMatch(/^Beachhead [A-Z][a-z]+$/);
    expect(a.name).toBe(freshSiteName("draconians-world").name);
    expect(phoneticForSite("draconians-world")).toBe(phoneticForSite("draconians-world"));
  });
  test("first battle names the site for the biggest contributor", () => {
    const reg = emptyBeachheadNames();
    const r = recordSiteBattle(reg, input());
    expect(r.renamed).toBe(true);
    expect(r.site.name).toBe("Drakkar's Landing");
    expect(r.site.recordWeight).toBe(8000);
    expect(r.announcement).toMatch("DRAKKAR'S LANDING");
  });
  test("defender honor: enemy commander can own your beachhead's name", () => {
    const reg = emptyBeachheadNames();
    const r = recordSiteBattle(reg, input({
      winner: "defender",
      defender: { colonyId: "c-def", colonyName: "Vex", side: "defender", weightCommitted: 9000, kills: 500 },
    }));
    expect(r.site.name).toBe("Vex's Stand");
  });
  test("smaller later battle does NOT rename", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r2 = recordSiteBattle(reg, input({
      battleId: "b-2",
      attacker: { colonyId: "c-a2", colonyName: "Zed", side: "attacker", weightCommitted: 100, kills: 1 },
      defender: { colonyId: "c-d2", colonyName: "Yara", side: "defender", weightCommitted: 100, kills: 1 },
    }));
    expect(r2.renamed).toBe(false);
    expect(reg["draconians-world"].name).toBe("Drakkar's Landing");
  });
  test("bigger later battle re-names and archives history", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r2 = recordSiteBattle(reg, input({
      battleId: "b-2",
      attacker: { colonyId: "c-a2", colonyName: "Zed", side: "attacker", weightCommitted: 20000, kills: 900 },
      defender: { colonyId: "c-d2", colonyName: "Yara", side: "defender", weightCommitted: 100, kills: 1 },
      winner: "defender",
      baseDestroyed: true,
    }));
    expect(r2.renamed).toBe(true);
    expect(reg["draconians-world"].name).toBe("Zed's Fall");
    expect(reg["draconians-world"].history).toHaveLength(1);
    expect(reg["draconians-world"].history[0].name).toBe("Drakkar's Landing");
  });
  test("ties keep the incumbent name", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r2 = recordSiteBattle(reg, input({ battleId: "b-2" })); // same weight
    expect(r2.renamed).toBe(false);
  });
  test("re-recording the same battle is a no-op", () => {
    const reg = emptyBeachheadNames();
    const r1 = recordSiteBattle(reg, input());
    const r2 = recordSiteBattle(reg, input());
    expect(r2.renamed).toBe(false);
    expect(r1.site.history).toHaveLength(0);
  });
});

describe("epithet rename", () => {
  test("honored player renames once", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r = renameSiteEpithet(reg, "draconians-world", "c-att", "Triumph");
    expect(r.ok).toBe(true);
    expect(reg["draconians-world"].name).toBe("Drakkar's Triumph");
  });
  test("second rename is refused", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    renameSiteEpithet(reg, "draconians-world", "c-att", "Triumph");
    const r2 = renameSiteEpithet(reg, "draconians-world", "c-att", "Glory");
    expect(r2.ok).toBe(false);
    expect(reg["draconians-world"].name).toBe("Drakkar's Triumph");
  });
  test("non-honored player is refused", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r = renameSiteEpithet(reg, "draconians-world", "c-def", "Triumph");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch("Drakkar");
  });
  test("profanity is filtered", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    const r = renameSiteEpithet(reg, "draconians-world", "c-att", "Fuckers");
    expect(r.ok).toBe(false);
  });
  test("bad lengths rejected", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    expect(renameSiteEpithet(reg, "draconians-world", "c-att", "X").ok).toBe(false);
    expect(renameSiteEpithet(reg, "draconians-world", "c-att", "A".repeat(25)).ok).toBe(false);
  });
  test("rename on unnamed site is refused", () => {
    const reg = emptyBeachheadNames();
    siteFor(reg, "draconians-world");
    const r = renameSiteEpithet(reg, "draconians-world", "c-att", "Triumph");
    expect(r.ok).toBe(false);
  });
  test("new naming resets the rename token", () => {
    const reg = emptyBeachheadNames();
    recordSiteBattle(reg, input());
    renameSiteEpithet(reg, "draconians-world", "c-att", "Triumph");
    recordSiteBattle(reg, input({
      battleId: "b-2",
      attacker: { colonyId: "c-a2", colonyName: "Zed", side: "attacker", weightCommitted: 20000, kills: 900 },
    }));
    const r = renameSiteEpithet(reg, "draconians-world", "c-a2", "Glory");
    expect(r.ok).toBe(true);
    expect(reg["draconians-world"].name).toBe("Zed's Glory");
  });
});

describe("state seam + world speaker", () => {
  test("rename broadcasts a world-speaker announcement", () => {
    const state: any = { mailbox: [] };
    const r = recordSiteBattleOnState(state, input());
    expect(r.renamed).toBe(true);
    expect(r.announced).toBe(true);
    expect(state.mailbox).toHaveLength(1);
    expect(state.mailbox[0].category).toBe("announcement");
    expect(state.mailbox[0].subject).toBe(namingAnnouncementSubject(r.site));
    expect(state.mailbox[0].subject).toMatch("DRAKKAR'S LANDING");
    expect(state.mailbox[0].body).toMatch("The land remembers.");
  });
  test("no announcement when the site keeps its name", () => {
    const state: any = { mailbox: [] };
    recordSiteBattleOnState(state, input());
    const r2 = recordSiteBattleOnState(state, input({ battleId: "b-2" }));
    expect(r2.renamed).toBe(false);
    expect(r2.announced).toBe(false);
    expect(state.mailbox).toHaveLength(1); // only the first naming
  });
  test("announcement body names the honored commander", () => {
    const state: any = { mailbox: [] };
    const r = recordSiteBattleOnState(state, input());
    const body = namingAnnouncementBody(r.site, input(), r.honored);
    expect(body).toMatch("Drakkar");
    expect(body).toMatch("8000 total weight");
  });
  test("names survive season rollover (Chronicle persistence)", () => {
    const state: any = {
      mailbox: [],
      forwardBases: { "draconians-world": { id: "fb-1", serverId: "draconians-world" } },
    };
    recordSiteBattleOnState(state, input());
    expect(state.beachheadNames["draconians-world"].name).toBe("Drakkar's Landing");
    // Season rollover wipes the bases but NOT the names.
    abandonAllForwardBases(state.forwardBases);
    expect(state.forwardBases).toEqual({});
    expect(state.beachheadNames["draconians-world"].name).toBe("Drakkar's Landing");
    // A new base planted at the named site inherits the historic name.
    const site = siteFor(ensureBeachheadNames(state), "draconians-world");
    expect(site.name).toBe("Drakkar's Landing");
  });
});
