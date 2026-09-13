# Build-Ready Spec — Radiation Zones + Pre-Launch Risk Pop-Up (soft gate, free-play)

Owner-confirmed: player is ALWAYS free to go; nothing hard-locks; pop-up shows % success, has-vs-need gear, projected loss; player chooses go / prepare / safer destination.

## Per-zone radiation model (zones.ts)
Add `radiationLevel: number` (0–100) per zone. `DEEP = 35` threshold — zones ≥35 need gear + blocking pop-up; milder zones get a small inline warning.
Suggested values (adjustable): outer-ruins 0, lantern-reach 0, observatories 25, hollow-warrens 20, forge-valleys 30, boneyard 30, shattered-academies 40, quantum-facility 60, collider-ruins 80, dark-matter-observatory 95.

## New inventory (types.ts, newGame in engine.ts)
`resources` += `hazmat`, `shots`, `alloys` (start 0).
Acquisition — review & confirm with owner:
- Craft via Supplies (Workshop block in Colony tab): Hazmat=8📦, Shot=6📦, Alloy=20📦.
- Incidental salvage: mild zones (rad 20–40) ~10–15% chance to recover 1–2 hazmat/shots (never alloys).

## Required-gear math (engine.ts, exposed via client-utils)
```
hazmatPerScientist = 1 + floor((rad-35)/20)
shotsPerScientist  = 1 + floor((rad-35)/20)
alloysPerZone      = 1 + floor((rad-35)/25)
totalHazmat = hazmatPerScientist*sci; totalShots = shotsPerScientist*sci; totalAlloys = alloysPerZone
coverage = min( min(1,hazmat/totalHazmat), min(1,shots/totalShots), min(1,alloys/totalAlloys) )
```

## Loss & success
```
deep baseMaxLoss = min(45, rad*0.45);  mild baseMaxLoss = rad*0.15
lossPct = round(baseMaxLoss*(1-coverage));  successPct = 100-lossPct
```
On completion roll once; if loss triggered: scientistsLost = min(max(round(sci*lossFraction*0.8),(sci>1?1:0)), sci-1) (never wipe below 1); loot reduced ~lossFraction; corruption += round(lossPct/100*10); log event.
Recommend race-neutral for MVP (Nephilim/Asart hooks later).

## Pre-launch risk pop-up (Expeditions tab, deep zones, on "Commit Supplies")
1. Header ☢️ "High radiation: <Zone>"
2. "Clean return: 64%"
3. Has-vs-need table (hazmat/shots/alloys: X/Y needed)
4. Projected loss for team of N vs gear
5. Actions: **Go anyway** (danger) / **Go back & prepare** / **Safer destination** / **Cancel** + framing "You are always free to go. This is what you risk."
Supplies check before pop-up; snapshot `lossPct` into Expedition at launch.

Edge: team size 1 → scientist loss floors to 0; never lose last scientist; 0 gear → full baseMaxLoss; concurrent expeditions independent; radiation adds corruption (not Chorus).

## Files
`game/types.ts`, `game/zones.ts`, `game/engine.ts`, `game/client-utils.ts`, `routes/play.tsx`.

## OWNER REFINEMENT (2026-08-31, authoritative) — the ALLOY RECIPE & two-layer gate

**Alloy forging — 5 unique race-materials, flexible set:**
- The radiation-resistant alloy requires your OWN race's territory supply/material + the supplies of **4 OTHER races** (any 4 of the other 5 pickable races) = **5 distinct race-materials total**.
- No race can forge the alloy alone; even the richest single territory is missing 4 pieces. This FORCES cross-race expeditions — you must raid/visit other races' regions to gather their unique materials and forge the alloy. "You have to get your feet wet and raid others to get it."
- Each race's home region must therefore yield a UNIQUE territory material (in addition to embers/chipsets) that is part of the alloy recipe.

**Two-layer gating (exploration vs extraction):**
1. Deep radiation zones are NOT accessible right away — they're visible as a "hangar"/hazarded distant area (players see what's out there, must work toward it).
2. **Suits let you EXPLORE** — send protected (suited) teams in; they can find/reconnoiter.
3. **Alloys let you EXTRACT (retrieve)** — without alloy-armed digging machines (machines armed with composite alloy tools), you CANNOT bring anything back. Find ≠ retrieve.
4. So: suits = reconnaissance (see what's there), alloys = the payoff (dig it out and return with loot). Both are needed; the alloy is the deep-zone key.

**Implementation consequence:** the alloy requires collecting 5 race-materials (your race + 4 others). Track per-race territory material counts in inventory; the forge enables "extraction" capability once the full recipe (5 unique race materials) is held.

## OWNER REFINEMENT (2026-09-01, authoritative) — TWO LAYERS OF RISK: the projected vs the UNFORESEEN
**Background thinking the owner shared:** "The hard mechanics are good — knowing you can use the math to figure it out — but this is close to real life. Sometimes s*** happens. You happen to come in on an expedition/exploration and you land in the wrong damn spot, or you happen to come along the Chorus going that way and you're in the s*** and you didn't even expect it, you didn't even know what to do about it. That's why you have guards, that's why you have plenty of protection — because the risks are there. There is a random situation; you don't know what you're going to come across."

**What this means in design terms — two distinct risk layers:**
1. **The projected risk (already built)** — the pre-launch pop-up percentage the player reads and signs up for (gear coverage, lossPct, expected losses). This is the *knowable* risk: "if I send X with Y gear into Z, the odds are N."
2. **The unforeseen / wildcard layer (NEW — build this in)** — a genuine, non-precomputable random-encounter event that hits at RESOLUTION time, independent of the pre-launch math. The player CANNOT read this off a percentage before launching. Examples: you land off-target, you cross paths with a roaming Chorus force you didn't expect, the site is worse than the map said, a random hazard. "You didn't even know what to do about it."

**Why guards/protection exist (ties together):** because of layer 2. Guards, suited/armed teams, materials, fuel, numbers are what ABSORB the unforeseen — a well-protected expedition weathers a surprise encounter; an under-protected one can be lost or badly hurt by something it never saw coming. This is the moment player preparation pays off beyond the planned risk.

**Design consequences (for engineer):**
- Expedition resolution should include a stochastically-rolled random/wildcard event that is NOT a deterministic function of the pre-launch stats. It is a surprise roll.
- Protection (guards/hazmat/numbers/gear) strongly modulates how a wildcard resolves — protection = greater chance of no-loss or reduced-loss; absence = real chance of catastrophe (lost expedition / heavy loss).
- Keep it honest: the player should be able to intuit "protection makes surprise less deadly," but never be able to fully forecast the wildcard. Discovery + tension, not a taught tutorial.
- This is a separate concern from the pre-launch risk pop-up (layer 1), which stays as the *stated* expected risk. Layer 2 is the *unstated* residual risk underneath.
