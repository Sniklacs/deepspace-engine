# Chorus Ratchet — Ambushes & Siege

## Status
Owner-approved direction (2026-09-13): **ambushes + siege**. This supersedes the
placeholder "no consequence at 100%" behavior currently in `engine.ts`.

## Design principle
The Chorus is a **ratchet, not a cliff**. Pressure escalates in recoverable tiers;
there is never a game-over. "Hubris has a price" — pushing deep repeatedly raises the
Chorus's hunt; purity (Purify / Oracle) is the counterweight. No hard-locks: every tier
shows its risks and odds, and the player always has a path down.

## Two separate meters (do not conflate)
- **Chorus attention** (`chorusAttention`, 0–100) — the Chorus's *hunt* pressure.
  Rises on expeditions (deep zones hotter), decays over time. Drives the tiers below.
- **Corruption** (`corruption`, 0–100) — the *purity* track. Rises on expeditions, cuts
  yield when high, cleansed via Purify / Oracle. Already implemented with teeth.

The siege is driven by **attention**; corruption is the ongoing purity cost. Attention
hitting 100 triggers the siege regardless of corruption.

## Tiers
| Tier | Range | Behavior |
|---|---|---|
| Quiet | 0–33 | Baseline. |
| Stirred | 34–66 | Deep-zone risk up; corruption gain up. |
| Hunting | 67–99 | **Chorus ambush** chance on expeditions — scientists/gear at risk; attention decays slower. |
| Closed In | 100 | **Siege** (below). |

## Ambush (Hunting tier)
- On launching an expedition while attention ≥ 67, roll an ambush chance scaled by
  attention (first-pass: linear 67→99 maps to ~5%→25%).
- Ambush consequence: scientists or gear lost/mauled; expedition yield penalty; a one-off
  corruption surge. Show the odds before launch ("the Chorus is hunting — 18% ambush risk").
- Ambushes never destroy the colony; they raise the cost of pushing while hot.

## Siege ("Closed In", attention = 100)
The Chorus has found you and is choking the colony. Two hard consequences:
1. **Expedition interdiction** — you cannot launch expeditions while besieged (the launch
   button is disabled with the reason). The Chorus owns the approaches.
2. **Supply starvation** — passive supply restock is throttled (idle income cut, first-pass
   −50% to 0, tuned). Reserves drain while the siege holds, so it is a countdown to real
   deprivation.

Plus a **corruption surge** on entry (the Chorus presses in), and slowed attention decay
(the Chorus is camped on you).

### Breaking the siege (no hard-lock — this is mandatory)
- **Passive decay** — attention continues to decay even at 100 (it is NOT pinned), so a
  siege ends naturally once attention falls back below 100. This is the floor: no matter
  what, the siege ends on its own in bounded time.
- **Active break** — a "break the siege" action / Purify / Oracle rite drops attention
  below threshold quickly. Costs supplies/resources/devotion — which the supply starvation
  makes genuinely painful, so there is a real decision about when to spend the break vs.
  weather it.
- **Residual ("the Chorus remembers")** — after a siege, attention does not reset to 0; a
  decaying residual carries into the next push, so repeated overreach compounds.

## Non-goals / guardrails
- Never a wipe or game-over.
- Never a soft-lock: passive decay guarantees the siege ends.
- Purify/Oracle cleansing stays **earned, never bought** (no purchasable siege skip).
- All numbers are first-pass; tune in playtest. The one non-negotiable is the
  "always a path down" floor.

## Implementation pointers
- `src/game/engine.ts`: chorusAttention clamp + tier evaluation (currently no 100%
  consequence). Add tier lookup, ambush roll at expedition launch, siege interdiction gate,
  supply-restock throttle (idle income tick), corruption surge on siege entry, residual
  attention on break.
- `src/game/types.ts`: document siege/ambush state + residual attention.
- `src/game/api.ts`: sanitize new internal fields; expose tier + ambush odds + siege state
  to the client.
- Client: show tier in the Chorus meter, ambush odds before launch, siege banner (why
  expeditions are blocked + restock throttled), "break the siege" action.
- Tests: new `chorus-tests/` suite — tier boundaries, ambush odds monotonicity, siege
  interdiction + restock throttle, passive-decay guarantee (no softlock), residual carry.
