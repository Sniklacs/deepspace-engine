# Deepspace Engine — Playable MVP

Original browser-based persistent co-op colony-management survival game. Lead
**The Cradle** through the ruined **Shatterlands**: send **Expeditions** to salvage
**Embers & Chipsets** from the AI wreck, study them in the **Lab**, and deploy the
recovered intelligence to rebuild the colony — all while the world persists in real
time, even logged out.

## Layout

```
src/
  game/
    types.ts        # shared types (state, race, zone, expedition…)
    races.ts        # 7 races + Unbound legend, from design/races.md (in-fiction lore)
    zones.ts        # 10 Shatterlands destinations (outer ruins → deep scientific sites)
    engine.ts       # PURE core loop: expedition/study/deploy/time-advance math
    store.ts        # server-only JSON persistence (data/save.json, survives restarts)
    api.ts          # server functions (the game server API layer)
    client-utils.ts # display helpers used by the client
  routes/
    index.tsx       # landing page ("/")
    play.tsx        # the game client ("/play"): race select + Colony/Expeditions/Lab/Codex
```

Persistence: `data/save.json` (gitignored) written by the server on every action.
Time advances lazily — on any load the engine rolls forward from `lastTick` so
expeditions/studies that finished while offline resolve and return to a colony that
grew in your absence.

## How to run

The site is a TanStack Start app served on port 3000.

```bash
cd /home/team/shared/site
bun run build   # production build
bun run start   # serve on 0.0.0.0:3000
```

Or run the dev server (hot reload) with `bun run dev`. Routes: `/` (landing) and `/play` (game).

The lead publishes the live site via `publish_site`.

## Verified

- `bun run build` succeeds (client + SSR), pages `/` and `/play` return 200 from the
  built server.
- Core engine loop tested headlessly: launch expedition → returns Embers (+ possible
  Chipset / corruption / Chorus) over real time → study fragments → insight → deploy
  domain level up.
- Race lore is presented as in-fiction mythology with a codex disclaimer; The Unbound
  is shown as a locked/earned preview only.
- Sources typecheck clean (tsc --noEmit) except pre-existing infra files
  `serve.ts`/`vercel-entry.ts` (Bun-typing, not part of this feature).

## Gameplay notes

- Starting supplies fund a couple of expeditions; outer ruins are safe and quick,
  deep scientific sites hold chipsets but draw the Chorus.
- Scientist capacity starts at 2; deploy Logistics to raise it and add field slots.
- Deploy recovered AI to advance Weaponry / Agriculture / Economy / Industry /
  Logistics — each grants passives (supply income, yield, speed, danger reduction).
- Corruption ("taint") dulls salvage and must be purged; Chorus attention rises with
  deep/risky salvage.
