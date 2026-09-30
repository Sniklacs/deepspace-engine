# Spec — Named Gear & the Reverb (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** This document specifies
> the naming ceremony, the hidden-attribute ("reverb") system, Oracle
> readings, and the deeds-to-artifact path, in the same standard as the other
> build docs: concrete, buildable, self-contained.
>
> Owner-approved frame (locked, do not redesign): when the forge produces a
> **rare, one-of-a-kind** piece of gear — never the generic modified pieces —
> **the player names it**. The name is not cosmetic: it carries **reverb**,
> hidden attributes seeded from the name itself.

---

## 0. Locked principles this spec builds within

1. **Legend can't be bought; here, it's authored.** Artifacts and Oracle
   favor are earn-only (`MEMORY.md` — "you can't buy legend"). Named gear is
   the player-authored tier of that shelf: no store SKU will ever sell a name,
   a naming, or a reverb reading.
2. **No two players the same.** A named weapon is uncopyable by construction —
   unique item, unique name, unique hidden roll. This is the "oh shit, this is
   cool" engine for the forge.
3. **Naming is a commitment, not a form field.** One shot, locked forever,
   per-server unique. The weight of the moment is the mechanic.
4. **Reverb decides stories, not battles.** Hidden attributes are situational
   edges with character — never a flat second stat sheet. The visible
   attributes still decide the fight; the reverb decides which fights get songs.
5. **Modules stay commodities.** Modules (forge-crafted, set attributes,
   sellable, deteriorating) are never nameable. Nobody names a hammer they're
   going to melt in March. Named things are the permanent-ish shelf.

---

## 1. The rarity ladder & the trigger

Forge rolls keep their random-attribute structure (no fixed templates — can be
badass or weak), but land on a real ladder:

| Tier | Name source | Approx. odds | What it is |
|------|-------------|--------------|------------|
| Modified | Generic | ~70% | Standard modifiers, commodity gear. The workhorse. |
| Epic | **Procedural** | ~25% | Stronger rolls with *generated* epithet names ("Warden's Reaver Mk. III"). Flavor without spending the naming moment. |
| Fabled | — | ~4% | Near-top rolls, generated name, slightly wider attribute ranges. The "so close" tier that makes the top hit land. |
| **Legendary (one-of-a-kind)** | **Player-named** | **<1%** | The forge goes quiet (see §2). One per roll, unique item ID, the naming ceremony fires. |

- Odds are per-roll, independent, and **never for sale** — no forge-rigging
  consumable may touch the legendary probability. Whales buy rolls (modules,
  forge access); they cannot buy the moment.
- The legendary roll is announced **before** attributes are shown: the ceremony
  is about the naming, not about evaluating stats first.

---

## 2. The naming ceremony

When a legendary roll lands:

1. **The beat.** Full-screen takeover. The forge UI falls away; the weapon is
   revealed as a silhouette first (no stat card — the numbers come after the
   name, so the name is never "optimized").
2. **One input.** A single text field. Placeholder text in the forge-master's
   voice, e.g. *"Speak, and it will answer."*
3. **The lock.** Confirm is final: **no renames, ever, no take-backs.** The UI
   says so plainly before confirm. This is the weight that makes players stare
   for five minutes before typing.
4. **The reveal.** The name is etched (weapon card updates everywhere), the
   stat card fades in, and the forge-master speaks a generated line that
   includes the name. The moment is screenshottable by design.

### Name rules

- **Length:** 3–24 characters. Letters, spaces, apostrophes, hyphens.
- **Unique per server, first-come.** The item is unique by ID regardless; the
  *name* is unique per server so no two "Kingsbanes" cheapen each other.
  Cross-server duplicates are allowed (different worlds, different legends).
- **Profanity/slur filter** on submit (server-side list + report flow for what
  slips through). A weapon named in violation is **renamed by the forge** to a
  generated epithet — the player loses the naming, not the item. Harsh, fair,
  and stated up front.
- **No impersonation:** names may not match existing player/alliance names on
  the server.

---

## 3. The Reverb — hidden attributes

The name is mechanical. On confirm, the server:

1. Takes the normalized name + a **per-server, per-season salt** (rotated at
   season rollover, never exposed).
2. Hashes → seeds a hidden roll: **2–4 reverb attributes** from the reverb
   table (§4), each at whisper magnitude.
3. Stores them server-side on the item record. **Never sent to other players'
   clients.** Sent to the owner's client only as *discovered* (§5).

### Why the salt matters

The mapping is deliberately opaque — "Doomblade" does not mean +damage. No
keyword matching, no dataminable table. Because names lock forever and are
unique per server, each naming is an unrepeatable experiment: expressive
first, mechanical second. A/B-testing names across seasons is defeated by the
season salt; across servers, by the server salt.

### Magnitude cap (locked)

Reverb attributes are **whispers, not shouts**: each is worth roughly a
3–8% edge in its situation, and no weapon carries more than four. A named
blade should win you the fight you'll tell stories about — not every fight.

---

## 4. The reverb table (situational edges with character)

Reverb attributes are *famous-for-something* edges, not flat power. Initial
table (tune in playtesting; the shape is locked):

- **Ambusher's echo** — +1–2 min surprise window when this weapon's wielder
  leads a FLANK/REAR entry.
- **Rearguard's promise** — −10–20% rearguard casualties on withdrawal while
  wielded.
- **First blood** — wielder strikes first in duels (initiative edge, arena +
  world-speaker challenges).
- **Chorus-thirst** — +5–8% damage vs Chorus strains. The hive remembers being
  hurt by this one.
- **Pursuer** — +5–8% casualties inflicted on retreating enemies.
- **Oathkeeper** — small morale/rout-resistance aura for the wielder's
  formation when defending home soil.
- **Quiet blade** — wielder's hero contributes less intel to enemy scouts
  (composition report fuzzed).
- **Gravebound** — if the wielder falls, the weapon's *next* bearer inherits a
  trace of the fallen's deeds (provenance weight toward artifact-hood, §7).

New entries may be added per season; existing weapons never change.

---

## 5. Discovery — wielding and Oracle readings

The wielder does **not** get the full card at naming. Discovery is a loop:

- **By blood (slow, free).** Each reverb attribute surfaces after the weapon
  *does the thing*: Ambusher's echo reveals the first time a flank entry it
  leads lands a surprise; Chorus-thirst after N Chorus kills; etc. The weapon
  introduces itself through use. Undiscovered attributes show as *"⋯ unread
  reverb"* on the owner's card.
- **By Oracle reading (fast, earned).** Any of the seven Oracles can read a
  named weapon's full reverb — **devotion-gated** (per-race favor threshold,
  cf. `design/oracles-purity-layer.md`). The reading is a small ceremony: the
  Oracle speaks the weapon's nature in its joker voice. This gives Oracles a
  concrete second job and keeps favor earn-only.
- **Enemies never see it.** Reverb is excluded from scout reports, market
  listings, and battle intel. The enemy knows the hero across the field
  carries *Widow's Lament*. They don't know what it does. Intel asymmetry is
  the terror of a named blade — and the reason to read your *own* weapons.

---

## 6. Where the name lives

- **Weapon card** — the name is the title; generated epithets are subtitles.
  Named weapons get a distinct card frame (thin gold rule — recognizable at a
  glance in inventories and markets).
- **Battle reports** — named weapons are cited by name on killing blows and
  notable deeds: *"*Widow's Lament* dealt the killing blow."*
- **Market listings** — modules trade as commodities; named gear lists **with
  its name and full provenance** (every bearer, every notable deed). A named
  blade with a famous history commands a premium — the story is the value.
- **Memorial plaques** — the fallen are recorded with their named weapons:
  *"Here fell DRAKKAR, wielding Widow's Lament."* If the reverb was never
  fully read: *"its reverb died with its bearer, unread."*
- **The Chronicle / History Book** — every naming is a Chronicle entry:
  season, server, forge, name. The name persists even when the weapon doesn't
  (§7).

---

## 7. Seasons — the soul persists (named → known → legend)

Normal gear wipes at season rollover. Named weapons follow the artifact rule
with a deeds gate:

- **Named at season's end, carried:** the weapon may be **vaulted** (safe,
  unusable) or **carried** (usable day one, lootable in real PvP) — the same
  choice as artifacts (`design/seasons.md`). The *name* always persists in the
  Chronicle regardless.
- **The artifact-hood path (owner-approved direction, tune thresholds):** a
  named weapon that earns enough **deed-weight** — real PvP kills, battles
  survived while wielded, seasons carried — ascends to **true artifact** at
  season rollover. Its reverb becomes its public legendary properties;
  provenance is etched permanently. This is the lifecycle the whole game is
  about: **hidden at the naming → revealed through deeds → immortalized.**
  Legend can't be bought — but a player can *forge* it, one deed at a time.
- **Lost reverb (the gut-punch):** bearer falls to a raider who takes the
  blade → the new bearer inherits it (provenance grows; a reading still
  works). Bearer falls to the **Chorus** wearing it → **destroyed, unread,
  gone** — reverb never recovered. The plaque line in §6 is the permanent
  scar. Risk is the cap, same as artifacts.

---

## 8. Explicitly out of scope (v1)

- Renaming (never — §2).
- Naming modules, consumables, or anything that deteriorates (§0.5).
- Transferring a name to another item.
- Cross-server name uniqueness (per-server only, §2).
- Player-to-player reverb trading or copying — reverb is bound to the item.

---

## 9. Open questions for Hans

1. **Deed-weight thresholds** for artifact-hood (§7): how many PvP kills /
   battles / carried seasons feels legendary but reachable? (Proposal: 10 PvP
   kills *or* 25 battles survived *or* carried through 2 season rollovers —
   tune in playtesting.)
2. **Reading cost:** devotion threshold only, or also a Scrip/material fee at
   the Oracle? (Proposal: devotion-gated, no fee — favor is the currency.)
3. **The forge-master's voice** in the ceremony (§2): reuse the Oracle joker
   roster, or a distinct forge persona?
4. **Fabled tier** (§1): keep as the "so close" tier, or fold into epic to
   keep the ladder tight?
