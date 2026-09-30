# Spec — Alliances (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** Zero alliance code exists
> today. This document specifies the structure, rules, and engine seams the
> engineer will implement **later**, in the same standard as the other build
> docs: concrete, buildable, self-contained.
>
> Owner-approved frame (locked, do not redesign): alliances **rally** together,
> **reinforce** each other, and **help** each other's builds — help ticks on
> **buildings and research only**, scaling with the helper's **Cradle tier**.
> **Troops can never be alliance-helped** (`muster-troops.md` §0.5).

---

## 0. Locked principles this spec builds within

1. **Alliances are per-server.** One race per server (`forward-base.md` §0.1),
   so an alliance is that race's war band on its home server. Cross-server
   raids are *coordinated* by the alliance but *executed* by individual jumps —
   each raider plants their own forward base (`forward-base.md` §3).
2. **One alliance per colony.** No multi-membership, no shell alliances, no
   spy-friendly double-dipping. Your flag is your flag.
3. **Help is time, not troops.** Allies shave time off your buildings and
   research. They can never touch your muster queues, your garrison, or your
   forge. The troop economy stays honest.
4. **Cradle tier is the social stat.** The bigger your Cradle, the bigger your
   help ticks — progression benefits the whole alliance, which makes the
   growth spine (`oracles-purity-layer.md` §7) a *social* loop, not a solo
   one.
5. **Reinforcement is real bodies.** Sending aid means your troops leave your
   garrison and stand in someone else's. They can die there. This is not a
   buff — it's a commitment.

---

## 1. Formation & membership

- **Founding:** any colony at Cradle Tier 2+ may found an alliance (proposed
  cost: 500 supplies — enough to mean it, cheap enough to not gate it).
- **Size cap:** 50 colonies (owner-confirmed 2026-09-30). Big enough for a
  real war band, small
  enough that members know each other's names. (The memorial plaques,
  `forward-base.md` §9, will read better when the fallen are *known*.)
- **Ranks:** Leader (1) → Officers (proposed: up to 5) → Members. Leader can
  disband, promote, kick. Officers can invite, kick members, call rallies.
- **Joining:** invite or application; officers approve. Leaving is free and
  instant — but see §6 for what happens to your stationed troops.

---

## 2. Rally — the coordinated fist

The rally is how an alliance turns fifty garrisons into one army.

- **Calling:** an officer names a target (Chorus site, enemy forward base,
  defense point), sets a launch timer (proposed: 15 min – 24h), and opens the
  rally.
- **Committing:** members pledge troops and/or heroes to the rally. Pledged
  troops leave the member's garrison into the rally pool — they're *gone*
  from home defense until the rally resolves. This is the cost of showing up.
- **Launching:** when the timer fires (or the caller launches early), the
  rally pool marches as a **single combined force** — one side in the battle
  engine, one casualty fraction, one memorial entry. Command goes to the
  caller (or their designated champion).
- **Aftermath:** survivors return to their home garrisons (travel time).
  The fallen are recorded per contributing colony — the plaque names every
  flag that bled, not just the caller's.
- **Rally vs. aid call:** the battle engine's aid calls (`war-types.ts` B11)
  are *mid-battle* reinforcements. Rallies are *pre-battle* coordination. A
  rally arrives as one force; an aid call arrives as a second force. Both
  exist; they stack.

### Rally maneuvers — the battle plan

A rally isn't a pile of troops — it's a **plan**. When the caller launches,
they set how the pledged force enters the fight: from where, and when. PvP
battles are timed, not number-crunching, so logistics is a weapon. This is
the mechanic most games in this format don't have.

**Entry vectors:**
- **MAIN** — the frontal force. Engages at T+0. Holds the enemy's attention
  and their facing.
- **FLANK** (left/right) — side attacks, entering at a timed offset.
- **REAR** — the sweep: circles behind the enemy. Requires a logistics tail —
  at least 20% of the maneuver's weight must be Wardens (proposed). Long
  moves starve without escorts.
- **RESERVE** — held back, committed at the caller's chosen time (or thrown
  in mid-battle through a decision window).

**Why five troop types exist** — each has a job in the plan:
- **Bulwark → MAIN.** Holds the line, absorbs the enemy's facing.
- **Reaver → FLANK/REAR.** Fast shock — the sweepers.
- **Longeye → FLANK.** Zone denial — cuts off the enemy's response and
  retreat.
- **Thunder → MAIN/RESERVE only.** Too heavy to sweep; softens the line or
  answers late.
- **Warden → escort.** Every FLANK/REAR maneuver needs its logistics tail;
  Wardens shield the approach and keep the sweep fed.

**Timing:** each maneuver carries an entry time (minutes from battle start),
set by the caller. The battle engine consumes the plan as scheduled entry
events — the force doesn't all arrive at once unless the plan says so.

**Surprise:** FLANK/REAR maneuvers are hidden until they enter. On entry
they get a surprise window (proposed: 5 minutes) — +25% power, and the
defender cannot reassign facing during it. After the window closes, it's a
straight fight.

**Counter-play:** the defender isn't helpless —
- *Intel:* the rally's composition is visible at launch (scouts report the
  muster), but the **plan** stays hidden until each maneuver enters. You know
  they brought Reavers; you don't know where they're going.
- *Screens:* the defender may post pickets on a vector (assign a share of
  their force); a screened vector halves the surprise bonus.
- *Response window:* a revealed maneuver opens a decision window for the
  defender (hooks into the engine's existing window system, `war-types.ts`
  B12) — commit the reserve to meet it, or hold.

**The point:** most games resolve a rally as one number hitting another
number. Here the rally is vectors, timing, and logistics — and the Warden
isn't "the shield guy," it's the reason your sweep doesn't starve halfway
around the enemy.

---

## 3. Reinforcement — standing in someone else's walls

- **How:** send any number of your garrisoned troops to an ally's colony (or
  their forward base). Travel time applies (same-server: fast; to a forward
  base on a foreign server: they ride *your* next jump — no teleporting
  soldiers without you).
- **Command:** reinforced troops fight under the **host's** command in
  defense. You don't get to micromanage someone else's siege from across the
  map.
- **Upkeep:** the **host** feeds them from the host's stockpile. Guests eat
  first from the host's table — and if the host starves, **reinforcements
  desert first** (guests leave before family, `muster-troops.md` §3). Sending
  aid to a starving ally is charity with an expiry date.
- **Recall:** the sender may recall at any time (travel time back). The host
  may dismiss at any time. If either colony leaves the alliance (§6),
  reinforcements auto-recall.
- **Death:** reinforced troops that die in the host's battles are dead —
  applied to the *sender's* roster, recorded in the battle feed under both
  flags.

---

## 4. Help ticks — the daily co-op loop

This is the heartbeat: the small, constant generosity that makes an alliance
feel alive.

- **The action:** from an ally's colony screen, tap **Help**. One of your
  daily help actions is spent; their active building or research timer drops
  by your tick size.
- **Tick size scales with YOUR Cradle tier** (proposed: T1 5 min → T5 60 min
  per tick — tunable). A Tier-5 veteran's help is worth twelve Tier-1
  newcomers'. This is the growth spine paying dividends socially: leveling
  your Cradle is a gift to your alliance.
- **Budget:** proposed 5 help actions per colony per day, refreshing on the
  server day-timer. Scarcity makes them meaningful; the cap makes them fair.
- **What help touches:** buildings and research. **Never troops, never the
  forge, never muster queues.** (Locked — §0.3.)
- **Reciprocity is emergent, not enforced.** No ledger, no debt tracking.
  The game shows who helped you this week (a simple list); social pressure
  does the rest. Systems that *enforce* generosity kill it.

---

## 5. Alliance identity

- **Name, banner, motto.** Player-authored, subject to the name filters.
  The banner flies over member colonies and forward bases — and on the
  memorial plaques of battles the alliance fought (`forward-base.md` §9).
- **No alliance levels, no alliance tech tree in v1.** The alliance's power
  is its members' Cradles, not a separate progression track. (A shared
  beachhead — one alliance base per foreign server — is the v2 temptation;
  `forward-base.md` §11 Q6. Resist it until v1 proves the per-colony model.)

---

## 6. Leaving, kicking, betrayal

- **Leaving:** instant. Your pledged rally troops return (or finish the
  rally they're in — no mid-march desertion). Your reinforcements stationed
  with allies auto-recall. Clean break.
- **Kicking:** leader/officer action, immediate, same troop handling as
  leaving. The kicked colony's name stays on the plaques it earned — history
  doesn't unhappen.
- **Betrayal has no mechanic.** There is no "betray alliance" button and no
  betrayal penalty coded. If a member feeds intel to an enemy, that's *drama*,
  and drama is content. The game doesn't punish stories.

---

## 7. Across seasons — the family stays together

(owner decision 2026-09-30)

- **Membership crosses the season line.** The alliance — its name, chat,
  rally board, history, battle plans — persists into the next season. All
  *power* resets (troops, bases, stockpiles per `seasons.md` §3), but the war
  band is the war band. Nobody re-applies to their own family.
- **Roster politics are the alliance's business, not the game's.** With 50
  spots and no re-shuffle, the alliance manages its own seats: who sits out
  a season, who rotates in, who's earned their place. Leadership tools (kick,
  invite, officer roles) handle it; the game doesn't adjudicate family
  arguments.
- **Sitting out is allowed.** A member may sit out a season — marked inactive,
  contributing nothing — and return to their seat if the alliance kept it.
  Whether the seat is kept is between the player and their officers.
- **Why:** people don't want to fight for a spot in their own alliance every
  12 weeks. Persistence of the *people* is the other half of "the board
  resets, the soul doesn't" — the alliance is a soul-level structure.

---

## 8. Tunables (all numbers proposed, none locked)

| Knob | Proposed | Notes |
|---|---|---|
| Alliance size cap | 50 colonies | Owner-confirmed; knowable names |
| Founding cost | 500 supplies, Cradle T2+ | Meaningful, not gating |
| Officers | up to 5 | — |
| Rally timer | 15 min – 24h | Coordination window |
| Help actions | 5 / colony / day | Scarcity with fairness |
| Help tick size | T1 5 min → T5 60 min | Helper's tier sets it |
| Reinforcement travel | same-server fast; FOB via your jump | No teleporting soldiers |
| Maneuver surprise window | 5 min, +25% power | Hidden until entry |
| REAR escort requirement | ≥20% Warden weight | No logistics, no sweep |
| Max maneuvers per rally | 4 (MAIN + 3) | Plans stay legible |

---

## 9. Open questions for the owner — ALL RESOLVED 2026-09-30

1. ~~**Cross-server alliance identity:** when members jump to raid, does the
   alliance *exist* on the target server (shared chat, shared rally board) or
   is coordination home-server-only? (Proposed: the alliance's chat and rally
   board follow members everywhere — the war band is the war band.)~~ —
   CONFIRMED: alliance chat, rally board, and battle plans follow members
   everywhere, including foreign servers. Critical for cross-server raids.
2. ~~**Diplomacy:** war pacts between alliances of *different* races — v1 or
   v2? (Proposed: v2. v1 is race-loyal; treachery across racial lines is a
   whole expansion's worth of design.)~~ — CONFIRMED: **v2.**
3. ~~**Help tick targets:** buildings + research only, or also forge queues
   and healing? (Proposed: buildings + research only. The forge is the
   *individual* grind — keep it sacred.)~~ — CONFIRMED: **buildings and
   research only.** The forge stays sacred.
4. ~~**Rally ownership of loot:** a victorious rally's cargo — split by
   contribution, or caller's discretion? (Proposed: split by committed
   supply-weight. Math, not favoritism.)~~ — CONFIRMED, LOCKED: **split by
   contribution (committed supply-weight).** No favoritism, no caller's
   cut — "we don't even want to introduce that bullshit."
5. ~~**Maneuver intel depth:** composition visible at launch, plan hidden —
   or should scouting be a real mechanic (send scouts, get the plan)?
   (Proposed: v1 is automatic intel as specced; scouting as a counter-play
   system is v2.)~~ — CONFIRMED: v1 automatic as specced; scouting v2.
6. ~~**Defender battle plans:** can defenders set their own vectors and
   timing, or only screens + reserve response? (Proposed: v1 defenders get
   screens and the response window; full defensive planning is v2. Attackers
   plan, defenders react — that's the genre.)~~ — CONFIRMED: v1 defenders
   get screens + response window only.

---

## 10. Build seams (for the engineer, later)

- `Alliance`: `{ id, name, banner, motto, leaderId, officerIds, memberIds,
  foundedAt, homeServerId }`. One alliance per colony — enforce at the
  membership write.
- `Rally`: `{ id, allianceId, target, launchAt, callerId, pledges:
  Record<colonyId, { troops, heroes }>, state }`. Pledged troops leave the
  garrison on pledge, not on launch — the cost of showing up is immediate.
- `Reinforcement`: `{ fromColony, toColony|toFob, troops, sentAt }`. Upkeep
  debits the *host's* stockpile; desertion order puts guests first.
- Help: validated server action `{ helperId, targetColony, targetBuild }` —
  daily budget check → apply tick. The tick size reads the *helper's* Cradle
  tier. Same authority rule as everything else: server is truth.
- Battle feed records `allianceId` per contributing colony — the memorial
  plaques read this.
- `BattlePlan`: `{ maneuvers: [{ troops, vector, enterAtMin }] }` on the
  Rally. The battle engine consumes it as scheduled entry events; FLANK/REAR
  entries carry the surprise-window modifier until it expires. Pledged troop
  *types* are validated against vector rules at plan time (Thunder can't
  flank, REAR needs its Wardens) — illegal plans are rejected before launch,
  not mid-battle.

---

## 11. Implementation status (Sep 30 2026, branch `xsolla-paystation`, local only)

**Rally maneuvers — engine layer: SHIPPED.** (unchanged from earlier in the day;
see git history for the full engine notes.)

**Alliance + rally backend — SHIPPED (local domain/API/test layer).**
`site/src/game/war/alliances.ts` — migration-safe alliance state; create
(500 supplies, Cradle T2+), apply, invite, accept/decline; leave, kick,
promote, demote, leadership transfer, disband; 50-member cap; 5-officer
limit; open pledges release on leave/kick/disband; leadership passes to
oldest officer, else oldest member. `site/src/game/war/rallies.ts` —
create (15-min minimum lead), pledge (troops LOCK at pledge time, heroes
locked), unpledge, set plan, cancel, launch (→ real battle via the
precommitted `attachBattlePlan` seam — no double commit, no maneuver
segments; one `rally` roster segment per colony), auto-launch, resolve
(victory → contribution-locked supply loot, per-colony loss accounting;
the local colony's share is delivered locally). Help ticks: 5/day,
Cradle T1–T5 = 5/12/25/40/60 minutes, buildings + research only, never
troops/muster/forge. Reinforcements: send (locks sender troops + heroes),
recall, dismiss, auto-recall on leave; host upkeep; guests starve before
hosts. API routes: `allianceCreate/Apply/Invite/Answer/Leave/Kick/
Promote/Demote/Transfer/Disband`, `rallyCreate/Pledge/Unpledge/Plan/
Launch/Cancel`, `helpTickFn`, `reinforceSend/Recall/Dismiss`.
38 tests, 139 expectations, green.

**Alliance UI — SHIPPED.** `site/src/components/AlliancePanel.tsx`,
rendered inside the Battles tab (the war slot owns war UI; no new nav
slot, per the nav spec). No-alliance state: found form + invite answers +
apply to known bands. Alliance home: members with role actions
(promote/demote/kick/transfer/leave/disband), applications inbox,
rally board (call rally, pledge/unpledge, battle-plan presets — Main
thrust / Pincer / Hammer & anvil — launch now, cancel, outcomes with
loot shares and fallen), reinforcements (guests stationed here,
troops abroad, send form), help board (5/day budget, lend-a-hand per
member). All posts ride the play route's `act()` (busy gate + state
refresh + refusal surfacing).

**Cross-account transaction seam — SHIPPED.** `site/src/game/alliance-transact.ts`:
per-account async mutexes (`withAccountLock`) serialize all API mutations;
`runWithAccountSaves()` puts the caller's saves on an `AsyncLocalStorage`
request scope so A→B→A effect chains resolve in-memory instead of
deadlocking; `transactColony()` resolves a colony from explicit local saves,
then the request scope, then a foreign account lock/load/mutate/commit
(gameId-keyed lookup, negative cache eviction); effects ride a persistent
outbox (`allianceFx`) with an idempotency ledger (`allianceFxDone`); delivery
is **save → drain → re-save** (the cleared outbox is persisted after
delivery, never before). Colony-not-found drops with a log line;
account-busy requeues, and effects parked while their target is busy are
restored to the origin outbox rather than lost. All `withColony` API
mutations (alliance, rally, help, reinforcements, battle screens) run inside
the scope. `alliance-transact.test.ts`: 14 green, including per-account
serialization, scope nesting, parked-fx survival, and idempotent redelivery.
Known limit: the seam cannot detect swallowed storage-write failures (the
save path logs rather than throws).

**Help ticks — cross-account: SHIPPED.** `giveHelp` queues `apply-help-tick`
to the target's save; the target shaves the tick off active build/research
timers on its own save via the seam (buildings/research only, never
troops/muster/forge).

**Reinforcement guest lifecycle — cross-account: SHIPPED.** Sender locks
real troops (whole-troop accounting: a 1-weight thunder request locks the
full 2-weight thunder — `mixWeight`/`takeWeightAsTroops`, troops are
indivisible). Host receives a `create-guest-mirror` fx → `GuestMirror`
drives host-side upkeep (thunder eats double) and battles via the
`commitGuestsToDefense` seam. Guest-first desertion (oldest mirror first)
shrink mirrors and queue `release-troop-lock` back to the sender's real
roster; foreign casualties in battle queue `bill-foreign-casualties` to the
sender (kills land in the sender's cohort + sender's memorial feed) and
`shrink-guest-mirror` on the host. Recall/dismiss/leave/kick/disband queue
`remove-guest-mirror` + lock release. Guest defense is DELIBERATELY excluded
from Act I (prologue predates alliances; act1-entry-verify calibration
pinned) — the seam stands ready for real PvP/home/beachhead defense.

**Alliance membership sync — cross-account: SHIPPED.** Alliance records are
versioned (`Alliance.version`, migration backfill); every mutation bumps the
version and fans a `sync-alliance` snapshot to every member's account via the
seam (stale mirrors lose — highest version wins). Membership writes are
canonical on the founder's account: apply/invite route through
`transactColony(founderId, …)` from any account, accept/kick/promote/demote/
transfer/disband likewise. Leave is two-phase by design: the leaver's save
runs rally departure + reinforcement cleanup + mirror removal locally, then
the founder's save drops the member record. Kick/disband fan
`depart-alliance` fx so every target save cleans itself up. Guest mirrors,
rally departures, and troop locks are all unwound on the way out. Directory
discovery: `scanAllianceDirectory()` walks every account's saves (read-only,
no locks — eventually consistent by design) and the NoAlliance panel renders
it as "Across the void" with apply buttons. 5 membership integration tests
green across two accounts (`alliance-sync.test.ts`).

**Rally sync — cross-account: SHIPPED.** Rally records are versioned
(`Rally.version`, stable `RallyPledge.id`); `sync-rally` fans snapshots to the
audience after every mutation. Pledge is split: `lockPledgeLocal` locks real
troops/heroes on the pledger's save, then `mirror-rally-pledge` inserts the
pledge into the canonical rally on the caller's account (idempotent on
pledge id; a canonical rejection queues a self-contained release fx that
unwinds the pledger's lock). Unpledge releases locally and mirrors the
removal. Plan/launch/cancel route to the canonical caller record; cancel and
departure queue self-contained `release-rally-pledge` fx (weight + hero ids
ride the fx — the canonical record clears its pledge list first, so the
pledge itself is not a reliable source). Launch resolves casualties through
the roster seam, then queues contribution-locked loot (`deliver-rally-loot`)
and hero unlocks to each participant's account — each exactly once via the
idempotency ledger. The old `resolveRally` survivor-release path was fixed:
heroes unlock on resolution now (they were locked and never freed). 7 rally
integration tests green across two accounts, including cancel-releases-all,
launch-resolve-loot-exactly-once, and departure-mid-rally.

**Still missing (no pretending):**
  hygiene only — outbox delivery happens server-side through `commitOutbox`.