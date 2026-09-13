# Design Spec — Unbound Mentorship ("The Mentor's Lantern")

**Status:** design, integration-spec class · **Filed:** 2026-09-12 (owner direction, captured faithfully + permission layout by the lead, per owner delegation "you lay out what they are allowed to do"). **FULLY OWNER-RATIFIED 2026-09-12 — U1–U8 all decided (U3 owner-locked to one concurrent mentor world; U1/U2/U4–U8 ratified by owner approval).**
**Sources:** unbound-revelation-track.md (the live hidden track + `acknowledgedOnce` gate), business plan rev 16 (Unbound = earned 7th path, server-level traits, sealed worlds / earned bridges), battle-side-rvr-spec.md §1 (one race per server, six worlds), oracles-purity-layer.md, monetization.md §11 (earn-only discipline).

---

## §0 The owner's design, captured faithfully

*"When a person does gain Unbound there's one thing that I want to implement — it is very cool and this will make players stay once they make it, and be very, very, very important (why they want to get to it). Unbound players have the opportunity to join other servers that are up and coming and younger, and they are mentors to that server. They can help by way of getting certain key parts that make that server develop quicker. You lay out what they are allowed to do and how important it is that they be there. They still keep their home world, but they're allowed to go help in other servers if that server requests them. They can't just walk into any server — they have to have requested permissions; it's kind of like a captaincy."*

Design intent distilled: **Unbound status is not the end — it is the beginning of service.** The endgame that keeps a player after ascension is a *purpose*: being invited into a young world as its mentor. It is the Unbound thesis made systemic — the soul-path race doesn't conquer or hoard; it is *requested* and it *gives*.

## §1 The Mentor Seat — what "being there" means

- An Unbound player keeps their **home world colony fully intact** (unchanged — same colony, same war participation, same everything).
- A **Mentor Seat** (not a colony, not a second save) is opened on each **young world that requests them**: a small named presence — their name in the young world's Chronicle, a Mentor Pavilion on the world's Atlas, a seat on the young world's "Mentor's Lantern" board showing their mentor deed count. Client-side it renders as an optional tab on the young world (only visible to that world's players when a mentor is seated).
- **No new colony, no resources granted home, no war assets** — the Seat is a presence plus a bounded set of mentor actions (§3).

## §2 Captaincy — the invitation model

1. **The young world requests; the Unbound accepts.** *"They can't just walk into any server — they have to have requested permissions."* A world files a **Mentor Request** (one outstanding request at a time): filed by the young world's **recognized leadership** — its top contributors by the existing Contribution score (proposal: top-3 contributors or any Contribution-Award holder, matching the plan's "the recognized are the leadership class").
2. **Request is for a named Unbound.** The requester names the mentor (the Unbound's home world + name are public once they hold the earned path — ascension itself is visible as a world first, per the Unbound track's contribution-recognition; the *track* stays silent, the status is real).
3. **Acceptance is the Unbound's choice**, and it is opt-in and revocable: a mentor resigns or a young world dismisses (2 of top-3 contributors) — dismissal is public and consequential (see §5 betrayal rule).
4. **Caps (fairness + legibility):**
   - A young world may hold **1–2 active mentors** (design-flag U2; default 1, second unlocks once the world has been live long enough or holds enough active colonies — young worlds only, by the owner's frame).
   - An Unbound may mentor **only ONE young world at a time** (owner lock 2026-09-12 — one captaincy, entire focus; teaching spread thin teaches nothing).
   - Mentorship is **only into younger worlds** — operationalized: a world may request a mentor only until it reaches a maturity threshold (e.g., its first recorded war win or its charter of active colonies) — after that it's a peer, not a mentee. (Young = hasn't yet hit its first major world-milestone; published so players understand the window.)
5. **No payment, no purchase anywhere in the loop.** A request is a recognition act; acceptance is a service act. Money touches none of it (hard §5 line).

## §3 The permission table — what a mentor is allowed to do (owner-delegated layout)

**Principle: the mentor accelerates a young world's *development*, never its wars, never its ladder, never its Oracle trust.** Every mentor action is capped, tracked, public on the young world, and **earn-only** (nothing purchasable; the mentor's own ledger must have earned them the depth to help).

| # | Mentor action | What it does for the young world | Cap / constraints | Why it matters |
|---|---|---|---|---|
| M1 | **Gift Codices** (teach) | Grants codices to the young world's shared archive that the world hasn't yet earned — the scarcest early knowledge. | e.g. 3/world/week; only codices the young world's residents can actually study next (no dead-end gifts); every gift logged in the Chronicle. | Codices are *earned, not looted* — a mentor *earns them too* (from their own deep career) and *shares* them. The young world's research pace jumps. |
| M2 | **Mentor Insight (sponsor research)** | One young colony's research line gets a one-time progress grant ("the old hand's memory of the route") — pick the tech, not the outcome. | 1 colony/week/world; grant is bonus progress, never auto-complete; cannot be used on war-unlock tech lines until the world has earned them otherwise. | "Key parts that make that server develop quicker" — literally: the mentor unblocks the path, the colony still walks it. |
| M3 | **Craft the deep-run keys** | Mentors can forge and gift the bottleneck gear of a young world: hazmat suits, radiation shots, alloy-armed diggers (mats already earned, not purchased), plasma for early weapon builds. | Weekly gift cap per world (e.g. 4 items/week total); gifts are tracked, bounded, and **never sellable or tradable onward** (no smuggling — see §5). | The young world's deepest blocker is gear; the mentor's home depth makes gear cheap *for them* — they give the keys, not the answers. |
| M4 | **Purify assistance (Truce)** | On the young world's Truce day, a seated mentor can assist a young colony's earned cleansing rite — reducing the rite's cost/completion time — only where the young world's colony has ALREADY qualified (favor + Unbound progress + earned rite, per battle-side D5). | Mentor amplifies an earned act; **never grants the qualification itself**; 1 assist/week/world. | The two-key lock stays sacred — the mentor models purity, cannot buy or shortcut it. |
| M5 | **Chorus counter (surprise clear)** | When the young world rolls a Chorus surprise the residents can't yet handle, the mentor's presence can answer the call — a mentor-side counter that clears the event (the "it's very important that they BE there" beat). | Triggered only by the young world's own request/assist flow; 1/world/cycle; counts as the event's heroic resolution in the Chronicle. | This is the "how important is it that they be there" answer: sometimes the young world simply needs one experienced hand in the dark. |
| M6 | **Train the young** | Leader XP assist: one young colony's named Leaders get a bounded XP grant from the mentor's teaching. | 1 colony/week/world; respects the daily XP-cap discipline (same curve, same caps — never exceeds what the colony could earn; compresses time only). | The Leaders system is the colony's strategy spine; mentors teach the spine. |

**Hard prohibitions (the "what they are NOT allowed to do" half of the layout):**
1. **No war participation on the young world** — no ladder, no buckets, no captures, no sieges, no Cross Badges earned there, no Contribution score there (their score stays home). A mentor is a civilian in the young world's wars.
2. **No Oracle access through mentorship** — the Oracle introduction gate (first cross-server battle, "you touched their soil") is NOT bypassed by a Mentor Seat. The young world's Oracle only budges for the young world's own proven colonies. (An Unbound player still meets a foreign Oracle *only* by the earned war path, exactly like anyone else.)
3. **No territory, no FOBs, no holdings, no extraction rights** on the young world.
4. **No trade/economy smuggling** — mentor gifts are tracked, bounded, non-transferable onward; no materials-to-Embers arbitrage, no shipping mats home, no under-the-table deals between mentor worlds (the sealed-worlds principle stays: this is a *sanctioned service bridge*, the only personal crossing besides invasion, and it is watched).
5. **No purchases — ever.** No buyable mentorship, no buyable mentor favor, no buyable young-world development. This is arguably the purest earn-only surface in the game: a player cannot even *aim* at it with money, only with a clean career (G1–G4 unaffected — stronger).
6. **No spy/recon feeding** — a seated mentor sees the young world's public state (like any visitor) but holds no war rank there and none of its sensitive matchmaking/oracle internals; feeding home-world war intel is a betrayal-class offense (§5).

## §4 Why it is important that they be there — the retention engine

- **For the young world:** the mentor is the *advertisement for the endgame made flesh*. Its residents watch an ascended player *serve* — gifting codices, clearing the dark, teaching — and the lesson is the Unbound thesis: "the machine salvaged you piece by piece… the Unbound are the proof a soul can salvage itself back." A young world that hosts a mentor carries a visible, published **Mentor Presence** (Chronicle entries, Lantern board, the pavilion) that raises the ceiling on what its players believe is possible — retention by hope, not by drip.
- **For the mentor:** each young world is a *new game* — new players to teach, a new Chronicle to enter, and a new ledger: **Legacy** (mentor deeds accumulate into a Mentor's Lantern rank: Pavilion → Beacon → Lantern-Bearer, race-flavored; shown beside their name on their home world and on every world they have helped). The mentor's home world loses nothing and gains standing ("our Unbound light other worlds"). Purpose + status + variety = the "very very very important why they want to get to it."
- **For the game:** mentorship is the *positive* counterpart to war — the same cross-world plumbing (the war layer's first server-to-server channels) reused for creation instead of destruction; the Unbound path's anti-Chorus identity becomes *visible behavior*, not just flavor.

## §5 Earn-only & betrayal (hard lines, tested)

- **Nothing purchasable anywhere in the loop** (request, acceptance, actions, Legacy) — asserted by tests the way `assertCatalogFair` asserts the catalog; mentorship vocabulary is forbidden in the monetization catalog.
- **Betrayal is consequential** (oracles doc spine): a mentor caught in §3-prohibition violations (smuggling, spying, selling help) loses the Seat publicly, is barred from mentorship for a long cooldown (e.g. 3 seasons), AND the betrayal feeds their own world's Oracle-favor ledger negatively — the Unbound who betrays the trust of a young world is *still* watched by the Oracles of every world. Behavior is the mechanic.
- **Legacy is recognition, never a stat** — the Lantern ranks are prestige + Chronicle, zero engine effect (same rule as hero cosmetics / Contribution: recognition never leaks into war math).

## §6 Owner decisions (defaults marked ◆ — none ratified)

| # | Decision | Recommended default ◆ |
|---|---|---|
| **U1** | Mentor Seat model | Seat (presence + actions, no second colony) ◆ vs full second colony on the young world. Seat keeps "one colony per world, one home" clean and fits the owner's "they still keep their home world." — **✅ owner-ratified 2026-09-12** |
| **U2** | Mentors per young world | 1 ◆ (second allowed later once the world matures past a published threshold). — **✅ owner-ratified 2026-09-12** |
| **U3** | Concurrent mentor worlds per player | **1 — owner LOCKED 2026-09-12** (one captaincy at a time; cannot mentor multiple servers simultaneously). |
| **U4** | "Young world" definition | A world is mentor-eligible until its first major war milestone (first recorded war win) or its charter of active colonies passes a published count ◆; after that it mentors itself. — **✅ owner-ratified 2026-09-12** |
| **U5** | Request authority | Top-3 contributors by Contribution score, or any Contribution-Award holder ◆ (the plan's "recognized are the leadership class"). — **✅ owner-ratified 2026-09-12** |
| **U6** | Permission set | M1–M6 with the caps above ◆ (confirm each action + cap; the table is the "what they can do" layout the owner delegated). — **✅ owner-ratified 2026-09-12** |
| **U7** | Integrity rules | §3 prohibitions + §5 betrayal consequences ◆ — confirm the 3-season bar and the Oracle-favor penalty. — **✅ owner-ratified 2026-09-12** |
| **U8** | Sequencing | Build AFTER war Phase 1 plumbing (reuses server-to-server channels) ◆; needs multi-world accounts (already planned "one account can hold a colony per world"); young-world request surface rides the Atlas/war UI. — **✅ owner-ratified 2026-09-12** |

## §7 Sequencing & dependencies
- **Depends on:** multi-world accounts (per-plan), the Unbound earned path (LIVE), cross-world plumbing from the war layer, worlds actually existing (mentoring needs ≥2 worlds — the same second-world constraint as war live-testing).
- **Order:** war Phase 1 (builds the cross-server plumbing + second world) → mentorship v1 (Seat + invitation + M1–M6 with caps + Chronicle/Lantern visibility) → Legacy ranks later.
- **Headless testability:** invitation state machine, gift caps, prohibition assertions (no war score accrual by mentors, no sellable gifts), betrayal consequences — all pure-engine, testable before any second live world exists.

*Filed by team lead from owner direction 2026-09-12. **Design fully cleared by owner 2026-09-12 (U1–U8).** Nothing built yet — sequenced after war Phase 1 (needs cross-server plumbing + a second world); headless-testable state machine frees it from that constraint.*