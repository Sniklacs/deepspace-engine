# THE LANGUAGE FOUNDATION — what is keyed, what is not (slice 1, 2026-09-25)

Status: **engineering report on the first translation slice**, written to be argued
with. Numbers come from `i18n-tests/string-inventory.ts` (run it to reproduce);
the counting rules are printed in that file's header. Nothing here is a promise
about the next slice — it is the honest size of what is left.

## 1 · What this slice keyed

234 keys in `site/src/game/i18n/langs/en.ts` (the English source of truth),
each shipped in the three machine files (`es`, `pt-BR`, `ru`), 234/234 complete.

| area | keys | where the strings lived |
|---|---|---|
| app / shell chrome | 4 | `Sheet.tsx`, `AppShell.tsx`, `__root.tsx` |
| bottom navigation | 8 | `game/nav-slots.ts` (labels), `shell/BottomNav.tsx` |
| ribbon + ledger | 14 | `shell/Ribbon.tsx`, `LedgerButton.tsx`, `ui/ResourcePill.tsx` |
| resource names | 10 | `shell/CradleSheet.tsx` (Stores rows) |
| Cradle home | 78 | `components/screens/CradleScreen.tsx` |
| building tiles + domains | 17 | `ui/BuildingTile.tsx`, `game/zones.ts` (DOMAINS) |
| Cradle sheet | 25 | `shell/CradleSheet.tsx` (every row, heading, command) |
| Settings + picker (new) | 21 | `shell/SettingsSheet.tsx`, `components/i18n/LanguagePicker.tsx` |
| landing page | 40 | `routes/index.tsx` |
| sign-in door + nudge + help | 19 | `routes/play.tsx` |
| Expeditions / Lab / Armory chrome | 22 | `routes/play.tsx` (headers, primary actions, journals) |

## 2 · What is NOT keyed yet (later slices), and how big it is

Counted with the rules in `string-inventory.ts` (JSX text nodes + player-facing
props, skipping anything already inside a `t()` call):

| area | strings left (approx) | file paths |
|---|---|---|
| components + screens | **143** | `src/components/**` — mostly deep panel copy: `BattlesTab.tsx` (1073 lines), `CircuitPage.tsx` (943), `ResearchViews.tsx` (478), the sheet bodies inside `CradleScreen.tsx` (workshop tier notes/kit descriptions), `StorefrontOverlay.tsx`, `TutorialCueLayer.tsx`, `Tooltip.tsx` |
| routes | **130** | `routes/play.tsx` (2165 lines: zone cards, risk modal, gear lists, research tree, hero/leader sheets, Codex modal body, feedback modal) |
| engine config — tooltip prose | **~120 (`what`/`why` fields)** | `game/tooltips.tsx` |
| engine config — zones, races, research, daily, armory, heroes, war, prologue, reports, storefront | **~553 field strings in total across `src/game/**`** (the script under-counts multi-line table strings — treat this as a floor, not a total) | `game/zones.ts`, `races.ts`, `research.ts`, `daily.ts`, `armory.ts`, `heroes-data.ts`, `war/war-types.ts`, `war/battle-engine.ts`, `battle-decisions.ts`, `prologue/*`, `report-events.ts`, `nav-badges.ts`, `monetization.ts` |
| tutorial cues | **17 rows** (the spec says 15 live cues) | `game/war/tutorial-cues.ts` |
| beat-rail rows | **56 rows** (the spec says 55) | `game/prologue/prologue-cues.ts` (in flight with the rail build) |
| prologue script | **77 speaker lines counted by speaker-prefix** (the script's own ~500-line file, most lines are stage direction) | `design/opening-script.md` |

**How the counts were taken.** Every category is a scripted count, not an
estimate: (A) JSX text nodes, (B) literal `aria-label`/`title`/`placeholder`/
`alt`/`label`/`sub`/`subtitle`/`reason`/`note` props, (C) quoted prose in the
engine's data tables (this one under-counts — multi-line strings and template
literals slip the pattern, hence "floor, not total"), (D) authored content
counted per row/line from its own table (`tutorial-cues.ts`, `prologue-cues.ts`,
`opening-script.md`). Run `bun run string-inventory.ts` for the live numbers.

## 3 · What L1–L10 gets right, and two things this build disagrees with

**Agreed and built:** L1 (picker first run + Settings, browser language a
suggestion), L2 (keys, English source of truth), L3 (one drop-in file per
language; machine now, human later, no code change), L6 (text size + graphics
quality, no fake "resolution"), L9 (language/text size per device).

**Two honest disagreements / limits to flag to the owner:**

1. **L10's launch set is not reachable in one slice, and this slice deliberately
   ships three LTR languages instead of CJK/RTL.** CJK needs font coverage (a
   download-size and licensing decision nobody has made yet) and Arabic/Hebrew/
   Persian/Urdu need a *mirrored layout* — shipping them without those would put
   a half-broken screen in front of exactly the testers this work is for. The
   registry takes any language by dropping in a file, so the list can grow the
   day the font/mirroring work lands. **`es`, `pt-BR`, `ru`** were chosen as the
   three largest non-English player populations whose script the current stack
   already renders.
2. **L4's "voices stay English" is real but sharper than the spec says**: with
   captions *not* in this slice (they are in L5 and a later slice), a
   non-English tester right now gets a translated **UI** and an **English story**
   — the Fall's speech, plate text and rail rows all stay English until the
   caption/prologue slices land. The picker says this in the player's language so
   nobody discovers it mid-scene, but it is the biggest gap between "translated
   game" and what a tester will actually see on day one.

**Unbuildable as written:** nothing in L1–L10 is unbuildable. L8's "phone push"
(step 2) needs a background worker and a delivery channel that does not exist in
this stack — in-game + browser-tab (step 1) is the only version buildable here.
