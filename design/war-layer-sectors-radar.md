# The War Layer — Sectors, Radar, the Alarm & the Incursion

**Author:** designer delegation · **Date:** 2026-09-26 · **Status:** DESIGN DOC — **design-ahead, NOT ratified, NOT buildable yet.**
**Source of truth for the owner's words:** `/home/team/shared/war-layer-owner-input.md` (his five verbatim messages, 2026-09-26) — quoted below, never paraphrased in place of a quote.
**Ground truth read for this doc:** `design/battle-side-rvr-spec.md` §12–§17 · `design/chorus-ratchet.md` · `design/colony-supply-lines.md` (shared tree) · `design/gear-logistics.md` · `design/opening-script.md` · `design/ui-benchmark-notes.md` · `site/src/game/war/war-types.ts` · `site/src/game/map.ts` · `site/src/game/voice/voice-direction.ts` · `site/src/game/nav-slots.ts` · `site/src/game/i18n/langs/en.ts`.

**The one thing this document must not do:** imply any of it is in beta. **None of it is.** Wars, sectors, planetary radar, forward bases, the alarm, notifications — all of it is **design-only** until the battle side exists (business plan: war ships after the beta core; the owner's gate for testers is still **translator + chat**). §10 lists what is verified-missing, with the check for each claim.

---

## §0 · How to read this document

- **Quoted owner text is in block quotes and marked with the message number (M1–M5).** Nothing else in this document is his.
- **Our reading is labelled "Our reading".** The two are never blended. If a sentence could be mistaken for his, it is marked.
- **Every team addition is marked `[ours]`** — an addition we propose, his to reject without hunting. Anything unmarked and not in a block quote is either his direction restated or a verified fact about code.
- **Every duration that the owner did not give is labelled `PROPOSAL`.** His one number (5–15 minutes) is labelled *his number* everywhere it appears.
- **No Reverb value appears anywhere in this document, deliberately.** §17 of the battle spec defines Reverberation as capability + activity + dents, all earn-only; verified recon (2026-09-26) found the activity term has **no data source** and that captures/purifies are **not recorded**. A number today would be fabricated, so pairing is described as *a match that exists*, never as a figure.
- **Vocabulary:** the map is **THE CIRCUIT** (never "Atlas"). A Circuit space is a **sector** (his word, M1). The **alarm** is the world-wide detection event. An **incursion** is an enemy force in a sector of your world. The **forward base** is his noun; it is the same object as the ratified **FOB** (`§12`, FB1–FB5 ✅), and the voice engine already speaks it as **"forward base"** (`NUMERAL_TABLE`: `FOB → forward base` — never three letters).

---

## §1 · His five messages, and our reading of each

### M1 — the pairing, the sectors, the forward base, the satellites

> **M1:** "And here's a way I think that we should go about our war server okay this might make it more streamlined and more easier to follow okay so we've got two servers matching reverb if we take our circuit and basically those are in every space is like a sector or a quadrant or something like that not a quadrant but you know what I mean no sex sector and I want to go there and raid now my forward base is already there and it is susceptible to rating same time that other server they're trying to get our stuff so they're planning on our world coming over right well in order to even know that they're there we have to have a planetary radar which means we have to have satellites up maybe these satellites are already in orbit they're just not being used or linked they're not linked"

*(speech-to-text noise: "no sex sector" = "no, a sector"; "susceptible to rating" = "susceptible to raiding". Recorded in the source file; the meaning is not in doubt.)*

**Our reading — seven things he is specifying:**

| # | What | Where it already stands |
|---|---|---|
| 1 | **Pairing is Reverb** — two worlds matched on their Reverberation rating. | **Ratified** `§17` V1–V4 (2026-09-12). Zero implementation. The frame, not a new mechanic. |
| 2 | **The Circuit's spaces are SECTORS** (he rejected "quadrant" himself). | The Circuit is built and **read-only** (see §10). "Sector" is a **new noun** — see §8. |
| 3 | **Raiding goes INTO a sector of the other world.** Not an abstract scoreboard — a named place on a map. | Design-only. |
| 4 | **Your forward base is already there, and is itself raidable.** | FOB is ratified `§12` FB1–FB5 (4 stages, 8–10 h to full potential). **"Already there"** and **"itself raidable"** are new. |
| 5 | **Both worlds do it at the same time** — two-way pressure, not turn-based. | Compatible with the ratified war week (`§3`/D1) read as *the scoring frame*, live inside (see §11 C4). |
| 6 | **Awareness is earned** — a planetary radar, which means satellites up. You cannot see incoming presence for free. | Design-only. |
| 7 | **The satellites already exist in orbit — they are just not linked.** | `[ours]` The hardware is pre-war salvage, the same grammar as the Codices: **earn the use of it, never buy it.** |

`[ours]` **Why we like the shape (our claim, not his):** "already in orbit, unlinked" is a G1–G4-safe mechanic by construction — linking is an earn/build action, so awareness cannot be purchased. And his own words mark the war as *symmetric and live*: the same minute your forward base is exposed, theirs is.

### M2 — the alarm, the scout, the jammer

> **M2:** "If they are linked and players enter our server and satellite you text them we should all get a warning buzzing a beeping something the red light bang bang sector so and so as unknown signatures or something in those lines do you want to investigate yes or no investigating means sending a scout that scout depending on what the signature has I have anti-scout jammers but you might be able to pick up enough to know who it is what it is or whatever I don't know"

**Our reading — six things:**

| # | What | Our note |
|---|---|---|
| 8 | **A linked satellite net is what raises the alarm.** The radar is a tripwire, not a passive stat. | `[ours]` No linked net ⇒ **no alarm can fire.** No detector, no event. |
| 9 | **Everyone on the world gets the warning** — loud and physical: buzzing, beeping, red light, "bang bang". | Not a quiet log line. §4 and §6 design it for sight *and* sound. |
| 10 | **The alarm names a PLACE, not a force** — "sector so and so", shown as **unknown signatures** (his label). | His label, pending the five-language text (§8). |
| 11 | **The alarm is a choice**: "do you want to investigate yes or no". Investigating = **sending a scout**. | Not an auto-resolve. §4.3. |
| 12 | **The scout is a contest, not a look-up** — the intruder may carry **anti-scout jammers**; partial intelligence is the normal outcome, not a failure state. | §4.4 designs the tiers; §4.5 bounds what a jammer can hide. |
| 13 | **Intelligence is tiered and earned**: nothing → size band → who it is → exact force. He leaves the detail open ("or whatever I don't know") — **his to approve, ours to spec.** | §4.4. |

### M3 — the scout's report sizes the force, the rally, and the raider's clock

> **M3:** "And depending on the information you get back you'll know how much you want to send for units this is that or if you need to go in as a rally and multiples going together so this brings in rally points or maybe you're rallying from your colony so the other guys meet you at your colony and that rally is 5 to 15 minutes or something like that before it goes there's got to be some travel time in the meanwhile these people that rated or came over from another server they've got so much time to get there get what they're after and get out or get there and set up defenses if they think that they can hold their position under fire and do what they're doing"

**Our reading — seven things:**

| # | What | Our note |
|---|---|---|
| 14 | **The scout's report sizes the response** — intel changes the force you commit, or you rally big. | Intel is not decoration. |
| 15 | **RALLY POINTS** — multiple players go in together as one force. | Ratified adjacent mechanic: **aid calls** `§15` B11 ✅ (`AidCall` exists in code). |
| 16 | **The rally forms AT A COLONY** — yours or a Covenant's. | The muster point is a place on the map, not a menu. |
| 17 | **The rally has a countdown: 5–15 minutes** before it launches. | **His number, and he flagged it as a guess** ("or something like that"). See §5. |
| 18 | **There is real TRAVEL TIME** — the gap while a rally forms is not the whole delay. | §5. The only travel number that exists in code today is `aidTravelDelayMs = 10 min` (a calibration delay; the per-link table is a declared war-Phase-1 item). |
| 19 | **An incursion has a bounded lifetime** — "so much time to get there, get what they're after and get out". | Three outcomes inside the window: **extract · fortify · be broken.** |
| 20 | **Holding a position is a CHOICE under fire, not a default.** | Holding is what turns a raid into a **forward base** — and a forward base is itself raidable (M1) and its field gear seizable (Forge direction, 2026-09-26). |

### M4 — the alarm must reach the player

> **M4:** "And this actions should be added into our notifications so the players get a notification if somebody lands on their world and they can log in"

**This ANSWERS W8** (and the whole offline class, W16): the alarm is not only an in-game banner — an intrusion on your world raises a **notification** so an absent player can **log in and defend**. §7 specs it and states plainly that **no notification infrastructure exists today**.

### M5 — the alarm speaks

> **M5:** "And I want a voice over that's actually staying sector warning sector warning anomaly detected or something in those lines"

**Our reading:** the alarm is **voiced** — a spoken, repeated line, shape **"Sector warning. Sector warning. Anomaly detected."** with the sector named. §6 designs it, including the rule that it speaks the **player's language** while story voices stay English.

### The mandate to build on this

> "you can add in anytime you know build off this so we can actually get a nice flow for our scenes and whatnot."

Everything from §3 onward is that: our proposals, marked, his to reject.

---

## §2 · The scene flow — nine beats, and that flow is the spine

**`[ours]` — this is the team's synthesis (drafted by the lead in the source file, kept here as the spine).** Every screen the war layer needs maps onto **exactly one** of these nine beats (§3). If a screen needs a concept that is not on this list, §3.3 says so out loud instead of smuggling it in.

```
 1 · THE PAIRING      two worlds matched on Reverb (ratified §17)
        │             each world keeps its own Circuit · its spaces are sectors
        ▼
 2 · EYES             pre-war satellites, in orbit, inert, UNLINKED
        │             linking them = the planetary radar = the only way either
        │             world can see the other coming
        ▼
 3 · THE ALARM        a linked net detects an intrusion into a sector
        │             EVERYONE on the world gets it: red, buzz, beep
        │             "SECTOR __ — UNKNOWN SIGNATURES" + the time it was seen
        │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
        │  ── the same event, for an ABSENT player: a NOTIFICATION (M4) ──────
        ▼
 4 · INVESTIGATE?     YES → a scout goes out against possible anti-scout
        │  YES/NO     jammers · intel tiers: nothing → band → who → exact force
        │             the read is what tells you HOW MUCH TO SEND
        ▼
 5 · THE RALLY        commit a force alone, or muster at a colony (yours or a
        │             Covenant's) with a 5–15 minute countdown before launch
        ▼
 6 · TRAVEL           real travel time · the raider is working while you fly
        ▼
 7 · CONTACT          real-time battle, ratified mid-battle decision windows
        │             (§15 B12: reinforce · hold · withdraw · retreat · aid)
        ▼
 8 · RESOLVE          one of three:
        │               EXTRACT  — got what they came for and left
        │               FORTIFY  — hold the position under fire → a FORWARD BASE
        │               BROKEN   — the defenders break them
        ▼
 9 · CONSEQUENCE      reinforcement against a LIVE threat earns World
                      Contribution (Cross Badges · Oracle Influence), one
                      payment per event, spend contributes zero · taken ground
                      is TAKEN, never erased · both worlds' Circuits change
```

**What the flow is for:** it is the scene order the war layer renders — alarm → decision → muster → flight → fight → hold-or-leave → ledger. Nothing in this document invents a tenth beat; §3.3 lists the three surfaces that genuinely sit outside the nine and says why.

**`[ours]` A scene note worth keeping (not a new beat):** a raid into a never-contacted world **is a breach** in the ratified sense (`§2` First Breach: "a squad landing in a contested enemy frontier zone is a breach"), so the first war week's beat 3 → beat 9 sequence *is* the First Oracle Night's opening — the alarm is the sound of the door opening. The ratified rule that the Oracle door is **never missable** therefore binds the alarm: **the alarm must never gate, delay or obscure the Oracle meeting** (§9).

---

## §3 · Screens ↔ beats — every war-layer surface mapped to exactly one beat

### 3.1 The map

| Beat | Surface (real component names where one exists) | Status |
|---|---|---|
| **1 · Pairing** | **Battles tab → World card**: your world's pairing, the opponent, the war-week phase, the published schedule. `BattlesTab.tsx` exists (conditional nav slot `battles`, `nav-slots.ts`). `[ours]` the Reverb comparison is shown as *"matched"* only — **no number** (see §0). | nav slot **exists**, conditional and never shown (`visibleNavIds(atWar)`); content unbuilt |
| **2 · Eyes** | **Circuit → coverage layer** (which sectors your linked net sees) + **Cradle sheet → a satellite row** (link the next one, cost, time). `CircuitPage.tsx` and `CradleSheet.tsx` exist. | Circuit **exists and is read-only**; coverage layer + link row unbuilt |
| **3 · Alarm** | **Ribbon alert chip** (one existing 44 px slot, already lights for Chorus attention ≥ 50 %) → **Alarm sheet**: sector, UNKNOWN SIGNATURES, *seen at*, YES / NO. Plus the **voiced line** (§6) and the **notification** (§7). | ribbon chip **exists** (`Ribbon.tsx`, `ribbon.chorusAlert`); the alarm itself unbuilt |
| **4 · Investigate** | **Scout sheet** (the read: tier reached, band, identity, force estimate, jammed-or-not, travel + return time) → **Scout report row** in the Ledger/Journal. `LedgerButton.tsx`, `JournalButton.tsx` exist. | unbuilt |
| **5 · Rally** | **Rally muster sheet**: the colony it musters at, who has joined, the countdown, the committed force, launch-early. Reuses the ratified aid-call shape (`AidCall`, B11). | unbuilt (the *battle-level* aid call exists in code) |
| **6 · Travel** | **Circuit → marches in flight** (ETA per force, link kind: road vs roadless, per `§13` R1–R4) + a **Marches row** in the same sheet as the rally. | unbuilt; `§13` link model ratified, not coded (`aidTravelDelayMs` is a single calibration delay) |
| **7 · Contact** | **Battles tab → the battle** (list + live detail + the hardened decision panel). Fully specced in `battles-panel-and-narration-spec.md` Part A (5 orders, 44/48 px, window clock). | `BattlesTab.tsx` **exists**; battles are **per-colony**, the world-level view is unbuilt (§10) |
| **8 · Resolve** | **Battle report → outcome** (extract / hold / broken) + **forward-base staging row** (FOB stages, `§12` FB1–FB5 ✅) + **the supply line that feeds it** (`colony-supply-lines.md` §6 Supply lanes sheet). | report exists per-battle; FOB staging and supply lanes unbuilt |
| **9 · Consequence** | **Ledger + Journal** (World Contribution entries, what was taken, what was held) + **Circuit → holder colouring** + the **Cross Badges · Oracle Influence** display (`§16` B6 ✅). | Ledger/Journal exist; contribution rows unbuilt; **the Circuit has no holders at all** (§10) |

**Rule (the lead's instruction, kept):** a screen maps to **one** beat. Where a surface is genuinely needed by two beats (the Circuit is in beats 2, 6, 8 and 9) it is **one screen with beat-specific layers**, not four screens — and the layer that belongs to a later beat is not rendered until that beat's state exists.

### 3.2 The smallest honest version of each surface on a phone

Portrait 390×844, existing shell only (`BottomNav` 6 slots, sticky `Ribbon`, `Sheet`, `.chip`, `.pill`, `.meter`, 44 px floor with 48 px for anything that pays attention to the player). **No new tokens, no new colours, no new nav slot** — `battles` is the existing conditional war slot. `[ours]` Every row that matters is one 44–48 px row with a status chip; density comes from drill-down, not from more chrome (the restraint rule from `ui-benchmark-notes.md` §1.1/§1.3).

### 3.3 Surfaces that need a concept NOT on the nine beats — stated, not smuggled

1. **The notification permission + per-kind opt-in (Settings).** The notification is part of beat 3 — but the *ask* is a Settings/OS surface with no beat. `[ours]` It lands as a new **Settings row** (§7.4) and it is deliberately **not** a ninth-and-a-half beat: it never appears inside the alarm flow, because an alarm that interrupts to ask for permission is a nag.
2. **Device settings for the alarm itself** (alarm voice on/off, alarm volume separate from story volume). Also outside the flow, same reason.
3. **The supply-lane dispatch surface** (beat 8's "feed the base"): it is `colony-supply-lines.md` §6's sheet, owned by that spec, **not by the war layer**. The war layer links to it and states the bill; it does not re-implement it.

**Anything else needing a new concept is a design error** — if a later build pass finds one, it comes back here as a tenth beat proposal rather than appearing in a screen.

---

## §4 · The alarm, designed properly

*The owner gave the shape (M2) and the voice (M5). Everything below is `[ours]` unless quoted.*

### 4.1 What fires it — a real detection event, never a decoration

**The contract (the same honesty rule as the green dot on the server window):**

- An alarm exists **only** as the rendering of a **`DetectionEvent`** produced by a **linked satellite net**. No linked net → no event → **no alarm, and no "quiet" state either**: the sector simply reads **UNWATCHED**, with the reason.
- Every event carries **`firstSeenAt`** — a real server timestamp. The alarm renders **"seen 05:31"** from that timestamp. `[ours]` A missing timestamp is a **defect, never a placeholder**: the sheet refuses to render a time rather than printing one.
- The event log is **append-only**. A detection that happened stays in the log with its age; the sector board shows **how old** each detection is (a two-hour-old contact reads as two hours old — no eternal pulsing).
- `[ours]` **No false alarms, ever — not even as enemy counterplay.** A decoy/false-signature mechanic is *rejected in this design*: our own rule is "an alert only fires on a real event", so an enemy able to fabricate a signature would make the UI lie while following its instructions, and a world that learns alarms can be fake stops answering real ones. The owner may overrule this (it costs us one counterplay option — §14 R4); concealment must stay **concealment, never fabrication**.
- **No urgency theatre:** no "response required", no manufactured countdown copy beyond the real clock that exists (§5), and the alarm never blocks the player's controls.

### 4.2 What it shows, and when

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠  SECTOR SEVEN — UNKNOWN SIGNATURES                        │
│     seen 05:31 · detected by your linked net                 │
│                                                              │
│     Something crossed into Sector Seven. The net holds the    │
│     trace; it cannot tell you what it is.                    │
│                                                              │
│   [ Investigate — send a scout  ⟶ 4 min ]   (48 px)          │
│   [ Not now ]                                (44 px)          │
└──────────────────────────────────────────────────────────────┘
```

| Shows at fire time | Does **not** show at fire time |
|---|---|
| the **sector** designation, spoken-ready (§6.3) | **whose** it is — not until a scout reads it (T2) |
| the literal label **UNKNOWN SIGNATURES** (his words; five-language text pending, §8) | an **exact force** (T3) |
| **the time it was seen** (`firstSeenAt`, localised, §6.5) | any invented number: no headcount, no strength, no ETA |
| **who detected it** (your linked net — so the alarm's own basis is visible) | a threat percentage or risk score |
| **the two choices** (investigate / not now) | |

`[ours]` **Where the coarse strength band goes — a difference from the lead's draft, flagged for him.** The source file's W7 recommendation was "sector + band". **This doc recommends: sector only at fire time, band as the scouts' first result (T1).** Two reasons: (a) his own reading says the alarm names *a place, not a force* — "unknown signatures" is the whole point of the first minutes; (b) if the size is free at fire time, **the investigate choice is theatre** — the player already knows whether to rally. If he prefers band-at-alarm it is one flag, and the cost is that scouting loses half its reason to exist.

### 4.3 Investigate? yes / no (his choice, M2 — not an auto-resolve)

- **YES → a scout is dispatched.** The button shows the **real** cost before commit: travel time to the sector over the actual link kind (`§13`), and the scout's exposure. Eligibility is honest: a reason string when it is not possible (no scout capability, no link to that sector, colony besieged), never a dead button.
- **NO → nothing happens, and the alarm stays in the sector board** with its age, until the event resolves or ages out by a published rule. **`[ours]` "Not now" is never punished by copy** — no "you chose to ignore this". The consequence is the incursion itself, which is consequence enough.
- `[ours]` **The alarm does not require a decision from every player.** It is world-level; any player who can act may investigate. Two players scouting the same event `[ours]` return **the same tier** (an event has one truth) and the second is told a read already exists — this prevents "shopping for a better roll" and prevents the same event paying twice (§9).

### 4.4 The intel tiers — what the scout can come back with

| Tier | Reads | What it is worth | Who can reach it |
|---|---|---|---|
| **T0 — nothing** | "the trace is there; the read came back empty" | you know a force came in, not what it is → **you guess, or you rally big** | any alarm, with a heavy jammer |
| **T1 — the band** | a **coarse size band** `[ours]` PROPOSAL: three bands — *a raiding party · a war band · a host*. Thresholds are calibration, not a rule. | tells you whether to answer alone or muster | a scout against light jamming |
| **T2 — who it is** | the **world** it came from, or that it is a **Covenant's** force | turns the fight political: who do we answer, and who do we call | a scout against no effective jamming |
| **T3 — the estimate** | **what you need to size the force**: how many hero squads, the weight of the troop mass, the weapon families fielded — **bands and counts, never the stat sheet** | the commit decision (M3: "you'll know how much you want to send") | a scout with a clean read |

`[ours]` **Three rules that make the tiers honest:**

1. **A tier is a read, not a roll of the dice on the display.** Same event, same jamming, same tier — deterministic server-side, so two players cannot get different truths about one incursion.
2. **The scout burns time, not the scout.** `[ours]` PROPOSAL (W9): the scout unit itself is not destroyed; what it costs you is **the window** (travel out and back, and the minutes the incursion used while you flew). Rationale: information should cost *time* — a mechanic that destroys units makes players stop scouting, and intel becomes a coin flip instead of a decision. *(Note: the lead's line in the source file read "the scout survives but burns time" — this doc reads that as **no unit loss**, and says so explicitly so nobody builds both.)*
3. **T3 is sized, not measured.** `[ours]` This is the honest reconciliation with the ratified `§15.4` B2 ("**no pre-battle scouting of hidden enemy stats** — strictly live/battle + after-action reports"): the scout returns **how big**, not **the `§15` B4 stat sheet** (hero stats, skills, exact weapon tiers). See §11 C1 — if the owner wants the stat sheet, B2 must be amended first, by him.

### 4.5 What a jammer can and cannot hide (M2's anti-scout jammers)

| A jammer **can** hide | A jammer **cannot** hide |
|---|---|
| **who** the force belongs to (T2) | **that something is there.** Presence is the net's detection, and the net is what fired the alarm — a jammer masks **detail, never existence**. If it could hide existence, there would be no alarm and no war layer. |
| the **size band** (T1) — at the cost of build, war energy and a slot on a ship/force | **the sector** |
| the **force estimate** (T3) | **the time it was seen** (`firstSeenAt`) |
| `[ours]` **our own launches too** — see W10: one build, two uses | **the record**: a detection already logged cannot be unwritten. Jamming is live concealment, never a history edit. |
| `[ours]` a **rally mustering** at a colony (W12) — if you can jam a muster, you can arrive unannounced | **the alarm's own basis**: the sheet always names *your* linked net as the detector, so a player can tell "we saw nothing" from "we were jammed and know it" |

`[ours]` **The counterplay is symmetric and earn-only by construction:** jammers are built (not bought) and scouts are built (not bought) — so the whole intel layer sits inside G1–G4 with no special rule, and **spend appears in no tier** (§9).

### 4.6 The world-wide alarm vs. the phone — one `[ours]` warning

His words are "**we should all get a warning**", and in-world that is exactly right: **the alarm is a single world-level banner that everyone present sees.** The risk is the notification channel: a world is specced at ~300–500 colonies, so *one* incursion must never become 500 phone notifications. `[ours]` Rule: **one notification per detection event per world, coalesced** (never one per player per minute), delivered only to players who opted in for invasion alarms on that world, **plus always** (regardless of opt-in) the owner of a colony or forward base in the affected sector or directly linked to it, and the Covenant of a colony under attack. If he wants the literal "everyone, every time", that is a one-line change with a known cost (§14 R2).

---

## §5 · The clocks — one table, and it must not contradict the others

**Everything here is one table on purpose.** The failure mode this section exists to prevent is a fifth clock invented later that quietly disagrees with the other four.

| # | Clock | Length | Status | What it is |
|---|---|---|---|---|
| C1 | **Rally window** (muster at a colony) | **5–15 minutes** | **HIS NUMBER (M3)** — and *he flagged it as a guess* ("or something like that"). Treated as a **PROPOSAL to ratify**, and every use of it in this doc says so. | pre-launch muster; the force cannot leave before it closes |
| C2 | **Rally scaling** | `[ours]` floor 5 min, **ceiling 15 min**, **launch-early allowed** when the muster is ready | **PROPOSAL (W11)** | scaling exists only as "people are still arriving", never as a function of force size |
| C3 | **Travel — within a world** | **PROPOSAL:** rides the ratified `§13` link model (roads fast, roadless slow). The only number in code today: `aidTravelDelayMs = 10 min` — a single calibration delay, *not* a per-link table. The supply spec's lanes are **45 min road / up to 2 h roadless** (`colony-supply-lines.md` §1.3). | **PROPOSAL** | moving a force to the sector; the alert's reaction time must fit inside it |
| C4 | **Travel — between the two matched worlds** | **~24 hours** | **OWNER DIRECTION (2026-09-26, the Forge message):** a supply run "does not arrive the moment you send it". See §11 C2 — this is the leg that resolves the conflict with C3. | the crossing: gear, troops, supplies do **not** teleport to the other world |
| C5 | **Incursion window** (M3: "so much time to get there, get what they're after and get out") | **PROPOSAL: not a third clock.** It is **the battle's own duration (ratified B1) plus an extraction allowance**, so the raider's deadline is derived, never invented: `durationMs = base(20 min) × (1 + log₂(1 + totalPower/k)) ÷ (1 + 3 × gap)`, clamped **[5 min, 8 h]**, plus `[ours]` a fixed extraction allowance (PROPOSAL, to tune — one number, not a system). | **PROPOSAL built on a RATIFIED number** | how long a raider may stay before it must extract — **and it ends extraction, not the fight** (W14) |
| C6 | **Fortification / forward base** | **8–10 h to full potential**, offline-resolved, 4 stages (default split 1/2/3/3 h) | **RATIFIED FB2 (2026-09-12) — already in code** (`FOB_STAGE`/`fobMaxTierByStage`, `fobTroopCapByStage` in `war-types.ts`) | the inverse of C5: **you cannot fortify inside one incursion window** — so fortification is what happens *after* the window, which is exactly why "hold the position" makes you a forward base (W14, §11 C6) |
| C7 | **Mid-battle decision windows** | **Ratified and in code:** milestones at 25 % / 50 % / 75 %, each window = **12 % of the battle clamped [2 min, 15 min]**, plus the **8 min first-opening floor** and edge windows at a 0.4 power gap | **RATIFIED B12 — built** (`BATTLES_CONFIG`) | decisions happen in windows, not APM |
| C8 | **Supply run, gear & food** (Forge direction) | **~24 h** (the same crossing as C4) | **OWNER DIRECTION** | forged gear and stores do not arrive when you send them; C4/C8 are **one clock, two uses** |
| C9 | **Notification coalescing** | `[ours]` PROPOSAL: one notification per event per world; repeat at most once if the event is still live | **PROPOSAL (§7.3)** | protects the phone from the alarm-storm; nothing like it exists today |
| — | *Adjacent, not war clocks — listed so nobody conflates them:* 30-day inactivity sweep for abandoned colonies; 72 h until a starved held colony is lost to the Chorus; 30-day/claimed rules unchanged. | | ratified/working elsewhere | colony life-cycle, not the war layer |

### 5.1 The arithmetic that must hold

```
 detection  ──►  alarm fires immediately (sight, sound, notification)
                       │
                       ├── investigate? a scout leaves ── travel (C3) ──► reads (T1..T3)
                       │
                       └── rally? muster opens ── rally window 5–15 min (C1/C2, HIS)
                                                  │  ← the alert's whole purpose is
                                                  │    to make this window USABLE:
                                                  │    people must be able to arrive
                                                  │    inside it, not after it
                                                  ▼
                                            launch ── travel (C3, then C4) ──► contact
                                                  │
                                        battle duration, ratified B1 (C5)
                                                  │
                                     extract ◄────┴────► fortify (C6, 8–10 h after)
```

**Three rules that keep the clocks independent and honest:**

1. **Voice never paces any of them** (M5's discipline, the same rule as the Fall's hard 2-hour clock): the alarm speaks immediately; the rally countdown starts from the **detection event**, not from the utterance; if the voice fails, **no clock moves**.
2. **A clock that has no ratified or owner-directed number is written as a PROPOSAL in this table and nowhere else.** No screen prints a duration that is not one of C1–C8.
3. **Nothing here is purchasable, and no clock can be shortened by spend** — no speed-ups (ratified `§9.1.2`: "in a scored ladder a speed-up *is* a score advantage"). This holds for the 24-hour crossing too: that wait is the mechanic, not a product.

---

## §6 · The voiced alert (M5)

### 6.1 The line shape — short, repeating, and the place last

```
 speak 1 ─ "Sector warning. Sector warning. Anomaly detected."
 speak 2 ─ (the sector, if it has a spokable designation) "Sector Seven."
```
`[ours]` **Timing and repetition rules** (all numbers here are PROPOSAL — they are delivery, not mechanics):

| Rule | Value | Why |
|---|---|---|
| Speak on fire | immediately, once | the alarm's job is the first two seconds |
| Repeat while unacknowledged | at most **twice**, at a fixed interval (PROPOSAL: ~6 s) | a signal, not a loop; then the visual carries it |
| Stop on | acknowledge, or the sheet closing, or the event resolving | never talks over the player's own decision |
| Length | ~9 words / well under the shipped caps (`maxUtteranceChars 180`, `maxUtteranceSeconds 12`) | the alarm must never become a monologue the player waits out |
| Plays when | the game tab is **visible** | a spoken alarm in a background tab is noise; that duty belongs to the notification (§7) |
| Interruption | `[ours]` the alert speaks **over** nothing — it takes the next utterance slot and, if the queue is full, it is the line that survives (`§5.3` of the voice sheet already drops the **oldest waiting** line; the alarm is newest, so it wins the slot it needs) | the alarm must not be the line that gets dropped |

### 6.2 It speaks the PLAYER'S language — while story voices stay English

**`[ours]` Recommendation W17: yes.** Reason, in one line: an alarm nobody understands is not an alarm — a Persian tester hearing English noise at the exact moment it matters is the failure the owner's own words rule out ("understandable > atmospheric"). Story voices stay English (his standing rule, captions carry the story); the **alarm** is a device voice, not a character, so nobody's performance is lost.

**The verified code consequence — and it is small but real:**
- The shipped cast selects voices from an **English-only pool**: `canonicalPool()` in `site/src/game/voice/voice-direction.ts` filters to `en*` voices and only keeps every voice when there are **no** English ones. An alert in the player's language therefore needs a **pool chosen by the player's language** (`VOICE_CONFIG`/`cast` takes a language, not a fixed `en` pool) — a small, spec'd change to the existing engine, **not** a new engine.
- Spoken numbers exist **only in English** today (`numberToWords()` + `NUMERAL_TABLE` in the same file). A spoken sector designation in five languages needs a **per-language numeral table** (§6.3).
- The honest limit that shapes §6.4 stays: most phones carry **one voice per language** (the plan's own constant), so the alert cannot buy distinctness with a different voice.

### 6.3 The sector must survive being SPOKEN in five languages

`[ours]` **The spoken-designator gate — a hard rule, not a nicety:**

1. A sector has an **authored designation per language** (a number word or a name). **Never a raw internal id**, never a resource key, never a leading-zero code.
2. **The voiced line contains no digit glyph.** It contains the **number word in the player's language** — because a synthesiser reading "7" is a lottery in every language, and Persian digits (۷) are a lottery twice over. `[ours]` PROPOSAL (W19): during beta the sector wears a **number + the word** (authored as "Seven" / "السابعة" / "siete" / "sete" / "седьмой"), with authored **names** as a later flavour pass, because numbers are unambiguous, cheap to translate and impossible to mispronounce identically in two languages.
3. **If a designation cannot be said out loud in a language, it is not spoken in that language** — the alarm falls back to the generic line (`"Sector warning. Sector warning. Anomaly detected."`) and the **visual** carries the location. This is deliberately not "say it in English": a half-understood alarm is worse than a short one.
4. The **on-screen** designation keeps its normal tracking. `[ours]` It must **not** use `.eyebrow` (11 px uppercase with letter-spacing, `styles/app.css`), because letter-spacing distorts Arabic-script joins — this is a *new usage* note for a *new* string, not a re-opening of anything the owner has ruled on (§8.4).

### 6.4 Distinct from the story cast, without a voice the phone does not have

- `[ours]` A **new direction row** in the shipped table's shape (`voice-direction.ts`), kind `alarm`, sitting **inside** the shipped bands (`rateBand [0.72, 1.06]`, `pitchBand [0.3, 1.35]`), `volume 1.0`, `neverSplit: true`, no echo, and **must not take the MACHINE class** — that seat is reserved for the Chorus (`reservesMachine`), and an alarm that sounds like the Chorus would tell the wrong story.
- **Distinctness comes from cadence**, because the phone may only have one voice: `[ours]` PROPOSAL — **staccato, three separate short sentences, a ~350 ms gap between the repeated phrases, and no legato clause anywhere** (against the Narrator's long unhurried runs and the Chorus's slow single utterance). Rate/pitch sit at the extreme of the band that keeps intelligibility.
- **The honest one-voice case is designed, not hidden:** on a device with a single voice per language, the alarm seat is `shared: true` (the engine already records this) — the alarm then differs **only** in rate, pitch and cadence. Where that is not enough, the **visual carries it**; we do not pretend a second voice exists.

### 6.5 With no installed voices, the visual carries the whole meaning alone

The engine already degrades silently by design (`prologue-tests/voice-verify.ts` proves the cue machine's full sequence with **no synthesis at all**, 274 cases). `[ours]` The alarm's equivalent obligation:

- The **sheet** states everything the voice would have said: sector, `UNKNOWN SIGNATURES`, **seen hh:mm**, and the two choices.
- The ribbon banner carries sector + the label + the time at **390 px without a tap**, with the **functional hazard colour** (global meaning colour, never a race accent) plus a **non-colour channel** (the ⚠ shape and the literal words) — never colour alone.
- The existing live-region pattern is reused for screen readers, at the honest level: the shipped live regions are `aria-live="polite"` (`TutorialCueLayer.tsx`, `BattlesTab.tsx` window clock). `[ours]` **The alarm is the one thing that justifies `assertive`** — an interruption, once, on a real event.
- The clock is independent of the voice: **whatever happens to speech, the rally window opens at the same instant.**

### 6.6 The alert lines, filed casting-ready

Filed here in the shape of `design/opening-script.md` (speaker + inline direction, `>` the line), so a real cast can re-record the same words later. **Owner rule stands: professional casting is deferred** — these ship on the device's own voices now, no spend.

```
SPEAKER: THE SECTOR ALARM            (device voice · new `alarm` seat · staccato)
  direction: flat, clipped, no emotion, no rise at the end. Three short
  sentences. A beat between each repetition, not a breath. Never hurry into
  the sector name — it is the last thing said and the first thing needed.
  A single voice per language is the normal case: this must work with ONE.

  > Sector warning.
  > Sector warning.
  > Anomaly detected.
  > Sector Seven.
```

`[ours]` **Language filing (the honest state, not a promise):**

| Language | Line | State |
|---|---|---|
| **en** | "Sector warning. Sector warning. Anomaly detected. Sector Seven." | **AUTHORED here** (his words, M5, his shape kept verbatim in the first three sentences) |
| **es** | "Alerta de sector. Alerta de sector. Anomalía detectada. Sector Siete." | `[ours]` **machine-seed draft** — replaceable by a human file (the shipped convention: every non-English catalogue is `machine: true`) |
| **pt-BR** | "Alerta de setor. Alerta de setor. Anomalia detectada. Setor Sete." | `[ours]` machine-seed draft |
| **ru** | "Внимание, сектор. Внимание, сектор. Обнаружена аномалия. Сектор Семь." | `[ours]` machine-seed draft |
| **fa** | — | **TEXT REQUIRED, NOT AUTHORED HERE.** A mistranslated safety line is worse than a missing one, and the sector noun's Persian form is a translator's call (§8.3). Until it exists: **the visual alarm carries the whole meaning** (§6.5) rather than the player hearing English noise — which is the one place this doc deliberately deviates from "untranslated text falls back to English". |

**Casting note for the paid pass (deferred):** these four sentences are the same four in every language — a single actor per language, recorded once, at ~6 seconds. The only line that changes per event is the sector name, and a real cast reads the **number words** from the authored list, never a digit.

---

## §7 · Notifications — the alarm reaching an absent player (M4)

### 7.1 What exists today: verified **nothing**

**Stated plainly: no notification infrastructure exists in this codebase.**

| Claim | The check |
|---|---|
| No notification code at all | `grep -rniE "Notification\|requestPermission\|pushManager\|showNotification" site/src site/public` → **three hits, all comments that say the opposite**: `components/ui/ReadyDot.tsx` ("A dot means an available action, NEVER a notification"), `game/nav-badges.ts` ("A badge means there is an action available here — never a notification"), `routes/play.tsx`. The codebase deliberately separates badges from notifications and has **no notification path**. |
| The service worker does not touch the game | `site/public/sw.js` has **no push handler** and no notification code; the workbox/`KEEP` structure is about the app shell and the translator's model cache. |
| The manifest declares no push config | `site/public/manifest.webmanifest` — installability only. |
| Settings has no notifications row | `components/shell/SettingsSheet.tsx` — the rows are language, text size, quality, device (translator). The business plan already lists "notifications" in Settings; **that row does not exist yet.** |

**So this is a build from zero, and it is app-tier work.** A push that wakes a sleeping phone needs the **installed app** and the OS permission (on iOS, web push only works when installed). A browser tab cannot promise it. `[ours]` Therefore the feature ships as **two honest layers**: the **in-session alarm** (always, no permission) and the **push notification** (only where the platform and the player's opt-in allow it) — and the Settings row says which one this device actually has.

### 7.2 The triggers — five real events, and no others

| # | Trigger | Fires when | Message shape (must contain a real time) | Opt-in kind |
|---|---|---|---|---|
| 1 | **Unknown signature detected** in a sector of your world | a `DetectionEvent` is created by a linked net (M2/M4) | *"Sector Seven — unknown signatures. Seen 05:31."* + the choice | Invasion alarms |
| 2 | **Raid in progress on your colony or forward base** | a hostile force is engaged on ground you hold (M1: the base "is susceptible to raiding") | *"A force is in Coldwater Reach. Your forward base is under attack. Seen 05:31."* | My holdings |
| 3 | **The Chorus ratchet reaching raid tier** — **the warning arrives BEFORE 100 %**, never after | the ratchet's *last tier before* the raid, and again at the raid's own start | *"Chorus attention 84% — Coldwater Reach is drawing notice. Purify to break the climb."* | My holdings |
| 4 | **Covenant aid call** / a rally forming | a ratified aid beacon is raised (`§15` B11) or a rally opens at your Covenant's colony | *"Your Covenant is mustering at Coldwater Reach. 12 minutes."* | Covenant |
| 5 | **Supply run arriving** | a convoy/gear run reaches its destination (Forge direction: ~24 h, so it is worth knowing) | *"Your supply run reached Vault Nine."* | Logistics |

`[ours]` **Deliberately NOT notifications — restraint is the feature** (`ui-benchmark-notes.md` §1.1: the badge storm is the genre's disease, and the lead-adopted rule is "celebrate only real dents"): no "your expedition finished", no "someone hit your colony hours ago" reminders, no "come back" nudges, no daily-login push, ever. **Five triggers, or the feature is a nag.**

### 7.3 The contract every notification must satisfy

1. **Fire only from a real event** with a server timestamp. A notification is never a reminder dressed as an emergency. **No manufactured urgency, no "Action Required", no countdown theatre.**
2. **It deep-links into the defence**: tapping opens the world → the sector → the choice (investigate / rally / reinforce). Never a generic home screen, never a tab the player then has to search.
3. **One per event per world, coalesced** — §4.6. `[ours]` PROPOSAL: a repeat (if the event is still live and unanswered) no sooner than the rally window's length (5–15 min, his number) has elapsed, and at most once.
4. **Permission-based, asked once, in the player's language, with a plain reason** ("so we can tell you if someone lands on your world while the app is closed"). A refusal is remembered and never re-asked by the game; the Settings row lets the player change their mind.
5. **Per-kind opt-in, per world** (five kinds × your world) — and `[ours]` PROPOSAL (W20 for him): one explicit switch, *"wake me for an invasion"*, is the only thing allowed to speak during quiet hours, and it is off unless he says otherwise. **Default: on for invasion alarms on your own world during a war week; off for everything else.** Nothing here is purchased, and no notification can be bought or silenced for money.
6. **No notification is a paywall, a store prompt, or a reason to buy.** Nothing in this layer is purchasable (G1–G4) — so a notification can never be the doorway to a shop.

### 7.4 The Settings row that has to be built

One row, in the player's own language, in the existing sheet (`SettingsSheet.tsx`), stating honestly what this device gets:

```
Notifications
  In-game alarm                 [ on ]   — always works, no permission needed
  Phone notifications           [ off ]  — needs the installed app
      Unknown signatures        [ on ]
      My holdings under attack  [ on ]
      Chorus raid warning       [ on ]
      Covenant aid calls        [ on ]
      Supply runs arriving      [ on ]
```

`[ours]` The row never claims a capability the device lacks: if the app is not installed, the push switch is **absent with the reason shown**, not present-and-broken.

---

## §8 · Vocabulary and the five languages

### 8.1 Two new nouns, both his

| Noun | His words | State |
|---|---|---|
| **sector** | M1, and he corrected "quadrant" himself ("not a quadrant but … no, a sector") | **Not in the build at all** — `grep -rn "sector" site/src site/public` → **zero occurrences.** `nav-slots.ts` documents the rule that every label is a coined-and-ratified noun, so "sector" enters the vocabulary by ratification, not by usage. |
| **unknown signatures** | M2 ("sector so and so as unknown signatures or something in those lines") | His label; the two words are the locked on-screen text pending W7 and the translations. |

### 8.2 The keys, in the shipped convention

New player-facing strings are **born keyed and translated in the same commit** (business plan rule). The alert's strings are ordinary catalogue entries in the existing shape (`game/i18n/langs/<code>.ts`, one file per language, `{name}` interpolation, one row in `languages.ts`, one import in `catalogues.ts`). `[ours]` PROPOSED key names, so nobody invents a second convention:

`alarm.sectorWarning` · `alarm.anomalyDetected` · `alarm.unknownSignatures` · `alarm.seenAt` · `alarm.sectorDesignation` (`{n}` = the **number word**, per language) · `alarm.investigate` · `alarm.notNow` · `alarm.unwatched` · `notify.invasion.title` / `notify.invasion.body` · `settings.notifications.…`

`[ours]` **One factual footnote for whoever builds this:** the English catalogue file (`langs/en.ts`) currently holds **287** key lines by grep, while the business plan's running figure is **242** — the two disagree, so treat the exact count as **owed a recount** rather than trusting either. It changes nothing about the rule: new strings land in all five files or they do not ship.

### 8.3 The Persian text for these strings **does not exist yet** — and that is the real blocker

- The alert is a **non-negotiable** string: it is the one moment a player must understand. It is also **new text in a language file**, which is exactly the project's known blocker (the plan: the missing translation, not the wording, is what blocks Persian testers; ~45 keys on the first screen still need text that does not exist).
- `[ours]` **The sector noun's Persian form is a translator's call, not ours** — it is a new in-universe noun, and §6.3's rule means its spoken form must be authored before any Persian alarm speaks at all.
- **Until that text exists, the Persian player hears nothing and sees everything** (§6.5). That is the honest interim, and it is better than English audio.
- **Not re-opened here:** the owner has ruled that shipped Persian wording stands. This section adds nothing to that audit and asks for no sweep; it records only that a **new** string needs a **new** translation.
- `[ours]` **The gate gap worth closing in the same slice, stated without re-opening anything:** the i18n gate checks that a key is *present* in every file; **nothing checks that an alarm line is speakable** (no digits, a designation that exists in that language's table). The build slice adds those two assertions to the new suite — presence is not pronunciation.

### 8.4 RTL, for the alarm specifically

`[ours]` Three rules for the alarm's visual in `fa` (and any future RTL language): (1) the designation does **not** use `.eyebrow`'s letter-spacing; (2) the sector label and the time sit inside **bidi isolation** so "Sector Seven · seen 05:31" cannot reorder into nonsense (the plan already names the missing bidi isolation as the block, and the alarm is the worst place to get it wrong); (3) the alarm's numbers use the **player's locale** (§6.5) — which is a real gap today: `toLocaleString()` is called **with no locale argument** in `components/shell/CradleSheet.tsx`, `components/BattlesTab.tsx`, `components/CircuitPage.tsx` and `components/LedgerButton.tsx`, so "the time it was seen" cannot yet be rendered in the player's chosen language or calendar. **The alarm's timestamp is downstream of that fix.**

---

## §9 · Guardrails — the lines the build must hold

| Guardrail | How this design holds it |
|---|---|
| **Everything earn-only** (`G1`–`G4`) | Linking satellites is a **build** (W2); scouts and jammers are **built**; the radar cannot be bought; no tier, no intel level, no rally slot, no notification kind is purchasable. `[ours]` **The check:** no purchase vocabulary may exist in the war modules, the same standing assertion the battle engine already carries ("no purchase vocabulary exists in this module … the static no-purchasable-term assertion scans both sources", `war/war-types.ts`). |
| **Spend contributes ZERO to Reverb** (ratified `§17.1`, V1) | Nothing in this layer is a scored input. **No Reverb figure is printed anywhere in this document** (§0), and pairing shows *matched*, never a number, until the ledger exists. |
| **No purchase feeds any term of any clock** | No speed-up of the rally window, the crossing, the incursion window or the FOB build (`§9.1.2`). The 24-hour crossing is the mechanic, not a product. |
| **Contribution is paid ONCE per live event** — two players cannot mint it from nothing | `[ours]` Two payments are proposed in this layer, both anchored: **reinforcing against a live incursion on that ground** (a real, timestamped event — the same shape as the ratified Chorus-reinforcement rule), and **linking a net, once per net per cycle** (W6). A rally that turns up after the fighting is over pays nothing; a second player scouting the same event is told a read exists and is not paid again (§4.3); a player cannot be paid twice for one event. |
| **No softlock, never erased** | A broken incursion, a taken forward base, a razed or lost position: all **taken, never erased** (W5) — retakeable by resupply or by force, matching the ratified no-softlock floor ("a ratchet, not a cliff") and the four fates already written for abandoned colonies (taken · razed · defended · lost, with "razed" and "taken" distinguishable). |
| **The owner's standing rules on fiction** | The war's nouns are mythic-fiction only; no sector, world, race or alarm term may collide with a real-world religious, national or ethnic term. The alarm speaks of **sectors and signatures**, never of real places or peoples. |
| **The Oracle door is never missable** (`§2`) | The alarm is the *sound* of a first breach, so it must never gate, delay or hide the First Oracle Night — and a player who never hears an alarm must still be able to breach in a later week and meet their Oracle. |
| **No dark patterns, no manufactured urgency** | The alarm fires only on a real event with a real time; there are no false alarms (§4.1), no "response required", no purchase in the flow, and the notification count is capped at five kinds (§7.2). |
| **Accessibility stays an acceptance gate** (`ui-benchmark-notes.md` §5, adopted) | 44 px floor / 48 px for the choice that matters; the alarm is never colour-alone; `aria-live="assertive"` once, honestly; `prefers-reduced-motion` respected (the alarm does not pulse); WCAG AA contrast on the hazard treatment at 390 px. |
| **Voice never paces the game** | §5.1 rule 1. |

---

## §10 · What cannot ship yet, and the check for each claim

**None of this is in beta.** The beta gate is unchanged and is not this: **the bundled translator plus the chat rooms**.

| Cannot ship | The verified reason |
|---|---|
| **The war itself, sectors, pairing, raids into another world** | The plan sequences war after the beta core; `site/src/game/war/war-types.ts` states it in its own header: battles live **per-colony** on `GameState` this slice, and "the world-level war ledger, `data/world-<id>.json` with every colony watching every front, arrives with war Phase 1 proper." **There is no world-level store today.** |
| **The Circuit as a war map (holders, pairing, forward bases, detection)** | `site/src/game/map.ts` is **read-only geography**: `AtlasNode` = `{id, name, kind, x, y, zoneId, profile, importance, heart}`; `AtlasGraph` = `{worldId, raceId, seed, nodes, edges}`. **No holder, no owner, no pairing, no FOB, no detection field.** The tile-holder model is specced in `colony-supply-lines.md` §8 (`HeldColony.tileId`) and is unbuilt. |
| **The sector vocabulary in the UI** | `grep -rn "sector" site/src site/public` → **zero hits.** The noun does not exist in the build, and `nav-slots.ts` requires coined labels to be ratified. |
| **Notifications (all five triggers)** | §7.1: **no notification code, no push handler, no permission flow, no Settings row.** Build-from-zero, app-tier. |
| **The voiced alert** | The *engine* ships (`game/voice/voice-engine.ts` + `voice-direction.ts`, free device voices, 274-case harness, silent degradation proven) — but the alert needs a **new seat**, a **language-parameterised voice pool** (`canonicalPool()` filters to English today) and per-language number words (`numberToWords()` is English-only). Those are small, spec'd changes; **none of them exists yet**, and the four non-English lines need text (§6.6, §8.3). |
| **Honest pairing display** | There is **no world/server field on a colony and no account bridging** (verified), so two matched worlds cannot currently be identified per colony — and a live pairing needs **two live worlds** (the battle spec's own closing note: "live pairing test needs a second world (headless pairs until then)"). |
| **Any Reverb number on screen** | `§17` is ratified with **zero implementation**, and the activity term has **no data source** (captures/purifies are not recorded). **A number today would be fabricated.** |
| **"Players online now" / "defenders available"** in the alarm or sector board | No last-seen or heartbeat exists, so it would be invented. The sector board shows **detections and their ages**, never a roster of who is awake. |
| **A raid while a player is offline** (the Chorus-raid class) | Open the same way the purification direction left it (W16): a warning window and a call for aid is the recommendation, and **the whole raid mechanic — Chorus or war — is unbuilt**. |

---

## §11 · Where his direction meets ratified design (conflicts, and which wins)

| # | Conflict | Resolution — and who wins, in our reading |
|---|---|---|
| **C1** | **`§15.4` B2 (ratified): "no pre-battle scouting of hidden enemy stats — strictly live/battle + after-action reports"** vs **his scout's read** ("you might be able to pick up enough to know who it is, what it is") | **Both hold, by sizing the read.** T3 returns **how much force** is there (squad count, troop mass, weapon families at band level) — what M3 needs ("you'll know how much you want to send") — and **not** the `§15` B4 stat sheet (hero stats/skills, exact tiers). **B2 wins on the stat sheet; he wins on reconnaissance.** If he wants the exact sheet, **he must amend B2 first**, because amending it silently would break the ratified "discovery is honest" rule and the battle spec's own design flags. |
| **C2** | **The ~24-hour supply run** (his Forge direction, 2026-09-26: gear "does not arrive the moment you send it") vs **`colony-supply-lines.md` §1.3: convoy travel 45 min (road) / up to 2 h (roadless), 3 convoys in flight** | **Two legs of one journey, both kept** (W18): the **within-world lane** is the supply spec's 45 min–2 h; the **crossing to the other world** is his ~24 h, and **gear and troops do not teleport across it**. Without this split the two docs contradict each other on the same object. **His number wins for the crossing**, the supply spec wins inside a world. |
| **C3** | **"we should all get a warning"** (M2) vs the reality of a 300–500-colony world | **In-world: everyone, exactly as he said** — one world-level alarm, one banner, everyone present sees it. **Notifications: coalesced and opt-in** (§4.6/§7.3) because 500 phones ringing for one incursion trains the world to turn alarms off. **He wins in-world; the coalescing is `[ours]` and is a one-line change if he rejects it.** |
| **C4** | **The ratified war week** (`§3`/D1: Mon–Sun, Gearing → Campaign → Climax → Truce) vs his **simultaneous two-way pressure** ("same time that other server they're trying to get our stuff") | **Compatible, with a stated split:** the **week is the scoring frame** (ratified, and it is what makes the ladder fair — buckets, Truce, comeback multipliers), and **inside the week the incursions are live, continuous and two-way**, exactly as he describes. **Nothing here lets a raid happen outside a paired war week** — if he wants raids in peacetime, that is a change to D1 and needs his word, because it would move peacetime scoring. |
| **C5** | His **bounded incursion** ("so much time to get there, get what they're after and get out") vs the ratified **B1 battle duration** | **No conflict, by derivation:** the incursion window is **the battle's own duration plus an extraction allowance** (clock C5) — we invent no second number that could drift from B1. |
| **C6** | His **"get there and set up defenses if they think they can hold their position under fire"** vs the ratified **8–10 h FOB build (FB2)** | **Both hold:** you cannot fortify inside one incursion window, so **the window ends *extraction*, not the fight** (W14) — a raider who stays is a raider who became a forward base, which is why M1's "my forward base is already there and is susceptible to raiding" is a *consequence* of holding, not a second mechanic. |
| **C7** | `§12.1`: "lose [the FOB] and you are pushed off the zone" vs the **no-softlock** floor and the four fates | **Taken, not erased, retakeable** (W5). He loses the position, never the account, the Cradle or the race — consistent with the ratified ratchet floor and with `colony-supply-lines.md` §1.5 (release / raze / retake). |
| **C8** | **`§2` First Breach: the Oracle door is never missable** vs an alarm-driven first contact | **The Oracle rule wins.** The alarm is the sound of the breach; it cannot be the gate to it, and a player who misses every alarm still breaches later and still meets their Oracle. |
| **C9** | **His raid takes things** ("get what they're after") vs the **Chorus raid's unresolved "what does a raid take"** (purification direction, open call) | **One rule for both, decided once** (W15) — the two systems must not disagree, and the honest default is: **the ground and the stores at that site** (retakeable, decayed, never a jackpot, never account-level assets). This is the single most important thing to settle before either system is built. |
| **C10** | The plan's **"one race per server"** and **six race worlds** vs a war pairing across worlds | No conflict — the plan already says server-vs-server war comes later and that worlds are race-locked. But it means a **real** pairing needs a **second live world**; until then the pairing is a **headless/design-only** state (and the beta world is race-locked to the Watchers). |

---

## §12 · The open calls, W1–W17, with our recommendation each

**Read this as one pass:** every row is answerable with a word. `[ours]` marks our proposal; nothing here is ratified by us. **W8 is ANSWERED by the owner** (M4) and is marked so.

| # | The call | Our recommendation | Why (one line) |
|---|---|---|---|
| **W1** | One shared Circuit, or two overlapping? | **Each world keeps its own Circuit; a pairing opens a contested band of sectors where both worlds' forces meet, and your forward base sits in a contested sector** | Both worlds' geography is already authored per world (`§14` W1/W2 ✅) — one shared map would falsify every player's existing map; a band is additive and keeps each world's identity. |
| **W2** | What links a satellite? | **A build + a Leader seat** (Quartermaster/Marshal) | Earn-only by construction, readable on the Cradle, no purchase path — and it gives the new war layer a job a Leader can hold. |
| **W3** | Does a linked radar reveal the enemy's coverage (fog-of-war), or is detection one-way? | **Two-way** — you see what you could see | Symmetry matches the ratified "everything is published and open" stance, and it gives stealth (Draconians, later) something real to beat. |
| **W4** | Do the dormant satellites exist in the **beta** world, visible-but-unlinked? | **Yes — visible and unlinked, and honestly inert** | "A promise you can see" is worth having early (and it is the same grammar as the Codices), but **inert means inert**: no alarm, no fake button. If it cannot be honestly inert, don't show it. |
| **W5** | Can a forward base be lost entirely? | **No — it is taken, not erased, and retakeable** | The ratified no-softlock floor; a position you can always win back is what lets the war be loud without killing the beta-only player. |
| **W6** | Does linking satellites earn World Contribution? | **Yes — one payment per linked net per cycle, first link only; renewal pays nothing** | It is a public good (it protects everyone), but pay-once-per-net stops two accounts minting contribution from a build that has no threat attached. |
| **W7** | Is **"Unknown Signature"** the locked label, and does the alarm show sector only or sector + band? | **Label: yes, his words. Alarm shows the SECTOR only; the band is the scout's first result (T1)** — *a difference from the lead's draft recommendation, flagged* (§4.2) | If the size is free at fire time, "do you want to investigate?" is theatre; his own reading of the alarm is a place, not a force. Band-at-alarm is a one-flag change if he prefers it. |
| **W8** | Where does the alert go for an **offline** player? | **ANSWERED — the owner: a notification, so they can log in and defend (M4).** Our reading: push where the installed app and OS permission allow; the in-session alarm always | Settled by him. The build consequence is §7.1: nothing exists, so this is app-tier work from zero. |
| **W9** | Can a scout be lost? | **No — the scout survives; what it costs is TIME (travel out and back, and the minutes the incursion used)** | Information should cost time, not materiel: losing scouts makes players stop scouting and turns intel into a coin flip. *(The source file's line read "the scout survives but burns time" — this doc reads it as **no unit loss** and says so, so nobody builds both.)* |
| **W10** | Do jammers also mask **our own** launches? | **Yes — one build, two uses** | A defence-only jammer is a dead purchase in a game with no purchases; concealment-on-offence is what makes it a decision, and it gives W3's two-way radar its counter. |
| **W11** | Is the rally window fixed at 5–15 min, or scaled? | **Floor 5, ceiling 15, launch-early when the muster is ready; scale only by who is still arriving, never by force size** | His number is the honest one; scaling by force size would price big rallies out of the alert's reaction time — which is the window's whole purpose. |
| **W12** | Is a forming rally **visible**? | **Yes, to a world that has a linked net** | Otherwise the muster is a free button and the alarm's promise ("everyone gets a warning") becomes a lie; it also gives jammers a second honest use. |
| **W13** | Does holding a position require supplies? | **Yes — the same convoy rule as a held colony, reused, not reinvented** | Otherwise a fortified incursion is free territory and the supply sink never bites; `colony-supply-lines.md` already has the lane, the cargo and the ambush risk. |
| **W14** | Does the incursion window **end the fight**, or can the raider be trapped past it? | **It ends EXTRACTION, not the fight** — a force that stays becomes a forward base and can be besieged | Makes "fortify" a genuine choice with a real cost (a raider who stays can be caught), and needs no new clock. |
| **W15** | **What can a raider actually take?** | **Decide once, for the Chorus raid and the war raid: the ground (the tile/position changes hands, retakeable) plus the stores at that site at a published fraction — never account-level, hero-level or race-level assets** | The two raid systems must not disagree; retakeable keeps the no-softlock floor and the "a claim is scraps, not a jackpot" anti-abuse rule. |
| **W16** | Unify the offline-class decision (alert for an absent player + "who defends while the owner sleeps") | **The world defends** (rally + Covenant + reinforcement contribution) while **the owner's holdings degrade, never vanish** | Matches the ratified ratchet floor and the co-op-first framing; it is also the only version that is fair to a player who sleeps. |
| **W17** | Does the **voiced alert** speak the player's language while story voices stay English? | **Yes** | An alarm nobody understands is not an alarm — and the alarm is a device voice, not a character, so no performance is lost. |

### Calls raised by this document (not on the lead's list — flagged so nothing is smuggled)

| # | The call | Our recommendation | Why |
|---|---|---|---|
| **W18** | The **~24 h crossing** (his Forge direction) vs the **45 min–2 h lane** (`colony-supply-lines.md` §1.3): which is the war layer's number? | **Both, as two legs** (§11 C2) | They are the same journey at two scales; without the split the two docs contradict each other on the same object. |
| **W19** | What names a sector **out loud**? | **A number word per language during beta** (*"Sector Seven"*), with authored names as a later flavour pass; **never a digit glyph and never a raw id** | Numbers are unambiguous, cheap to translate and impossible to mispronounce identically in two languages; names are a flavour pass, not a dependency. |
| **W20** | May an invasion alarm **wake** a player (quiet hours), and is it opt-in? | **One explicit switch — "wake me for an invasion" — off unless he says otherwise**; everything else respects quiet hours | The one alarm worth a phone buzzing at 03:00 is an invasion; making every kind able to wake a player is how a world turns notifications off. |
| **W21** | Does the **Chorus raid at 100 % corruption** and the **war incursion** share one alarm surface and one notification kind? | **One surface, two sources** (a `DetectionEvent` has a `source`: `chorus` \| `war`) | One alarm the world learns to trust beats two alarms it has to tell apart — and it lets the **ratchet warning ship before the war does**, since the ratchet is the closer of the two. |

---

## §13 · What the engineer builds first, in order

**The smallest honest first slice is A — and it is deliberately not war.** The war cannot be built (A depends on nothing; E cannot start without a world store that does not exist). Each slice below is shippable alone, testable headless, and states what it does **not** claim.

### Slice A — The alarm surface, with its honesty contract
**Prerequisites: none.** Client-only; no war, no world store, no detection source required.
- One reusable **alarm component + sheet** (ribbon banner + sheet), fed by a `DetectionEvent`-shaped prop: `{sectorDesignationKey, firstSeenAt, source, choices}`.
- **Refuses to render a time without a real timestamp** (an assertion, not a comment); renders **UNKNOWN SIGNATURES**, the sector, *seen hh:mm*, and the two choices at 44 px / 48 px.
- `aria-live="assertive"` once; never colour-alone; 390 px safe-area correct; the sheet does not block the player's controls.
- **Wired to the one real event that exists today** so it is exercised honestly: the Chorus-attention crossing the ribbon already expresses (`ribbon.chorusAlert`, currently phrased at a percentage threshold). If the tier lookup from `chorus-ratchet.md` is not in code (that doc's implementation pointers say the 100 % consequence is *not* implemented), the slice wires to the published attention number and **says so** in its own copy.
- **Does not claim:** any detection, sector, radar or war exists.

### Slice B — The voiced seat and the spoken-designator gate
**Prerequisites: A.** Small, spec'd changes to shipped, working code.
- A new `alarm` direction row in `voice-direction.ts` (inside the shipped bands, not the reserved MACHINE class), staccato cadence, one-voice-safe.
- A **language-parameterised pool** (`canonicalPool()` currently filters to English) + a **per-language number-word table** (`numberToWords()` is English-only).
- The two new assertions: **no digit glyph in a spoken line**; **a language with no authored designation speaks the generic line** (never English words inside a Persian sentence).
- Lines filed per §6.6; **fa speaks only when the Persian text exists** — until then the visual carries it.
- **Does not claim:** any war. This seat is also the alarm for the Chorus ratchet, which is closer to shipping than the war.

### Slice C — The notification transport and its Settings row
**Prerequisites: none** (it ships with zero events wired, labelled honestly).
- The Settings row (§7.4) in the player's language, per-kind opt-in, with the "in-game alarm always works / phone push needs the installed app" distinction shown truthfully.
- Permission ask once, with a plain reason, never re-asked after a refusal.
- A push handler in `public/sw.js` — **and the `KEEP` list must not be touched**, so the translator's model cache is not evicted on the next publish (the WORKFLOW rule: never evict a durable player-side payload). State what happens to that cache in the PR.
- The **deep-link contract**: a notification opens world → sector → the choice.
- **Does not claim:** that any notification will ever fire — until a real event exists, the transport is wired and silent.

### Slice D — The sector vocabulary + the satellites, visible and unlinked (W4's beta promise)
**Prerequisites: A (for the honesty pattern), the five-language text for the new nouns.**
- "Sector" enters the vocabulary (ratified by the owner) and the Circuit gains a **coverage layer** reading **UNWATCHED** everywhere, with the reason stated (no linked net).
- A **"link the next satellite"** row on the Cradle — a build, with a real cost and time; **it earns nothing yet** and it produces **no alarm**: unlinked = inert, linked = a net with nothing to detect yet.
- **Does not claim:** detection, pairing, war. This is a visible promise with an honest state.

### Slice E — The detection event and the sector board (the first real war-Phase-1 work)
**Prerequisites: a world-level store** (it does not exist: `war/war-types.ts` says the world ledger arrives with war Phase 1), **plus** Slice A + B + the world pairing seeded on Reverb (ratified, unbuilt).
- `DetectionEvent` creation from a linked net, append-only, with `firstSeenAt`; the sector board with real ages; one world-level banner; a **headless pairing** until a second live world exists.
- **Does not claim:** that a Reverb number can be shown (it cannot — §0).

### Slice F — Rally, travel, contact, resolve
**Prerequisites: E + the battle engine ported to world scope + the zone/tile holder model** (`colony-supply-lines.md` §8's `HeldColony.tileId` — itself unbuilt) + the ratified `§13` link model.
- The rally sheet (W11's window, W12's visibility), marches in flight, the incursion window derived from B1 (clock C5), the three outcomes, and the forward base as a consequence of holding.

### Slice G — Raiding across the crossing
**Prerequisites: F + W15 answered + the supply lane feeding a forward base (W13).**
- Gear and troops ride the ~24 h crossing; a fortified incursion becomes a raidable, seizable forward base; everything taken is retakeable (W5).

**Sequencing note that must not be softened:** A, B, C and D are **scaffolding for things closer than the war** (the Chorus ratchet warning, the supply-run arrival, the app's notification plumbing) — and **not one of them means beta contains war.** Slice E is the first slice that needs the war's own world store to exist at all.

---

## §14 · Honest risks and limits of this document

- **R1 — The alarm's social load.** `[ours]` "Everyone gets a warning" is the design's best idea and its biggest operational risk: a world of 300–500 colonies can turn one incursion into a wall of noise. §4.6/§7.3 mitigate (one banner, coalesced notifications, opt-in kinds), but **nothing here has been playtested at that population**, and the honest mitigation is restraint, not another alarm.
- **R2 — Notification fatigue is the genre's disease** (`ui-benchmark-notes.md` §1.1: badge/dot storms are exactly what our own audience tolerates least). Five kinds is the cap; the moment a sixth "helpful" trigger appears, this feature has begun to fail.
- **R3 — Two hard dependencies are outside this layer:** the **Persian text for the new nouns and the alarm line** (§8.3) and the **per-player locale fix for timestamps** (§8.4 — today's `toLocaleString()` calls take no locale). Neither is ours to invent; both gate the Persian alarm.
- **R4 — The no-false-alarm rule costs counterplay.** `[ours]` Refusing fabricated signatures (decoys) makes the alarm trustworthy and removes a deception tool. **He may overrule it** — and if he does, the honesty contract must say on screen that a signature can be false, or the UI lies.
- **R5 — The satellites must not become a fake button.** W4's "visible but unlinked in beta" is only safe if the unlinked state is honestly inert and labelled. If we cannot show it inert, **don't show it** — a promise that does nothing when tapped is worse than waiting.
- **R6 — The intel tiers are uncalibrated.** The three bands (T1) and the scout's travel costs are **proposals**; the tier design is not testable until two worlds exist.
- **R7 — Nothing here is end-to-end testable yet.** A live pairing needs a **second live world** (the battle spec's own closing note: headless pairs until then), and the world-level ledger does not exist. Every "unbuilt" label in this document is that fact restated.
- **R8 — Reverb is ratified design with zero implementation, and the activity term has no source.** Pairing can be *described* today; it can be *displayed* only when the ledger exists. **No number may be printed in the meantime.**
- **R9 — This document is design-ahead and does not displace the beta gate.** The owner's gate for testers remains the **bundled translator plus the chat rooms**; the war layer's build order starts at A, and A is not war.

---

*Filed by the designer delegation, 2026-09-26. Owner input quoted from `/home/team/shared/war-layer-owner-input.md`; his five messages are the only text in this document that is his. Everything marked `[ours]` is a proposal, his to reject. Docs-only: no application code, no changes under `site/src`, no new gates. Outstanding for the lead: the W-table pass to the owner (§12, one word per row), the two flagged differences from the lead's draft (W7's band placement, W9's "no unit loss"), and the `design/` prose sweep that is not part of this task.*
