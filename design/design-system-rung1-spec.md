# Design System — Rung 1 Spec (designer grounding pass → engineer build)

> Filed by lead 2026-09-12 from designer grounding session 4d3e9fec. **Lead decisions ADOPTED (delegated creative authority):**
> 1. **Asart primary stays gold** `#ffd166` (≡ purity gold) — disambiguation via Circuit shape channels (55%-alpha fill + flag chip vs white-gold radiating sigil + PURIFIED label). Cheaper than a palette fork; revisit if live war data shows confusion.
> 2. **Success/positive = ember family** — emerald-300 is RETIRED from semantic duty (may survive as Draconian flavor only). Radiation/Chorus = hazard teal. One accent family per meaning.
> 3. **Battles-as-Circuit-segment** (Map | Battles | World) — interpretation of war-spec B2's "war-phase Battles tab": a third segment inside the Circuit tab, visible only during war phases, keeping 5 tabs forever. Same surface/scope as the ratified spec; recorded here as adopted.
> Nav target corrected: live client has **7 tabs** → consolidate to **5**: `Cradle · Expeditions · Lab · Armory · Circuit` (Codex folds into Cradle; Contribution becomes Circuit "World" segment).

---

## A. TOKEN SYSTEM (engineer: one `@theme` block in app.css — Tailwind v4)

### A.1 Surfaces — "Blacksite Terminal" base
Current client: `#070910` base, `#0b0e16` modals, `black/30` cards, `white/5–15` borders. Canonical:

| Token | Hex | Use |
|---|---|---|
| `--surf-0` | `#070910` | page base, map frame (keep live base; OLED-safe) |
| `--surf-1` | `#0b0f14` | header, chrome, sticky bars |
| `--surf-2` | `#11161d` | card / panel |
| `--surf-3` | `#161d26` | raised card, sheet, modal |
| `--surf-4` | `#1c2530` | hover fill, input fill |
| `--line` | `rgba(163,173,187,0.16)` | card border, hairlines |
| `--line-strong` | `#22303c` | header rule, inputs, focus-adjacent |
| `--line-faint` | `rgba(163,173,187,0.08)` | list dividers only |

Text (all ≥4.5:1 on surf-2/3):

| Token | Hex | Ratio | Use |
|---|---|---|---|
| `--text-1` | `#e7e9ea` | ~15:1 | primary, headings |
| `--text-2` | `#9aa4b2` | ~7.5:1 | body/secondary (replaces gray-400) |
| `--text-3` | `#7d8896` | ~5.0:1 | muted labels/captions — ≥12px only |
| `--text-disabled` | `rgba(154,164,178,0.45)` | — | decorative only, never informational |

**P1 contrast debt:** `text-gray-500` `#6b7280` ≈ 3.7:1 on panels — lift ALL instances to `--text-3`; `gray-600` placeholders same or `--text-disabled`.

### A.2 Functional colors — GLOBAL (meaning, never race-owned)
| Token | Hex | Semantics |
|---|---|---|
| `--ember` | `#ff9d3c` | resources, positive, Earned, primary CTA fill (8.7:1) |
| `--ember-soft` | `#ffbe80` | ember text on dark (loot numerals) |
| `--hazard` | `#4fd8c8` | radiation, Chorus (meter, chips, vignette) |
| `--hazard-soft` | `#7fe8dc` | hazard text on dark |
| `--corrupt` | `#b14ec4` | corruption FILL/glow/decor only (taint meter fill, zone fog) |
| `--corrupt-text` | `#e07cf0` | corruption TEXT on dark (7.2:1) |
| `--purity` | `#ffd166` | Oracle, Unbound, clean, Devotion, claimed, purified (12.6:1) |
| `--danger` | `#ef4444` | destructive, danger (4.8:1); `--danger-soft` `#f87171` (6.5:1) for small text |
| `--focus` | `#ffd166` | focus ring, 2px outline + 2px offset |

Migration: CTAs amber-400→ember; **Devotion panel indigo-400→purity gold**; **emerald-300 success retired** (→ ember family).

### A.3 Race accents — identity ONLY (fill/tint vs text pairs; text column ≥4.5:1 on surf-3)
| Race | Fill/tint | Text | Secondary |
|---|---|---|---|
| Grays | `#9ad7e6`@8–14% | `#9ad7e6` (11.4:1) | steel `#5b7f95`; owl-eye amber RESERVED for attention blinks |
| Nephilim | `#c96f3f`@10–16% | `#dc8f5f` (6.7:1) | bone `#cfc4b0` |
| Draconians | `#3ad29b`@8–14% | `#58e0ab` (9.4:1) | serpent-gold `#d4b64c` |
| Anunnaki | `#e8d9b2`@8–14% | `#e8d9b2` (12.9:1) | bronze `#d9a441`; terracotta `#a3472b` for over-extension |
| Asart | `#ffd166`@8–14% | `#ffd166` (12.6:1) | seafoam `#7fd8c8`, dusk-violet `#8b7bd8` |
| Watchers | `#b48cff`@8–14% | `#c9a4ff` (7.0:1) | razor-cyan `#5fd4e6`; grade-gold = functional purity |

Per-race tokens: `--race-<id>-tint` / `-accent` / `-text` / `-glow`. **Single source of truth:** update `RACES[].accent` in `game/races.ts` to canon fill hexes + add `accentText` (Armory sigil alpha math survives).

Adjacency guards: (1) Asart gold ≡ purity gold — shape channels (decided above); (2) Draconian green vs hazard teal — identity green never adjacent to radiation semantics; (3) Nephilim rust vs ember — rust text ≥13px, ember never on Nephilim chrome.

### A.4 Type scale (system fonts, rem, tabular numerals)
`--font-sans`: system-ui stack · `--font-mono`: ui-monospace stack. No webfont purchases. `.num` utility = mono + `font-variant-numeric: tabular-nums` — **every** timer/currency/%/score/cost/count renders through it ("cheapest premium upgrade").
display 1.75rem/1.1 · 2xl 1.5rem · xl 1.25rem · lg 1.125rem · base 0.875rem/1.45 · sm 0.8125rem · caption 0.75rem (12px floor for data) · micro 0.6875rem→**11px min**, uppercase tracked `+0.08em` only, never body copy. Fix ~20 `text-[10px]` instances.

### A.5 Spacing / radii / motion / glow
Spacing 4px grid (2…64). Radii: sm 6 / md 10 / lg 14 / xl 20 (migrate rounded→6, rounded-lg→10, rounded-xl→14, rounded-2xl→20).
Motion: fast 150ms / base 200ms / sheet 300ms; ease-out `(0.22,0.61,0.36,1)`; enter = fade+translateY(8px); meters fill linear; **pulse 1.4s RESERVED for live-war items only**; `prefers-reduced-motion: reduce` → zero duration (currently missing).
Glow: 3 steps (rest 1px/40% · hover +10px/22% · celebrate +18px+36px/35%/18%). Glow-3 ONLY for real dents (first purify, deed cosmetic, pass capstone, Contribution Award). Families: purity-gold / hazard-cyan / corrupt-magenta / ember / race tint.

## B. COMPONENT INVENTORY (15 primitives)
NEW: Sheet (bottom sheet, drag handle, 85% max, 300ms — needed by Circuit zones, battle decision windows, storefront), TabBar (bottom, 56px, 5 items), SegmentedControl (44px), `.chip` utility (22–24px, 12px text), `.num` utility.
SKIN (token restyle of existing inline patterns): Button (primary ember / secondary / ghost / destructive / premium-gold — sizes sm36/md44/lg48, busy = label swap no spinner), Card (default/subtle/accent-tint/interactive; locked = 75% opacity + glyph, labels never <4.5:1), Meter (`role="progressbar"`, linear fill, never pulses except live-war), ListRow (icon 24 + label + `.num` value + subline; done/claimed/disabled states), Toast (semantic variants, 4s, no progress-bar countdown), EmptyState (line glyph + one line, never illustration/anim), Header/StatusBar (surf-1, **header icon buttons 34px→44px mobile**), Modal (centered ≥640px / bottom-sheet <640px; KEEP destructive-confirm grammar), ResourceChip/StatBlock.
EXISTS + token restyle: Tooltip (keep 350/480ms + slop as-is — battle-tested), TimerReadout (`.num` + format, right-aligned, no pulse).

## C. THE CIRCUIT — MAP TREATMENT (re-skin live AtlasTab; war-overlay-ready)
- Node anatomy: rim r16, heart r26, cradle r18, near r12; **invisible hit circle r26 (52px ≥ 44px floor)**; tier pips 9→11px; keep client tier colors T1 steel `#4d7cc7` / T2 violet `#a78bfa` / T3 ember `#fb923c`; near-ring dim 0.6; ★ on the race-heart zone.
- **Three zone states — never color-only (shape + label + hue):** Corrupted = desaturated fog + dashed hatch overlay + `CORRUPTED` chip + corrupt step-1 glow; Contested = holder accent 55% + **double ring** + `CONTESTED` chip + world-flag chip + purity step-2 pulse (live-war allowed); Purified = white-gold + **radiating 8-point sigil** + `PURIFIED` chip + purity step-3 glow. Grayscale contract: hatch ≠ ring ≠ star.
- Watchers world: "annotated examination" motif — ruled-paper backdrop 6%, chalk chips, violet marginalia.
- Chorus heart: `#7f1d1d` base + ember glyph ring + 1.6s pulse (live-Chorus signature), `CHORUS STRONGHOLD` chip, `THE PRIZE · THE THREAT` label. Never a claimable neutral prize.
- Edges: road solid 2px `#8f9bb3`@55 (near `#5b6472`), ruin-pass dashed `5 5` `#b45309`, severed broken `#7f1d1d`; war phase adds animated dashes on held/haul routes only + cut-trace flash (gold).
- Interaction: tap → Sheet; long-press → Tooltip; double-tap suppressed; **add `tabIndex` + `aria-pressed` + Enter-to-open (desktop)**; bottom bar war-phase `[FOBs▾][Legend▾][score .num]`.
- Sheet detail (war phase): zone name + state chip + tier pip + "Because" line + yield band + **HOLD/TAKE/PURIFY** 48px row (PURIFY gold, earned-lock) + guardrail countdowns (`TimerReadout` chips) + FOB strip (4 pips Landing→Garrison→Foundry→Arsenal/Citadel).
- **A11y flag:** SVG labels 9–10px — raise to 11px min, zoom-coupled; add `aria-label` state per node; test Circuit at 375px width before shipping.

## D. STOREFRONT SURFACES (premium, honest, G1–G4-bound)
- **Entry: header Ledger button** (Scrip + Votives `.num` chips) → full-screen sheet overlay. NOT a 6th tab. No badge dots, no countdowns, ever.
- Featured strip → catalog rows (cosmetic category glyphs, Votive price gold chip, `OWNED ✓`; **deed cosmetics in the commemorative section (`COMMEMORATIVE` chip)**) → 3 head-start packs (contents + play-equivalent "≈ one week of steady explorations at a casual pace"; NO trust footer — owner ruling 2026-09-13, the G1–G4 guardrails are internal) → pass strip: 28-node rail, two lanes per tier, gold premium CTA (the only gold CTA in the app), footer "Passes never expire. Unclaimed items return next season."
- Confirmation sheet restates item + price + quiet "You are about to spend N Votives". Wallet renders server state only. Honest levers: pass strip is the entry purchase; previews gorgeous-by-tokens; deed cosmetics advertise the pass by sitting un-buyable in the store.

## E. NAV CONSOLIDATION — 7 → 5
`Cradle · Expeditions · Lab · Armory · Circuit` (bottom TabBar, 56px, line icons 24px stroke 1.5–2, filled only for active + resource glyphs).
- Codex → folds into Cradle as "Legends of the Shatterlands" section (or header Lore icon sheet if scroll too long).
- Contribution → Circuit **World** segment (own rank card + top-10 verbatim).
- War phase → third segment **Battles** (visible only in war phases) — ADOPTED interpretation of B2.
- New CSS uses `circuit-*` classes (never "atlas") so the label sweep never touches tokens.

## F. ENGINEER BUILD ORDER (post-Heroes)
1. `@theme` token block in app.css (A.1–A.5) + `.num`/`.chip` utilities → contrast audit (gray-500 sweep, 10px→11/12px, header icons 44px).
2. Race accent single-source (races.ts accent + accentText) + Devotion panel gold migration.
3. 7→5 nav pass (Codex fold, Contribution segment, TabBar) + Circuit re-skin + label sizes.
4. Sheet + SegmentedControl + storefront overlay shell (storefront still disabled — seam only).
5. WCAG AA contrast acceptance gate into the battery (new suite).