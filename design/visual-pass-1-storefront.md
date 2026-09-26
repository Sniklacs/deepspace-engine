# Visual Pass 1 — Storefront Shell Mockups
**Author:** designer delegation · **Date:** 2026-09-13 · **Status:** art direction, implementation-ready for Rung 1b (Sheet + SegmentedControl + storefront overlay seam)
**Companion assets:** `site/public/art/storefront/` (3 PNGs, 420×900 portrait sheet mockups).

---

## 1. Where these sit in the architecture

- **Entry:** header **Ledger** button (Scrip + Votives `.num` chips) → full-screen Sheet overlay. NOT a 6th tab. No badge dots, no countdowns (monetization §D — locked).
- The storefront UI exists as a **seam** — `storefrontEnabled=false` today; the overlay renders, but every purchase RPC refuses. These mockups are the target visual state for when the flag flips (owner decision, G1–G4 bound).
- All three mockups are **sheet-based** (rung-1 §B Sheet: bottom-sheet on mobile / centered modal ≥640px desktop — same content, shell swaps).

## 2. Mockup → component map (what Rung 1b builds)

| Mockup | Rung-1b components it defines | Engineer notes |
|---|---|---|
| `storefront-pack-grid.png` | Sheet shell (drag handle, 85% max height, 300ms), Header chips (`.chip` + `.num`), **PackCard** (new primitive: icon 24 + name + price chip + contents list + play-equivalent tag), ScrollView content | Price chip = `text-1` on `surf-4` tile, 12px bold; tag = `ember-soft` 10.5px on `surf-0` inset; EVERY pack lists its play-equivalent (verbatim rule from monetization §3: "≈ what a veteran gets faster by playing anyway"). There is NO footer lock-line: the store presents the packs and argues nothing (see §3). |
| `storefront-season-pass.png` | **PassRail** (new primitive: 28-node two-lane rail — LEFT free lane, RIGHT premium lane, tier nodes 22px tall, 11px labels), gold premium CTA (the ONLY gold CTA in the app — `bg-purity text-black`), capstone card, footer honesty line | Rail renders all 28 tiers in one scroll column (two lanes per tier, per monetization §4.1). Free lane rewards in `ember`-family tint; premium lane in `purity` gold (12.59:1 text on surf-2). Capstone = the deed cosmetic (Shatterlands Banner) — shows the EARNED grammar from mockup 3. CTA label must sit ≥8.77:1: black `#11161d` on `#ffd166` (white on gold FAILS at 1.44:1 — never white-on-gold). |
| `storefront-earned-only.png` | **EarnedBadge** (chip: `✓ EARNED`, black on `bg-purity`, 12.59:1, only placed by server-owned entitlement), **DeedRow** (commemorative display of deed cosmetics — viewable, not buyable), **Commemorative** chip on the Callings/Oracle block, locked deed preview state | Becomes a **commemorative section** inside the store (monetization §2.2: "deed cosmetics sometimes enter the shop as commemorative display"). Deed rows are `surf-2` cards, 64px, icon 24 + name + deed line. Locked deeds show `DEED · LOCKED` chip (`text-3` on `surf-4`, 4.71:1+) — they never read as purchasable. The Callings/Oracle block uses `surf-0` inset + a neutral `COMMEMORATIVE` chip (`text-2` on `surf-4`, 6.14:1) — trust is earned, never bought (monetization §5.1 — **internal**; the store does not print it). |

## 3. Copy rules — OWNER RULING 2026-09-13: the store presents, it does not argue

**The store's player-facing copy carries NO pay-to-win and NO limitation language.** The
G1–G4 guardrails remain the law of the game, but they are **INTERNAL**: they live in
`assertCatalogFair()` (`site/src/game/monetization.ts`), in the fairness section of
`monetization-verify.ts`, in `payments-tests`' store-surface scan, and in this design
folder. They are never printed in the store. What the store says is what a pack IS and
what it holds.

1. **Play-equivalent framing** — every head-start pack lists what its contents equal in
   play, as a plain comparison to a new colony's first weeks ("≈ one week of steady
   explorations at a casual pace" / "≈ two weeks of a deliberate player, or Cradle Tier
   2" / "≈ what a colony reaches in its second week"). A comparison to play, never a
   claim about what a purchase cannot do. Monitor for the exact phrasing style, not the
   exact strings.
2. **NO trust footer.** The G1–G4 paragraph that used to sit under the packs is REMOVED
   from the store surface. Its words — "can never win a battle alone", "hero power is
   never for sale", "no timers skipped · no research · no Oracle trust" — must not appear
   in player-facing store copy.
3. **Pass footer** — "Passes never expire. Unclaimed items return next season." The "no
   tier skips are sold" clause is REMOVED: it is a limitation statement.
4. **The commemorative block** states what the pieces ARE, never what cannot be bought:
   "Oracle trust grows from purity — clean recoveries, carried Codices, shielded allies.
   Feeding recovered AI turns them cold." + "Contribution is measured by the server's
   watch." The chip reads `COMMEMORATIVE`, not `NEVER FOR SALE`.
5. **No "what you can't do" framing anywhere** — no "earnable in play", no "a head start
   within the earned cap", no "pure appearance — no stat, no speed, no edge", no
   "viewable, never buyable", no "none are purchasable yet". A *disabled* control may
   state the truthful **availability** reason (the ledger is not open yet); it may not
   editorialize about the game.
6. **The gate is a scan, not a pin.** `payments-tests` asserts that no store string, pack
   line, cosmetic blurb or overlay literal carries limitation vocabulary — and that the
   internal guardrail still exists and still throws on a planted power term. A future
   change to this copy is a copy change, not a test change.
7. **No urgency theater:** no countdowns, no red dots, no "only N left", no expiring deals. Season dates are competitive calendar, never a purchase nudge.
8. **Emoji banned** in the storefront — the mockups use 16px line icons (pack crate, fuel can, gear, lock, check, star, scroll, emblem) drawn in the 1.5–1.75px stroke dialect. The engineer should render these as the app's icon set; the mock icons are placeholders for the exact family, not the final glyphs.

## 4. Contrast appendix (all pairings used in the mockups, WCAG 2.1 AA)

| Pairing | Ratio | Verdict |
|---|---|---|
| Black `#11161d` on purity `#ffd166` (gold CTA + EARNED badge) | 12.59:1 | PASS |
| White `#fff` on purity `#ffd166` | 1.44:1 | **FAIL — never use** |
| Black `#11161d` on ember `#ff9d3c` (primary CTA) | 8.77:1 | PASS |
| White `#fff` on ember `#ff9d3c` | 2.07:1 | **FAIL — never use** |
| `ember-soft #ffbe80` on surf-2 `#11161d` (tags/loot) | 10.44:1 | PASS |
| `text-1 #e7e9ea` on surf-3 `#161d26` (headers) | 13.93:1 | PASS |
| `text-2 #9aa4b2` on surf-3 (body) | 6.73:1 | PASS |
| `text-3 #7d8896` on surf-3 (captions ≥12px) | 4.71:1 | PASS |
| `text-3` on surf-2 (captions) | 5.05:1 | PASS |
| `text-2 #9aa4b2` on surf-4 `#1c2530` (locked chip — NEVER `text-3` here: it is 4.3:1, below AA) | 6.14:1 (computed) | PASS |
| `corrupt-text #e07cf0` on surf-2 (corrupt/danger copy) | 6.71:1 | PASS |
| `purity #ffd166` on surf-2 (premium lane text) | 12.59:1 | PASS |
| `ember #ff9d3c` on surf-2 (free lane text) | 8.19:1 | PASS |
| Scrip chip `ember-soft` on surf-2 | 10.44:1 | PASS |
| Votives chip `purity` on surf-2 | 12.59:1 | PASS |

## 5. States the engineer must also build (not shown, but spec'd)

- **OWNED ✓** state on purchasable cosmetics (check icon + `text-3`, replaces price chip) — from monetization §D "OWNED ✓".
- **Purchase confirmation sheet** — restates item + price + quiet "You are about to spend N Votives" (`.num`), destructive-confirm grammar per rung-1 §B.
- Wallet renders server state only (`wallet` view from `getWalletFn`) — a client-rendered balance is not trusted; on any wallet mutation the number updates from server response, never from local arithmetic. Add a subtle fade on `.num` change (silent, no celebration — celebration is dent-only).
- Empty/first-run state: no "featured strip" animation on first open; the strip appears statically.
- Storefront OFF state (today): Ledger button opens the sheet with the catalog visible as "coming soon" — purchase rows disabled at 75% + glyph, honest copy "the ledger opens when the world is ready" (no fabricated ETA).