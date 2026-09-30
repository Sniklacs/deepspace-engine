# Spec — Musters & Troops (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** This document specifies the
> structure, rules, and engine seams the engineer will implement **later**. It is
> written to the same standard as the other build docs (`forward-base.md`,
> `leader-xp.md`): concrete, buildable, self-contained.
>
> Owner-approved frame (locked, do not redesign): **troops are real entities** —
> the battle engine's "supply-weighted troop counts" (`war-types.ts`) must
> resolve to actual mustered soldiers, not ghost numbers. **Five troop types**,
> one per war role, uniform across races. Mustered at the Cradle; **alliances
> can never help troop builds** (owner decision 2026-09-30).

---

## 0. Locked principles this spec builds within

1. **Troops are the mass; heroes are the edge.** Heroes lead, carry modules,
   and make decisions. Troops are the bodies that hold the line, march the
   offense, and die in the casualty fractions. The game needs both, and they
   are never the same system.
2. **Five types, one per war role** (`armory.ts`): frontline, assault,
   precision, siege, engine. Uniform mechanics across every race; race-flavored
   names and art per race (like the weapon families).
3. **Mustered, never conjured.** Every soldier costs supplies and time at a
   barracks. No free troops, no event-granted armies that skip the muster.
   (Whether a *mercenary* market exists is an owner question — §8.)
4. **Troops eat.** Upkeep per troop per hour, home and away. An unfed army
   deserts — the same starvation logic as the forward base (`forward-base.md`
   §5). This is one system, not two.
5. **No alliance help on troops.** Allies can shave time off your buildings
   and research (scales with Cradle tier), but they can never touch your
   muster queues. The troop economy stays honest: you raise your own army.
6. **The battle engine is the customer.** The muster system's job is to
   produce the numbers `war-types.ts` already expects: supply-weighted troop
   counts, FOB-stage caps, reinforcement pools. If a muster field doesn't feed
   the battle engine, it doesn't ship.

---

## 1. The five troop types

| Type | War role | Battlefield job | Supply weight (proposed) |
|---|---|---|---|
| **Bulwark** | Frontline · hold the line | Holds ground, absorbs casualties | 1 |
| **Reaver** | Assault · march offense | Shock attacks, breaks lines | 1 |
| **Longeye** | Precision · zone denial | Ranged denial, picks targets | 1 |
| **Thunder** | Siege · bombardment | Breaks walls, static damage | 2 |
| **Warden** | Engine · escorts & shields | Protects others, logistics | 1 |

- Names above are placeholders — each race renames them (Draconian "Scalebreakers",
  Gray "Calculus Cadres", etc.), same convention as the armory weapon families.
- **Supply weight** is the stat that matters most: the battle engine's troop
  term runs on supply-weighted counts (`troopPowerPerTroop: 0.4`). A Thunder
  crew counts double because it eats double — the engine already assumes this.
- Types are *flavors of mass*, not rock-paper-scissors. Counters live in
  heroes, modules, and decisions — troops are the clay those systems sculpt.

---

## 2. Mustering

- **Where:** the Barracks at the Cradle (home), and the beachhead barracks at
  a forward base (`forward-base.md` §4 — troops-only production).
- **How:** a muster queue per troop type. Each soldier costs supplies
  (proposed: 4 supplies per weight-1 troop, 8 per weight-2 — tunable) and
  muster time (proposed: 30s per troop at base rate, parallel queues per type).
- **Caps:** the Cradle's tier sets the home garrison cap (proposed: T1 200 →
  T5 2,000 — tunable) and the number of parallel muster queues. The forward
  base cap is fixed small (proposed: 500 — `forward-base.md` §10).
- **Veterancy (proposed, v2):** troops that survive battles gain veterancy —
  small stat bumps, tracked per cohort. Not in v1; the casualty system (§5)
  must be built to support it later (cohorts, not anonymous counts).
- **No alliance help. Ever.** Restated because it will be tempting: the
  muster queue takes no external ticks. Allies help buildings and research;
  armies are yours alone.

---

## 3. Upkeep — the hunger system (one system, two homes)

- Every mustered troop consumes supplies per hour (proposed: 1 supply per 10
  troops per hour — same knob as `forward-base.md` §10, because it IS the same
  knob).
- Home: the colony's supply stockpile feeds the garrison. Forward base: the
  raided stockpile feeds the beachhead. Same code path, different stockpile.
- **Hunger stages (shared):** stockpile empty → 24h foraging grace → 5%
  desertion per hour until fed or gone. Desertion hits the *newest* troops
  first (the least invested — veterans desert last).
- The design intent: army size is a *liability* as well as an asset. A huge
  idle garrison is a mouth to feed. This is what keeps the economy honest and
  makes raiding necessary rather than decorative.

---

## 4. The battle-engine seam

This section exists so the engineer never has to guess what the war layer
wants. All references are to `site/src/game/war/war-types.ts`:

- `troops: number` on every battle side = **sum of supply weights** of the
  committed troops. The muster roster produces it; the engine consumes it.
- `fobTroopCapByStage: [100, 150, 250, 400, 600]` = the FOB-stage ceiling on
  how much supply-weight can be *fielded*. Troops above the cap queue behind
  the front (real supply, no combat power) — the muster system must track
  committed vs. reserve.
- Reinforcement decisions (`"reinforce"`) pull from the **reserve pool** —
  real troops leave the garrison and enter the battle. They can die there.
- The `war-energy.ts` action costs (march 20, aid 10) are paid in energy;
  the *troops* are paid in bodies. Both gates must pass.

---

## 5. Casualties — where soldiers go

- Battles resolve casualty fractions per side (already in `war-types.ts`:
  withdrawal rearguard, retreat 8%, rout risk). The muster system applies them
  to the roster: the committed troops shrink by the fraction.
- **Death order:** freshest first, veterans last (same rule as desertion —
  the invested survive longest, which makes veterancy meaningful when it
  lands).
- **The memorial feed:** every engagement writes its casualty record to the
  battle history. This is the data `forward-base.md` §9 plaques read from —
  no casualty records, no memorials. Build the feed with the muster system,
  not later.
- Heroes falling is separate (`forward-base.md` §7): cargo lootable, equipped
  modules safe. Troops carry no loot — they ARE the loot's escort.

---

## 6. What troops are NOT

- **Not heroes.** Heroes level, carry modules, make decisions, get names on
  plaques. Troops are counted, fed, and mourned in aggregate.
- **Not modules.** Modules are gear with fixed stats (`forward-base.md` §8);
  they equip onto heroes (and in v2, onto cohorts). Troops are the bodies
  under the gear.
- **Not artifacts.** Nothing random, nothing legendary. A soldier is a
  soldier — the legend is what they *do*, which is why the memorial feed (§5)
  matters more than any troop stat.

---

## 7. Tunables (all numbers proposed, none locked)

| Knob | Proposed | Notes |
|---|---|---|
| Muster cost | 4 supplies / weight-1 troop | The economy's faucet |
| Muster time | 30s / troop, parallel per type | Queues, not clicks |
| Home garrison cap | T1 200 → T5 2,000 | Cradle tier scales it |
| Forward garrison cap | 500 | Fixed — a knife, not a home |
| Upkeep | 1 supply / 10 troops / hour | Shared with forward-base §10 |
| Hunger grace → desertion | 24h → 5%/hour, newest first | Starvation evaporates armies |
| Supply weights | 1 / 1 / 1 / 2 / 1 | Thunder crews eat double |

---

## 8. Open questions for the owner

1. **Mercenaries:** can troops ever be bought — a sellsword market — or is
   the muster the only door? (Leaning: muster-only. Selling soldiers smells
   like the sell-everything clone we're avoiding.)
2. **Veterancy in v1 or v2?** It needs cohorts tracked through casualties.
   Cheap to reserve, expensive to retrofit — call it now.
3. **Troop type stat spreads:** beyond supply weight, do types differ in
   power per troop, or is weight the only lever? (Proposed: weight is the
   only lever in v1; heroes/modules provide the texture.)
4. **Muster time curve:** linear per troop, or batch discounts for big
   musters? (Proposed: linear — big armies should feel expensive in *time*
   too, which is what makes the alliance help-tick rule bite on buildings
   but not here.)
5. **Desertion vs. mutiny:** at deep starvation, do deserters just leave —
   or do some defect to the Chorus/other players? (Flavor with teeth. v2.)

---

## 9. Build seams (for the engineer, later)

- `TroopRoster`: `{ [type]: { count, veterans, committed } }` on the colony
  and on the forward base. Committed vs. reserve is the field the battle
  engine reads.
- `supplyWeight(type)` → the single function the war layer calls. If the
  engine ever computes weight itself, that's a bug — one source of truth.
- Muster queue: validated server action (cost check → deduct → enqueue →
  timed completion). Same authority rule as jumps and Xsolla webhooks: the
  server is the truth, the client is a suggestion.
- Upkeep tick: the same hunger job serves home garrisons and forward bases —
  parameterize the stockpile, don't fork the logic.
- Casualty application: pure function `(roster, fraction) → roster` —
  testable, deterministic, shared by every battle resolution path.
- Battle history feed: append-only casualty records `{ battleId, site,
  season, factions, lossesByType, fallenHeroes }` — the memorial plaques read
  this and nothing else.
