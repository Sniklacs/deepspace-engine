# World & Territory Map — Design for the War Layer

**Status:** design, integration-spec class · **Filed:** 2026-09-12 (researcher delegation report, session 543e4307) + owner follow-up integrations folded in (§6: roads & contiguity, shattered circuit-web, Chorus-held heart). **Build-blocking decisions ratified by owner 2026-09-12: M1 (node-graph), M2 (six rim zones), M6 (The Circuit ships now).** **ALL M1–M8 ratified by owner 2026-09-12** (R1–R4/W1–W2 carried in battle-side spec, ratified there). No numbers are results.
> **FEATURE RENAMED by owner direction 2026-09-12: "World Atlas" → "THE CIRCUIT"** — "Atlas" is too close to competitor Atlantis/Last-Land vocabulary; new name chosen by the lead (it is literally the shattered circuit-web). The post-build label sweep (V8 micro-pass) is DONE: the UI tab, headings, and footer read "THE CIRCUIT" and this doc references the feature as THE CIRCUIT throughout. Module/route names (`map.ts`, `generateAtlas`) are untouched — renaming files churns the build for nothing.
**Sources:** battle-side-rvr-spec.md §1/§3/§5/§7/§10/§12/§13/§14, weapons-system.md §2, business plan rev 14 ("Location determines yield — deep = dangerous = chipsets"), engine zone data (zones.ts, races.ts), api.ts publicState discipline, client patterns (play.tsx 5-tab mobile client).

---

## §0 Design pillars (constraints honored)

1. **The map IS the world.** It reuses the existing Shatterlands geography 1:1 — the zones.ts zones + the Cradle — as a node graph. No new places, no minigame map, no new deps. `zone.id` stays the single identifier across expeditions, war state, and the map.
2. **Server-authoritative.** The map is a pure render of server-computed state (zone states, holders, tiers, extraction, FOBs, scores). The client never computes a control claim.
3. **Mobile-pass.** Portrait-first, CSS/SVG-renderable, tap targets ≥44px, existing Tooltip/long-press patterns, native pinch-zoom + scroll; web-GL out.
4. **Earn-only view.** The map displays; it never sells. War-pass cosmetics may render as holder flair on nodes (zero engine effect); nothing on the map is ever purchasable.
5. **Aggression spins the Chorus; purity is the counterweight:** higher-importance ground = more conflict, more score, more Chorus draw, more incursion risk — the hubris/purity turbine made visible as geography.

---

## §1 Territory model — what is contestable, what it yields, who controls it

### 1.1 The world's two rings (a classification of EXISTING zones, not new geography)

The Shatterlands already has an implicit radial order (`zone.range` 0–100: distance from the Cradle). War splits it into two bands:

| Band | Zones (ids from zones.ts) | War status |
|---|---|---|
| **Near Ring** (home-protected) | `outer-ruins`, `lantern-reach`, `observatories`, `hollow-warrens` | **Never contestable.** The Cradle's buffer and starter economy. Renders dimmed; expeditions run as today; supply lanes run through them. Protects new players' first grinding ground and keeps the weekly fight legible. |
| **Burning Rim** (the Frontier) | `forge-valleys`, `boneyard`, `shattered-academies`, `quantum-facility`, `collider-ruins`, `dark-matter-observatory` | **Contestable in every war week the world fights.** The six deepest, most Chorus-thick sites — the landing edge where an invasion touches soil. |

The cut is principled and publishable: **the frontier is the burning rim — the six zones at range ≥ 60, where the Chorus is densest and the deep prizes sit.** The three "special" deep scientific sites (`quantum-facility`, `collider-ruins`, `dark-matter-observatory`) are always frontier — the chipsets/plasma crown jewels. The world's own race heart (`shattered-academies` on the Watchers world) is always in the rim and carries a cosmetic **Heart marker** (History-Book firsts; no mechanical asymmetry; M8).

Per world, per week, the **battlefront = two maps**: the home world's rim (defense) and the enemy world's rim (invasion). A world in "border hold" posture shows only its home map, quiet.

### 1.2 Per-territory profile — resource profile, importance tier, control state

Each frontier zone carries a **static profile** (server-side pure constants, derived from the zone's existing data) plus a **live control state**:

```
TerritoryMapZone = {
  zoneId;                    // == zones.ts id — THE identifier
  resources: { embers: [lo, hi]/day; chipsets: expect/day; plasma: [lo, hi]/day; mat: RaceId | null };
  importance: { tier: 1|2|3; score: 0..1; breakdown: {richness, position, chorus} };
  strategic: { invasionAdjacency, hubness };
  heart?: boolean;
  state: "corrupted"|"contested"|"purified";   // §5.1 verbatim
  holder: WorldId | null;
  since: ts; lastPurify; reCorruptAfter;
  fobs: [{colonyId, stage 1-4, builtAt, anchored: bool}];   // §12
  activeBattles: number;
  incursion?: {until: ts, purgeProgress};
}
```

Control state is battle-side §5 verbatim: Corrupted (no holder, "open" extraction at small yield), Contested (holder ticks score; hauls go to holder), Purified (no extraction for anyone, no enemy score tick, locally slows the Chorus ramp; 24h re-purify lockout / 12h re-corruption floor).

### 1.3 Resource profiles — yield bands (extraction rights, defaults)

Extraction is granted by holding. The world's extract = a **server-computed 6h tick** (4 ticks/day, offline-safe; bands published on the node and in the war-rules UI):

| Zone (rim) | Embers/day band | Chipsets (expected/day) | Plasma (deep sites only) | Territory mat | Tier |
|---|---|---|---|---|---|
| `forge-valleys` | 110–248 | ~0.36 | — | anunnaki | **T1** |
| `boneyard` | 90–203 | ~0.40 | — | nephilim | **T1** |
| `shattered-academies` | 100–225 | ~0.72 | — | watchers (world heart) | **T2** |
| `quantum-facility` | 120–270 | ~1.2 | 0–2/day | — | **T2** |
| `collider-ruins` | 150–338 | ~1.4 | 1–3/day | — | **T3** |
| `dark-matter-observatory` | 180–405 | ~1.8 | 2–4/day | — | **T3** |

Chipsets at `chipsetChance × 4` expected/day (discrete drops on ticks). Plasma from the deep trio only. War-captured **mats** feed the existing alloy recipe (own + 4 others — "invasion makes you well-rounded"); near-ring mats stay PvE-raid-only so the alloy path is never war-gated. Conversion: 100 embers → 1 war supply (published per week). **Thematic:** chipset hauls feed the world's Total-Completion pace — the war's deepest prize is also the thing that raises the Chorus hunt. The turbine, again.

### 1.4 What extraction flows into (no new currency)
- **Embers** → the world's war pool (holding side's Gearing conversions); per-colony share from **haul missions** (§4/M5).
- **Chipsets/plasma** → personal resources of the hauling colony (plasma gates FOB late stages + weapon tiers T3/T4).
- **Mats** → personal, feeds the Cradle alloy forge.

---

## §2 Importance → conflict engine ("why am I fighting HERE")

### 2.1 Importance tier — published, deterministic, symmetric

```
importanceScore = 0.5·resourceRichness + 0.3·strategicPosition + 0.2·chorusDensity   (all 0..1)
```
- **Richness** = 0.4·(emberYield/90) + 0.4·(chipsetChance/0.45) + 0.2·(plasmaPresence).
- **Strategic position** = 0.6·invasionAdjacency (outermost rim = 1.0 — the landing edge) + 0.4·hubness (degree in the rim chain).
- **Chorus density** = `zone.chorusRisk` verbatim.

Computed from zones.ts (the map's "Because" line shows all three sub-scores):

| Zone | richness | strategic | chorus | **score** | **tier** (T1<0.40, T2 0.40–0.70, T3>0.70) |
|---|---|---|---|---|---|
| forge-valleys | 0.32 | 0.25 | 0.30 | **0.30** | T1 |
| boneyard | 0.29 | 0.40 | 0.30 | **0.32** | T1 |
| shattered-academies | 0.38 | 0.63 | 0.50 | **0.48** | T2 (heart) |
| quantum-facility | 0.73 | 0.72 | 0.50 | **0.68** | T2 |
| collider-ruins | 0.84 | 0.71 | 0.60 | **0.75** | T3 |
| dark-matter-observatory | 1.00 | 0.73 | 0.70 | **0.86** | T3 |

→ **2 T1 / 2 T2 / 2 T3** per world: footholds, strong fights (the heart + entry deep site), crown jewels. Static base; a published **weekly event modifier** (0–1 zones tier-shifted ±1 at Gearing) is the optional M4 dynamism.

### 2.2 Per-tier conflict math (published constants, ledger-derived, money-proof)

| | T1 | T2 | T3 |
|---|---|---|---|
| **Score tick** (holder, per 2h bucket) | 1 | 2 | 4 |
| **Capture score** (ladder + Contribution) | 1 | 2 | 4 |
| **Hold cost — "the tithe"** (war supply/6h, split among the holding side's participating colonies by conversion share) | 2 | 5 | 12 |
| **Chorus attention draw** (+to world's server-wide multiplier) | +0.5/bucket | +1/bucket | +2/bucket |
| **Incursion odds** (per bucket, CONTESTED only) | 0% | low (published) | high (published), scaled by world attention + zones held |

**Hold cost is the map's over-extension teacher** (Foxhole logistics lesson): holding the deep pair all week drains the world's budget — the tension is the week-long bill, not one battle. Run dry and contested holdings decay to corrupted. Cap note: a colony's tithe is capped at its 3 most-expensive held zones (fairness guardrail).

**Purified zones invert the ledger**: no enemy tick, no enemy extraction, each purified zone subtracts from the world's attention multiplier — purified ground is the collective escape hatch AND a scored win (purification ticks at capture parity). A purified zone is a "win, not a denial" — the map's brightest node is the rarest.

### 2.3 The incursion — "the devil hunts where the god-light is brightest"
Every bucket, each CONTESTED T2/T3 zone rolls a published incursion chance (scaled by how much rich ground the pair holds). An incursion = a **Hive-Swarm overlay** on the zone for 2–6h: extraction paused, score ticks paused for both sides, and the Chorus force must be purged (any colony commits a weapon-kit march or purification assist — shared PvE goal; New World Corruption-Invasion precedent). Phase 1 v1: timer + pause + shared purge; Phase 2: full encounter.

### 2.4 The keep-vs-take decision language (per-node "Because" sheet)
Tap any rim node → bottom sheet with the honest three-way read: **HOLD** ("ticks 4/bucket, extracts X/day, costs 12 ws/6h, draws +2/bucket"), **TAKE** ("capture grants 4 ladder + 4 contribution; enemy FOB stage 3 here"), **PURIFY** ("requires Oracle favor + earned rite; no enemy tick/extraction, −attention, purify score at capture parity; interruptible, 24h lockout"). Under the header, the derived "Because" line — e.g. "**Tier 3 — the crown jewel.** Richness 1.00 · Position 0.73 · Chorus 0.70. The deepest prize — and the devil's favorite door." Importance is never hidden math.

---

## §3 Map visual spec

### 3.1 Layout approach — node graph (recommended; hex/region rejected: no tile/polygon data exists; node graph is 1:1 with zones.ts, mobile-legible at 6-node scale, absolute-positioned divs + thin CSS edges, no deps, no web-GL)

The map's **base layer** (no war state) doubles as **THE CIRCUIT** — the world as a place, readable by every new colony on day one (M6).

### 3.2 Layout — the shattered circuit-web (owner direction 2026-09-12, folded in; replaces the earlier radial sketch)

The map is **the remnant circuitry of the old world** — a shattered circuit-web, asymmetric and history-shaped, never a symmetric grid:

- **Territories sit where the old world stood** (arcologies, data-cores, foundry belts, observatory arrays — the zones themselves); their layout follows the old world's geography, broken where the war broke it. Layout is a pure client constant module (war-map-layout.ts keyed by zone id) — asymmetry is authored once per world, history-shaped.
- **Links ARE the circuit traces** (battle-side §13): intact traces = **roads** (conductor lanes; fast marches/supply); burnt traces = **roadless ruin-passes** (slow/risky links, race-flavored: Draconian warrens, Nephilim cairn-roads, Anunnaki mega-ramps, Grays' spliced archives, Pleiadian lantern-lanes); severed traces = impassable gaps. A node's accessibility = its surviving traces (§13: no leapfrogging — conquest moves along the web from the landing edge; the chain is the strategy; cutting a mid trace isolates what's behind it).
- **The Chorus-held heart at the core.** The center of the web is the deepest site — the Chorus stronghold (on the Watchers world: `dark-matter-observatory`, the T3 crown jewel; the heart renders as a burning sigil, not a neutral prize). The web's traces radiate from the heart outward to the **landing perimeter** (the outermost rim) where invaders arrive. The war's arc reads inward: fight the perimeter footholds, push the chain, burn toward the heart — and the closer you get, the harder the devil hunts (§2.3 incursions, attention ramp). The heart is the prize *and* the threat: highest yield, highest tithe, highest Chorus draw.
- **History-shaped** per world: no two worlds' webs identical (six worlds, six corpse-geographies — lanes where the old world's industry ran, gaps where the Chorus broke it). Identity rules in battle-side §14.

### 3.3 Legend (all CSS/SVG)
- **Control (holder):** node fill = holder world's race accent; "world flag" chip on the node.
- **State overlay (§5):** Corrupted = dark fog, no holder; Contested = animated gold pulse border + holder fill; Purified = white-gold sigil glow (rarest, brightest) + denied markers. Guardrail timers as small countdown chips.
- **Resource icons + yield:** compact row 🔥 embers · 🧠 chipsets · ⚡ plasma · 📦 mat sigil (collapsed = icons; expanded in the inspect sheet).
- **Importance glow:** node halo + tier badge (T3 = "crown" pip); the "Because" sub-scores in the sheet.
- **FOB markers (§12):** flag glyph + 4 stage pips (Landing → Garrison → Foundry → Arsenal/Citadel), countdown ring on the pending stage, siege-capable rune at Citadel; rendering per two-map toggle (Home/Enemy front).
- **Active battles:** CSS pulse ring + "live" chip; Climax window = rim hot, broadcast ticker pinned to header.
- **Clan/colony holdings toggle:** top-contributing colony's banner under the node (Contribution-Award visibility; per-account stats opt-out respected).
- **Link rendering:** roads drawn as solid traces (animated only when hauling/held), ruin-passes as dashed/dim traces, severed gaps unrendered or as breaks — the web reads as circuitry at a glance.

### 3.4 Compact portrait wireframe
```
 ┌──────────────────────────────┐
 │ ◀ WAR · Cycle 12 · Day 4     │  header: cycle, phase, day, next objective (×1.25)
 │ [ Home Front ┃ Enemy Front ] │  segmented toggle (enemy hidden in border-hold)
 │ ┌──────────────────────────┐ │
 │ │    [ HEART ]  burning    │ │  the Chorus-held heart at the web's core
 │ │   ◇DM ─ ◇CO ─ ◇QF        │ │  circuitry traces (solid = road, dashed = ruin-pass)
 │ │    SA● BY● FV●            │ │  rim arc — footholds + heart approach
 │ │    HW● OB● LR● OR●        │ │  near ring — dimmed, locked to war
 │ │         ▲ ▲ ▲             │ │  lanes (active only when held/hauling)
 │ │       [ CRADLE ]          │ │
 │ └──────────────────────────┘ │
 │ [FOBs▾][Legend▾] [7–2 score] │  bottom bar: toggles + live bucket score
 └──────────────────────────────┘
```
(Exact coordinates are authored per world in war-map-layout.ts; the heart sits at the web's visual core, the Cradle at the bottom home edge, the landing perimeter at the top. ★ = the two-map reality: your front shows the enemy's web with YOUR FOBs; the home front shows your web with THEIR FOBs.)

Tap node → bottom sheet (§2.4). Long-press → Tooltip. The map is a fifth war-phase tab beside the 5-tab client — visible during war weeks + the always-on Circuit.

### 3.5 Interaction (mobile-pass)
Fit-to-screen default (6 nodes + Cradle fit portrait; zoom is convenience); pan = native touch scroll; pinch = native zoom; double-tap suppressed (existing fix); tap-to-inspect bottom sheet; home/enemy toggle; replay scrubber (§4); 4s poll continues + 30s map-focus poll during Campaign + Climax broadcast ticker (no websockets, no new deps).

### 3.6 Data flow (server-authority)
```
WarWorld -> zoneStates + profiles + ledger aggregates -> war module (pure): warMapView =
  { zones: [{zoneId,state,holder,importance,tier,extraction,holdCost,fobs,battles,incursion}],
    meta: {cycle, phase, day, objective, scores, climaxWindow, nextPairing} }
-> getWarState() -> CLIENT: pure render only (layout coordinates are the only client-computed thing — static presentation).
```
Scoring internals, matching, oracle/council fields and per-colony stat flags stay server-side per the strip discipline.

---

## §4 Integration (tight)
- **§5 zone-states:** the map IS the zone-state view — renders 1:1, no second zone model.
- **§3 Gearing/supply:** lanes are the map's economy — embers flow Cradle→rim along held routes; **haul missions** (`haulFn`: select a held route, commit supplies/fuel, convert accumulated zone output into personal warSupply + chipsets/plasma/mats) give the §3 convert loop map location; the map shows what you can haul and what an enemy capture would cut.
- **§12 FOBs:** FOBs anchor to rim nodes; stage pips + build ring + tier ceilings; FOB loss = pushed off the zone.
- **§7 History Book replay:** per-cycle map replay = pure render of the war ledger over a Day 1–7 scrubber — "the Burn of Cycle 12" is the recap page with the map animated underneath (flips, white flashes = purifies, dark pulses = incursions, rim-hot = Climax). End-state holdings persist across cycles (M7).
- **One source of truth:** every visual derives from the war ledger + warMapView. No second bookkeeping.
- **Sequencing:** map shell = **THE CIRCUIT** (read-only, ships on beta now — zero war secrets; map data is public world state); war overlay = Phase 1 (zone states, control, capture tick, FOBs, replay v1, Climax ticker); Phase 2 = incursions, lane raids, purified full set, dynamic importance, Council pins, hero-feat markers. War Phase-1 integration testing needs ≥2 worlds (headless fabricated pairs per §10.3; live pairing test at the second world's opening).

---

## §5 Owner decisions (defaults marked ◆; same class as D1–D6, constants not contracts)

| # | Decision | Recommended default ◆ |
|---|---|---|
| **M1** | Map style | **Node graph** (shattered circuit-web, above). Hex/region rejected. — **✅ owner-ratified 2026-09-12** |
| **M2** | Frontier size & near-ring protection | **6 rim zones contestable, 4 near-ring home-protected.** Alt: 8 or 4. — **✅ owner-ratified 2026-09-12** |
| **M3** | Importance derivation | **0.5·richness + 0.3·position + 0.2·chorus**, thresholds T1<0.40, T2 0.40–0.70, T3>0.70 → 2/2/2 per world; sub-scores published. | — **✅ owner-ratified 2026-09-12**
| **M4** | Static vs dynamic importance | **Static base + published weekly event modifier** (0–1 zones tier-shifted ±1 at Gearing). Pure-dynamic rejected (unreadable). | — **✅ owner-ratified 2026-09-12**
| **M5** | Extraction implementation | **Automatic 6h world tick + per-colony haul missions**; tithe hold-cost model. | — **✅ owner-ratified 2026-09-12**
| **M6** | Shipping phase | **THE CIRCUIT now** (read-only map shell on beta — proves layout/legend/touch, zero secrets); full war overlay **Phase 1**; Phase 2 additions per §4. — **✅ owner-ratified 2026-09-12 (Circuit ships now)** |
| **M7** | Holdings persistence | **Captured rim zones persist across cycles** until retaken (keep-or-take long-term stake, History-Book lineage). Alt: weekly reset. | — **✅ owner-ratified 2026-09-12**
| **M8** | Misc | Race-heart marker cosmetic + History firsts only; tithe cap at 3 costliest zones; ember bands and tick rates default pending balance; incursion Phase-1 minimal (timer+pause+shared purge), full in Phase 2. | — **✅ owner-ratified 2026-09-12**

**Build-blocking: M1, M2, M6.** Balance-visible: M3/M4/M5 rates.

---

## §6 Owner follow-up integrations (2026-09-12, folded in after the researcher pass)

**§13 Roads & contiguity (battle-side spec, owner direction):** the web's links ARE the §13 link model — conquest is contiguous along traces (no leapfrogging), accessibility = a surviving trace (roads fast; ruin-passes slow/risky; severed = impassable), every node is connected by at least one trace, supply runs on controlled traces and a cut mid-trace isolates what's behind it. Flags carried: **R1** link types/speeds per kind and per race; **R2** no-leapfrog enforcement (rec: yes — counterplay is cutting/contesting links); **R3** colonies may invest to BUILD new roads (war supply + time; roadless links fixed); **R4** contiguity per-FOB (each FOB expands its own chain; multiple FOBs = separate fronts).

**§14 Shattered circuit-web identity (battle-side spec, owner direction):** topology = remnant circuitry; asymmetric, history-shaped, no two worlds alike; **the Chorus-held heart at the core** — the deepest site is a Chorus stronghold, the prize and the threat; the war's arc reads inward from the landing perimeter toward the heart. Flags carried: **W1** per-world authored layout (war-map-layout.ts) encoding each world's dead geography; **W2** heart = the world's deepest T3 site (dark-matter-observatory for Watchers) — confirm per world that the heart is always the deep-most scientific site (lore: the AI legacy is deepest where the Chorus densest).

*Cross-links: battle-side-rvr-spec.md §13/§14 (roads/contiguity, circuit-web), §10.2–10.3, §11 D1–D6, §12 FOBs; weapons-system.md §2/§6; oracles-purity-layer.md §3–§5; daily-devotion-spec.md §3.3; monetization.md §9.3; unbound-revelation-track.md (silence — the map ships nothing hidden).*

---

*Filed by team lead from researcher delegation report (session 543e4307-07df-4d5a-ad4b-c75bdc15011e). Read-only session. Number-check for the engineer before owner sign-off: verify importance thresholds produce exactly 2/2/2 on the six rim zones and sanity-check tithe arithmetic (12 ws/6h per T3) against expected war-supply volumes.*