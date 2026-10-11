# Seamless World Doctrine — One Functioning World

**Status:** owner-locked doctrine · **Locked:** 2026-10-10 (main-chat design session, 00:51–01:07 UTC Oct 11)
**Sources:** owner's voice-dictated direction that night; supersessions flagged in §8.
**Rule class:** THE rule for the whole game. Everything below this ships against it.

---

## §0 The Rule

The game is **one functioning world** — seamless, no scene-jumping, no loading-screen hops between locations.

- **Zoom is the only door.** The navigation reference the owner gives people: **Google Earth** — everybody has done the dive from space to street and knows how good it feels. Nobody needs a tutorial because their fingers already know the language.
- **Cradle entry:** find your Cradle on the globe → tap to focus → it centers → spread your fingers to zoom in → boom, you're standing inside it. Pinch back out and you're on the globe again. Scene-jumping is dead.
- This is the "oh wow" hook — the thing that grabs people. Owner: *"that's the only way this makes it."*

---

## §1 Orbital Zoom-to-Battle

The planet view is **alive**, and zoom is **one continuous range**:

- **Zoomed way out:** the globe, with battles visible as **dust clouds rising off the surface**.
- **Zoom in progressively** (a hundred miles up → closer → closer): the dust cloud resolves into a fight on the ground; the closer you get, the more detail renders.
- **Sound fades in with proximity** — extends the "sound is animation" doctrine: from space you *see* the dust; on the ground you *hear* the war. Distance = dust, ground = the full battle soundscape.
- **No page hop** between planet view and battle. One continuous zoom, no cuts.

Engineering shape (proposed, not locked): altitude drives LOD — battle markers at orbit, low-fidelity ground at altitude, full battle render + audio at ground.

---

## §2 Battle Maps

- **Benchmark: Evony's Atlantis battle scene** — big, dramatic, readable — but with **more depth**. *Internal reference only:* the Sep 12 rename ("World Atlas" → "THE CIRCUIT") was explicitly to keep Atlantis/Last-Land vocabulary out of player-facing names. Atlantis never appears in UI copy.
- **"More depth" = VISUAL depth** (owner clarified): layered ground, ridges that read as real elevation, a parallax feel — not extra tactical systems.
- **2D Plus** style throughout, same treatment for the **world maps**.
- **Fully functioning maps** for cross-world battles — the real thing, not a backdrop.

---

## §3 Movement Doctrine

**No boundaries on movement direction.** These are jump ships — they don't run on roads.

- Omnidirectional free movement on the battle map. No road networks, no constrained movement lanes, no direction locks.
- Supersedes any lane/path design at the battle scale (§8).

---

## §4 Map Scale

**Near-endless scrolling.** The player keeps scrolling and the world keeps coming — battle maps and world maps, vast, no edges to bump into.

- Supersedes the old fixed-size field.

---

## §5 Chorus Terrain Gradient

Battle map terrain transitions **radially toward the center**, where the Chorus resides:

- **Outskirts:** plush green vegetation.
- **Toward the center:** degrading into barren, cracked, **burnt wasteland**.

The land tells the story — you *see* their corruption in the ground before you ever see them.

---

## §6 Effects Quality Bar

Owner verdict on the current battle effects: **unacceptable.** Fireballs, dust, and war-map graphics are pixel blotches with no real rendering.

- **The bar:** properly rendered fireballs, volumetric dust, real explosions — graphics that grab you the second the battle opens. Not pixels and blobs.
- This is the acceptance standard for the art round. Everything is held to it.

---

## §7 Graphics = Survival (strategic call)

- **Full fidelity is the target; quality SETTINGS are the safety valve.** Ship the real graphics and let settings scale down for weaker phones — never cap everyone at the weakest device.
- Owner's anchor: phones today are more powerful than PCs were when **Myst** came out (1993).
- Final word from the owner: *"Pixelated, chunky, blocky kills the game before it starts. Nobody opens a game that looks like a placeholder anymore."*

---

## §8 Relationship to existing specs — architect's reconciliation

**Conflict:** `world-map-design.md` (2026-09-12) ratified a node-graph territory model (M1), roads & contiguity (§6), and a fixed field. Tonight's doctrine **supersedes all three at the battle scale**: free omnidirectional movement, no roads, near-endless scroll.

**Proposed resolution** (open — owner's call):
- **Strategic layer stays node-graph** — territory control, contiguity, war weeks, THE CIRCUIT. Contiguity still decides what you *can* contest.
- **Battle layer becomes a continuous free-scroll field** — entered by zooming in from a strategic node. The zoom IS the bridge: you never leave the world, you descend into it. Consistent with §0.
- The node graph is the campaign map; the zoom reveals the battlefield.

**Other touchpoints:**
- **Scene headers** (Oct 5 rule — location name, tier, live server clock on every scene): proposed extension — the header tracks zoom state (orbit = planet name, descent = zone/battle, ground = location). Owner decides.
- **Foreign-planet zoom-in — sheet vs. globe approach** (open since Oct 7, brief awaiting owner call): tonight's doctrine points at globe-zoom, but the explicit call is still his.
- **Sound doctrine:** orbital zoom extends "sound is animation" — add proximity-faded battle audio to the sound design spec when the build lands.

## §9 Build sequencing (proposed)

Design first, build second — the owner's rule, honored here. This doc is the design; the build queues behind his go.

- This is a long-horizon architectural change (the current client does page hops). Phase it so the live game never breaks: **battle-map depth + scroll + the effects bar first** (art round), **seamless zoom navigation after**.
- Do not ship half a zoom: a zoom that dead-ends into a loading screen is worse than a clean page hop.
