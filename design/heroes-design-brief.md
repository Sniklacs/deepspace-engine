# Heroes Design Brief — Deepspace Engine (build-ready framework)

**Author:** researcher delegation (read-only session) · **Date:** 2026-09-12 · **Status:** design brief, ready for build scoping. **O1 RATIFIED by owner 2026-09-12 (Wave-1 Watcher roster + 8-vs-6 wave size approved) — the heroes build and the war's combat math may start.** **O2–O10 ADOPTED by team lead 2026-09-12** under the owner's delegated creative authority (owner: "you have just as much say... make your game") — recommended defaults below stand as decided; balance numbers may be calibrated later, never the rules (same treatment as TD6).
**Sources complied with:** business plan rev 13 (Heroes bullet under Factions; paid/dent/velocity principles), `design/battle-side-rvr-spec.md` §8 + §4.3 + §9, `design/oracles-purity-layer.md` (§3 gate, §4 qualifying), `design/monetization.md` (§2, §5 guardrails, §6 rows), `design/races.md` + `site/src/game/races.ts`, `site/src/game/{leader-xp.ts, engine.ts, types.ts, api.ts, research.ts}`.

---

## §1 Framework spine — immutable rules

Binding constraints, same status as battle-side §9 and monetization §5 rows — anything that looks like a violation goes to the owner before shipping.

**R1 — Earned and deterministic only. No gacha, no shards, no randomness, no purchase — ever.**
A hero joins a colony through exactly one of two server-measured events:
- a **signature deed** (a personal, durable threshold or war feat — §3 catalog), or
- **Oracle vouching** (the Oracle trusts a champion — §3.4), or
- (other-race heroes) the **cross-race axis**: invasion deeds on that race's soil, that race's Oracle vouching, or an Emissary trade (R3).

Nothing else. No loot boxes, no hero shards/artifacts, no random drops, no "recruit" buttons, no paid deeds, no purchasable acquisition of any kind. The earn event is appended to `state.deedsCompleted`-style ledgers and recorded on the hero (`earnedBy: deedId | "oracle_vouch:<oracleId>"`) so every hero's provenance is auditable — this is also what the History Book's "hero feats" lines are built from.

**R2 — Never random.** All earn conditions are deterministic threshold checks computed server-side from monotonic counters (the `contributionScore`/`checkAcknowledgedOnce` pattern). `Math.random()` never appears in an earn path. "Random" is also excluded from *who* you get: when a deed qualifies you, you (or the Oracle) name the champion from the pool that deed unlocks — player choice, never a roll.

**R3 — Race-bound collection axis.**
- **Home world = your race's roster.** A Watchers colony earns Watcher heroes from its own world's deeds.
- **Other races' heroes are earned by venturing** — (a) **invasion** — breach that world and complete deeds on its soil; (b) **that race's Oracle vouching** (their trust, earned by cross-world purity); (c) **Emissary trade** (sealed-worlds bridge, costing favor/trust on both sides, never currency; ships with the Phase-2 Council channel). Phase-1 policy: invasion + Oracle vouch live in Phase 1, Emissary trade in Phase 2 (recommendation, O7).
- Cross-race heroes never enter your roster silently — each carries `race` and `earnedBy` fields; the bonus is squad-choice depth, never stat superiority (same "distinct, not stronger" rule as Unbound).

**R4 — 12 per race; waves of 6–8. Watchers get Wave 1 first.** Each playable race is designed to **12 heroes** (§2). They ship in waves: Wave 1 = 8 per race, Wave 2 = remaining 4. The **Watchers debug/test world gets Wave 1 first** — the only world live in beta.

**R5 — Heroes are named characters, not stat skins.** Every hero has a name, a role, a one-line identity/personality, and a distinct decision-moment skill identity (battle-side §8: "decision moments, not APM"). No two heroes in a race share a silhouette/skill identity.

**R6 — Progression spine is the proven Leader spine.** level = floor(√(xp/50)), K=50, cap L10, 1 attribute point per level, daily-XP day-ledger cap, one-time mutually-exclusive L3 specialization (war-flavored; §4). XP is event-sourced from the war ledger only. Nothing purchasable.

**R7 — Unbound hero rarity is a discovery, never selectable.** The Unbound pool (§2.7) is earned-only, invisible until earned, never previewable, never purchasable — same silence discipline as the revelation track. No UI may name or advertise it.

**R8 — Participation is never hero-gated.** No hero, squad, or energy requirement blocks war participation or Contribution-Award scoring: supply hauling, purification assists (shields), and defensive shields are open to hero-less colonies.

---

## §2 Roster design — 12-hero archetypes per race

**Role taxonomy (uniform ids, race-flavored display):** `tank` · `damage` · `support` · `utility` · `econwar`. Race identity biases personality, skill flavor, and internal role skew (Nephilim carry 3 tanks; Asart carry 4 supports), but every race covers all five roles so squads (§5) can always be composed.

Heroes join at **level 1** (XP 0) regardless of deed tier; the deed buys the seat, the war buys the power.

### 2.1 THE GRAYS — intel/research identity. Naming: clinical catalog names, archive titles, owl motifs.
1. **Scribe-Castellan Vess** — tank · "The archive's bulwark: she has stood between a burning shelf and the dark so long the fire gave up."
2. **First Reader Mirel** — damage · "Reads a battlefield the way an archivist reads a wound — the exact line where it will give."
3. **Owl-Sign** — utility · "The owl that watches on their behalf; always already where the secret is going to be."
4. **Catalogue-9** — tank · "A collector who collects catastrophe: nine archives burned, nine rebuilt; immovable, mildly resentful."
5. **Keeper Nym** — support · "Catalogues the living; her wards are margin-notes written on the world, and they hold."
6. **The Interlocutor** — damage · "Speaks with the Chorus's own fragments; every conversation ends with the fragment agreeing to stop."
7. **Morrow, the Cold Ledger** — econwar · "Prices every march before it leaves; funds nothing at a loss, which annoys everyone, and he is always right."
8. **Stills** — support · "The quiet in the room when everyone panics; their calm is a technology the rest of the squad borrows."
9. **Curator Oss** — utility · "Recovers what the war forgot; if a route is lost, Oss finds it folded in a ruin's spine."
10. **The Owl's Debt** — econwar · "The Grays do not owe — and when they do, the debt is collected with interest visible only to the Chorus."
11. **Archivist Dawn-Chaser** — support · "A heretic among the clinical: she actually likes people; the archive has never quite known what to do with her warmth, and neither has the enemy."
12. **The Last Witness** — damage · "Was present when the Observatories fell; carries the catalogue of that day, and will settle it."

### 2.2 THE NEPHILIM — warfare/endurance identity. Naming: stone/mountain/standing epithets.
1. **Haldor the Unbroken** — tank · "Knocked down eleven times; the twelfth fall has not been invented yet."
2. **Ymir Last-Standing** — tank · "The last of his siege-line; still exactly where they left him, still holding."
3. **Bram Stonehold** — damage · "Does not aim; the ground does the work. His fist is geography."
4. **The Wound-Keeper** — support · "A medic who learned to heal by refusing to die; everyone who falls near him gets up."
5. **Sigrun the Slow** — damage · "Never out-thought the Chorus, never lost to it either; she hits once, and the hit remembers."
6. **Garrick Deep-Keel** — utility · "Hauls the machine-parts that hold the line; if it must cross a thousand miles of ruin, Garrick is the road."
7. **Mother Anvil** — econwar · "Runs the colony's forge and its feeding; 'armor does not feed a colony' is a sentence she has corrected, at length."
8. **Cal the Unmoved** — support · "A wall in the shape of a person; enemy fire files around him like weather."
9. **The Kept Oath** — damage · "Half-divine, half-earth, entirely stubborn; broke when the mountains broke, and continued."
10. **Vek Hundred-Wounds** — tank · "Wears his scars like a census; every one is a war he outlasted."
11. **Sera Stone-Light** — support · "The bright one in the siege-dark; her presence is the difference between holding and breaking."
12. **The Boneyard Marshal** — econwar · "Trades the things the giants left behind; has bartered ruins into rations for a generation, and the Chorus respects the account."

### 2.3 THE DRACONIANS — stealth/economy identity. Naming: cold ledger/serpent/warren motifs.
1. **Ssath the Quiet Ledger** — econwar · "Owns more debts than the Chorus owns hives; he collects."
2. **Vyrn Coldscale** — damage · "The dagger that has never once been seen leaving its sheath."
3. **The Sub-Ruler** — utility · "Can be anyone, sit in any council, and leave having skimmed the real decision out from under it."
4. **Morrow-in-the-Shadow** — tank · "Takes the hit so the plan survives; the plan always survives."
5. **Tess the Accountant** — econwar · "Stretches a resource and hides its true flow; your supplies are hers before you miss them."
6. **The Rent** — damage · "Collects what the world owes the Warrens; interest compounds in blood and Scrip."
7. **Hollowspeaker** — support · "Talks walls into standing; the Warrens taught every stone the value of silence."
8. **Jar-Nock the Unseen** — utility · "No footprint, no witness, no memory — except the cold room and the displaced ledger."
9. **Warmth** — support · "The one Draconian who kept his heart; the whole Warren treats him as a rare and dangerous delicacy."
10. **Kalk Deepreft** — tank · "Was once a door. Still behaves like one. Do not test which side you are on."
11. **Scale-Scribe Noct** — damage · "Writes what happened, after it happens, in the enemy's own hand."
12. **The Borrower** — econwar · "Borrowed a siege-engine in the old war and has been paying it off at favorable rates to Draconian interests ever since."

### 2.4 THE ANUNNAKI — genetics/mega-works identity. Naming: god-architect names with works appended.
1. **Enki-Ra, Founder of Pylons** — tank · "Built the first wall; has opinions about every wall since."
2. **Anzu the Unfinished** — damage · "A mega-work left half-made when the Chorus came; the unfinished half is a weapon."
3. **Gula the Seedmother** — support · "Grew the gene-lines that feed the Forge Valleys; what she grows, stands."
4. **Ninurta of the Lift-Anchors** — utility · "Raises what was fallen; city-builder, road-layer, the colony's second heartbeat."
5. **The God's Ledger** — econwar · "Told the Architects their hubris would fit on one page. It did not. She kept the page anyway."
6. **Utu-Ra the Unbowed** — tank · "Bred to endure; means it structurally."
7. **Inanna the Bright-Blade** — damage · "The Architects' answer to who guards the great works — a sword with a theology."
8. **Mardukh the Builder** — support · "Mends walls, engines, and (grudgingly) people; buildings are his patients."
9. **The Unfinished Child** — damage · "A gene-line the Architects never finished; the Chorus flinches from the incomplete thing."
10. **Eresh the Sower** — econwar · "Plants fields in the ash; harvests grain the Forge Valley no longer should grow."
11. **The Vault-Standing** — utility · "Guards the half-finished cathedrals; knows every corridor, loves each like a child."
12. **Sargon the Returner** — support · "Believes the colonies are the Architects' loaned inheritance; he is here to collect them — kindly."

### 2.5 THE ASHTAR COMMAND / PLEIADIANS — diplomacy/defense/anti-corruption identity. Naming: light/warden/lantern names.
1. **Seraph the Unbent** — tank · "Held a gate against the dark so the small could escape; has never once bent."
2. **Lyra Wardmistress** — support · "The healer who stands between; her light is a wall the Chorus tastes but cannot cross."
3. **Cassiel the Lantern** — utility · "Carries the signal that lets lost convoys find home; where Cassiel stands, the road is lit."
4. **The Bright Consensus** — support · "A council in one body; decides in the time it takes others to argue."
5. **Warden Thea** — damage · "Does not want to strike; has practiced, nonetheless, so it will be enough when the moment demands."
6. **Gatekeeper Ember** — tank · "The last light in a burning corridor; holds it open until everyone is through."
7. **The Unbent Shield** — support · "Shields allies from corruption; the taint slides off like weather off glass."
8. **Melia Starward** — econwar · "Trades honestly in a wrecked economy; her books are clean, and that is a kind of weapon."
9. **The Lantern-Bearer of the Reach** — utility · "Walks the supply lanes singing; escorts arrive intact, and the Chorus dislikes the song."
10. **Sister Quiet** — support · "The moral high ground as a person: inflexible, bright, and exactly where the worst is happening."
11. **The Warden's Wrath** — damage · "The one strike the Wardens allow themselves; reserved for the moment the dark has gone too far."
12. **Pax the Far-Returned** — econwar · "Negotiates truces the way others build walls; her word holds longer."

### 2.6 THE WATCHERS / GRIGORI — forbidden-knowledge identity. **Wave 1 ships first on the debug world. — ✅ Wave-1 roster owner-ratified 2026-09-12 (O1).**
- **WAVE 1 (8 heroes — the beta roster):**
1. **Azazel-3, the Teacher** — tank · "The one who taught the weapon and then stood in front of it to apologize; he is still standing. Leads marches the way he leads lectures: all the way to the end."
2. **The Last Lecturer** — damage · "Still giving the lecture that damned the world; the Chorus is his most attentive student, and he hates it."
3. **The Chained Syllabus** — tank · "A curriculum the Watchers chained shut; it taught itself anyway, and now teaches the colony."
4. **The Unwritten Answer** — damage · "Knows the one thing the Chorus cannot learn — and will not write it down; the Chorus aches for it."
5. **Semira the Revealer** — support · "Shows you the flaw in the enemy's design; the flaw is grateful to be seen."
6. **Brother Candle** — support · "Teaches the colonies to keep the light; every lesson is a small act of atonement."
7. **Vesper the Syllabus** — utility · "A walking curriculum of everything dangerous; knowledge is his scout, his fire, and his shield."
8. **Keeper Mend** — econwar · "Assigns the prices of forbidden knowledge; her ledgers are the least corrupt thing in the Academies."
- **WAVE 2 (4 heroes):** **Owl-Even** (utility · "The Watcher's watcher: sees the Chorus before the Chorus sees itself, and files it away"), **Tutor Grim** (damage · "Grades everything, including battles; has never given a pass"), **The First Foot** (support · "The knowledge the Watchers kept back; carries it now, and the weight of why"), **Registrar Void** (econwar · "Keeps the accounts of the Academies' ruin; knows exactly what knowledge cost, item by item").

Wave-1 role spread: 2 tank / 2 damage / 2 support / 1 utility / 1 econwar — every squad size 3–5 has legal compositions from day one.

### 2.7 THE UNBOUND — the earned seventh (discovery rarity, never selectable). Hidden pool of **3 heroes**, revealed only through the ascension track (revelation thresholds + `acknowledgedOnce` + purity war deeds); vouched by the seventh Oracle. Never rendered, named, or advertised until earned; `publicState` keeps them server-side.
1. **The Keeper of the First Record** — support · "Remembers the world before the machines learned to write; where they stand, taint washes off."
2. **The Unnamed Vigil** — tank · "Has held ground without claiming it for longer than colonies have had names."
3. **The Heart of a World** — utility · "The proof a soul can salvage itself back; their presence slows the Chorus's hunger for miles."

An owner decision (O9) gates when these are built — recommendation: design now, implement with the ascension track's later phases, keep entirely out of the beta world.

---

## §3 Earn-by-deed system (deterministic acquisition)

### 3.1 Deed catalog — tiers, conditions, engine hooks

All conditions are **personal, durable thresholds** (never one-per-server exclusive) so every hero is achievable by every colony in finite time. Server-wide firsts still fire — but they write History Book lines and Contribution score (dents), never exclusive hero access; each first-type deed has a **personal-threshold twin of equal difficulty-per-colony** that grants the same hero.

| Tier | Deed id | Condition (server-measured) | Engine hook |
|---|---|---|---|
| **T1 Herald** (~wk 1–3) | `hero_first_breach` | Your colony's first breach | warLedger `breach` event |
| | `hero_march_5` | 5 marches/captures resolved | warLedger march/capture count |
| | `hero_clean_march` | First march with zero corruption gain | warLedger + corruption diff |
| | `hero_haul_10` | 10 supply hauls delivered | warLedger haul events |
| | `hero_contribution_50` | `contributionScore ≥ 50` | engine `contributionScore()` |
| **T2 Veteran** (~wk 4–8) | `hero_weeks_4` | ≥1 scored action in 4 war weeks | warLedger weekly participation |
| | `hero_capture_1` | 1 capture (any world) | warLedger capture |
| | `hero_shield_15` | 15 shield assists | warLedger shield |
| | `hero_escort_10` | 10 escorts/supply-lane protections | warLedger escort |
| | `hero_comeback_1` | 1 scored action under comeback multipliers (your side >25% down) | warLedger + comeback flags |
| | `hero_contribution_150` | `contributionScore ≥ 150` | engine `contributionScore()` |
| | `hero_codex_scholar` | `revelationCounters.codicesEarnedByDeeds ≥ 20` | engine counter read |
| **T3 Legend** (~1–3 months) | `hero_purify_5` | 5 completed purifies (Phase 2 ability) | warLedger purify |
| | `hero_first_of_cycle` | A History-Book "first" of a war cycle (personal completion) | History Book firsts ledger |
| | `hero_climax_3` | Scored contribution in 3 Climax windows | warLedger + goldenWindow flag |
| | `hero_contribution_400` | `contributionScore ≥ 400` | engine `contributionScore()` |
| | `hero_legend_codex` | 40 Codices earned by deeds | engine counter |
| **Vouch** | `oracle_vouch:<oracleId>` | Oracle attention `engaged` + favor ≥ threshold | `oracleRoster` favor/attention |

**Mapping:** each hero in §2 carries a `signatureDeed` (its primary earn condition) drawn from the tier matching its power budget, **plus the Oracle-vouching alternate**. Wave 1 Watchers map to T1/T2 deeds (Azazel-3 → `hero_first_breach`; Semira → `hero_clean_march`; Vesper → `hero_march_5`; Keeper Mend → `hero_haul_10`; The Last Lecturer / Unwritten Answer → `hero_contribution_50` + `hero_march_5` alts; The Chained Syllabus → `hero_shield_15`; Brother Candle → `hero_weeks_4`). Wave 2 heroes map to T2/T3 deeds. No hero sits below its tier's difficulty; no hero's condition can be abbreviated by spend.

**Finite-time guarantee (the contract):** every earn condition is monotonic-and-personal, so a colony earning XP at the published daily caps and participating in every war week reaches T1 by its ~3rd week, T2 by its ~8th, T3 by ~its 3rd month; the Oracle-vouch path is available as soon as favor threshold is met. Worst-case bound for the entire Wave-1 Watcher roster ≈ 8 weeks of steady play with no PvP advantage required. This guarantee is a **test assertion** (§7 verification), not a hope.

### 3.2 Determinism mechanics
- Deed completion runs inside `advance()`-style reconcile (offline-safe, idempotent, exactly-once via an `earnedHeroes: string[]` set — same shape as `deedsCompleted`).
- On completion: hero object created at L1 with `earnedBy` stamped, a Chronicle line announces the induction, the event appends to the war ledger + feeds `contributionScore` (deeds +10 — flagged in O10).
- No purchase path touches any condition; the client can never request a hero — only the engine creates them.

### 3.3 Cross-race acquisition (operational)
- For an **other-race hero**, the deed binding is: *breach that race's world* (invasion), complete the deed on that soil where the tier specifies, **or** gain that race's Oracle vouching, **or** Phase-2 Emissary trade. The hero's `race` field permits squad inclusion in your world; same power curve — no bonus for being foreign, just access depth.
- The Watchers beta world has no rival pairings until the war layer's Phase 1 — so **Phase 1 = own-race heroes only**, with cross-race ledger hooks (breach-count, per-race favor) in place so invasion-earned heroes activate the moment pairings start.

### 3.4 Oracle vouching pathway
- Per oracles doc §3: Oracle state `none → met (first breach) → watching → engaged` (engaged = a server-measured dominance deed). Only an **engaged** Oracle can vouch.
- **Vouching = the Oracle names a champion.** At favor ≥ published threshold (accumulated purely: Codices carried into their ground, clean recoveries, declined corrupting finds, shielded allies, riddles answered — never bought), the colony presents the hero it is pursuing and the Oracle's trust stands as the qualification: the hero joins with `earnedBy: "oracle_vouch:<oracleId>"`. Vouching is **per-colony**, never server-exclusive.
- The vouch writes to `oracleRoster` (+favor note), the war ledger, and the History Book. Betrayal rules apply unchanged: court corruption and the Oracle withdraws — a withdrawn Oracle's vouched heroes remain earned (no confiscation; the penalty is the closure of the *next* vouch).

---

## §4 Progression (reuses the proven Leader spine)

- **Curve:** `level = floor(sqrt(xp / XP_K))`, `XP_K = 50`, cap **L10** — reuse `levelFromXp`/`LEVEL_XP`/`xpForLevel` from `leader-xp.ts` unchanged. Thresholds identical: L2=200 … L10=5000.
- **Attributes (war-flavored, 1 point/level, free allocation):** `power` (offensive skill strength), `guard` (defense/survivability), `craft` (small published reduction to that hero's action energy costs, hard-capped so it never zeroes the fairness valve), `presence` (support/utility strength and score contribution). Reuse `applyLevelUps`'s invariant (`points = level − 1`).
- **XP sources (event-sourced, war ledger only):** march resolved +10 (win) / +4 (loss — losing weeks pay participation), capture +15, purify +20 (Phase 2), shield assist +8, haul +6, comeback contribution +12, hero deed/first +25, riddles answered by a vouched hero's Oracle +10. All through a `grantHeroXpTo` primitive cloned from `grantXpTo` (same rolling `day`/`dayXp` window, separate `heroXpCaps` key so leader and hero budgets don't cannibalize; same 40/day cap).
- **L3 one-time specialization** (mutually exclusive; scholar/marshal/quartermaster as the pattern):
  1. **Vanguard — Spear's Mandate ⚔️** · offensive skills +15% strength; capture contribution +10%.
  2. **Hearthward — Gate's Mandate 🏰** · purify channels + shield assists +15% effectiveness; defense-action energy cost −15%.
  3. **Courser — Road's Mandate 🏇** · their action energy costs −15%; haul/escort scoring +15%.
  All three are sidegraded, stack with published caps, are engine multipliers only, and have zero purchase path. Names/effects flagged in O4.

---

## §5 Squad system

- **Composition:** 3–5 heroes (**min 3 to field a march**; proposed default max-5 — O3). The squad's skill set **is** the war loadout. Heroes not in the squad contribute nothing offensively that week — squad choice is the strategic layer.
- **Server-side validation** (`setSquadFn`, `createServerFn` + zod): token → account → active game → `advance()`; then assert — (a) every id ∈ `state.heroes` (owned), (b) no duplicates, (c) size 3–5, (d) **race constraint**: `hero.race === state.race || hero.race ∈ state.earnedHeroRaces`, (e) **phase lock**, (f) squad ids never writable outside `setSquadFn`. Rejections return user-readable errors, nothing mutates.
- **Edit locks:** squad **opens during Gearing (D1–2) and Truce (D7), locks at Campaign start (D3 00:00 UTC), unlocks at Truce (D7 00:00 UTC)**. No mid-campaign swaps.
- **Action mapping:** **march / capture** = offensive squad action (damage/tank skills resolve in the decision moments); **escort / haul** = logistics (utility/econwar skills; Courser-specialized heroes shine); **purify** (Phase 2) = Oracle-favored colony *and* ≥1 support/Hearthward hero on the squad; **shield assist** = any squad, amplified by support skills. Action type determines which skills fire — composition discipline instead of APM.
- **Marches run offline, persistent-world style** — lazy resolution from the war ledger, with the squad snapshot at launch.

---

## §6 Energy & fairness (hard consts, no purchase field)

- `HERO_ENERGY_WEEK = 60` per hero per war week; resets at the week boundary. Spent tracked per hero as `energyWeek: {cycleId, spent}`.
- **Action energy costs** (per participating hero): march 20 · capture 20 · escort 15 · purify 15 (Phase 2) · shield 10 · haul 10.
- `DAILY_MARCH_CAP = 8` per colony per UTC day (marches + captures counted; shields/hauls/escorts are not march-capped — they are the participation floor and stay uncapped).
- **All three are engine `const`s** in a new `war-energy.ts` (no config field a purchase could write; day-ledger pattern `warEnergyLedger: {day, marches}`). The client renders remaining energy; it never writes it.
- **Participation is never hero-gated** (R8): supply hauling, purification assists, and defensive shields have zero roster requirement; all score and feed the Contribution Award; all work in a losing week. Energy caps are a fairness valve against no-life grind *and* whale stamina alike — invisible to money, identical for everyone.

---

## §7 Monetization boundary

- **Hero cosmetics ship later, and touch only visuals:** a future cosmetic skin = portrait/combat-trim/banner/sigil frame rendering only — zero engine effect, zero stats, zero score, zero read by the war engine (**any paid-track hero item is legal iff removing it changes zero engine outputs** — the battle-side §9.3 exact rule applied to heroes). Ownership through the existing entitlement seam (`owns()`, cosmetic catalog schema; add a `heroGarb` slot beside the existing `CosmeticSlot` set).
- **The explicit never-list:** no hero XP, attribute points, or specializations for sale; no energy refills/energy items/"extra march" passes; no squad-slot purchases; no hero shards/artifacts; no gacha/loot boxes of any kind (including cosmetic-only mystery boxes); no paid deeds; no purchasable hero acquisition; no stat-bearing hero cosmetics; no battle-pass tiers that unlock heroes (passes grant cosmetics/participation rewards only). Any future feature resembling a row goes to the owner before shipping.

---

## §8 Owner decisions (explicit decision points — not conclusions)

> **DECISION STATUS (2026-09-12): O1 owner-ratified. O2–O10 adopted by team lead under the owner's delegated creative authority ("you have just as much say... make your game") — the recommended defaults below are the decided values. Calibration of numbers is open forever; the rules below are not. Where a row below says "recommend", read it as "decided".**

- **O1 — Wave-1 Watcher roster approval:** **✅ RATIFIED by owner 2026-09-12** — the 8 heroes of §2.6 Wave 1 (names/roles/identities) approved as-is, and the **8-vs-6 wave size** decided at 8 (complete role coverage for squads). Build-blocking status: **CLEARED — heroes build and war combat math may start.**
- **O2 — Deed difficulty targets:** confirm T1/T2/T3 week bounds (~3 / ~8 / ~12+ weeks) and contribution thresholds (50/150/400); tune the hero-to-deed mapping.
- **O3 — Squad size & lock timing:** 3–5 flexible vs fixed 5 (recommend max-5, min-3-march); Gearing+Truce edit window vs Truce-only.
- **O4 — L3 specialization names/effects:** Vanguard/Hearthward/Courser and mandates + % values.
- **O5 — Energy numbers:** 60/wk pool, cost table (20/20/15/15/10/10), 8/day march cap.
- **O6 — Wave cadence for non-Watcher races:** ship remaining races' Wave 1 with their live worlds (12-rosters data-complete now, unlocked per world).
- **O7 — Other-race heroes, Phase 1:** invasion-only, or invasion + that race's Oracle vouching (recommend both), Emissary trade deferred to Phase 2.
- **O8 — Hero daily XP cap & L-cap:** reuse 40/day colony-wide pattern in a separate `heroXpCaps` ledger (recommend yes); hero cap L10 for parity.
- **O9 — Unbound hero pool timing:** design now, implement with the ascension track's later phases, zero presence in beta (recommend).
- **O10 — Deed→Contribution overlap:** hero inductions add +10 contribution via `deedsCompleted` (light); confirm vs a separate idle counter.

---

## §9 Integration sketch (build-ready touchpoints)

- **Engine state:** per-colony `heroes: Hero[]` (`{id, race, role, name, xp, unspentPoints, xpPointsGranted, specialization, earnedBy, attributes{power,guard,craft,presence}, day, dayXp, energyWeek{cycleId, spent}}`), `heroSquad: string[]`, `earnedHeroes: string[]`, `earnedHeroRaces: RaceId[]`, `heroXpCaps: Record<dayKey, number>`, `warEnergyLedger: {day, marches}`; world-level war ledger already spec'd. Migration V5 via an `ensureHeroes()` idempotent backfill (the `ensureLeaderXp` pattern).
- **New module:** `src/game/heroes/` — `heroes-data.ts` (rosters, deed catalog, wave flags), `hero-xp.ts` (imports leader-xp curve; `grantHeroXpTo`), `war-energy.ts` (consts). Pure like engine.ts.
- **API:** `getHeroes`, `setSquadFn`, `allocateHeroPointFn`, `chooseHeroSpecFn` (zod-validated, `accountForToken` → active game → `advance()` → validate → persist), plus the battle-side war surface (`marchFn`, etc.) reading `heroSquad`. `publicState()` strip list extends with energy internals and `warFlags`.
- **Verification harness** (`/home/team/shared/heroes-tests/heroes-verify.ts`): roster invariants (12/race, unique ids, Wave 1 ⊆ roster, all 5 roles per race), determinism (no `Math.random()` reachable in earn paths), the finite-time guarantee (fabricated legal schedule earns all Wave-1 Watcher heroes within the bound), squad-validation reject cases, energy ledger wrote-nowhere-by-client assertions, `publicState` leak checks for Unbound heroes and energy internals, migration of a V4 save with zero errors, and a no-regression re-run of the 40 leader + 102 revelation checks.

**Sequencing:** the hero *data* (rosters/deeds/catalog) can be built and tested ahead of the war layer (pure data + harness, invisible to play); the earn/validate/squad/energy mechanics ship with the battle-side Phase 1 "Hero frame"; purify-tied deeds and Emissary-traded heroes arrive Phase 2; the Unbound pool with the ascension track.

---

*Filed by team lead from researcher delegation report (session a6b59c08-e05d-4c67-b50c-fcbda6b90679). Read-only session — nothing written by the researcher. Assumption recorded: hero-deed thresholds mapped to existing contribution numbers (50/150/400) and the 40/day XP cap as defaults pending O2/O8 — all tunable consts, not contracts.*