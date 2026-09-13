# Build-Ready Spec — Multiple Games per Account + Reset/Delete + Trash Account

## Data model (store.ts)
Change `data/saves/<accountId>.json` → version 2:
```ts
interface AccountSaves { version: 2; activeGameId: string|null; games: { [gameId:string]: GameState } }
```
Add `gameId` to GameState. **Migration:** if file is a bare GameState, wrap as `{version:2, activeGameId:"0", games:{"0": legacy}}`.
**Cap:** max 5 games/account (adjustable).

## API (api.ts)
- `startGameFn` → becomes `createGameFn` (validates race, adds new game, sets active).
- `listGamesFn({token})` → summary only (gameId, name, race, dates, summary; never full state).
- `switchGameFn({token, gameId})` → sets active, returns that game's state.
- `resetGameFn({token, gameId})` → wipe progress, fresh colony SAME race+name. (RESET CHOICE — flag to owner: same-race restart vs back-to-race-select.)
- `deleteGameFn({token, gameId})` → remove; if active, set newest remaining or null. Can't delete last game except via trash-account.
- `trashAccountFn({token, username, password})` → verify username matches token + password matches stored hash, then delete all saves + the account + revoke sessions → {ok, signedOut:true}.

## UI (play.tsx)
- **"Games"** header button → `GamesModal` with 3 zones:
  1. **Your colonies** list (name, race, created date, summary) + Play / Reset / Delete.
  2. **Found a New Colony** → reuses existing RaceSelect → createGameFn.
  3. **Account** section → **Delete entire account** (danger).
- Sign-in flow: after login, resume active game OR show empty "Found a Colony" prompt.
- Compact active-game indicator in header (name + race).

## Confirm/guardrails
- **Reset game:** 2-step; confirm disabled 3s + ticked checkbox.
- **Delete game:** must type the colony name to enable red confirm; permanent.
- **Active content guard:** if game has in-flight expeditions/studies, extra line + forced checkbox.
- **Trash account:** type username + re-enter password (server-verified) + final confirm.
- Old account-wide Reset replaced by per-game reset/delete; only trashAccountFn removes everything (needs password).

## Files
`game/types.ts`, `game/store.ts` (multi-game + migration, deprecate resetStateFor), `game/api.ts`, `routes/play.tsx`.
