# Loadout — dressing heroes & leaders for battle

Owner: Hans. Status: BUILT 2026-09-30 — engine (forge.ts equippedBy, equip/unequip fns, migration), API (equipForgeItemFn/unequipForgeItemFn, server-side re-resolve at pledge/commit), nav slot, LoadoutTab (roster rail, 5-slot mannequin, stores picker, battle-modifier summary), 2D+ art (armory banner, 4 slot silhouettes, 30 race×family weapon thumbnails downscaled to ~1.2MB total). Module/relic slots still honestly locked; no fake artifacts.

Hans's ask: "Add a page strictly for dressing out heroes and leaders for battles with modifiers and weapons, armor etc."

## What exists today (the seams we must connect to)

- **Leaders** (`game/types.ts` `Leader`): name, specialty, attributes,
  assignment, status, specialization. Assigned to research / expeditions /
  domains; they have no personal equipment anywhere.
- **Heroes** (`game/hero-xp.ts` `HeroUnit`): race, role, XP, specialization,
  attributes. They fight in battles via snapshots.
- **Battle hero snapshots** (`game/war/war-types.ts` `BattleHeroSnapshot`):
  roles tank/damage/support/utility/econwar; attributes power/guard/craft/
  presence. This is what the battle engine actually reads.
- **CommittedWeapon**: family + tier + count. Bulk armory commitment — NOT
  personal equipment. The loadout layer sits beside it, never inside it.
- **ForgeItem** (`game/forge.ts`): id, kind, recipeId, family, name, grade
  (makeshift→patterned→tempered→masterworked→prewar), stats, power, owner,
  location (`cradle` | `transit` | `field`). Random-attribute weapons, can be
  badass or weak. This is the natural source of personal weapons/armor.

There is NO hero/leader personal-equipment model today. This spec creates it.

## The loadout model

One loadout per hero and per leader. A loadout is five slots:

| Slot | Holds | Notes |
|------|-------|-------|
| Main weapon | one ForgeItem (kind: weapon-ish) | personal, named legends welcome |
| Armor | one ForgeItem (kind: armor-ish) | |
| Module 1 | one module | modules are the sellable tier; they deteriorate |
| Module 2 | one module | |
| Relic | one artifact | ONLY when the artifact inventory model lands — until then the slot renders locked with honest copy ("no artifact model yet") |

A sixth read-only strip: **battle modifier summary** — the computed
power/guard/craft/presence deltas the loadout contributes, so the player sees
what dressing actually does before committing to a fight.

### Rules (owner-locked where stated)

1. **Server-authoritative.** Equip/unequip are engine functions + API ops
   with migration, exactly like every other inventory mutation. The UI never
   invents equipped state.
2. **One body, one item.** A ForgeItem equipped by hero A cannot be equipped
   by hero B. `ForgeItem.equippedBy: { heroId } | { leaderId } | null` —
   location stays `cradle` while equipped (it's worn at home, not in transit).
3. **Cargo stays cargo.** The loot rule is cargo-only (owner 2026-09-30):
   equipped modules are NOT lootable when a hero falls. Unequipping mid-
   battle is impossible — the loadout locks when the battle snapshot is taken.
4. **Modules deteriorate.** Equipped modules wear with battles fought, same as
   any module. A broken module unequips itself to the stores with a Chronicle
   note, never silently.
5. **Battle seam.** When a battle snapshot is built, each committed hero's
   `BattleHeroSnapshot` gains an `equipped: { weapon?, armor?, modules[],
   relic? }` block carrying the *resolved stat deltas* (not live references).
   The battle engine reads deltas; it never reaches back into the loadout.
6. **Leaders in the field.** A leader assigned to an expedition can wear a
   loadout; the expedition snapshot reads it the same way. Leaders on
   research/domestic assignment show their loadout greyed (worn, not in play).
7. **No artifact fakery.** The Relic slot stays visibly locked until the
   artifact inventory model exists (exploration rare drops / Chorus raids).
   No placeholder artifacts, no renaming forge gear.

## The page

A dedicated nav tab — **Loadout** — strictly for dressing, per Hans's ask.
Not a sub-panel of Battles, not a Cradle room. Structure:

- **Roster rail** (left): every hero + leader, portrait, role/specialty,
  current assignment. Pick one → their mannequin.
- **Mannequin** (center): the five slots as equipment frames around a
  2D+ portrait silhouette. Empty slots show ghosted silhouettes, never blank
  boxes. Tapping a slot opens the stores picker filtered to that slot.
- **Battle modifier summary** (right/below): power/guard/craft/presence
  deltas, module wear states, one line per equipped piece with its grade.
- **Stores picker**: the colony's unequipped ForgeItems + modules, filtered
  by slot, sorted by power. Equipping swaps: old piece returns to stores.

## Art direction (2D+)

Hans: "Try and make all artwork 2d plus" / "So it's consistent." Layered 2D
with depth, lighting, atmospheric effects, subtle parallax — NOT full 3D,
realistic not cartoon. For this page:

- One banner: the armory at rest (weapons racked, armor stands, ember light).
- Leader/hero portraits in a single portrait system (race-distinct
  silhouettes — the seven races read differently at a glance).
- Equipment slot frames: one frame design, five slot sigils.
- Weapon/armor thumbnails generated per family × grade band, reused across
  the Forge room and the loadout page (one asset system, not two).
- Empty-state silhouettes: ghosted armor-stand / weapon-rack outlines.
- Labels outside/below art, never baked in. WebP, lean, reusable.

## Build order

1. This spec (done).
2. Engine: `ForgeItem.equippedBy` + `equipItem`/`unequipItem` + validation
   (slot fit, one-body-one-item, battle-lock) + API ops + save migration.
3. Battle seam: snapshot `equipped` block + engine reads deltas.
4. Module model touch-up: wear ticks on equipped modules, break → auto-
   unequip + Chronicle note. (Modules themselves are specced elsewhere.)
5. UI: Loadout nav tab + LoadoutTab (roster rail, mannequin, modifier
   summary, stores picker).
6. Art: the 2D+ set above, one consistent pass.
7. Verify: bun test + typecheck-guard + vite build + battle-verify.

## Open questions for Hans

- Should leaders share the hero equipment pool, or do leaders get their own
  regalia track? (Spec assumes shared pool, one-body-one-item.)
- Module 1 vs Module 2: typed slots (e.g. offense/defense) or free? (Spec
  assumes free.)
- Can a hero's loadout be edited while they're on an expedition, or does the
  field lock it? (Spec assumes snapshot-at-launch; editing allowed, takes
  effect next battle.)
