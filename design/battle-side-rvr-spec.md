# Battle-side Design Spec — Atlantis-style Server-vs-Server Territory War ("The RvR Layer")

**Author:** researcher delegation · **Date:** 2026-09-12 · **Status:** design spec, ready for build scoping; **not owner-ratified** (owner decisions D1–D6 in §11)
**Sources synthesized:** `battle-side-rvr-research.md` (8 recommendations), `oracles-purity-layer.md`, `monetization.md`, `unbound-revelation-track.md` (incl. §9 implementation log), plus codeground: `site/src/game/{engine.ts, types.ts, api.ts, store.ts, leader-xp.ts, research.ts, zones.ts, races.ts}`.
**Framing per business plan:** war layer ships "after core is solid"; this spec is the build doc for that layer. No numbers in this spec are results — everything is a design default flagged for the owner in §11.

---

## §1 Frame & Identity

**One race per server = one nation.** Each live server is a single race-locked world (business-plan architecture); in the war layer that world's colonies *are* the nation. The Shatterlands + Cradle are that world's home ground. War identity is **world-level**: scoreboards, History Book, and recaps speak in world names ("The Watchers hold the burn"), never in server-bucket numbers — the lesson from the research is that Evony/Whiteout "matchmaking-bucket servers" manufacture no pride, while a *named world with a recorded history* does (GW2 pre-restructuring, DAoC realms, Eve blocs).

**War pairs rotate across the six worlds — no fixed rivalries.** The research flag: one-race-per-server is a six-way population split; fixed rivalries would concentrate it. Design:
- A **war cycle** pairs two worlds for one war week. Of the 15 possible pairings, the scheduler picks pairs so that (a) no two worlds meet twice within a season, (b) every world gets a rest week between war weeks, (c) every world fights more than once per season while population permits.
- Sequence is published ahead (next 2 pairings always visible) so worlds can prep and communities can drum up attendance — same retention technology as CoC CWL's visible ladder.

**Activity-floor opt-out ("the world holds its border").** If a world's activity + power composite (§4.4) falls below a published floor (owner-decision D4), the scheduler does not pair it that week: the world "holds its border" — lore-diegetic (the colony garrisons stay home; the frontier goes quiet), zero penalty, no steamroll-into-uninstall. This is the direct answer to DAoC/WAR realm-death and GW2 Restructuring grief: an identity is worth protecting even when its population dips.

**Account/colony per world.** One account may hold one colony per world (six at most, across servers; current beta `MAX_GAMES = 5` is the same per-account multi-game mechanism, one per world as worlds open). Colonies on different worlds under one account are separate actors — no cross-account transfer of currencies, war supply, or resources of any kind (monetization.md §1.4: the ledger has no cross-account path). War energy and participation are per-colony, never pooled.

**What the war is fought over (lore-safe).** Invading a world means touching *their soil* — the enemy world's frontier zones of the Shatterlands become contestable. The existing engine already models this: `Zone.owner: RaceId | "shared" | "special"` and per-race `mats: Record<RaceId, number>` ("per-race territory materials … gathered by raiding other races' home regions") are precursor hooks. The battleground of a war week = a revealed set of the two worlds' frontier zones (published at Gearing).

---

## §2 First Breach — the scripted Oracle introduction event

*Recommendation 1, integrated with oracles-purity-layer.md §3 (locked: "Oracles are met only after your first cross-server battle … that is the only door").*

**What the event is.** The first war week between any two worlds that have never warred runs as a **First Breach** week — a world-historical first with scripted stakes and a guaranteed Oracle meeting. Purpose: protect lore-critical first contact from being a beginner-trap. The Oracle door must never be missable, raid-dependent, or score-dependent.

**Trigger — the first colony of EACH side standing on the other's territory. Not the score.** Concretely:
- Any colony's march that resolves an engagement **on enemy-held soil** (a squad landing in a contested enemy frontier zone) is a **breach**.
- The event begins for both sides once **each** side has had at least one breach (a one-sided week still completes it — losing side included; that is the point).
- The breach *is* the locked "first cross-server battle": Emissaries only communicate, armies physically cross — so a breach is the only physical touch, hence the only door. This is the reconciliation with the locked lore.

**The first Sunday — outcome-independent.** On the Truce day (Day 7) of the First Breach week, the **First Oracle Night** fires for **every colony that breached, win or lose**: the world's Oracle appears (amused, joker-toned — "you came to take what we keep; we find that funny"), speaks the introduction riddle-poem, and the colony's Oracle state flips from `none` to `met`. Colonies that did not breach receive a world Chronicle line referencing the breach (they meet their own Oracle at their own first breach — the gate is per-colony and never missable; a late joiner breaches in a later week and gets their introduction at that week's Truce).

**"Dominance opens the conversation" stays the post-first-contact gate.** Meeting ≠ help:
- Per-colony Oracle state: `attention: "silent" | "watching" | "engaged"`. Introduction sets `watching` — the Oracle is *aware* of the colony, will not yet answer.
- **Watching → engaged** happens only by a server-measured dominance deed in war: a published threshold of war contribution, a capture, a purification assist, or a hero feat — *power earns the meeting of minds*; purity and qualification earn favor (oracles doc §3, §4).
- **Velocity accelerates**: the doc's "velocity of aggression" rule means a colony that breaches early and keeps marching moves up the attention ladder faster — notice is earned by deliberate, aggressive play, never by spend (§11–none of this has a purchase path).

**Ledger integration.** Breaches, the First Oracle Night, and every attention transition append to the war ledger (→ History Book "firsts" → Contribution Award input). The rv3-ack / `acknowledgedOnce` machinery (unbound doc §8–9) already proves the pattern for server-side-only gates that the client never sees until they fire.

---

## §3 Weekly arc — the 7-day engine (aggression and purity as one turbine)

*Recommendation 2. Default: war week = Monday 00:00 UTC → Sunday 23:59 UTC (owner decision D1 on cadence/start).*

| Day | Phase | What happens | Scoring |
|---|---|---|---|
| 1–2 | **Gearing** | The PvE loop feeds the war. `convertToWarSupply` actions ship expedition output to the front (100 Embers → 1 war supply, ratio published per week; supplies/fuel also convert at published rates). Squad selection opens; next objectives preview posted; last week's Truce cooldown clears. | Participation-earning, no ladder score |
| 3–5 | **Campaign** | Ladder scoring live with a **rotating daily objective** (fixed calendar, published at Gearing): Day 3 **Hold the Keeps** (control points), Day 4 **Purify the Zone** (purification/cleansing of a targeted contested zone), Day 5 **Protect the Supply Lanes** (escort/convoy defense) or **Shield an Ally** (co-op defense assist). Today's objective scores at ×1.25 (compounds with comeback multipliers, §4). | Bucket scoring (§4) |
| 6 | **Climax** | **The 2-hour golden window — double points.** Announced 24h ahead (during Day 5) with the exact start. A broadcastable live ticker (read API, §7); the week can flip here. | ×2 all contributions in window |
| 7 | **Truce** | **No scoring.** Oracle/devotion stage: **Riddle day** (the Oracle poses the week's riddle — answering earns Devotion + favor, oracles doc §6), **Cleansing window** (below), **Emissary declarations** for next week (call-to-action, focus calls, truce proposals, §6), next pair + objectives preview. | None |

**War week raises Chorus attention server-wide; Truce day is when cleansing must happen — the turbine.** This is the oracle doc's engine: *Total Completion raises the Chorus's hunt; continuous cleansing, granted by the Oracles, is the only way to keep the march viable* (oracles doc §1), and *Oracle-favored colonies purify contested zones* (§5). Concrete mechanics:
- During a war week, every participating colony accrues `chorusAttention` faster (war participation adds a published per-action attention rise on top of the existing economy) **and** the world runs a server-wide attention multiplier while a war is active.
- **Truce day** opens a **Cleansing window**: a colony with Oracle favor (earned — purity, riddles, Devotion; never bought) can cleanse, trimming its accrued attention. Un-cleansed attention carries into the next week as a decaying residual — the Chorus remembers the aggression the colony doesn't purge. Cleansing only exists on Truce day; the war week's aggression must be paid for in purity before the next march.
- **Purified zones locally slow the ramp** (§5) — so the same turbine has a second, collective escape: a world that purifies ground reduces the server-wide hunting pressure it created by fighting. Aggression spins the Chorus; purity — individual (cleansing) and collective (purified zones) — is the counterweight. Same week, same colony, both acts: that is the turbine design in one sentence.

**Comedown is retention technology, not dead time** (Foxhole/WAR lesson): the Truce stage's riddle + cleansing + declarations + recap reading is the ritual slot — the research-verified "rituals" pillar of real pride.

---

## §4 Scoring & fairness math

*Recommendation 3 + Clash Royale floors/streaks (research §Q3).*

**4.1 GW2-style 2-hour skirmish buckets.** The Campaign + Climax phases score in **2-hour buckets** (84 campaign buckets + 1 climax window per week). Each bucket: both sides' contributions tick their bucket total; the side with the higher bucket total wins the bucket and takes **1 ladder point** (0.5 split on a tie). The week result = sum of bucket points; margin (bucket-point delta + total-contribution delta) recorded for tie-breaking and matching. Why: the single most borrowable fairness mechanic in the genre (GW2 WvW official scoring) — no timezone owns the night, no night-capping decides weeks, every bucket weighs equally.

**4.2 Comeback multipliers (the steamroll valve).** While a side is **>25% down on the week total**, that side's *published* multipliers apply — **only on PvE-adjacent contributions: purifications, supply hauls, shield assists. Never on direct kills, never purchasable, computed server-side from the ledger.** Proposed curve (owner D3): >25% down → ×1.25; >40% down → ×1.5 on those contribution types (bucket score *and* Contribution score alike). Rationale: the trailing side stops playing a losing fight and plays a *different game* that still feeds the ladder — logistics and purity instead of offense — which (a) keeps them engaged (the mid-week participation-kill identified in research §Q3.4), (b) is structural rather than charitable (they must actually do the work), and (c) is money-proof: no purchase input exists in any scored contribution. Cap note: multipliers can make the trailing side competitive; they cannot make a week swing on their own (buckets are still won by total contribution).

**4.3 League floors & streaks (Clash Royale lesson: floors + streaks + visible rank feel fair even to losers).** The **season ladder** tracks worlds across cycles (win/loss + margin + tier):
- **Tier floors**: a world can drop at most **one tier per season per war result** — one catastrophic week cannot cascade-demote a world whose season body of work was solid.
- **Momentum streaks**: consecutive weekly wins grant a published *participation-reward* bonus (cosmetic/prestige track, never ladder score — score stays a pure measure of the week's ledger). Consecutive losses similarly keep participation rewards flowing (bounded), so *losing weeks still pay participation* — the explicit answer to CoC CWL's "the 80% who sit out feel the ladder isn't for them" (research §Q3.2).
- Ladder display is always rank + margin + streak, never a bare top-score table (rich-get-richer reading, research §Q3.3).

**4.4 What this means for the weekly ladder and the Contribution Award.** The per-week ladder = the pair's bucket result; the season ladder = standings across the six worlds. **All numbers come from one objective source: the war ledger** (append-only, server-side) — the same ledger that feeds the History Book (§7) and the **Contribution Award** (oracles doc §10): the award per server per cycle is computed from the exact same objective contribution metrics (purifications, hauls, shields, deeds, firsts, war contribution) — never spend, never votes (monetization doc §5.1). War weeks are where the biggest dents happen; the award is the recognition those dents are owed. Matching seeds on an **activity + power composite** (activity = logins/actions/expedition completions over the last 7 days; power = earned colony progression — server-computed, no spend input; owner sees the formula in §9), never pure power.

---

## §5 Zone-state map — Corrupted / Contested / Purified

*Recommendation 4. Purify is a WIN, not a denial.*

**5.1 States.** Every contestable frontier zone sits in one of three states:
- **Corrupted** — baseline. The Chorus-riddled frontier; both sides fight the hive and each other. Enemy score tick from it: normal; extraction: open.
- **Contested** — active fight. The holder ticks score; hauls from the zone go to the holder; a capture flips control (capture = the normal world's war action).
- **Purified** — an Oracle-rite zone (below). Effects, all of which are *wins*: (a) **stops enemy score tick** in that zone; (b) **denies enemy extraction** (no hauls while purified); (c) **locally slows the Chorus hunting ramp** — each purified zone subtracts from the server-wide attention multiplier of §3, tying the map directly to Total Completion pressure; (d) **purification itself grants ladder + contribution score** at published parity (§5.3).

**5.2 Guardrails (anti-abuse, all enforced server-side):**
- **Costs expedition resources**: a purification burns a published per-zone cost in Embers + Supplies + fuel (real expedition output — the war economy is the PvE economy, no new currency).
- **Interruptible**: purifying is a channeled rite with a duration window; enemy counter-action breaks the channel (entosis tug-of-war lesson: fun-minute-for-fun-minute — a purify is a live moment with counterplay, not a background tick). The purifier must hold the zone.
- **24h re-purify lockout**: a colonist/world that purified a zone cannot purify that zone again for 24h — no flip-spam.
- **Re-corruption floor**: a purified zone cannot be re-corrupted for a minimum window (default 12h, owner-tunable); during the floor it can only be *contested*, attacking the purifying side's hold — attacking a purified zone is a visible, winnable fight, never a silent revert.
- Purification activity counts toward the Contribution Award and History Book "firsts" (first purify of a cycle, purify count).

**5.3 Unbound worlds compete on the same ladder — published parity.** An Unbound world's war kit is asymmetry-by-identity (§Q5.5 rules: same shared score, equal fun-per-minute, interruptible, invested, and *winning*): its **purify ticks, shield assists, and enemy-stamina grind** convert to ladder score at **published parity rates** (e.g., a Purify tick score = the Capture-tick score equivalent; a shield assist = the escort-completion equivalent; the stamina grind's denial value converts at the published denial rate). One ladder, one table, the same numbers for every pairing — visible in the war rules UI, so an Unbound world's "different" kit is never an algorithmic advantage and never a surprise.

**5.4 The purify tool is earned-only — nobody picks the asymmetric side.** Purification requires a **two-key earned lock**:
1. **Oracle favor** (trust: Codices carried, clean recoveries, declined corrupting finds, shielded allies, riddles answered — all earned; the Oracle grants the rite), **and**
2. **Unbound silent-reveal progress** — the rite sits on the existing hidden track (unbound doc §8–9): `acknowledgedOnce` (= contribution score crossing the server threshold — already live) and revelation progress; silence discipline holds exactly: no UI, no tooltip, no purchase path, the client learns nothing until availability changes (the `publicState()` strip pattern, unbound doc §5.2).
- **World-level posture**: an "Unbound world" (business-plan server-level trait) is earned collectively when its colonies cross the silent thresholds (world milestone, owner-confirm D5); it then fields the purification kit wholesale on the parity ladder. Nobody selects it, buys it, or sees it coming — the track is a discovery, same as the revelation track.

---

## §6 War Council — the Emissary layer made visible

*Recommendation 5 — the genre's missing stakes: diplomacy with a recorded word.*

**Seats.** Each world holds **Emissary seats** for the colonies that are both **Oracle-trusted** (favor ≥ published threshold) **and contribution-recognized** (top Contribution scores / the Contribution Award) — the plan's leadership class: "the recognized are the leadership class." Seat cap 3–7 per world (owner-tunable); one **Speaker** seat = highest contribution.

**War Council UI + server-side ledger** (`councilLedger`, append-only, immutable, timestamped):
- **Pre-war declarations** — announce intent before a cycle ("we march at Dawn 4").
- **Focus calls** — during campaign: "all hands on the East Purge this bucket"; posted to the world's fight feed.
- **Truce proposals** — cross-world: the Council of one world proposes a truce window to the other; **acceptance pauses scoring for the agreed window** (engine-enforced). This is the only diplomatic channel that touches the engine — everything else is honor.
- **After-action statements** — post-week statements appended to the week's recap (feeds the History Book's personality: Eve-style narration, research §Q4.3).

**Broken truces cost Oracle favor — like betrayal.** Cite oracles doc §4: "Betrayal is consequential: court corruption or feed their knowledge to AI power and favor falls; the Oracle withdraws." A truce is a vow in the Oracle's hearing: breaking it (scoring inside the window, or violating stated terms) is betrayal — the proposing Emissary and participating colonies **lose favor**; repeat betrayal moves toward Oracle withdrawal. Honored truces accumulate the opposite — favor and trust.

**Diplomacy costs trust, not gold.** No currency, no passes, no purchase anywhere in the Council. Declarations/truces require favor standing only. The trust the plan locks ("earned, never bought") is the entire economy of this layer.

---

## §7 History Book & public stats

*Recommendation 6 — pride is narration + records (zkillboard/foxholestats precedent).*

- **History Book**: a server-maintained war recap ledger — per cycle: pairing, result, margin, bucket graph, **firsts** (first breach, first purify, first comeback), comeback entries, hero feats, purify counts, and a **named recap line** ("the Burn of Cycle 12") written from the ledger by the server; after-action statements (§6) append.
- **Public read APIs / exports** (zkillboard-style): per-world progress, per-colony war record (marches, purifies, hauls, shields, hero feats, firsts), full skirmish-bucket history, and a **live broadcast feed** for the Climax window — so fan sites, streamers, and the wiki render the war from first-party data. Historical JSON export per cycle. Per-colony stats respect an account opt-out flag ("public stats off"); world recaps are always public.
- **One source of truth**: History Book, the ladder, comeback multipliers, and the **Contribution Award** all compute from the same append-only **war ledger**. No second bookkeeping, no divergence between what recaps claim and what the award measures.

---

## §8 Heroes as the war unit layer

*Recommendation 7, respecting the heroes framework in the business plan (earned, deterministic, never random, never bought; race-bound rosters; squad rotation). Full framework: see `design/heroes-design-brief.md` (filed 2026-09-12).*

**Squad defines the loadout.** Each colony fields **3–5 active Heroes** (of its own race's roster, or an earned other-race hero via invasion/Oracle trust/Emissary trade) for the war week. The squad's skills **are** the war loadout:
- **Marches** (attacks, captures, escorts) are squad actions resolving over real time on the contested map — persistent-world style, runnable while offline, `resolveExpedition`-like lazy resolution.
- Combat is **decision moments, not APM** (research §Q2.4): the player's inputs per fight are consequential micro-decisions — squad composition, which skill to time, purify-vs-claim choice — everything else resolves with spectacle. This is the position that fits the colony-sim audience and structurally avoids the "stat check with animations" trap (§Q2.3).
- Heroes reuse the **proven XP curve** (level = √(xp/50), daily XP cap pattern from `leader-xp.ts`, **L3 one-time specialization** — the existing `scholar | marshal | quartermaster` paths, war-flavored effects).

**Per-week hero energy cap — the server-side fairness valve (a cap, not a shop).** Each Hero has a **weekly energy pool** (e.g., 60/wk); each march costs 10–20 by action type; a **daily march-count cap** per colony (default 8/day) prevents burst-burning the week in one session. The pool resets at the war week boundary. **Non-extendable by purchase — no energy items, no refill packs, no "extra march" pass, ever** (this is a hard §9 rule, bound at the engine constant level: the pool is a `const` like `DAILY_XP_CAP`/`leaderXpCaps` day ledgers — there is no field a purchase could write). Rationale: a fairness valve against no-life grind *and* whale stamina alike — the same cap, server-enforced, invisible to money.

**Participation is never alliance-gated.** Colonies with no Heroes (or a squad too small to march offensively) contribute war-relevant outputs with zero roster requirement: **supply hauling** (the Gearing loop runs on expedition output, not heroes), **purification assists** (shielding a purifier's channel), and **defensive shields**. All of it scores, all of it feeds the Contribution Award, all of it works in a losing week (per §4.3 participation point). Heroes are the *offensive* unit layer; they are never the *requirement* for being in the war.

**Deterministic earn-by-deed.** Heroes join by server-measured deed/first or Oracle vouching (the Oracle trusts a champion) — same mechanism discipline as deed cosmetics D1–D7 (monetization §2.2) and `awardDeed` in the engine. No gacha, no shards, no purchasable hero power anywhere (monetization §5 lines: "no hero shards/artifacts", "hero power never for sale").

---

## §9 Never-copy list & monetization boundary (hardened spec text)

*Recommendation 8 + monetization.md §5 guardrails, restated as war-layer binding constraints. Anything that looks like a row below goes to the owner before shipping — same rule as monetization §5.*

**9.1 Nothing purchasable during scored windows — exhaustive list:**
1. **No stat boosts** — no purchasable combat/economy/yield multipliers, no temporary power of any kind.
2. **No speed-ups** — in a scored ladder a speed-up *is* a score advantage; expedition/research/crafting timers stay time-only (monetization §5 "skip-timers").
3. **No war resources** — no purchasable war supply, Embers, fuel, or supplies that feed marches/caravans (pack supply grants stay capped per monetization §3.3 and are PvE-framed; they are never spendable into war supply above the earnable curve — a published cap, owner D6).
4. **No repair/heal monetization** — the research-verified most-loathed pattern ("defeat is a purchase prompt"); repair/heal is time + resources only.
5. **No hero power** — no XP, attributes, specializations, energy, or squad slots for sale.
6. **No stat-bearing cosmetics** — every cosmetic grants zero engine effect (monetization §2 hard rule).
7. **No power-bearing passes** — pass tracks grant cosmetics/participation-rewards only; pass objectives are participation-based, never score-based, so buying a pass changes nothing about who wins the week.
8. **No premium conversion** — Votives never convert to Scrip or any war input (monetization §1.3).

**9.2 Structural never-copies (p2w-adjacent structure):**
- (a) **No pure-power server matching** — seed on the published activity + power composite (§4.4); owner sees the formula; spend contributes zero to either term.
- (b) **No permanent war** — recurring scheduled weeks with Truce day and the activity-floor opt-out (§1); indefinite wars bleed players (Eve/WAR evidence).
- (c) **No alliance-only participation** — every contribution form is open to solo colonies (§8).
- (d) **No whale shortcuts to ladder position** — ladder result not purchasable by design: every scored input is a money-proof, server-verified ledger event; there is no purchasable object the ladder can read.

**9.3 The deliberate gray zone — the war-season battle pass.** Per monetization §4.4, the war-season pass ports the 28-tier skeleton. **Paid track is STRICTLY cosmetic: banner kits, sigil frames, and Votives/Scrip-neutral trinkets only.** This is flagged deliberately as the gray zone, with the **exact rule**: *a paid-track item is legal iff removing it from the game changes zero engine outputs — no score, no speed, no stamina, no chance, no capacity.* No "war convenience" (queue slots, extra marches, energy, teleports) enters the paid track — that fails the rule and the (a)–(d) list. Banner kits and sigil frames render in war scenes for purchased flair; the war engine never reads any pass item in any calculation. FOMO guardrails from monetization §4.1–4.3 apply unchanged (passes never expire; unclaimed items return; no tier skips sold).

---

## §10 Integration sketch — what the Battle side needs from the engine

**10.1 Architecture facts it plugs into (verified in code):**
- Engine is **pure, lazy-advance, event-sourced**: `engine.advance(state, now)` rolls `lastTick → now`, resolving expeditions/studies/revelations offline. All earn events are engine-generated; the client never owns values; `publicState()` strips server secrets (the unbound-track pattern is the template for every war-secret).
- Persistence is per-account files (`store.ts`: `data/accounts.json`, `data/sessions.json`, `data/saves/<id>.json` with `AccountSaves { games: {gameId: GameState} }`). **War state is world-level, not per-account — it needs a new store file** (below).
- Precedent mechanisms to reuse: `leaderXpCaps`/`xpDayKey` UTC day-ledger (→ hero energy ledger), `contributionScore()` + `acknowledgedOnce` (already live; → war contributions extend it), `Zone.owner` (→ contestable frontier definition), `resources.mats[RaceId]` (→ cross-race territory rewards already exist), `deedsCompleted`/`awardDeed` (→ hero deeds), `getZone`/`ZONES` (→ battlefield zones).

**10.2 New engine state.**
*World-level (new `data/world-<id>.json`, one per server; beta = the one watchers world):*
```
WarWorld {
  cycleId; phase: "gearing"|"campaign"|"climax"|"truce"|"borderHold"|"between";
  pairings: [{opponentWorld, start, state}]; dailyObjectives: cycleId→day→objective;
  goldenWindow: {start, end, announcedAt};
  zoneStates: Record<zoneId, {state: corrupted|contested|purified, since, holder, lastPurify, reCorruptAfter}>;
  skirmishScores: Record<bucketKey, {a, b}>; weekTotals; seasonLadder: [{world, tier, wins, losses, margin, streak}];
  comebackRules: {thresholdPct, multiplier}; activityComposite: Record<world, number>;
  councilLedger: CouncilEntry[]; historyBook: RecapEntry[]; warLedger: WarEvent[];  // append-only
  oracleRoster: Record<colonyId, {met, attention, favor, devotion, cleansedCycle}>;  // server-side
}
```
*Per-colony (game.ts `GameState`, extended; war-sensitive fields stripped by `publicState()` like revelation fields):*
```
heroes: Hero[]  // {id, name, xp, unspentPoints, specialization, earnedBy (deedId), energyWeek: {cycleId, spent}}
heroSquad: string[]            // 3–5 ids, validated server-side
warSupply: number              // converted from Embers (published ratio)
warEnergyLedger: {day, marches} // daily march cap + weekly pool, engine constants only
oracle: {met, attention, favor, devotion}   // STRIPPED — see publicState
purifyRite: boolean            // earned only — STRIPPED until earned
warFlags: {breached, firstOracleNightCycle}  // STRIPPED-until-fired pattern
```
*Engine constants:* `BUCKET_MS = 2h`, `COMEBACK_THRESHOLD = 0.25`, multiplier steps, `WAR_ENERGY_WEEK = 60`, `DAILY_MARCH_CAP = 8`, purity cost table, parity table (published), `ACTIVITY_FLOOR` (owner D4), `RE_PURIFY_LOCKOUT = 24h`, `RE_CORRUPT_FLOOR = 12h`.

**10.3 New API surface (`api.ts`, `createServerFn` pattern):**
- `getWarState` (public slice only — bucket scores, objectives, window, zone states, ladder), `marchFn`, `convertToWarSupplyFn`, `purifyFn` (starts/channels the rite), `shieldFn` (defensive assist), `councilFn` (declare/focus/truce/statement — appends to ledger, validates favor), `getHistoryBook(cycleId)`, `getLadder`, `exportWarStats(cycleId)` (JSON), `getBroadcastFeed` (climax ticker). Matching runs server-side at cycle scheduling (`scheduleCycle` in a new war module).
- **Hooks:** new pure module `src/game/war/` (`war-types.ts`, `war-engine.ts` — pure like engine.ts — `matching.ts`, `history.ts`); `advance()` gains a war-context parameter or a parallel `advanceWar(world, now)` called from the API layer (server calls both; engine purity preserved — tests run headless against fabricated worlds, same as revelation-harness precedent). Per-colony war effects (attention ramp, energy reset, oracle transitions) fold into `advance()` as idempotent reconcile steps (`reconcileWarVisibility`-style, unbound doc §9.2 pattern). `publicState()` strip list extends with `oracle`, `purifyRite`, `warFlags`, energy internals.

**10.4 Phased build order.**
- **Already-live precursor infrastructure (per plan: "the war layer after core is solid" — these are the war's foundations, mostly built):** expeditions/economy (the war's only economy — fuel for war supply), `contributionScore` + `acknowledgedOnce` (the Contribution Award's score can ship on the beta world *now* as a contribution score per plan and oracles doc §10), multi-game accounts + reset (colony-per-world mechanism), race-lock debug world, `mats`/`Zone.owner` cross-race fields.
- **Phase 1 (the Battle side itself):** war cycle state machine + scheduling/matching (with activity floor), zone-state map + captures, skirmish buckets + comeback multipliers + season ladder (floors/streaks), Gearing supply-haul loop, campaign daily objectives, Climax window + broadcast endpoints, Truce stage v1 (no-scoring + cleansing window skeleton + attention ramp), First Breach event v1 (breach detection + first-Oracle-Night beats), History Book v1 (recap ledger + read APIs), War Council v1 (declarations/focus/truce/statements + ledger), Hero frame (roster, XP curve reuse, squad, energy cap + daily cap).
- **Phase 2 (post-battle-side):** purify rite + Unbound world posture (waits on oracle favor layer + revelation track maturity), full Council cross-world diplomacy channel, Oracle Devotion ↔ war integration (riddle day, cleansing), battle pass Season port (monetization §4.4 — incl. the §9.3 gray-zone rule), real-time action visual upgrade (owner-2026-09-05 direction; funded by monetization, never rolls back the fairness model).

---

## §12 Forward Base & troop deployment (owner direction 2026-09-12 — working section, feeds §3 Gearing and D1 cadence)

**Owner's design, captured faithfully:** *"Once you land on the [enemy] server/world you have to build a forward base in order to bring your troops in, and that forward base can have capabilities to build more troops; depending on how advanced your forward base is, the more powerful troops you can build. It should take 8–10 hours real time to build your base to its full potential, depending on the resources that you've already gathered from your home. This is why it's a week-long [war] — you have to have time to build this and implement your troops over. You have a bunch of troops you can ship from your home base, but who's to say that's enough to actually do what you have to do."*

**The mechanic (integrated):**
1. **Landing = the Breach (§2).** A colony standing on enemy soil (first breach of the week) establishes a **Forward Base (FOB)** — the staging ground that receives and musters troops. The FOB is the colony's presence on the contested map; lose it and you are pushed off the zone (zone-state → contested, §5).
2. **FOB construction chain.** The FOB advances through stages (default 4, design-flag FB1), each stage a real-time build resolved offline like expeditions (persistent-world rule). **Full potential = ~8–10h real time total** (design-flag FB2) — the Gearing window exists precisely for this: land Day 1, FOB complete by Day 2 evening, muster/produce Days 2–5, Climax Day 6, Truce Day 7. The week-long cadence is *the logistics arc*, not a scheduling choice — owner's rationale confirmed by the research (Foxhole: wars are won logistically; GW2: week cadence keeps identity).
3. **Advancement consumes shipped resources.** FOB stages are gated by resources **already gathered at home and shipped** (war supply, fuel, plasma at higher stages; weapons ship as troop kits). Shortfall = the FOB stalls at a lower stage — "depending on the resources you've already gathered." Stockpiling at home during Gearing (expedition economy → war supply conversion, battle-side §3) is the precondition; this is the "gathering up resources to go to battle" loop made concrete.
4. **Troop production & power ceiling.** A finite home force ships with the colony (prepped during Gearing). The **FOB stage sets the power ceiling for on-site production**: Foundry stage → tier-1/2 troops, Arsenal stage → tier-3, full Citadel → tier-4 + siege assembly. Troop quality derives from the **weapons system** (`weapons-system.md`: 5 families × 4 tiers per race) — a troop's kit is its family+tier, so home-built weapons directly determine what your landing force and FOB-built units can field. "You have a bunch of troops you can ship from home — but who's to say that's enough": the expeditionary force is deliberately finite; the FOB is the answer, tier-gated by its own advancement.
5. **Heroes lead troops (§8).** Troops are the rank-and-file; they march under hero squads (squad = the war loadout; heroes earnable/deterministic as specced). Troop counts are supply-weighted (marching/fielding consumes war supply + energy per the §8 caps — caps remain a cap, never a shop). This keeps "troops" as the mass layer and Heroes as the character layer, exactly per the plan's framing.

**Design flags (owner decision — same class as D1–D6, confirm or tune):**
- **FB1 — FOB stage count & names:** default 4 (Landing Pad → Garrison → Foundry → Arsenal/Citadel); race-flavored naming later. — **✅ owner-ratified 2026-09-12**
- **FB2 — Construction timing:** full potential 8–10h real time total, offline-resolved; per-stage split default (1h / 2h / 3h / 3h). — **✅ owner-ratified 2026-09-12**
- **FB3 — Resource gating:** which shipped resources gate which stage (proposal: supplies+fuel for early, plasma for late; weapons ship as kits priced in supplies). — **✅ owner-ratified 2026-09-12**
- **FB4 — Troop definition:** confirm the rank-and-file-under-hero-squads model (as above) vs any other intent; troop tiers = weapon-kit tiers (5 families × 4 tiers). — **✅ owner-ratified 2026-09-12**
- **FB5 — Home force size:** the finite expeditionary force — how it's prepped (war supply + weapons at home during Gearing) and the published cap that "who's to say that's enough" makes meaningful. — **✅ owner-ratified 2026-09-12**

---

## §13 Territory accessibility — roads & contiguity (owner direction 2026-09-12 · working section, feeds §5 zone-states and the world-map design)

**Owner's design, captured faithfully:** *"In order to get to territories of importance, the territories previous to that — in between your base and that important territory — you have to be able to take those other territories in between. Any adjacent territory is accessible by roads — not all of them have roads to it, not all of them have accessibility, but they all have to be linked in some way."*

**The mechanic (integrated):**
1. **Conquest is contiguous — no leapfrogging.** Control spreads along links from the FOB (§12), not by map adjacency alone. To reach an important territory you must take the chain of territories between it and your base — the in-between territories are strategically vital precisely because they gate access. This is what makes the "keep or take" pressure real for mid-value territory: it is the road to richer ground.
2. **Accessibility = a link, not adjacency.** Territories connect via **links**; adjacency without a link is impassable. **Roads** are the standard link (fast marches, fast supply). **Not all territories have roads** — some are reachable only by roadless links: ruin-passes, tunnels/warrens (Draconian), cairn-roads (Nephilim), flying approaches (Anunnaki mega-ramps), lantern-lanes (Pleiadians), spliced archives (Grays) — race-flavored ways, slower or riskier than roads.
3. **The network is connected.** Every territory has at least one path to the world — "they all have to be linked in some way." A territory can be rich but *hard to hold* because its only links are roadless; accessibility and value are separate axes, and both are visible on the map.
4. **Supply runs on controlled links.** Supply lanes (§3, §8 escorts) travel roads you hold; holding the chain keeps your logistics open. **Losing a mid territory cuts the line** — frontier territory behind the cut becomes isolatable (no resupply, no reinforcement), which is the counterplay to contiguous conquest: siege the chain, not just the prize. The map therefore reads as a logistics problem, exactly per the research (Foxhole: wars are won logistically).
5. **Importance sits deep in the network** (§map importance tiers): the most valuable territories are the furthest reachable — the conflict over the chain is the conflict for the prize.

**Design flags (owner decision — same class as D1–D6/FB1–FB5, confirm or tune):**
- **R1 — Link types & speeds:** roads vs roadless link kinds (name/quantity per race/world), march-time and supply-throughput multipliers per link kind. — **✅ owner-ratified 2026-09-12**
- **R2 — No-leapfrog enforcement:** confirm that capturing a territory requires holding at least one approach link from your side (rec: yes — counterplay is cutting links / contesting approaches, never a rule penalty). — **✅ owner-ratified 2026-09-12**
- **R3 — Road building:** fixed world links vs colonies investing to BUILD new roads (costs war supply + build time; opens deliberate "open this approach" decisions). Rec: roads buildable (investment), roadless links fixed. — **✅ owner-ratified 2026-09-12**
- **R4 — Contiguity origin:** per-FOB (each FOB expands its own chain; §12) vs per-world (a colony's holdings share one network). Rec: per-FOB, so multiple FOBs on a world create separate fronts — matches "each colony lands and builds its base." — **✅ owner-ratified 2026-09-12**

---

## §14 Map identity — the shattered circuit-web (owner direction 2026-09-12 · working section, feeds §13 and the world-map design)
**Owner's design, captured faithfully:** the contested map is *"not a symmetric grid"* — it is a shattered circuit-web: the remnant circuitry of the old world, history-shaped and asymmetric, with **the Chorus-held heart at its core**. The frontier is a dead geography, not a chessboard.
**The mechanic (integrated):**
1. **Territories sit where the old world stood.** Node positions follow the old world's corpse-geography (arcologies, data-cores, foundry belts, observatory arrays) — authored per world in a layout constant (war-map-layout.ts), asymmetric, and each world's web is different (identity that belongs to the server, per the six-worlds framing).
2. **The Chorus-held heart is the core.** The deepest site on the frontier is a *Chorus stronghold* — the crown prize and the threat: highest yield, highest tithe, highest Chorus draw (map-design §2.2/§6-W2). The web's traces radiate from the heart outward to the landing perimeter where invaders arrive; the war's arc reads **inward** — footholds at the perimeter, the chain pushed, the heart circled, never easily taken.
3. **Links carry identity.** Intact traces = roads (§13), burnt traces = roadless passes, severed traces = gaps. The web reads as circuitry — territory accessibility is visible as surviving traces, and the cuts where the Chorus broke the old world are part of the world's story.
4. **No two worlds' webs alike** — six worlds, six corpse-geographies, one codebase (per-world layout constant), which is what makes territory war *identity* rather than reskin.
**Design flags (owner decision — same class as D1–D6/FB/R):**
- **W1 — Per-world layout:** confirm layout is authored per world (constant per world id) vs generated; rec: authored (history-shape). — **✅ owner-ratified 2026-09-12**
- **W2 — Heart identity:** confirm the heart = the world's deepest T3 scientific site (dark-matter-observatory on Watchers) and that it reads as a Chorus stronghold, not a neutral prize. — **✅ owner-ratified 2026-09-12**
---

## §15 Real-time battle engine & live battle view (owner direction 2026-09-12 · working section, feeds §4/§5/§7/§8/§12/§14)
**Owner's design, captured faithfully:** *"The battles that take place on the war server are going to be determined by stats of your heroes and your weapons or armory that you're building, tier levels of course, which depends on your forward base that you built — and all this is factored into a real-time battle. Some battles could take hours depending on the force sizes, and some could take minutes because of force sizes and strength between sides. These real-time battles we should be able to open up a screen and see the results going on in real time — this will allow you to decide how you build and form your armies against other armies; we have to know how they do in order to maintain optimum formations."**
**The mechanic (integrated with §4/§5/§7/§8/§12):**
1. **A battle is a persistent entity with a timeline, not an instant resolve.** When a march meets a defending force (capture, contest, FOB siege — §5 zone-state actions), a **battle entity** opens: `{id, zoneId, sides, forcePower, durationMs, startedAt, milestones, result}`. It resolves over real time exactly like everything else in this game (persistent-world rule — offline-safe, lazily computed in `advance()`-style ticks), and its **live state is readable through the existing polling** (4s poll, 30s map-focus during Campaign, §7 broadcast ticker on Climax — no websockets, no new deps; the client renders a view, the server is authoritative).
2. **Strength in = strength out.** A battle's outcome is computed from the same inputs that define a force, per §8 (heroes' stats + squad skills) and §12 (troops' weapon family + tier kits, power ceiling set by FOB stage), plus troop counts (supply-weighted per §8's caps). Nothing else enters the formula — no purchasable term exists (§9: every scored/combat input is a server-verified ledger event).
3. **Duration ∝ total force size, ∝ 1/strength gap.** *"Some battles could take hours depending on the force sizes; some could take minutes because of force sizes and strength between sides."* Draft curve (design-flag B1, constants not contracts): `durationMs = base(20 min) × (1 + log2(1 + totalPower/k)) ÷ (1 + 3 × powerGap)`, clamped **[5 min, 8 h]** — small or one-sided fights end in minutes; large, evenly-matched fights grind for hours. The flat part matters: a hopeless defense **can** be over in minutes (no artificial grind), and a true slugfest **should** take hours (logistics, reinforcement windows, Climax drama).
4. **Live battle view — "open up a screen and see the results going on in real time."** New war-phase tab, **Battles**:
   - **List:** every ongoing battle on your world's fronts (home + enemy), sides, committed force sizes, elapsed/ETA, live state chip (Stalemate / Pressing / Rout risk).
   - **Detail (the strategic tool):** both sides' committed composition (hero squads by name, weapon families/tiers, troop counts — the *observable* facts of the fight), casualties ticking per resolution interval, shifting line/probability as reinforcements land, and the reinforcement queue both sides have committed.
   - **The owner's loop, made concrete:** *"know how they do in order to maintain optimum formations"* — every battle you can see (and every battle report afterwards, §7 History Book) teaches what the enemy fields; you re-form your own army (which hero squad is active, which weapon families to build next, which FOB stage to push) against what you actually observe. Visibility is the strategy layer, not the spectate layer.
   - **Scope (design-flag B2):** default = all battles your world participates in (both fronts) + marquee Climax battles spectatable world-wide; no pre-battle scouting of hidden enemy stats (strictly live/battle + after-action reports — keeps the discovery honest).
5. **Reinforcements & windows.** A battle's result can shift while it runs: committed reinforcements march in over travel time (per §13 links — roads fast, ruin-passes slow) and arrive live (design-flag B3). Sides choose to hold or feed the fight; the caps (hero energy 60/wk, 8 marches/day — §8) are the same server-side valves and remain non-extendable by purchase. A battle ends when one side routs (casualty threshold), withdraws, or the campaign timer force-resolves it — winner takes the zone-state transition per §5 (capture/repel/siege outcome), combat contributions feed §4 scoring and the Contribution Award exactly like every other ledger event.
6. **Battle reports close the loop.** Every battle writes a report into the §7 History Book (composition both sides, duration, casualties, flips, heroes' deeds — the source material for the war-week recap 'the Burn of Cycle 12'). The map's Active-Battles markers (§4 world-map §3.3) pulse for ongoing fights; Climax's live ticker broadcasts headline outcomes (§7).
**Design flags (owner decision — same class as D1–D6/FB/R/W):**
- **B1 — Duration curve:** the formula above (base 20 min, log-size term, gap divisor, clamp 5 min–8 h); confirm the feel (one-sided → minutes, slugfests → hours) and the clamp bounds. — **✅ owner-ratified 2026-09-12**
- **B2 — Live-view scope:** all battles on your world's fronts + marquee spectate during Climax (default ◇) vs only battles you participate in. — **✅ owner-ratified 2026-09-12**
- **B3 — Reinforcement windows:** open while a battle runs, arrivals over travel time (default ◇); cap interaction with §8 energy/march caps. — **✅ owner-ratified 2026-09-12**
- **B4 — Strength inputs:** hero stats + squad skills + weapon family/tier + FOB-stage ceiling + supply-weighted troop counts (default ◇) — confirm nothing else (specifically: nothing purchasable ever appears in the formula). — **✅ owner-ratified 2026-09-12**
- **B5 — Adjudication:** winner takes the §5 zone-state transition; combat contribution feeds §4 + Contribution Award at published rates (default ◇). — **✅ owner-ratified 2026-09-12**
- **B10 — Withdrawal & rearguard:** retreat orders are **never free and never instant** — the covering force stays in the fight while the main body disengages, and the slower/steadier the withdrawal the more it costs in troops but the more it saves in the rest of the army (default: "steady withdrawal" action available at any time during a battle; casualties to the rearguard are automatic and heavier the more pressure the enemy is applying; salvaged survivors rejoin the colony's home force or the FOB, not instantly re-fieldable — they march back). The decision is real: hold and risk the whole force to keep the zone, or bleed the rearguard to keep the army. — **✅ owner-ratified 2026-09-12**
- **B11 — Aid calls (co-op reinforcement):** a battle participant can **call on teammates** — a world-wide (or guild/coalition, per Emissary structure §6) aid beacon on the live Battles tab + the map (§3.3 markers) — and teammates who respond commit available marches/supplies while the battle runs (travel time over §13 links; arrivals add to the fight live, "back up your fight and add as they go"). Responders earn the §4 participation/assist scoring at published rates. The same server caps apply to responders as to the initiator (hero energy 60/wk, 8 marches/day §8) — an aid call is a coordination mechanic, never a bypass. — **✅ owner-ratified 2026-09-12**
- **B12 — Decision windows ride the polling cadence:** because battles take time, decisions happen in **windows, not APM** (consistent with §8 "decision moments, not APM"): over the battle's duration, at each resolution milestone both sides may issue one consequential order — reinforce, hold fast, steady withdrawal, retreat, call aid — and the live view reflects it. Orders resolve server-side; the client sees the consequences on the next poll. — **✅ owner-ratified 2026-09-12**
---
## §16 Cross Badges — Oracle influence, the war-contribution reward economy (owner direction 2026-09-12 · working section, feeds §4 scoring, oracles doc, heroes brief, §9 boundary)
**Owner's design, captured faithfully:** *"The points that are being gathered on these [war] servers are of course determining factors for special rewards — what are called in Atlantis 'cross badges'. We can call them influence points on Oracles, because we have to influence Oracles to get certain things from that planet."*
**The mechanic (integrated):**
1. **War contribution earns Cross Badges.** Every colony's war-week contribution (the §4 scored ledger: bucket ticks, captures, purifies, participations — the same server-verified events that feed the ladder and the Contribution Award) earns **Cross Badges** at published rates (design-flag B7). Earned, ledger-derived, deterministic — the same money-proof discipline as everything scored (§9.2d).
2. **Badges ARE Oracle influence.** Flavor is the system here: the Oracle of the contested world pays out influence for demonstrated war deeds — *"you have to influence Oracles to get certain things from that planet."* Holding badges is holding the Oracle's attention; spending them is asking the Oracle for something. (Display name default: **Cross Badges · Oracle Influence** — design-flag B6.)
3. **What influence buys — cross-planet boons (the cross-race engine made economical).** Spend badges with a world's Oracle to obtain *things from that planet* (battle-side §1 cross-race framing + plan's 'invasion makes you well-rounded'):
   - **Foreign hero vouching** — the measurable influence currency beneath the heroes brief's 'Oracle trust' earn-path (foreign rosters unlock by venturing + trust; see `design/heroes-design-brief.md` — deed finish guarantees stay; badges tune access, never power).
   - **Foreign codices / tech licenses** — pre-war knowledge of the other side's domains: Codices earned, not looted (plan), made acquirable from the Oracle's archive at published prices.
   - **Foreign territory mats** — the alloy recipe's 5-material path gets a war alternative (own + 4 others): Oracle-granted access instead of deep PvE raids only.
   - **Emissary favors** — the plan's sealed-world bridge: recognized emissaries trade badges into cross-world diplomatic channels (battle-side §6).
   - **Nothing combat-critical is gated behind spending** — badges buy opportunity and access, never a stat, never a win (hard rule §16.4).
4. **Hard boundaries (fed by §9):**
   - **Never purchasable.** No Votives→badges conversion, no badge packs, no pass granting badges (§9.1.8 + the (a)–(d) structural list; asserted in tests like `assertCatalogFair`).
   - **Badges never buy cleansing.** Purification stays the two-key earn-only rite (Oracle favor + Unbound progress — battle-side §5.4/D5). Influence is the Oracle's commerce with the ambitious; purity is the Oracle's trust in the worthy. They are deliberately different ledgers.
   - **Published table.** Earn rates, boon prices, weekly soft cap (anti-farming; badges bank across cycles, no expiry — design-flag B8) are all published constants. The table is balance debt (calibrate later), not design ambiguity.
5. **The turbine, once more.** Badges come from the war week's aggression; the clearest boons (foreign heroes, foreign codices) raise Total-Completion pace — which raises the Chorus's hunt, which must be cleansed on Truce. The reward economy itself is the hubris/purity loop with a price in front of it.
**Design flags (owner decision — same class as D1–D6/FB/R/W/B1–B5):**
- **B6 — Display name:** **'Cross Badges · Oracle Influence'** (◆, per owner) vs 'Oracle Influence' alone vs 'War Cred'; lore text carries the Atlantis-flavor line. — **✅ owner-ratified 2026-09-12**
- **B7 — Earn & spend rates:** defaults in the balance appendix (e.g. 1 badge per capture-score point, boon prices at 25–200 badges); constants to calibrate. — **✅ owner-ratified 2026-09-12**
- **B8 — Bank vs cap:** bank forever + weekly soft cap (anti-farm) (◆); no expiry, no prestige-burn in v1. — **✅ owner-ratified 2026-09-12**
- **B9 — Boon list v1:** foreign hero vouching (entry tier), foreign codices, foreign mats, Emissary favors — confirm order/price and whether any boon waits for later modules (◆: all four listed, hero vouching gated on the heroes build). — **✅ owner-ratified 2026-09-12**
---

## §17 Server pairing — Reverberation (owner direction 2026-09-12 · working section, feeds §1 pairing rotation and §4.4 matching)
**Owner's design, captured faithfully:** *"That's the whole point of the multiplayer concept — you can have whales, but whales can be beaten by multiple players who play for free with good organized tactics. What we want to do is make sure that servers with whales fight other servers with whales — you have to keep that balanced. I will have to put a power rating in — I don't want to call it 'power' because I'm tired of seeing games with 'power' — I want to call it an influence of some sort; we can call it something you come up with. And that is going to base your server's total [rating], whatever you want to call it."**
**The mechanic (integrated):**
1. **Reverberation — how far your world's deeds echo.** A **server-level composite rating** (name proposed by the lead for the owner's pick — alternates in flag V4) built from the world's aggregate, **earn-only** ledger terms: colony capability (armory tiers, leader depth, research/completion breadth), sustained activity/participation, and the dents the world has actually made (captures, purifies, contribution history). **Spend contributes zero to any term** — the composite reads exactly the same published ledger terms for buyers and free players (same discipline as §9.2a; purchasable strength may raise capability *within* the earnable ceiling — that's the product — but never through a purchase-specific term).
2. **Pairings seed on Reverberation balance — *"servers with whales fight other servers with whales."*** War pairings (§1 rotation + D1 cadence) are seeded by Reverberation match within a **published tolerance** (design-flag V2): whale-worlds meet whale-worlds, organized-free worlds meet their class. Balance is the *seed*, not the straitjacket — rotation still avoids repeat pairings and adds variety, but the week's match is picked so the ladder stays winnable and the fight stays tense. A world's Reverberation and its weekend opponent's Reverberation are **published at Gearing** with the pairing announcement (transparency — no hidden matchmaking, the books are open the way everything else is).
3. **The free-and-organized path is the point.** The system is designed so a coordinated free world can beat a rich world — §15's aid calls and the co-op pillar are what make that true — Reverberation just makes sure the *pairing* doesn't hand a whale-world a farm league. Competitive faith is structural: organized play is the multiplier money can't buy; the rating keeps the fight even enough that the multiplier, not the wallet, decides.
4. **Drift & computation.** Reverberation is computed at Gearing from the *prior cycle's* full ledger (design-flag V3 — no same-week gaming of the rating; a world that surges mid-week pairs off next cycle). It is a pure server-side score; the client sees a published number + a one-line breakdown, never internals.
**Design flags (owner decision — same class as D1–D6):**
- **V1 — Composite terms & weights:** capability + activity + dents (default: 0.5 capability / 0.3 activity / 0.2 dents, all from published ledger terms, spend-zero); tune later. — **✅ owner-ratified 2026-09-12**
- **V2 — Pairing tolerance:** max Reverberation gap allowed between paired worlds before the rotation picks the next candidate (default: gap ≤ 25% of the higher world's score; hard ceiling on mismatch). — **✅ owner-ratified 2026-09-12**
- **V3 — Computation timing:** prior-cycle ledger at Gearing (default ◇) — no same-week gaming. — **✅ owner-ratified 2026-09-12**
- **V4 — Display name: ✅ DECIDED (owner 2026-09-12):** **Reverberation** — short form **"Reverb"** (owner's words: *"you want to call it reverb for short — reverb, that's good"*). In-universe: how far your world's deeds echo through the dead circuitry; worlds that shake the same way meet. UI: "World Reverberation" header, "Reverb" in tight spaces (pairing card, ticker). No "power" vocabulary anywhere.
---

## §11 Owner decisions (explicit decision points — not design conclusions)

- **D1 — War cadence / season length:** confirm war week = Mon–Sun UTC; season length (recommended 4 weeks = 2 war weeks + 2 rest weeks per world, with the pairing-rotation rule from §1); confirm Truce = Sunday. — **✅ owner-ratified 2026-09-12**
- **D2 — Golden-window timing / timezone policy:** which 2-hour window (default proposal: 20:00–22:00 UTC rotating by pairing/week so no timezone permanently owns Climax); confirm 24h-ahead announcement + broadcast feed are desired. — **✅ owner-ratified 2026-09-12**
- **D3 — Comeback multiplier rates:** confirm >25% → ×1.25, >40% → ×1.5 on PvE-adjacent contributions only (never kills, never purchasable); tune the curve. — **✅ owner-ratified 2026-09-12**
- **D4 — Activity-floor threshold:** define "active colony" (proposal: ≥1 login+action in last 7 days) and the floor count + composite weight that triggers "the world holds its border." — **✅ owner-ratified 2026-09-12**
- **D5 — Earn-only purify confirmation:** confirm the two-key lock (Oracle favor + Unbound silent-reveal progress incl. `acknowledgedOnce`), no purchase path anywhere, purification's published parity table, and whether world-level Unbound posture is a thing (milestone) vs per-colony rite only. — **✅ owner-ratified 2026-09-12**
- **D6 — Pass reward contents:** confirm the war-season paid track = strictly cosmetic (banner kits, sigil frames, neutral trinkets) per §9.3's exact rule, participation-based pass objectives, and the hard no-"war convenience" line. — **✅ owner-ratified 2026-09-12**
- Micro-flags (tightly coupled, defaulted above): skirmish bucket = 2h; re-purify lockout 24h / re-corruption floor 12h; hero energy 60/wk + 8 marches/day; Emissary seats 3–7; per-colony public-stats opt-out. All are constants in the spec, not contracts.

**✅ FULL RATIFICATION 2026-09-12 — war decisions D1–D6, B1–B12, FB1–FB5, R1–R4, W1–W2, V1–V3 (and M1–M8 in the map doc) all accepted, PLUS Heroes O1 (Wave-1 Watcher roster, 8 heroes) — the war's unit layer is fully cleared to build. O2–O10 stand on non-gating defaults. Sequencing note stands: war Phase 1 ships after core + the map (feature renamed **THE CIRCUIT** 2026-09-12, was "World Atlas"); live pairing test needs a second world (headless pairs until then).**

**New working-section flags live in their sections:** §15 B1–B5 + B10–B12 (real-time battles · withdrawal/rearguard · aid calls) · §16 B6–B9 (Cross Badges / Oracle influence) · §17 V1–V4 (server pairing — Reverberation) · §12 FB1–FB5 · §13 R1–R4 · §14 W1–W2. They are the same decision class as D1–D6 — confirm or tune.
**Note on sequencing:** the business plan calls the war layer "after core is solid" — per that framing, the Battle side should ship only after the beta expedition core is stable; the Contribution score (precursor) can ship immediately, and the battle pass's PvE Season 0 (monetization §4) can precede the war entirely.

---

*Filed by team lead from researcher delegation report (session d34e2ca3-4a24-452b-8580-7c9873410afe). Read-only session — no files were written by the researcher. Outstanding: URL-verification TODO list from battle-side-rvr-research.md (browser-capable follow-up; does not block spec-ing — nothing in this spec depends on unverified figures).*

**Territory map design:** see `design/world-map-design.md` (frontier = the Burning Rim; importance tiers T1–T3 from a published formula; shattered circuit-web node-graph map spec with the Chorus-held heart at the core; owner decisions M1–M8 + R1–R4 + W1–W2).


