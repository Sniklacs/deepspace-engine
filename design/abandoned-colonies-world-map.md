# Abandoned Colonies & the World Map

Owner pitch (2026-10-02, Hans): colonies whose players quit or go 30 days inactive become
abandoned. A world map shows colonies by owner name; tapping one shows active/inactive.
Inactive → "This seems to be an abandoned colony. Do you want to explore further? Yes/No."
Abandoned colonies are lootable (supplies, embers, materials — fuel, batteries, med/mech
kits, etc.). Players travel cross-server via the world map (land/teleport, like trading
but to colonies instead of trade hubs). On a foreign map you can be attacked. Abandoned
troops become mercenaries, hireable with supplies. This also opens ACTIVE colony raiding
— not replacing site raiding, but giving players a choice of avenues, like the real world.

## 1. Abandonment

- A colony is **abandoned** when its owner has no login/activity for 30 days.
- Abandonment is per-colony, not per-account (a player with two colonies could abandon one).
- On abandonment: the colony freezes (no production, no upkeep, no decay). It sits as-is.
- **Reclaim:** if the owner returns, they get the colony back as they left it — minus
  anything gleaned while they were gone. (Open: full reclaim vs. partial? See §7.)
- The 30-day clock is server-side, from last authenticated activity.

## 2. The World Map

- Separate from the Circuit map (sites). The world map shows **colonies**, not sites.
- Each colony marker carries its owner's name: "Hans's Colony", "Mira's Colony", etc.
- Tapping a colony shows a sheet: owner name, race, active/inactive status, (if scouted)
  approximate strength.
- **Inactive tap → the prompt:** "This seems to be an abandoned colony. Do you want to
  explore further? Yes / No."
  - Yes → expedition to glean (see §3). No → back to map.
- Active colonies show status but no glean option (raiding actives is §5).

## 3. Gleaning an abandoned colony

- Gleaning is an expedition, not a battle: no defenders, no Chorus.
- **Loot:** everything the colony held at abandonment, minus what prior gleaners took:
  - Supplies, embers, race materials (fuel, batteries, med kits, mech kits, etc.)
  - First-come, first-served — a gleaned colony stays gleaned (partial loot allowed:
    take what your convoy can carry, leave the rest for the next gleaner).
- **Troops → mercenaries:** any troops the colony held become a mercenary band camped
  at the site. Hireable by anyone with supplies (hire cap = what you can feed).
  This is the SAME mercenary pool as the deserter rule — one system, two sources.
- A fully gleaned colony (no loot, no mercenaries) remains on the map as a husk
  until its owner returns or a season wipes it.

## 4. Cross-server travel via the world map

- From the world map, a player can travel to another server's world map —
  the same jump tech as trading, but landing at colonies instead of trade hubs.
- Travel is **land/teleport**: pick a colony (or empty ground near one), arrive.
- **Risk:** while on a foreign map you are visible and attackable, exactly like
  being on a site map. No safe tourism.
- Cost model (open): jump charge per trip, same as forward-base jumps? See §7.

## 5. Raiding ACTIVE colonies (the new avenue)

- The world map makes active colonies visible → raidable, not just sites.
- This does NOT replace site raiding; it's a second avenue. Player choice, like the
  real world: hit a site, or hit a colony.
- Raiding an active colony is real PvP with real stakes (defender's troops defend;
  loot = cargo rules apply — equipped modules are NOT lootable, per the locked rule).
- **Open:** warning/alarm for the defender? Response window? (Mirrors the rally
  maneuver response-window philosophy — defenders get a chance.)
- **Open:** can a colony be destroyed/captured, or only looted? (Recommend: looted,
  not captured — capture is a v2 escalation.)

## 6. What this does NOT change

- Site raiding stays exactly as-is. Two avenues, player picks.
- Cargo-only loot rule stands (equipped modules never lootable).
- Artifacts: only change hands in real PvP per the locked rule — gleaning an
  abandoned colony does NOT yield artifacts (the owner didn't lose them in battle).
- "You can't buy legend" — gleaning gets you supplies and bodies, never legend.

## 7. Locked decisions (Hans, 2026-10-02)

1. **Reclaim:** no penalty — the returning owner gets everything that's left.
2. **Travel cost:** same jump charge as forward-base jumps.
3. **Active raid warnings:** YES. The defender gets warned. Hans: "this then makes it
   worth the risk — they know they're going to be exposed the minute they touch down.
   It depends on if they're strong enough to defend themselves. That means it's a
   real mission, not just going in and getting free stuff."
4. **Colony destruction:** looted only for v1. No razing.
5. **Timer:** 30 days firm. Hans's reasoning: "for the first 30 days there will be no
   colonies to glean — you will have to attack. This gives everybody a fair chance
   to grow." (30 days ≈ 1/3 of a 12-week season.)
6. **Visibility:** NOT all-visible. Gated behind planetary scouts (see §8).

## 8. Planetary scouts (Hans, 2026-10-02)

Hans reversed the "see all colonies" call mid-thought and replaced it with this:

- A **probe**: must be researched, then built. One-time use.
- Shoot it at a planet. After several hours, it returns a **report**.
- The report shows: **player count vs. colony count** on that planet — actives vs.
  colonies (abandoned).
- What it tells you: whether there are ample colonies relative to players — i.e.,
  whether the trip is worth the jump charge. Odds, not certainties.
- What it does NOT tell you: whether those colonies have already been raided or
  gleaned. No guarantees of loot.
- You don't know what's really there until you land and look yourself.
- Design note: this is fog-of-war as a resource sink — the probe costs research +
  build + hours, and buys you a probability, not a promise. Fits the "real world,
  player choice with risk" frame: you gamble the jump charge on the scout's odds.

## 9. Jump ships & touchdown defense (Hans, 2026-10-02)

Hans: "when these guys jump in and touch down I want a defense they can deploy
around their base for their jump ship. This defense is only what they brought
with them — we're going to have to put parameters on how much can be brought.
This is going to bring in different types of ships they can build."

- **Ships are buildable.** Different ship types with different roles/capacities.
  (The ship roster is a new design surface — see open questions.)
- **Every jump uses a ship.** The ship is your ride there and your ride home.
- **Cargo parameters:** each ship type has a cargo capacity. What you bring —
  troops, supplies, defense emplacements, gleaning gear — must fit. No infinite
  pockets: the loadout is the strategy.
- **Touchdown defense:** on landing, you deploy a perimeter around your base /
  jump ship from what you brought. The defense protects:
  - The jump ship itself (lose it and you're stranded — or pay a rescue cost?)
  - The gleaning/raid operation while it runs
- **The defense is finite:** it only lasts as long as what you brought. No
  resupply on a foreign world (unless you glean it locally — risk/reward).
- This is the EVE turn Hans called out: ships as the platform, cargo as the
  constraint, deployed defense as the minigame. The jump is no longer "teleport
  and loot" — it's an expedition with a supply line that can be cut.

### Open ship questions (for Hans)

1. **Ship roster:** how many types? (Starter idea: shuttle / frigate / hauler —
   scout-fast, fight-balanced, cargo-fat. Hans to name them.)
2. **Stranded:** if the jump ship is destroyed, what happens? (Options: pay a
   rescue jump charge, wait for an alliance pickup, lose the expedition force.)
3. **Defense emplacements:** are they a new buildable (turrets, shields), or
   do troops double as defense? (Recommend: troops + a buildable turret line.)
4. **Ship building cost:** supplies + materials? Research-gated per type?

## 10. Ship roster (Hans, 2026-10-02 — defining all six)

### Ship 1: Scout (name TBD)
- **Role:** forward eyes. Probes for targets, assays sites.
- **Speed:** fast. **Observability:** hard to pick up on satellite (low signature).
- **Cargo:** light troops ONLY. No siege. No defense emplacements — in fact no
  defense at all.
- **Complement:** mostly logistics troops, a few guards to protect the logistics,
  one or two scientists, one leader.
- **Purpose:** goes and gets honest real information. Two jobs:
  1. Probe for targets (scout colonies — is it worth sending the real force?).
  2. Assay a site (make sure you're not landing where someone's already working
     the site and walking into an ambush).
- **Relationship to probes:** the planetary probe (§8) gives you colony-vs-player
  counts (odds). The scout ship gives you ground truth. Probes stay — they're
  cheap and wide. The scout is expensive and precise.

### Ships 2–6: TBD (Hans defining)

### Ship 2: Frigate (name TBD)
- **Role:** escort. Flies cover for the scout ship.
- **Armament:** light turrets, light shields. That's all it has.
- **Signature:** HIGH on satellite — easy to pick up. Escorting means risking
  exposure. (Trade-off: protection vs. stealth.)
- **Limitations:** CANNOT land. CANNOT deploy defense. CANNOT carry troops.
- **Purpose:** "in-the-sky eyes" — overwatch. It watches from above while the
  scout works the ground. If trouble comes, the frigate's turrets buy the scout
  time to lift.
- **Design note:** the frigate/scout pair is the core tactical unit — stealth +
  overwatch, with the exposure trade-off as the decision point.
