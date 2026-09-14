# Deepspace Engine — Style Bible · "ASHED CIRCUITRY"

**Concept-trailer visual layer (delegation 2026-09-14) · Status: WORKING ART DIRECTION — the bar every screen must hold (opening-prologue-spec §2, "the bar is set at the top").**
**Companion artifacts:** `concept-trailer/index.html` (target render) · `concept-trailer/beat-sheet.md` (assembly spec) · `concept-trailer/mockups/*.html` (upgraded real UI) · `concept-trailer/stills/*.png` (six key stills).

---

## 1. The one-sentence direction

**A dead circuit-world, lit only by meaning** — near-black blue-slate surfaces everywhere; every light on screen is a *statement*: ember-orange is human effort, magenta is the Chorus's grip, gold is the Cradle/Oracle/return, and the six race accents color identity alone.

This is the canon mood system (ui-benchmark-notes §4 — **Blacksite Terminal base + Aurora Conduit thematic layer + Foundry Amber as the ember/return state**) taken to cinematic intensity. Nothing in the trailer invents a new visual language; it *escalates* the one already ratified, so the game can actually live at this bar.

## 2. Locked palette (verbatim tokens — same values the live app ships)

**Surfaces (Blacksite Terminal, app.css):**
| Token | Value | Use |
|---|---|---|
| `--surf-0` | `#070910` | page base, map frame, fades-to |
| `--surf-1` | `#0b0f14` | chrome, headers, sticky bars |
| `--surf-2` | `#11161d` | cards, panels |
| `--surf-3` | `#161d26` | raised cards, sheets |
| `--surf-4` | `#1c2530` | hover / input fills |
| `--line` | `rgba(163,173,187,.16)` | hairlines |
| `--line-strong` | `#22303c` | header rules, docks |

**Text:** `#e7e9ea` (primary) · `#9aa4b2` (body) · `#8490a0` (muted ≥12px) — all ≥4.5:1 on surfaces, canon.

**Functional — meaning, never race-owned (global on all six worlds):**
- **Ember** `#ff9d3c` / ember-soft `#ffbe80` — resources, positive, Earned, **all human warmth**. In the trailer: the colony's light at The Height, the leaders' firelight, the last dying coal.
- **Hazard** `#4fd8c8` / `#7fe8dc` — radiation, and the Chorus's cold machine-pulse where it touches the planet.
- **Corruption** fill `#b14ec4` / text `#e07cf0` — taint, the Chorus horde, the heart's hunt. **The antagonist's color in every still.**
- **Purity** `#ffd166` — Oracle, Unbound, Devotion, **the Cradle's ring, the purified ★, the final gold spark in the ash.**
- **Danger** `#ef4444` / `#f87171` — rout risk, the moment the line breaks.

**Identity (Watchers — the beta world; per-world CSS variables shift this layer only):**
- Forbidden violet `#b48cff` (fill) / `#c9a4ff` (text) — sigils, keeper medallions, race chrome, the "◆" mark.
- Razor-cyan `#5fd4e6` — the invader/other side on the war board (disambiguation by color *and* label, never color alone).
- Chalk-white `#f4f1e8` — titles, the exam-paper headers.

**Circuit map canon (circuit-tokens.ts, unchanged):** T1 `#4d7cc7` · T2 `#a78bfa` · T3 `#fb923c` · heart `#7f1d1d` ringed `#fb923c` · cradle `#14532d` ringed `#fbbf24` · near `#18181b` · road `#8f9bb3` · ruin-pass `#b45309` dashed · severed `#7f1d1d`.

**Rule that never bends:** functional colors color *meaning*; race accents color *identity*. The two never cross. Purity gold never becomes a leader accent; Asart shares gold by shape only (canon decision 1) — shape + label always second the color.

## 3. Lighting — "motivated light in a dead world"

1. **Every light source is diegetic and means something.** No ambient glow for decoration: embers, forge glow, plasma, the Cradle ring, a burning colony wall, the Chorus's magenta wash. If a light doesn't communicate state or consequence, cut it (canon motion rule applied to light).
2. **Key light always tells the scene's truth.** The Height = warm amber + cold distant aurora (world *alive*). The battle = split lighting: ember lines vs. the magenta horde. The stand = backlight (gold colony light silhouetting the Keepers — they burn between the player and the dark). The final order = firelight on faces, shallow DOF (the moment is intimate even as the world ends). Goes dark = no key light at all, one coal. The wake = cold blue dawn, one gold ring (the only warm thing; the return starts here).
3. **Volume and haze.** Volumetric haze, ember particulates, dust; filmic contrast (deep blacks, restrained highlights — S-curve, not crushed). Vignette is the default frame; the map's aurora wash is the only exception (the circuit keeps a faint violet/Cyan glow of its own).
4. **Sparse glow reads premium.** Glow = semantics at 3 intensities (canon): soft (chip/state), medium (live war pulse), loud (purified zone, Climax, the Cradle ring at the wake). Glow-everywhere reads cheap.
5. **The Chorus is never beautiful.** Magenta is used as invasive wash, crawling edge-light, and corrupted ground states — never as hero glamour.

## 4. Mood — the three-act arc is the mood arc

| Act | Mood | Palette behavior | Motion |
|---|---|---|---|
| I — The Height | Triumphant, alive, *full-throated* | Ember-light everywhere; the colony blazing; violet/cyan conduits; sunlit-aurora accents | Driving, confident, upbeat (music: §11.4) |
| II — The Fall | Solemn, inevitable, weighty | Key light narrows; magenta grows; gold dims to the Cradle ring | Slows; the Leaders take over; the player becomes a spectator (§6.1) |
| III — The Wake | Quiet, cold, one spark | Blue dawn; desaturated ash; ONE gold ring | Stillness; silence does the work (§6.3) |

**Celebration discipline carries over (canon §5):** in the trailer's UI frames only *real dents* glow — the Climax ticker, the purified star, a battle win in the log, the Cradle ring. Everything else stays calm and factual.

## 5. Typography, density, shape

- **System grotesque for UI/lore; mono + tabular-nums for every numeral** (canon — zero webfont cost; `font-variant-numeric: tabular-nums` everywhere numbers tick).
- **Density: Whiteout discipline** — ≤7 key things per screen; everything a card or chip; numbers formatted identically (canon §1.2).
- **Radius family** stays: 10–14px cards, 999 chips, 8px icon buttons. The epic upgrade is *light, depth, and header art* — not heavier chrome; restraint reads premium.
- **The 44px floor and thumb-reach zones hold in every mockup** (orders, claim, purify, dock buttons all ≥44px tall, primary actions bottom-half).
- **The honest label is part of the system:** any concept-trailer artifact carries "TARGET RENDER — not gameplay capture" so it never pollutes real product screens.

## 6. What "epic" concretely means for the real UI (the mockups' recipe)

The three mockups are the real components (BattlesTab list/detail/log, ColonyTab devotion/health/domains/workshop, CircuitPage map/sheet/legend) with exactly four additions, all deployable with CSS:

1. **Hero bands** — the stills as header art behind the screen's title (Battles: the battle; Colony: the Height; Circuit keeps its map, the war score strip carries the drama).
2. **War presence** — the live score strip, Climax ticker, battlefield markers, FOB chip. The week's engine made visible (battle-side §3/§15).
3. **The Keepers seam** — named Leaders as people (opening spec §2: bond with the Leaders is the emotional engine). Violet medallions, roles, L10 — characters, not stat blocks.
4. **Decision windows as stage** — the mid-battle order sheet (reinforce/hold/withdrawal/aid) framed as *consequential theatre*, gold-bordered, one live clock.

**Deferred (explicitly out of this pass):** full motion/video, VO + music (they follow the beat sheet), per-race chrome beyond Watchers, hero/portrait illustration at scale, AAA fidelity (canon Rung 3 — out of scope by design).

## 7. Fiction safety rails (binding)

- All imagery is **myth-literary in-universe fiction** (races.md). No figure, sigil, or scene maps to a real-world religion, ethnicity, or nation; no angel/mythology iconography rendered literally — Watchers are armored scholar-keepers with violet light, never winged figures.
- The Chorus is a machine antagonist (distorted synthetic voice per §11.2); the magenta horde reads as **machinery**, not people.
- Nothing in any still or mockup shows a purchase surface, currency-as-power, or urgency theater (guardrails G1–G4 / monetization §5: no hero power for sale, no dark patterns — the mockups show earned state, earn-only badges, "never bought" copy where the real UI says it).