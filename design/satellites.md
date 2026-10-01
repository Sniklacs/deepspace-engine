# Spec — Orbital Watch / Satellites (authoritative build doc, forward design)

> Status: **forward design only — nothing is built.** Owner-riffed 2026-09-30,
> refined same day: the interactive globe comes later; satellites start
> half-blind every season, and seeing the enemy is something you re-earn.
>
> One-line thesis: **the sky is broken, and fixing it is how you stop being
> ambushed.**

---

## 0. Locked principles

1. **Detection is earned, never default.** A new season does not come with
   full vision. Coverage is infrastructure you rebuild, every season.
2. **Blind spots are real geography.** An uncovered node is not "fog" for
   flavor — arrivals there are mechanically invisible. No alarm, no ping,
   no report. The enemy can sit in your blind spot staging a raid and you
   will not know.
3. **Restoration is one by one, never accelerable.** No store skip, no
   speedup, no bundle. Each satellite comes online individually, on
   research time. The hide-and-seek window while the constellation wakes
   up is the point, not a problem.
4. **The sky resets every season.** At season start the constellation
   drops back to ~50% functional, **randomized per world per season**.
   Last season's coverage map is worthless. Raiders do fresh homework;
   defenders watch different ground. Nobody coasts on memory.
5. **Coverage is per-node, not global.** Each contestable site sits under a
   satellite footprint. A satellite is either functional or dormant; its
   footprint is either watched or blind. No partial credit.

## 1. What gets watched

- **Covered:** every contestable node — T1s, T2s, T3s — **and the
  Chorus-held heart**. The heart is the toughest spot on the map and holds
  the best artifact and chipset drops; its bird matters most and will be
  fought over in the restoration triage.
- **Not covered:** the Near ring and the Cradle approaches. That land is
  **sanctioned** — it cannot be inhabited or raided — so there is nothing
  to watch for. No satellites wasted there.
- Which nodes are blind at any moment is **public geography** (same class
  of fact as the atlas: both sides can read the coverage map). The
  paranoia is symmetric — but it expires every season (§0.4).

## 2. Detection — the alarm, in three stages

- **Trigger:** a foreign player arrives on your server — jump-in, raid
  staging, forward-base plant (see `forward-base.md`).
- **Blind node:** nothing. No alarm, no ping, no feed entry. The invader
  exists in your world and your UI says otherwise.
- **Watched node:** the alarm sounds and the spot is shown on the map.
  What the alarm tells you depends on that satellite's restoration stage:

  | Stage | Intel |
  |---|---|
  | **1 — Online** | Someone is there. That is all. No name, no numbers. |
  | **2 — Tracking** | The player's identity and an *approximate* troop count. Not types — you know it's ~2,000 troops, not what they are. |
  | **3 — Full picture** | Amounts **and** types. You see the composition. |

- Each satellite climbs the stages individually through the research
  track — a node can sit at stage 1 for weeks while another is at stage 3.
  Triage is the game: eyes on the deep T3s first, or on the approaches
  raiders actually use?

## 3. Restoration — the research track

- A Lab research line brings dormant satellites online **one by one**,
  then climbs each through stages 1 → 2 → 3. Never accelerable (§0.3).
- Full constellation at stage 3 everywhere = no blind spots and full
  composition intel. That is a late-season achievement, not a week-one
  given — and it all resets next season.
- Restoration is per-server: your sky over your world. Your forward-base
  server's sky belongs to its defenders, not to you.

## 4. How this plays

- **Raiders** route through blind spots — approach, stage, and plant in
  the dark. Every season opens with fresh homework: *where is dark this
  time?* Early season is hide-and-seek; late season the net tightens.
- **Defenders** triage under uncertainty: restore the deep T3s first, or
  the lanes raiders used last season? A wrong guess is a blind approach
  left open.
- **Deception:** a defender who *looks* blind somewhere may have just
  brought that bird to stage 2. The coverage map the enemy studied last
  week may be stale — and stage-1 coverage tells the *defender* someone
  is there while the raider believes they're unseen.
- **Engagement keeps the battle dynamic.** Intel is never the battle.
  When forces engage, the opponent's reactions — surprise routes,
  maneuvers, the rally-maneuver seam (`design` rally maneuvers) — keep
  the fight alive. Satellites tell you *what's coming*; they don't win
  the fight. Maximum battle actions, decided on the ground.

## 5. Map representation

- Every covered node shows a small satellite-dish marker beside it.
- **Red dish** = dormant (blind). **Green dish** = active.
- A number badge on the dish shows its restoration stage (1, 2, 3).
- The marker is the research surface: it shows what the satellite
  currently reveals and what the next stage unlocks, and it is where
  restoration/research is launched.
- The Near ring and Cradle show no dishes — sanctioned land, nothing
  to watch (§1).

## 6. Open questions for Hans

1. Does the alarm distinguish "raid staging" from "forward-base plant,"
   or is every arrival the same ping?
2. Does stage-3 intel reveal heroes, leaders, and modules — or only
   troop types and counts?
3. Satellite-blinding as an offensive act is a reserved v2 hook. Hans has
   not asked for this; do not build it unprompted.
