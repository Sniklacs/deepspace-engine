# Spec — Seasons (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** This document specifies
> the structure, rules, and engine seams the engineer will implement **later**,
> in the same standard as the other build docs: concrete, buildable,
> self-contained.
>
> Owner-approved frame (locked, do not redesign): **the board resets, the soul
> doesn't.** Every season wipes the world clean — troops, bases, stockpiles,
> markets — but the *player* persists: Oracle favor, held artifacts, titles,
> and the memorial plaques. Twelve-week seasons, synchronized across all
> servers, ending in a climactic Storm, with a one-week intermission between.

---

## 0. Locked principles this spec builds within

1. **Two layers, never mixed.** The *board* (everything in the world) resets.
   The *soul* (everything about the player) persists. If a system can't say
   which layer it belongs to, it doesn't ship.
2. **Persistence is earned, never bought.** Everything that crosses the season
   line — Oracle favor, artifacts, titles — is earn-only. The wipe is the
   great equalizer; persistence is the veteran's reward. Neither is for sale.
3. **Every server runs the same clock.** Synchronized seasons or nothing —
   cross-server raiding breaks if Server A is in week 3 while Server B is in
   its Storm.
4. **Seasons end with a bang, not a countdown.** The finale is an event
   players talk about, manufactured deliberately.
5. **Losing a season must sting, not kill.** Twelve weeks is long enough to
   matter and short enough that defeat means "next season," not "uninstall."

---

## 1. Season structure (proposed: 12 weeks)

| Phase | Weeks | What's happening |
|---|---|---|
| **Landing** | 1–2 | Build the Cradle, muster first troops, find your alliance. |
| **Expansion** | 3–6 | First jumps, beachheads planted, early raids. The mercenary market wakes up as somebody's garrison starves. |
| **War** | 7–10 | Alliance sieges, artifact hunts, cross-server campaigns. Plaques start dotting the map. |
| **The Storm** | 11–12 | The climax (see §2). |
| **Intermission** | +1 week | No war. Plaques carved, ladders finalized, champions named. Then the next season opens. |

Four seasons a year. Each named (`Season 8: The Ashen Tide`) — names are
content; the world speaker announces them.

---

## 2. The Storm — the manufactured climax

The last two weeks are not normal play. Deliberately:

- **Chorus surge:** hive activity spikes on every server — more raids, harder
  sites, better artifact drop odds. The PvE pressure cooker turns up.
- **War bonuses:** cross-server raid rewards tick up (more AI per raid). The
  game *wants* the finale to be violent.
- **Standings lock:** ladders, contribution awards, and title races freeze at
  the Storm's start — the last two weeks are for glory, not points. (This
  prevents last-hour sniping from deciding a 12-week season.)
- **The design intent:** seasons should produce their biggest battles right
  before the wipe — which conveniently produces the *best* memorial plaques.
  The Storm is a plaque factory with a narrative excuse.

---

## 3. What wipes, what persists

| WIPES (the board) | PERSISTS (the soul) |
|---|---|
| All troops, garrisons, muster queues | **Oracle favor** (§4) |
| All forward bases | **Held artifacts** (§5) |
| All stockpiles, supplies, cargo | **Titles & veteran markers** (§6) |
| Modules (commodity gear — it deteriorates anyway) | **Memorial plaques** (`forward-base.md` §9) |
| Market listings | **Arena legacy** (past-season titles on record) |
| Arena ladder (resets; history kept) | Your name, aging gracefully, on old plaques |
| Alliance membership? (see §7 Q3) | — |

---

## 4. Oracle favor — the persistent soul

(owner direction 2026-09-30: "maybe that's the Oracle thing")

- **What persists:** your favor rank with your Oracle — devotion earned
  through daily to-dos, purity choices, dominance in battle
  (`oracles-purity-layer.md` §§4–6). The world forgets; the Oracles remember
  *you*.
- **Per-race.** Favor is with *your race's* Oracle. Switch races next season
  and you're starting over with a stranger who finds you amusing but doesn't
  trust you yet. Race loyalty has a price — that's the point.
- **Diminishing returns.** Early favor ranks come fast (a season of real
  devotion); later ranks grind. A five-season veteran is meaningfully favored
  but not a god — the curve flattens, so newcomers can always see the path.
- **Why it doesn't break the reset:** favor grants perks and attributes, not
  armies. Seasonal power (troops, bases, modules) still wipes. The veteran's
  edge is real but bounded — and it's *tenure*, the one thing money can't buy
  twice.

---

## 5. Artifacts — keep what you hold, risk what you carry

(owner decision 2026-09-30)

- **If you hold it at season's end, you keep it.** Artifacts in your vault or
  on your heroes cross the season line. Earn-only, keep-forever — until you
  lose it the only way artifacts are lost (`forward-base.md` §8): real PvP.
- **The vault vs. the field.** Artifacts sit in one of two states:
  - *Vaulted* (at the home colony): safe. Cannot be looted, traded, or lost.
    Also cannot be *used* — a vaulted artifact grants nothing.
  - *Carried* (equipped on a hero): grants its power — and is on the table.
    Fall in real PvP wearing it, the victor takes it. Fall to the Chorus,
    it's destroyed.
- **The self-balancing hoard.** There is no cap on kept artifacts, because
  the risk IS the cap. Every artifact you carry into the new season is a
  bounty you're wearing. Hoard across five seasons and you're the most
  tempting target alive — artifact hunters are emergent gameplay, not a
  system we have to build.
- **Provenance.** Every artifact records its history: who earned it, who
  carried it, who took it, where it fell. Paired with the memorial plaques,
  the game writes its own legends — "this blade has changed hands four
  times, and two of those hands are named on plaques."

---

## 6. Titles & veteran markers — cheap, effective, forever

- **Season titles** persist on your record: "Champion of [Server], Season 7."
  Cosmetic. Eternal.
- **Veteran markers:** "Fought in N seasons." Visible. The simplest retention
  mechanic ever designed — nobody wants to break the streak.
- **Plaque aging:** your name on old plaques doesn't fade. Season 2's fallen
  are still read in season 9. (This is free — the plaques were already
  permanent.)

---

## 7. Tunables (all numbers proposed, none locked)

| Knob | Proposed | Notes |
|---|---|---|
| Season length | 12 weeks | Four a year |
| Intermission | 1 week | Carving, naming, breathing |
| Storm length | final 2 weeks | Climax, standings locked |
| Favor curve | steep early, flat late | Veterans favored, never gods |
| Artifact vault slots | unlimited | Risk is the cap |

---

## 8. Open questions for the owner

1. **Season length:** 12 weeks feels right for the arc — shorter and bloodier,
   or is twelve the one? (Proposed: twelve. The cross-server game needs the
   room.)
2. **Alliance persistence:** does alliance membership cross the season line,
   or does everyone re-form? (Proposed: membership persists — the war band
   is the war band — but all *power* resets. Re-forming every 12 weeks is
   admin nobody wants.)
3. **New-season head start:** do veterans' persisted artifacts/favor apply
   from day one of the new season, or is there a "Landing grace" (e.g.,
   artifacts stay vaulted for weeks 1–2)? (Proposed: day one. The risk
   mechanic handles the rest — and a veteran swaggering in week 1 wearing
   last season's blade is *content*.)
4. **Intermission play:** can players log in and socialize (market closed,
   arena open?) during intermission, or is it full downtime? (Proposed:
   arena stays open — bloodless practice during the break keeps the habit
   warm.)

---

## 9. Build seams (for the engineer, later)

- `Season`: `{ id, name, startsAt, endsAt, stormStartsAt, phase }` — one
  global clock, every server reads it.
- Season rollover job (extends the forward-base recall): wipe board state
  per §3 table, carve pending plaques, finalize ladders, persist soul state.
  One job, idempotent, rehearsed — the most dangerous batch write in the
  game.
- `PlayerSoul`: `{ oracleFavor: Record<raceId, rank>, artifacts: Artifact[],
  titles: string[], seasonsFought: number }` — the cross-season record. The
  colony is seasonal; the soul is eternal.
- `Artifact`: `{ id, provenance: [{ holderId, season, event }], state:
  "vaulted" | "carried" }` — provenance appends on every transfer; the legend
  is a data structure.
- Vault: server-validated move between vaulted/carried. Carried artifacts
  are lootable per the PvP loot rules; vaulted ones are invisible to them.
