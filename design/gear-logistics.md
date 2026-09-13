# Design Note — Gear Ladder & Vehicle Logistics (owner direction 2026-08-31)

Owner's realism principle: these colonists have been holed up in their Cradles; stepping out into the Shatterlands is a whole gauntlet of preparation. The farther you want to go, the more gear (and the more gear from OTHER races) you need. Realism = detail; the more systems we track, the more the player must pay attention.

## RESET CHANGE (owner decision, authoritative)
**Reset a game = go ALL THE WAY BACK to race selection** (not same-race fresh colony). The multi-game build's reset (fresh colony same race+name, keeps slot) should be changed so that Reset wipes the game's progress and returns the player to the race-selection screen to pick a NEW race/name for that game slot. (Adjust `resetGameFn` + the GamesModal reset flow accordingly.)

## GEAR LADDER (owner design + lead's proposed structure, adjustable)
Early access ("stepping out") is gated by everyday logistics gear, not radiation:
- **Tier 0 — Step Out (cheap, everyday medical/logistics):**
  - Medical kit (bandages, basic shots vs things like malaria/flu-like symptoms)
  - Basic mechanics kit (patch-up / basic vehicle repair)
  - Armor/armature kits (crew + light vehicle protection) [owner's "armitage" — confirm]
  These let a colony field ANY expedition at all (safe-ish outer zones).
- **Tier 1 — Outer/Mild zones:**
  - Radiation shots (protect ground crews from mild radiation)
  - Skilled mechanics (repair/maintain heavier machinery)
  - Vehicle fuel (gas) &/or battery packs (electric) — see logistics below
- **Tier 2 — Deep zones (explore vs extract, owner-locked):**
  - Hazmat suits → EXPLORE deep zones (find things)
  - Radiation alloys → EXTRACT/retrieve (alloys arm the digging machines)
  - Alloy recipe = your race material + 4 other races' materials (5 total, any 4) — cross-race raiding forced
- **Tier 3 — Deepest (quantum/collider/dark-matter):**
  - Higher-grade alloys & more advanced machinery; more race-materials required the deeper you go.

Gear is crafted with Supplies (Workshop/forge); the deeper tiers require race materials from other territories.

## VEHICLE / LOGISTICS LAYER (owner direction — new depth)
- Vehicles (gas-powered and/or electric) carry expeditions; each vehicle has **battery time / fuel range**.
- **Battery time** — how long vehicles can operate; extend via upgrades/tech.
- **Fuel** — gas-powered vehicles need fuel; WHO supplies it (a colony resource crafted via Economy/Industry from Supplies), how to make it go further (fuel efficiency tech).
- **Electric** — battery packs, charging, power supply.
- Consequences: range/duration limits how deep and how long expeditions can run; refuel/recharge costs; breakdowns need mechanics (Tier 0/1 kits). This adds a real supply/logistics decision layer to every expedition (as owner: "how do we make it go further").
- Keep aligned with free-play/player-choice: shown as costs/risks the player decides on, never a hard lock.

## Sequencing (lead)
- The in-flight radiation build (hangar gating, suit/alloy, risk pop-up) proceeds as-is.
- After it lands: (1) small change — reset → race selection; (2) gear-ladder + vehicle-logistics pass (Tier 0-1 gear + fuel/battery) as the next depth layer.
## VEHICLE FUEL MIX — OWNER CONFIRMATION (2026-08-31, authoritative)
- **Mix of gas-powered AND electric vehicles — and the DEEPER you go, the more you need BOTH.**
- **Gas** = long-distance travel (getting to the far/distant sites).
- **Battery/electric** = QUIET operations once you arrive (stealth near the Chorus/hostiles).
- **DO NOT explain this to the player.** It is meant to be FIGURED OUT. Deeper sites effectively require both (long haul by gas, then silent battery operation at the site). A player who neglects one will simply fail — "their problem, they figure it out." These are intended discovery puzzles, not hand-held tutorials.
- Keep the little surprises. Discovery is a feature.
