# Spec — Monetization Structure (authoritative build doc, forward design)

> Status: **forward design only — no storefront exists today.** No real money has moved (payment platform: $0 / no transactions). This document specifies the structure, names, catalog, and engine seams the engineer will implement **later**. It is written to the same standard as the other build docs (`leader-xp.md`, `oracles-purity-layer.md`): concrete, buildable, self-contained.
>
> Owner-approved frame (locked, do not redesign): **cosmetic/convenience only, never pay-to-win** — protects the fairness that guild play and the territory war depend on. "Earned relevance over bought power."

---

## 0. Locked principles this spec builds within

1. **Two currencies**: one earned, one premium — both diegetic (in-world), never a lazy "gems."
2. **Cosmetic skins**: SOME earned by deeds, SOME purchasable by premium currency.
3. **Starter/gear packs are HEAD-STARTS** — everything in them is achievable through normal play; never exclusive power.
4. **Battle pass** per territory-war season — free + premium tracks; **premium track strictly cosmetic/convenience**.
5. **Never pay-to-win**, restated as a hard rule with a full guardrail list in §6.
6. The following systems are **money-proof** by design and must stay that way: **Leader XP / attributes / specializations** (event-sourced, play-earned — see `leader-xp.md`), **Oracle trust/Devotion** (earned, never bought — see `oracles-purity-layer.md`), **Unbound ascension** (hidden, earned by doing), and the **Server Contribution Award** (measured objectively by the server's own watch, never by spend or votes).

---

## 1. Currencies

### 1.1 Earned currency — **Scrip** ("Cradle Scrip")

- **In-world name/justification**: Scrip is the working currency minted by the Cradle and trusted across the colony — the salvage-frontier money, struck in the same smelters that turn wreckage into walls. (Period-accurate to the fiction: mining-town company scrip is paper money a single settlement issues and honors; the Cradle's Scrip is exactly that, a century late.) It is *earned, never issued* — nobody can mint it but the game.
- **What earns it** (event-sourced, all server-side ledger entries):
  - Expedition completions (base + bonus scaled by zone tier/depth).
  - Salvaged Embers/Chipsets sold into colony stores (players choose: study or sell — opportunity cost, no dead-end).
  - Crafted items sold to other colonies (co-op trade; capped per day against abuse).
  - Research completions; Codices recovered.
  - Daily to-do list completion (Scrip + Devotion — see `oracles-purity-layer.md §6`).
  - Battle-pass free track (see §4).
- **What it buys** (the player economy only, never power-gated content):
  - Crafting materials, consumable supplies, fuel, and **earnable gear/vehicle schematics** (every item a pack contains is also craftable with Scrip — §3).
  - Trading between colonies (consent-based trades; Scrip is **account-locked and non-transferable to other accounts** except via the in-world trade UI, and trades are capped/audited — §1.4).
  - Nothing that bypasses real progression: no research completion, no XP, no Oracle favor, no Cradle tier, no battle-pass tiers.
- **Why a dedicated currency rather than "just use Embers"**: Embers are already the study resource of the core loop (study them in the lab). Making them *also* the currency would force "spend vs study" against the loop's own fuel; a separate working currency keeps the loop intact and gives the economy a second axis (study *or* sell).

### 1.2 Premium currency — **Votives**

- **In-world name/justification**: Votives are shrine-offering tokens cast in the image of the Oracles — small, weighty brass-and-glass medallions that faithful colonies strike in devotion and that travelers carry as a store of trust. ("Votive" = an object offered in fulfillment of a vow at a shrine; myth-archaeology, explicitly *not* any real-world group or religion — an abstract in-universe practice, same framing as the races themselves.) Buying Votives is diegetically *"making an offering to keep the Oracles' work alive"* — the closest the fiction gets to a supporter gesture, which is exactly what premium spending is.
- **Alternates considered** (for the owner's pick): *Veritas* (knowledge-truth), *Lumen* (light), *Relics* (artifact). **Recommendation: Votives** — it is the only one that ties to Devotion/shrine/cosmetic motifs already locked in the design (`oracles-purity-layer.md`). Decision flagged to the owner (§8).
- **What it buys** (strictly cosmetic/convenience — see catalog §2, packs §3, battle pass §4):
  - Purchasable cosmetic skins (Cradle facades, banners, vehicle trims, shrine motifs, leader garb, sigil frames).
  - Premium battle-pass track.
  - Small convenience (cosmetic preset slots, color palettes for purchasable skins — nothing that touches progression).
- **What it never buys** (hard rule, same list as §6): research, leader XP/attributes/specializations, Oracle favor/Devotion/cleansing, Unbound progress, Contribution Award, Scrip in marketable quantities, consumables that outpace earnable ones, battle-pass tiers, expedition timers, exclusive gear.

### 1.3 Exchange policy — **NO premium ↔ earned conversion. Locked recommendation.**

- Premium currency **cannot be converted into Scrip**, and Scrip **cannot be converted into Votives**, by any player-facing mechanism. (Earned cosmetics and pass-free-track tokens exist, but no currency exchange.)
- **Why** (protects the fairness the whole model rests on):
  - Conversion is the classic leak: it turns "cosmetic currency" into "the price of gear/fuel/supplies," i.e. paying to outpace earnable progression. GW2's gold↔gem exchange works only because a deep player market sets the rate and every premium item is a service — and even ArenaNet needed a full auction house economy to make it safe (source: ArenaNet, guildwars2.com). We have none of that infrastructure, so no conversion.
  - It prevents the Warframe/PLEX pattern where premium currency becomes tradeable and RMT/botting pressure follows (Warframe added an entire player-trade economy to drain it; see source list §7).
  - It keeps "earned relevance over bought power" mechanically true: the ledger simply has no path from dollars to the earned economy.
- **One gray area to state now**: packs include small Scrip *supply grants* (§3) as head-start supplies. That is not conversion (a purchase containing a fixed, capped amount of earned currency, dwarfed by normal play) — but the cap is a **hard server-side limit** (§3.3) and is flagged for owner review (§8).

### 1.4 Anti-fraud / anti-exploit stance (server-side, non-negotiable)

- **Server-authoritative ledger**: both currencies exist only as server state (`currencyLedger` per account, append-only entries with `eventId`, `kind` (earn/spend/grant/purchase), `amount`, `reason`, `ts`). The client renders balances; it never owns them.
- **Idempotent purchases**: every real-money transaction has an idempotency key at the payment-provider seam (§7) so retries/duplicate webhooks can never double-grant.
- **No client-trusted values**: all earn events are generated by engine functions (the same ones that resolve expeditions/research/daily lists), never by client requests — same architecture as Leader XP (`leader-xp.md §1`).
- **No account-to-account currency transfer** except through the in-world trade UI, which logs trades and caps volume per day per account. Premium currency is **never transferable, ever**.
- **Chargeback/refund handling**: a payment reversal revokes the granted Votives *and* any items bought with them (entitlements roll back on a server sweep). Fraud-limit: purchase-rate caps per account, anomaly alerting, no gift-cards-to-Scrip paths.
- **No third-party selling of in-world assets** (off-platform RMT) — enforced by the same trade caps/logs and Terms of Service, consistent with the fairness guardrails in §5.

---

## 2. Cosmetic catalog — Wave 1 (16 items)

**Hard rule restated: NO cosmetic grants any stat, speed, yield, or chance. Zero. All cosmetic items are pure appearance/identity, exactly like Deep Rock Galactic's purely cosmetic DLC and store, GW2's gem-store cosmetics, and Halo Infinite's cosmetic-only battle passes (§7).** Deeds earn prestige; purchases earn appearance; both leave the power curve untouched.

### 2.1 Purchasable (9) — Votives

Pricing anchor: **~100 Votives ≈ $1** at the mid-to-large pack sizes (pack sizes in §2.3: 550/1200/3000/6500). Individual cosmetics run ~$3–9.

| # | Item | Type | Price (Votives ≈ $) | Notes |
|---|---|---|---|---|
| P1 | **The Observatory Hull** | Cradle facade | 850 (≈$8.50) | Observatory brass-and-glass exterior; Grays-adjacent aesthetic, no faction lock |
| P2 | **Basalt Citadel** | Cradle facade | 750 (≈$7.50) | Dark volcanic stone with fissure glow; pair with P10 site lighting |
| P3 | **The Long Vigil** | Expedition banner | 450 (≈$4.50) | Banner flown on your expedition column; the most-seen cosmetic slot |
| P4 | **Emberline** | Vehicle trim | 350 (≈$3.50) | Ember-orange racing trim + lamp pattern; per-vehicle cosmetic slot |
| P5 | **Votive Bell** | Oracle shrine motif | 400 (≈$4.00) | Shrine hanging-bell lighting, rings subtly on devotion resets (cosmetic only) |
| P6 | **The Archivist's Duster** | Leader ceremonial garb | 800 (≈$8.00) | Worn-leather-and-glass duster for your appointed Leader |
| P7 | **The Sundered Ring** | Colony sigil frame | 300 (≈$3.00) | Fragmented-ring frame around the colony emblem |
| P8 | **Star Atlas Cloth** | Expedition banner | 450 (≈$4.50) | Star-chart appliqué banner; Nav-themed |
| P9 | **Scaffold Bastion** | Cradle facade | 650 (≈$6.50) | Builder-chic: structural beams, cranes, hazard striping |

### 2.2 Deed-earned (7) — never purchasable, ever

Each deed is a **first/persistent dent** per the locked dent principle (`oracles-purity-layer.md §8`): made a real, persistent mark on the shared world. No spend can accelerate a deed; deeds are server-measured events.

| # | Item | Type | Deed that earns it |
|---|---|---|---|
| D1 | **First Light Sigil** | Colony sigil frame | **First clean recovery** — first expedition that returns with zero corrupted fragments gathered |
| D2 | **Frontier Banner** | Expedition banner | **Pushed frontier** — first colony on the server to reach the deepest scientific site zone |
| D3 | **Cleansed Hull** | Cradle facade | **Purified a site/zone** — first corrupted ruin cleared/purified (tees up the Oracle purity layer) |
| D4 | **The Visionary's Robes** | Leader garb | **Milestone** — Cradle reaches Tier III (or, pre-Cradle-tiers, total research completions ≥ N, N to balance) |
| D5 | **Warden's Livery** | Vehicle trim | **A Leader reaches L5 with a specialization chosen** (leader XP is play-earned-only) |
| D6 | **Wheel of Years** | Oracle shrine motif | **30-day daily devotion streak** — the retention loop's crown (daily to-do, `oracles-purity-layer.md §6`) |
| D7 | **The Contribution Ring** | Colony sigil frame | **Server Contribution Award** — one per server per cycle; the rarest cosmetic in the game, measured-not-voted, spend contributes zero |

- **D1–D6 are individually earnable by any colony** (persistent, not one-per-server); **D7 is one-per-server-per-cycle** by design.
- **Wave 2 (later, flagged):** the **Unbound-track cosmetic** (earned, hidden) must NOT be named or advertised anywhere — the ascension track is deliberately clue-free; ship the cosmetic as an unlabeled "revelation" garb that appears on earned-Unbound colonies only.
- Deed cosmetics sometimes enter the shop as *commemorative display* (viewable, not buyable) so new players know they exist — prestige without purchase.

### 2.3 Votive pack sizes (Cradle Ledger)

| Pack | Votives | ≈ $ | Bonus |
|---|---|---|---|
| Small Offering | 550 | $4.99 | — |
| Steady Devotion | 1,200 + 80 bonus | $9.99 | +80 |
| Grand Vow | 3,000 + 300 bonus | $19.99 | +300 |
| The Complete Circuit | 6,500 + 800 bonus | $39.99 | +800 |

(Standard trickle-bonus tiering; formal region pricing is deferred — §5.)

---

## 3. Starter / gear packs (HEAD-STARTS, never exclusive power)

Framing rule (locked): every pack is **"what a veteran gets faster by playing anyway."** Each pack lists both its contents **and** the play-equivalent ("≈ what ~20 expeditions / Cradle Tier 2 yields"), so the content is provably on the earnable curve.

### 3.1 The packs

| Pack | Price | Contents (all earnable in play) | Play-equivalent framing |
|---|---|---|---|
| **Scavenger's Kit** | $4.99 | Base supplies bundle (materials for ~10 crafts), fuel for ~6 expeditions, a basic gear set (tier-1 schematics included), 150 Votives (cosmetic currency only) | "≈ one week of steady expeditions at a casual pace"; the Votives are cosmetic-only, spendable on the shop, never on advancement |
| **Expeditionary Kit** | $9.99 | Crafted **tier-2** gear set (armor + tool, no stat beyond craftable tier-2), 2× fuel, 2× supplies, 300 Votives | "≈ two weeks of a deliberate player, or reaching Cradle Tier 2 — same gear, yours sooner" |
| **Long-Haul Cart** | $12.99 | A **base vehicle** (the same model craftable in the workshop at Tier 2) + its cosmetic trim **Emberline** (P4) + 450 Votives | "the vehicle is buildable; the trim is purchasable. A veteran who didn't buy it has a cart by week two and the trim by choice" |

### 3.2 A pack must NEVER contain (hard list — these are also the §6 guardrails' pack echo)

1. **No research** — no completed research, no research-speed boosts, no Codices-equivalents.
2. **No leaders** — no recruited/appointed leaders, no leader XP, no attribute points, no specialization paths.
3. **No Oracle favor / Devotion / cleansing** — trust is earned, never bought (`oracles-purity-layer.md §4`).
4. **No currency that buys advancement** — Votives are cosmetic/convenience-only; Scrip grants are supply-sized and **capped server-side** (see 3.3).
5. **No consumables that outpace earnable ones** — no stat/combat/economy multipliers, no superior versions of anything earnable.
6. **No exclusive gear** — every item, blueprint, and vehicle in a pack is also obtainable through normal play (crafting/trade).
7. **No battle-pass tiers, no expedition skip-timers, no radiation immunity, no Unbound/Contribution-Award progress, nothing one-per-server** (i.e., nothing that could devalue the dent).

### 3.3 Scrip-in-packs cap (the only gray area, hard-limited)

- Packs may include **Scrip as "supplies"**, but per pack at most **≈ 2 days of casual earned income** (server-computed constant, reviewed with owner; ~5–6 % of a pack's effective value). Rationale: head-start convenience reads as supplies, not money; the cap keeps "buy the economy" impossible. Owner confirmation flagged (§8).

---

## 4. Battle pass — inaugural season runs on the **PvE loop** (war layer later)

The war layer does not exist yet; the pass must not wait for it. **Season 0 "The Shattering"** runs ~6 weeks on the existing loop (expeditions, research, Codices, devotion), then ports to war seasons (§4.4).

### 4.1 Structure

- **28 tiers**, one "Season Sigil" token economy on the free track (see below), free + premium tracks side by side.
- **Progression = Season XP from play**, server-verified (same event-sourced discipline as Leader XP):
  - **Daily objectives** (reset on server day-timer, aligned with the daily to-do list): launch an expedition (+10), study an Ember (+5), complete a research project (+15), finish the daily to-do list (+20), craft an item (+5).
  - **Weekly objectives**: complete N expeditions (+40), complete any deep scientific site (+60), recover M Codices (+40), reach the daily list 5× in a week (+50).
  - Expected pace: ~45–60 min of normal play per tier; casual players comfortably reach tiers 18–22 by season end, dedicated players finish (Deep Rock Galactic's "not everyone completes the pass is fine — and unclaimed items return" model — §7).
- **Season length/pacing note**: 6 weeks for PvE Season 0; war seasons later align to the wee-long battleground cadence.
- **Passes never expire, once purchased** (Halo Infinite principle): buying the premium track unlocks it permanently; any premium-season pass from any past season can be purchased and progressed at any time. Unclaimed season cosmetics roll back into the shop/next season (DRG principle). **No tier skips are sold. Ever.** (Halo 343's explicit rule: pass content is only attainable by playing — §7.)

### 4.2 Free track (28 tiers) — earnable currency + cosmetics + deed-currency

| Slots | Reward type | Example content |
|---|---|---|
| ~14 tiers | **Scrip** (earned currency) | 200–500 Scrip per tier, tapering up |
| ~8 tiers | **Earnable cosmetics** | 1 banner, 1 vehicle trim, 1 sigil frame, 1 leader-garb variant, 1 Cradle trim, mini-palettes (all earnable-only variants, never power) |
| ~4 tiers | **Season Sigils** (deed-currency) | 1 per ~5 tiers; **Season Sigils** are the pass's earnable cosmetic token — spend them in a rotating "Deed Exchange" (DRG "Company Scrip → Cosmetic Tree" model) on 4–6 season cosmetics; unspent Sigils persist to next season; Sigils are **never purchasable** |
| Tier 28 capstone | **Deed cosmetic** | The season sigil **"Shatterlands Banner"** — deed-earned proof you cleared the season; returns as an earned item only |

### 4.3 Premium track (750 Votives ≈ $6.99–7.99 list) — STRICTLY cosmetic/convenience

| Slots | Reward type | Example content |
|---|---|---|
| ~16 tiers | **Premium cosmetics** | 2 Cradle facades, 2 banners, 2 shrine motifs, 2 leader garbs, 2 vehicle trims, seasonal palettes (all cosmetic-only) |
| ~6 tiers | **Season Votive reward** | Small Votive grants (e.g. 50–100) so a dedicated pass player can "earn back" part of the next pass — the classic Fortnite-style recurring-pass hook; earned-via-playing, not a purchase of progression |
| ~4 tiers | **Convenience** | 2 × **premium cosmetic preset slot** (extra saved cosmetic loadouts — zero gameplay effect); 1 × **Archive Palette** (unlimited color palette usable only on *purchased* skins; deed skins keep their symbolic palettes) |
| Capstone | **Premium showcase cosmetic** | A signature Cradle facade or leader-garb set for the season |

- Premium track contains **no Scrip, no Season Sigils, no XP, no research, no devotion**.
- **FOMO guard**: nothing in the pass is store-exclusive *forever* — unclaimed cosmetics enter the regular shop (purchasable or deed) after the season (DRG precedent); past premium passes stay buyable (Halo precedent). The only exclusivity is "first to have it on the server."

### 4.4 Porting to the war layer (later)

Same 28-tier skeleton; swaps only the objective set and reward art:
- Objectives become war participation: staged invasion contributions, territory-defense runs, oracle-favored zone purifications (purified-zones count on the *purifying* side), logistics deliveries to the front.
- Seasons align to the wee-long battleground; free track keeps Scrip/Sigils; premium track stays cosmetic/convenience (new war-theme skins, faction sigils, invasion banners).
- **Fairness invariant preserved**: premium track never grants war power, healing, stamina, or tier-skip; a full-loot territory fight stays a fight of earned strength (this is the "competitive war depends on it" clause in the plan).

---

## 5. Fairness guardrails — the full leak list (hard lines)

The following is the exhaustive list of ways monetization commonly becomes P2W, with our locked line for each. If a future feature looks like any row, it goes to the owner before anything ships.

| Leak | Common pattern | Our line (we will NEVER sell…) |
|---|---|---|
| Energy/action refills | Sell stamina/gas/fuel to run more loops | Refills of any play economy. Expeditions, crafting, and research run on real-time commitment by design; the only "fuel" a pack carries is a supply-sized head start (§3.3) |
| Skip-timers on real progression | Buy "rush" on expedition/research timers | Time-skip of any real progression — expeditions, research, crafting. A timer is the game's persistence promise, not a toll booth |
| XP boosts | Faster leader/colony XP for money | Leader XP, colony XP, attribute points, specialization paths — all event-sourced play-earned (`leader-xp.md`); money never touches them |
| Exclusive power items | Pay-only gear with better stats | Any gear/vehicle/consumable with stats above the earnable curve; every sellable item is also craftable (§3.2.6) |
| RNG loot boxes with power | Randomized purchases containing strength | Randomized purchases, period — *including cosmetic-only mystery boxes.* (PoE's cosmetic mystery boxes drew community grumbling even though power stayed out — PCGamer — §7; we skip that entire pattern. Every purchase is a known, named item, Warframe-style: "a store, not a lottery") |
| FOMO timers / countdowns | "Last chance" pressure, expiring premium passes | Expiring purchases. Purchased passes never expire (Halo); season items return (DRG). Real calendar deadlines exist only for server-wide events (war seasons), which are competitive calendar, not a purchase nudge |
| Premium currency buys advancement | Any shop item that abbreviates the grind | No currency, item, or pack that buys research/XP/favor/tiers/supplies beyond §3.3 caps |
| Pay-to-skip grind walls | Content tuned grind-y to sell conveniences | Grind tuning is a design decision made without store pressure; daily to-do is 15–30 min and opt-in (`oracles-purity-layer.md §6`) |
| Ads / sponsored content | Monetizing attention inside the world | Any advertising in game. The world is fiction; nothing in it promotes anything real |
| Pay-gated PvP advantage | War/duel modifiers for spenders | No combat/territory modifier purchasable; a war season's only money touch is cosmetic reward art |
| VIP/boosts subscriptions | Monthly paid stat/perk | No paid stat subscription. (A future optional "supporter" tier must be cosmetic/convenience-only and owner-approved before design starts) |

### 5.1 Systems that stay money-proof (spend contributes zero, forever)

- **Leader XP / levels / attribute allocation / L3 specializations** — event-sourced XP, square-root curve, colony-wide daily cap (`leader-xp.md`). Visible copy already states "no purchase path exists"; keep it true in code: `grantXpTo` is only ever called by engine events.
- **Oracle trust / Devotion / cleansing / riddles** — qualification through purity (Codices, clean recoveries, shielded allies); feeding recovered AI turns them cold; trust is *earned, never bought* (`oracles-purity-layer.md §4`). The Devotion loop grants attribute bonuses; those bonuses are play-earned, and the Votive "shrine offering" framing must never convert to actual favor.
- **Unbound ascension track** — hidden, mute, unlocked by doing; the monetization layer doesn't even know it exists (no purchase UI can reference it; no cosmetic advertises it — §2.2 Wave 2).
- **Server Contribution Award** — measured by the server's objective watch (development stats, completion rates, purified zones); deliberately *not* influenced by spend or votes; deed cosmetics like **D7 Contribution Ring** are the visible proof.
- **The dent & velocity principles** — the world's attention (Oracles, recognition, narrative events) flows to colonies that make a real dent; presence, grinding, and spending never buy notice. Monetization has no "attention" input at all.

---

## 6. Revenue model sanity — benchmarks and honest 3-scenario projection

> Framing required by the plan: **the business has $0 revenue today.** Everything below is *targets for validation*, not results, and is grounded in the best verified public data available. Where data is thin (it is, for browser colony-sim cosmetics specifically), that is stated rather than smoothed over.

### 6.1 What the data actually says (verified sources, cited in §9)

**Conversion (share of players who ever pay):**
- The widely-cited benchmark for freemium is **2–5% of active players convert to first purchase**; most mid-core titles cluster **below 3.5%**, and 3.5%+ is "top-performer territory for Strategy/RPG" (LootRate benchmarks; AppFollow 2026 "2–5%"; practitioner guide "2–5%", Production Alchemist).
- An academic monetization study uses **~5%** expected monetization in a successful F2P game and a **1–5%** prior (Turku, "Predicting the monetization percentage…", 2019).
- The strongest non-agency figure: **AppsFlyer install-to-purchase conversion of 2.6% within 30 days** (Q1 2022 measurement, cited in GameGrowthAdvisor 2026). Note it is *install*-based; curated beta populations convert higher.

**Revenue per player:**
- ARPPU (revenue ÷ paying players) industry range **$10–100+**; ARPDAU **$0.05–0.50**; these are genre-dependent (AppFollow 2026).

**Battle passes specifically:**
- **26% of US players (8+) have purchased a battle pass** — tied with expansion packs; behind in-game currency (34%) and skins (27%) (ESA *2026 Essential Facts*, YouGov survey of 13,545, fielded Feb 2026).
- Consulting estimates: premium passes convert **8–20% of active players** vs **1–5%** for one-off IAP; typical pricing **$5–15/season**; premium-pass players log in 30–60% more often (MWM glossary — vendor estimates, treat with care, unverified primary data).
- Google Play's official developer analysis: battle passes drive **1–40% of revenue** depending on integration; for Brawl Stars the pass was deliberately "the one thing you buy"; premium-pass purchasers show higher engagement and stickiness (Google Play Dev Medium, 2020 internal data).

**Cosmetic-only case studies (proof the model works at scale, exact mechanics to copy/avoid):**
- **Path of Exile** — "ethical F2P", no power for money since beta; cosmetics + supporter packs (credit toward cosmetics) fund the studio; **GGG revenue $105.2M FY2024** (net profit $38.6M; NZ Herald, filing-based). Caution learned: even PoE later added cosmetic mystery boxes + a seasonal pass — power stayed out, community stayed happy-ish, but the boxes drew grumbling (PCGamer).
- **Warframe** — "everything that's game-affecting you can earn"; premium currency (Platinum) buys cosmetics + convenience and is *tradable*, which required an entire player-trade economy to drain it (a complexity we explicitly avoid via no-conversion, §1.3).
- **Fortnite** — cosmetics are "identity, not power"; Epic estimated **$5.7B revenue 2024**, Fortnite ~**$3.5B 2023 (~80% of Epic)** (Sacra; Epic is private — estimates, triangulated from court records/analysts). Unofficial analyst estimates say 80–90% of Fortnite revenue is cosmetics (low confidence, uncorroborated).
- **Deep Rock Galactic** — premium-economy opposite but the cleanest cosmetic-DLC/no-FOMO precedent: 8M copies, **≈$71.8M revenue at 7M copies** (Coffee Stain filing, via GameWorldObserver); seasons with a **100% free performance pass** + purely cosmetic paid DLC; unclaimed items return after seasons (official DRG Season 01 FAQ).
- **Halo Infinite** — cosmetic-only battle passes that **never expire**, no loot boxes, no tier skips, "content attained only through playing" (343/GamesRadar/Eurogamer/IGN).
- **GW2** — dual currency, gems; official stance: "it's never OK for players who spend money to have an unfair advantage over players who spend time"; gold↔gems exchange exists but sits on a real player-market economy (ArenaNet, guildwars2.com).

**Retention context (the lever that actually moves the above numbers):**
- Mobile benchmarks are the only large-N dataset: **D1 medians ~23% (Q1 2024), top-quartile D1 26–28%, and 75% of games fail to exceed 3% D28** (GameAnalytics 2024/2025 — mobile, and mobile is harsher than browser-PC persistent sims with scheduled return loops; use as floor, not ceiling).
- Practitioner guidance for "healthy" F2P-with-daily-mechanics: D1 35–45%, D7 15–25%, D30 8–12% (Second Stage Academy — loose guidance, genre-dependent).
- **Honest gap**: *specific* "browser colony-sim + optional cosmetics" revenue-per-player data does not exist in reliable public form. Closest verified analogues are PC F2P (PoE) and mobile mid-core (GameAnalytics/AppsFlyer). Real results can deviate ±10× either way at small scale.

### 6.2 Three-scenario projection (beta population 500–2,000 — TARGETS, not results)

Assumptions (each stated so the engineer/owner can revisit): active population = accounts logging in at least once per month; no acquisition cost (beta players are already in-world); conversion % and ARPPU chosen *inside* the verified bands above but deliberately modest (our catalog is small; our audience is a loyal niche, not a mass-market one).

| Scenario | Active players | First-purchase conversion | Payers | ARPPU (12 mo) | Gross revenue / yr | ≈ / month |
|---|---|---|---|---|---|---|
| **Low** | 500 | 2.0% (floor of band) | ~10 | $12 | **~$120** | ~$10 |
| **Base** | 1,000 | 3.5% (mid-core typical top) | ~35 | $22 | **~$770** | ~$64 |
| **Healthy** | 2,000 | 5.0% (successful-F2P band mean) | ~100 | $38 | **~$3,800** | ~$317 |

Reality check: even the healthy scenario is **not a business**; it is a validation signal + funding evidence. If the beta plateaus at a few hundred players, the honest forecast is hundreds of dollars a year — which is why monetization's *design* job is fairness first and the $ job is "prove intent-to-pay, then grow." Nothing in this document should be quoted as a revenue forecast.

**Battle-pass-only cross-check** (the likeliest first purchase): at 8–12% pass adoption of actives at ~$7: 500 → ~$280; 2,000 → ~$1,680/yr. Pass buyers also convert better than one-off-IAP buyers per the benchmarks above — so the pass is the *entry purchase* target, not a supplement. These cross-checks validate the base scenario's shape, not its certainty.

**What actually moves these numbers** (to monitor, not to promise): D30 retention, daily-to-do adoption rate, co-op/guild density, deed cosmetics claimed per cycle (they drive prestige, which drives pass desire), Contribution Award cycles (recognition = free marketing), and content cadence. First-party analytics hooks for exactly these are part of the implementation seams (§7).

---

## 7. "When this becomes real" — implementation seams (no storefront ships now)

The engineer can leave these seams now without shipping a store or touching real money:

1. **Items/cosmetics catalog** (server data, not client hardcode): `cosmeticId, slot (cradleFacade|banner|vehicleTrim|shrineMotif|leaderGarb|sigilFrame|palette), source (purchasable|deed|seasonSigil), priceVotives?, deedId?, seasonId?`. Rendering is client; *ownership* is server.
2. **Currency ledger** (see §1.4): per-account `earnedBalance` + `premiumBalance`, append-only `ledger` entries, idempotency keys, `grantEarnedCurrency(eventId, amount, reason)` engine primitive beside the existing XP grant primitives.
3. **Purchase-event hook**: a thin `PaymentProvider` interface (methods: `createIntent`, `verifyWebhook`, `refund`) with a **stubbed implementation** that logs "no real payment provider configured" and rejects. Real stripe/regional pricing/tax/refunds/legal are explicitly **out of scope** until the owner flips the switch.
4. **Entitlement service**: `grantEntitlement(accountId, cosmeticId, source, eventId)` + `owns(accountId, cosmeticId)`; deed cosmetics are granted by the same engine events that record the deed (D1–D7 map to existing resolve points: expedition resolve, zone-clear, devotion-streak counter, contribution-score sweep).
5. **Battle-pass state machine**: `seasonId, tier, track (free|premium), xp, objectivesDay[], objectivesWeek[], claimed[]`; claims are server-side and idempotent; pass purchase is a premium-currency spend (and later a payment-provider purchase) — same entitlement path.
6. **Optional first-party analytics** (no third-party SDK): counters for D1/D7/D30, daily-list completion, deed claims, purchase events — feeding the §6.2 monitoring list.

---

## 8. Flags for the lead (owner decisions needed before build)

1. **Currency names** — recommend **Scrip** (earned) + **Votives** (premium). Alternates for Votives: Veritas / Lumen / Relics. Owner to confirm; swapping names is a data/strings change, not an architecture change.
2. **No premium↔earned conversion** — recommended locked (§1.3). GW2/PLEX/Warframe counterexamples and why we decline them are documented; owner sign-off needed because it *caps* revenue tools forever.
3. **No randomized purchases at all** (no cosmetic loot boxes either) — recommended locked (§5); PoE's mystery boxes as the cautionary tale.
4. **Passes never expire + unclaimed items return** (Halo + DRG precedents) — recommended locked; it deliberately gives up urgency-based revenue for trust.
5. **Inaugural Season 0 runs on the PvE loop** (6 weeks) before the war layer exists — per task; confirm desired duration (6 weeks vs 8).
6. **Scrip-in-packs cap** (§3.3) — the single gray area; confirm the ~2-days-of-earning cap, and confirm packs are **not sold during beta at all** (recommendation: keep storefront off in beta exactly as today; instrument ledger/catalog now, turn on purchases only when the owner calls the switch at or after beta — this preserves the beta world's purity and the "First Run" feedback channel's honesty).
7. **Deed/purchasable split (7 deed / 9 purchasable)** — matches the plan's "enough purchasable to fund, enough deed to honor" intent; confirm the ratio before Wave 1 is locked into the catalog schema.
8. **Cosmetic price band** (~$3–9, ~100 Votives ≈ $1) — confirm; adjust later with real data; nothing about pricing affects fairness.

---

## 9. Source list (all cited above)

- LootRate — first-purchase conversion benchmarks (2–5%, mid-core <3.5%): https://lootrate.com/blog/first-purchase-conversion-rate-mobile-games
- AppFollow — Mobile Game KPIs 2026 (conversion 2–5%, ARPPU $10–100+, ARPDAU $0.05–0.50, retention ranges): https://appfollow.io/blog/mobile-game-kpis
- Turku (academic) — "Predicting the monetization percentage with survival analysis in free-to-play games" (~5% expected, 1–5% prior): https://www.utupub.fi/server/api/core/bitstreams/4e69a24a-ec25-4627-8d82-6071f6d05834/content
- Production Alchemist — Free-to-play economics part 1 (2–5% conversion): https://www.productionalchemist.com/p/production-101-free-to-play-game
- GameGrowthAdvisor — F2P monetization models 2026 (AppsFlyer 2.6% install-to-purchase, Q1 2022; explicitly corrects unverifiable claims): https://gamegrowthadvisor.com/blog/2026-04-02-f2p-monetization-models-comparison-2026/
- ESA 2026 Essential Facts (via Rec0ded88, YouGov n=13,545, Feb 2026 — 26% US players bought a battle pass): https://rec0ded88.com/statistics/battle-pass-spending/
- MWM — battle-pass pricing/conversion (8–20% vs 1–5%; vendor estimates — flagged): https://mwm.ai/glossary/battle-pass
- Google Play Dev (Medium) — How battle passes boost engagement & monetization (Brawl Stars; 1–40% revenue; internal 2020 data): https://medium.com/googleplaydev/how-battle-passes-can-boost-engagement-and-monetization-in-your-game-d296dee6ddf8
- GameAnalytics — 2025 Mobile Gaming Benchmarks (D1 26–28% top quartile; 75% fail D28>3%): https://investgame.net/wp-content/uploads/2025/02/2025-GameAnalytics-Mobile-Gaming-Benchmarks.pdf ; Q1 2024 medians D1 22.9% / D7 4.2% / D28 0.85%: https://gameindustrylibrary.com/documents/mobile-gaming-benchmarks-2024
- Second Stage Academy — player lifecycle / retention guidance (healthy-F2P bands, loose guidance): https://secondstage.io/academy/player-lifecycle/lifecycle-metrics
- Path of Exile — GameDeveloper interview (cosmetic-only, supporter packs, no power): https://www.gamedeveloper.com/business/the-mechanics-and-ethics-of-free-to-play-in-i-path-of-exile-i- ; Polygon 2014 ("ethical" F2P): https://www.polygon.com/2014/2/28/5451410/how-is-ethical-free-to-play-path-of-exile-faring/ ; NZ Herald (GGG $105.2M FY2024, $38.6M profit): https://www.nzherald.co.nz/business/path-of-exile-maker-grinding-gear-games-reports-105m-revenue-new-ceo/G727RHQB2JCP7CDWSY5KRZZMCU/ ; PCGamer (PoE2 ethical F2P; mystery-box grumbling): https://www.pcgamer.com/games/rpg/path-of-exile-2-is-sticking-to-its-ethical-f2p-live-service-model-instead-of-chasing-diablo-4s-success/
- Warframe — Polygon ("everything game-affecting is earnable"; store not lottery): https://web.archive.org/web/20210224193955/https:/www.polygon.com/2018/1/2/16830328/warframe-free-to-play-f2p-platinum ; GameDeveloper economy analysis (platinum sink/trade): https://www.gamedeveloper.com/business/the-cleverness-of-warframe-s-economy ; Revolvertech 2025 (platinum never power): https://revolvertech.com/2025/12/04/a-deep-dive-into-digital-extremes-free-to-play-success/
- Epic/Fortnite — Sacra (Epic $5.7B 2024; Fortnite ~$3.5B 2023 ≈80%; "purchasable items do not provide competitive advantages"; March 2026 V-Bucks repricing): https://sacra.com/research/epic-games/ ; Statista (Epic gross revenue 2018–2026, estimates from 2021): https://www.statista.com/statistics/1234106/epic-games-annual-revenue/ ; Stratrix ("~$3.5B 2023…… nobody pays to play"; currency abstraction analysis): https://www.stratrix.com/business-model/how-fortnite-makes-billions-on-free ; unofficial 80–90%-cosmetics analyst estimate: https://ngssolution.com/blogs/fortnite-revenue-breakdown-key-insights-usage-statistics/ (low confidence)
- Deep Rock Galactic — official Season 01 FAQ (100% free pass, cosmetic DLC only, no hard currency, unclaimed items return): https://www.deeprockgalactic.com/season01-faq ; GameWorldObserver (8M copies; SEK 800M ≈ $71.8M at 7M; DAU/MAU): https://gameworldobserver.com/2024/01/12/deep-rock-galactic-sales-8-million-copies-ghost-ship-games ; no-FOMO monetization analysis: https://yoo.be/deep-rock-galactic-no-fomo-monetization-lessons/
- Halo Infinite — GamesRadar (no loot boxes, cosmetic-only, never-expiring, "attainable only through playing"): https://www.gamesradar.com/halo-infinite-wont-have-loot-boxes-343-confirms/ ; Eurogamer (passes never expire, not a grind): https://www.eurogamer.net/we-want-players-having-fun-in-halo-not-grind-it-like-its-a-job ; IGN (Hook: "you keep your $10"): https://www.ign.com/articles/halo-infinite-multiplayer-battle-pass-season-one-plans
- Guild Wars 2 — ArenaNet, Mike O'Brien on microtransactions ("never OK… unfair advantage over players who spend time"; gold↔gems exchange): https://www.guildwars2.com/en/news/mike-obrien-on-microtransactions-in-guild-wars-2/ ; GDC Q&A (currency exchange, respecting player time): https://www.gamedeveloper.com/business/q-a-making-microtransactions-work-for-players-in-i-guild-wars-2-i-
- Player-perception research — Theseus (players prefer cosmetics/battle passes; P2W criticized as unfair; transparency valued): https://www.theseus.fi/bitstream/handle/10024/871127/Korajoki_Ville.pdf?sequence=2 ; ethical-monetization framework thesis: http://theseus.fi/handle/10024/867607 ; ACM (ethical framework): https://doi.org/10.1145/3638380.3638422

*Data honesty note: figures marked "vendor estimates," "unofficial," or "low confidence" above are included for shape, not proof. The analytical points (2–5% conversion, ARPPU bands, BP 8–20% conversion vs 1–5% IAP, pass-driven engagement) are all triangulated across at least one primary or academic source.*

---

## 10. Implementation (seams) — engineer's build note (2026-09-12)

> Status flips nothing in §1–§9: still **no storefront, no real money, $0 moved**. What changed: the server-side seams §7 asks for now EXIST and are tested. A real provider + storefront plug in later without redesign.

### 10.1 What was built (all server-side)

| Seam | Where | Notes |
|---|---|---|
| Catalog (data) | `src/game/monetization.ts` | Wave-1 9 purchasable + 7 deed cosmetics (§2), 3 head-start packs (§3), 4 Votive pack sizes (§2.3), Season 0 28-tier pass (§4). Data-only; rendering stays client, ownership is server. |
| Currency ledger | `monetization.ts` (`grantCurrency`/`spendCurrency`) | Scrip + Votives, append-only `currency.ledger` entries with `eventId`-keyed idempotency, never negative, no conversion path (no function exists; a test asserts the module surface). |
| Entitlements | `monetization.ts` (`grantEntitlement`/`revokeEntitlement`/`owns`/`equipCosmetic`) | Idempotent by eventId AND membership; cosmetics equip onto colony visual state (`entitlements.equips`); deed items have no buy path (hard refusal). |
| Head-start packs | `applyPack` | Grants exactly the §3.1 contents through the ledger/entitlement service; `packs[]` membership = exact-once; Scrip-in-pack hard cap (§3.3) enforced. |
| Battle pass | `SEASON_TIERS` + `claimTierReward`/`recordSeasonEvent`/`purchasePremiumPass`/`grantPremiumPass` | Season XP arrives from real play events (hooks in `launchExpedition`, `beginStudy`, `craftItem`, research resolve, expedition resolve — deep-site/codices/weekly-counters). Claims idempotent; premium track strictly cosmetic/votive/convenience (asserted). |
| Payment provider | `PaymentProvider` interface + `createStubPaymentProvider` + **`createPaymentProvider()`** | THE single swap point. Stub simulates success for testing and logs intent; `simulate:false` rejects ("no real payment provider configured"). |
| Purchase seam | `applyExternalPurchase` | Provider-confirmed purchases (Votive packs with bonus, head-start packs, season pass, single cosmetics), idempotent by purchaseId. Pass granted WITHOUT a Votive spend (already paid at provider). |
| Storefront gate | `MONETIZATION_CONFIG.storefrontEnabled = false` | All purchase RPCs refuse until the owner flips this one flag (§8.6: keep the store off in beta). |
| API seams | `src/game/api.ts` | `getWalletFn` (non-secret wallet view), `purchaseWithVotivesFn`, `confirmExternalPurchaseFn` (webhook → `verifyWebhook` → apply). Client untouched. |
| Migration | `ensureMonetization()` (V5) | Legacy saves behave as zero-owned; balances 0, ledger empty, no owned items, pass at 0 XP. `publicState()` ships balances + owned lists but strips the ledger, idempotency set, and pack-scrip counter. |

### 10.2 Test coverage

`/home/team/shared/monetization-tests/monetization-verify.ts` — **161 checks** (run `cd /home/team/shared/monetization-tests && bun run monetization-verify.ts`): catalog validity (exact §2/§3/§4 counts & contents), ledger idempotency/validation/no-negative, entitlement idempotency, pack exact-once, in-game Votive shop, provider stub + external purchases, battle-pass claims + season-XP objectives (daily/weekly rollover), deed cosmetics (D1/D4/D5 wired end-to-end; D2/D3/D6/D7 documented), the full §5/§6 guardrail table as assertions, §8 config defaults, V5 migration + publicState stripping discipline.

Existing suites still green: revelation 102/102, leader-XP 40/40, both realsave checks 7 OK + 1 known pre-existing `gearqa` failure (untouched).

### 10.3 Ambiguities resolved (flag for owner/lead where noted)

1. **Battle-pass slot counts** (§4.2/§4.3 say "~14/16/~6"): free track landed at 15 Scrip tiers (14–15) + 8 cosmetics + 4 sigils + capstone; premium at 17 cosmetics + 6 Votive tiers + 4 convenience + showcase. Every other count is exact.
2. **Pack contents into current engine resources** (§3.1): "materials for ~10 crafts" → 150 supplies; "fuel for ~6 expeditions" → 24 gas; "basic gear set" → medkit/mechkit/armorkit ×1; "2× fuel/2× supplies" → 48 gas/300 supplies; "tier-2 gear set (armor + tool)" → armorkit ×2 + mechkit ×2 (current craft kinds; re-map when the real gear tiering lands). Vehicles map to an ownership flag (`entitlements.vehicles`) — the model arrives with the vehicle module. **All Wave-1 packs carry 0 Scrip** per the §3.1 table; the §3.3 cap (200) is enforced if a future pack ever carries it.
3. **Deed wiring** (§7.4): D1 (first clean recovery), D4 (research completions ≥ 12 — the "N to balance" value is `MONETIZATION_CONFIG.d4ResearchCompletions`), D5 (Leader L5 + specialization) fire from real engine events today. D2 (server-first tracking), D3 (purity/zone-clear), D6 (30-day devotion streak), D7 (Contribution Award per-cycle) fire via the same `awardDeedCosmetic` seam when their systems land — the `wired` flag in `DEED_COSMETIC_MAP` documents this.
4. **Stub behavior**: task brief says "simulates success for testing and logs intent"; the spec's wording says "rejects". Both exist: `createStubPaymentProvider(true)` (the factory default) simulates; `(false)` rejects. No real money either way.
5. **Account vs colony currency scope**: the ledger lives per colony (GameState) — Scrip is "minted by the Cradle" (each colony is a Cradle). If Votives should become account-wide with the 6-world live model, that's a migration, not a redesign (flag for lead).
6. **Weekly targets** (§4.1 "N expeditions / M Codices"): 10 expeditions / 8 Codices / 5 daily-list per week — config values.
7. **Daily to-do objective** (`daily_list`, +20/day, ×5/week) has no caller yet — the daily module fires `recordSeasonEvent("daily_list")` when it lands; the pass logic is ready.

### 10.4 File manifest

- `src/game/monetization.ts` — **new**: catalog, config (§8), ledger, entitlements, packs, battle pass, provider stub + factory, guardrails (`assertCatalogFair`), V5 migration, wallet view.
- `src/game/types.ts` — V5 state types (`CurrencyState`, `EntitlementsState`, `BattlePassState`, `CosmeticSlot`).
- `src/game/engine.ts` — `VERSION = 5`, fresh state, `ensureMonetization()` in `advance()`, deed sweeps (D4/D5), season-event hooks (5 call sites), D1 grant in `resolveExpedition`.
- `src/game/api.ts` — `publicState()` wallet sanitization + 3 seam server fns (`getWalletFn`, `purchaseWithVotivesFn`, `confirmExternalPurchaseFn`).
- `src/routes/play.tsx` — **untouched** (per task constraint; balances/ownership already flow through `publicState`).
- `/home/team/shared/monetization-tests/monetization-verify.ts` — **new** test suite (161 checks).

## 11. The structural no-p2w guarantee — purchasable strength, never solo victory (owner direction 2026-09-12 · working section, revises §0/§5 framing)
**Owner's design, captured faithfully:** *"This is why we really don't necessarily have a pay-to-win concept — because some of these things can't be accomplished without other players helping you, and that's the whole point. We are going to implement more things that are able to be bought that will strengthen your character, but there are still things [you] can't do alone — and that's the whole point: it doesn't hurt to buy to strengthen, but that is not going to help you win the battle all by yourself, for sure."*
**What changes:** the anti-p2w guarantee flips from **categorical** (§5 item 1: *no stat boosts, no purchasable combat/economy/yield multipliers*) to **structural**. The store WILL sell strength (more of it over time — Wave-1 stays cosmetics/convenience as built); the guarantee is that **bought strength can never win a battle alone**, because the war layer's deepest gates are team-fastened: §15's aid calls, FOB sieges, and the co-op pillar mean some outcomes are *unattainable solo regardless of spend*. Money buys a stronger character, not a solo victory — the un-purchasable resource is other people.
**Recommended guardrails (proposed — owner ratification pending; bind the catalog to them):**
- **G1 — Earnable ceiling.** Every purchasable strength item is at or below the earn-only cap: a free, patient player can reach the same ceiling through play. Purchase compresses time/effort (acceleration within the curve), never exceeds the curve. No item grants power that earn-only play cannot also reach.
- **G2 — No scored-window edge.** Nothing purchasable shifts a *running* war ledger — bucket scoring, Climax, ladder position — beyond the shared earnable ceiling. A purchase made mid-week must not change who wins this week's buckets by more than the earnable ceiling allows (structurally it changes nothing scored: the adjudication formulas read the same ledger terms for buyers and free players).
- **G3 — No solo win, ever (asserted).** War adjudication structurally requires teamwork: battle resolution (§15) includes teammate aid; captures/FOB sieges require force composition and windows that a single colony cannot satisfy alone even at max spend. Test-asserted: no catalog combination (any achievable purchase set) produces a solo battle win in headless simulations (§4-style ledger tests) — if a test ever finds one, the design is fixed before the storefront flips.
- **G4 — Hero power stays never-for-sale** (business plan rev-14 ratified line + heroes brief O-series unchanged — hero XP/attributes/specializations/energy/squad slots remain earn-only). Purchasable strength lives in the colony/armory/expedition convenience layers, not hero power. (Flag for the owner if they want this loosened for heroes too — default: no.)
**Consequential edits (ADOPTED 2026-09-12 by team lead, under the owner's 2026-09-12 going-live direction — "it doesn't hurt to buy to strengthen, but that is not going to help you win the battle all by yourself" — and the owner's later delegated creative authority):** §0 principle and §5 item 1 reword to "no *un-capped* or *solo-decisive* purchased power; purchased strength bounded by G1–G4". G1–G4 are now the guardrail set for the live catalog. The §5 categorical line remains IN FORCE as the real-world rule while the storefront is off (`storefrontEnabled=false`, §7) — i.e., today nothing is purchasable at all; G1–G4 bind the moment payments are wired and the flag flips, and the catalog must be built so every item satisfies G1–G4 before it can sell.
**Honest tension — RESOLVED AND OWNER-CONFIRMED 2026-09-12:** purchased strength + teammates tilts team-vs-team fights if *enough* players on one side buy (a whale alliance beats a free alliance). G1–G2 bound it (no one exceeds the earnable ceiling; nothing bought shifts scored buckets) but cannot erase it entirely. **The owner chose the pairing answer in clear terms: "whales can buy all day long — they will just be paired with other whales to fight against [them]; that keeps the pay-to-win fair and keeps our balance on gaming with servers."** Reverberation pairing (§17 of the war spec) is therefore the owner-ratified fairness control — whale worlds fight whale worlds, free worlds fight their class — combined with the shared earnable ceiling (G1: even a whale can never field more than a patient free player's cap). The categorical line (§5) remains in force while the storefront is off. Revisit if live data shows the tilt breaking fairness.
---

---

## 12. The store surface — OWNER RULING 2026-09-13: present, do not argue

**The player-facing store carries NO pay-to-win and NO limitation language.** G1–G4,
"no solo win", the "earnable in play / a head start within the earned cap" footer, "no
tier skips", and any "what you can/can't do" framing are **guardrails, not copy**: they
are asserted in the code, in the suites and in `design/` — never printed in the store.
The store presents the packs and lets people buy. (Owner-ratified 2026-09-13; executed
2026-09-26 on `feat/store-copy-plain`.)

What left the player's view:

| Where | What no longer appears |
|---|---|
| PackCard footer | the whole G1–G4 trust paragraph |
| Head-Start Packs intro | "craftable or earnable in play — a head start on the earned curve, never above it" · "none are purchasable yet" |
| Pass footer | "No tier skips are sold." |
| Cosmetic rows | "Pure appearance — no stat, no speed, no edge." |
| Deed rows | "…viewable, never buyable." |
| Callings/Oracle block | the `NEVER FOR SALE` chip (now `COMMEMORATIVE`), "No offering ever buys a moment of it.", "never by spend or votes" |
| Pack blurbs / grant notes | "the same model craftable in the workshop at Tier 2" · "cosmetic currency only — never advancement" · "the vehicle is buildable; the trim is purchasable. A veteran who didn't buy it…" |
| The Forge-adjacent cosmetic blurbs | "sight and sound only, no effect" · "(leader XP is play-earned-only)" · "measured-not-voted" |

**Where the guardrail lives now** — and must keep living:

- `site/src/game/monetization.ts` → `FORBIDDEN_POWER_TERMS` + `assertCatalogFair()`,
  which throws on power vocabulary in any pack, cosmetic or premium-tier label;
- `monetization-tests/monetization-verify.ts` §9 → proves it still throws on a planted
  term in pack copy **and** in the premium track;
- `payments-tests/payments-verify.ts` §5 → the store-surface scan: no store string, pack
  line, cosmetic blurb or overlay literal may carry limitation vocabulary;
- this file (§5, §11) and `visual-pass-1-storefront.md` §3.

A *disabled* control may still state the truthful **availability** reason (the ledger is
not open yet). It may not editorialize about the game — and the store stays OFF
(`storefrontEnabled === false`); this ruling is about copy, not about opening the store.
