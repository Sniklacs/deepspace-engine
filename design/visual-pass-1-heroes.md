# Visual Pass 1 — Hero Portrait Art Direction
**Author:** designer delegation · **Date:** 2026-09-13 · **Status:** art direction — sets the bar for war Phase 1 hero presentation
**Companion asset:** `site/public/art/heroes/watcher-azazel-3.png` (860×1290, 219KB — sample portrait).

---

## 1. The sample: Azazel-3, the Teacher (Watchers Wave-1 tank)

Generated portrait of the roster's flagship hero. It demonstrates the full treatment:
- **Subject:** solemn teacher-scholar, weathered but unbroken, standing in front of what he taught — the "apologize by standing" energy of the flavor line.
- **Mood:** Frostpunk-grade atmosphere: near-black slate background, low-key lighting, one warm accent (the owl-eye amber dot) against a violet world.
- **World motif:** the Watcher "annotated examination" — faint ruled-paper lines in the backdrop, a single violet annotation mark, chalk-white highlights.

## 2. The style bar (rules for the war layer's hero presentation)

**Composition — the standard:**
- Head-and-shoulders bust, hero centered, face in the upper third, eyes at ~55–60% height (readable at 96px card and 240px detail).
- 3/4 or straight-on gaze, level or slightly raised chin (these are earned champions, not recruits — no cowering).
- One **identity object** visible and legible (Azazel's glowing sigil pin; each hero's gizmo/pin/wound-garment per heroes-design-brief §2 identities).

**Background treatment:**
- Always world-flavored, always dark, never busy at card size. Watcher rule: ruled-paper + marginalia + one warm dot. Each race's rule (from ui-benchmark §6): Grays = archive shelves/hairlines, Nephilim = monumental stone, Draconians = recessed vault/ledger, Anunnaki = over-grand architecture, Asart = lit sanctuary, Watchers = the examination sheet.
- Background color family = race accent tint (8–14%) over surf-0 `#070910`; the accent never dominates the face.

**Lighting & color:**
- Key light: cool white/blue-slate. Rim/identity light: the race accentText (Watchers `#c9a4ff`). One warm allowance per portrait (owl-eye amber `#e8c46a` for Watchers) for attention — matches the design law that race accent is identity, and functional colors are never owned by a race.
- No pure-white paper-light flooding; contrast the face against the dark (Chiaroscuro).

**Strict fiction framing** (same rule as sigils): these are myth-literary figures from the game's fiction — never any real-world group, nationality, religion, or person; no real-world religious iconography; no text, no logos, no writing in the frame (the marginalia marks are abstract).

## 3. Deed-earned vs cosmetic variants (the two-track rule)

| Variant | Who sees it | Visual delta (visuals only — zero engine effect) |
|---|---|---|
| **Core portrait** (base) | Everyone who has earned the hero | The canvas above; frame = race accent hairline; no ornament beyond the identity object. This is the honest "deed-earned" bar — heroes are earned, and the base look must already be great. |
| **Deed-earned cosmetic variant** (D-series, e.g. D5 Warden's Livery for leaders; hero deed variants ship later) | Only the colony that earned the deed | Adds a persistent, lore-backed marker: a scar-light, a relic carried, a second warm accent, a sigil frame upgrade. Never a different pose/composition that reads as a different character — the hero must stay recognizable. Never stat-carrying. |
| **Purchasable cosmetic variant** (future, G4-bound: hero cosmetics only at visual layer) | Any purchaser | Cosmetic garb/trim/frame — palette swap on the same composition, new clothing/harness details, same silhouette and identity object. Zero engine read (battle-side §9.3 rule: removing it changes zero engine outputs). |

**Enforcement:** the composition skeleton (pose, framing, identity object, background family) is locked by this pass. Variants move color, garb, frame, and small props — never silhouette, face, or identity object.

## 4. Engineering integration (war Phase 1)

- Portrait renders as an `<img src="/art/heroes/<heroId>.png">` inside the hero card; variants swap `src` by owned-entitlement (`owns()`), same box.
- Standard display sizes: **96×144** (squad roster list — 2:3 crop), **240×360** (squad detail), **full** (banner/induction ceremony, canvas 860×1290 displayed at ~440×660).
- All portraits ship as compressed PNG (≤300KB each) with the same 2:3 canvas so no crop math is needed per slot.
- Race sigil (`/art/races/<race>.svg`) sits beside the portrait on the detail card; the portrait never includes the sigil inside its canvas.
- Induction (deed-earned) display uses the existing celebration discipline: glow-3 ring + fade-in, only on the earn event; afterwards the hero card is quiet.

## 5. Next assets (when the war build schedules them)

Wave-1 Watcher roster portraits (8) at the Azazel-3 bar; then deed-earned variants (2 per hero max); signature "hero feats" History-Book line icons reuse the sigil dialect, not new art.