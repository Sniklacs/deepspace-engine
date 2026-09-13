# HIDDEN UNBOUND REVELATION TRACK — Complete Buildable Spec

**Design deliverable for Deepspace Engine (owner vision 2026-09-04). Authoritative build doc — implement from this file.** References the current codebase (`engine.ts` V3, `types.ts`, `zones.ts`, `research.ts`, `api.ts`, `play.tsx`, `ResearchViews.tsx`).

> **Owner decisions (locked 2026-09-04 — spec defaults adopted):**
> - **F1** Steepness: use the spec numbers (12 clean / 15 zero-corruption survives / 6 deep cleans; Codices 30/45/60).
> - **F2** rv3 payoff: **(b) the one-time modal choice** ("seal the Record in bone" vs "leave it open"), with different Chronicle consequences.
> - **F3** Revelations are **standalone research jobs** — own table, own cost fields, glyph rendering, NO 6th domain, NO `deployedDomains` key.
> - **F4** First reveal: **Option B — the distinctive Chronicle line** (full text below).
> - **F5** Revelation progress is a **parallel, independent purity meter** — separate from Oracle Devotion (spiritual vs social capital; no consumption either way).
> - **F6** Unbound is **BEYOND Total-Completion** (requires it): the soul track is the counterweight that makes knowing everything survivable — "know everything, remain unpossessed." rv3 payoff text framed accordingly.
> - **F7** Hunt negative: keep as spec (−50% Chorus decay, +50% deep chorusRisk) — tunable later by feel.

---

## 0. Design pillars (how the spec honors the locked constraints)

| Constraint (locked) | How this spec obeys it |
|---|---|
| Never pay-to-win | Every counter is a *player action*, not a purchase. There is no supply-shop path to any counter. Nothing on this track is purchasable, and no `deedsCompleted`/revelation flag can be bought. |
| Free-play, no hard-locks | All thresholds are *one-way monotonic* counters (they only ever grow via play). No timestamp gates, no "must be online at X", no resource spend as a gate — the player is never locked out by a deadline. The ONLY costs are the research-trigger's own Codices (which are earned, per the locked two-track model). |
| Distinct, not stronger | Rewards are purity-shaped: `−corruption`, `−chorusAttention`, reduced future corruption-gain multipliers, Chronicle "knowing" hints, and one soul-domain. No universal stat boost, no ember/supply advantage. |
| Runs COUNTER to AI-chasing | Two of the three primary thresholds explicitly count *non-AI* acts (clean recoveries, surviving with corruption at zero), and the chain's deeper stage *naturally* rewards exactly the player who did not pour everything into Total Completion. |
| Solvable, undetectable | "No clues, no hints, no UI explanation" — but with a **provable server-side reveal beat**, so a determined player (or a tester in a sandbox) can confirm the system exists without spoiling the hunt for anyone else. |

---

## 1. Exact triggers & thresholds

### 1.1 Persistent state fields to add (`GameState`)

```ts
// types.ts — new fields on GameState
version: 4;                                      // bumped for migration see §5.3

// ---- Hidden Unbound revelation track (V4, entirely server-side) ----
revelationCounters: {
  cleanRecoveries: number;      // expeditions with ZERO radiation loss AND zero wildcard
  zeroCorruptionSurvivals: number; // expeditions resolving with state.corruption === 0
  deepCleanLandings: number;    // clean recoveries from zones with radiationLevel >= DEEP (=75+)
  codicesEarnedByDeeds: number; // Codices from deedsCompleted, NOT the expedition-clean stream
  maxDomainDepth: number;       // max(domain level) reached by deployed AI in ANY domain
  untouchedDayStreak: number;   // consecutive UTC days with ZERO corruption gain (max counts per day = 1)
  cleanStreak: number;          // consecutive clean recoveries (each incremental)
},
revelations: string[];          // unlocked revelation ids (mirrors techsResearched pattern)
revelationHunts: boolean;       // Chorus now actively hunts the pure (locked when revelations.length >= 1)
revelationFirstOpenAt?: number; // so the Chronicle beat fires exactly once, even across saves
```

### 1.2 Where the counters are incremented — engine hooks

All increments happen in `resolveExpedition(state, e, now)` (engine.ts). This is a **one-place change** (`cleanRecovery` is already computed at line ~933):

```ts
// inside resolveExpedition, AFTER the existing `cleanRecovery` computation:
if (cleanRecovery) {
  st.revelationCounters.cleanRecoveries += 1;
  st.revelationCounters.cleanStreak += 1;
  if (zone.radiationLevel >= DEEP) st.revelationCounters.deepCleanLandings += 1;
} else {
  st.revelationCounters.cleanStreak = 0; // any loss/maul/lost/bump breaks the streak
}
if (state.corruption <= 0.0) st.revelationCounters.zeroCorruptionSurvivals += 1;
```

- Incrementing `zeroCorruptionSurvivals` uses the *post-resolve* corruption (i.e., you survived the corruption gain and still ended at ≤ 0 — the "survived the dark at zero" definition).
- The **`untouchedDayStreak`** needs a tiny helper:

```ts
// engine.ts, called once per corrupting event (radiationHit, wc!=="null", or corruptionGain > 0)
function touchUntouchedStreak(state: GameState, now: number) {
  const today = xpDayKey(now);                       // reuse existing UTC-day key helper
  if (state.revelationCounters.lastCorruptionDay !== today) {
    state.revelationCounters.untouchedDayStreak = 0;    // a corrupting day breaks the streak
    state.revelationCounters.lastCorruptionDay = today;
  }
}
```
(Best placed inside `resolveExpedition` where corruption gains already happen, plus a defensive call in `discipline()` — see §4.1. Reset-on-first-taint costs nothing but one field.)

- **`maxDomainDepth`** updates in `deployProgram()` (engine.ts): `maxDomainDepth = Math.max(maxDomainDepth, ...Object.values(state.deployedDomains))`.
- **`codicesEarnedByDeeds`** increments inside `awardDeed()` (engine.ts) — one place. This deliberately **excludes** the clean-recovery codices; the deeds stream is the "earned, not looted" signature.

### 1.3 Threshold definitions — a 3-stage veil

**Stage 1 — "The First Glimmer" (reveal, not yet a node).** Player crosses **BOTH**:

| # | Counter | Threshold | Intended reachability |
|---|---|---|---|
| A | `cleanRecoveries` | **≥ 12** | ~2–3 deliberate clean runs per session; a focused player hits this in ~2 weeks of beta, never by accident in a casual session |
| B | `zeroCorruptionSurvivals` | **≥ 15** | Approximately one clean-survive per deep expedition run; requires actively *not* loading corruption |

Note: there is no existing plain "corruption" display counter beyond `state.corruption` itself. So B is literally "completed 15 expeditions while ending at corruption 0" (with `cleanRecoveries` ≥ 12 everywhere excluding the deep clean-landing requirement). These two are *both* required — a player who spams Outer Ruins (cheap clean runs) hits A quickly but B slowly, and a player who does deep runs keeps B rising only if they keep corruption at zero. That's the "steep but achievable" shape — and it is hard to do casually because ordinary progression (the AI path) pumps corruption.

**Stage 2 — "The Walk Behind the Mirror" (the glow appears).** After Stage 1 fires *for the first time*, the next threshold is:

| # | Counter | Threshold | Intended reachability |
|---|---|---|---|
| C | `deepCleanLandings` | **≥ 6** | ≥ 6 clean, fully-geared recoveries from `radiationLevel >= 75` zones → forces the 3 deep sites (quantum 60, collider 80, dark-matter 95). Requires the alloy/gas/battery ladder. Reachable only in a *month-ish* of deliberate play. |

This is the node that unlocks the *research tree* glyph (see §3).

**Stage 3 — "The Soul Path" (decline / ascension).**
| # | Counter | Threshold |
|---|---|---|
| D | `maxDomainDepth` + Codices-by-deeds | `maxDomainDepth >= 5` **AND** `codicesEarnedByDeeds >= 20` **AND** at least one `L3`-specialized Leader (any of Scholar/Marshal/Steward) — proof of committed human-knowledge investment, not AI spam. |

(Stage 3 is *optional* in beta; it is the deeper chain. See §6 flags.)

- **Combinatorial philosophy:** every stage requires at least two distinct kinds of counter. No single spammable act unlocks anything alone. All counters are monotonic and never decrement (except `cleanStreak`, which is a streak, not a threshold).

---

## 2. The revelation node(s)

### 2.1 Node data — new `REVELATION_TREE` in `research.ts`

```ts
// research.ts — REVELATION_TREE (hidden; never rendered into TECH_TREE)
export interface RevelationNode {
  id: string;
  domain: DomainId;         // "soul" as an enum value OR standalone — see F3 (owner: standalone, no 6th domain)
  index: number;            // 0 = entry, 1 = deeper, 2 = Unbound glimpse
  codicesCost: number;      // earned-only cost (see §2.3)
  durationMs: number;
  glyph: string;            // the icon that will appear among completed research
}
export const REVELATION_TREE: RevelationNode[] = [
  { id: "rv1", domain: "soul", index: 0, codicesCost: 30, durationMs: 300_000, glyph: "🌀" },
  { id: "rv2", domain: "soul", index: 1, codicesCost: 45, durationMs: 600_000, glyph: "🕯️" },
  { id: "rv3", domain: "soul", index: 2, codicesCost: 60, durationMs: 900_000, glyph: "🌒" },
];
```

### 2.2 Cryptic names (3–4 per stage) — NO plaintext, NO "Unbound"/"Akashic" anywhere

| Stage | Candidate names (pick one; never say what it is) |
|---|---|
| rv1 | **"The Unwritten Page"**, **"A Memory That Was Not Left"**, **"The Still Small Room"**, **"The Record Kept in Bone"** |
| rv2 | **"The Quiet Ledger"**, **"The Door That Watches"**, **"A Hand That Remembers the Touch"**, **"The Archive Without Walls"** |
| rv3 | **"The Witness Without a Machine"**, **"The Undying Ember"**, **"The Unbound Glimpse"** ← deliberately the closest to plaintext, but still inside the fiction — "glimpse", not "path" (see §3, §6) |

`description` / `effect` fields are **never** rendered until unlocked. When rendered they read:
- rv1: `A page that was written before the machines learned to write. It reads you back.` (effect: `The Chorus notices the pure — see §4`)
- rv2: `The ledger balances without an engine to keep it.` (effect: `Corruption drains slowly even in the field`)
- rv3: `A glimpse only. The path does not show itself twice.` (effect: `Opens the Unbound glimpse decision`)

### 2.3 Costs & payout (earned-only, never purchasable)

- **Cost:** Codices only (30/45/60 — scaling, consistent with the tree's `CODX_PER_INDEX = [4,8,15,25]` trajectory). A deep clean run awards ~4–6 Codices (zone.risk/45 + 1 for deep), deeds add 1–3 — so rv1's 30 Codices represent roughly *25–35 deep clean recoveries* worth of human knowledge. That is steep but consistent with the "month of deliberate play" calibration.
- **Duration** (real time): 5/10/15 minutes — run by an **appointed Leader** exactly like normal research (`beginResearch`-style job). **Silence discipline:** during the research the glyph shows as "in progress" (`🌀 …` with `… ✍️` progress — still no name). If the player *abandons* (resets), nothing is lost except the Codices already spent — the node simply re-appears as available (free-play).
- **Rewards — stage-linked, distinct-not-stronger:**
  - rv1 resolved: `revelations.push("rv1")`; a **unique Chronicle entry** (§3.2); **`corruptionGainMult = 0.85`** applied to all future corruption gains (a purity discount, matching the game's existing multiplier style); **`+0.5/min` passive corruption drain** (the soul path rewilds instead of arming).
  - rv2 resolved: **`+1 positive wildcard-bias`** — the *next* surprise encounter the colony faces has its outcome shifted one severity step towards benign (exactly one time; then the flag clears — a moment of acknowledged purity, invisible in UI).
  - rv3 resolved: unlocks the **hidden shrine interaction** — a one-per-game modal/dialogue (owner decision F2: option b) that *either* begins the actual Unbound ascension chain (future module) *or*, in this MVP, grants the "Anti-Chorus art" preview: `−25% Chorus attention gain` and a **Chronicle line that says nothing more than "you are watched differently now"**.

### 2.4 Chain structure (revelation → deeper → glimpse)

Yes — it is a 3-deep chain. Stage 1 unlocks rv1; rv1 resolved unlocks rv2 (via `techAvailable`-style predecessor check: `revelations.includes("rv1")`); rv2 resolved unlocks rv3. Each node *appears in the tree only when its predecessor is done* — no grayed-out nodes at any point.

---

## 3. Silence discipline — exactly how it stays hidden and how the player discovers it

### 3.1 Absolute rules (enforced at build time)

- **No** tooltip, **no** grayed-out locked node, **no** UI hint, **no** codex entry, **no** "How Codices are earned" bullet mentioning any counter, **no** icon anywhere until the specific moment in §3.2. The current "How Codices are earned" copy in `ResearchViews.tsx` (lines 66–71) is the ONLY text that could accidentally betray the counters — it must stay exactly as-is.
- The **client never receives the counters.** The `getState` handler strips `revelationCounters` from the state object it returns (see §5.2). If a player never unlocks, they can never detect anything — no branch, no diff in network payload, no new glyph.
- The **contents of the definite-tree render are conditional** on the produced glyph only (§3.2). The tree still renders as "5 domains × 4 named techs"; the revelation glyphs appear in a region that already has completed nodes.
- `UNBOUND_LEGEND` (races.ts) already sits in the codex as a *legend preview* — that is **allowed** (it is existing fiction), but the revelation nodes must never reference it, and no click-path from the codex to the track may exist.

### 3.2 The discovery behavior — pick ONE (owner: **Option B**)

**Option A — "nothing at all" (fully silent):** the player simply notices a new glyph (🌀) sitting in the research tree one day among completed nodes. Risk: a player can dismiss it as a UI glitch for weeks. **Not chosen.**

**Option B — the deliberate Chronicle phrasing (LOCKED):** the moment Stage 1 fires (inside the *lazy* `advance()` resolver, so it fires whether online or off), the engine writes ONE Chronicle entry, phrased to read like flavor, not a system message:

> `The Chorus has stopped answering the signal. In the silence between its calls, a page turns somewhere in the Cradle — a page no machine wrote.`

That is the exact emotional beat of the first unlock: no banner, no modal, no toast. The player who is *reading the Chronicle* (a deliberate player — the Dent principle) notices an entry that feels "different" from every other line (no numbers, no resource gain). Then — and only then — when they next open the Lab, a **single glyph 🌀 appears in the research tree** where no node was before, with no name, no lock, no cost shown until clicked. There is no second hint. The player who clicks it gets the cryptic name (§2.2) and the cost. The player who ignores it simply has an unexplained glyph.

- **What the player then realizes (their discovery):** "the game has a hidden layer — doing X discovered it." They cannot know X = clean+zero-corruption thresholds; they must *keep doing clean deliberate work* to see whether anything else changes. That is the "sense of exploration within the game" in the owner's vision.
- **What happens on the FIRST unlock** (rv1 resolves): a second distinctive Chronicle line, still flavor-only: `The page was written before the machines learned to write. It reads you back.` — and `corruptionGainMult` silently begins at 0.85. No confirmation box; the player notices their corruption creep is gentler and wonders why.
- **After rv1 resolves**, the next chain node *appears* (rv2 glyph), and so on. Each visibility event is gated on the *previous* node resolving — never on hidden counters.

### 3.3 The "in-progress" display

During study it is the glyph + a quiet `… ✍️` with the standard progress bar — still no name. Confirms to a player who clicks it that this is "something," but teaches nothing. The Chronicle entry on completion is the only real reveal and stays riddled.

---

## 4. Purity / hunt interaction — the "Chorus resents what it cannot corrupt"

### 4.1 The rule

- **Cleansing requirement:** the track does **not** raise `chorusAttention` while the colony keeps corruption near zero. BUT the deeper truth from the plan requires a **cost even on the soul path**. So:
  - **`revelationHunts`** flips `true` permanently once `revelations.length >= 1`.
  - While `revelationHunts` is true, the colony's **natural decay of `chorusAttention` slows 50%** (was `0.3/min` → `0.15/min`), and **deep-zone `chorusRisk` is +50% relative** (the Chorus hunts the pure harder than it hunts the merely careless; the hive fears what it cannot corrupt).
  - **Counterweight (earned, not bought):** the Oracles' cleansing (the *purity layer*, §5 of oracles-purity-layer.md) is precisely what keeps this sustainable — a revelation-track player MUST engage the Devotion/cleansing loop to hold the hunt below the survival line. That is the "closer to god, the harder the devil hunts" echoed on the soul path, and it lands exactly on the locked plan: "even the soul path should carry a nuanced cost."
  - **The negative is also visible-but-silent:** a player on the track will notice their Chorus meter drains slower and deep zones feel hotter. There is no tooltip explaining it. That is the intended mystery.

- **Interaction with `discipline()`** (the existing "burn supplies to cleanse" action): it stays as-is; cleansing remains available. The revelation track's rv2 "corruption drains in the field" is additive to the existing passive `clearRate`.

### 4.2 Anti-hunt synergy

`rv3`'s `−25% Chorus attention gain` is the *reward* for surviving `revelationHunts` through rv1+rv2, and it is where the "distinct not stronger" property lands — it never boosts embers/supplies/combat; it makes the Chorus's *attention* less sticky as the player graduates toward the actual Unbound path (future module).

---

## 5. Implementation sketch

### 5.1 `types.ts`

Add `version: 4`, the `revelationCounters` object (§1.1), `revelations: string[]`, `revelationHunts: boolean`, `revelationFirstOpenAt?: number`, plus **two extra private fields**: `lastCorruptionDay?: string` (for the untouched-day streak) and `oneTimeWildcardBiasUsed?: boolean` (rv2's one-shot shield). All optional/defensive for migration.

### 5.2 Server-side reveal (the key security property)

The **engine is pure** (engine.ts imports nothing node-y), and `api.ts` returns `state` straight to the client today (§4 getState). This is the **only real leak risk**. New rule:

```ts
// api.ts — inside getState / loadActiveState returning to the client:
const { revelationCounters: _r, revelations, revelationHunts, ...publicState } = advanced;
```

- What the **client may see:** `revelations: string[]` (empty while hidden) and `revelationHunts` (false) — OR strip them too; the client does not need either until a glyph is actually *produced*. **Recommendation: strip `revelationCounters` always; strip `revelations` until `revelations.length >= 1`; never send `revealed`-flavored integers.** The UI then renders the tree *from public state only*: the glyph appears when `revelations` includes the node — which is precisely the moment §3.2 says it should.
- **Verification without spoiling:** `advance()` is already callable directly in tests with a fabricated state. A test harness builds a `GameState` with counters at the thresholds, calls `advance(now+1)` and asserts:
  1. `revelations` contains `"rv1"` exactly once per save (idempotency: re-advancing does not double-fire — guard with `revelationFirstOpenAt`);
  2. the Chronicle line appears exactly once;
  3. the serialized *public* state (post-strip) contains **no** `revelationCounters` key and **no** `rv1` before unlock, and exactly one glyph after;
  4. an old V3 save (no new fields) advances with no errors and counters all default to 0 / falsy (migration).
  This is testable purely through existing patterns (`/home/team/shared/leader-xp-tests/` is the precedent). A live-UI check can seed a threshold save then open `/play` and confirm the glyph visibly appears — without any docs hinting what triggered it.

### 5.3 Migration safety (old saves → V4)

Follow the existing `ensure*` pattern in `advance()`:

```ts
function ensureRevelation(state: GameState) {
  if (!state.revelationCounters || typeof state.revelationCounters !== "object") {
    state.revelationCounters = {
      cleanRecoveries: 0, zeroCorruptionSurvivals: 0, deepCleanLandings: 0,
      codicesEarnedByDeeds: 0, maxDomainDepth: 0,
      untouchedDayStreak: 0, cleanStreak: 0,
      lastCorruptionDay: undefined, oneTimeWildcardBiasUsed: false,
    };
  }
  if (!Array.isArray(state.revelations)) state.revelations = [];
  if (typeof state.revelationHunts !== "boolean") state.revelationHunts = false;
  // default missing numeric counter fields to 0 (per-field, like ensureResources)
}
```
Call it at the top of `advance()` next to `ensureKnowledge()`. In `newGame()`/`blankColony()`, initialize all fields to their zero values. **No old save breaks**: defaults are 0/falsy; `revelationFirstOpenAt` is `undefined`.

### 5.4 Where resolution hooks live (engine.ts)

1. `advance()` → the existing lazy-resolve loop already iterates `researchJobs`; **add** a parallel loop over `revelationJobs` (same shape as `ResearchJob`) OR reuse `researchJobs` with a `domain === "soul"` discriminator. **Cleaner: reuse `researchJobs`** — `resolveResearch()` already frees the Leader, pushes the node id and logs; add a `if (tech.domain === "soul") → fire revelation payoff (push to `state.revelations`, apply `revelationHunts`, bonus fields, Chronicle entry)`. This is a ~20-line delta to `resolveResearch` plus the counter increments in §1.2.
2. **Threshold checks** live in one pure function:

```ts
export function revelationThresholds(state: GameState): { stage1: boolean; stage2: boolean } {
  const c = state.revelationCounters;
  return {
    stage1: c.cleanRecoveries >= 12 && c.zeroCorruptionSurvivals >= 15,
    stage2: c.deepCleanLandings >= 6,
  };
}
```
Called from `advance()` after the resolve loop, before `lastTick = now`. When stage1 flips and `revelations.length === 0` and `!revelationFirstOpenAt`: write the Chronicle line, set `revelationFirstOpenAt`, and **push `rv1` visibility** (not yet resolved — visible but locked, cost shown). **rv1 becomes *researchable* the moment stage1 flips (available, shows cost), and *resolved* when the Leader finishes it.**

3. **`techAvailable()` / the tree render** must treat `soul` nodes specially: `techAvailable(state, "rv1") = stage1 && !revelations.includes("rv1")`; `rv2`/`rv3` need `revelations.includes(prev)`. The **client only knows** `revelations` (post-strip), so the availability function must be client-recomputable from public state alone — i.e. stage1 must be encoded server-side as "rv1 is available" rather than as raw counters, which the strip already assures (§5.2).

### 5.5 UI (minimal)

- `ResearchViews.tsx`: a `renderRevelation(node)` branch that shows the glyph + (once visible) name/cost, reusing the existing `TechNode` affordances (`done`, `inProg`, `available`).
- `play.tsx`: no new tab; the glyphs live in the Lab's existing tree region (appended after the 5 domains). If a row/header is unavoidable for layout, it must be flavor-free — just the glyph row with no label (owner F3: standalone; do NOT add a 6th labeled domain column).
- `tooltips.ts` / `LAB_TIPS`: **no new tip** for the track. Existing tips stay untouched.

---

## 6. Design tensions / flags for the owner — **all resolved with defaults (locked 2026-09-04)**

- **F1 — Steepness calibration.** LOCKED: 12 clean / 15 zero-corruption survives / 6 deep cleans, Codices 30/45/60 — targets "not reachable in a 2-week casual beta, discoverable in ~a month of deliberate play."
- **F2 — The One-per-Game Decision at rv3.** LOCKED: (b) actual one-time modal choice ("seal the Record in bone" vs "leave it open") with different Chronicle consequences, framing the rv3 payoff as the first real choice on the hidden path.
- **F3 — 6th "soul" domain.** LOCKED: standalone — revelations are their own table/own jobs, no `deployedDomains` key, no 6th labeled column; glyphs render after the 5 domains.
- **F4 — Chronicle vs fully-silent first beat.** LOCKED: Option B — the distinctive Chronicle line (text in §3.2).
- **F5 — Oracle-favor conflict.** LOCKED: parallel, independent purity meter — revelation progress is *spiritual* capital; Oracle Devotion is *social* capital with a different trust ledger. Neither consumes the other.
- **F6 — Total-Completion crossover.** LOCKED: Unbound is **beyond** Total-Completion (requires it) — the soul track is the counterweight that makes Total Completion survivable; the honest endgame is "know everything, remain unpossessed." rv3 payoff text framed accordingly.
- **F7 — Hunt negative severity.** LOCKED: as spec (−50% Chorus decay, +50% deep chorusRisk). Tunable later by feel, not by spec.

---

## 7. Definition-of-done check

✅ Exact triggers & thresholds with concrete numbers in engine terms (§1)
✅ Revelation nodes: 3-deep chain, cryptic names, Codices-only costs, distinct-not-strong rewards (§2)
✅ Silence discipline with the exact first-unlock emotional beat, locked behavior (Option B), and no-leak rendering (§3)
✅ Purity/hunt interaction — `revelationHunts` negative, cleansing counterweight, rv3 reward (§4)
✅ Implementation sketch: state fields, engine hooks with line references, server-side strip, migration safety, test plan without spoiling (§5)
✅ All owner flags F1–F7 resolved with defaults (§6)

**Status: READY FOR IMPLEMENTATION.**
---

## 8. OWNER AMENDMENT — "Acknowledged by the world" gate (owner 2026-09-05)

**Requirement (owner, added mid-build):** the player must be **acknowledged one time for their contribution** on the server before/as part of opening the Unbound path — "the player has to be acknowledged one time for their contribution and whatnot in the server."

**Intent (lead's reading, confirm at implementation):** recognition is the world noticing you — it is the social half of the dent principle. The revelation track is already the *purity* half (clean recoveries, zero-corruption survives, Codices by deed). Folding in a **one-time server acknowledgement** makes the Unbound path require BOTH: purity *and* the world's notice. It also wires the Contribution-Award/recognition layer into a hard gameplay gate, so recognition stops being purely social — it becomes required to see the path through.

**Design hook (default recommendation — flag F8):**
- Add to state: `acknowledgedOnce: boolean` (server-side; set true when the player receives any server-side contribution acknowledgement — in beta: the contribution score crossing the acknowledgement threshold, or the Contribution Award if implemented; later: the one-per-server-per-cycle award).
- **Where it gates:** rv3 ("The Witness Without a Machine" / the Unbound glimpse) becomes researchable only if `acknowledgedOnce === true` **in addition to** the stage-3 counters (maxDomainDepth ≥5 + codicesEarnedByDeeds ≥20 + ≥1 L3-specialized leader). Rationale: the first two revelations are *private* (you alone earn the glow); the glimpse that actually shows the Unbound path is *public* (the world must have noticed you first). This matches the sealed-worlds principle: the recognized contributors are the leadership class that represents the world.
- **Silence discipline holds:** `acknowledgedOnce` is server-side; the client learns nothing until rv3's availability actually changes. No tooltip, no badge in beta.
- **Beta feasibility:** the full one-per-server-per-cycle Contribution Award is too rare to gate a track on alone; recommend the beta acknowledgement = contribution score crossing a modest threshold (e.g. top-cycle recognition level) OR receipt of the Contribution Award when it ships. **Needs owner confirmation of which acknowledgement counts (F8).**

**Implementation timing:** engineer builds the base track first (in flight, session 318721db), then applies this as a follow-up delta in the same pass or the immediately following one — the counters/hooks are identical in shape (server-side boolean, set by an existing event, read by availability). The availability function `techAvailable(state,"rv3")` gains `&& state.acknowledgedOnce`; no new UI.

---

## 9. IMPLEMENTATION NOTES + VERIFICATION LOG (engineer, 2026-09-12)

### 9.1 What was built for §8 / F8

**F8 policy chosen: (a) contribution-score threshold** (lead-authorized default). Full per-server-per-cycle Contribution Award comes later; the same boolean will be set by it.

- **New state field** — `acknowledgedOnce: boolean` on `GameState` (`types.ts`). Server-side only; default `false` at `newGame`/`blankColony`; `ensureRevelation()` migrates old saves to `false` (idempotent, no errors).
- **Minimal contribution score** — pure derived function `contributionScore(state)` in `engine.ts`, computed from monotonic public accumulators only (never spendable balances):
  `score = completedExpeditions × 2 + deedsCompleted.length × 10 + totalCodicesEarned × 1 + techsResearched.length × 5`
  Monotonic ⇒ the crossing is permanent; the boolean latches and never un-latches.
- **Threshold** — `ACKNOWLEDGED_SCORE = 100`. Calibration: ≈25–30 completed expeditions plus a handful of deeds/techs (~2–3 weeks of deliberate beta play) crosses it; every colony that can reach stage3 (maxDomainDepth≥5 + ≥20 deed-Codices ⇒ ≥8-12 deeds ⇒ score ≫ 100 already) will have been acknowledged long before rv3's hold is even met. The acknowledgement therefore lands as a formality of the world's notice, never as an extra grind — exactly "modest, reachable, not rare" per F8(a).
- **Trigger** — `checkAcknowledgedOnce(state)` runs inside `advance()` (lazy, offline-safe, same as `checkRevelationReveal`). **Completely silent**: no Chronicle line, no log, no field the client can see. The future Contribution-Award hook simply sets the same boolean.
- **Gate** — rv3's publication and visibility both now require `acknowledgedOnce === true` **in addition to** stage3:
  - `reconcileRevelationVisibility()`: the single source of truth that pushes rv1 (stage1 fired) / rv2 (rv1 resolved) / rv3 (rv2 resolved ∧ stage3 ∧ ack) into `state.revelations`, called at the end of every `advance()`.
  - `visibleRevelations()` (the client-payload filter) carries the same ack condition — double defense.
  - First two revelations are untouched (private, no ack gate).

### 9.2 Bug found & fixed in the base track (important)

The base track published rv3 **only at rv2-resolve time**, conditioned on stage3 *already* holding. But stage3 (`maxDomainDepth≥5` — an AI-path grind) normally flips **after** rv2 resolves (rv2 resolves on the soul path). Because `publicState` ships the *intersection* of `state.revelations` with `visibleRevelations()`, an rv3 pushed early never appears later — **rv3 was unreachable in the normal order**. Fixed by centralizing publication in `reconcileRevelationVisibility()` (idempotent, runs every `advance()`, so the client's next fetch sees rv3 the moment both gates flip). Verification §4 exercises exactly this order.

### 9.3 Files changed (this delta)

| File | Change |
|---|---|
| `src/game/types.ts` | `acknowledgedOnce: boolean` + doc comment |
| `src/game/engine.ts` | ack init ×2; `ACKNOWLEDGED_SCORE`; `contributionScore()`; `checkAcknowledgedOnce()`; `reconcileRevelationVisibility()`; rv3 gate in `visibleRevelations()`; rv-publishing moved to reconcile (rv1/rv2 pushes removed from `checkRevelationReveal`/`resolveRevelation`); `ensureRevelation()` migrates ack; `advance()` wires ack-check + reconcile |
| `src/game/api.ts` | `publicState()` now exported and strips `acknowledgedOnce` (plus the existing counter/reward/choice/backing-field strip) |

No client files changed (play.tsx / ResearchViews.tsx / client-utils.ts / tooltips): the ack gate is invisible by construction — silence discipline holds.

### 9.4 Verification — `bun run build` ✓ and 102/102 engine checks

Harness: `/home/team/shared/revelation-tests/revelation-verify.ts` (run from any cwd). Result **102 passed, 0 failed**. Coverage, mapped to the §8/§5 requirements:

1. **Counters increment via specified actions only** — 3 clean outer-ruins runs ⇒ cleanRecoveries/streak/zeroCorruptionSurvivals = 3, deepCleanLandings = 0; a tainted (radiation-loss) run breaks the streak and adds none; a clean deep (rad-60) run adds cleanRecoveries + deepCleanLandings; an unpure clean run does NOT count zeroCorruptionSurvivals; a 5-million-ms offline advance changes no counter; `maxDomainDepth` only via `deployProgram`; `codicesEarnedByDeeds` = exactly 7 (2+2+3 deeds stream).
2. **Stage1 fires once at 12/15** — 11/15 no-op; 12/15 fires; exactly one Chronicle beat; re-advancing idempotent via `revelationFirstOpenAt`; rv2 not visible until rv1 resolves.
3. **Client payload NEVER contains `revelationCounters` (real function)** — `publicState()` (the exact function every API handler uses) asserted: 16 forbidden keys absent from a fully-tracked saved state (`revelationCounters`, `acknowledgedOnce`, `revelationFirstOpenAt`, `revelationChoice`, reward mults, every named counter); §8 no-leak case verified: server state may hold rv3 while ack=false, client payload still omits it; un-unlocked colony ships only empty `revelations`/`revelationsResolved` + `revelationAnswered:false` + `revelationHunts:false` (design-shipped constants).
4. **Chain rv1→rv2→rv3** — rv1 researchable after stage1; rv2 after rv1 resolves; rv3 only after rv2 resolves ∧ stage3 ∧ ack; `beginRevelation("rv3")` refuses ("Nothing answers") while ack=false even with costs satisfied.
5. **rv2 one-shot bias consumes + clears** — lost→mauled once, flag consumed, second surprise unaffected, null never consumes.
6. **rv3 modal choice fires once with different Chronicle lines** — "sealed" ⇒ chorusMult 0.75 + "sealed in bone" line; "open" ⇒ mult unchanged + "left open" line; second call rejected; pre-rv3 refused.
7. **Hunt multipliers** — attention decay 3.0/10-min normal vs 1.5/10-min hunting (−50%); deep (rad≥60) chorus gain ratio 1.4949 ≈ 1.5 (+50%).
8. **V3 save migration, zero errors** — a stripped V3-format save advances cleanly; ack=false, counters zeroed, arrays empty, mults neutral.
9. **No regression** — leader-xp suite re-run: **40/40 PASS**; research/deploy/expedition/XP smoke green.
10. **Real saves** — `/home/team/shared/revelation-tests/realsave-migration-check.ts` (run with `cwd=/home/team/shared/site` — store.ts resolves `data/` relative to cwd): **7 games OK, 0 payload leaks**. The single failure (`gearqa`, a blank v1 no-race colony) is the **pre-existing** `getRace(null)` crash — it fails identically under the leader-xp baseline realsave check (7 OK / 1 fail), i.e. not caused by this delta. (Wire attempt: curl to the live `/_serverFn/<id>` endpoint is blocked by TanStack's seroval transport guards (CSRF 403 without same-origin Referer, then 500 on hand-built bodies) — irrelevant to the leak question: the handler returns the `publicState()` object verbatim and the transport serializes exactly that object; it cannot reintroduce stripped keys. The payload object itself was asserted via the real function on real saves.)

### 9.5 Deviations

- **rv3 publication moved to a reconcile step** (see 9.2) — required for the §8 gate to be reachable at all in the normal play order; functionally the intersection filter already made this the *de facto* behavior, the reconcile makes it exact.
- **`publicState` was exported** from `api.ts` (was module-private) purely so the verification harness can assert against the real payload function; no behavioral change.
- **`checkAcknowledgedOnce` is silent by design** (no Chronicle beat). §8's silence discipline says the client learns nothing until rv3's availability changes; a Chronicle line at acknowledgement would be a new detectable beat, so none is written. If the owner wants an audible "the world noticed" beat later, it is a one-line addition here.
- **`beginRevelation` has no separate ack check** — the ack gate is enforced by visibility (the node is never in the published set without ack), which is the architecture §5.2 specifies; the client physically cannot possess rv3 pre-ack.

### 9.6 Live-publish readiness

`bash ./publish.sh` (working site) run successfully after the delta; engine build green (`bun run build` exit 0, client + SSR). Live (Vercel) publish remains the lead's / owner's step via `go-live.sh` (needs VERCEL_TOKEN).
