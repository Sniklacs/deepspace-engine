// THE BUTTON LAW (owner 2026-10-16, from live play in the Lab): "anything
// fucking thing clickable has to look like a button." The Lab's Deploy AI
// buttons sat at ~36px in a wall of data, the Research Tree's Appoint
// buttons were 22px text chips, and the Armory/Muster cards swapped their
// button OUT for bare grey text whenever the player couldn't afford the
// node — every one of them read as information, not as a door. The restyle
// routes every Lab action through the shared button classes in
// components/ui/button-classes.ts (ActionButton's dialect: filled accents,
// rounded-xl, min-h-tap 44px floor / min-h-tap-lg 48px for primary doors,
// the Click Law press dip). These source locks pin the treatment so the
// camouflage cannot creep back.
// Run: bun test site/src/game/lab-button-law.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const classes = readFileSync(join(here, "../components/ui/button-classes.ts"), "utf-8");
const views = readFileSync(join(here, "../components/ResearchViews.tsx"), "utf-8");
const play = readFileSync(join(here, "../routes/play.tsx"), "utf-8");

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("the shared button classes carry the law", () => {
  test("primary doors are 48px filled ember/cyan with the press dip", () => {
    expect(classes.includes("BTN_PRIMARY")).toBe(true);
    expect(classes.includes("min-h-tap-lg")).toBe(true);
    expect(classes.includes("bg-ember")).toBe(true);
    expect(classes.includes("bg-cyan-400")).toBe(true);
  });

  test("research + secondary buttons meet the 44px floor, bordered or filled", () => {
    expect(classes.includes("BTN_RESEARCH")).toBe(true);
    expect(classes.includes("bg-purple-400")).toBe(true);
    expect(classes.includes("BTN_SECONDARY")).toBe(true);
    expect(classes.includes("min-h-tap")).toBe(true);
    expect(classes.includes("border")).toBe(true);
  });

  test("every shared class carries the Click Law press feedback", () => {
    expect(classes.includes("active:scale-[0.98]")).toBe(true);
    expect(classes.includes("active:brightness-90")).toBe(true);
    expect(classes.includes("BTN_CLOSE")).toBe(true);
    expect(classes.includes("BTN_TAB")).toBe(true);
  });
});

describe("the Lab tab (play.tsx) — Deploy AI and the view doors", () => {
  const labStart = play.indexOf("function LabTab");
  const labEnd = play.indexOf("Armory tab", labStart);
  const lab = play.slice(labStart, labEnd);

  test("play.tsx imports the shared classes", () => {
    expect(play.includes('from "../components/ui/button-classes"')).toBe(true);
  });

  test("the view-switch doors (Deploy AI / Research / Leaders) are real buttons", () => {
    expect(lab.includes("${BTN_TAB}")).toBe(true);
    // the old camouflage: inactive tab as bare grey text with a hover ghost
    expect(lab.includes('"text-gray-300 hover:bg-white/10"}')).toBe(false);
    expect(lab.includes("border border-white/25 bg-white/5")).toBe(true);
  });

  test("Deploy AI and both Begin Study buttons wear the primary treatment", () => {
    expect(lab.includes("mt-2 w-full ${BTN_PRIMARY}")).toBe(true); // Deploy, per domain card
    expect(lab.includes("mt-3 w-full ${BTN_PRIMARY}")).toBe(true); // Begin Study (Embers)
    expect(lab.includes("mt-3 w-full ${BTN_PRIMARY_CYAN}")).toBe(true); // Begin Study (Chipset)
    // the old ~36px ember/cyan bars are gone from the Lab
    expect(lab.includes("rounded-lg bg-ember px-3 py-2")).toBe(false);
    expect(lab.includes("rounded-lg bg-cyan-400 px-3 py-2")).toBe(false);
  });

  test("the balance chips that open explanation sheets meet the control floor", () => {
    expect(lab.includes("min-h-tap items-center gap-1 rounded-lg bg-ember/10")).toBe(true);
    expect(lab.includes("min-h-tap items-center gap-1 rounded-lg bg-purple-400/10")).toBe(true);
  });

  test("the Revelation choice cards (the Lab's modal) are 44px pressable doors", () => {
    const modal = play.slice(play.indexOf("function RevelationChoiceModal"), play.indexOf("/* ---------------- formatting"));
    expect(count(modal, "min-h-tap w-full rounded-xl")).toBe(2);
    expect(modal.includes("active:scale-[0.99]")).toBe(true);
  });
});

describe("ResearchViews — every action looks like a button", () => {
  test("the file imports and uses the shared classes throughout", () => {
    expect(views.includes('from "./ui/button-classes"')).toBe(true);
    expect(count(views, "BTN_SECONDARY")).toBeGreaterThan(7);
    expect(views.includes("className={BTN_RESEARCH}")).toBe(true);
    expect(count(views, "BTN_CLOSE")).toBe(3); // the import + both modal exits
    expect(views.includes("${BTN_PRIMARY} mt-2 w-full")).toBe(true);
  });

  test("the old camouflage classes are gone", () => {
    // 22px appoint chips (tech tree, armory, muster, revelation)
    expect(views.includes("bg-white/10 px-2 py-1 text-[11px]")).toBe(false);
    expect(views.includes("rounded bg-purple-400 px-2 py-1")).toBe(false);
    // 22px satellite / scout-probe chips
    expect(views.includes("border-cyan-400/30 bg-cyan-400/15 px-2 py-1")).toBe(false);
    // the 18px collect chip
    expect(views.includes("px-2 py-0.5 text-[10px]")).toBe(false);
    // the leader card's 30px actions
    expect(views.includes("px-2 py-1.5 text-[11px] font-semibold text-amber-200")).toBe(false);
    expect(views.includes("px-2 py-1.5 text-[11px] font-bold text-black")).toBe(false);
    // the modals' 34px close buttons
    expect(views.includes("rounded border border-white/15 px-3 py-2 text-xs text-gray-400")).toBe(false);
  });

  test("unavailable Armory/Muster nodes render a disabled button, not bare text", () => {
    // the button slot never collapses into a grey text line: the reason
    // rides a disabled button (honest, visible, still button-shaped)
    expect(count(views, "<button disabled")).toBe(4);
    expect(views.includes('<div className="text-[11px] text-text-3">{t("rviews.needCodices"')).toBe(false);
    expect(views.includes('<div className="text-[11px] text-text-3">{t("rviews.noFreeLeader"')).toBe(false);
  });

  test("every button in the file carries the button treatment", () => {
    const chunks = views.split("<button").slice(1);
    expect(chunks.length).toBeGreaterThan(18);
    for (const chunk of chunks) {
      const head = chunk.slice(0, 700);
      expect(/BTN_|min-h-tap/.test(head)).toBe(true);
    }
  });

  test("every onClick sits on a button — the only exceptions are the 4 modal scrims", () => {
    // Scoped honestly: the two Lab modals dismiss via a backdrop onClick and
    // shield their panel with stopPropagation — those 4 div handlers are
    // window chrome, not actions. Every ACTION onClick must be a button's.
    const buttons = count(views, "<button");
    const disabledButtons = count(views, "<button disabled");
    // the scrims: 2 backdrop divs (dismiss onClick) + their 2 panel shields
    const scrims = count(views, '<div className="fixed inset-0') + count(views, "onClick={(e) => e.stopPropagation()}");
    expect(scrims).toBe(4);
    expect(count(views, "onClick") - scrims).toBe(buttons - disabledButtons);
  });
});
