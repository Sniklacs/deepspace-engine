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
| `storefront-pack-grid.png` | Sheet shell (drag handle, 85% max height, 300ms), Header chips (`.chip` + `.num`), **PackCard** (new primitive: icon 24 + name + price chip + contents list + play-equivalent tag + G1–G4 footer), ScrollView content | Price chip = `text-1` on `surf-4` tile, 12px bold; tag = `ember-soft` 10.5px on `surf-0` inset; EVERY pack lists its play-equivalent (verbatim rule from monetization §3: "≈ what a veteran gets faster by playing anyway"). Footer lock-line uses the `--corrupt-text` token for the "NEVER FOR SALE" grammar. |
| `storefront-season-pass.png` | **PassRail** (new primitive: 28-node two-lane rail — LEFT free lane, RIGHT premium lane, tier nodes 22px tall, 11px labels), gold premium CTA (the ONLY gold CTA in the app — `bg-purity text-black`), capstone card, footer honesty line | Rail renders all 28 tiers in one scroll column (two lanes per tier, per monetization §4.1). Free lane rewards in `ember`-family tint; premium lane in `purity` gold (12.59:1 text on surf-2). Capstone = the deed cosmetic (Shatterlands Banner) — shows the EARNED grammar from mockup 3. CTA label must sit ≥8.77:1: black `#11161d` on `#ffd166` (white on gold FAILS at 1.44:1 — never white-on-gold). |
| `storefront-earned-only.png` | **EarnedBadge** (chip: `✓ EARNED`, black on `bg-purity`, 12.59:1, only placed by server-owned entitlement), **DeedRow** (commemorative display of deed cosmetics — viewable, not buyable), **NeverForSale** grammar (corrupt-text chip on the Callings/Oracle block), locked deed preview state | Becomes a **commemorative section** inside the store (monetization §2.2: "deed cosmetics sometimes enter the shop as commemorative display"). Deed rows are `surf-2` cards, 64px, icon 24 + name + deed line. Locked deeds show `DEED · LOCKED` chip (`text-3` on `surf-4`, 4.71:1+) — they never read as purchasable. The Callings/Oracle block uses `surf-0` inset + `NEVER FOR SALE` corrupt-text chip — trust is earned, never bought (monetization §5.1). |

## 3. Copy rules (all locked — do not editorialize)

1. **Play-equivalent framing** — every head-start pack lists what the contents equal in play ("≈ one week of steady expeditions at a casual pace" / "≈ two weeks of a deliberate player, or reaching Cradle Tier 2 — same gear, yours sooner" / "the vehicle is buildable; the trim is purchasable"). Monitor for the exact phrasing style, not necessarily the exact strings.
2. **G1–G4 trust footer verbatim:** "Purchases may strengthen a colony — they can never win a battle alone. Hero power is never for sale. No timers skipped · no research · no Oracle trust."
3. **Pass footer verbatim:** "Passes never expire. Unclaimed items return next season. No tier skips are sold."
4. **Never-sale blocks verbatim:** "Oracle trust is earned by purity — clean recoveries, carried Codices, shielded allies. Feeding recovered AI turns them cold. No offering ever buys a moment of it." + "Contribution is measured by the server's watch — never by spend or votes."
5. **No urgency theater:** no countdowns, no red dots, no "only N left", no expiring deals. Season dates are competitive calendar, never a purchase nudge.
6. **Emoji banned** in the storefront — the mockups use 16px line icons (pack crate, fuel can, gear, lock, check, star, scroll, emblem) drawn in the 1.5–1.75px stroke dialect. The engineer should render these as the app's icon set; the mock icons are placeholders for the exact family, not the final glyphs.

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
| `corrupt-text #e07cf0` on surf-2 (never-for-sale chip) | 6.71:1 | PASS |
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