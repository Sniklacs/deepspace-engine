# THE CIRCUIT — Map Label & Wide-Desktop Layout Spec (implementation-ready)

**Author:** designer delegation · **Date:** 2026-09-22 · **Status:** implementation-ready (attribute/CSS level) — the engineer builds without re-deciding names, tiers, collision, or canvas math.
**Scope:** zone **labels** + **desktop canvas layout only**. The map's information architecture, node count (30), legend, zoom controls, rail, sheets and war reserves are **unchanged**. `map.ts` is **not edited** (its layout law + `atlas-tests` §11 stay green).
**Verified against:** live screenshot `/home/team/shared/live-circuit-2.png` @1280×1280, plus source read of `CircuitPage.tsx`, `map.ts`, `zones.ts`, `circuit-tokens.ts`, `app.css`, `atlas-tests/atlas-verify.ts`, `wcag-tests/wcag-verify.ts`.

---

## 0. Root cause (confirmed, two independent defects)

**D1 — "The" labels.** `labelText()` (`CircuitPage.tsx` ~L557) does `name.split(" ")[0]` at the mid zoom tier. 20 of 30 labels start with "The" (19 zone names + the heart's `THE CHORUS-HELD HEART`), so the mid tier renders the article. The spec (`circuit-fullscreen-page.md` §2.3) assumed names like "Forge" / "Super-Collider"; the actual catalog (`zones.ts`) is "Forge Valleys" / "Super-Collider Ruins" / "The Quarry-Edge Works". **The rule, not the string, is the bug.**

**D2 — Portrait canvas on a wide stage.** `ATLAS_CONFIG.viewBox = 560×760` (aspect 0.737) and `scale = min(stageW/560, stageH/760)`. At 1280×1280 the stage is 980×643 → `min(1.75, 0.846)` → **height-bound at 0.846** → the drawn pane is 474×643 in a 980px-wide stage: **52% of the map area is dead space.** The stage *has* the width; the canvas aspect throws it away.

Two more things the fix must respect, both measured in source:
- `baseScale = max(fit, 22/26 = 0.8462)` (the 44px hit floor, §2.1 rule 4). At 1280×1280 `fit ≈ 0.846`, so the effective scale is **0.8462**, and `labelPx = 11 × 0.8462 = 9.3px` → today's desktop labels are already **below the 11px law** *and* reduced to articles.
- The label elements sit under nodes over traces; a conductor lane (`#8f9bb3` @0.55) under a glyph composites to ≈3.2:1 — below AA for 11px text. Fixed in §5.

---

## 1. Deliverable A — display-name system for all 30 nodes

### 1.1 The law
1. A node has **two display strings, never more**: `full` and `compact`. `node.name` / the Sheet title / `aria-label` / tooltips keep the **published catalog name unchanged** — the map label is a *display name*, a distinct thing.
2. **No string may begin with an article.** A leading `The ` is **DROPPED** in both forms. No tier re-derives a string from the published name by splitting on spaces — the table *is* the source.
3. `full` = published name minus a leading `The `, except three documented overrides (below).
4. `compact` = the shortest distinctive form. `compact === full` is allowed when the full name is already minimal.
5. **Every one of the 60 strings is unique** — no two nodes share a string in either form (machine-asserted; see §6).

### 1.2 The table (30/30, from `zones.ts` + `map.ts`)

| # | node id | kind / tier | published name (`zones.ts`) | `full` | `compact` |
|---|---|---|---|---|---|
| 1 | forge-valleys | rim T1 | Forge Valleys | Forge Valleys | Forge |
| 2 | rust-gardens | rim T1 | The Rust Gardens | Rust Gardens | Rust |
| 3 | ash-columns | rim T1 | The Ash Columns | Ash Columns | Ash |
| 4 | quarry-edge | rim T1 | The Quarry-Edge Works | Quarry-Edge Works | Quarry |
| 5 | shard-fields | rim T1 | The Shard Fields | Shard Fields | Shard |
| 6 | boneyard | rim T1 | Boneyard Ranges | Boneyard Ranges | Boneyard |
| 7 | shattered-academies | rim T2 ★ | The Shattered Academies | Shattered Academies | Academies |
| 8 | murmur-sumps | rim T2 | The Murmur Sumps | Murmur Sumps | Murmur |
| 9 | titan-breaks | rim T2 | The Titan Breaks | Titan Breaks | Titan |
| 10 | glass-harbor | rim T2 | The Glass Harbor | Glass Harbor | Glass |
| 11 | wailing-towers | rim T2 | The Wailing Towers | Wailing Towers | Wailing |
| 12 | quantum-facility | rim T2 | Quantum Research Facility | Quantum Research Facility | Quantum |
| 13 | deep-vaults | rim T3 | The Deep Vaults | Deep Vaults | Vaults |
| 14 | null-engine | rim T3 | The Null Engine | Null Engine | Null |
| 15 | starfall-core | rim T3 | The Starfall Core | Starfall Core | Starfall |
| 16 | collider-ruins | rim T3 | Super-Collider Ruins | Super-Collider Ruins | Collider |
| 17 | **dark-matter-observatory** | **heart** T3 | Dark-Matter Observatory | **Chorus-Held Heart** ⟡ | **Chorus Heart** ⟡ |
| 18 | hollow-warrens | near | The Hollow Warrens | Hollow Warrens | Hollow |
| 19 | lantern-reach | near | The Lantern Reach | Lantern Reach | Lantern |
| 20 | tram-yards | near | The Tram Yards | Tram Yards | Tram |
| 21 | observatories | near | Observatories of the Still Dark | **Observatories** ⟡ | **Observatories** ⟡ |
| 22 | relay-spires | near | The Relay Spires | Relay Spires | Relay |
| 23 | outer-ruins | near | Outer Ruins | Outer Ruins | Outer |
| 24 | cinder-farms | near | Cinder Farms | Cinder Farms | Cinder |
| 25 | pump-stations | near | The Pump Stations | Pump Stations | **Pumps** |
| 26 | sigil-plaza | near | Sigil Plaza | Sigil Plaza | Sigil |
| 27 | hearth-lanes | near | The Hearth Lanes | Hearth Lanes | Hearth |
| 28 | grain-silos | near | The Grain Silos | Grain Silos | Grain |
| 29 | watchtower-row | near | Watchtower Row | Watchtower Row | Watchtower |
| 30 | cradle | cradle | The Cradle | Cradle | Cradle |

**⟡ = the three documented overrides** (the only places `full` ≠ published-minus-“The”):
- `dark-matter-observatory` → **"Chorus-Held Heart"**: the node's map identity is its role (legend: "THE CHORUS-HELD HEART"); its published name stays in the Sheet/aria/tooltip.
- `observatories` → **"Observatories"**: the published tail ("of the Still Dark") is 31 chars ≈ 234 viewBox units at 11px — wider than any row gap on the map. It is 23 chars; a map label is a locality marker; the poetic name lives in the Sheet, tooltip and expedition list.
- `cradle` → **"Cradle"** (published "The Cradle").

### 1.3 Shared head-noun audit (the ambiguity traps, all resolved)
- `The Wailing Towers` vs `Watchtower Row` → **Wailing / Watchtower** (distinct; neither can collapse to "Tower").
- heart vs `The Hearth Lanes` → **Chorus Heart / Hearth**. (Never "Heart": "Heart" and "Hearth" differ by one letter and both are 5–6 chars at 11px — an explicit trap we refuse.)
- `Observatories` (near) vs the heart's published "Dark-Matter Observatory" → the heart's label is **"Chorus-Held Heart"**, so the two "observatory" readings never compete.
- `Shard Fields` vs `Shattered Academies` → **Shard / Academies** (not "Sh…" twins).
- `Forge / Rust / Ash` are terser than the rest but each is unique, and all six rim-outer compacts read as a clean single-word row.

### 1.4 What each zoom tier renders (exact)

| tier | trigger (`scale`) | name shown | font (viewBox units) | rendered px | pips `T1/T2/T3` | heart sub-label | war chips |
|---|---|---|---|---|---|---|---|
| **full** | `scale ≥ 1.00` | `full`, **demoted to `compact` only if it does not fit** (§2) | `11` | ≥ 11px (grows with zoom) | shown | shown | shown (when war ships) |
| **mid** | `0.55 ≤ scale < 1.00` | `full`, **demoted to `compact` only if it does not fit** (§2) | `clamp(11/scale, 11, 20)` | **exactly 11px** | shown | **shown** (amended — was hidden at mid) | hidden |
| **low** | `scale < 0.55` | **none** — `visibility: hidden` | — | — | hidden | hidden | hidden |

- **Why `fontUnits = 11/scale` at mid:** the old tier dropped the *type* to 6–11px (9.3px today) to make room. We keep the type at the 11px floor and buy the room from the wide canvas (§3) + the ladder (§2) instead. Nothing is ever rendered below 11px: at `scale = 0.55`, `11/0.55 = 20` units → 11px; below that the tier is `low` and the text is **hidden, never shrunk** (the spec's own §2.3 principle, with the threshold corrected to the real floor).
- The same `fontUnits` law applies to **every text node in the map SVG** — names (`cl-full`), the heart sub-label (`cl-sub`), and the tier pips (`cl-pip`): all are text and carry meaning. The ★ / 🔥 / 🔰 glyph sigils are symbols, not text, and keep their authored sizes.
- The tier class on the SVG root (`circuit-zoom-full|mid|low`) and the low-tier hide rules stay exactly as they are. **The name string is chosen in JS, not by a CSS class** — that is the fix: a class cannot know that "The Quarry-Edge Works" differs from "The Cradle".
- `aria-label` (full sentence, e.g. "Forge Valleys — Burning-Rim territory, Tier 1 (score 0.30)."), the `<title>`, the node Sheet and tooltips are **untouched** — hidden labels never remove information (the label layer is already `aria-hidden`).

---

## 2. Deliverable B — the collision rule (one rule, justified)

**Rule: a deterministic priority ladder with a per-node two-string ladder — `full` → `compact` → hidden. No offsets. No text below 11px.**

### 2.1 Algorithm (pure, geometry-only — unit-testable)
Inputs: nodes (`id, x, y, kind`), `{ tier, fontUnits, canvasW, kx, selectedId }`.

```
K_CHAR    = 0.58   // viewBox units of advance per character per font unit
                   // (Title Case, weight 500, 'Segoe UI',system-ui — deliberately ~8% over-generous,
                   //  which is the guarantee: the estimate over-states width, so real glyphs never overlap)
LABEL_PAD = 6      // min horizontal gap between two placed labels (units)
EDGE_PAD  = 4      // min gap from the canvas edge (units)
dy(kind)  = heart 42 · cradle 30 · rim 30 · near 26        // unchanged, existing labelDy
width(t)  = t.length * K_CHAR * fontUnits
rect(n,t) = { y0: n.y + dy - fontUnits, y1: n.y + dy + 0.25*fontUnits,
              x0: canvasX(n.x) - width(t)/2, x1: canvasX(n.x) + width(t)/2 }
```
1. `tier === "low"` → return no labels (all hidden).
2. **Priority order** (deterministic, no ties): selected node → heart → cradle → rim T3 → rim T2 → rim T1 → near; ties broken by `(y, canvasX, id)`.
3. **Pass 1** — walk in priority order, try `full`. Place if: the rect is inside `[EDGE_PAD, canvasW − EDGE_PAD]`; it does not overlap any **placed** rect on a vertically-overlapping band (inflate horizontally by `LABEL_PAD`); and it does not overlap any **other node's** circle box (`[x±r, y±r]`, inflated by 2).
4. **Pass 2** — walk the still-unplaced nodes in the same order, try `compact` under the same tests. (`compact === full` nodes are simply retried once — harmless.)
5. Still unplaced → **no label**. The node keeps its circle, ring, tier pip, ★, aria-label, tooltip and Sheet. Nothing else changes.

### 2.2 Why this rule
- **Two passes, full before compact, then a shared greedy walk.** Per-node "try full, else immediately compact" would let a low-priority node's long full name block a high-priority neighbour's name that *would* have fit had the first taken its compact form. Two passes maximise the number of **complete** names while still guaranteeing zero overlap.
- **Abbreviate, then hide** (rather than hide immediately): the compact form is real information, and every node in the table has one.
- **Offsetting is rejected on measured evidence:** label bands are ~`fontUnits` tall and adjacent rows are only 62–75 units apart; a label moved above its node lands ~6 units from the row above's label. There is no vertical room for a stagger. (Right-anchoring instead of centring was also tested on paper: it consumes the same interval per row, so it neither helps nor hurts — it only breaks the map's symmetry and can place text across the neighbouring node's ring.)
- **Shrinking below 11px is rejected** — it is the design law, and it is what produced the current failure.
- The rule is deterministic from geometry alone, so `atlas-tests` can prove "no two visible labels overlap" for every world and every canonical viewport instead of trusting a screenshot.

### 2.3 Worked resolution at the owner's viewport (1280×1280, §3 geometry)
Predicted: **all 30 nodes labelled — 29 `full`, 1 demoted** (`relay-spires` → `Relay`, squeezed by "Observatories" on the 78-unit near-outer gap). Today's view shows 30 labels of which 20 read "The". (The test asserts `≥ 28 visible`, so minor jitter differences cannot flake it.)

---

## 3. Deliverable C — how the map fills a wide desktop

### 3.1 Decision: an **aspect-aware render canvas + a uniform horizontal scale of the authored x-axis**
- **Non-uniform fit of the canvas is REJECTED** — it makes node circles ellipses, makes the r26 tap circle an ellipse (breaking the 44px floor asymmetrically), and stretches glyphs.
- **Re-authoring node coordinates per aspect is REJECTED** — `map.ts` coordinates *are* the world geography, and `atlas-verify.ts` §11 asserts the band/x-margin/spacing law against the authored 560×760 canvas for every world. Re-authoring means per-aspect authoring for six worlds and a rewritten law.
- **Chosen:** derive a *render* canvas width from the stage aspect, and map authored `x` through one affine, monotone, centre-anchored scale `kx`. Radius, `y`, and font units are untouched.

### 3.2 The rule (exact, one scalar)
```
BASE_W = 560, BASE_H = 760                         // ATLAS_CONFIG.viewBox — READ ONLY, never edited
CENTER_X = BASE_W / 2 = 280

aspectStage = stageW / stageH
aspect      = clamp(aspectStage, BASE_W/BASE_H /*0.7368*/, ASPECT_MAX /*1.60*/)
canvasW     = Math.round(BASE_H * aspect)          // 560 … 1216 ; canvasH = 760
kx          = canvasW / BASE_W                     // 1.000 … 2.171
canvasX(x)  = canvasW/2 + (x - CENTER_X) * kx      // apply to EVERY node x and BOTH edge endpoints
```
`ASPECT_MAX = 1.60` is the only tunable. At 1.60 the widest row (≈464 authored units) spans ≈1008 units of a 1216-wide canvas; beyond that the web's diagonals flatten toward a straight line and stop reading as a circuit, while the widest rows already have ≈2.2× their authored room. The fallback if the owner dislikes the wide web at all: `ASPECT_MAX = 1.0` (a gentler 1.36× stretch) — one constant, no other change.

### 3.3 Why it is safe (the four proofs)
1. **Fill.** Inside the band, `canvasW = 760·stageW/stageH`, so `stageW/canvasW = stageH/760` → `fit_x = fit_y` → the canvas **exactly fills the stage** on both axes (that is the whole point of aspect-matching). Outside the band (ultra-wide), the map is height-fit and centred: at 2560×1440 the letterbox is ~23px per side.
2. **Margins.** The authored x-extremes over every world (slots ± jitter 6) are `xMin ≈ 44`, `xMax ≈ 513` → offset from centre ≤ 236. After scaling: `x' = 0.5·canvasW ± 0.4214·canvasW` → **7.86% margin on every canvas width**, above §6.1's 6% floor, by construction.
3. **Spacing.** `d'² = (kx·Δx)² + Δy² ≥ Δx² + Δy²` for `kx ≥ 1` (always, since the aspect floor forbids compression) → §2.2's same-row ≥ 60 and pair ≥ 52 laws hold or improve, in canvas units.
4. **Shapes and taps.** `r` and all font sizes are in units and only `x` is transformed → circles stay circles, glyphs stay unstretched, and the hit circle still renders `26 × max(fit, 0.8462)` CSS px — the 44px floor is untouched.

### 3.4 Mobile (390px) — the no-regression proof
At 390×844 the stage is 390×692 → `aspectStage = 0.564 < 0.7368` → **`aspect` clamps to the authored ratio → `canvasW = 560`, `kx = 1.0` → the canvas is numerically identical to today's**, and `scale = max(fit 0.696, 0.8462) = 0.8462` exactly as today (same pan, same pinch, same hit floor). **The geometry change is a desktop-only change, by construction.** What *does* change on mobile is the label type: 11px instead of 9.3px, so the two tightest rows (near-outer 77–103-unit gaps, near-inner 80-unit gaps) demote/hide 2–5 labels via the ladder. That is the intended trade (legible names instead of overlapping 9px ones) and it is the reason the ladder exists. Test-width regression watch: 390 (must render identically to today's geometry), 768 (gains width: canvas 669, aspect 0.88), 1024 (first desktop), 1280, 1440.

### 3.5 Worked numbers (the engineer can check these directly)

| viewport | stage (rail 300 / chrome 56) | aspect → canvas | `kx` | `fit`→`scale` | tier → fontUnits → rendered | result |
|---|---|---|---|---|---|---|
| 390×844 (phone) | 390×692 | 0.564 → **560×760** | 1.000 | 0.8462 | mid → 13.0 → **11.0px** | unchanged geometry; 474×643 CSS in a 390 stage (pan, as today) |
| 768×1024 (tablet) | 768×872 | 0.880 → 669×760 | 1.195 | 1.147 | full → 11 → 12.6px | fills stage (was 63px letterbox each side) |
| 1024×768 | 724×712 | 1.017 → 773×760 | 1.380 | 0.937 | mid → 11.7 → 11.0px | fills stage |
| **1280×1280 (owner)** | **980×643** | **1.524 → 1158×760** | **2.068** | **0.8462** | **mid → 13.0 → 11.0px** | **fills exactly: 980×643 CSS, r=22.0px hit circles; content width 474px → ~976px** |
| 1440×900 | 1140×844 | 1.350 → 1026×760 | 1.832 | 1.111 | full → 11 → 12.2px | fills stage |
| 1920×1080 | 1620×1024 | 1.582 → 1202×760 | 2.147 | 1.347 | full → 11 → 14.8px | fills width; ~12px vertical letterbox |
| 2560×1440 | 2260×1384 | 1.633 → clamp 1.60 → 1216×760 | 2.171 | 1.821 | full → 11 → 20px | ~23px letterbox per side |

### 3.6 Implementation notes (the two things that bite)
1. **Hysteresis.** Compute the canvas inside the existing `measure()` (ResizeObserver on the stage) and only commit a new `canvasW` when `|aspectStage − aspectLast| / aspectLast > 0.02`. Without it, the stage's scrollbar can toggle `clientWidth` and re-enter the observer.
2. **Re-centre on canvas change.** `canvasW` must join `scale` in the effect deps: add the canvas width to the effect that keeps the zoom anchor, and treat a canvas change like `⇱` (re-centre with `scrollTo(tx, ty)`); the previous scroll offsets mean nothing on a new canvas.

---

## 4. Deliverable D — token / contrast law (unchanged palette, one addition)

- **Zero new hues.** Labels keep `LABEL_COLORS.node | heart | cradle` from `circuit-tokens.ts`; the renderer keeps **zero hex literals** (`wcag-verify.ts` §8 asserts this — put any new constant in `circuit-tokens.ts`, never in the page).
- **Add one token: the label halo.** `LABEL_COLORS.halo = "#070910"` (documented ≡ `--surf-0`; rung-1 §A.1). Applied to the name/sub-label/pip text as
  `<text paintOrder="stroke" stroke={LABEL_COLORS.halo} strokeWidth="3" strokeLinejoin="round">`.
  Rationale: a conductor lane (`#8f9bb3` @0.55 over surf-0 → ≈(82,89,106)) crossing under a glyph drops 11px label text to ≈3.2:1 — **below AA**. The halo fixes the composite at ≈**9.1:1** over any underlay (the composited label colour `rgba(226,232,240,0.75)` on `#070910`; the spec's 15.17:1 was the un-composited figure). It is the standard map-label technique and it is what makes the names read crisply over the web — the visible "design" gain the owner is asking for. No race accent, no new hue, one token, machine-checkable (§6).
- **Never colour alone.** Tier pips keep `TIER_COLORS[tier]` **and** the `T1/T2/T3` string **and** the legend entry; every label string carries the name. Hiding a label at the low tier loses no encoding (pips hidden too, legend + Sheet + aria-label carry it).

---

## 5. Change list (file by file, attribute level)

**NEW — `site/src/game/circuit-labels.ts`** (pure, no React, no DOM, importable by the test suites):
```
export const DISPLAY_NAMES: Record<string, { full: string; compact: string }>   // §1.2, 30 entries, no hex, no colour
export const LABEL_DY = { heart: 42, cradle: 30, rim: 30, near: 26 } as const
export const K_CHAR = 0.58, LABEL_PAD = 6, EDGE_PAD = 4
export const ASPECT_MIN = 560 / 760, ASPECT_MAX = 1.60
export function canvasFor(stageW: number, stageH: number): { w: number; h: number; kx: number }
export function canvasX(x: number, w: number, kx: number): number
export function labelTier(scale: number): "full" | "mid" | "low"      // ≥1.00 / ≥0.55 / else
export function labelFontUnits(tier, scale): number                    // 11 | clamp(11/scale,11,20) | 0
export function resolveLabels(nodes, { tier, fontUnits, canvasW, kx, selectedId }):
  Map<string, { text: string; cx: number; cy: number }>                // §2.1
```

**`site/src/components/CircuitPage.tsx`**
1. `measure()` also stores `canvas = canvasFor(stageW, stageH)` (with the 2% hysteresis of §3.6); state `{ w, h, kx }`.
2. `<svg viewBox={`0 0 ${canvas.w} ${canvas.h}`}>`; inner div size `canvas.w * scale × canvas.h * scale`.
3. Every node `cx` and both endpoints of every `<line>`/severed stub go through `canvasX(x, canvas.w, canvas.kx)`; **all `y`, all `r`, all stroke widths unchanged.**
4. Tier + font: `const tier = labelTier(scale)`, `const fontUnits = labelFontUnits(tier, scale)`; set `fontSize={fontUnits}` on `cl-full`, `cl-sub`, `cl-pip`; the text element renders `resolved.get(n.id)?.text ?? DISPLAY_NAMES[n.id].full` and the CSS low-tier class hides it.
5. `resolveLabels(...)` memoised on `[canvas.w, canvas.kx, scale-tier, sel]`; delete `labelText()` entirely.
6. Keep the `+ / − / ⇱` controls, the legend, the rail, the sheet, and the layer order **untouched**.

**`site/src/game/circuit-tokens.ts`** — add `halo: "#070910"` to `LABEL_COLORS` with the `≡ --surf-0` comment.

**`site/src/styles/app.css`** — delete the single line `.circuit-zoom-mid .cl-sub { visibility: hidden; }` (keep `.circuit-zoom-low .cl-sub`). Nothing else in the zoom-tier block changes.

**`site/src/game/map.ts` — NO EDIT** (no coordinate, config or header change).

---

## 6. Tests — what to add / change

**`/home/team/shared/atlas-tests/atlas-verify.ts`** — add section **"12 · CIRCUIT LABEL + CANVAS LAW"** (import from `site/src/game/circuit-labels.ts`; existing §1–§11 stay untouched and must stay green):
1. `DISPLAY_NAMES` keys **exactly equal** the node ids `generateAtlas()` produces (a new zone can never ship unlabelled — it fails here instead of rendering "The").
2. Both forms of all 60 strings: never start with `The `, never match `/^the$/i`, length ≥ 4.
3. **Pairwise uniqueness across nodes** (both forms): no two distinct nodes share any string.
4. `full` === published `zones.ts` name minus `/^The /`, except the 3 documented overrides (§1.2) — the table cannot silently drift from the catalog.
5. **Canvas law** — per world × canonical stages (390×844, 768×1024, 1024×768, 1280×1280, 1440×900, 1920×1080, 2560×1440): `aspect ∈ [0.7368, 1.60]`, `kx ≥ 1`, every `canvasX(x) ≥ 0.06·canvasW` and `≤ 0.94·canvasW`, same-row spacing ≥ 60 canvas units, any pair ≥ 52.
6. **Label law** — same matrix: every rendered string is one of that node's two forms; **no two visible label rects overlap**; every visible rect inside `[0, canvasW]`; no visible string is an article; ≥ 28 of 30 nodes labelled at 1280×1280 and 1440×900, ≥ 20 at 390×844.
7. **Font law** — `labelFontUnits(tier, scale) * scale ≥ 11 − 1e-9` for every `scale ≥ 0.55`; `resolveLabels()` returns empty for every `scale < 0.55`.

**`/home/team/shared/wcag-tests/wcag-verify.ts`** — extend §8: `LABEL_COLORS.halo` parses to a hex and **equals the `--surf-0` token** read from `app.css`; and `circuit-labels.ts` contains **zero `#rrggbb` literals** (mirrors the existing "CircuitPage.tsx has ZERO hex literals" check). No existing check changes; no check currently asserts the "first word" rule, so nothing needs deleting.

**Manual:** re-shoot at 1280×1280 and 390×844; the DOM text dump of the SVG must contain **no node string that is an article**, and the canvas box must span ≥ 98% of the stage width with ≤ 2% letterbox.

---

## 7. Spec amendments to `design/` (flag — do not silently contradict)

**Amendment 1 — `circuit-fullscreen-page.md` §2.3 is REPLACED** (its "first word only" rule is the root cause). New §2.3 text:
> **§2.3 Label zoom tiers (labels never render < 11px CSS).** The tier sets the *type size and visibility*; the *name string* comes from the display-name table in `game/circuit-labels.ts` (never from splitting the published name):
> | Rendered size | Name | Font | Pips / sub-label / chips |
> |---|---|---|---|
> | `scale ≥ 1.00` | `full` — demoted to `compact` only when a rectangle collision forces it | 11 units, ≥ 11px | shown / shown / shown |
> | `0.55 ≤ scale < 1.00` | `full` — same ladder | `clamp(11/scale, 11, 20)` units → **exactly 11px** | shown / **shown** / hidden |
> | `scale < 0.55` | none — `visibility: hidden` | — | hidden |
> A leading "The" is dropped from every display name; no two nodes may ever render the same string. Collisions resolve by the priority ladder **full → compact → hidden** (never below 11px, never offset). Classes stay `circuit-zoom-full|mid|low`; `aria-label` is unaffected.

**Amendment 2 — `circuit-fullscreen-page.md` §2.1:** rule 3 becomes *"**Fit:** `scale = min(stageW / canvasW, stageH / canvasH)`, centred, where the **render canvas** is derived from the stage aspect (new rule 8)."* New rules:
> 8. **Aspect-aware render canvas.** `aspect = clamp(stageW/stageH, 560/760, 1.60)`; `canvasW = round(760·aspect)`; authored `x` maps through `canvasX(x) = canvasW/2 + (x − 280)·(canvasW/560)`; `y`, radii and font units are untouched. The authored `ATLAS_CONFIG.viewBox` (560×760) remains the *authoring* canvas and is never edited.
> 9. Recompute the canvas on stage resize only when the stage aspect changes by > 2%, and re-centre the stage when it does.

**Amendment 3 — `circuit-fullscreen-page.md` §5 (colour table):** add the row `Label halo | LABEL_COLORS.halo ≡ --surf-0 | #070910 | paint-order:stroke, 3 units, round | name/sub-label over trace lines ≈9.1:1 — PASS`; footnote that the 15.17:1 figure is the un-composited label colour and the composited figure is 9.1:1 (still ≫ 4.5:1).

**Amendment 4 — §6.1:** add *"The render canvas (rule 8) may scale authored x by a uniform `kx ∈ [1, 2.17]`; the band/x-margin/spacing laws are stated on the authored 560×760 canvas and are preserved by that transform."* No band, count, tier or anchor changes.

**Amendment 5 — §7 / §8:** §7's "Labels ≥ 11px rendered CSS" gains *"(enforced by the `11/scale` font law; below it, labels hide)"*; §8's handoff checklist gains the four build items of §5 and the three test items of §6.

**No change needed:** `world-map-design.md` (the "first word" rule exists only in `circuit-fullscreen-page.md` — verified by search), `visual-pass-1-circuit.md` (recipes/colours unchanged; the halo is additive and lives in the token module), and `§1.2/§1.3/§1.4/§1.5/§4` (chrome, legend, rail, dock, World segment — all explicitly untouched per the brief).

---

## 8. Risks and open items for the lead
1. **The wide web is a real visual change** (the web reads wider/flatter on desktop). It is a *render* transform only — geography, tiers, edges and the authored layout law are untouched — and it is reversible with one constant (`ASPECT_MAX`).
2. **Mobile label count drops** (11px instead of 9.3px on fixed rows): a handful of the near-ring names demote to their compact form or hide on the two tightest rows. Layout geometry itself is provably unchanged (`kx = 1.0`, identical canvas). If the owner wants every mobile name visible, the only lawful lever is the canvas aspect floor — i.e. compressing the authored web, which the spacing law forbids. I recommend shipping as specced and reading the 390px screenshot.
3. **Sibling `split(" ")` sweep — DONE by the lead 2026-09-22.** `grep -rn 'split(" ")' site/src` returns exactly **two** call sites, and only the first is a name-truncation bug:
   - `src/components/CircuitPage.tsx:559` — `labelText()`, the bug this spec deletes. **The only name-truncating site in the codebase.**
   - `src/components/ResearchViews.tsx:419` — `chosen.accent.split(" ")[2] || "text-amber-200"`, parsing a Tailwind class string, not truncating a name. Harmless. (Noted in passing: that same line carries hardcoded `text-gray-300` / `text-amber-200`, i.e. off-token colours — a small token-hygiene cleanup for a later pass, not this one.)
   No `split(' ')` variant exists. No other surface truncates names this way.
4. **The label halo is additive** (one token, one attribute set). It is required for the AA claim to be true over trace lines; if the owner dislikes the look, the fallback is to degrade gracefully but the 3.2:1 case returns.

---

**Status: FULLY COMPLETE as a spec — implementation-ready.** Build order: new `circuit-labels.ts` → `CircuitPage.tsx` canvas/label wiring → `circuit-tokens.ts` halo → one CSS line → atlas-tests §12 → wcag-tests §8 extension.
