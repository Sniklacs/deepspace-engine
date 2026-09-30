# Spec — Forward Bases & Cross-Server Raiding (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** This document specifies the
> structure, rules, and engine seams the engineer will implement **later**. It is
> written to the same standard as the other build docs (`leader-xp.md`,
> `oracles-purity-layer.md`): concrete, buildable, self-contained.
>
> Owner-approved frame (locked, do not redesign): **one race per server**; you
> jump to another race's world to raid their AI; you plant a **forward base**
> that builds **troops and nothing else**; it **lives off raiding**; it **can be
> destroyed** — lose the base, lose everything stationed there.
>
> STALENESS NOTE (2026-09-30): `design/monetization.md` still carries the old
> "cosmetic/convenience only, never pay-to-win" frame. The owner revoked that
> frame on 2026-09-30 ("tear it out, we're going to start fresh"). This spec is
> written against the NEW frame: pay-to-win is allowed, but **artifacts are
> never sold** (see §8) — that is the line the owner drew against becoming an
> Empire Builder clone.

---

## 0. Locked principles this spec builds within

1. **One race per server.** Every server (world) belongs to exactly one playable
   race. There is no mixed-server endgame; the endgame IS the other servers.
2. **The reason to leave home is AI.** Each race's world holds that race's AI
   resources (fragments, cores, the Chorus's attention). You raid other worlds
   to capture AI you cannot get on your own.
3. **The forward base is a barracks, not a colony.** Troops and nothing else:
   no research, no forge, no economy, no artifact generation, no devotion.
4. **Planting it costs something real.** A jump charge plus a beachhead kit, one
   base per foreign server. Picking a target is a decision because it costs.
5. **It lives off the land.** No supply convoys from home. Troops eat what you
   raid on that server. Turtle up and they starve.
6. **It can be destroyed.** Defending players and the Chorus can raze it. Lose
   the base, lose everything stationed there. Cross-server war without this is
   risk-free shopping with extra steps.
7. **Loot is cargo-only.** When a hero falls, the winner takes cargo — never
   equipped modules. (Owner decision 2026-09-30: "fuck that, it's just cargo.")
8. **The Chorus never picks up loot.** PvE does not loot you. Only players loot
   players.
9. **Artifacts are never sold.** Not in any shop, bundle, or event — no matter
   the price. Whales can buy power; they cannot buy legend. (Owner decision
   2026-09-30.)
10. **Home is safe, away is stakes.** The home colony is where you build; the
    forward base is where you risk. A player should feel that split in ten
    seconds.

---

## 1. What this system is for

The fantasy, in one sentence: **take your army through the dark to another
race's world, plant your flag, and steal their gods' machinery before they
burn your flag down.**

Every other system feeds this sentence:

- The **Forge** (§8) makes the modules your troops carry and the random
  artifacts your raiders dream about.
- **Alliances** matter because one colony cannot hold a beachhead against a
  whole server — raiding parties are alliance-scale by design.
- **Seasons** reset the board (see §9), so every season opens with the same
  question: who jumps first, and where?

---

## 2. Servers and the jump

### 2.1 One race per server

- Each server is seeded for exactly one race: its world art, its AI resource
  profile, its Chorus hive temperament.
- A player has ONE home colony on ONE server (their race's). Everything else is
  away.

### 2.2 The jump

The jump is the door between servers. It is not casual travel — it is an
expedition with a cost, a cargo, and no return ticket included.

- **Requirement:** a forward-base-capable strike force. The jump carries the
  hero (or heroes), their troops, and their cargo — one trip, what you bring is
  what you have.
- **Cost (proposed, tunable):** a jump charge paid in fuel/supplies at home,
  plus a cooldown before the same colony can jump again. The charge scales with
  the size of the force (bigger army, bigger charge) so jumping is always a
  real decision, never a reflex.
- **No ferrying.** After the jump, the door closes behind you. No reinforcement
  convoys, no supply ships from home. The strike force and whatever it builds
  at the forward base is the whole army. (If this proves too harsh in
  playtesting, the first softening is a *return* jump for survivors — never an
  inbound supply line.)
- **The AI goes home how?** Captured AI (fragments, cores, artifacts) travels
  in cargo. If the carrier falls, the cargo is lootable (§7) — including by the
  defenders taking their own AI back. The raid's prize is only yours once it
  survives the trip home.

---

## 3. Planting the forward base

- **Beachhead kit:** planting consumes a kit — supplies plus a forged
  component (proposed: a war-plate-derived "anchor"). The kit is the fixed,
  legible cost; the jump charge is the scaling one.
- **One per foreign server.** A colony may hold at most one forward base on
  any given server. No beachhead spam.
- **Placement:** the player picks a landing zone on the target server's map
  (constrained: not inside another player's territory walls, not inside Chorus
  hive cores — the landing itself should feel like a small invasion).
- **It starts small and stays small.** The base has a fixed footprint and a
  garrison cap (proposed: 500 troops — tunable). It cannot be upgraded into a
  second colony. The cap is the point: this is a knife, not a second home.

---

## 4. What a forward base can and cannot do

**CAN:**
- Muster and train troops (the only production queue).
- Heal and re-fit troops (supplies in, readiness out).
- Hold cargo (the raid's takings, waiting for the trip home).
- Mount basic defenses (walls/turrets bought with raided supplies — static,
  modest; a forward base should *delay* a determined attacker, not stop one).

**CANNOT:**
- Research anything. No lab.
- Forge anything. No forge — modules and artifacts come from home or from
  loot, never minted at the beachhead.
- Generate resources. No mines, no farms, no economy buildings at all.
- Produce artifacts, devotion, scrip, or any home-currency income.
- Be upgraded past its footprint or garrison cap.

The design intent is legible in the UI: the forward base screen is a war
table, not a colony screen. If it starts looking like a colony, the design
has failed.

---

## 5. Supply — living off the land

This is the pressure that makes raiding mandatory rather than optional.

- **Upkeep:** stationed troops consume supplies per hour (proposed: 1 supply
  per 10 troops per hour — tunable). The base holds a supply stockpile; the
  stockpile only grows by raiding (Chorus sites, defender outposts, undefended
  extractors — the server's PvE and PvP loot tables).
- **Hunger stages:** when the stockpile empties, troops go hungry. Proposed:
  24h grace (foraging), then desertion begins at 5% of the garrison per hour
  until fed or gone. A starving base evaporates — no dramatic last stand, just
  the slow math of an army with no food.
- **No home convoys.** Restated because it will be tempting to add later: the
  moment home can feed the beachhead, the raiding pressure dies and the base
  becomes a teleport-anchored suburb. Do not add it.
- **The AI prize feeds nothing.** Captured AI is cargo, not food. A rich raid
  and a fed army are two different problems, solved two different ways.

---

## 6. Destruction — losing the base

- **Who can raze it:** any defending player (or alliance) on that server, and
  the Chorus (hive retaliation strikes scale with how much you've raided —
  steal loudly, get noticed).
- **How:** the base has wall HP. Siege it like any fortification; when the
  walls fall, the base is razed.
- **What is lost:** everything. Stationed troops, the cargo stockpile, the
  defenses. There is no evacuation mechanic — when the walls fall, the
  survivors are assumed dead or scattered. (This is the stakes. Do not soften
  it without an owner decision.)
- **What is NOT lost:** the home colony is untouched. Heroes: a fallen hero
  in the base's last stand follows the normal hero-fall rules (§7) — cargo
  lootable, equipped modules safe.
- **Replanting:** allowed, at full cost (new kit, new jump). Revenge raids are
  a feature.

---

## 7. Loot rules — cargo-only

- When a hero (or army) falls in PvP, the victor loots **cargo**: supplies,
  trade goods, captured AI in transit, unmounted modules sitting in packs.
- **Equipped modules are never lootable.** What a hero wears into battle, they
  keep (or it breaks per §8 deterioration — but it is never *taken*).
- **Artifacts are the exception** (owner decision 2026-09-30): when a hero
  bearing an artifact falls in **real PvP battle**, the victor may take it.
  Artifacts can never be sold, traded, or wagered — the battlefield is the
  ONLY way they change hands. Flaunt it in the arena safely; wear it into
  real war and you're betting it.
- **The Chorus never loots.** Losing to the hive costs you the fight and the
  troops; your cargo scatters (destroyed, not transferred) — and an artifact
  carried into a Chorus fight is **destroyed**, not captured. The hive
  doesn't want your legend; it just ends it. Only players take from players.
- **Defenders retaking their AI:** captured AI in a raider's cargo is lootable
  like any cargo — this is how a server takes its gods' machinery back.

---

## 8. The economy around the war — artifacts vs. modules

This is the line that keeps the game from being an Empire Builder clone.
Two tiers, never mixed:

**ARTIFACTS — never sold, only earned.**
- Sources: exploration rare drops on any server, Chorus raid sites (the
  fifteen-site ladder), and the Forge's random rolls.
- The Forge makes weapons with **fully random attributes** — no fixed
  structure, no stat budget the player can plan around. A roll can be badass
  or mediocre; that variance IS the artifact fantasy.
- **War plates** (forge materials, also Chorus-raid drops) feed the Forge —
  they are ingredients, not products.
- The owner may add more artifact kinds later. The rule that never changes:
  no shop, no bundle, no event sells one. Ever.
- **How artifacts change hands** (owner decision 2026-09-30): NEVER by
  trade, market, or duel wager — otherwise players would farm duels for
  them. The ONLY transfer is the battlefield: beachhead battles,
  cross-server raids, home defense against raiders. If you fall in real PvP
  wearing one, the victor takes it (§7). If you fall to the Chorus wearing
  one, it's destroyed. Wear it in the arena all you like — that's the
  showroom. Wear it in real war, and it's on the table.

**MODULES — the commodity tier. Sold, lootable, breakable.**
- The Forge also makes **modules**: fixed-attribute gear (armor, damage,
  defense — the basic stat set, TBD). Set stats, no variance, no legend.
- Modules are **sold** (this is the recurring store revenue), **lootable**
  only as cargo (§7), and they **deteriorate**: battle wear and time degrade
  them until they break.
- Broken modules are gone — rebuy or re-forge. THIS is the demand loop that
  never dries up: every module in the game has a death date, so the store and
  the Forge both stay hungry forever.
- PvP loot doesn't destroy demand, it moves it: the winner's modules still
  age, still break, still need replacing.

---

## 9. Seasons

- **Locked (owner decision 2026-09-30):** at season's end, everything is wiped.
  Every forward base is abandoned, every strike force recalled (or lost), every
  stockpile zeroed. Nothing carries over — **except battle memorials.**
- **Battle memorials (plaques):** when a genuinely major battle happens — a
  beachhead siege, a huge field engagement, a last stand worth remembering —
  the site gets a permanent plaque on the world map: a memorial to the
  warriors who fell there. Season, date, the factions involved, the fallen
  heroes named. It persists across every season after.
- This is the game's history layer. The board resets, but the *legend* doesn't.
  A new player landing on a server in season 9 sees plaques from season 2 and
  understands: people bled here, this ground matters. That is depth no
  resetting system can buy any other way.
- **Qualification (proposed):** automatic when a single engagement's combined
  losses cross a casualty threshold (tunable — proposed: 1,000+ troops), plus
  owner discretion for battles that matter beyond the body count (a famous
  last stand with 300 troops still gets its plaque). Plaque text is
  auto-generated from the battle record; the victorious side (if any) may add
  an epitaph line, subject to the profanity/name filters.

### 9.1 Site naming — the land remembers

- Every forward-base site (server + coordinates) has a **name**. A fresh
  planting starts generic: "Beachhead \<phonetic designation\>" (e.g.
  "Beachhead Kestrel").
- After the first battle resolves at the site, the site is **named for the
  biggest battle fought there — in honor of that battle's biggest
  contributor.**
- **Biggest battle:** by total supply-weight committed, both sides combined.
  Only battles at this site count.
- **Biggest contributor:** highest contribution score in that battle, where
  contribution = supply-weight committed + 10 × kills (troop kills plus kills
  credited to the player's heroes). Knob, tunable in playtesting.
- **Either side can win the honor.** Attacker or defender — whoever bled most
  meaningfully. Your beachhead can end up named after the enemy commander who
  broke your siege. That is not a bug; it is the history layer working.
- **Name format:** "\<PlayerName\>'s \<epithet\>". The epithet follows the
  battle's outcome at the site:
  - Attacker planted or held the site → **Landing** ("Drakkar's Landing")
  - Defender held → **Stand** ("Drakkar's Stand")
  - The base was destroyed in that battle → **Fall** ("Drakkar's Fall")
  - The honored player may rename the epithet once (free text, filtered).
- **Renaming:** a later, *bigger* battle at the same site re-names it. Names
  can change hands across seasons — history gets rewritten by bigger deeds.
- **Announcement:** server-wide, over the world speaker: *"The beachhead at
  \<coords\> is now DRAKKAR'S STAND."*
- **Persistence:** site names are per server+coordinates and persist across
  seasons in the Chronicle. A new base planted at a named site inherits the
  historic name until a bigger battle renames it. A destroyed base keeps its
  name on the memorial plaque.
- This is the loyalty engine made geography: players don't just remember
  their weapons — they remember *where they bled*, and the map remembers
  them back.

---

## 10. Tunables (all numbers proposed, none locked)

| Knob | Proposed | Notes |
|---|---|---|
| Jump charge | fuel/supplies, scales with force size | Must always feel like a decision |
| Jump cooldown | 24h per colony | Prevents jump-spam harassment |
| Beachhead kit | supplies + 1 forged anchor component | Fixed legible cost |
| Bases per foreign server | 1 | Hard cap |
| Garrison cap | 500 troops | A knife, not a second home |
| Upkeep | 1 supply / 10 troops / hour | From raided stockpile only |
| Hunger grace | 24h, then 5% desertion/hour | Starvation evaporates, no last stand |
| Wall HP | modest — delays, doesn't stop | A base should fall to a real siege |

---

## 11. Open questions for the owner

1. **~~Season reset** (§9): full recall, or does anything carry over?~~ —
   ANSWERED 2026-09-30: full wipe, except permanent battle-memorial plaques.
2. **Hero travel:** how many heroes can jump with a strike force? (Proposed: 1
   leads, up to 3 attached — unconfirmed.)
3. **Chorus retaliation tuning:** how loudly does raiding ring the dinner
   bell? (This is the PvE pressure valve on runaway raiders.)
4. **Module stat set:** the "basics" — armor, damage, defense, and what else?
   (Keep it small: 4–6 stats max. Commodities should be legible.)
5. **Deterioration curve:** battle-wear vs. time — which dominates? (Proposed:
   battles dominate; time is the slow backstop so stockpiled modules still
   die.)
6. **Alliance raiding:** can an alliance plant a *shared* beachhead, or is it
   strictly one base per colony? (Strictly per-colony keeps it simple;
   shared beachheads are a v2 temptation.)

---

## 12. Build seams (for the engineer, later)

- `serverId` / `homeServerId` on the account; `forwardBases: Record<serverId,
  ForwardBase>` on the colony (max one per key — enforce it).
- `ForwardBase`: `{ garrisonCap, troops, supplyStockpile, wallHp, plantedAt,
  lastFedAt }`. No economy fields — if an economy field appears here, the
  design has leaked.
- Jump: a validated server action (cost check → deduct → move force). No
  client-controlled teleport, ever — the Xsolla lesson applies to movement
  too: the server is the authority.
- Raze: wall-HP siege resolution reuses the battle engine; on zero, delete
  the base and everything in it.
- Loot: cargo transfer on hero-fall, PvP only; Chorus victories destroy cargo.
- Season rollover: recall job — move survivors + cargo home, delete bases.
