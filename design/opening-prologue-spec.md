# The Fall — Opening Prologue Spec (you had it all, then you lose it all)

**Author:** team lead · **Date:** 2026-09-13 · **Status:** owner-directed working spec — build scoping for the new first session. Not yet owner-ratified (decisions P1–P8 in §10).

---

## §1 The problem this solves

The current open is passive: create a colony, send an expedition, wait. A visitor decides in the first
30 seconds, and "click a button and watch a timer" loses them before they ever see the war, the heroes,
or the deep systems. The owner's directive (verbatim intent):

> *"I can't grab people and get them to come and play if there's nothing in the beginning to grab them…
> we bring the player in at the end of the war when they lose it all — the height of the battle at the
> end — they've got everything, all of it — they're at the epic, unbound, ready to be everything. They see
> what they can have. This has got to go on for a good first 12 hours of the game so they're hooked."*

This spec turns that into a build. The opening is not a tutorial and not a cutscene — it is a **playable
full-power prologue** that ends in a scripted cataclysm, then hands the player to the real game as a
remnant climbing back to a feeling they already tasted.

---

## §2 The vision, captured faithfully

1. **You open at the height of the final war.** Colony maxed, heroes at full power, the whole arsenal
   unlocked, on the cusp of the transcendent human state ("the epic, unbound — ready to be everything").
2. **You live that power for a real stretch — hours, not a cutscene.** You actually *play* the endgame:
   command the full hero roster, fight real-time battles, hold territory, feel what "everything" means.
3. **Then the war turns and you lose it all.** A scripted, inevitable cataclysm — the Chorus overwhelms —
   and the colony, the heroes, the arsenal, all of it is gone.
4. **You wake with nothing** — a single Cradle in the ruins — and the real game begins: rebuild, re-earn,
   and climb back toward the thing you had. Expeditions stop being busywork and become the *road back*.

The one-sentence pitch the open delivers to a new player: **"You were a legend. You had everything. You
lost it. Now take it back."**

**The bar is set at the top (owner 2026-09-13).** The opening's graphics and feeling are not a one-time hook
— the whole game must live at that bar. *"We can't fall backwards; we have to maintain that type of graphics
and feeling to keep them."* A player grabbed by the epic open and dropped onto a flat colony screen bounces —
angrier than if they were never wowed. **Nothing ships below the bar the opening sets** — the colony, the
expeditions, the Circuit, the war, the heroes all get the same art direction, cinematic feeling, and polish.
The concept trailer is the *style bible*: it pins the exact bar every other screen must match.

**The bond is with the Leaders (owner 2026-09-13).** The opening's emotional engine is the player's bond with
their *named Leaders* — and it must form **immediately**. In Act I the Leaders are introduced as *characters*
(named, voiced, with personality and a relationship to the player), never as stat blocks. They are who the
narrator/heroes/player are talking *to* and *with*. The Leaders' stand (§6.1) and the final order (§6.2) only
land because the player genuinely cares about *these specific people* — so Act I's job is to make that care
real before Act II spends it. Post-Fall, re-earning those same Leaders becomes the climb back to *people* the
player already knew — which is exactly the "feeling already tasted" the open promises.

---

## §3 The three acts

### Act I — The Height (full power, playable)
- A **seeded max-power state** (§4) is handed to the player as their own — no grinding to it.
- The player commands the **final war's last stand**: a guided sequence of escalating real-time battles
  (§5, running on the *same* war/battle engine as the real game — battle-side §15). They win several
  thrilling engagements (dopamine, spectacle, moving UI), see their heroes and arsenal in action.
- The stretch **widens over builds** (§9): first the engine + the opening hours, then more endgame
  content (raids, territory, full freedom) until it is a genuine multi-hour chapter, not a rail.

### Act II — The Fall (scripted cataclysm)
- The Chorus launches its final, overwhelming assault — a battle the player can **fight hard and see
  their power matter in, but cannot win** (§6). The loss is inevitable but *earned*, never arbitrary.
- Everything falls: the colony, the heroes, the arsenal, the research — reduced to ruin and memory.
- Thematically this IS the lore's "war between humans and AI" ending — the planet's wrecking, seen from
  the inside. It ties directly to the Chorus ratchet taken to its world-ending extreme.

### Act III — The Wake (reset + rebuild)
- The player wakes in the Shatterlands with a **single Cradle** — the current onboarding entry point.
- They create/name their new colony (existing flow) and begin the real loop with a motive no fresh start
  has ever had: **they know what they're climbing back toward** (§7).

---

## §4 The full-power state — what "had it all" means (mechanical)

A `prologueState()` factory produces a fully-unlocked colony reusing existing data, nothing new invented:
- **Colony** — max Cradle tier, all research complete, all Codices earned, full leader roster (max level
  L10, specialized).
- **Armory** — all 5 weapon families × all 4 tiers + Plasma (`weapons-system.md`).
- **Heroes** — the full roster at max level L10, specialized, full squad (Watchers Wave-1 eight heroes from
  `heroes-data.ts`; the prologue may also *preview* names the player lost — see P6).
- **War posture** — Citadel-stage FOB (`battle-side §12`), deep war supply, high contribution score.
- **The edge** — the player is shown *on the cusp* of the transcendent state, without it ever being named
  (§7 Unbound note).

This is a **configuration/seed**, not a new progression system — the same state shape the real game builds
toward, pre-filled.

---

## §5 The playable stretch — hours, not a cutscene

**The rule: the prologue runs on the real endgame engine, not a separate mini-game.** Building the
prologue *is* building the war/battle layer. There is no throwaway content.

- **Battles** — real-time battle entities with a live view (`battle-side §15`): outcome from hero stats +
  weapon tiers + FOB stage, duration ∝ force size / 1/gap (5 min–8 h clamp), mid-battle decision windows
  (reinforce / hold / steady withdrawal / retreat / aid call). The player makes the same consequential
  micro-decisions the real war demands.
- **Command** — squad composition, which skill to time, purify-vs-claim. "Decision moments, not APM."
- **Spectacle** — the live Battles tab, casualties ticking, the line shifting — *moving UI*, the thing the
  owner called out. The designer owns the battle view + the Fall's cinematography (separate brief).
- **Length** — owner target ~12h of full-power play. This is a *content volume*, so it is staged (§9):
  first the engine + the opening hours (the hook ships playable), then widen the stretch into a full chapter.

---

## §6 The Fall — the scripted loss (fair, not cheap)

- **Guaranteed, not arbitrary.** Act II is one unwinnable battle: an overwhelming, fixed Chorus force with
  no purchasable or grindable counter. The player's every input still resolves honestly — they deal real
  damage, they see their power *work* — but the scale is beyond winning.
- **Fairness guardrails (the same "never a cliff" rule as the ratchet):**
  - The odds are **shown**, not hidden — the player knows it is the last stand and fights anyway.
  - The loss is **never a purchase prompt** (no "spend to survive" — it cannot be survived).
  - The player is **never humiliated** — they are mourned: the game frames the fall as the world's loss,
    not the player's failure.
- **What is lost:** the colony, heroes, arsenal, research, leaders — all of it. Only identity + memory
  carry forward (P6 decides how much echoes).
- **Chorus tie-in:** this is the Chorus at 100% attention scaled to a world-ending event — the ratchet's
  worst tier told as history, which retroactively gives the real game's Chorus meter its dread.

### 6.1 The Leaders' stand & the escape (owner 2026-09-13)

Near the end of the final battle, when the line has broken and the colony is falling, the **Leaders take
over**. The beat, in the owner's words: *"our leaders in our Cradle take over and tell our hero — our player
— to get out; they will cover this. They take over and just start making the calls, doing everything, and the
player is watching it in real time — just watching the action play out."*

- **The perspective shift — actor to witness.** The player is still fighting; then the Leaders step in,
  order them out, and take command. Control is deliberately handed off: the player becomes a **spectator**,
  watching the Leaders run the final stand in real time on the live battle view (the first use of spectate
  mode — battle-side §15 B2 already anticipates it).
- **The Leaders get their moment.** The colony/strategy layer earns its emotional weight: the Leaders are
  the ones who sacrifice so the player escapes. They make the same calls the player has been learning (§12) —
  reinforce, hold, withdrawal — now seen from the outside, which quietly reinforces the tutorial.
- **The escape = the reset.** The player gets out; the Cradle, the Leaders, and the heroes all fall covering
  them. This is what "you lost it all" means mechanically — and it makes the loss *personal*: you survived
  because they chose to cover you.
- **"Watching" is the emotional device.** The powerlessness of the fall is made literal — at the end, you
  don't act, you witness. That powerlessness is what gives Act III's "rebuild and climb back" its fire.

### 6.2 The final order (owner 2026-09-13)

At the very end, the Leaders — who just covered the player's escape — turn back: *"We can't hold them back,
sir — what do we do?"* The player is handed the **last actions**: the final decisions to try to save their
race.

- **Agency returns at the weightiest moment.** The arc is: fight → watch the Leaders hold → receive the
  final order. The Leaders saved the player; now they lay the race's fate at the player's feet — humility and
  responsibility in the same breath.
- **The last actions are consequential, not cosmetic.** They decide the "seed" the player carries into Act
  III — what survives the fall and shapes the rebuild. (**LOCKED (owner 2026-09-15)** — the final choice is **"what the ash remembers"**: three rebuild seeds,
  none correct, none purchasable, recorded as a one-time account-level echo. **The Archive** (knowledge — one
  remembered Codex; Vyra "lost, not found") · **The Names** (people — the five Leaders' names pre-seeded in
  the History Book, so the climb back is toward known people) · **The Light** (purity — a small starting
  devotion; Delen's near-riddle remembered). See script §7.)
- **"Save the race, not yourself."** The final order frames the whole game's object — the race's survival —
  which is exactly what the rebuild is for. This keeps the fall "fair" (§6): the colony still falls, but the
  player's last decision genuinely matters.

### 6.3 He goes dark — into the war-torn world (owner 2026-09-13)

After the final order, the player **goes dark** — a fade to black, and to silence, as the last stand falls
behind them. Then the **opening of the war-torn world**: the screen rises on the Shatterlands as they are
*now* — ruined, quiet, the Cradle broken, the aftermath stretching to the horizon.

- **"Goes dark" is the seam.** The fade is the literal moment of loss — the escape into darkness, the old
  world ending behind the player. The VO drops out here; the silence does the work.
- **The war-torn world reveal is the real game's true opening shot.** The player wakes not in a menu but in
  the aftermath — the destroyed world they are now responsible for rebuilding. It lands *because* the player
  just saw what it was at its height.
- **Hands off to Act III.** The reveal settles on the single Cradle (the existing onboarding entry point),
  and the rebuild loop begins — with the contrast between "what it was" and "what it is" carrying the whole
  motive.

---

## §7 The reset & the emotional anchor (the Unbound connection)

- After the fall, the player lands in the **existing onboarding** (single Cradle, name the colony) with the
  prologue's memory as an account-level flag.
- **The prologue is the emotional engine of the rebuild.** The hidden Unbound revelation track ("rebuild
  without AI, earned from within, no clues") gains its pull from the open: the player has *felt* the
  transcendent edge once and lost it. Climbing back is not discovery for its own sake — it is *reclaiming*.
- **Silence discipline is preserved (hard rule).** Act I shows the *feeling* of "about to become
  everything" and never names it "Unbound," never shows the track, never previews its mechanics or its
  heroes. The no-clue rule (unbound doc §8–9) is untouched — the open gives the *yearning*, not the *map*.
- **Optional echo (P6):** the player's lost heroes can persist as names in the History Book / as ruins on
  the Circuit, so the memory is concrete without short-circuiting the silent track.

---

## §8 Technical architecture

- **Prologue state machine** — new module `src/game/prologue/`: `prologue-state.ts` (the §4 seed),
  `prologue-script.ts` (act beats + the fall trigger), `prologue-engine.ts` (pure, `advance()`-style,
  offline-safe). It is a *separate* machine from the colony game; on completion it hands off to the
  existing colony-creation flow with a `prologueCompleted` account flag.
- **Battle engine dependency** — the prologue's battles run on the war engine (`src/game/war/`, battle-side
  §15 + §10). This is the prerequisite build (§9).
- **Reused data, zero new progression** — `heroes-data.ts`, `hero-xp.ts`, `war-energy.ts` (all live in V9),
  `weapons`/`armory`, `research`, `leader-xp`, `map.ts`/`world-config.ts` (Circuit geography).
- **Persistence** — prologue state is account-scoped (Postgres via `store.ts`); the flag survives the
  fall. No cross-account leakage; nothing in the prologue has a purchase path.
- **Per-race versions** — the open is the *race's* last stand. Beta ships the **Watchers** prologue first;
  the other five races get theirs with their live worlds (same codebase, per-world script constant).

---

## §9 Build order (staged — this re-sequences the whole queue)

1. **Step 1 — the battle engine (prerequisite, the "real engine").** War Phase 1 §15: real-time battle
   entities, live battle view, decision windows, battle reports. This is the engine the owner is asking for,
   and every later module (competition, war) rides on it.
2. **Step 2 — the prologue wrapper (first playable hook).** `prologueState()` seed + Act I's opening
   battles + Act II (the Fall) + Act III (reset). Ships the thrilling first session end-to-end.
3. **Step 3 — widen the stretch.** More Act I content until the full-power segment is a genuine hours-long
   chapter (owner's ~12h target), with the designer's battle-view/cinematography pass.
4. **Step 4 — rebuild + intra-server competition.** The real game after the fall, with contested zones and
   a live leaderboard — the "competition within our own server" that keeps players after the hook.

**Honest scope note:** Steps 1–2 are a substantial build (the battle engine is a major lift), but it is
the right investment — it is simultaneously the hook, the "real engine," and the foundation of the war.
The polish queue (audio, store, chat, trade) drops below this line until the hook ships.

---

## §10 Design flags (owner decisions — not conclusions)

- **P1 — Working title:** "The Fall" (vs "The Sundering" / "The Last War").
- **P2 — Stretch length target:** confirm ~12h of full-power play as the goal, with the staged path
  (engine + opening hours first, widen after). vs a shorter first target.
- **P3 — Act I shape:** guided escalating battles for the opening → opening into freer endgame play as the
  stretch widens (recommended), vs a free sandbox from minute one.
- **P4 — The fall is scripted-unwinnable:** confirm the player fights hard but *cannot* win, and the loss
  is never a purchase prompt.
- **P5 — Unbound framing:** the open shows the *feeling* of the transcendent edge and never names/shows
  the track (silence discipline preserved) — confirm.
- **P6 — What echoes after the fall:** identity only, or also concrete echoes (lost heroes as History Book
  names / Circuit ruins)? Recommend: light echoes, no mechanic short-circuit.
- **P7 — Replay/skip:** is the prologue skippable on new accounts and replayable from settings (for
  returning players and testers)? Recommend: skippable + replayable, flag recorded.
- **P8 — Per-race rollout:** Watchers prologue ships first (beta), other five races with their worlds —
  confirm.
- **P9 — Voice source:** AI-generated voices now → professional actors as the polish pass (recommended),
  vs professional VO from the start. Voiceovers are *actual audible speech* from build one.
- **P10 — Narrator identity:** an omniscient "world voice" (recommended) vs a named character narrator.
- **P11 — The Chorus speaks in a distorted, synthetic machine voice** (thematically exact for the AI
  antagonist) — confirm.
- **P12 — Story scope:** write the prologue's script first; the ongoing in-depth storyline threads through
  later modules (Oracle riddles in voice, hero backstories, the History Book, the silent Unbound revelation)
  — confirm.
- **P13 — The "last actions":** **APPROVED (owner 2026-09-15)** — the final choice is **"what the ash
  remembers"**: Archive (knowledge) / Names (people) / Light (purity) — three rebuild seeds, none correct, none
  purchasable, one-time account-level echo (§6.2; script §7).
- **P14 — Agency arc:** confirm fight → watch the Leaders hold → receive the final order (§6.1–6.2), vs.
  pure spectator through the end.

---

## §11 Storyline, voiceovers & cinematic presentation (owner 2026-09-13)

**Owner's directive (captured):** *"I want voice overs — actual speaking — and a storyline that comes with
it. A real, in-depth story that drags you in, starts you over, and now you know what you're working for —
voiceovers and real action."*

The opening is not a silent power-fantasy — it is a **voice-acted, story-driven prologue**. Voice + story +
action together are what make the loss land and the rebuild matter. This is the emotional engine that turns
"you had it all, you lost it" from a mechanic into a *memory*.

### 11.1 The narrative — three acts, told in voice

- **Act I — The Height.** Cold open (narrator): the hundred-year war, the player as the last hope, the
  final push. The eight heroes are introduced *in voice* — each gets a line, establishing them as
  characters, not stat skins (heroes brief §R5). The player wins real-time battles while the story unfolds
  through narrator + hero voices. The power fantasy peaks.
- **Act II — The Fall.** The turn — the narrator's tone shifts: *"You were winning. You were always going
  to lose."* The final battle is fought and lost; colony and heroes fall in voiced moments of sacrifice
  ("the archive burns; the lecturer falls silent"). The Chorus is heard as a **distorted synthetic voice**.
- **Act III — The Wake.** The narrator reframes: *"You wake in the ash. You have nothing. But you remember
  everything. Rebuild. Remember. Climb."* The hook is delivered *in voice* — the player now knows what
  they're working for.

### 11.2 Voice cast (who speaks)

- **The Narrator** — the world's voice; carries the emotional through-line (the "drag you in").
- **The player's heroes** — voiced characters, each with an identity (a line in Act I, a beat in Act II).
- **The Oracle** — riddles spoken in voice (this also seeds the later riddle-day tradition).
- **The Chorus** — distorted/synthetic machine voice; the antagonist's sound.

### 11.3 Voice source (flag P9)

- **Recommendation: AI-generated voices now → professional actors as the polish pass.** AI TTS (e.g.
  ElevenLabs-class) gets *actual spoken audio* into the build immediately, is cheap and infinitely iterable
  (script edits re-render instantly), and matches the plan's "revenue funds the format upgrade" logic — ship
  the story with AI voices, then replace the marquee roles (narrator + a hero or two) with professional VO
  when revenue allows.

### 11.4 Cinematic presentation & audio pipeline

- **The designer owns the cinematography** — scene framing, camera/pan over the Circuit, the battle view as
  a stage, the fall's visual collapse — with story + VO + action timed together.
- **Audio pipeline:** VO playback synced to scene beats via Web Audio (`sound.ts` already exists);
  **captions on by default** (accessibility, WCAG AA).
- **Music (owner 2026-09-13):** no low ambient hum — the opening's score is **upbeat, driving,
  high-energy** ("pump the heart"), matched to the action; the in-game background music follows the same
  direction (kill the tranquil buzz).

### 11.5 Story depth beyond the opening

- The prologue is the story's *anchor*. The ongoing in-depth storyline threads through what's already built
  and planned: Oracle riddles (voice), hero backstories, the History Book's narration, the silent Unbound
  revelation, the Mentor's Lantern. **The opening's script is written first; the ongoing story is a
  follow-up deliverable (flag P12).**

---

## §12 The in-battle tutorial — teach them while they're thrown in (owner 2026-09-13)

**Owner's directive (captured):** *"When we throw them into the middle of this we need a tutorial to lay it
all out — what they're supposed to do, how to do it, when to send reinforcements, when to ask for
reinforcements, and what to do when they're getting pummeled."*

The tension — throw them into the action *and* teach them — is resolved by making the tutorial **diegetic and
in-the-moment**: the opening's voice-acted narrator + heroes (§11) *are* the tutorial. The player learns by
following orders in the heat of it, not by reading a manual first.

### 12.1 The tutorial is Act I's first battle
- No separate prelude, no instruction screen. The first battle is a **guided live tutorial** run on the real
  engine (§5): the narrator frames the scene, the heroes cue the player, and the UI highlights what to touch.
- **Progressive scaffolding:** the first battle is fully guided (highlighted controls, spoken cues); guidance
  fades across the opening's later battles as the player internalizes, ending hands-off.

### 12.2 What it teaches (the decision windows — battle-side §15)
- **Read the battle** — sides, force sizes, the live state chip (Stalemate / Pressing / Rout risk).
- **Command** — squad composition and which skill to time (decision moments, not APM).
- **Reinforce / hold** — when to feed a fight vs. hold the line.
- **Ask for reinforcements (aid call)** — the co-op mechanic: when to call teammates, how arrivals ride the
  travel-time over links.
- **When you're pummeled** — the retreat / steady-withdrawal decision (rearguard cost vs. saving the army),
  and when to call aid instead.

### 12.3 The "pummeled" moment is taught *survivable* first
- The tutorial teaches retreat/withdrawal/aid in a fight the player can still win — so that when the
  unwinnable Fall (§6) comes, they already know their tools. The loss then reads as "the scale was beyond
  winning," never "I didn't know what to do."

### 12.4 Skip / replay & accessibility
- Returning players skip the guided version; first-timers get full guidance (extends flag P7).
- Spoken cues + captions keep it accessible (WCAG AA); every prompt has a text twin.
