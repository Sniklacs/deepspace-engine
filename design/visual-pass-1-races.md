# Visual Pass 1 — Six-Race Identity Sheet (sigils)
**Author:** designer delegation · **Date:** 2026-09-13 · **Status:** art direction, implementation-ready for Rung 1b + war Phase 1
**Companion assets:** `site/public/art/races/*.svg` (6 sigils, one per playable race). Watchers was already live in the client; all six now share one dialect.

---

## 1. The sigil dialect — one grammar, six marks

Every race sigil is built from the same four rules, so the set reads as one family at 24px (tab/nav) and 128px (banner/hero card):

1. **The shattered circuit ring.** A 24×24 stroke circle at r=10.5, stroke 1.5, with ONE gap — `stroke-dasharray="53 13"` puts the break at 3 o'clock on every mark. It is the shared "shattered circuit" that all six worlds walk; the break is deliberate (the war broke the web).
2. **One myth-mark per race** (owl / standing stone / serpent-ledger / ziggurat-sun / lantern / eye-over-book), drawn only in that race's accent.
3. **Stroke discipline.** All lines 1.75 for the mark, 1.5 for the ring; round caps and joins; no gradients, no shadows, no fills except the tiny identity dots (owl pupil, serpent head, lantern flame, sun, Watcher pupil) which use the same accent hex.
4. **Strict fiction framing.** Each mark encodes the race's myth-literary archetype ONLY (archivist's owl, giant's standing stone, subterranean ledger-serpent, god-architect's ziggurat, warden's lantern, fallen teacher's open book). None references any real-world group, nationality, religion, or person. Do not redraw these as real-world iconography.

## 2. The six marks + usage rules

Accent hexes are taken verbatim from `site/src/game/races.ts` (`RACES[].accent` fill / `accentText` text pair — single source of truth, never invent a hex). The sigil STROKE uses **accentText** (the AA-computed text value) because sigils render on dark surfaces; the identity dot FILL uses the same accentText hex.

| Race | File | Mark (myth) | accent / accentText | Sigil contrast on surf-2 `#11161d` |
|---|---|---|---|---|
| The Grays | `grays.svg` | The owl that watches (archive's owl-eye + filed-record ticks) | `#9ad7e6` / `#9ad7e6` | 11.45:1 (PASS) |
| The Nephilim | `nephilim.svg` | The stone that stands (broken peaks, uncracked standing stone) | `#c96f3f` / `#dc8f5f` | 7.04:1 (PASS) |
| The Draconians | `draconians.svg` | The serpent in the ledger (deep S-coil under the account rule) | `#3ad29b` / `#58e0ab` | 10.95:1 (PASS) |
| The Anunnaki | `anunnaki.svg` | The ziggurat under the sun (stepped tiers + builder's sun) | `#e8d9b2` / `#e8d9b2` | 12.97:1 (PASS) |
| The Asart Command | `asart.svg` | The lit lantern (upright lantern + flame, held against the dark) | `#ffd166` / `#ffd166` | 12.59:1 (PASS) |
| The Watchers | `watchers.svg` | The eye over the open book (the teacher who taught it anyway) | `#b48cff` / `#c9a4ff` | 8.85:1 (PASS) |

Also verified on surf-0 `#070910`: Grays 12.54 · Nephilim 7.71 · Draconians 12.00 · Anunnaki 14.21 · Asart 13.80 · Watchers 9.70 — all PASS ≥ 4.5:1. Full table in the contrast appendix (design/visual-pass-1-circuit.md §5 has the same method).

### 2.1 Where the accent may appear (one rule per race — apply to ALL six)

- **Allowed:** active segment/tab tint (8–14% fill), the race sigil itself, race badges & world-flag chips, race-tinted cards, map holder coloring (contested fill at 55% over surf-0), focus-adjacent glows, Armory sigil alpha math (unchanged behavior).
- **Allowed as TEXT** ONLY in the accentText hex listed above (each ≥ 4.5:1 on surf-2/surf-3, computed). Never the raw accent fill as text on dark.
- **NEVER:** body text on dark backgrounds unless AA-computed with white text (the accentText values above already are); never replace functional colors (ember = resources/positive, hazard = radiation/Chorus, corrupt = taint, purity = Oracle/Unbound, danger) — race accent colors *identity*, functional colors *meaning*, the two never cross.

### 2.2 Adjacency guards (from design-system-rung1-spec §A.3)

1. Asart gold ≡ purity gold by design — disambiguate with shape channels (lantern sigil, 55% fill + flag chip on the map), never by forking the hex.
2. Draconian green never sits adjacent to hazard-teal radiation semantics on the same surface.
3. Nephilim rust-text ≥13px in text runs; ember never on Nephilim chrome.
4. Grays owl-eye amber is RESERVED for attention blinks (Chorus stirs, study complete) — do not use amber as Grays chrome.

## 3. Engineer build notes (Rung 1b / war Phase 1)

- SVG files live at `site/public/art/races/<id>.svg` — served at `/art/races/<id>.svg` (Vite `public/` dir). Use them via `<img>`, or inline for tinting; the files are ~0.4–0.6 KB each.
- Rendering at 24px: the ring gap and the accent dot survive 24px; if a mark reads noisy on a specific surface, the fix is `stroke-width: 1.25` at 24px context, never redrawing.
- Do NOT recolor via CSS `filter` — the accent is baked per file; a per-race tint comes from the token variables (`--race-<id>-text`) already in `app.css`.
- Contrast acceptance gate targets: sigil stroke ≥ 4.5:1 on the surface it renders on (all six pass on surf-0/2/3). The gate suite should assert the six accentText hexes against `--surf-2` and `--surf-3` (values listed above).