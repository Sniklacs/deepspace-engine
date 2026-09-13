# Visual Pass 1 — The Circuit: Node-State Treatment
**Author:** designer delegation · **Date:** 2026-09-13 · **Status:** art direction, implementation-ready for war Phase 1 (Circuit war overlay)
**Companion assets:** `site/public/art/circuit/` — one mockup PNG per state + the 1280×720 composite.
**Build target:** the live map at `site/src/game/map.ts` geometry (`ATLAS_CONFIG.viewBox 360×520`, node radii rim 16 / heart 26 / cradle 18 / near 12), rendered inside `CircuitTab` (`src/routes/play.tsx`). All classes use the `circuit-*` prefix (never "atlas").

---

## 1. Design law (from design-system-rung1-spec §C)

- **Never color-only.** Every state = shape channel + label/chip + hue. Grayscale contract: hatch ≠ ring ≠ star. A colorblind user must read every state from shape alone.
- **Labels ≥ 11px**, zoom-coupled; tier pips 11px; hit circle r26 (52px ≥ 44px floor).
- Purity gold is the only bright state on the map — rarity makes it loud. Celebration glow (step 3) only for real dents (first purify, deed cosmetic, Contribution Award).
- Pulse (1.4s) is reserved for live-war items only — contested (war phase) and the Chorus heart.
- Functional colors are GLOBAL: ember = resources/positive, hazard = Chorus/radiation, corrupt = taint, purity = Oracle/Unbound. Race accent = holder identity only.

## 2. States, exact recipes

Token hexes from `app.css` (`--surf-0 #070910` map frame / `--surf-2 #11161d` chips / text tokens). "Over" = alpha-composite result of the fill over surf-0 — that's what the engineer should render.

### 2.1 Contestable ground (default — Burning-Rim, no holder)
| Part | Recipe |
|---|---|
| Fill | tier color @ 22% over surf-0 — T1 `#4d7cc7→#162238`, T2 `#a78bfa→#2a2643`, T3 `#fb923c→#3d271a` |
| Stroke | `rgba(255,255,255,0.35)`, 1.5px |
| Tier pip | 11px bold, tier color (on surf-0): T1 4.76:1 · T2 7.31:1 · T3 8.79:1 — PASS |
| Label | `rgba(226,232,240,0.75)` 11px — 15.17:1 on `#111217`-class dim fills, 13.8:1 on surf-0 — PASS |
| Chip | none (no state to claim) |
| Hit circle | r26 transparent (unchanged) |

### 2.2 Home-protected (Near Ring — never contestable)
| Part | Recipe |
|---|---|
| Fill | `#18181b` (composited over surf-0 at node group opacity 0.6 → reads `#111217`) |
| Stroke | `#3f3f46`, 1.5px |
| Label | `rgba(226,232,240,0.75)` 11px — 8.83:1 on `#111217` — PASS |
| Chip | `HOME-PROTECTED` — chip bg `#11161d`, border `rgba(125,136,150,0.45)`, text `#7d8896` (5.05:1 on surf-2) |
| Dim | whole node group `opacity 0.6` (live behavior, kept) |
| Shape channel | dimming + thin dim ring; hover raises opacity to 0.85 |

### 2.3 Contested (war phase — holder flag flying)
| Part | Recipe |
|---|---|
| Fill | holder race accent @ 55% over surf-0 (Watchers `#b48cff→#665193`; per-race values in §4) |
| Ring | **double ring**: outer 1.2px `rgba(255,255,255,0.85)` at r+5, inner node stroke 1.5px `rgba(255,255,255,0.5)` — NEVER color-only |
| Glow | race-tint step-2 pulse (1.4s, live-war only): `0 0 10px` at 22% of accentText |
| Label | `#e7e9ea` 11px (13.93:1 on surf-3 / 15:1+ on surf-0) |
| Chips | `CONTESTED` (chip bg `#11161d`, border accent @55%, text accentText) + world-flag chip (small race sigil + world name, same chip style) — chip text is accentText on surf-2, all ≥ 4.5:1 (§4) |
| Shape channel | double ring + flag chip; additionally the burn-in "pulse" only during war phases |

### 2.4 Chorus-held (the heart — the prize and the threat)
| Part | Recipe |
|---|---|
| Fill | `#7f1d1d` (opaque) |
| Stroke | ember `#fb923c` 3px + corruption halo: r+7, 1.2px `rgba(177,78,196,0.5)` dashed `4 4` |
| Pulse | 1.6s `animate-pulse` on the heart (live-Chorus signature; allowed — it is the live antagonist) |
| Label | `THE CHORUS-HELD HEART` — `#fdba74` 11px, 5.94:1 on `#7f1d1d` — PASS |
| Sub-label | `THE PRIZE · THE THREAT` — `#ffbe80` (ember-soft) 11px tracked `1.5`, 10.44:1 on surf-0 — PASS |
| Chips | `CHORUS STRONGHOLD` — chip bg `#7f1d1d`, border ember `#fb923c`, text `#fff` (10.02:1) · `CORRUPTED` — border `rgba(224,124,240,0.5)`, text `#e07cf0` (6.71:1 on surf-2) |
| Shape channel | ember ring + corruption dashed halo + pulse; never a claimable neutral prize |

### 2.5 Purified (Oracle-cleaned ground — the bright state)
| Part | Recipe |
|---|---|
| Fill | purity `#ffd166` @ 55% over surf-0 → reads `#8f773f` |
| Ring | purity `#ffd166` 2px |
| Sigil | **radiating 8-point star** (starGlyph: 8 spikes, inner 0.35) filled `#ffd166` at r≈11×scale over the node |
| Glow | purity step-3 (celebrate) — the ONLY step-3 outside dents: `0 0 18px rgba(255,209,102,0.35) + 0 0 36px rgba(255,209,102,0.18)` |
| Label | `rgba(253,230,138,0.95)` (`#fde68a`-family) — 11.77:1 on surf-3 family — PASS |
| Chip | `PURIFIED` — chip bg `#11161d`, border purity `#ffd166`, text purity `#ffd166` (12.59:1 on surf-2) — the white-gold star is the shape channel |
| Shape channel | STAR (unique to purified) — a colorblind reader sees "star = clean" |

### 2.6 Unbound (the earned seventh — a soul-carried zone)
| Part | Recipe |
|---|---|
| Fill | `#f4f1e8` (chalk-white) — the one white node on the map |
| Ring | purity `#ffd166` 2.5px |
| Sigil | hollow inner circle r≈5.5×scale stroke `#11161d` + purity 8-point star r≈10×scale over it — "white core under the star" |
| Label | `#e7e9ea` 11px (on surf-0, 15:1) |
| Chip | `UNBOUND` — chip bg `#f4f1e8`, border purity `#ffd166`, text `#11161d` (16.08:1) |
| Shape channel | white core + gold ring + star; UNBOUND chip never renders before the state is earned (R7: no UI may advertise the Unbound track) — this recipe is for post-earn display only |
| Glow | purity step-2 (rest level), no pulse |

### 2.7 The Cradle (home edge — unchanged)
Fill `#14532d`, stroke `#fbbf24` 1.5px, label `THE CRADLE` `#fde68a` (7.32:1 on fill). Supply lanes run Cradle → Near Ring → Rim.

## 3. Composite mockup (`circuit-composite.png`, 1280×720)

War-week snapshot of a Watchers world, built at map.ts geometry (base positions × 1.32, offset to left pane; legend on the right):
- Heart = Chorus-held (with corruption halo) · Shattered Academies = Contested (Watchers flag, double ring) · Forge Valleys = Purified (star) · Collider Ruins = Unbound (white core + star) · Boneyard + Quantum Facility = Contestable (T1/T2) · all four Near Ring = Home-protected (dim) · Cradle at home edge.
- Edges per §C: road `rgba(143,155,179,0.65)` 2px (near `#5b6472` 1.5px), ruin-pass `#b45309` dashed `5 5`, severed `#7f1d1d` broken.
- Legend panel shows the exact legend chips the Circuit Legend should render (state swatches + trace keys + the "never color alone" note).
- The mockup is a STATIC composition — the engineer's job is to reproduce the recipes, not the exact positions of this particular seed.

## 4. Contested fill per race (accent @ 55% over surf-0) + chip text contrast

| Race | Accent fill @55% → composite | Chip text (accentText) on surf-2 | Ratio |
|---|---|---|---|
| Grays | `#9ad7e6` → `#587a86` | `#9ad7e6` | 11.45:1 PASS |
| Nephilim | `#c96f3f` → `#72412a` | `#dc8f5f` | 7.04:1 PASS |
| Draconians | `#3ad29b` → `#23785c` | `#58e0ab` | 10.95:1 PASS |
| Anunnaki | `#e8d9b2` → `#837b69` | `#e8d9b2` | 12.97:1 PASS |
| Asart | `#ffd166` → `#8f773f` | `#ffd166` | 12.59:1 PASS |
| Watchers | `#b48cff` → `#665193` | `#c9a4ff` | 8.85:1 PASS |

⚠ Engineer note: do NOT put dark or white text INSIDE the 55% contested fill — contrast varies by accent (white on Anunnaki fill is 4.20:1, black is worse). Labels live OUTSIDE the node on surf-0; chips use the dark chip recipe (surf-2 bg) listed in §2.3.

## 5. Contrast appendix (all pairings specified above, WCAG 2.1 AA)

| Pairing | Ratio | Verdict |
|---|---|---|
| Tier pip T1 `#4d7cc7` on surf-0 | 4.76:1 | PASS |
| Tier pip T2 `#a78bfa` on surf-0 | 7.31:1 | PASS |
| Tier pip T3 `#fb923c` on surf-0 | 8.79:1 | PASS |
| Label `rgba(226,232,240,0.75)` on dim near `#111217` | 8.83:1 | PASS |
| Heart label `#fdba74` on `#7f1d1d` | 5.94:1 | PASS |
| Heart chip white on `#7f1d1d` | 10.02:1 | PASS |
| Heart sub-label `#ffbe80` on surf-0 | 10.44:1 | PASS |
| Corrupt chip text `#e07cf0` on surf-2 | 6.71:1 | PASS |
| PURIFIED chip text on surf-2 | 12.59:1 | PASS |
| UNBOUND chip text `#11161d` on `#f4f1e8` | 16.08:1 | PASS |
| Cradle label `#fde68a` on `#14532d` | 7.32:1 | PASS |
| Edges (graphic, non-text): road `#8f9bb3@65%` eff | ~3.3:1 | UI OK |
| Ruin-pass `#b45309` on surf-0 | 3.96:1 | UI OK (3:1 component floor) |
| Watchers chalk `#f4f1e8` on ruled paper `#16181d` | 15.72:1 | PASS |

Contested 55% fills: UI-component floor 3:1 met by all six accent composites (worst = Watchers `#665193` at 3.00:1 vs the white ring — the double ring is the shape crutch; bump to 60% if the acceptance gate complains).

## 6. War overlay integration map (what the engineer builds from this)

- `CircuitTab` swaps static `nodeFill()` for a server-side war-state map: `zoneState: 'contestable' | 'home' | 'contested' | 'chorus' | 'purified' | 'unbound'`, plus `holderRace: RaceId | null`.
- Fill/stroke/sigil/chip selected by the table above; `starGlyph` and `chip` helpers attached.
- `aria-label` per node already exists via `title`; extend with the state word ("Contested — held by Watchers") for screen readers.
- War phase bottom bar `[FOBs▾][Legend▾][score .num]` and the HOLD/TAKE/PURIFY 48px sheet row arrive with the Phase-1 build — the state recipes above are the rendering contract they depend on.