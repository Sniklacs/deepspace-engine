# Seamless World — Draft Amendments, 2026-10-11 (morning dev session)

**Status:** DRAFT — owner's word needed before any of this locks or builds.
**Sources:** Hans's voice-dictated direction during the 13:09–14:04 UTC Oct 11 session, transcribed from main-chat messages. Every rule below is his; the "proposed shape" lines are the architect's translation for review, not decisions.
**Related:** `seamless-world-doctrine.md` (owner-locked 2026-10-10). If approved, these fold in as §10–§13.

---

## §10 Spin → Scroll transition (owner: "at some point it has to transition")

Zoomed out, the globe **spins** — the globe you turn around. Push past **LOW ALT** and the spin is **gone**: it becomes a flat **2D scrollable map** that tracks **1:1 under the finger** and **stops when the finger stops** — no fling, no residual spin.

- Pinch zoom must never inject spin velocity (the "crazy spinning" bug was two-finger pinch feeding the spin handler — killed 13:14–13:42 UTC session).
- Proposed shape: a single altitude gate. Above it: globe physics (spin, fling). Below it: map physics (drag = pan, 1:1, zero inertia). No cross-contamination either way.
- Hans's acceptance language: *"when I'm zooming in... it has to be then just like scrollable"* — the handoff must be invisible.

**Owner call needed:** confirm the LOW ALT gate is the right hand-off point, or name another.

## §11 One continuous land map — no blue water (owner: "take all the blue away")

- **Strip ALL the blue water.** The map was reading as ocean with splashes of land; Hans rejected it outright. The planet is **one continuous landmass**.
- Not piles of overlapping map tiles / cutouts laid over each other — **one land map**.
- Chorus terrain gradient (§5 of the locked doctrine: green outskirts → cracked burnt wasteland at the center) applies to the single landmass.

**Owner call needed:** none on intent (locked by his word) — only on how the coastline-less world reads once rendered.

## §12 Layered LOD — the JPEG within a JPEG (owner's design, his words)

Hans's own spec: *"if I take a PNG or jpeg and it says 600 by 800 I zoom in well it's going to get pixelated... you have to... within that put another jpeg or PNG that is 1040 by 1200 or whatever and then the pixels are smaller again more detail... you're basically putting a JPEG within a jpeg... they're layered."*

- Each zoom band **bakes its own resolution layer** of the same terrain. Zooming in **swaps in the sharper layer** instead of stretching the old one — detail resolves as you descend, never pixelates.
- Same world underneath the whole way down (no pops, no swaps of geography).
- Accepted behavior: sharper layers bake a beat after arrival — the ground visibly *resolves*, "like watching it focus."

This supersedes the earlier failure mode Hans saw: zooming in stretched one blurry tile forever ("nothing is rendering as I zoom in it just gets blurry stays blurry basically it looks the same").

**Owner call needed:** confirm the resolve-lag is acceptable as a feature (the "focusing" read) vs. wanting pre-baked layers.

## §13 Marker interaction sheet (owner: "tap anything on the globe → it tells you what it is → one honest button")

**Zoomed out: legend icons only.** No clutter, no detail at orbit — markers stay as icons until touched. *"You don't have to show detail until we get into it... just keep the icon situation there for the legend."*

**Tap a marker → a detail sheet opens:**
- Says **what it is** (name, type, state — e.g. "G5 Bastion, Chorus-held, battle in progress").
- **One honest primary button**, chosen by context:
  - **Enter** — if it's enterable (arena, hall, colony, site you can walk into).
  - **Watch battle** — if a battle is in progress there.
  - **Reinforce** — if it's one of our guys / our alliance / our world battling someone from another world **AND** the battler's reinforcement toggle is ON. (His words: *"we should have a button there it says reinforce."*)
  - **Take me there** — dive-zoom all the way down to it (his candidate names: "take me there", "focus on this", "let's look at it", "inspect", "zoom in on it").

**Reinforcement toggle — on the battler's side:**
- One switch: *"I need reinforcements"* — on/off. *"Every time somebody sees that... it should be a button there for him to say refuse... or a toggle switch that is better where he just turn it on turn it off."*
- **No mid-battle accept/refuse popups, ever** — the offer only appears when the toggle is on. No spam, no crashing someone else's fight uninvited.
- "Refuse all" = the toggle turned off.

**Ground-level movement once you're down there:**
- Free scroll around the landed area; the "rolling part" — **swipe sensitivity like a mouse DPI**: flick to cross lots of land fast, nudge a little to look around a little. *"You can scroll quickly and it can cover lots of land or you can scroll a little bit at a time."*
- Hans's acceptance target, his words: *"find that happy spots of seeing our land or map and being able to scroll and be comfortable with it"* — comfort is the metric.

**Owner calls needed:**
1. Button name for the dive-to-site action: "Take me there" / "Inspect" / "Focus" / "Let's look at it" — pick one.
2. Reinforcement toggle default: on or off?
3. Swipe sensitivity: one tuned feel, or a player-adjustable setting (mouse-DPI style)?

---

## Build order (proposed, not locked)

Hans: *"once we get this map right then I think it will become a lot easier with the rest of it because then it's just our graphic art down on the bottom."* Map feel first — the happy spot — then art layers on top of the foundation.

1. Layered-LOD land map (§10–§12) — **on the test server now**, awaiting his phone QA.
2. Marker sheet (§13) — builds after he signs this draft.
3. Surface art / site detail dressing — after the map feels like home.
