# Weapons System — Colony-side Armory (owner direction 2026-09-12)

**Status:** design, filed by team lead per owner direction ("5 types of weapons per race, 4 tiers, stats improvable per tier, built at the Cradle from gathered resources; use your imagination; go off the research"). **Not owner-ratified as a whole — defaults flagged in §7; Warband-cadence per Heroes (Watchers catalog ships now on the beta world, other races' catalogs ship with their worlds).**
**Guides:** business plan rev 14 (ratified), `design/heroes-design-brief.md` (race identities, wave cadence, L3 specializations), `design/battle-side-rvr-spec.md` (§3 Gearing/war supply, §5 zone actions, §8 hero squad as war unit), `design/monetization.md` (earn-only guardrails; nothing war-relevant purchasable), engine patterns `site/src/game/{types.ts, engine.ts, api.ts, research.ts, races.ts}`.

---

## §1 What this is

The **colony-side Armory**: weapons are hardware built at the Cradle from resources gathered on expeditions (and, at high tiers, refined plasma). They are the colony's mustered military strength — the "gathering up resources to go to battle" half of the war loop. The **battle side (later)** reads them: crews/hero squads carry weapon families into marches, captures, escorts, and sieges; Gearing converts expedition output (including weapons' upkeep) into war supply. This system is earn-only, deterministic, persistent, and offline-safe — same rules as everything else.

**Currencies vs materials — one clarification:** embers/chipsets stay AI-fragments; weapons demand *physical* war materials. New material: **Plasma** (§2).

## §2 Plasma — the new gathered/refined material

- **What:** condensed high-energy matter refined from embers at the Cradle lab — the "lifeblood" of high-tier and energy weapons. Rare, valuable, never cheap.
- **Sources:** (a) **Refinement**: research "Plasma Refinement" → convert **25 embers → 1 plasma** at the lab (gated by research + Cradle progress; deterministic, no randomness); (b) **Deep-raid salvage**: high-risk deep ruin sites (chipsets sites) occasionally yield 2–5 plasma alongside chipsets — the risk-of-depth reward.
- **Uses:** T2+ weapon costs begin eating small plasma; T3/T4 weapons demand it heavily (Siege and Precision are plasma-greedy; Frontline and Engine are supply-greedy). Future: war engines, colony power.
- **Earn-only:** no purchase path (monetization.md hard rule — a plasma pack would violate "no war resources").
- **State:** `resources.plasma` alongside embers/chipsets/supplies/fuel/mats.

## §3 The five weapon types (every race, one roster)

One uniform war-role frame, race-flavored per §5:

| # | Type | Role | War action (battle-side §8 mapping) | Stat skew |
|---|---|---|---|---|
| 1 | **Frontline** | close combat / guards — hold the line | march tank-line, capture holding | guard-heavy |
| 2 | **Assault** | mid-range plasma rifles / carbines | march offense, capture-taking | power + speed |
| 3 | **Precision** | long-range marksmanship (plasma sniper/rail) | march counterplay, zone denial | precision + power |
| 4 | **Siege** | extreme-range artillery (trebuchet-flavored per race) | sieges, zone bombardment, Climax peak | massive power, slow |
| 5 | **Engine** | war machines / frames — walkers, shield-rigs, drillers | escorts, supply lanes, shields | logistics + guard |

Every race has all five — the *same roles*, *different souls*. Squads and marches compose differently per race because of flavor, not because roles are missing.

## §4 Tiers, stats, model naming

- **Four tiers per weapon family (T1–T4).** Tier is an **upgrade path**: build the family at T1, then upgrade T1→T2→T3→T4. Upgrading consumes resources + time and **raises all stats** by a published multiplier (defaults: T2 ×1.5, T3 ×2.2, T4 ×3.2 over T1 — §7-flag). Stats preview the next tier before you commit.
- **Four stats per weapon:** `power` (damage), `precision` (accuracy/counterplay), `guard` (defense/hold), `logistics` (march/supply efficiency). T1 base by type (defaults — §7-flag):

| Type | power | precision | guard | logistics |
|---|---|---|---|---|
| Frontline | 12 | 4 | 20 | 6 |
| Assault | 16 | 10 | 8 | 10 |
| Precision | 20 | 18 | 4 | 8 |
| Siege | 30 | 6 | 2 | 4 |
| Engine | 8 | 6 | 16 | 18 |

- **Model names:** each race names its families (§5) AND its tier line — e.g. Watchers tiers read as teaching stages: **T1 Primer → T2 Regulated → T3 Catechism → T4 Apocrypha**. Other races' tier-languages: Grays (Index→Catalog→Folio→Archive), Nephilim (Stone→Column→Mountain→Firmament), Draconians (Coin→Conspiracy→Debt→Ownership), Anunnaki (Plan→Foundation→Work→Testament), Pleiadians (Candle→Lantern→Beacon→Dawn). Model designation pattern per tier: `FamilyName Mk <tier>` shown with the tier language, e.g. *Unwritten Blade — Catechism Mk III*.

## §5 Race catalogs (family names + identity) — full 5×4 for Watchers; families for all races

### THE WATCHERS / GRIGORI — forbidden-knowledge teachers (BETA: ship now, 5 families × 4 tiers)
1. **The Unwritten Blade** (Frontline) — *"Forged from a lesson never meant to be taught; it cuts what the Chorus believes about itself."* Guard-line weapon; grants the colony's first melee corps.
2. **The Attendance** (Assault) — *"Every bolt is a syllabus; the target attends whether it likes it or not."* Plasma carbine, the backbone of Watcher marches.
3. **Revelation Lens** (Precision) — *"Shows the flaw; the flaw does the rest."* Rail-sighted plasma sniper; zone denial.
4. **The Last Bell** (Siege) — *"When the bell rings, the lesson ends. Loudly."* Plasma-mortar trebuchet; the loudest curriculum.
5. **Chalk-Mark Warden** (Engine) — *"Draws the line the colony says is there; enemies find the line real."* Shield-rig/walker frame; escorts the supply lanes.

### THE GRAYS — clinical collectors, knowledge as armament
1. **The Foyer** (Frontline) — the quiet room between the enemy and the archive; nothing returns the way it entered. 2. **Catalogue-9 Pattern** (Assault) — a rifle that cross-references you. 3. **The Interviewer** (Precision) — obtains the exact answer at range. 4. **Archive Purge** (Siege) — burns the site flat; they keep the catalog. 5. **The Circulation** (Engine) — a frame that goes everywhere and remembers everything.

### THE NEPHILIM — warfare/endurance, tragic giants
1. **Last-Standing** (Frontline) — a great-sword that is definitionally still standing. 2. **Stonehold Launcher** (Assault) — slow, absolute. 3. **The Slow Drop** (Precision) — a rail shot with the authority of geology. 4. **Mountain-Answer** (Siege) — a trebuchet that throws geography back. 5. **The Keel** (Engine) — an armored ram-walker; the road itself.

### THE DRACONIANS — stealth/economy, debts collected
1. **Quiet Ledger** (Frontline) — a concealed blade that writes final entries. 2. **The Rent Collector** (Assault) — silenced plasma; interest compounds. 3. **No Witness** (Precision) — the shot nobody saw and the record disproves. 4. **The Accountant** (Siege) — indirect fire that balances the books from three maps away. 5. **The Warren-Rig** (Engine) — a tunnel-drill frame; arrives from underneath.

### THE ANUNNAKI — god-architects, mega-works
1. **Pylon-Gate** (Frontline) — a halberd that is also a load-bearing structure. 2. **Founder's Beam** (Assault) — the straight line civilization was built along. 3. **The Architect's Eye** (Precision) — sees the load-bearing flaw at any distance. 4. **Cathedral-Fall** (Siege) — plasma trebuchet; topples what they built, grieves later. 5. **The Ziggurat-Walker** (Engine) — a mega-frame that literally outgrows the battlefield.

### THE ASART COMMAND / PLEIADIANS — defense, light, anti-corruption
1. **Unbent Warden** (Frontline) — the holder's arm; has never once bent. 2. **Lantern-Carbine** (Assault) — bolts that also cleanse taint. 3. **The Bright Consensus** (Precision) — one clean shot the whole council agrees on. 4. **The Last Light** (Siege) — a dawn-cannon that defends rather than destroys. 5. **Ward-Rig** (Engine) — an aegis frame; the taint slides off like weather off glass.

### THE UNBOUND — the earned seventh (design note only, ships with ascension phases)
Not a race and not pickable. Their "weapons" are a **Rite-frame** of 5 anti-weapon forms (Cleansing Sign, First Record Aegis, Vigil-Line, The Unnamed Suspension, Heart-Ward) — wards and purifiers, not ordnance; earned-only, silent until earned, never rendered early. **Not in this build.**

## §6 Build mechanics & integration

- **Research gates:** new research-tree nodes: hub **"Armory"** + per-family unlocks (5) + **"Plasma Refinement"**. Weapon families show as locked with their research name until researched (race-locked beta = the Watchers tree; other races get their own trees per world).
- **Costs & time (defaults — §7-flag; Watchers beta-tuned so a steady player completes T1 of a family within day 1–2 and T3 within ~2 weeks):**

| Tier | supplies | embers | fuel | plasma | build/upgrade time |
|---|---|---|---|---|---|
| T1 | 40 | 20 | 6 | 0 | 45 min |
| T2 | 120 | 60 | 18 | 3 | 3 h |
| T3 | 320 | 160 | 45 | 12 | 12 h |
| T4 | 900 | 420 | 120 | 30 | 2 days |

- **Persistence:** build/upgrade timers resolve offline via `advance()` (same lazy, idempotent reconcile as expeditions — `armoryBuilds: {familyId, targetTier, startedAt, doneAt}`); one active build per family; queued builds disallowed (real commitment). Colony state: `armory: Record<familyId, {tier: 0|1|2|3|4, everBuilt?: boolean}>` (`tier:0` = not built). V-migration via `ensureArmory()` — real saves stay green.
- **Earn-only structural check:** no Votive path can grant plasma, weapons, or build completion (guardrail-testable; extend `assertCatalogFair()` vocabulary with `plasma|armory|weapon|trebuchet`).
- **Dents:** durable personal deeds `first_weapon_built` (+10 contribution via `deedsCompleted` — matches heroes §O10 pattern) and `weapon_tier4` — the dent earns attention. Weapon build count also feeds a separate `weaponsBuilt` counter (NOT the contribution formula — formula stays fixed for the Unbound gate; a war-layer "might" score will read weapon tiers + counts when the battle side lands).
- **UI — "Armory" tab** (mobile-pass, style-consistent): 5 family cards (race-sigil block, family name + identity line, tier pips 1–4, current stats + next-tier preview, cost list with owned-got/needed coloring, build/upgrade button with timer, research-locked card state). Nothing new in dependencies.

## §7 Owner-decision flags (defaults set, confirm or tune)
- Stat base numbers, tier multipliers (×1.5/×2.2/×3.2), cost/time table, plasma ratio (25 embers → 1 plasma) — all constants, one config object.
- Whether the 5-role frame (Frontline/Assault/Precision/Siege/Engine) is the right taxonomy vs a different spread.
- Watchers family names/identities above (data-swappable before publish).
- "Palladians" naming note: the plan's fifth race is **Asart Command / Pleiadians**; if the owner wants a rename toward "Palladians," flag it — cheap now, costly later.
- Unbound Rite-frames: deferred to ascension phases (recommend).
- Deed-adds-contribution (+10 per weapon deed): confirm per heroes O10 precedent.

## §8 Build order
1. **Now (next write after race-lock):** engine state + migration, plasma resource + refinement, research nodes, build/upgrade timers, Watchers catalog (5×4, full names/models/stats), Armory UI, guardrail + unit tests (new suite `/home/team/shared/armory-tests/`), existing suites green. Watchers-only content (other races' families are data rows, filled at their world launch).
2. **Later:** war-side consumption (Gearing musters weapons into war supply; squad loadouts read families — battle-side §8), other races' full catalogs, Unbound Rite-frames, "might" score for the war ladder.

---

*Filed by team lead 2026-09-12 from owner direction. See `design/heroes-design-brief.md` for the matching creative voice; numbers are defaults pending owner confirmation (§7).*