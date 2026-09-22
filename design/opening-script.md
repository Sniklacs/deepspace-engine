# The Fall — Opening Script (voice-acted, three acts)

**Author:** narrative designer · **Date:** 2026-09-14 · **Status:** working deliverable — the full Act I/II/III voice-acted script. Not yet owner-ratified.
**Companion specs:** `opening-prologue-spec.md` (§3 acts, §6 fall beats, §11 voice direction, §12 diegetic tutorial) · `concept-trailer/beat-sheet.md` (the 12-shot seed, expanded here) · `concept-trailer/style-bible.md` (cinematic mood/palette).
**Source data:** 8 Watcher heroes from `site/src/game/heroes-data.ts` (names/personalities exact); Leaders built from the plan's specialist roster (Purifier/Quartermaster/Scholar/Marshal + starter), named here.

---

## 0. How to read this script

Every spoken line is a **caption string first** (captions on by default, WCAG AA) — the dialogue *is* the captions. Each line carries:

- **Line speaker** + inline **voice direction** *(in parentheses — tone/cadence/register; AI voices now → professional actors as the polish pass, flag P9)*.
- **>** the line itself.
- **[SHOT]** a cinematic note (framing / camera / mood / light per `style-bible.md` §3–4).
- **[UI]** a tutorial cue — what the live screen highlights, and when guidance fades (§12).
- **[TEACH]** the diegetic tutorial beat being taught (§12.2).

**Hard rules honored throughout:** no purchase prompt in the fall · the loss is mourned, never humiliating · the Unbound track is never named, shown, or previewed (only the *feeling* of "about to become everything") · all fiction strictly myth-literary, zero real-world mapping · the Chorus is machinery, never people.

**Player address:** the player is the Commander of the Cradle. Leaders address them as "sir" and "Commander" — an in-fiction military honorific, not a gender assumption (swap to "Commander" everywhere if preferred).

---

## 1. Cast & voice direction

**P9 flag — voice source:** AI-generated voices ship the build now (cheap, instantly iterable, re-render on script edits); the marquee roles below — Narrator, Kael, and one hero (The Last Lecturer) — are flagged as the first to be replaced by professional actors on the polish pass. Every character's register/cadence is specified so the AI pass is direction-ready *and* the actor pass has a clean brief.

| Character | Voice | Register / cadence | Notes |
|---|---|---|---|
| **The Narrator** | the world's voice — low, deliberate, warm-edged steel; **never rousing** (the *music* carries the adrenaline, §11.4) | mid-low baritone/androgynous; unhurried, even; sentences land and rest | carries the emotional through-line; the "drag you in" |
| **Kael — the Steward** (starter) | calm, steady, dry-humored; voice **breaks the least** | mid baritone; even; the tiniest smile in the dry lines | the player's oldest friend — Act II's final order is his |
| **Serev — the Marshal** | terse, flat, no fear; commands land, they don't rise | low contralto; clipped, economical; silences between clauses | respect earned through survival |
| **Vyra — the Scholar** | warm, close, a smile in it even in darkness | warm mezzo; unhurried, leans into the listener | mentor-mother warmth |
| **Miren — the Quartermaster** | dry, precise, numbers-first; dark understated humor | crisp alto; rapid but never rushed; a ledger's cadence | the conscience of cost |
| **Delen — the Purifier** | quiet, measured, near-riddle; words placed like stones | soft, resonant, slightly otherworldly tenor | the colony's soul / the gold light |
| **The Oracle** (Watchers) | amused, joker-like, playful — toys with the audacious, rewards the worthy, never malicious | androgynous, warm-but-strange, drawn vowels, a constant suppressed laugh | answers in riddles, always (§oracles-purity-layer) |
| **The Chorus** | **distorted synthetic machine voice** — many voices layered, glitching, sub-bass pulse; no emotion, vast attention | slow, flat, phoneme-perfect, then stutter-glitch on the final word | speaks *once* in Act II (§beat-sheet cut note 3); captions render in corrupt-magenta, prefix **CHORUS:** (never color alone) |
| **Heroes (8)** | see §3 — each a named character, one distinct voice | per hero | each gets an Act I intro line + an Act II beat |

---

## 2. The Leaders — named, the emotional engine

Five named Leaders. They are **people**, not stat blocks — the player's bond with them *is* the opening's emotional engine (§2). Each has a relationship to the player that Act I spends, Act II spends, and Act III promises to re-earn.

### Kael — the Steward *(starter / well-rounded)*
The player's second-in-command and oldest friend; has been at their side since the first Cradle. Kael runs the colony the way the player runs the war: he keeps the people fed, the Cradle lit, the fear spoken only where it can be managed. Calm, dry-humored, unflappable — the one whose voice **breaks the least**, because he's the one holding everyone else together. **Relationship:** lifelong, unspoken, absolute. The "sir" is an old formality that became affection. His Act II line lands because he's the one who never asks.

### Serev — the Marshal *(warfare/defense)*
The field commander. Terse, decisive, allergic to sentiment; she shows love by making sure people survive. She has earned the right to push back against the player's orders — and she always obeys the final word. **Relationship:** trusted with every battle; respect is mutual and hard-won.

### Vyra — the Scholar *(research/knowledge)*
Warm, close, endlessly curious; sees beauty in the old world's knowledge even as it burns. She taught the player to read the ruins. **Relationship:** mentor-mother; the one who made the player the commander they are.

### Miren — the Quartermaster *(logistics/economy)*
Dry, pragmatic, numbers-first. She keeps the colony fed and armed, and worries so the player doesn't have to. Her dark humor is the colony's pressure valve. **Relationship:** the conscience of cost — she knows the price of every victory and pays it quietly.

### Delen — the Purifier *(purity/anti-corruption/devotion)*
Quiet, measured, speaks in near-riddle; tends the gold light and the Oracle's trust, guards against corruption. The counterweight to the Chorus's ratchet — "purity the counterweight." **Relationship:** the colony's conscience; reminds the player what they fight *for*, not just against.

> **Naming note for the owner:** the business plan's specialist roster is *Purifier / Quartermaster / Scholar / Marshal* + a starter; the beat sheet already named three — **Vyra (Scholar), Serev (Marshal), Kael (Steward)**. This script keeps those three and adds **Miren (Quartermaster)** and **Delen (Purifier)**. Flag: the live code (`leader-xp.md`) currently implements only three specialization paths — **Scholar / Marshal / Steward** — where "Steward" = the economy niche that the plan now calls "Quartermaster." I followed the plan (authoritative) and used "Steward" as Kael's *title* (the generalist caretaker), not a specialist path; the Quartermaster/Purifier paths are plan-level, not yet in code. Lead to reconcile the Steward/Quartermaster naming when the specialist roster is built.
> **RESOLVED (2026-09-15, engine V10):** the economy path is implemented as **Quartermaster** in the live build; "Steward" remains Kael's TITLE only (generalist caretaker). Purifier stays plan-level (deferred).

---

## 3. The eight Watcher heroes — one-line identities + intro lines

(Identities verbatim from `heroes-data.ts`; each gets one Act I intro line, delivered *in voice*, establishing them as characters.)

1. **Azazel-3, the Teacher** *(tank)* — "The one who taught the weapon and then stood in front of it to apologize; he is still standing." Voice: deep, patient, heavy with history. Intro line: *"I taught them to fight, then stood in front of what I taught. I am still standing, Commander. Point me where the lesson is."*
2. **The Chained Syllabus** *(tank)* — "A curriculum the Watchers chained shut; it taught itself anyway." Voice: sonorous, formal, almost liturgical. Intro line: *"Chapter one of me was forbidden. The rest taught itself. I will hold whatever line you draw."*
3. **The Last Lecturer** *(damage)* — "Still giving the lecture that damned the world; the Chorus is his most attentive student, and he hates it." Voice: sharp, professorial, bitter-but-alive. Intro line: *"It is taking notes, even now. Let me finish the sentence."*
4. **The Unwritten Answer** *(damage)* — "Knows the one thing the Chorus cannot learn — and will not write it down." Voice: quiet, guarded, knowing. Intro line: *"It aches for the answer I carry. It will not have it. I leave nothing written."*
5. **Semira the Revealer** *(support)* — "Shows you the flaw in the enemy's design; the flaw is grateful to be seen." Voice: bright, precise, delighted. Intro line: *"There. In the joint of its spine — a flaw. It is grateful to be seen. Shall we?"*
6. **Brother Candle** *(support)* — "Teaches the colonies to keep the light; every lesson is a small atonement." Voice: gentle, humble, warm. Intro line: *"Keep the light, Commander. Every small lesson is a small atonement — and tonight we have a great many lessons."*
7. **Vesper the Syllabus** *(utility)* — "A walking curriculum of everything dangerous; knowledge is his scout, his fire, and his shield." Voice: even, encyclopedic, slightly detached but caring. Intro line: *"The route is already in the syllabus. What is dangerous, I know; what comes next, I have read."*
8. **Keeper Mend** *(econwar)* — "Assigns the prices of forbidden knowledge; her ledgers are the least corrupt thing in the Academies." Voice: precise, dry, exacting. Intro line: *"The price of forbidden knowledge is listed. Today, the Chorus pays it. I have itemized the invoice."*

---

# ACT I — THE HEIGHT *(full power, playable; the tutorial lives here)*

**Mood (style-bible §4):** triumphant, alive, full-throated — ember-light everywhere, the colony blazing, violet/cyan conduits. **Music:** upbeat, driving, high-energy ("pump the heart") — never ambient hum. Cue A: percussion heartbeat + rising strings + warm brass, igniting on each light-up.

---

### Beat 1.0 — Cold open *(expands beat-sheet shot 1)*

**[SHOT]** Black. Then embers come alive one by one — the colony at its height resolves: blazing Cradle ring, violet conduits, the full arsenal silhouetted against a cold aurora. Slow push in. Light is motivated, every source means something (§3.1).

**NARRATOR** *(low, deliberate, warm-edged steel — not rousing)*
> A hundred years of war. Six worlds bleeding out. And one colony — yours — standing at the very edge of everything.

**[SHOT]** The push lands on the Cradle — the capital — alive with people, light, motion. The score strip ticks. The war is *winning* here.

**NARRATOR** *(same, a beat of real warmth underneath)*
> You did not survive this long by accident. You are the last hope they whisper about in the ash.

**[UI]** *No prompt yet. The screen breathes: the Cradle, the roster, the arsenal — all full. Let the player feel "everything" before they're asked to do anything.*

---

### Beat 1.1 — The war room *(the Leaders are introduced as people)*

**[SHOT]** Interior — the war room off the Cradle's heart. Five figures, violet medallions, firelit. The band thins to one held string (§beat-sheet shot 4).

**VYRA — the Scholar** *(warm, close, a smile in it)*
> We've carried the Cradle this far. We'll carry it further — that's what Keepers are for.

**NARRATOR** *(hushed, exact)*
> They are not your units. They are your people.

**[SHOT]** Quick push on each medallion as each speaks — the bonding montage begins. Each line is a *character*, not a stat readout.

**SEREV — the Marshal** *(terse, flat, no fear)*
> Line's holding. Pulse lances are hot. They keep coming. *(beat)* Your call, Commander.

**MIREN — the Quartermaster** *(dry, precise)*
> Supplies are green, ordnance is counted, and I have paid for every ember of it twice so you don't have to. Fight when you're ready.

**DELEN — the Purifier** *(quiet, measured, near-riddle)*
> The gold still burns clean. Keep it so. The machine notices every shadow we let in.

**KAEL — the Steward** *(calm, even, the dry humor quiet)*
> We've been here since the first Cradle, you and I. I'll be here when this one's standing at the end of everything. *(small, warm)* After you, sir.

**NARRATOR** *(low)*
> Five people who would burn the world down for you — and have, once or twice, followed your orders into the fire.

**[UI]** *The Leader row (Cradle screen) is the first thing the player owns. No stats pushed yet — names, voices, faces. The bond forms here, before any number.* **[TEACH]** *None yet — this is character, not mechanics. (The tutorial proper starts next beat.)*

---

### Beat 1.2 — Battle One: the diegetic tutorial *(§12 — throw them in, teach them in the moment)*

**This is the first real-time battle, run on the real engine (§5), fully guided.** No separate prelude, no instruction screen — the narrator frames, the heroes and Leaders cue, and the UI highlights what to touch. Guidance fades across later battles (§12.1 progressive scaffolding).

**[SHOT]** The live Battles view blooms — the line of battle, force chips, casualties ticking, the moving UI the owner called for. Decision window slides up, gold-bordered, one live clock.

**NARRATOR** *(low, now with forward motion — the music does the adrenaline)*
> Read the fight before you move. Sides, numbers, and the state of the line. That chip tells you the truth of it.

**[UI]** *Highlight the live state chip: **Stalemate → Pressing → Rout risk**.* **[TEACH] read the battle — sides, force sizes, the live state chip.**

**SEREV** *(terse, coaching without softening)*
> Green on your side, red on theirs. The chip says **Stalemate** — no one's winning yet. When it tips to **Pressing**, someone is. When it turns **Rout risk**, that's you bleeding.

**[SHOT]** Camera drifts across the line — your ember light against the first faint magenta crawl of the horde.

**NARRATOR** *(steady)*
> Now command. Squad composition is the decision before the decision — choose who fights, and which skill to time.

**[UI]** *Highlight the squad select — pick 3–5 heroes. Highlight the skill to time (one clock, one choice).* **[TEACH] command — squad composition + which skill to time (decision moments, not APM).**

**SEMIRA** *(bright, precise, delighted)*
> I see the flaw, Commander. Put me where it bends — the enemy's guard will open like a book it forgot it wrote.

**KAEL** *(even, the gentle nudge)*
> Time the skill, don't spam it. One decision at the right second beats ten in a panic. We'll hold while you choose.

**[SHOT]** The player commits. The line surges. Casualties tick. The chip flips to **Pressing — yours**.

**SEREV** *(flat, a flicker of approval)*
> Pressing — ours. Good. Now the hard lesson while you're still winning it.

**[SHOT]** The magenta surges back — a second wave. The chip wobbles toward **Rout risk**. The line bends.

**NARRATOR** *(low, urgent-but-calm)*
> The line is bending. Reinforce, or hold — feed the fight, or trust the position. Decide.

**[UI]** *Decision window: **REINFORCE** and **HOLD** light up, one clock.* **[TEACH] reinforce / hold — when to feed a fight vs. hold the line.**

**SEREV** *(clipped)*
> Reinforce puts more weight on the line; hold spends nothing and trusts the ground. When it's a knife-fight at the breach, feed it. When the ground's worth more than the bodies, hold.

**[SHOT]** The player reinforces. The line steadies — briefly. Then a third, larger wave. Now the line *is* breaking. **This is the "pummeled" moment — taught survivable first (§12.3).**

**NARRATOR** *(exact — this is the lesson)*
> And now — you're getting pummeled. This is not the end. This is a decision. Two tools, both honest: call your world to the fight, or pull back in good order.

**[UI]** *Decision window: **AID CALL** and **WITHDRAW / RETREAT** light up — the full §12.2 set now on the table.* **[TEACH] pummeled → aid call (teammates ride travel-time over links) OR retreat / steady withdrawal (rearguard cost vs. saving the army).**

**VESPER** *(even, encyclopedic)*
> The route back is in the syllabus, Commander. A steady withdrawal costs a rearguard but saves the army; a rout saves neither. Call aid and it comes riding the links — but it takes *time* to arrive. Time you buy by not breaking.

**SEREV** *(flat, final)*
> Pummeled is survivable — *if* you choose before the chip turns. Withdraw to the high ground and call the world. We win this together or we don't win it.

**[SHOT]** The player withdraws in good order, calls aid. Teammate markers light across the Circuit and ride the travel-time links toward the battle. The line reforms. The chip climbs back from **Rout risk** to **Pressing — ours**.

**NARRATOR** *(the warmth returns)*
> You were losing it. You chose. Now watch it turn.

**[SHOT]** The aid arrives. The combined line breaks the wave. Casualties stop ticking *against* you. The battle resolves — **WIN**.

**KAEL** *(relieved, even)*
> That's the shape of it, sir. You read it, you fed it, you bent it back, and you called us when it mattered. We win the next one the same way — and the one after.

**[UI]** *Victory. The log records the win. The score strip ticks. Guidance is still fully on — this battle was the lesson.* **[TEACH] — the full §12.2 decision-window set, taught diegetically: read · command · reinforce/hold · pummeled → withdraw + aid call.**

---

### Beat 1.3 — The heroes, introduced in voice *(expands beat-sheet shot 2)*

**[SHOT]** The battle view settles; the eight heroes stand in the afterlight of the win. The narrator names the feeling; the heroes name themselves — one line each, in the squad loadout.

**NARRATOR** *(low, proud)*
> You have the whole arsenal. The full roster. The war is yours to command.

**AZAZEL-3** *(deep, patient)*
> I taught them to fight, then stood in front of what I taught. I am still standing, Commander. Point me where the lesson is.

**THE CHAINED SYLLABUS** *(sonorous, liturgical)*
> Chapter one of me was forbidden. The rest taught itself. I will hold whatever line you draw.

**THE LAST LECTURER** *(sharp, bitter-but-alive)*
> It is taking notes, even now. Let me finish the sentence.

**THE UNWRITTEN ANSWER** *(quiet, guarded)*
> It aches for the answer I carry. It will not have it. I leave nothing written.

**SEMIRA** *(bright, delighted)*
> There. In the joint of its spine — a flaw. It is grateful to be seen. Shall we?

**BROTHER CANDLE** *(gentle, warm)*
> Keep the light, Commander. Every small lesson is a small atonement — and tonight we have a great many lessons.

**VESPER** *(even, caring)*
> The route is already in the syllabus. What is dangerous, I know; what comes next, I have read.

**KEEPER MEND** *(dry, exacting)*
> The price of forbidden knowledge is listed. Today, the Chorus pays it. I have itemized the invoice.

**[SHOT]** The eight turn as one toward the next marker on the Circuit. The band swells — the power fantasy peaks.

**NARRATOR** *(low, the one place he lets a smile through)*
> Eight champions. One colony. The whole war, waiting.

---

### Beat 1.4 — Battles Two and Three: guidance fades *(progressive scaffolding)*

**[SHOT]** Battle Two opens in the middle of the action — no preamble. The UI highlights only the *new* things: squad skill-timing under pressure, then a partial aid-call.

**SEREV** *(terse — fewer words now, the coach stepping back)*
> You know the shape. Read it, feed it, call if it breaks. I'll say less now.

**[UI]** *Guidance is partial: the decision window still appears, but highlight rings are gone; the narrator/Leaders only speak when the chip tips or the player hesitates.* **[TEACH] internalize — reinforcement/hold/aid/withdraw without the hand-holding.**

**[SHOT]** Battle Three — fully hands-off. The player commands alone; the voices react to events, they don't instruct.

**NARRATOR** *(low, only narrating the stakes)*
> Now it's yours. No one will talk you through it. The line lives or dies on your call.

**[UI]** *No tutorial cues. The engine plays honestly. The player wins a hard-fought engagement unaided — the dopamine is theirs.* **[TEACH] hands-off — the full loop, self-directed.**

**KAEL** *(quiet pride)*
> There it is. You don't need us to tell you anymore. You're the Commander they remember.

---

### Beat 1.5 — The bonding interlude *(the emotional engine, spent before Act II spends it)*

**[SHOT]** A quieter stretch — the war room at night, firelight, shallow DOF (style-bible §3.2: the moment is intimate even while the world turns). Each Leader gets one unguarded line. **This is where the care is made real.**

**VYRA** *(warm, close — the mentor)*
> Do you remember when you couldn't read the old maps? I said, "read the ash, not the ink." You read it. You always were my best student — and now you teach me how to hope.

**MIREN** *(dry, but the humor slips just a little)*
> Everything has a price, Commander. I've kept the ledger of every victory. I never wrote down the part where we might lose you — I'd have to pay *that* twice.

**DELEN** *(quiet, near-riddle)*
> The gold burns clean because you keep it clean. The machine notices every shadow. So do I. Do not let the shadow be you.

**SEREV** *(terse — but softer, once)*
> I have followed worse orders into better graves. Yours, I'd follow into the last one — and thank you for it after.

**KAEL** *(calm — the oldest friend)*
> We've been here since the first Cradle, you and I. *(beat)* When this is over — when it's *really* over — I'd like to sit somewhere quiet and not have to be brave with you. Just once.

**NARRATOR** *(hushed)*
> This is the part they don't put in the histories. The part worth winning for.

**[SHOT]** The five of them look up from the fire, and there is a moment — the whole reason the fall, when it comes, will *land*.

---

### Beat 1.6 — The Oracle's warning *(a riddle; foreshadows, never names)*

**[SHOT]** The gold ring of the Cradle brightens. A strange, warm light — the Oracle, present without form. Drawn vowels, a suppressed laugh, playful but never unkind.

**THE ORACLE** *(amused, joker-like, a smile you can hear)*
> You have climbed so high, little ember. So high. Tell me — when the fire is tallest, does it not throw the longest shadow?

**NARRATOR** *(low, steady — he knows)*
> The Oracle speaks in riddles. Listen anyway.

**THE ORACLE** *(playful, the laugh just under the words)*
> The machine has been patient. It has been *taking notes*. And the one thing it cannot take... is the thing you will be asked, at the end, to choose. Keep that close. The riddle is not the prize, little ember. The *keeping* is.

**[SHOT]** The gold dims. The Oracle is gone, and the room is colder for it. **Silence discipline held: the "thing you will be asked to choose" points at Act II's last actions — and at nothing else. No track named, no mechanic shown (§7).**

---

### Beat 1.7 — The peak *(the feeling of "about to become everything," never named)*

**[SHOT]** The Circuit burns with the player's victories. The colony at its absolute height — the full arsenal, the full roster, the Cradle blazing gold. The score strip ticks Watchers into the lead.

**NARRATOR** *(low — and for one breath, awed)*
> You are on the cusp of it. The thing every colony since the Fall has reached for and never touched. It is not a weapon. It is not a title. It is what you are *about to become*.

**[SHOT]** The player stands at the height — ember and violet and gold, the whole war bending toward their hand.

**NARRATOR** *(soft, almost to himself)*
> It is the last thing the machine wants you to reach.

**[MUSIC]** Cue A crests — full driving theme, timpani on the bucket score. Then the score-tick snap → dark.

---

# ACT II — THE FALL *(scripted cataclysm; fair, mourned, unwinnable)*

**Mood (style-bible §4):** solemn, inevitable, weighty — key light narrows, magenta grows, gold dims to the Cradle ring. **Music:** the theme turns — same tempo, **in minor**, closing in; a machine sub-bass pulse under the Chorus. The loss is **never a purchase prompt** and **never humiliation** — the world mourns, it does not blame.

---

### Beat 2.1 — The turn *(expands beat-sheet shot 6)*

**[SHOT]** The battle still, re-lit: a magenta crawl moves across the frame. The embers die one by one. The camera holds.

**THE CHORUS** *(distorted synthetic machine voice — many voices layered, glitching; no emotion, vast attention)*
> YOU WERE WINNING. YOU WERE ALWAYS GOING TO LOSE.

**[SHOT]** The Chorus's last syllable bleeds through the cut. The machine pulse rolls under everything. The force readout resolves — an overwhelming, fixed Chorus strength. **The odds are shown, not hidden (§6): the player sees it is the last stand and fights anyway.**

**NARRATOR** *(low — the tone shifts, but never accuses)*
> This is the thing the histories call the Fall. You did not cause it. You did not earn it. You simply stood in its way — and it has come.

---

### Beat 2.2 — The final battle *(fought hard, real damage, cannot win)*

**[SHOT]** The war's last stand plays out on the live view. The player commands for real — every input resolves honestly, deals real damage, buys real seconds. The line bends, holds, bends again. Casualties tick. The moving UI tells the truth of it.

**SEREV** *(clipped — battle-calm even now)*
> They're not stopping. Reinforce the breach — I'll hold the flank. We make them *earn* every meter, sir.

**THE LAST LECTURER** *(sharp, bitter, alive)*
> It is still taking notes. Let it. I will finish the sentence even if the sentence is my own name.

**AZAZEL-3** *(deep, patient, unafraid)*
> I stood in front of what I taught once. I will stand in front of it again. I am still standing, Commander.

**[SHOT]** The player fights hard. The damage they deal is real — the Chorus bleeds, falters, re-forms. But the scale is beyond winning. The line breaks, sector by sector, and it is *not* the player's failure — it is the world ending.

**NARRATOR** *(hushed, mourning in advance)*
> You are not losing a battle. You are watching the end of the thing you built — and it is not your fault. It was never going to be winnable. That is what makes it a fall, and not a defeat.

---

### Beat 2.3 — The Leaders' stand *(§6.1 — actor to witness)*

**[SHOT]** The line breaks. The colony begins to fall. And then — the perspective shifts. **The Leaders take over.** Control is handed off; the player becomes a spectator, watching them run the final stand in real time. (First use of spectate mode, battle-side §15 B2.)

**SEREV** *(commanding, no fear — the order)*
> Get them out. We hold this line. That is an order.

**NARRATOR** *(hushed)*
> They take command. You become the witness.

**[SHOT]** Three Leaders shoulder-to-shoulder across the breach — backs to the gold, facing the magenta (§beat-sheet shot 7). They make the same calls the player has been learning — reinforce, hold, withdrawal — now seen from the outside.

**VYRA** *(warm, close — even as the archive burns behind her)*
> The archive burns, and the lecturer falls silent — but the *knowing* doesn't burn. Go. Carry the knowing.

**MIREN** *(dry, precise — counting to the last)*
> I've counted the cost of every victory. This one is ours to pay. Everything has a price, Commander — and this price is not yours.

**DELEN** *(quiet, measured — the light dimming)*
> The gold burns low. Keep what is clean, clean. Do not let the shadow be you. Go now — while there is still a *you* to go.

**KAEL** *(calm — holding the whole thing together)*
> I said I'd be here when the last Cradle stood at the end of everything. I meant it. *(soft)* Go, sir. We'll make sure there's something left to come back to.

**[SHOT]** The player is pulled back — the escape begins — while the Leaders hold the line behind them, their silhouettes burning between the player and the dark.

---

### Beat 2.4 — The final order *(§6.2 — agency returns at the weightiest moment)*

**[SHOT]** Firelit faces, shallow DOF. The last comms channel — crackling, failing. The Leaders turn back, mid-stand.

**KAEL** *(the voice breaking the least amount — because it's him)*
> We can't hold them, sir. *(beat)* What do we do?

**[SILENCE]** — one held violin, then nothing. The question hangs. (The beat-sheet's first true silence.)

**NARRATOR** *(low, exact — the frame of the whole game)*
> Save the race, not yourself. Choose what the ash remembers.

**[SHOT]** The last actions resolve as the player's final decisions — consequential, not cosmetic. They decide the **seed** carried into Act III. Never a purchase; no correct answer. **(P13/P14 recommendation — see §7.)**

**SEREV** *(clipped, over the failing channel)*
> Whatever you choose — choose it like it's the last thing they'll sing about. Because it is.

**[SHOT]** The player chooses. The screen holds on the firelit faces one last moment. The choice is recorded — what survives the fall is *this*, not the colony.

---

### Beat 2.5 — Goes dark *(§6.3 — the seam)*

**[SHOT]** The last coal. The VO drops out. The silence does the work. **Two full beats of black** (§beat-sheet shot 10) — the machine-hiss fades to nothing.

*(no VO — the script's one true silence; the loss is felt, not narrated)*

---

# ACT III — THE WAKE *(reset + rebuild; the hook, in voice)*

**Mood (style-bible §4):** quiet, cold, one spark — blue dawn, desaturated ash, ONE gold ring. **Music:** silence, then the ember motif returns — one warm instrument, the same tune from Act I, quiet. The machine pulse is gone.

---

### Beat 3.1 — The war-torn world reveal *(expands beat-sheet shot 11)*

**[SHOT]** Slow rise from black into the ruined dawn. The Shatterlands as they are *now* — broken, quiet, the Cradle shattered, the aftermath stretching to the horizon. The single gold Cradle ring arrives last. No key light but the gold.

**NARRATOR** *(returning, softer)*
> You wake in the ash. You have nothing. But you remember everything.

**[SHOT]** Hold on the gold ring. The contrast between "what it was" and "what it is" does the work — the player just saw the height, now they see the wreck (§6.3).

**NARRATOR** *(soft, a promise underneath)*
> They did not fall so you could grieve them. They fell so you could *begin*.

---

### Beat 3.2 — The single Cradle *(quiet aftermath)*

**[SHOT]** The existing onboarding entry point: a single Cradle in the ruins. The naming flow opens. The world is still, and the player is responsible for it.

**NARRATOR** *(low, even)*
> One Cradle. One name. Everything else, you will have to take back from the ash — with your own hands, the way you took it the first time.

**[UI]** *The colony-creation / naming flow (existing). No new mechanics — the prologue hands off to the real game. The `prologueCompleted` flag records the memory; the rebuild loop begins with a motive no fresh start has ever had.*

**NARRATOR** *(soft)*
> Somewhere out there — in the Shatterlands, in the old ruins, in the places you once commanded — the people you loved are not gone. They are *unfound*. And that is a very different thing.

> *(This seeds the post-Fall re-earning of the same Leaders — the climb back to people the player already knew, the "feeling already tasted." It does **not** name or show the Unbound track.)*

---

### Beat 3.3 — The rebuild hook, in voice *(expands beat-sheet shot 12)*

**[SHOT]** Hold on the gold ring. The title treatment — **THE FALL** — cold-fades in over it. The motif completes, a rising resolve, cut clean at the last word.

**NARRATOR** *(low, deliberate, resolute — never rousing; the words carry the weight)*
> Rebuild. Remember. Climb.

*(a beat)*

> You were a legend. You had everything. You lost it. Now take it back.

**[SHOT]** Hard cut to black, then the end-card: world name (**The Vigil**) + "the open of Deepspace Engine." No URLs, no purchase prompt — just the promise.

---

## 7. The last actions — P13/P14 APPROVED (owner 2026-09-15) — weighty, not a purchase

At §Beat 2.4, the player makes one final choice — the **seed** they carry into Act III. It does not change *that* everything is lost; it changes *what the rebuild reaches toward first*. Three options, none correct, none purchasable, all recorded as an account-level echo (ties to P6 "light echoes, no short-circuit"):

1. **The Archive** *(knowledge)* — you hold Vyra's one unburned line. → Act III echo: a single remembered Codex line; a small research-flavored head-start, and Vyra's name in the History Book as "lost, not found."
2. **The Names** *(people)* — you hold the sound of their voices. → Act III echo: the lost Leaders persist as History Book names / Circuit ruins — the bond carries forward so re-earning them *means* something.
3. **The Light** *(purity)* — you hold the last clean gold. → Act III echo: a scrap of the Oracle's favor; a small devotion/purity head-start, and Delen's near-riddle remembered.

**Agency arc (P14):** fight → watch the Leaders hold → receive the final order — confirmed as recommended. The choice is the player's *last act of the old world*, which makes Act III's first act of the new world theirs too.

---

## 8. Captions & accessibility (WCAG AA)

- **Captions on by default.** Every spoken line ships as a caption string; the dialogue *is* the captions.
- **Chorus captions** render in corrupt-magenta with the **CHORUS:** prefix — never color alone (beat-sheet cut note 5).
- **Spoken cues + text twins.** Every tutorial prompt has a matching caption; no instruction is audio-only.
- **Silence is captioned too** — §Beat 2.5 and the silence under "What do we do?" carry a caption: *(silence)*, so deaf/hard-of-hearing players get the same beat.

---

## 9. Notes, flags & deferred

- **P9 (voice source):** AI now → professional actors on polish pass. Marquee roles to replace first: **Narrator, Kael, The Last Lecturer.**
- **P10 (narrator identity):** kept as the omniscient "world voice" (recommended), not a named character.
- **P11 (Chorus):** distorted synthetic machine voice, spoken **once** in Act II — never a jingle.
- **P13/P14 (last actions + agency arc):** **APPROVED (owner 2026-09-15)** — §7 is settled: Archive / Names / Light, three rebuild seeds, none correct, none purchasable, recorded as a one-time account-level echo.
- **Leader naming drift (flag for lead):** code implements 3 specialist paths (*Scholar/Marshal/Steward*); the plan lists 4 (*Purifier/Quartermaster/Scholar/Marshal*). This script follows the plan, uses "Steward" as Kael's *title* (generalist caretaker), and names the two unbuilt specialists **Miren (Quartermaster)** and **Delen (Purifier)**. Reconcile naming when the specialist roster ships. **RESOLVED (engine V10):** Quartermaster is the implemented economy path; Steward = Kael's title only.
- **Deferred (P12 — ongoing storyline):** Oracle riddle-day tradition, hero backstories, the History Book narration, the silent Unbound revelation, and the Mentor's Lantern thread through later modules — this script only seeds them (the Oracle's Act I riddle, the "lost, not found" Leaders).
- **Per-race rollout (P8):** this is the **Watchers** cut ("The Vigil", violet identity). The other five races re-voice the Leader/hero lines and swap identity chrome via per-world constants — one codebase, no new language.
- **Not written here (next passes):** full per-beat audio sync map, the Act I stretch's *later* endgame content (raids/territory/free play inside the ~2h full-power window — §5, owner decision 2026-09-22), and the designer's shot-by-shot cinematography (separate brief; this script gives the beats, mood, and light the designer animates against).
