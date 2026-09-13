# THE CIRCUIT — Full-Screen Page + Tier Legend (Implementation-Ready Spec)

**Author:** designer delegation · **Date:** 2026-09-13 · **Status:** implementation-ready — the engineer builds from this without re-deciding layout, colors, legend copy, or scaling rules.
**Feature name is THE CIRCUIT** — never "Atlas". Module/route names (`map.ts`, `generateAtlas`) stay untouched (label sweep only); new classes use the `circuit-*` prefix.

**Canon sources (in order of authority):**
1. `design/design-system-rung1-spec.md` §A (tokens) / §C (circuit treatment) / §E (nav + segments)
2. `design/world-map-design.md` §3 (map visual spec, layout, legend)
3. `design/visual-pass-1-circuit.md` §2 (node-state recipes, verbatim) / §4 (race-contested fills) / §5 (contrast appendix)
4. `site/src/game/map.ts` — the ACTUAL node graph + tier math (`ATLAS_CONFIG`, `ZONE_PROFILES`, `importanceFor`; tiers T1 < 0.40, T2 0.40–0.70, T3 > 0.70)
5. `site/src/styles/app.css` — the live token block (values here are authoritative; e.g. `--text-3` is `#8490a0`)
6. `site/src/game/races.ts` — race accent single-source (`accent` / `accentText`)
7. `wcag-tests/wcag-verify.ts` — the contrast acceptance gate (`cd /home/team/shared/wcag-tests && bun run wcag-verify.ts`)

**Fiction framing:** the map is the shattered circuit-web of the old world. All copy below is in-universe myth; no real-world mappings, ever.

---

## 0. What changes (as-built today → target)

Today `CircuitTab` (`play.tsx` ~L2051) is a cramped tab segment: a `max-w-3xl` column holding a 360×520 SVG, a one-line legend, and the Contribution view as a "World" segment.

**Target:** when `tab === "circuit"`, `play.tsx` renders `<CircuitPage>` **full-bleed** — the map is the hero and fills the whole browser. The standard `Shell` header (resource-chip row + tab nav) and the bottom TabBar do **not** render on this tab. A slim 56px circuit chrome replaces them.

**Route decision (locked):** keep this inside `play.tsx` as a full-bleed view rather than a new `/circuit` route. The game's auth/session/polling/state context lives in `play.tsx`; a separate route would duplicate the session gate for zero user benefit. The view IS the dedicated page: it occupies 100dvh and shares no chrome with the other four tabs.

---

## 1. Full-screen layout

### 1.1 Play.tsx restructure (engineer)

```tsx
return (
  <div className="min-h-screen bg-[#070910] text-gray-200">
    {toast && …}
    {tab === "circuit" ? (
      <CircuitPage state={state} token={token!} onClose={() => switchTab("colony")} … />
    ) : (
      <>
        <Shell … />                  {/* unchanged for the 4 other tabs */}
        <FirstRunNudge … />
        {tab === "colony" && <ColonyTab … />}
        {tab === "expeditions" && <ExpeditionTab … />}
        {tab === "armory" && <ArmoryTab … />}
        {tab === "lab" && <LabTab … />}
      </>
    )}
    {/* GLOBAL overlays stay mounted across both branches — already siblings of the tab conditionals (L418–436): */}
    {helpOpen && <HelpModal … />}
    {state && <StorefrontOverlay … />}
    {feedbackOpen && <FeedbackModal … />}
    <ReportsSheet … />
    {gamesOpen && <GamesModal … />}
  </div>
);
```

Rules:
- Returning from Circuit (`◀ Return to Cradle`) calls `switchTab("colony")` — tab state resets to Cradle as today.
- Global overlays (storefront ledger, reports, help, feedback, games, toasts, modal-wrap dialogs) must stay reachable while the Circuit is open — the money surface (Ledger) and the reports bell are first-class in circuit chrome (§1.4).
- Browser fullscreen + mute remain live buttons in circuit chrome (they are app-level, not tab-level).

### 1.2 Mobile portrait (< 768px) — wireframe

```
┌──────────────────────────────────────┐
│ chrome 56px  surf-1  sticky          │
│ [◀]  THE CIRCUIT · Watchers     🔊 ⛶  │  ⛶ = fullscreen; right end = Ledger chip
├──────────────────────────────────────┤
│                                      │
│            MAP STAGE (flex-1)        │  ← fills ALL remaining height
│     document = full viewBox, fit     │  pan = native scroll; pinch = native zoom
│     (hit-floor cap keeps ≥44px tap   │
│      targets; stage pans when capped)│
│                                      │
├──────────────────────────────────────┤
│  LEGEND RAIL 40px  surf-1  (ALWAYS)  │  ← §4.2, horizontally scrollable
│                                      │
├──────────────────────────────────────┤
│  DOCK 56px  surf-1                   │
│  [Map│World]  [Legend ▸] [⇱] [+] [−] │  ← thumb-reach control row
└──────────────────────────────────────┘
```

Chrome total = 152px. Map = `100dvh − 152px`. Test at 375×667 minimum.

### 1.3 Desktop (≥ 1024px) — wireframe

```
┌───────────────────────────────────────────┬──────────────────────┐
│ chrome 56px                               │                      │
│ [◀ Return] THE CIRCUIT · Watchers · BETA  │ 🔊 ⛶ [Map│World] [Ledger] │
├───────────────────────────────────────────┼──────────────────────┤
│                                           │  LEGEND RAIL 300px   │
│            MAP STAGE (flex-1)             │  surf-1, full height │
│     viewBox fit + center, pan/zoom        │  full legend §4.1    │
│     hover = node stroke raise             │  (always visible)    │
│                                           │ ─────────────────────│
│                                           │  WHO'S-HERE card     │
│  floating controls bottom-left:           │  (reserved — §6.3)   │
│  [Legend ▸] [⇱] [+][−]                    │ ─────────────────────│
│                                           │  "as-is" footer line │
│                                           │  (earn-only note)    │
├───────────────────────────────────────────┴──────────────────────┤
```

- Map keeps the full viewport height minus the 56px chrome (no bottom bar on desktop; controls float over the map).
- The right rail is a sibling of the map stage (never an overlay): `flex` row, map `flex-1 min-w-0`, rail `w-[300px] shrink-0`.

### 1.4 Circuit chrome inventory (exact, no re-deciding)

| Control | Spec | Behavior |
|---|---|---|
| `◀` / `◀ Return to Cradle` | 44×44 min (44px floor), ghost button, `text-text-2 hover:bg-white/10` | `onClose()` → `switchTab("colony")` |
| Title | "THE CIRCUIT" — `xl` semibold `text-text-1`; under it (desktop only) `sm` `text-text-3` "the shattered circuit-web of the old world" | static | 
| World chip | `.chip`, bg `--race-<id>-tint`, text `--race-<id>-text`, border `rgba(255,255,255,0.15)` | reads `RACES[raceId].name` from `races.ts` — never a hardcoded literal; on the debug world it appends the existing "Beta Test World" chip pattern (see RaceSelect) |
| Segmented `Map \| World` | existing `SegmentedControl` (44px) | `world` swaps the map stage for the Contribution view (§1.5); war phases add a third `Battles` option (rung-1 §E) — omitted when not a war phase |
| Segmented placement | desktop: in the chrome, right cluster; mobile: left end of the DOCK (thumb reach) | same control, two slots; do not render twice |
| `Legend ▸` | 44px secondary button, `text-text-2` | mobile: opens the full-legend Sheet (§4.3); desktop: `.scrollIntoView()` the rail / focuses `#circuit-legend` |
| `⇱` reset view | 44px, ghost | restore default fit + center (§2.1) |
| `+` / `−` | 44×44 each, ghost | zoom ×1.25 steps, clamp 0.5–3× (§2.1) |
| `🔊` mute, `⛶` fullscreen | existing header buttons (44px mobile) | unchanged app-level behavior |
| Ledger (Scrip + Votives `.num` chips) | existing `LedgerButton` | **must stay reachable from Circuit** — storefront is a first-class surface |
| Reports bell | existing bell button + blink | kept on mobile chrome; desktop may drop it into the chrome right cluster (beyond the mock) — keep parity with the other tabs where cheap |

### 1.5 "World" (Contribution) segment inside full-screen

- **Desktop:** the map stage swaps to a centered scroll column (`mx-auto max-w-3xl px-6 py-8`) containing the existing Contribution content verbatim (`ContributionTab` L2342+) **plus the Who's-Here card at the top** (§6.3). Legend rail stays visible.
- **Mobile:** same content full-bleed; legend rail hidden in World mode (map not visible); the top bar shows `◀ Back to Map` in place of `◀ Return to Cradle`; Segmented stays in the dock.
- **Content:** own-rank card + top-10 verbatim. Never spend/votes — Contribution stays measured objectively (existing behavior, untouched).

---

## 2. Map stage — scaling, pan/zoom, density (forward headroom)

### 2.1 Geometry model (locked rules)

1. **Coordinates stay in viewBox units forever.** `map.ts` `BASE_POS` / node `x`,`y` never become pixels. The viewBox (`ATLAS_CONFIG.viewBox`, today 360×520) is the *only* thing that grows as the graph densifies.
2. **viewBox aspect is authored per world in 0.65–0.80** (today 0.69). Node count never changes the aspect — density is handled by layout bands (§6.1) + zoom.
3. **Fit:** `scale = min(stageW / W, stageH / H)`, centered. Default zoom = fit.
4. **Hit-floor cap (the 44px law):** if `26 · scale < 22` CSS px (the invisible `r26` hit circle would fall under the 44px tap floor), cap `scale = 22/26` and let the stage **pan** instead of shrinking. The map NEVER renders sub-44px tap targets, no matter how dense.
5. **Zoom:** clamp 0.5–3×; `+`/`−` step ×1.25; pinch native (`touch-action: pan-x pan-y pinch-zoom`; no `preventDefault` on gestures); double-tap suppressed (existing fix). No zoom slider v1.
6. **Reset view** (`⇱`) returns to rule 3 fit + center, animating `base 200ms ease-out` (zeroed under reduced-motion by the global A.5 cap).
7. **Default zoom is never below fit-capped scale** unless the player zooms out deliberately (0.5 floor).

### 2.2 Minimum node spacing (authoring law for the denser graph)

Any two nodes in the same band must sit ≥ **60 viewBox units** apart center-to-center (≈2.3× the `r26` hit circle) at the band's widest row. If an authored layout would violate it, **the viewBox grows** — coordinates keep their meaning, the renderer rescales. The Circuit doc (`map.ts` §4 skeleton) keeps this rule in the module header comment so future layout authors see it.

### 2.3 Label zoom tiers (labels never render < 11px CSS)

Zoom thresholds apply to the *CSS rendered* size (fontSizeUnits × scale). Toggle a class on the SVG root (`circuit-zoom-full | circuit-zoom-mid | circuit-zoom-low`) — removal from paint AND the a11y tree (`visibility: hidden`, never just `opacity: 0`):

| Rendered label height | Full name labels | Tier pips | Chips |
|---|---|---|---|
| ≥ 11px (zoom ≥ 0.8×) | show | show | show |
| 6–11px (0.55–0.8×) | **first word only** (e.g. "Forge", "Super-Collider") | show | hidden |
| < 6px (< 0.55×) | hidden | hidden | hidden |

Node `aria-label` is unaffected (it is always the full sentence — §7).

### 2.4 SVG layer order (z-order contract — reserves the markers layer)

```
0  severed-trace breaks (red stubs)
1  road / ruin-pass traces
2  zone fills (tier @ 22% composite over surf-0 per visual-pass-1 §2.1; kind fills)
3  zone strokes + rings (double ring, cradle ring, heart ring + corruption halo)
4  FUTURE: colony-marker dots (10px, race accent, non-interactive, §6.2)
5  sigils (purified star, heart 🔥, cradle 🔰, ★ heart-zone marker, tier pips)
6  labels (names, sub-labels)
7  chips (state chips — war phase only)
8  invisible hit circles r26 — always topmost for pointer events
9  per-node :focus-visible outline (2px --focus, 2px offset — .circuit-node rule exists)
```

Chrome (rail, dock, sheets) is HTML above the SVG container.

### 2.5 Stage background

`surf-0` base (unchanged). Optional Watcher-world "annotated examination" ruled-paper backdrop (visual-pass-1 §C, 6%) stays a **CSS-only** `background-image` on the stage container — no new assets, and it must not reduce contrast of anything above it (it sits below the SVG; skip if it complicates the zoom transform).

---

## 3. The tier & kind model (exact, from map.ts)

Tiers apply **only to contestable rim territories** (`NodeKind "rim"` + the heart). Near-ring and the Cradle are home turf — no tier. Tier is computed, never authored: `importanceFor()` → `score < 0.40 → T1`, `0.40–0.70 → T2`, `> 0.70 → T3` (map.ts `ATLAS_CONFIG.tier`).

| Tier | Zones (this world) | Yield character (spec §1.3) | War read (spec §2.2) |
|---|---|---|---|
| **T1 · Outer Rim** | forge-valleys, boneyard | embers 90–248/day, chipsets ≈0.36–0.40/day, no plasma | footholds; score 1/bucket; tithe 2 ws/6h |
| **T2 · Mid-Depth** | shattered-academies (heart-zone ★), quantum-facility | balanced embers, chipsets ≈0.72–1.2/day, plasma 0–2/day (quantum) | strong ground; score 2/bucket; tithe 5 ws/6h |
| **T3 · Deep** | collider-ruins, **dark-matter-observatory = the Chorus-held heart at center** | chipsets ≈1.4–1.8/day, plasma 1–4/day | crown jewels; score 4/bucket; tithe 12 ws/6h; incursion-heavy |

Node kinds (from `NodeKind`): `heart` (Chorus heart — center, T3 deep-most site per W2) · `rim` (contestable frontier) · `near` (home-protected, never contestable) · `cradle` (The Cradle — home edge).

---

## 4. Legend — content, placement, copy (verbatim)

### 4.1 Full legend (desktop rail always-visible; mobile = Sheet)

**Title:** `READING THE CIRCUIT` — `sm` uppercase, `tracking-[0.08em]`, `text-text-3` (muted ≥ 12px rule: render at 12px, not the 11px "micro" tier). `aria-labelledby` on the section group.

**Section header style:** `sm`/12px uppercase tracked, `text-text-3`, `mt-4 mb-1.5`.
**Entry style:** one row per entry — 16×16 `rounded-sm` swatch (or trace glyph) + `sm` (13px) `text-text-2` label + optional `caption` (12px) `text-text-3` sub-line. Row min-height 28px (tap-friendly when interactive).
**Footnote style:** 12px `text-text-3`.

---

**DEPTH TIERS — contestable ground only**
> "Contestable ground carries a depth tier: how deep it lies, how rich it is, how hard it hunts."

| Swatch | Entry | Sub-line |
|---|---|---|
| `■` T1 steel | **T1 · OUTER RIM** | "Footholds at the landing edge. Embers flow; the risk is low." |
| `■` T2 violet | **T2 · MID-DEPTH** | "Strong ground — balanced embers and chipsets, a real fight to hold." |
| `■` T3 ember | **T3 · DEEP** | "The crown jewels. Chipsets and plasma — and the Chorus hunts hardest here." |

Footnote (12px): *"Tier = published importance score: T1 < 0.40 · T2 0.40–0.70 · T3 > 0.70 — never hidden math."*

**GROUND KINDS**

| Swatch | Entry | Sub-line |
|---|---|---|
| `🔥` heart recipe ({`#7f1d1d` + ember ring, 1.6s pulse in war}) | **THE CHORUS-HELD HEART** | "The deepest scientific site at the web's core. The prize and the threat — never a neutral prize." |
| `◯` tier-fill ring (22% fill + white 1.5px stroke) | **CONTESTABLE RIM** | "The frontier — where the war will burn. Carries a depth tier above." |
| `◐` dim (`#18181b`, group opacity 0.6) | **HOME-PROTECTED** | "Near Ring — the Cradle's buffer and starter economy. Never contestable." |
| `🔰` (`#14532d` + `#fbbf24` ring) | **THE CRADLE** | "Your capital — the home edge. Supply lanes run from here to the frontier." |

**TRACES — HOW GROUND CONNECTS**

| Glyph | Entry | Sub-line |
|---|---|---|
| `———` road (`#8f9bb3`@55, 2px, near-`#5b6472` 1.5px) | **CONDUCTOR LANE** | "Fast marches and supply." |
| `┅┅┅` ruin-pass (`#b45309`, dashed `5 5`, 2px) | **BURNT PASS** | "Slow and risky — but passable." |
| `//` severed (`#7f1d1d` broken stubs) | **SEVERED TRACE** | "Impassable. The Chorus broke the circuit here." |

**WAR-PHASE STATES** (renders when the frontier burns — recipes VERBATIM from visual-pass-1-circuit.md §2.3/§2.4/§2.5)
| Swatch | Entry | Sub-line |
|---|---|---|
| fog + dashed hatch + `CORRUPTED` chip | **CORRUPTED** | "No holder. Open extraction at a small yield." |
| holder accent 55% + double ring + `CONTESTED` chip | **CONTESTED** | "A side holds it; score ticks to them. Flag = the holder's world." |
| white-gold + 8-point star + `PURIFIED` chip | **PURIFIED** | "Oracle-cleaned ground. The brightest node on the map — and the rarest." |

**NEVER COLOR ALONE** (11–12px, `text-text-3`, italic — the design law made visible):
> "Every state is also a shape or a label — rings, chips, stars, sigils. If a color alone is doing the talking, that is a bug."

**Footer ("as-is" honest line — inherited from the current tab, L2195):**
> "The Circuit shows the world as it is — no one holds these grounds yet. When the frontier burns, this web becomes the war board."
> "Earn-only ground — nothing here is for sale." *(money mandate: the map displays; it never sells — world-map §0.4.)*

### 4.2 Compact legend rail (mobile — always visible)

A 40px `surf-1` strip pinned above the DOCK, **always rendered** (never behind an interaction). One horizontally scrollable row of 10 `.chip`-style entries (each ≤ 112px: 16px swatch + 11px label):

`[🔥 Heart] [◯ Rim] [◐ Near] [🔰 Cradle] [T1 Outer] [T2 Mid] [T3 Deep] [— lane] [┅ burnt] [⇢ severed]`

- Chips: `bg-surf-2`, `border-line`, text `text-text-2`, 11px minimum (chip floor), height 24px.
- Rails with fewer entries should still reserve the 40px height (no layout jump as the graph grows).
- The `Legend ▸` dock button opens the full legend (§4.1) in the existing Sheet primitive (mobile bottom-sheet / desktop centered modal — the `.sheet-*` chrome already handles both).

### 4.3 Placement summary

| Breakpoint | Legend | Full copy |
|---|---|---|
| < 768px | compact rail (40px, always) | `Legend ▸` → Sheet |
| ≥ 1024px | right rail 300px, always visible, scrolls if taller than viewport | inline, permanent |
| 768–1023px (tablet) | compact rail like mobile (keeps map legible) | `Legend ▸` → Sheet |

---

## 5. Color table — token-mapped (single-source, zero new palette entries)

**Single-source rule:** all colors below already exist in the canon (rung-1 §A/C, visual-pass-1 §2, or the live map). The engineer's job is to **centralize**, not invent: new module `site/src/game/circuit-tokens.ts` exports `TIER_COLORS`, `KIND_COLORS`, `TRACE_COLORS` (hex verbatim); the SVG renderer, the legend, and any new wcag checks all import from it. Race accents come from `races.ts` → `--race-<id>-accent/-text` tokens; functional meaning comes from the app.css tokens. **Zero hex literals in the page component.**

| Concept | Token / source | Value | Use | Contrast (canon, visual-pass §5) |
|---|---|---|---|---|
| Tier 1 | `--tier-1` (circuit-tokens; NOT a new palette color — the V8 canon, rung-1 §C) | `#4d7cc7` | T1 pip + fill @ 22% over surf-0 (`→ #162238`) | 4.76:1 on surf-0 — PASS |
| Tier 2 | `--tier-2` | `#a78bfa` | T2 pip + fill @ 22% (`→ #2a2643`) | 7.31:1 — PASS |
| Tier 3 | `--tier-3` | `#fb923c` | T3 pip + fill @ 22% (`→ #3d271a`) | 8.79:1 — PASS |
| Heart fill | `--circuit-heart` | `#7f1d1d` | Chorus-heart node + severed traces | fill (label `#fdba74` 5.94:1 — PASS) |
| Heart glyph ring | ember canon | `#fb923c` | 3px heart stroke | — |
| Near fill | `--circuit-near` | `#18181b` | Home-protected node (group opacity 0.6) | — |
| Near stroke | canon | `#3f3f46` | 1.5px | — |
| Cradle fill | `--circuit-cradle` | `#14532d` | Cradle node | label `#fde68a` 7.32:1 — PASS |
| Cradle ring | canon | `#fbbf24` | 1.5px | — |
| Road trace | `--circuit-trace-road` | `#8f9bb3` @ 0.55 (near `#5b6472`) | solid 2px / 1.5px | ~3.3:1 graphic — UI OK |
| Burnt pass | `--circuit-trace-ruin` | `#b45309` | dashed `5 5` 2px | 3.96:1 — UI OK (3:1 floor) |
| Severed trace | (heart red) | `#7f1d1d` | broken stubs, opacity 0.8 | — |
| Node labels | canon | `rgba(226,232,240,0.75)` | all names; 11px min | 15.17:1 on fills — PASS |
| Heart label | canon | `#fdba74` | heart name | 5.94:1 — PASS |
| Contested fill (war) | `RACES[].accent` @ 55% over surf-0 | Watchers `#b48cff → #665193` | holder identity ONLY | 3.00:1 UI floor — double ring is the shape crutch (visual-pass §4/§5) |
| Contested chip text (war) | `RACES[].accentText` | Watchers `#c9a4ff` | `CONTESTED` chip text on surf-2 | 8.85:1 — PASS |
| Purified (war) | `--purity` | `#ffd166` | sigil + ring + chip | 12.59:1 — PASS |
| Legend swatch border | `--line-strong` | `#22303c` | swatch outlines | — |
| Legend text | `--text-2` / `--text-3` | `#9aa4b2` / `#8490a0` | entries / headers | ≥ 4.5:1 / ≥ 5.0:1 (gate) |
| Focus ring | `--focus` | `#ffd166` | 2px outline + 2px offset | — |

**Adjacency discipline (no changes):**
- Asart accent ≡ purity gold → identity via shape channels only (rung-1 §A.3 decision 1) — contested uses the double ring + flag chip; purified uses the star. Never the two colors alone.
- Draconian accent vs hazard teal / Nephilim rust vs ember: identity green/rust never sits beside radiation/Chorus semantics (rung-1 §A.3 guards). The legend swatches render canon colors as identity-free **kind/tier** entries — no race swatches in this legend (race accents are world chrome, not map meaning).
- Tier colors are **game-global functional** (same on all six worlds) — they are depth/risk meaning, not identity.

---

## 6. Forward headroom (30–50 nodes, colony markers, who's-here)

### 6.1 Layout bands (authoring scaffold for the denser graph)

The existing v4 skeleton already reads as **horizontal bands** (map.ts §4: heart y≈100, deep pair y≈168, rim arc y≈235, near ring y≈345, cradle y≈480 of 520). Formalize as viewBox-fraction bands so new nodes have a place to live without design churn:

| Band | y-fraction range | Role | Node counts (today → future) |
|---|---|---|---|
| Core | 0.14–0.24 | Chorus-held heart (center) | 1 → 1 |
| Deep | 0.28–0.38 | T3 approach threads + new T3 sites | 2 → up to 6 |
| Rim arc | 0.42–0.52 | T1/T2 footholds (the landing perimeter) | 3 → up to 12 |
| Near ring | 0.60–0.72 | home-protected | 4 → up to 14 |
| Home edge | ≥ 0.88 | The Cradle | 1 → 1 |

Rules: new nodes are authored INTO a band (x free inside band margins 0.06–0.94 of width, honoring §2.2 spacing); nothing outside bands. The viewBox grows in width (same 0.65–0.80 aspect) when a band fills. The heart and the Cradle never move.

### 6.2 Colony-marker layer (reserved, not built)

When server state ships holders/presence, node-level colony markers render in SVG layer 4: a 10px race-accented ring-dot at the node ring (r + 14 units), non-interactive — tap still opens the node Sheet. Markers never carry their own hit targets; the node's r26 circle owns the tap. The "who's here" card (§6.3) is where markers become interactive rows (tap row → that colony's context, future).

### 6.3 Who's-Here dock (reserved space, empty-state now)

Reserve the real estate now so the page never reflows when it lands:

- **Desktop:** a card pinned at the bottom of the legend rail (`min-h-[168px]`, `surf-2`, `border-line`, rounded-l) titled **"WHO'S HERE"** (`sm` uppercase tracked, `text-text-3`). Empty state now (verbatim): *"The frontier is quiet — no colonies hold ground here yet. When the war comes, holders and top colonies appear in this space."* Future rows: sigil + colony name + `.num` score, 3 rows max + "see all in World".
- **Mobile:** the same card renders at the top of the **World** segment (above Contribution). The DOCK also reserves a future `N here` chip slot (render nothing until data exists — no placeholder ghosts).
- **Data contract (future):** server field `presence: { count: number; top: Array<{ colonyName: string; raceId: RaceId; score: number }> }` in the warMapView (battle-side §3.6) — reserve the name, no client logic yet. Never purchasable, never votes — mirrors the Contribution rules.

### 6.4 War-phase reserve

- `Battles` segmented option appears only in war phases (rung-1 §E) — the segmented control's options array already supports it; the CircuitPage just feeds it.
- The bottom DOCK has room for `[FOBs ▾]` and a live `.num` score chip when the war overlay lands (world-map §3.4) — place them left of `Legend ▸`.
- State recipes (corrupted/contested/purified) and the legend §WAR-PHASE STATES entries above are the rendering contract; they are already spec'd in visual-pass-1 §2 — the full-screen page inherits them untouched.

---

## 7. Responsive + a11y notes

**Responsive**
- Breakpoints: < 768 mobile (rail + dock) · 768–1023 tablet (same, map fills more) · ≥ 1024 desktop (rail). No 3rd layout.
- Portrait-first. Native pan/pinch; the stage container is `w-full h-full overflow-auto` with `touch-action: pan-x pan-y pinch-zoom`.
- `100dvh` (fallback `100vh`) for the page; chrome heights fixed so the map height is predictable across orientation changes.
- Test widths: **375** (a11y flag from rung-1 §C), 390, 768, 1024, 1440.

**A11y (WCAG AA — the wcag-tests suite is the acceptance gate)**
- Hit targets ≥ 44px: chrome buttons 44×44; legend rail entries are not interactive (44px floor applies to interactive controls, not decorative swatches); node tap = invisible r26 circle scaled so its CSS diameter is never < 44px (§2.1 rule 4).
- Labels ≥ 11px rendered CSS: enforced by the zoom-tier gates (§2.3: hide, never render smaller).
- Contrast: all pairings in §5 with the PASS column hold; legend text on `surf-1/surf-3` at ≥ 4.5:1 (text-2) / ≥ 5.0:1 (text-3) — already asserted by `wcag-tests/wcag-verify.ts` checks 2–3.
- Keyboard: nodes keep `tabIndex=0`, Enter/Space toggle, `aria-pressed` (existing .circuit-node grammar); `aria-label` = full state sentence, e.g. "Forge Valleys — Burning-Rim territory, Tier 1 (score 0.30)." (extend with the state word per visual-pass §6 when war lands); `.circuit-node:focus-visible` ring exists.
- The legend is a real landmark: `<section aria-labelledby="circuit-legend-title">`, heading id, not a div of spans; the compact rail is `aria-hidden` decorative duplication? **No** — the rail chips carry real names; give the rail `role="list"` / entries `role="listitem"` and the Sheet a `labelledBy` title (existing Sheet primitive supports it).
- The full-screen view only renders for authenticated, race-set sessions (it lives inside the gated app tree — unchanged).
- `prefers-reduced-motion`: global A.5 cap zeroes all motion (heart pulse, reset animation) automatically — no extra code; verify heart pulse is safe under it (it is — animation-duration 0.01ms).
- No color alone: legend's "never color alone" note is also the working rule — every node state carries shape/label channels (visual-pass §1).
- Focus management: on entering Circuit, focus moves to the map container (`tabIndex={-1}` + `aria-label` "The Circuit — world map"); Return moves focus back to the Circuit tab button in the TabBar.

---

## 8. Handoff checklist (engineer)

**Layout / structure**
- [ ] `play.tsx`: restructure per §1.1 — `tab === "circuit"` renders `<CircuitPage>` full-bleed; Shell + TabBar hidden on that tab; global overlays stay mounted.
- [ ] New `CircuitPage` (may keep the module in `play.tsx` or split to `src/components/CircuitPage.tsx` — engineer's call; prefer a component file if play.tsx grows) with chrome per §1.4 and full-screen containers per §1.2/§1.3.
- [ ] Chrome inventory builds: Return/Title/World chip/Segmented/Legend ⇱/+/−/mute/fullscreen/Ledger/(bell).
- [ ] World segment reuses Contribution content verbatim + Who's-Here card (§1.5, §6.3); `Battles` option reserved, not rendered.
- [ ] Desktop rail: 300px `surf-1` right rail with full legend (§4.1) incl. Who's-Here card + footer lines.

**Map stage**
- [ ] SVG keeps `map.ts` viewBox; renderer applies fit + centering + zoom clamp + hit-floor cap (§2.1) — no coordinate changes.
- [ ] Pan/pinch native; `+`/`−`/`⇱` wired; double-tap suppressed.
- [ ] Zoom-tier classes (`circuit-zoom-full/mid/low`) gate labels/pips/chips by rendered size (§2.3), `visibility: hidden`.
- [ ] Layer order per §2.4 (hit circles topmost; markers layer reserved but empty).

**Legend**
- [ ] Desktop rail full legend + mobile compact rail + `Legend ▸` Sheet — copy VERBATIM from §4.1/§4.2; section/entry styles per §4.1.
- [ ] `circuit-tokens.ts` created; renderer + legend import it; hex literals removed from the component (§5 rule).
- [ ] Swatch/section styles match §4 (16px swatches, section headers, footnotes, never-color-alone note, as-is + earn-only footer).

**Quality gates**
- [ ] `bun run build` green.
- [ ] Full test battery green (baseline **932 passed / 0 failed / 1 skipped**, `env -u DATABASE_URL` for the filesystem fallback).
- [ ] `cd /home/team/shared/wcag-tests && bun run wcag-verify.ts` green (optionally extend the suite with tier/kind checks reading `circuit-tokens.ts` — recommended so the §5 table is machine-enforced).
- [ ] Manual pass at 375 / 768 / 1024 / 1440; keyboard-only walk (Tab through nodes, Enter opens the Sheet, Return restores focus); reduced-motion on (heart pulse frozen).
- [ ] The old `CircuitTab` inline legend + `max-w-3xl` wrapper are deleted (no dead code); `Circuit` tab still navigates to the full-screen view.

---

## 9. Mockups

- **Desktop:** `site/public/art/circuit/circuit-fullscreen-desktop.png` — 1536×1024 wireframe-faithful canvas: full-bleed map stage (heart / T1–T3 rim / near / cradle at canon colors), 300px right legend rail ("READING THE CIRCUIT" with DEPTH TIERS / GROUND KINDS / TRACES), Who's-Here reserved card, 56px chrome with Return · THE CIRCUIT · Segmented · Ledger. The engineer reproduces the recipes and the layout, not the art.
- Mobile treatment is fully covered by the §1.2 ASCII wireframe + §4.2 rail spec (no separate mock needed for build).

---

*Spec end. Engineer build order suggestion: tokens module → full-screen shell + chrome → map stage scaling → legend (desktop rail + mobile rail + sheet) → Who's-Here reserve → gates.*