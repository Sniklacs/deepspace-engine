# Spec — Research Depth + Codices + Leaders (draft for engineer, 2026-09-01)

Authoritative decisions live in `design/research-tree.md` (owner/Cody 2026-09-01). This spec turns them into buildable mechanics. It is a working draft — the lead's proposed structure, adjustable.

## 1. The two-track model (non-negotiable)
- **AI track:** Embers & Chipsets → study → deploy across the 5 domains (weaponry, agriculture, economy, industry, logistics). Already built. Stays.
- **Knowledge track (NEW):** **Codices** (human knowledge — pre-war texts, journals, records, lost science) → feed the **research tech tree**. Research costs Codices, NOT embers/chipsets.
- Codices are **earned**, not looted: earned via meaningful outcomes (recovering a surviving archive, completing a recovery objective, protecting a scholar/site, deeds/merit awards). Rare discovery in exploration only as a bonus. Embers you *salvage*; chipsets you *raid* for; Codices you *earn*.

## 2. Research tech tree (5 domains × 4 named techs)
Each domain has a small linear tree (4 techs). A tech costs Codices (scaling) + real time (lazy time-advance like studies). Effects must be concrete and visible:

- **Weaponry:** e.g. Traction Cannons (attack/defense vs Chorus, +defense shield already used), Chorus-Sig Jammers (reduce wildcard encounter chance), Ordnance Works (weaponry deploy cheaper).
- **Agriculture:** Hydroponics Grid (+supplies regen), Seed Vaults (+recovery of food on expeditions), Triage Gardens (medic efficiency).
- **Economy:** Trade Ledgers (embers↔supplies exchange better), Salvage Contracts (expedition yield +), Price Index (crafting discounts).
- **Industry:** Auto-Forge (crafting cost down), Machine Shop (mechanics kits more effective), Battery Fabrication (electric range up).
- **Logistics:** Long-Haul Chassis (fuel range +), Silent Drives (electric quiet-ops +), Fleet Yards (more vehicle bays / expedition slots).

Node unlock = previous node done + Codices cost. No hard-locks without explanation — show the requirements.

## 3. Leaders (the human layer)
- A small roster of **named colonists** (RimWorld-style), developed by investing attributes: **research, economy, combat, engineering**.
- **Specialties** map to the 5 domains: economist→economy, horticulturist→agriculture, engineer/mechanic→industry, tactician→weaponry, logistician→logistics. A Leader's specialty defines where they help — no universal bonus.
- **Limited slots** (e.g. 3 Leader slots at start, +1 from a logistics tech) → choosing who to develop and where to appoint is the tradeoff.
- **Acquisition:** some start with the colony; others join through deeds/rescue outcomes (ties to the earned philosophy — special people are earned, not bought). NOT gacha, never purchasable — keeps no-pay-to-win.

## 4. Appointment + breakthrough (Cody's mechanic)
- To research a project you **appoint a Leader** to it (one project per Leader; a Leader can only run one thing at a time — people are scarce).
- The Leader's **specialty sets the boost** for that research line (speed and/or outcome quality).
- **Surprise breakthrough (positive wildcard):** at research completion, a chance of a surprise bonus IF the appointed Leader's specialty aligns with the project (e.g. an economist finishing an economy tech rolls a "market insight" → bonus Supplies/Codices returned). This is the *good twin* of the wildcard surprise-encounter — research sometimes beats its projected numbers. Roll at completion, rare-ish, announced in the Chronicle.
- Leaders can be **wounded/lost in the wildcard surprise layer** (once that's in) — the human cost that makes surprise sting.

## 5. UI sketch (keep within existing structure)
- Lab tab gains a **Research tree** view: 5 columns/domains, locked/available nodes, Codices cost, appointed Leader slot per in-progress project.
- **Leaders roster** view: names, attributes, specialties, current assignment, history (breakthroughs, recoveries).
- Codices shown as a distinct resource with an inventory line (📜 Codices), displayed with tooltip explaining "earned knowledge — embers you salvage, Codices you earn."
- All numbers surfaced as costs/odds the player decides on — free-play, no hard-locks.

## 6. Sequencing note
Build this AFTER the merged gear/guards/vehicle/wildcard build ships. It layers on Codices acquisition sources (recovery objectives can be added into expedition outcomes then) and Leaders (who can then be exposed to the wildcard layer).