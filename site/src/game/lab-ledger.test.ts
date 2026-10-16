// THE LAB LEDGER + THE DEAD-BUTTON BAR (owner, 2026-10-16).
//
// Two owner reports from live play in the Lab:
//  (A) THE LEDGER RULE — studying Embers, he could not see his total Embers
//      without leaving the screen. Every Lab spend now states held → cost →
//      after at the action itself, computed by the helpers below.
//  (B) THE DEAD-BUTTON BAR — starting a research (his case: Agriculture)
//      showed no progress at the node, because every research card rendered
//      its progress block only when the job's Leader lookup ALSO succeeded.
//      The block now renders on the job alone, at h-2.5 with percent + time
//      left, driven by the ONE progress computation pinned here.
// Run: bun test site/src/game/lab-ledger.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beginStudy, newGame, STUDY_EMBER_COST } from "./engine";
import { codicesLedger, researchProgress, spendLedger, studyLedger } from "./client-utils";
import { en } from "./i18n/langs/en";
import { es } from "./i18n/langs/es";
import { ptBR } from "./i18n/langs/pt-BR";
import { ru } from "./i18n/langs/ru";
import { fa } from "./i18n/langs/fa";
import type { GameState } from "./types";

const NOW = 1_760_000_000_000;

function fixture(mutate?: (s: GameState) => void): GameState {
  const s = newGame("Lab Ledger Test", "watchers", NOW);
  if (mutate) mutate(s);
  return s;
}

describe("research progress — the one computation", () => {
  const job = { startedAt: 1_000, durationMs: 10_000 };

  test("start, middle, end — percent floors and remaining clamps at zero", () => {
    expect(researchProgress(job, 1_000)).toEqual({ pct: 0, remainingMs: 10_000 });
    expect(researchProgress(job, 6_000)).toEqual({ pct: 50, remainingMs: 5_000 });
    expect(researchProgress(job, 10_999)).toEqual({ pct: 99, remainingMs: 1 });
    expect(researchProgress(job, 11_000)).toEqual({ pct: 100, remainingMs: 0 });
    expect(researchProgress(job, 99_000)).toEqual({ pct: 100, remainingMs: 0 });
  });

  test("a clock reading before the start never shows negative progress", () => {
    expect(researchProgress(job, 500)).toEqual({ pct: 0, remainingMs: 10_500 });
  });

  test("a zero-duration job reads complete, never NaN", () => {
    const p = researchProgress({ startedAt: 1_000, durationMs: 0 }, 1_000);
    expect(p.pct).toBe(100);
    expect(Number.isFinite(p.pct)).toBe(true);
  });
});

describe("the ledger helpers — held, cost, after", () => {
  test("spendLedger: the arithmetic and the affordability edge", () => {
    expect(spendLedger(10, 4)).toEqual({ held: 10, cost: 4, after: 6, affordable: true });
    expect(spendLedger(4, 4)).toEqual({ held: 4, cost: 4, after: 0, affordable: true });
    expect(spendLedger(3, 4)).toEqual({ held: 3, cost: 4, after: -1, affordable: false });
  });

  test("codicesLedger reads the state's own Codices", () => {
    const s = fixture((x) => { x.codices = 7; });
    expect(codicesLedger(s, 5)).toEqual({ held: 7, cost: 5, after: 2, affordable: true });
    expect(codicesLedger(s, 9).affordable).toBe(false);
  });

  test("ember study ledger: held is floored, cost is the engine's constant", () => {
    const s = fixture((x) => { x.resources.embers = 9.7; });
    const l = studyLedger(s, "ember");
    expect(l.held).toBe(9);
    expect(l.cost).toBe(STUDY_EMBER_COST);
    expect(l.after).toBe(9 - STUDY_EMBER_COST);
    expect(l.consumes).toBe(true);
    expect(l.affordable).toBe(true);
    const poor = fixture((x) => { x.resources.embers = STUDY_EMBER_COST - 1; });
    expect(studyLedger(poor, "ember").affordable).toBe(false);
  });

  test("chipset study ledger states the engine's truth: held, not consumed", () => {
    const s = fixture((x) => { x.resources.chipsets = 3; });
    const l = studyLedger(s, "chipset");
    expect(l.held).toBe(3);
    expect(l.cost).toBe(1);
    expect(l.after).toBe(3); // nothing leaves the hand
    expect(l.consumes).toBe(false);
    expect(l.affordable).toBe(true);
    const none = fixture((x) => { x.resources.chipsets = 0; });
    expect(studyLedger(none, "chipset").affordable).toBe(false);
  });
});

describe("the ledger tells the truth the engine keeps", () => {
  test("beginStudy('ember') deducts exactly the ledger's cost", () => {
    const s = fixture((x) => { x.resources.embers = 10; x.scientists = 3; });
    const before = s.resources.embers;
    const res = beginStudy(s, "ember", NOW);
    expect(res.ok).toBe(true);
    expect(before - s.resources.embers).toBe(studyLedger(s, "ember").cost);
  });

  test("beginStudy('chipset') deducts NOTHING — the ledger's after == held", () => {
    const s = fixture((x) => { x.resources.chipsets = 2; x.resources.embers = 5; x.scientists = 3; });
    const res = beginStudy(s, "chipset", NOW);
    expect(res.ok).toBe(true);
    expect(s.resources.chipsets).toBe(2);
    expect(s.resources.embers).toBe(5);
    expect(studyLedger(s, "chipset").after).toBe(studyLedger(s, "chipset").held);
  });
});

describe("research progress — the surfaces render it unconditionally (source lock)", () => {
  const views = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/ResearchViews.tsx"), "utf-8");

  test("no progress block is gated on a leader lookup anywhere in the file", () => {
    expect(views.includes("inProg && leader && job")).toBe(false);
    expect(views.includes("job && leaderOnIt")).toBe(false);
    expect(views.includes("inProg && leaderOnIt")).toBe(false);
    expect(views.includes("if (job && leaderOnIt)")).toBe(false);
  });

  test("the shared progress block exists, is readable, and every branch uses it", () => {
    expect(views.includes('data-testid="research-progress"')).toBe(true);
    expect(views.includes("h-2.5")).toBe(true);
    // domain techs, armory, muster, satellite card, revelation, scout probe
    expect(views.split("<ResearchProgress").length - 1 >= 6).toBe(true);
    expect(views.includes("engineHelpers.researchProgress(job, liveNow)")).toBe(true);
    // the block keeps its own 1-second clock while a job is researching
    expect(views.includes("setInterval(() => setTick(Date.now()), 1000)")).toBe(true);
  });

  test("no hairline h-1 research bar survives in the file", () => {
    expect(views.includes("h-1 rounded bg-white/10")).toBe(false);
  });

  test("the Lab's research cards carry the Codices ledger line", () => {
    expect(views.includes("rviews.ledgerCodices")).toBe(true);
    expect(views.includes("rviews.ledgerCodicesShort")).toBe(true);
    expect(views.includes("CodicesLedgerLine")).toBe(true);
  });

  test("the Scout Probe build carries the supplies ledger line", () => {
    expect(views.includes("rviews.ledgerSupplies")).toBe(true);
    expect(views.includes("SuppliesLedgerLine")).toBe(true);
  });
});

describe("the Lab study + deploy surfaces carry the ledger (source lock)", () => {
  const play = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../routes/play.tsx"), "utf-8");

  test("both study cards quote the study ledger above their buttons", () => {
    expect(play.includes('engineHelpers.studyLedger(state, "ember")')).toBe(true);
    expect(play.includes('engineHelpers.studyLedger(state, "chipset")')).toBe(true);
    expect(play.includes("play.lab.studyLedgerEmber")).toBe(true);
    expect(play.includes("play.lab.studyLedgerEmberShort")).toBe(true);
    // the chipset line states the not-consumed truth, not a copied ember line
    expect(play.includes("play.lab.studyLedgerChipset")).toBe(true);
    expect(play.includes("play.lab.studyLedgerChipsetShort")).toBe(true);
  });

  test("the Deploy cards state held → after for both spent resources", () => {
    expect(play.includes("play.lab.deployLedger")).toBe(true);
    expect(play.includes("embersAfter")).toBe(true);
    expect(play.includes("insightAfter")).toBe(true);
  });
});

describe("the new strings exist in every catalogue with matching placeholders", () => {
  const KEYS = [
    "rviews.progressPct",
    "rviews.researchingNow",
    "rviews.ledgerCodices",
    "rviews.ledgerCodicesShort",
    "rviews.ledgerSupplies",
    "rviews.ledgerSuppliesShort",
    "play.lab.studyLedgerEmber",
    "play.lab.studyLedgerEmberShort",
    "play.lab.studyLedgerChipset",
    "play.lab.studyLedgerChipsetShort",
    "play.lab.deployLedger",
  ] as const;
  const catalogues = { en, es, ptBR, ru, fa } as const;
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const key of KEYS) {
    test(`${key}: present in all five, placeholders preserved`, () => {
      const want = placeholders(en[key]);
      for (const cat of Object.values(catalogues)) {
        expect(typeof cat[key]).toBe("string");
        expect(placeholders(cat[key])).toEqual(want);
      }
    });
  }
});
