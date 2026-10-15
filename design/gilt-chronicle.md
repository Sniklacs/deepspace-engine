# THE GILT CHRONICLE — the premium season pass, decided

**Decided:** 2026-10-15. The pass's purpose was delegated by the owner to the
lead ("this one's on you — you make the call"), in the same session that ruled
time tokens GO ON SALE. This document is the faithful record of that design.

---

## What it is

**The Gilt Chronicle** — the game's one premium season pass.

- **Price:** 750 Votives (the price already on the shelf tag; engine constant
  `PREMIUM_PASS_PRICE_VOTIVES` in `site/src/game/monetization.ts`).
- **Duration:** one pass covers the whole season (the season is 12 weeks).
- **The fiction:** every colony keeps a Chronicle — the written record of its
  deeds. The free Chronicle is kept in ink. The Gilt Chronicle is the same
  record, kept in gold: everything a player does anyway, written larger,
  dressed better, and remembered longer.

## The Chronicle Track (the ladder)

Season deeds — battles fought, expeditions run, things forged, tiers climbed —
climb a two-sided reward ladder all season (the existing Season 0 rail:
28 tiers, `SEASON_TIERS` in `monetization.ts`).

- **The free side** is open to every player and pays the working goods:
  supplies, Votives, sigils — the rewards that keep a colony running.
- **The gilt side** is unlocked by the pass and pays the *beautiful* side of
  the same climb: cosmetics, titles, gilded Chronicle entries, and engraved
  memorials (below).

A player never buys progress. The pass buys the second side of a ladder he
climbs with his own deeds — a deed not done pays nothing on either side.

## Standing perks (from the day of purchase)

Owning the pass carries standing, separate from the ladder:

- **Extra playbook slots (+2)** — more locked-down battle-playbook
  formations in the War Room library.
- **Extra loadout slots (+2)** — more saved loadouts ready to roll.
- **Herald chat frame** — the owner's chat bylines carry a gilt herald
  frame; the alliance sees his standing when he speaks.
- **Pass-only Cradle dressing** — home-scene dressing available only to
  pass holders (the Cradle is a place a player *stands in*; the pass
  dresses it a cut above).

Standing is room, shine, and voice. None of it is strength (see iron lines).

## Cosmetic sets and RADIANCE (the collection game)

- Purchasable cosmetics belong to themed **sets** — a Shatterlands regalia
  set, a founders' set, a set per race, and more over time.
- **Completing a set pays a presence-only completion bonus:** a title, the
  colony's visible aura/banner treatment on the globe, and memorials that
  never fade.
- **Duplicates polish into RADIANCE.** Pulling a skin already owned is never
  wasted: it raises that skin's radiance tier. Each tier is visibly more —
  more glow, more light, more energy (the house rule: everything gets
  dazzle). Radiance is the ladder a collection climbs forever; a base
  banner and a radiant one are the same skin at different depths of
  ownership, readable from across the map.

## Beachhead presence

A player's presence on a beachhead renders **BIG — arena-scale**, never
"just a little flag." Banners, auras, and radiance read across the whole
wide view of the line: a commander panning the beachhead can see who holds
ground and how deep their standing runs, at a glance, the way the arena
reads. Equal access holds: every player gets the same whole-beachhead
view; presence is what a player has *earned and kept*, rendered large.

## The iron lines (never crossed, at any price)

Bonuses NEVER include:

- **combat power** — no attack, defense, reverb, or any battle stat;
- **heroes** — heroes are earned, never sold;
- **Oracle trust** — trust is earned by deed and purity, never bought.

Premium sells shine, room, and remembrance. The ads say "no pay-to-win"
and "heroes are earned, never bought" — the pass is designed so those
lines stay true with the pass on sale.

## Paid is permanent

- **Anything a player pays for is never lost from season to season.**
  Purchases, completed sets, and radiance tiers are account-permanent
  property; they build season over season. Seasons may reset competitive
  progress — never purchases.
- **The pass itself is per-season** — a ticket for that season's track.
  **Everything the track pays out is forever.**
- One edge, stated plainly: a memorial raised on a season's globe belongs
  to that season's world; its record lives permanently in the player's
  Chronicle.

Player-facing wording of the principle: *what you buy here, you keep here.*

---

## Build status — what exists vs what remains

### Implemented (2026-10-15 store build)

- **The purchase, for real.** The storefront's Gilt Chronicle button spends
  750 Votives through `purchasePremiumPassFn` (`site/src/game/api.ts`) →
  engine `purchasePremiumPass` (`monetization.ts`). EventId-idempotent and
  ownership-idempotent; full Click Law states (press gate, working state,
  receipt naming the Votives total left, refusals out loud in the on-screen
  error banner — including the server's own "Not enough Votives. Need 750,
  have X."). Owned renders as owned (`THE GILT CHRONICLE · OWNED`); the
  premium lane of the existing Season 0 rail keys off the same ownership.
- **Ownership plumbing was already live:** `state.battlePass.premium` +
  `state.entitlements.passes`, and the external-purchase grant branch for
  `season-pass-<season0Id>` (webhook path) reaches the same entitlement.

### Deferred — standing perks (purchase + ownership shipped first)

Each perk was checked against its system and deferred for a stated reason,
not forced:

- **+2 playbook slots — DEFERRED.** The War Room playbook library
  (`site/src/game/war/playbook.ts`) and the formations library
  (`site/src/game/formations.ts`) carry **no slot cap at all** — there is
  no limit constant for a perk to raise. Inventing a cap in order to sell
  relief from it is a new system and a dark pattern; it needs its own
  design pass (with the owner's eye on it) before the perk can hang.
- **+2 loadout slots — DEFERRED**, same reason: no saved-loadout count
  limit exists anywhere in the current build to extend.
- **Herald chat frame — DEFERRED.** Chat bylines render from
  `ChatMessage` + the author's alliance `AllianceMember` record
  (`site/src/components/chat/MessageRow.tsx`); neither carries a cosmetic
  or pass-ownership hook, and the author's monetization state is not
  stamped on messages or member records. The frame needs a byline field
  carried from the author's state into the message/member record — a
  small plumbing build of its own, not a store change.
- **Pass-only Cradle dressing — DEFERRED.** No pass-exclusive cosmetic
  def exists in the catalog (`monetization.ts` COSMETICS), and granting an
  existing priced cosmetic inside the pass would silently reprice the
  shelf. Needs its own cosmetic def(s) (art + catalog entry) first.

### Future work (spec only in this build)

- **The Chronicle Track ladder as a distinct system** — the Season 0 rail
  (28 tiers, free/premium lanes, deed claims) already renders and claims
  in the storefront; the Gilt Chronicle names and frames it. Any deeper
  track work (per-season track authoring, deed-XP tuning) is future.
- **The sets system** — set membership on cosmetic defs, completion
  detection, presence-bonus grants.
- **The radiance system** — per-skin tier state, duplicate-to-radiance
  conversion, tier rendering (glow/light/energy steps).
- **Beachhead presence rendering** — arena-scale banners/auras on the
  wide view, driven by ownership + radiance.
