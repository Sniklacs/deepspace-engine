# Spec — Modules: the sellable tier (authoritative build doc)

> Status: **build spec — nothing is built.** This document specifies the
> module item model, forge crafting, deterioration, loadout equip, loot
> integration, economy, and battle modifiers, in the same standard as the
> other build docs: concrete, buildable, self-contained.
>
> Owner-authorized 2026-10-01: start the module build. This is the
> commodity/power tier Hans approved — forge-crafted, fixed attributes,
> sellable, deteriorating. It is NOT the legend tier and must never touch it.

---

## 0. Locked principles this spec builds within

1. **Modules are rented power; legend is owned story.** A whale buys a full
   tier-4 kit — strong today, scrap within a season (deterioration §4, season
   wipe §8). A grinder earns a name (named-gear-reverb.md). Neither can buy
   the other's thing. "You can't buy legend" survives because modules can
   never be named, never carry reverb, never ascend to artifact.
2. **Artifacts are never merchandise.** Modules do NOT touch the relic slot —
   it stays locked until the artifact inventory model lands (forge.ts,
   LoadoutTab). No module may be named (reverb spec §0.5, §8 — "nobody names
   a hammer they're going to melt").
3. **Cargo-only loot.** Equipped modules are NEVER lootable when a hero
   falls — only cargo (§6). The Chorus never picks up loot.
4. **Commodities, not snowflakes.** Every "Siege Coil Mk II" has identical
   stats. No rolls, no grades, no surprises. The forge makes weapons;
   the forge *manufactures* modules. That contrast is the design.
5. **No two players the same.** Modules are interchangeable — uniqueness
   comes from loadout *choices* (which lines on which heroes), market
   specialization (forgers vs. raiders vs. traders), and timing, not from
   the items themselves.

---

## 1. The module item model

### 1.1 The commodity contract

A module is fully described by **(line, tier)**. Two modules of the same
line and tier have byte-identical stats. They differ only in identity,
condition, owner, and provenance. This is what makes them tradable
commodities instead of treasures.

### 1.2 The lines (v1)

Four lines, each with a fixed stat profile on the power/guard axes — the
axes `engine.resolveHeroEquipment` feeds into battle today (§7). No
precision/logistics lines in v1: the battle engine does not consume those
axes from hero gear, and a line that does nothing is a lie.

| Line | Id | Profile | Fantasy |
|------|----|---------|---------|
| Siege Coil | `siege-coil` | pure power | damage |
| Aegis Plate | `aegis-plate` | pure guard | armor |
| Warden Mesh | `warden-mesh` | guard + small power | defense |
| Striker Rig | `striker-rig` | power + small guard | assault |

### 1.3 The fixed table

One table, `MODULE_LINES`, in the same style as `FORGE_GRADES` — the single
source of truth. Stats are integers on the `WeaponStats` axes
(power/precision/guard/logistics), so `weightedPower()` prices a module
with the exact formula that prices a forged weapon.

Tiers are Mk I–IV, mirroring the armory. Proposed stat sizing (tunable,
not locked): the single-axis value at tier *t* ≈ this fraction of
`forgeCeilingPower()`:

| Tier | Single-axis | Hybrid primary | Hybrid secondary |
|------|-------------|----------------|------------------|
| Mk I | 0.06 | 0.05 | 0.02 |
| Mk II | 0.10 | 0.08 | 0.03 |
| Mk III | 0.15 | 0.12 | 0.05 |
| Mk IV | 0.22 | 0.18 | 0.07 |

Design bound (locked): a tier-4 single-axis module stays well under a
makeshift forge weapon's band (0.45–0.58 of ceiling). Modules *supplement*
a hero; they never replace the weapon.

### 1.4 The record

```ts
interface ModuleItem {
  id: string;                    // unique identity — trade, loot, escrow move THIS
  line: ModuleLineId;            // "siege-coil" | "aegis-plate" | "warden-mesh" | "striker-rig"
  tier: 1 | 2 | 3 | 4;
  name: string;                  // generated: line name + "Mk " + tier — never player-set
  stats: WeaponStats;            // FIXED from MODULE_LINES[line][tier] — never rolled
  power: number;                 // weightedPower(stats) — fixed
  condition: number;             // 0..100 — the deterioration clock (§4)
  warplateSpent: number;         // for melt-back
  suppliesSpent: number;
  embersSpent: number;
  ownerId: string;
  ownerName: string;
  location: ForgeLocation;       // "cradle" | "transit" | "field" — same machinery as forge items
  locationSince: number;
  equippedBy: { kind: "hero"|"leader"; id: string; slot: "module1"|"module2" } | null;
  provenance: { craftedAt: number; gameId: string | null; race: RaceId | null; seq: number };
}
```

`broken` is derived (`condition <= 0`), never stored. There is no grade,
no roll history, no name field for players to fill — the record shape
itself enforces the commodity contract.

### 1.5 How modules differ from forge weapons

| | Forge weapon | Module |
|---|---|---|
| Stats | random-rolled, one-of-a-kind | fixed per (line, tier) |
| Grades | five bands | none |
| Naming | legendary rolls named by player | never nameable |
| Reverb | hidden attributes, deed-weight, artifact path | none, forever |
| Deterioration | none — permanent-ish | breaks with use |
| Season | named/carried may persist | wipes, always |
| Trade | transferable | listable commodity |

---

## 2. Forge crafting

### 2.1 Recipes — one per line, tier from progression

`MODULE_RECIPES`: four recipes, one per line. The crafted tier is
**deterministic**: `tier = min(4, industry domain level)`. No roll, no
floor, no weights — the recipe always produces exactly what the table
says. That determinism is what lets the market price them.

Costs scale by tier (proposed, tunable):

| Tier | Warplate | Supplies | Embers |
|------|----------|----------|--------|
| Mk I | 2 | 60 | 15 |
| Mk II | 4 | 110 | 30 |
| Mk III | 7 | 200 | 55 |
| Mk IV | 11 | 340 | 95 |

The craft is atomic like forge rolls: deduct + materialize in one
operation. `condition` starts at 100.

### 2.2 Unlock

Industry domain gates, one step below the weapon recipes (modules are the
accessible tier): `siege-coil`/`aegis-plate` at industry 1,
`warden-mesh`/`striker-rig` at industry 2. The UI always prints what a
locked recipe needs — never a hard-lock (forge.ts convention).

### 2.3 Melt-down (the scrap loop)

Modules melt like forge pieces: warplate back scaled by tier
(proposed: `0.5 × warplateSpent × (0.8 + 0.2 × tier)`), supplies back at
the forge's quarter fraction. Broken modules melt for **25% of the normal
refund** — scrap, not value. Melt is the floor under the market: no module
is ever worth less than its scrap.

### 2.4 Rack limits

Modules share the forge's rack discipline: they count toward a save-size
bound (proposed: modules share `FORGE_CONFIG.maxItems`, or a separate
`maxModules: 48` — engineer picks the cheaper seam; the bound must exist).

---

## 3. (unchanged — deterioration is §4; numbering kept stable for refs)

---

## 4. Deterioration — the replacement-demand loop

### 4.1 What ticks it

Two clocks, both proposed/tunable:

- **Battle tick:** −5 condition per battle the bearer is committed to with
  the module equipped. Only real battles — arena mock battles do NOT tick
  (the arena is bloodless; the proving ground doesn't wear out your gear).
- **Idle tick:** −1 per 24h while equipped. Racked, cargo, or in-transit
  modules do not decay — storage is protection (forge.ts convention).

A module therefore lasts ~20 battles of frontline use. A casual fighting
a few battles a week gets a month+ per module; a grinder chains replacements.

### 4.2 Breakage

At condition 0 the module **breaks**: its stats contribute 0, it stays
equipped in its slot (visible BROKEN state), and it can be unequipped or
melted for scrap but never listed, wagered, or repaired.

**No repair.** This is locked by design: repair would kill the replacement
loop that feeds forgers and the market. A broken module's only futures
are the crucible or the bin.

### 4.3 Casual protection (locked shape, tuned numbers)

- Decay accrues only on **use** (equipped + bearer fights). A module
  sitting on the rack is immortal.
- Breaking never strands a hero: the slot works empty, unequip is free,
  and Mk I replacements are cheap (§2.1).
- The UI warns at condition ≤ 20 ("worn") and ≤ 5 ("failing") — no silent
  breakage mid-campaign.

---

## 5. Equip rules — module1 / module2

### 5.1 Unlocking the slots

`LoadoutTab`'s module slots flip from `fits: null` to `fits: "module"`;
the relic slot is untouched. Equip/unequip/swap follow the existing
`equipForgeItem` pattern: one occupant per slot, swapping returns the old
module to the racks, server-authoritative through the same API fns.

### 5.2 The no-duplicate-line rule (proposed, locked shape)

A bearer may not wear the same line twice (no double Siege Coil). Two
slots exist for *choices* — coil + plate, mesh + rig — not for stacking
one stat. This is a loadout decision with a real opportunity cost, and
it's what keeps two fully-kitted heroes from feeling identical.

### 5.3 Breakage while equipped

A module that hits 0 mid-campaign stays in its slot, contributing 0,
flagged BROKEN. Replacing it is one tap (swap). Battle snapshots are
resolved at commit time and are never rewritten — a module breaking
*after* the snapshot doesn't change the battle already joined (the
snapshot-is-the-lock rule, war-types.ts).

### 5.4 Who can wear them

Heroes and leaders, same bearer model as weapons. No other restrictions.

---

## 6. Loot integration — cargo-only, exactly

### 6.1 The rule, stated plain

When a hero falls, what was **worn** is gone; what was **carried** is
prize. Concretely:

| Situation | Equipped modules (module1/module2) | Unequipped modules in the force's cargo |
|---|---|---|
| Bearer falls in **real PvP** | **Destroyed** — battle damage, not lootable, not recoverable | **Lootable by the victor**, split by contribution (§6.2) |
| Bearer falls vs **the Chorus** | Destroyed | **Destroyed** — the Chorus never picks up loot, and nobody else is there to take it |
| Colony/forward base plundered | n/a | Modules at location `"field"` are seizable like forge items (`seizableForgeItems` pattern); `"cradle"` stores are safe |

### 6.2 The split

Cargo modules from a victorious rally are divided by **contribution
(committed supply-weight)** — the locked alliances.md rule. No caller's
cut, no favoritism. Modules are indivisible items, so the split assigns
whole modules by contribution order (largest share picks first); any
remainder value that can't be split evenly is the commander's rounding
problem, not a new currency — the rally log shows who got what.

### 6.3 Cargo, mechanically

Modules reuse `ForgeLocation`: `"cradle"` (safe stores), `"transit"`
(supply runs), `"field"` (with a deployed force — at risk). A deploying
force assembles a cargo manifest from player-selected modules (UI in
Phase 5); battle resolution applies §6.1 to the manifest. There is no
fourth location — cargo *is* `"field"` with a battle attached.

### 6.4 Duels

Modules **may** be staked in duels (arena-market.md: stakes are modules,
supplies, materials — never artifacts). Stakes are server-escrowed on
accept; the winner takes them at full condition. This is the consensual
transfer path; the battlefield is the non-consensual one.

---

## 7. Battle modifiers

`engine.resolveHeroEquipment` extends to modules: for each equipped,
unbroken module, `attrs.power += stats.power`, `attrs.guard +=
stats.guard`. `BattleHeroEquipment` gains:

```ts
modules?: { itemId: string; name: string; line: ModuleLineId; tier: number }[];
```

for the battle report. `heroUnitPower` changes not at all — it already
folds `equipped.attrs` through `heroAttrWeights`; modules ride the same
seam as weapons. The LoadoutTab battle-modifier summary includes module
deltas, so what you see is what marches (existing convention).

Broken modules contribute 0 and are listed in the snapshot as broken
(report flavor, no mechanical effect).

---

## 8. Economy — where modules are bought and sold

### 8.1 Player market (the primary venue)

Straight from arena-market.md Part II: modules listable at fixed Scrip
prices, 5% fee destroyed on sale, 7-day expiry with return-to-seller,
per-server markets, no cross-server price visibility. Listing shows
line, tier, condition, and the fixed stats (no surprises — commodities).
**Broken modules cannot be listed** — melt them.

The market is also the price-discovery venue the store must respect
(§8.2).

### 8.2 The store (Xsolla) — bounded SKUs

Modules are the sellable tier, so store SKUs are legitimate — with
boundaries so bought power never touches legend:

- **v1 proposal:** store sells **Mk I–II of Siege Coil and Aegis Plate
  only** (the two basic lines, entry tiers). Mk III–IV are never in the
  store — the top tier is forged, traded, or looted.
- **Pricing boundary (locked shape):** the store price sits **at or above
  150% of craft cost** (Scrip-equivalent), so player-forgers are never
  undercut by the shop. The market price disciplines the shop from below;
  the shop caps gouging from above. If the market consistently undercuts
  the shop, the shop SKUs quietly stop selling — that is the system
  working.
- **What the store never sells:** Mk III+, hybrids at any tier above II,
  and — needless to say — anything named, graded, or legendary.

### 8.3 Seasons

Modules **wipe at season rollover**, like troops, stockpiles, and bases
(seasons.md). There is no vault/carry choice for modules — they are
consumables, and the wipe is part of the demand loop. A new season opens
with forgers already selling.

### 8.4 The philosophical line (for the store page, not the code)

Bought modules are *rented* power: fixed, decaying, seasonal. Earned gear
is *owned* story: named, reverb-bearing, possibly immortal. The store
sells the former and can never sell the latter. That sentence is the
whole monetization defense.

---

## 9. Phasing — landable slices

Each phase ships independently behind the existing locked-slot UI; no
phase requires the next.

- **Phase 1 — Data model.** `ModuleItem`, `MODULE_LINES` fixed table,
  `weightedPower` reuse, save-schema fields, condition/broken derivation.
  No UI, no crafting. Shippable: schema + unit tests.
- **Phase 2 — Forge crafting.** `MODULE_RECIPES`, atomic craft op, costs,
  industry-gated unlocks, melt-back + scrap. UI: forge room module
  section. Shippable: players own modules.
- **Phase 3 — Loadout equip.** Unlock module1/module2 (`fits: "module"`),
  equip/unequip/swap API fns, no-duplicate-line enforcement, broken-state
  rendering, mods summary includes modules. Relic slot untouched.
  Shippable: modules affect heroes at home.
- **Phase 4 — Deterioration.** Battle tick + idle tick in `advance()`,
  breakage behavior, worn/failing warnings, scrap melt. Shippable: the
  replacement loop runs.
- **Phase 5 — Market & loot.** Market listings (fixed price, fee, expiry,
  condition display), cargo manifest on deploy, §6 loot resolution,
  contribution split, duel escrow for modules. Shippable: the economy.

---

## 10. Open questions for Hans (decisions only you can make)

1. **Store at launch:** bounded Mk I–II basics in the store from day one
   (§8.2), or market-only at launch with store SKUs added once prices
   settle? (Proposal: bounded from day one — new players need a bootstrap.)
2. **No-duplicate-line rule** (§5.2): one of each line per bearer, or allow
   double-stacking (double coil = glass cannon as a valid identity)?
   (Proposal: keep the rule — stacking collapses loadout choice.)
3. **Repair:** truly no repair ever (§4.2), or a costly repair valve
   (e.g. 60% of craft cost restores 50% condition) for players attached
   to a specific module? (Proposal: no repair — the loop needs the
   crucible.)
4. **Deterioration pace:** −5/battle and −1/day feels right for ~20
   battles of life — faster (hotter market, harsher on casuals) or
   slower? (Proposal: ship as specced, tune in playtesting.)
