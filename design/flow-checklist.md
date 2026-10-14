# THE FLOW CHECKLIST — check flow, check flow, check flow, constantly

The standing QA charter for The Unbound, founded Oct 14 2026 on Hans's order:

> "I want a crew that that's all they do is just go through the game and check
> things — check flow, check flow, check flow, constantly… if things don't work
> when you press it, that's annoying."

**The Flow Crew builds nothing.** It presses things. Every press must do what
it promises, every door must open, every exit must exit, every choice must
arrive where it was sent. A green server is not a working game; a working game
is what a stranger's thumb experiences at phone size.

**How to run it:** `cd site && bun flow-check/run.mjs` — builds the current
tree and serves the bundle on its own port (the built bundle, like the
gauntlet drives — dev-server mode hangs this app's server functions), then
drives it in headless Chrome at phone size
(390×844, dpr 2, touch), prints the pass/fail table below, and writes the run to
`site/flow-check/last-run.md`. If the lab box itself starves the browser
(ERR_INSUFFICIENT_RESOURCES at boot), the run reports ENVIRONMENT STARVED
and voids its own verdicts — the crew never blames the game for the lab. Lines automation can't honestly drive are
marked **MANUAL** here and in the run, with the exact taps to perform.
Run it after every battle/UI-touching deploy and on the daily sweep.

**Verdicts:** PASS (pressed it, it did the thing) · FAIL (pressed it, it
didn't — a bug, always) · MANUAL (not automatable; do the listed taps) ·
KNOWN (red tonight, owned by a named in-flight fix — the crew re-checks until
it flips green; it never gets quietly dropped).

---

## Journey 0 — Arrival (a stranger's first five minutes)

- [ ] `/play` loads with no fatal error; the sign-up / founding door is on screen.
- [ ] Create account → the flow answers (no dead button, no silent spinner).
- [ ] Language step: pick a language → **Continue** advances (and the step can be exited).
- [ ] Re-enter (the same button, fields retained) → **The Sealed System** opens.
- [ ] Star map: the six worlds orbit; drag spins the system; tap a world → its
      inspect sheet opens with an action (Claim/Found/Enter).
- [ ] Claim a colony → founding or the game shell; a world that is down refuses
      OUT LOUD ("offline — try another"), never silently.
- [ ] Founding (when shown): pick a race → the choice registers visibly; name the
      Cradle → **Found The Cradle** is enabled and lands you IN the game.

## Journey 1 — Home & navigation

- [ ] Every nav/ribbon button press visibly changes the view (no press that lands nowhere).
- [ ] Settings opens from its control; Settings closes (exit ≥44px) back to where you were.
- [ ] No surface in this journey traps the player: every panel has an exit (Exit Law, below).

## Journey 2 — The Globe (the workstation; every tappable, graded)

- [ ] World → the globe renders (canvas up, altitude readout present).
- [ ] **Layer/legend toggles:** each one press → visible state change on the globe.
- [ ] **Altitude/Ground switch:** press → the view actually changes level.
- [ ] **Zoom:** pinch/wheel → the view scale changes (and the frame stays responsive).
- [ ] **Globe spin/pan:** drag → the world moves under the finger.
- [ ] **Search:** type a site name → a result appears; press it → that site's detail opens.
- [ ] **Site tap:** tapping a site on the globe opens ITS sheet (name, strength, reverb).
- [ ] **Colony entry:** tapping your colony enters the Cradle scene.
- [ ] **Arena entry:** the arena site's **ENTER ARENA** opens the Arena panel.
- [ ] Sheet exit (✕ ≥44px) closes the sheet, every time.

## Journey 3 — Globe → Exploration (choices must travel)

- [ ] On a site sheet, **Explore** → the Exploration room opens showing **THAT site**
      (name matches the sheet you came from — never a default, never "the other ones").
- [ ] The chosen site stays chosen across re-render, tab switch, and window reopen.
- [ ] Exploration exit → back to the globe (the globe button WORKS — Exit Law).
- [ ] Full round trip: globe → site → Explore → room → exit → globe, unbroken.

## Journey 4 — Exploration itself

- [ ] The site picker is a skinned in-fiction list (name + strength at a glance),
      NOT a bare black-and-white native dropdown.
- [ ] **Durations match the distance table** (`zones.ts RUN_TIMER_BANDS`):
      backyard tier ≈ 10–15 minutes; nothing in the game exceeds the 5-hour cap;
      the hardest/deepest tier tops out at 3–5 hours.
- [ ] Displayed durations everywhere agree with the table that actually runs.
- [ ] Launch/loadout started from the room is for the site the room shows.

## Journey 5 — Battle (the gauntlet lines; deep proof lives in `site/gauntlet/`)

- [ ] A battle can be started (arena practice / live front) and the scene opens.
- [ ] **Mode badge:** AUTO vs MANUAL is unmistakably visible at all times in the battle view.
- [ ] **All five vectors enter by every door:** advance, flank, rear — and the rear
      FLANK order drops the squad **behind enemy lines** at the ordered point
      (not the friendly rear).
- [ ] **Allegiance:** rear/flank-entered units engage the ENEMY only — zero
      friendly-damage events from them, measured in the sim, not eyeballed.
- [ ] **Reserves:** tap-squad-tap-map releases them when the commander says.
- [ ] **Tap-and-move:** tap own squad → tap open ground → the squad moves
      (coexists with: tap enemy troop → focus; tap own squad → select/quick pick).
- [ ] **Map view pans/scrolls** at phone size; a squad can be centred/located from it.
- [ ] **Quick pick:** opens on selection; **Cover…** is present with its supplier picker;
      the quick pick DISMISSES (exit ≥44px, Exit Law).
- [ ] **Cross-window carry:** an order/selection made in Battle Controls is the same
      one the Squads window, the scene, and the tray act on.
- [ ] **Commitment honesty:** a genuinely committed squad's refused order is refused
      OUT LOUD with the reason — never silent non-execution.
- [ ] **Fallback is always allowed:** an engaged squad can always be ordered to
      fall back toward its own lines; no battle state exists where every verb
      silently fails (flinch + commitment + range must never brick a force).
- [ ] **Exit anytime:** exit mid-battle → battle keeps resolving on AUTO; re-enter →
      windows return showing CURRENT state.
- [ ] **Windows are pinned to their battle** (keyed by battle id): jump battle →
      battle, each shows its own Controls / Enemy Forces / Squads.
- [ ] **Dumped when done:** at conclusion (and on exit) the battle's windows retire;
      only the result sheet stands, and its EXIT (≥44px) returns to the game clean.

## Journey 6 — Supplies, Forge & Store (THE CLICK LAW)

- [ ] Every build/forge/buy press **visibly registers instantly** (pressed state).
- [ ] Every action shows its working while it runs (progress or locked-with-reason).
- [ ] Every spend lands a **receipt in the fiction's verb** — *Forged*, *Built/
      Stocked*, *Loaded* — with the amount and the new total.
- [ ] **No duplicate execution:** hammering a control while its action is in flight
      executes/charges ONCE (press lockout / idempotent actions).
- [ ] Dual-channel: with SFX muted, every answer is fully readable on screen;
      with eyes off-screen, the receipt is audible. Neither channel is the sole carrier.
- [ ] The store has a **door in the world** (Exploration Hall depot storefront),
      readable at phone size — and you can always walk back out (Exit Law).
- [ ] Leaving mid-flow never double-charges and never eats the goods.

## Journey 7 — Settings & identity

- [ ] **Avatar upload exists** in Settings/profile: pick an image → it becomes your
      face everywhere identity shows (header chip, hall, comms bylines).
- [ ] Avatar persists across sessions/reinstalls (rides the player record);
      replace/remove controls live in the same place; race emblem is the default.
- [ ] Non-image / oversized uploads are refused out loud, not silently.
- [ ] Mute toggle governs ALL audio (SFX + voice + music bed); sound on → button
      presses are AUDIBLE over the music (SFX bus above the bed, bed ducks).

## Journey 8 — Tutorial (teach the ruled game)

- [ ] A **Learn** home / tutorial entry point exists and is findable by a new player.
- [ ] Guided first battle opens; each lesson waits for the player's own hands.
- [ ] Every lesson opens with PURPOSE in plain words before mechanics
      ("if it can't be explained, people aren't going to play it").
- [ ] **SKIP/EXIT ≥44px at every moment** — a tutorial you can't leave breaks the Exit Law.
- [ ] Window coach marks exist: first open of a window shows drag / resize /
      opacity / colours once, then never nags again.
- [ ] Completed lessons don't re-nag; any act is replayable from the Learn home.

## The standing laws (checked implicitly by every journey above)

- **THE EXIT LAW** — every screen, panel, report, and overlay has a visible
  working exit ≥44px. No exit = a freeze, whatever the code says.
- **THE CLICK LAW** — a press shows as pressed; an action shows its working;
  a spend shows its receipt; a repeat press never stacks a second execution.
- **EXIT ANYTIME + MANY BATTLES AT ONCE** — leave any battle, it finishes on
  AUTO; other battles and the rest of the game stay fully usable meanwhile.
- **BUILT FOR A WORLD, NOT FOR HANS** — all checks run at phone size on a fresh
  profile; nothing may depend on one person's device, install era, or cache.

---

*Crew notes: reds are reported with the press that failed, what was expected,
and what happened instead — never just "broken." A red that matches an
in-flight fix is marked KNOWN with its owner; a red nobody owns is a NEW FIND
and goes to the top of the report.*
