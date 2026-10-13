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

1. **Ship roster:** all six defined ✓ (Scout, Frigate, Bulwark, Vanguard,
   Fat Cat, Herald). Race variants named for all.
2. **Stranded:** LOCKED (Hans, 2026-10-02) — see §11.
3. **Defense emplacements:** are they a new buildable (turrets, shields), or
   do troops double as defense? (Recommend: troops + a buildable turret line.)
4. **Ship building cost:** supplies + materials? Research-gated per type?

## 11. Stranded & rescue (Hans, 2026-10-02)

When a jump ship is destroyed, its crew is **stranded**. They wait for rescue.

- **Self-rescue:** you can send your OWN rescue team. You don't have to wait.
- **Alliance alert:** alliance members are alerted that a member is down and
  stranded. They can send a pickup too.
- **THE BEACON:** when the ship goes down, **communication is lost**. All that
  goes out is a beacon — position, nothing else.
- **You don't know what's waiting.** Enemies can camp a rescue beacon. The force
  that destroyed your ship might still be there. Or someone else found it first.
- **Rescue is a combat operation.** You're not sending a shuttle — you're sending
  a fighting force: troops to sweep and hold while you load the leader, the
  survivors, and whatever supplies you can grab.
- Design note: the beacon turns every ship loss into a potential ambush — for
  BOTH sides. Campers risk the rescue force; rescuers risk the campers. The
  information blackout (beacon only, no comms) is what makes it sing.

## 10. Ship roster (Hans, 2026-10-02 — defining all six)

### Ship 1: Scout (name TBD)
- **Role:** forward eyes. Probes for targets, assays sites.
- **Speed:** fast. **Observability:** hard to pick up on satellite (low signature).
- **Cargo:** light troops ONLY. No siege. No defense emplacements — in fact no
  defense at all.
- **Complement:** a small amount of troops — T1 guards up to T4 veteran guards
  (per the veteran-vs-newbie spec), mostly logistics, a few guards to protect
  the logistics, one scientist, one leader. (Hans: "they literally have troops,
  one scientist and one leader.")
- **Defense:** the troops ARE the defense. No shields, no turrets to speak of.
  If the scout gets caught, its guards fight — that's it.
- **Purpose:** goes and gets honest real information. Two jobs:
  1. Probe for targets (scout colonies — is it worth sending the real force?).
  2. Assay a site (make sure you're not landing where someone's already working
     the site and walking into an ambush).
- **Relationship to probes:** the planetary probe (§8) gives you colony-vs-player
  counts (odds). The scout ship gives you ground truth. Probes stay — they're
  cheap and wide. The scout is expensive and precise.

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

### Ship 3: Bulwark (troop / defense ship)
- **Role:** the workhorse. Carries troops AND defense (turrets + shields).
- **Loadout:** configurable within capacity — mix turrets/shields/troops as you
  like, or go heavy on one. The capacity is the constraint; the mix is the
  strategy.
- **Purpose:** lands, deploys a perimeter, holds ground. This is the ship that
  puts boots on a foreign world and keeps them alive.
- **Race variants** (each race builds their own, with their own name):
  - Grays: **Warden Lattice** — interlocking tech, precise coverage
  - Draconians: **Ashen Bulwark** — heavy armor, built to take punishment
  - Watchers: **Threshold Bastion** — celestial geometry, holds the line
  - Ashtar: **Accord Aegis** — peacekeeper design, defense-first
  - Annunaki: **Gilded Rampart** — gold-trimmed, built like a palace wall
  - Nephilim: **Stoneshield** — massive, blunt, unmovable
  - Unbound: **Radiant Bulwark** — light-wrought, transcendent design

### Ships 4–6: TBD (Hans defining)

### Ship 4: Vanguard (heavy escort / all-rounder)
- **Role:** a step above the frigate. Carries troops AND defenses.
- **Armament:** decent turret and shield package — withstands light to
  medium-heavy fire.
- **Primary job:** escorts drill ships and mining ships extracting minerals,
  materials, chipsets, and embers.
- **Secondary:** site and colony raiding. An all-around good ship for any party.
- **Exposure:** HIGH. Any stage-2 satellite recognizes it as a ship to be
  dealt with. Bringing a Vanguard means you've decided stealth is over.
- **Race variants:**
  - Grays: **Calculus Vanguard** — cold math, optimal coverage
  - Draconians: **Ashen Vanguard** — burns bright, hits hard
  - Watchers: **Seraph Vanguard** — wings spread, unbroken line
  - Ashtar: **Accord Vanguard** — peace through superior firepower
  - Annunaki: **Gilded Vanguard** — gold and thunder
  - Nephilim: **Stone Vanguard** — the mountain moves
  - Unbound: **Radiant Vanguard** — dawn's iron fist

### Ship 5: Fat Cat (heavy hauler)
- **Role:** the prize. Packing armor, digging rigs, and enough cargo to haul
  supplies back in substantial amounts.
- **Can raid:** goes on colony raids too — but that's not its job. Its job is
  to carry the loot home.
- **Exposure:** MASSIVE. Definitely recognized, definitely targeted. The
  residents of a planet will jump on a Fat Cat if they can — killing one is
  a trophy. "They would love nothing more than to get themselves a fat cat
  kill."
- **Design note:** the Fat Cat is the risk/reward engine. Bring it and you can
  haul a fortune — but everyone on the planet knows it's there, and they all
  want it dead.
- **Race variants:**
  - Grays: **Ledger Hauler** — every gram accounted for
  - Draconians: **Hoard Drake** — dragons hoard, it's what they do
  - Watchers: **Tithe Bearer** — heaven's quartermaster
  - Ashtar: **Compact Hauler** — the Accord's purse
  - Annunaki: **Golden Belly** — fat with the king's gold
  - Nephilim: **Mountain's Maw** — swallows whole
  - Unbound: **Cornucopia** — abundance, radiant and heavy

### Ship 6: Herald (logistics / command)
- **Role:** the one that saves everybody's ass. No weapons — all logistics.
- **Systems:**
  - **Radar:** ample warning time of incoming attack. Sees them coming.
  - **Radar jamming:** blinds their eyes while yours stay open.
  - **Target painting:** coordinates defenses — paints targets so every gun
    on the ground knows what to hit.
  - **Multiple modules:** all logistics, no guns. Coordination is the weapon.
- **Purpose:** coordinates troops and defenses on the ground. The Herald doesn't
  fight — it makes everyone else fight better.
- **Exposure:** moderate. No weapons means satellites don't flag it as a
  warship — but anyone who's seen one work knows what it does.
- **Race variants:**
  - Grays: **Array Herald** — the mind that sees all
  - Draconians: **War-Drum** — the beat the army marches to
  - Watchers: **Trumpet Herald** — the last bell, rung early
  - Ashtar: **Concord Herald** — harmony of fire
  - Annunaki: **Royal Signal** — the king's voice, carried on light
  - Nephilim: **Thunder Call** — the mountain speaks, the army listens
  - Unbound: **Dawn Herald** — radiance that organizes

## 12. Ship build times & costs (Hans, 2026-10-02)

Hans: "we don't want long times... if we want the action to actually roll in
this game they need to be building shit quickly. 12 weeks isn't much time."

Principle: **ships build in hours, not days.** A player should be able to lose
a ship and have its replacement before the next day's session. The season is
12 weeks — a 3-day build is 1/28th of the season for one hull. Unacceptable.

### Build times (tunable)
- **Scout:** 2 hours — it's small, fast to print.
- **Frigate:** 4 hours — light turrets/shields, still lean.
- **Bulwark:** 8 hours — the big one. Troops + turrets + shields take time.
- (Ships 4–6 to be timed when defined — scale by role, cap at ~12h for the
  largest.)

### Who can build what (Hans, 2026-10-02)
- **Scout:** buildable solo. One person, no alliance needed. This is the only
  ship an individual can build alone.
- **All other ships** (Frigate, Bulwark, Vanguard, Fat Cat, Herald): **alliance
  only.** Built through an **alliance ship factory.**
- You want warships? Join an alliance. The real military power requires
  organization. Solo players get eyes (scouts); alliances get fists.
- Design note: this is the alliance recruitment engine. The scout lets you see
  the war; the alliance lets you fight it.

### Alliance ship factory (Hans, 2026-10-02)
- **Build efficiency scales with active contributors.** The more alliance members
  actively contributing to a ship build, the faster it completes. A dead
  alliance builds slow; a live one builds fast.
- This is the activity engine: alliances MUST have enough people active every
  day to build ships. No activity, no fleet.
- **Alliance cap: 100 members** (up from 50). Hans: "100 members is better than 50."
- **No cap on alliance count per planet.** Could be 15, could be 1,000 — we
  don't have any say on that. Players organize how they want.
- **Beachheads are cross-alliance.** A beachhead doesn't care about alliance
  tags — it'll take everybody from a planet/race. The invasion is bigger than
  any one alliance.

### Build costs
- **Supplies** as the base (the universal currency).
- **Race materials** for the hull (your own + alloys for bigger ships).
- **No Codices** — ships are industry, not knowledge. Research unlocks the
  blueprint; building is just materials + time.
- Proposed:
  - Scout: 500 supplies + 10 of your race material (solo-buildable)
  - Frigate: 1,000 supplies + 20 of your race material + 2 alloys (alliance)
  - Bulwark: 2,000 supplies + 40 of your race material + 5 alloys (alliance)
  - Vanguard: 1,500 supplies + 30 of your race material + 3 alloys (alliance)
  - Fat Cat: 3,000 supplies + 50 of your race material + 8 alloys (alliance)
  - Herald: 1,200 supplies + 25 of your race material + 2 alloys (alliance)

### Why fast works
- The 10,000 starting supplies (Hans's "get into the action fast" rule) means
  a new player can have a scout flying within hours of starting.
- Losing a ship stings (materials + time) but doesn't bench you for a week.
- Fast builds = more jumps = more gleaning/raiding = more action = the game
  Hans wants.

### T4 troops (Hans, 2026-10-02)
- **Research to T4:** ~38 days via the research tree (mid-season unlock).

### Troop build rates (Hans, 2026-10-02 — "honest, memorable numbers")
- **T1:** 1,000/day — the horde. Cheap, fast, endless.
- **T2:** 50/day — real soldiers. Twenty times scarcer than T1.
- **T3:** 10/day — elites. Five times scarcer than T2.
- **T4:** 2/day — legends. Five times scarcer than T3.
- **These rates are per unit type.** Every troop type builds at its tier's rate —
  guards, logistics, and the rest each get their own 1000/50/10/2 pipeline.
- The curve (1000 → 50 → 10 → 2) is the point: T1 is cannon fodder you can
  drown the map in; T4 is two precious units a day that you protect with your
  life. Losing a T4 hurts because you can't just print another hundred.

### Why all tiers stay buildable (Hans, 2026-10-02)
- T1s aren't obsolete — they're **fast, agile, lightweight**. They die easy,
  but they're **harder to track and hit**. Speed IS their armor.
- Each tier is a tactical choice, not a straight upgrade:
  - **T1:** speed and evasion. Hard to hit, dies when hit. Scouts, harassment,
    flanking, screening.
  - **T2:** the balanced line. Real soldiers.
  - **T3:** elites. Heavy hitters.
  - **T4:** legends. Slow, devastating, precious — the hammer you protect.
- You don't stop building T1s when you unlock T4. You build T1s BECAUSE
  they're fast and slippery, and T4s because they end fights. Different jobs.

### Scale: mass & damage drama (Hans, 2026-10-02)
- Troop counts in the **tens of thousands**. "Oh my God, he's got 30,000 troops
  on the ground" — that's the reaction we're designing for.
- Losses must feel massive. Losing 5,000 troops in a bad drop should hurt.
- The scale is what makes the rescue beacon, the ambush, and the gleaning
  dramatic. Small numbers don't create stories; 30,000 troops do.

## 13. Beachhead vs raiding party (Hans, 2026-10-02)

These are **different operations**. Don't confuse them.

### Beachhead: the invasion
- **Builds troops.** This is what makes it a real invasion — you plant, you
  build, you sustain.
- **Planned and coordinated.** Supplies brought in, multiple players
  contributing. A beachhead is a logistics operation.
- **Scales to thousands.** A beachhead can bring in thousands of players if
  coordinated correctly. A thousand people with supplies coming in — that's
  enough to sustain a real invasion. The beachhead is where the supply lines
  live.
- **Sustained presence.** Without a beachhead, you're just visiting. With one,
  you're staying.
- (See design/forward-base.md for the full beachhead spec.)

### Raiding party: the heist
- **Max 5 players.** Small group, hit-and-run.
- **Pre-coordinated.** The five must coordinate BEFORE they go — who's bringing
  what, who's hitting which colony, what's the exfil plan.
- **Cannot sustain.** No troop building. What you brought is what you have.
  (This is why the ship cargo constraint matters — §9.)
- **Purpose:** glean abandoned colonies, raid active colonies (loot-only v1),
  get out. A raiding party that tries to stay becomes a stranded beacon (§11).
- Design note: the 5-player cap forces coordination. You can't zerg a raid —
  you have to plan it. The beachhead is where the zerg lives.

## 14. Planetary reverb (Hans, 2026-10-02)

**Not** the artifact reverb (named-gear reverb is different — see
design/named-gear-reverb.md). Planetary reverb is a planet's **overall
strength signature**.

- **What feeds it:** colonies + active members + their builds + troops. Troops
  add reverb — more troops, more reverb. Better troops, more reverb per head.
- **Trackable.** Reverb is a number you can watch. It moves.
- **Under attack, reverb drops.** A planet taking heavy losses and bleeding
  troops shows falling reverb. That's your signal it's weakening.
- **But reverb doesn't reveal composition.** A planet full of T1s can show big
  reverb — it doesn't mean it's easy, it means you've got a lot of pew-pew to
  do to chew through that volume. A planet stacked with T4s showing the same
  reverb is a completely different fight — tough all the way through.
- **The tactical puzzle:** reverb tells you HOW MUCH. It doesn't tell you WHAT.
  That's what the scout ship is for (ground truth). Probes give you odds;
  reverb gives you strength; only landing tells you composition.
- Design note: reverb turns the world map into a living threat board. Watching
  a rival planet's reverb crater in real time while someone else hits them —
  that's the kind of thing that starts wars.
