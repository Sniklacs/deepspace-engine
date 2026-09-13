# Rung 1a QA — working site (published 2026-09-13, :3000)
Run: engineer session, agent-browser against http://localhost:3000 after `bash ./publish.sh`.
All four build items landed in the previous split session (CircuitTab/ColonyTab/Codex edits verified in-tree);
this session verified + battery + publish + browser QA.

## Browser QA (all verified live)
(a) 5-tab bar: Cradle/Expeditions/Lab/Armory/Circuit — PASS (no Codex/Contribution tabs).
(b) Cradle shows "📖 Legends of the Shatterlands" → "Open the Codex" button (opens modal) — PASS.
(c) Circuit → Map|World toggle (role=tablist; active uses bg-ember #ff9d3c + black text + aria-selected) —
    World renders ContributionTab verbatim: "World Contribution … YOUR RANK #1 / 1 colony … top 10 colonies" — PASS.
(d) Circuit SVG: 18 texts at font-size=11 (was 9-10), 1×13 + 1×15 titles; 11 nodes with aria-label + 11 with
    tabindex (keyboard Enter/Space) — PASS at 1280px DOM level. NOTE: 375px viewport NOT re-executed;
    SVG scales via viewBox/w-full container (labels scale with map, sizes relative to viewBox are >=11).
(e) Accents: segment active = rgb(255,157,60) ember token w/ black text; race-select Watchers accent per
    RACES[].accentText (source-verified; screenshot qa-race-select.png captured).

## Gotchas for future sessions
- agent-browser CDP coordinate clicks MISS buttons on this app when the target is below/at viewport edge —
  clicks report "✓ Done" but never fire onClick. Workaround: `agent-browser eval` + `el.click()` (DOM click)
  on the found element. Needed for "Found The Cradle", tab buttons, Map/World.
- Bash history expansion: `!b` inside double quotes in the browser shell → "event not found"; avoid `!` in
  eval strings or single-quote them.

## Battery (all run from suite dirs; total 850 checks)
daily 113 · armory 72 · race-lock 32+1skipped · contribution 31 · monetization 161 · revelation 107 ·
leader-xp 40 · atlas 191 · heroes 103 — 0 failed. Build `bun run build` exit 0. publish.sh exit 0.
