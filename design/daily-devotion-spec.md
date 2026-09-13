# Design Spec — Daily To-Do + Oracle Devotion Module (V6)

**Deepspace Engine · "daily devotion, long-term trust" pillar · build-ready design · Status: **partially owner-ratified** — **TD1 · TD2 · TD5 confirmed by owner 2026-09-12** (build-blocking set ✅); TD3, TD4, TD6–TD10 still open (defaults recommended in §6; TD6 balance-critical, not build-blocking).**
**Sources:** oracles-purity-layer.md §6, monetization.md §1.1/§5/§10.3.7, battle-side-rvr-spec.md §3/§10.2, heroes-design-brief.md §3.4/§8, unbound-revelation-track.md F5/§9, engine patterns (advance(), ensure* migrations, utcDayKey, grantCurrency idempotency, recordSeasonEvent, discipline(), awardDeedCosmetic, publicState() strip, api.ts server-fns, 5-tab client).

---

## §0 What this module is

A rotating, opt-in daily list of 4 small objectives drawn **today** from the live beta systems (expeditions, study, craft, research, clean recoveries, cleansing), each granting a small **Scrip** reward (earned-only, never Votives) plus **Oracle Devotion** — a per-colony monotonic ledger that is the soil Oracle favor later grows in. Finish the list → a small daily bonus + the season-pass `daily_list` objective fires. List resets on the **server UTC day-timer**. Missed days punish nothing. No premium path touches any part of it — asserted absent in tests. Ships as a **V6 engine migration** (`ensureDaily`, advance-reconcile, publicState slice, one claim API).

---

## §1 Core loop — what the daily list IS

### 1.1 Contract (plan + oracles doc §6)
- **Opt-in, never gated**: nothing in it is a prerequisite for research, expeditions, war participation, Oracles, or any progression. "Not mandatory, never gated — opt-in, compounding."
- **~15–30 min/day**: 4 items (TD1) satisfiable inside a normal deliberate session.
- **Rotates on the server UTC day-timer** (`utcDayKey`); rollover lazy inside `advance()` — offline-safe, idempotent.
- **Daily items are real acts, never chores**: every v1 predicate is a genuine existing engine event.

### 1.2 What the player sees
A fresh list each UTC day (compact panel on the Colony tab, §5). Items **flip to done automatically** — completion is server-derived from real events. The player's only daily interaction is **one claim button** (banked rewards) — work done but never claimed loses nothing: rewards and devotion bank until claimed, forever (TD3). No punishment, no "streak at risk" copy, ever.

### 1.3 v1 item pool — grounded in today's engine (ships NOW on the beta world)

| Item id | Diegetic label (example) | Completion predicate (engine hook today) | Category |
|---|---|---|---|
| `visit_cradle` | "Attend to the Cradle — walk the works" | Free tick: first `advance()` of the day | ritual |
| `launch_any` | "Send a team into the Shatterlands" | `launchExpedition` ok (any zone) | expedition |
| `launch_mid` | "Run the mid ruins beyond the rim" | `launchExpedition` zone `risk ≥ 40 && radiationLevel < DEEP` | expedition |
| `launch_deep` | "Take a deep scientific site" | `launchExpedition` zone `radiationLevel ≥ 60` | expedition |
| `study_ember` | "Study Embers in the lab" | `beginStudy("ember")` ok | lab |
| `study_chipset` | "Decode a Chipset" | `beginStudy("chipset")` ok | lab |
| `craft_item` | "Forge something in the Workshop" | `craftItem` any kind ok | workshop |
| `refuel_convoy` | "Refuel and re-silence the convoy" | `craftItem` of `gas` or `battery` | workshop |
| `research_complete` | "Complete a research project" | `resolveResearch` (tech or revelation) | knowledge |
| `clean_recovery` | "Bring a surviving archive home whole" | `resolveExpedition` with `cleanRecovery === true` | purity |
| `cleanse_taint` | "Cleanse the Cradle's taint" | `discipline(state, spend ≥ 1)` ok | purity |

**11 v1 items.** The generator draws **4** with constraints (TD1): ≤1 of the three launch items, ≤2 expedition-family, ≥1 non-expedition, purity item ~every other day. Items a colony genuinely can't do today don't appear (unlock-gated pool: `launch_deep`/`study_chipset` only when capable). Deterministic generation, server-side, from public-ish state only.

### 1.4 Later-phase items (hook design leaves room)

| Item id | Predicate | Phase |
|---|---|---|
| `riddle_answered` | Truce day, colony `met` | B (Oracle intro / war Phase 1 Truce) |
| `cleanse_window` | Truce-day cleansing of `chorusAttention` | B |
| `purify_assist` / `shield_ally` / `save_colony` | war assist/shield/rescue ledger events | C (war Phase 1–2) |
| `decline_find` | **needs a new micro-decision at wildcard resolve** (today automatic) | C |

Item **categories** (ritual/expedition/lab/workshop/knowledge/purity) are first-class — pool constraints now, purity-weighting of favor later (§3.2).

---

## §2 Rewards — small, Scrip-earned only, zero P2W surface

### 2.1 Reward schedule (v1 defaults — TD2)
| Grant | Scrip | Devotion |
|---|---|---|
| Per completed item | +30 | +1 |
| List completion bonus | +80 | +3 |
| **Daily max** | **200** | **7** |

- All via `grantCurrency(state, "scrip", n, "daily:<dayKey>:<itemId>", …, "earn")` — idempotent append-only ledger.
- Devotion accrues on **claim**, streak counts **completion** days (§2.3) — not clicking never costs the streak.
- On full completion: `recordSeasonEvent(state, "daily_list", now)` exactly once — satisfies the already-waiting monetization §10.3.7 daily + weekly pass objectives.

### 2.2 Guardrail surface (hard lines, asserted in tests)
- **Scrip only** — a test asserts no `"votives"` ever appears in a daily reward path; no Votive-shaped field in daily state.
- **No purchasable completions, no skip, no "complete with premium"** — no function in the module surface accepts a purchase; `claimDailyRewardFn` validates only `{token}`. Guardrail test asserts the surface has no skip/accelerate/donate handler (mirrors the monetization no-conversion assertion).
- **Nothing here is advancement**: Scrip buys the future player economy, never research/XP/favor/tiers; the list does not accelerate timers and does **not** feed `contributionScore()` (§2.4).
- **No grind-tuning pressure**: 15–30 min of the normal loop; the monetization §5 "Pay-to-skip grind walls" row made concrete.
- **Betrayal-free by construction**: no item asks for an AI-feeding or corrupting act; purity items are present but never mandatory.

### 2.3 Missed days / streak
- Missed day = nothing happens. Silent roll at next UTC day.
- **Streak** (`devotionStreak`, server-side): consecutive UTC days with ≥1 completed item; `lastStreakDay` exactly-once-per-day (the `growUntouchedStreak` precedent). Not client-writable.
- **Recommendation (TD4): streak is prestige-only** — it feeds (a) the **D6 deed cosmetic "Wheel of Years"** (`deed_30day_devotion`, `wired: false` entry in monetization.ts waiting for this module; this flips it `wired: true` at ≥30 days) and (b) Chronicle milestones at 7/30 days. No reward scaling — kills streak-anxiety.

### 2.4 Honest flags for the lead
1. **First live Scrip faucet**: no live earn-source grants Scrip yet (ledger paths exist, earn hooks unwired). The daily list becomes the first real faucet on the beta world — and there's no surfaced sink yet, so balances bank toward the future economy. Expected, not a bug — but the owner should know beta Scrip balances will be small and meaningless until the market lands.
2. **The daily list must NOT feed `contributionScore()`** — the Contribution Award measures dents, not checklist compliance (oracles doc §8). Owner can override (TD10).

---

## §3 Devotion ledger → Oracle favor

### 3.1 The ledger
```
devotion: number         // lifetime total, MONOTONIC (like totalCodicesEarned)
devotionStreak: number   // consecutive UTC days with ≥1 completed item
lastDevotionDay?: string // streak bookkeeping (inside daily block; single source)
```
- Top-level per-colony state (beside `leaderXpCaps`, `currency`); the war layer's `oracleRoster` later **reads** it — no duplication, single source of truth.
- Monotonic on purpose: cumulative practice of attention — can't be bought, spent down, or gamed downward.

### 3.2 Devotion → favor (qualification per oracles doc §4 — purity, not AI)
Two distinct notions kept deliberately separate:
- **Devotion** = the daily-path ledger; the *practice of showing up*. Measures effort; **not itself trust**.
- **Favor/trust** = earned trust through qualifying acts: clean recoveries, Codices carried/earned, declined corrupting finds, shielded allies, riddles answered, honored truces. Accrues from purity-typed inputs; **falls on betrayal**.

**V1 favor implementation (no new persistence, TD6):** pure derived function from existing counters:
```
favorScore(state) = devotion×0.5 + cleanRecoveries×2 + zeroCorruptionSurvivals×2
                  + codicesEarnedByDeeds×1.5 + totalCodicesEarned×0.25 − betrayals×10
```
Placeholder thresholds (TD6): vouch-eligible `favor ≥ 30` (≈ 3–4 weeks), cleansing-eligible `≥ 15`. Constants, calibrate later, aligned to heroes O2 finite-time bounds.
**The reconciliation:** "Devotion opens the door, purity qualifies." A player can't grind favor by spamming the checklist — they must do the clean work the list happens to point at.

### 3.3 War-layer interplay & betrayal (battle-side §3)
- **Truce day** (Phase B): pool gains `riddle_answered` (met colonies) and `cleanse_window` (favor-eligible) — conditional pool entries, same generator, no new architecture.
- **The turbine composes cleanly**: war raises `chorusAttention`; the Truce-day cleanse item pays it down; devotion→favor gates cleansing — the daily module IS the low-frequency beat of the war cycle's purity half, without making the list mandatory for war.
- **The daily list never offers a betrayal path** — no reward is big enough to be a bribe. Betrayal events (broken truces, corrupting choices) hit `favorScore` via `−betrayals×10` at the war layer; a withdrawn Oracle's earned vouched heroes remain (no confiscation).
- **Velocity, not wallet**: devotion caps at the published 7/day; money has no input; the test suite asserts the absence of any spend path.

### 3.4 The seventh Oracle / Unbound ascension (flag)
- **unbound doc F5 (locked):** revelation progress is a parallel, independent purity meter — separate from Oracle Devotion, no consumption either way. This module honors F5 in full.
- **Compatible futures**: Devotion levels Oracle levels (attribute bonuses per oracles §5); a later ascension rite may charge a **Devotion cost** (`devotionSpent` delta field added only when that module ships — a *new* Devotion→ascension relationship F5 does not forbid). **Owner decision TD8.**

---

## §4 Engine integration (V6)

### 4.1 New state fields (types.ts)
```
daily: { dayKey: string; list: string[]; events: string[] /*SERVER-ONLY*/;
         completed: string[]; claimed: string[]; bonusClaimed: boolean;
         rolledAt: number; lastStreakDay?: string };
devotion: number; devotionStreak: number;
```
Streak bookkeeping lives **only** on `daily.lastStreakDay` (one field, one code path); `devotionStreak` is the derived count. Do not duplicate.

### 4.2 New pure module `src/game/daily.ts`
- `DAILY_CONFIG` (listLength 4, scrip 30/devotion 1 per item, bonus 80/3, streak consts)
- `DAILY_ITEM_POOL` (11 v1 defs; phase B/C ids stubbed)
- `generateDailyList(state, now)` — deterministic, constraint-honoring (§1.3)
- `noteDailyEvent(state, kind, now, zone?)` — single event funnel, dedupe via `daily.events`
- `reconcileDaily(state, now)` — advance-time rollover: finalize yesterday (streak exactly-once), generate fresh list, reset, mark `visit_cradle`; completion sweep → `recordSeasonEvent("daily_list")`
- `claimDaily(state, now)` — reward delivery + bonus grant

### 4.3 V6 migration — `ensureDaily` (ensure-pattern)
Defaults for every field; old V5 saves load green (`dayKey: ""` ≠ today → first advance rolls a fresh list). Called at the top of `advance()` beside `ensureMonetization`; `reconcileDaily` near the end beside `reconcileRevelationVisibility`. `VERSION = 6`. `newGame()`/`blankColony()` get fresh blocks.

### 4.4 Event hook sites (all existing action fns)
`launchExpedition` (launch_any/mid/deep by zone), `beginStudy` (study_ember/chipset), `craftItem` (craft_item/refuel_convoy), `resolveResearch` (research_complete, both job kinds), `resolveExpedition` (clean_recovery), `discipline` (cleanse_taint), `advance()` (visit_cradle free tick). No client can fabricate these — engine-generated from real actions.

### 4.5 API surface (api.ts)
- **Ship** (public): `daily: {dayKey, list, completed, claimed, bonusClaimed}`, `devotion`, `devotionStreak`.
- **Strip** (server-only): `daily.events` (raw dedupe set, like currency ledger), `rolledAt`, `lastStreakDay`; favor internals stay server-side (behind the Oracle introduction gate — silence discipline).
- **New server fn**: `claimDailyRewardFn` — POST, zod `{token}`, returns `{ok, state, granted:{scrip,devotion,bonus}}`. No read endpoint needed in v1 (rides publicState + 4s poll).

### 4.6 publicState() diff
Ship the check-off truth (`completed`/`claimed`/`bonusClaimed` — completions are not secrets); strip `events` and rollover internals.

### 4.7 Phase plan
- **Phase A — skeleton (ships now on the beta world):** V6 fields + ensureDaily + reconcile, daily.ts (config/pool/generator/funnel/claim/D6 sweep/season event), api claim fn + publicState, UI panel, test suite `/home/team/shared/daily-tests/daily-verify.ts` (rollover idempotency, dedupe, claim idempotency, no-Votives, no-skip-surface, V5-save migration, publicState strip, streak exactly-once, D6 at 30, season event once, guardrail table, re-run 161+102+40).
- **Phase B — Oracle intro + riddle/cleansing days** (war Phase 1 Truce): pool gains riddle/cleanse items; favorScore becomes the oracle roster's favor basis.
- **Phase C — war items + consumption:** purify_assist, shield_ally, save_colony, decline_find (small wildcard micro-decision), betrayal term, ascension spend (TD8).

**Sequencing note:** Phase A depends on nothing but the PvE loop — ships on the race-locked Watchers debug world now, per oracles doc's "Build sequencing."

---

## §5 UI sketch (minimal, mobile-pass)
- **Placement**: compact **"🕯️ Devotion"** panel on the **Colony tab** (default tab) — no new tab, no new dependencies, 4s-poll client.
- Header: "Today's Devotion" · right readout `7/7 · · · Devotion 214 · 🔥 12-day streak`.
- 4 rows: `[✓|○]` glyph + diegetic label + right-aligned `+30` / `+1`; footer single **"Claim — 160 Scrip · 7 Devotion"** button; fully-done row "🕯️ The day's devotion is complete — +80 bonus"; claim primary.
- **Quiet state**: "The Cradle asks nothing of you today." Zero chrome, no badges, no red dots, no streak-at-risk copy ever.
- Tooltip (header): *"A small daily practice. Optional — nothing here is required. Scrip is earned, devotion is the path the Oracles watch."* — must never mention favor thresholds or the Unbound track (silence discipline).

---

## §6 Owner decisions (recommended defaults marked ◆)

| # | Decision | Recommended default ◆ |
|---|---|---|
| **TD1** | List length + pool constraints | **4 items/day**; ≤1 launch, ≤2 expedition-family, ≥1 non-expedition, purity ~every other day; unlock-gated pool — **✅ owner-ratified 2026-09-12** |
| **TD2** | Reward sizes | **+30 Scrip/+1 Devotion** per item; **+80/+3** bonus; daily max **200/7**; flat (no hierarchy) — **✅ owner-ratified 2026-09-12** |
| **TD3** | Claim model | **One claim button; rewards bank forever** (no expiry, no FOMO); idempotent by eventId |
| **TD4** | Streak | **On, prestige-only**: Chronicle + **D6 "Wheel of Years" at 30 days**; no reward scaling |
| **TD5** | Devotion visibility / **first Oracle-trust surface** | **Public**: total + streak shown; favor internals/Oracle thresholds **server-side**; Devotion is the first earned trust surface toward the Oracle (oracles doc §4) — **✅ owner-ratified 2026-09-12** |
| **TD6** | Favor thresholds (placeholder) | formula as §3.2; **vouch ≥ 30, cleanse ≥ 15**; constants, calibrate later |
| **TD7** | Truce-day items (Phase B) | Riddle item (met) + cleansing-window item (favor-eligible), Truce day only |
| **TD8** | Unbound Devotion consumption | Future ascension rites may spend Devotion (`devotionSpent` field then); F5 honored |
| **TD9** | Purify-assist/save/decline items | Phase C (needs war assist ledgers + a "decline the tainted find" micro-decision at wildcard resolve — new action to spec later). Not in v1 |
| **TD10** | Daily list vs Contribution Award | **Does NOT feed `contributionScore()`** — Award measures dents, not checklist compliance |
| TD-X (inform) | Scrip faucet timing | Daily list is the **first live Scrip faucet**; balances bank toward the future economy. Expected; not a bug |

---

## §7 Integration points verified in code (for the engineer)
- `VERSION = 5` → bump 6; `ensureMonetization(state)` call at top of `advance()` is the insertion neighbor.
- `utcDayKey` (monetization.ts, exported) — reuse.
- The waiting `daily_list` hook: `DAILY_OBJECTIVES` + `WEEKLY_OBJECTIVES` in monetization.ts define `daily_list` (xp 20 daily / 50 weekly ×5) with "fires when the daily module lands" — this module's one `recordSeasonEvent` call satisfies both.
- Waiting D6: `DEED_COSMETIC_MAP.deed_30day_devotion` (wheel-of-years) `wired: false, note: "daily to-do module pending"` — flips `wired: true` via `awardDeedCosmetic` in the daily sweep.
- Existing cleansing: `engine.discipline(state, spend, now)` (api `purifyFn`) — supplies 10/spend → corrosion −5×spend; the `cleanse_taint` predicate. Keep discipline untouched; the daily item merely *notes* it.
- Reconcile precedents: `growUntouchedStreak` (exactly-once streak), `reconcileRevelationVisibility`, `checkAcknowledgedOnce`, battle-pass rollover.
- `blankColony` (race null) gets the fresh daily block — panel renders quiet state until race founded.

**Assumptions:** Devotion accrues at claim-time, streak counts completion-days; favor formula numbers placeholders pending TD6; "appraise a find" has no existing action → mapped to study items in v1; module is V6 (after V5 monetization + race-lock). Migration silent and backward-safe.

---

*Filed by team lead from researcher delegation report (session 9078f283-34ae-4137-ad3b-65efed24e70a). Read-only session — nothing written by the researcher. Build-blocking decisions: TD1/TD2/TD5; balance-critical: TD6.*