# Cockpit — Command Layer (Phase 2 spec)

Owner decisions: Hans, Oct 11–12 2026. Drafted Oct 12 2026 from his locked notes; uncommitted, awaiting his word.

## Phase 1 — SHIPPED (build 90e2fe3, Draconians test server, Oct 12 2026)
- Battles open first-person from the command ship — canopy framing the field, NOT top-down.
- Low hover ~50 ft, looking forward: close enough to see every troop in detail, high enough to oversee.
- Accent light strips in the player's theme color.
- Adjutant station (left): the commander appoints ANY hero as adjutant; that hero is always in the ship.
- Officers/heroes not on the field are visible in the cockpit.
- POV ⇄ Map toggle on deck.

## Phase 2 — the command layer (NOT yet built)
Phase 1 is the shell. This is the interaction layer Hans specified the same night:

### Squad command — never tap troops directly
All orders go through squad panels. Tap a squad → quick-pick menu:
- **FIRE CONTROL:** stop fire / hold fire / cease fire / weapons free / bombard
- **MOVE:** tap a destination on the radar → squad moves there
- **COVER:** assign the squad to cover another squad (e.g. squad 2 covers squad 3)
- **HOLD:** move to position and hold — do not fire unless an enemy enters weapon range

### Radar window
- Expandable window (EVE-type window framework: movable, resizable, opacity-adjustable, snap-to-grid, minimizable, closeable).
- Tapping the radar is the movement interface — destinations are set there, not on the field.

### Weapon ranges
- Every weapon shows its range. Hold-fire respects range (HOLD only engages inside it).

### Scout intel → Enemy Forces window
- After the scout flyby, an "Enemy Forces" window opens showing enemy composition per squad.

### Target assignment (setup phase)
- Tap an enemy unit (e.g. logistics, wardens) → "Pressure" / "Target" button pops up.
- Tap it → squad picker appears → choose which squads target it.
- Assigned squads get a scope/bullseye marker showing they're already linked to a target.
- Multiple squads can pressure the same target; one squad can have multiple targets.

### Unassigned squads
- Squads with no target link follow the War Room formation by default.
- In manual mode, tap an unlinked squad → quick-pick → assign it to COVER a linked squad.
- Bullseye markers distinguish linked vs unlinked squads at a glance.

## Standing rules this must honor
- Live battle is tap-and-move; the Controls glass is SETUP ONLY (locked Oct 6 2026).
- Speed caps at real time (1x), SLOW default; live PvP runs at the slowest player's pace.
- Fullscreen toggle + EVE-type windows keep the battle view clean on small phone screens.

## Open for Hans
- Does target assignment stay setup-only, or can links be re-assigned mid-battle from the cockpit?
- Radar MOVE: single destination per squad, or waypoint chains?
