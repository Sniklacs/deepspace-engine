# Design Note — Radiation Gating for Deep Expeditions (backlog item 288583ec)

Status: QUEUED (owner request). Not yet built. Design confirmed with owner 2026-08-31.

## Owner request / final design (confirmed)
Some expedition destinations / Shatterlands areas are **high-radiation**. The player is **always free to go** — this is a free-play, choose-your-own-consequences game. The game NEVER hard-locks or forces. Instead:

**Soft gate with full information + player choice:**
1. The player CAN send an expedition into a radioactive deep zone even under-prepared.
2. **Before departure, a pop-up warning explains:**
   - The risks and the **% success** for the planned expedition.
   - A full breakdown of what the colony HAS vs. what the team NEEDS: e.g. "Hazmat suits collected: 3/6 needed · Radiation shots: 2/6 · Radiation-tolerant alloys: 1/2".
   - What the player does NOT have enough of for the number of people going.
3. If gear does not cover the team size, the expedition will suffer a **loss rate** — some of the team / a consequence is lost (attrition, casualties, material loss). The pop-up states this plainly.
4. The player reviews the consequences and **makes the ultimate choice**: go anyway and accept the loss rate, or prepare more first / choose a safer destination.

This makes risk a **choice**, never a lock. The player owns the decision.

## Design principle
- No forced path, no "cannot do this." Every expedition is available; the cost of under-preparation is transparent and the player accepts it deliberately.

## Implementation hooks
- New per-zone property: `radiationLevel` (and/or required materials). Mid zones = soft/attrition; deepest zones (Quantum Research Facility, Super-Collider Ruins, Dark-Matter Observatory) = highest radiation, highest loss potential.
- New colony inventory: **Hazmat suits**, **Radiation shots**, **Radiation-tolerant alloys** (acquired how? — craft via Industry/Supplies, or salvage from specific mid zones — to confirm).
- New **pre-launch risk/confirm dialog**: shows % success, has-vs-need material breakdown, and the projected loss rate when under-geared; player confirms to proceed or backs out.
- Loss-rate consequence applies to the expedition on launch based on the gear shortfall.
- Integrate with existing expedition planner (src/game/zones.ts, src/game/engine.ts, src/routes/play.tsx) and persistence (already handled).

## Open question
- How are the special materials (hazmat, shots, alloys) acquired? (crafted with Supplies via Industry; salvaged from specific mid zones; a new system.) Confirm with owner before building.
