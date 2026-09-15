# Spec — Leader XP / Leveling / Specialization (authoritative build doc, 2026-09-02)

Owner-approved direction: "give players choices and freedom to evolve the way they want." Progression is **earned through play, never bought** — no XP gains, attribute points, or specialization paths are purchasable, and no system gate touches monetization. Implemented and verified in the live build (V3 engine, published to the working site).

## 1. XP sources (event-sourced — only real events grant XP)

| Event | XP | Where wired | Chronicle? |
|---|---|---|---|
| Research project completed by appointed Leader | +10 | `resolveResearch` (engine) | Yes (⭐ line) |
| Breakthrough fires on that completion | +25 (bonus) | `resolveResearch` | Yes (⭐ line) |
| Survived a wildcard/surprise encounter | +12 | `resolveExpedition` (wc !== "lost") | Yes |
| Deep Shatterlands run (zoneTier ≥ 2) | +8 | `resolveExpedition` | Yes |

Notes / assumptions:
- Expeditions do not currently assign Leaders to teams (no leader-per-expedition field exists). The brief allowed wiring the hook "where a leader's known successes resolve" — so wildcard-survival and deep-run XP are granted to a random **active** Leader of the colony at expedition resolve. When a leader-appointment-to-expedition layer ships later, the grant can move onto the assigned leader trivially (same `grantXpTo` primitive).
- A "lost" team does **not** grant wildcard XP (no survivors to learn from) nor deep-run XP; deep-run XP is also skipped on a lost run.
- zoneTier mapping: deep rad ≥35 → 2; rad ≥75 → 3; mild with risk ≥50 → 2; else 1. Only tier ≥2 counts as "deep" (all three scientific sites qualify).
- Balance flag: deep-run XP (8) goes to ONE active Leader per eligible expedition. This is slightly random but bounded by the daily cap; flagged in case the lead wants per-expedition leader selection first.

## 2. Daily soft cap

- **40 XP per UTC day, shared colony-wide** (all Leaders draw from one ledger `state.leaderXpCaps[dayKey]`; each Leader also tracks a rolling personal `day`/`dayXp` window).
- A rolling day-window means a stale/absent `day` on an old save behaves exactly like "0 earned today" — no migration needed.
- When the cap binds (individual or colony-wide), 0 XP is granted, a `console.log` fires, and a Chronicle line announces the bind (`⏳ … cap binds`).
- Rationale for colony-wide (vs per-leader): prevents grinding research back-to-back across the whole roster to funnel one Leader; keeps the "breadth of experience" reading. Per-leader display still shows `today X/40`.

## 3. Curve & leveling

- Square-root curve: `level = floor(sqrt(total_xp / K))`, `K = 50`. Cap **L10**.
- Exact cumulative thresholds: L1=0, L2=200, L3=450, L4=800, L5=1250, L6=1800, L7=2450, L8=3200, L9=4050, L10=5000.
- **Every level grants exactly 1 unspent attribute point** (tracked via `xpPointsGranted`; a reconciliation pass in `advance()` grants any missing points if XP ever changes outside `grantXpTo`).
- Player allocates each point into ONE of research/economy/combat/engineering via the Allocate modal on the Leader card. Allocation mutates the attribute, which changes real effects:
  - research: −4% research duration per point (existing formula),
  - economy/combat: +1% colony-wide per point (see §4 wiring),
  - engineering: −0.5% workshop craft cost per point (colony-wide).

## 4. The Level-3 specialization (THE key mechanic)

One-time, permanent, mutually exclusive per Leader. If the Leader reaches L3 without choosing, the offer stays **pending** on the card (amber button) and the auto-open modal until chosen; picking one locks the other two forever.

| Path | Mandate | Effects | Engine wiring |
|---|---|---|---|
| **Scholar** | Researcher's Mandate 🔬 | +15% research speed · +5% surprise-breakthrough chance | `researchDurationMs` ×0.85 for that Leader's projects; `breakthroughChance` ×1.05 (absolute 26%→27.3%) |
| **Marshal** | Warden's Mandate 🛡️ | +10% combat effectiveness · −20% surprise/survival damage severity | `marshalCombatMult` (+10% per marshal, cap +30%) divides scientist attrition in `resolveExpedition`; `marshalProtectionMult` (−20% per marshal, floor 50%) scales effective protection in the wildcard roll |
| **Quartermaster** | Quartermaster's Mandate ⚖️ | +10% economy effectiveness · −10% crafting cost | `quartermasterEconomyMult` (+10% per quartermaster) multiplies ember yield & supplies-per-minute; `quartermasterCraftMult` (−10%) enters `craftCost`/`craftItem` |
| **Purifier** | *(not yet implemented)* | — | **DEFERRED** to the corruption/Oracle layer (continuous cleansing, Oracle-granted trust). No mechanics, no UI, no enum entry in the live build — a stub note only. Lands later with purity/corruption systems. |

> **Naming (owner-locked 2026-09-14):** the three implemented paths are **Scholar / Marshal / Quartermaster**. **"Steward" is NOT a path — it is Kael's TITLE only** (the generalist caretaker / starter-Leader role, matching the prologue roster: Kael the Steward · Serev the Marshal · Vyra the Scholar · Miren the Quartermaster · Delen the Purifier). The economy path was renamed from the pre-lock "Steward" to **Quartermaster** everywhere in code (V10 engine); legacy saves that picked "steward" migrate to "quartermaster" (additive, idempotent — buff numbers untouched). Purifier is the 4th path, explicitly deferred above.

Scope decision (flagged): Scholar is **per-Leader** (it's about that Leader's own projects). Marshal and Quartermaster buffs are **colony-wide per specialized Leader** (additive, with caps), because combat/crafting/economy in the current engine have no per-expedition leader slot to hang on — this keeps them real and visible ("your colony has 2 Marshals → −40% survival severity") without a spec-breaking leader-to-expedition field. Light stacking with diminishing caps prevents degenerate all-one-path colonies.

All three implemented paths read as choices, work entirely on earned progression, and could never be gated behind spending: the modal's copy states this explicitly and the engine exposes no purchase path.

## 5. UI (mobile-first, no regression)

- Leader card: **Level N** badge, **XP bar** (current XP → next level, exact remaining `N XP → Lv N+1`), "today X/40 XP", one-time **Specialization button** when a L3 leader hasn't chosen, **+N points to allocate** button when points are unspent, and the bound path badge once chosen.
- **Milestone modal** auto-opens the first time a leader hits L3 with the choice pending (once per session; dismissing records it; the card button re-opens). Uses the `fixed inset-0 … flex items-start justify-center overflow-y-auto` pattern — nothing clips on short screens.
- **Allocate modal**: lists the four attributes with current → next value and a one-line effect description.
- New tooltips (`LAB_TIPS.leaderXp`, `leaderLevel`, `leaderAttr`, `specialization`) explain sources, the curve, and what the paths do. The Tooltip component is untouched — long-press/double-tap fix intact.

## 6. Persistence / migration

- `VERSION = 3` (now V10; see §4 naming note). `GameState` gains `leaderXpCaps: Record<string, number>`. `Leader` gains `xp`, `unspentPoints`, `xpPointsGranted`, `specialization`, `day`, `dayXp`.
- `ensureLeaderXp` backfills all fields idempotently: `xp=0`, `unspentPoints=0`, `xpPointsGranted=0`, `specialization=null`, rolling `day`/`dayXp` (stale → 0 today). Old saves load without errors (verified with a stripped legacy save).
- **V10 (2026-09-14):** `ensureLeaderXp` also rewrites a legacy `specialization === "steward"` to `"quartermaster"` before the known-paths guard — additive and idempotent (the economy niche is unchanged, only renamed). New saves/games write `"quartermaster"` directly; the API validator accepts only scholar/marshal/quartermaster.
- New API: `allocateLeaderPointFn` (leaderId, attr) and `chooseSpecializationFn` (leaderId, path) — both POST, both operate on the active game only, both reject when no point / below L3 / already bound.

## 7. Files

- `src/game/leader-xp.ts` (new) — curve, thresholds, day key, specializations.
- `src/game/types.ts` — Leader fields + `leaderXpCaps`.
- `src/game/engine.ts` — VERSION 3 (now V10), migration (incl. V10 steward→quartermaster), `grantXpTo`/`applyLevelUps`/`researchXp`, resolve wiring, `allocateLeaderPoint`/`chooseSpecialization`, Scholar/Marshal/Quartermaster mults.
- `src/game/research.ts` — leader factory defaults.
- `src/game/api.ts` — two new server fns + exports.
- `src/game/client-utils.ts` — display helpers (`leaderLevel`, `xpToNext`, `xpProgress`, `todayXp`, `dayKey`, `dailyCap`, `milestone`, `specs`).
- `src/game/tooltips.tsx` — 4 new tooltips.
- `src/components/ResearchViews.tsx` — Leader cards + both modals.
- `src/routes/play.tsx` — LabTab wiring for the two new actions.

## 8. Verification log (engine play-test, 40/40 checks)

Curve thresholds L1–L10, cap at 99999 ✓ · new-game defaults ✓ · research completion grants +10 & ledger records ✓ · level 3 at 450 with 2 unspent points ✓ · daily cap binds (0 granted, logged) ✓ · spec choice persists and second choice locked ✓ · below-L3 rejected ✓ · Scholar −15% duration & +5% breakthrough ✓ · Quartermaster −10% craft & +10% economy ✓ · Marshal +10% combat & −20% protection ✓ · allocate consumes point & raises attribute ✓ · stripped legacy save loads with defaults ✓ · **legacy "steward" spec migrates to "quartermaster" and still powers the mults ✓** · deep expedition resolves ✓. Build (`bun run build`) green; publish script ran clean (see publish status in report).