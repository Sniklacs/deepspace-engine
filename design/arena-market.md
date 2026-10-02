# Spec — Arena & Market (authoritative build doc, forward design)

> Status (2026-10-01): **Part I §§1–3 BUILT** — bloodless mock battles +
> consensual stakes toggle (owner addition: troops at risk only when BOTH
> sides opt in, default bloodless, mode unmistakable in UI, ladder records
> the mode) + public ladder with seasonal titles + proving ground.
> Implementation: `site/src/game/war/arena.ts` (+ tests), `bloodless` flag
> on the battle entity, roster-commit bloodless paths, arena fx kinds on the
> alliance outbox, `arena*Fn` server actions, `ArenaPanel` in the Battles tab.
> **§4 duels are v2** (need escrow + world-speaker broadcast). Part II market
> unbuilt. The original "nothing is built" line below is kept for history.
>
> Status (original): **forward design only — nothing is built.** This document specifies
> the structure, rules, and engine seams the engineer will implement **later**,
> in the same standard as the other build docs: concrete, buildable,
> self-contained.
>
> Owner-approved frame (locked, do not redesign): **every server has an
> arena** — bloodless mock battles for practice, a ladder for bragging
> rights, a proving ground for forged weapons, and **duels with wagered
> stakes** to settle disputes. And **a player market** — because trade is
> the growth engine of a server economy.

---

## 0. Locked principles this spec builds within

1. **The arena is bloodless.** No troop loss, no cargo risk, ever. Practice
   and pride only. The moment the arena can cost you soldiers, it stops being
   the place you experiment.
2. **Duels are consensual; stakes are explicit.** Nobody is dragged into a
   duel; every wager is escrowed up front, no take-backs.
3. **The market is player-to-player.** Players set prices; the game takes a
   small cut and sets nothing. Never a vendor, never a price floor.
4. **Trade feeds uniqueness.** The market is how raiders, forgers, and
   suppliers become *different kinds* of players — it feeds the "no two
   players alike" pillar, not just the economy.
5. **Legend is not merchandise.** Artifacts' place in trade and duels is an
   owner question (§9) — the proposal is **no**: "you can't buy legend" dies
   the moment a whale buys a grinder's artifact off the market.

---

## PART I — THE ARENA

### 1. Mock battles — practice without blood

- Challenge another player (or run alliance training): pick forces, set a
  battle plan (`alliances.md` §2 maneuvers), and run the **real battle
  engine** — but casualties are virtual. Everyone walks home, cargo untouched.
- **What it's for:** practicing rally logistics, testing maneuver timing,
  learning how the five troop types move in a plan. The arena is where a
  caller learns to sweep *before* they bet a real beachhead on it.
- **No material rewards.** No loot, no XP, no supplies change hands. The
  payout is skill and ladder points (§2). Practice that pays becomes farming.
- **The Chorus is the other gym.** The fifteen Chorus raid sites
  (`war/chorus-sites.ts`) are the PvE training ground — real risk, real
  loot. The arena is the PvP training ground — no risk, no loot. Two gyms,
  one fighter.

### 2. Bragging rights — the ladder

- Per-server arena ladder, reset each season. Wins and losses recorded;
  titles for the top ("Champion of [Server Name]", etc.).
- The ladder is public — it's the server's pecking order, visible to
  everyone. In a game about legend, the leaderboard is content.
- Titles are cosmetic (nameplate, banner flourish). No material prizes —
  see §1: practice that pays becomes farming.

### 3. Proving ground for the forge

- Equip artifacts and modules in arena battles and see how your random forge
  roll *actually performs* — zero risk. That weird artifact with the lopsided
  stats? Test it here before you trust it in a real raid.
- This is the artifact **showroom**: the only place legend can be flaunted
  without being risked. You can't buy it, you can't lose it here — but you
  can make everyone watch it work.

### 4. Duels — settling disputes

- Any player may challenge another. The challenge states **terms**: format
  (hero duel or skirmish with a troop cap — proposed caps: 50/100/200
  supply-weight) and stakes.
- **Stakes ("sacrifice"):** each side may put up items — modules, supplies,
  forge materials. Stakes are **escrowed by the server** when both accept;
  the winner takes all. No take-backs, no "I was joking."
- This is the formal way to settle an argument: two players with a grudge
  put their modules where their mouths are, and the server holds the coats.
- **Refusing is allowed — and public.** The challenge goes out over the
  **world speaker** (server-wide broadcast): *X challenges Y.* Accept, and
  it's on. Refuse, and the whole server watched you do it — no mechanical
  penalty, because in an alliance game the mockery is worse than any fine.
  "That's the way she rolls."
- **Artifacts as stakes:** proposed NO (§9 Q1). A duel loss is still a
  transfer, and "earn-only" has to mean it.

---

## PART II — THE MARKET

### 5. Why a market — the server's growth engine

- Specialization is what turns a crowd into an economy: raiders sell loot,
  forgers sell modules, suppliers sell supplies. Without trade, every colony
  is a self-sufficient island and the server never *grows* — it just
  accumulates.
- The market is also a uniqueness engine: what you sell is what you *are*.

### 6. What trades

- **Modules** — the commodity tier's natural home next to the shop
  (`forward-base.md` §8). Buy here or buy from the store; the market price
  disciplines the shop price and vice versa.
- **Forge materials** — war plates and other ingredients. Raiders who don't
  forge sell to forgers who don't raid.
- **Supplies and cargo goods.**
- **NOT troops** — mercenaries are the troop market (`muster-troops.md`
  §10). **NOT artifacts** — proposed (§9 Q1). **NOT Oracle favor** —
  untradeable by nature; the Oracles would find the attempt *funny*.

### 7. Mechanics

- **Listings:** seller posts item + asking price in **Scrip** (the earned
  trade currency). Fixed price in v1 — auctions are v2.
- **Listing fee:** a small supplies fee per listing (anti-spam sink).
- **Expiry:** proposed 7 days; unsold items return to the seller.
- **Per-server markets.** Each server's economy is its own — and cross-server
  arbitrage is emergent gameplay: buy low here, haul it through a jump as
  cargo, sell high there. That's a feature, not a bug. (It's also why
  cargo-only looting matters: the trader's haul is *the* prize.)
- **The game's cut:** proposed 5% of sale price in Scrip, destroyed. A sink,
  not a revenue line — the game never competes with its players.

---

## 8. Tunables (all numbers proposed, none locked)

| Knob | Proposed | Notes |
|---|---|---|
| Duel skirmish caps | 50 / 100 / 200 supply-weight | Agreed at challenge |
| Market listing fee | small supplies fee | Anti-spam |
| Listing expiry | 7 days | Unsold returns |
| Market transaction fee | 5% Scrip, destroyed | Sink, not revenue |
| Ladder reset | each season | Titles are seasonal |

---

## 9. Open questions for the owner

1. ~~**Artifacts in trade/duels:** truly never — not on the market, not as
   duel stakes? (Proposed: never. "You can't buy legend" has to survive
   contact with rich players, or it's just a slogan.)~~ — ANSWERED,
   LOCKED 2026-09-30: **never.** No market listings, no duel wagers —
   otherwise players would farm duels for artifacts. The ONLY way an
   artifact changes hands is the real PvP battlefield (`forward-base.md`
   §§7–8): beachhead battles, cross-server raids, home defense. Fall to
   players wearing one, they take it. Fall to the Chorus wearing one, it's
   destroyed.
2. **Market currency:** Scrip only, or supplies as well? (Proposed: Scrip —
   one price signal per server keeps the economy legible.)
3. **Duel formats:** hero-only duels plus capped skirmishes, or more
   formats? (Proposed: those two. Enough for grudges, not a second arena
   system.)
4. ~~**Cross-server market visibility:** can you *see* other servers' prices
   without jumping? (Proposed: no — price intel is itself tradeable
   information. Traders who jump earn their edge.)~~ — CONFIRMED 2026-09-30:
   **no.** You don't know the prices until you land. Traders earn their edge.

---

## 10. Build seams (for the engineer, later)

- Arena battle: a `bloodless: true` flag on battle resolution — casualties
  are computed (the engine runs for real) but never applied; rosters and
  cargo untouched.
- Ladder: `{ serverId, season, entries: [{ colonyId, wins, losses }] }` —
  reset on season rollover, same job that recalls the forward bases.
- Duel: `{ id, challengerId, challengedId, format, stakes: escrowed[],
  state }`. Server escrows stakes on accept, releases to winner. Refusals
  recorded (public).
- Market: per server `{ listings: [{ id, sellerId, item, price, expiresAt }]
  }`. Fee sink on sale. Expiry job returns unsold items.
- All four are validated server actions — the same authority rule as jumps,
  musters, and Xsolla webhooks: the server is the truth.
