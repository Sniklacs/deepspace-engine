# Flow check run — 2026-10-14T08:03:52.104Z

Build: git HEAD f9c4937 (working tree — other crews' uncommitted fixes included) · Server: http://127.0.0.1:4517 (built bundle, harness serve-dist) · Surface: phone 390×844 (dpr 2), touch, fresh profile

**PASS 5 · FAIL 20 · KNOWN 0 · MANUAL 11** · JS exceptions: 4

## New finds (red, nobody owns these yet)
- **0.2 create account answers** — PAGE WEDGED — CDP timeout: Runtime.evaluate (page wedged? dialog open? renderer stuck?)
- **0.4 enter → the Sealed System (server select) opens** — expected the Sealed System; screen says: FOUNDING A COLONY  Choose Your Legend  Seven races are told around the ember-fires of the Shatterlands. These 
- **1.1 star map: six worlds orbit, drag spins the system** — no canvas hit-map (__planets) on the server select — star map not live
- **1.2 tapping a world inspects it (sheet with its name)** — no planets to tap
- **1.4 founding (if shown): race + name → Found The Cradle → in game** — still on the founding screen after Found The Cradle
- **2.1 World → globe renders (canvas + altitude)** — no globe canvas / altitude readout after World
- **2.3 layer/legend toggles respond to a press** — no layer/legend toggle controls found on the globe
- **2.4 altitude/ground switch changes the view** — no altitude/ground control on the globe
- **2.5 zoom changes the globe's scale** — no canvas to zoom
- **2.6 drag spins/pans the globe** — no canvas to drag
- **2.7 globe search finds a site** — no search input on the globe screen (doctrine: every page gets a search bar)
- **2.8 tapping a site opens ITS sheet** — grid-probed the globe; no site sheet with an Explore action opened
- **3.1 Explore → the room shows THAT site** — no site sheet available to explore from
- **5.1 a battle opens (arena practice / battles)** — battle surface present but no start button matched
- **5.2 AUTO/MANUAL mode badge is visible in the battle view** — no AUTO/MANUAL indicator anywhere in the battle view — the commander cannot tell who is driving
- **6.1 a build/buy press answers with a receipt (Click Law)** — no build/forge/buy control on the store surface
- **6.3 store exit works (Exit Law)** — no exit control on the store surface — EXIT LAW
- **7.1 avatar upload control exists in Settings** — no Settings control found on the home surface
- **7.3 avatar persists across a reload** — settings unreachable after reload
- **8.1 tutorial / Learn entry point is findable** — no Learn/Tutorial entry anywhere on the home surface

## Table
| | # | Check | Evidence |
|---|---|---|---|
| PASS | 0.1 | /play loads, sign-up/founding door on screen | first paint ok (0 exceptions so far) |
| FAIL | 0.2 | create account answers | PAGE WEDGED — CDP timeout: Runtime.evaluate (page wedged? dialog open? renderer stuck?) |
| PASS | 0.3 | language picker: English + Continue advances | no language step on this path |
| FAIL | 0.4 | enter → the Sealed System (server select) opens | expected the Sealed System; screen says: FOUNDING A COLONY  Choose Your Legend  Seven races are told around the ember-fires of the Shatterlands. These  |
| FAIL | 1.1 | star map: six worlds orbit, drag spins the system | no canvas hit-map (__planets) on the server select — star map not live |
| FAIL | 1.2 | tapping a world inspects it (sheet with its name) | no planets to tap |
| PASS | 1.3 | claim a colony → founding or the game shell | claim → founding flow |
| FAIL | 1.4 | founding (if shown): race + name → Found The Cradle → in game | still on the founding screen after Found The Cradle |
| FAIL | 2.1 | World → globe renders (canvas + altitude) | no globe canvas / altitude readout after World |
| PASS | 2.2 | globe button inventory (every tappable, graded in report) | 6 tappables; 0 under 44px on a side |
| FAIL | 2.3 | layer/legend toggles respond to a press | no layer/legend toggle controls found on the globe |
| FAIL | 2.4 | altitude/ground switch changes the view | no altitude/ground control on the globe |
| FAIL | 2.5 | zoom changes the globe's scale | no canvas to zoom |
| FAIL | 2.6 | drag spins/pans the globe | no canvas to drag |
| FAIL | 2.7 | globe search finds a site | no search input on the globe screen (doctrine: every page gets a search bar) |
| FAIL | 2.8 | tapping a site opens ITS sheet | grid-probed the globe; no site sheet with an Explore action opened |
| MANUAL | 2.9 | site sheet exit is ≥44px and closes the sheet | no sheet opened during probes this run — tap any site, measure its ✕, tap it, confirm the sheet closes |
| MANUAL | 2.10 | arena site → ENTER ARENA → Arena panel | arena site not hit by grid probes at this zoom — tap the arena site on the globe, then ENTER ARENA, confirm the Arena panel opens |
| FAIL | 3.1 | Explore → the room shows THAT site | no site sheet available to explore from |
| MANUAL | 3.2 | exploration exit returns to the globe | exploration room not reached this run — verify by hand: from the room, the globe button must return you to the globe |
| MANUAL | 4.1 | site picker is skinned, not a bare native dropdown | exploration room not reached this run — check for native <select> by eye in the room's site picker |
| MANUAL | 4.2 | exploration durations match the distance table (backyard 10–15m, cap ≤5h) | exploration room not reached this run — open an exploration launch/loadout panel and read every tier's time against zones.ts RUN_TIMER_BANDS |
| FAIL | 5.1 | a battle opens (arena practice / battles) | battle surface present but no start button matched |
| FAIL | 5.2 | AUTO/MANUAL mode badge is visible in the battle view | no AUTO/MANUAL indicator anywhere in the battle view — the commander cannot tell who is driving |
| MANUAL | 5.3 | deep gauntlet lines (flank drop, allegiance, tap-move, cover, pan, fallback) | owned by the battle gauntlet — run the runner in site/gauntlet/ when present and fold its table into this report; checklist Journey 5 lists the exact lines |
| MANUAL | 5.6 | exit battle → its windows retire (pinned/dumped) | battle window titles not detected in-view this run; verify manually: exit a battle, confirm Controls/Enemy Forces/Squads windows are gone and only the result sheet can stand |
| FAIL | 6.1 | a build/buy press answers with a receipt (Click Law) | no build/forge/buy control on the store surface |
| MANUAL | 6.2 | hammering never stacks duplicate execution | no live build/buy target this run — with a stocked profile: hammer one build button 6× in under a second; exactly one build may execute and one charge land |
| FAIL | 6.3 | store exit works (Exit Law) | no exit control on the store surface — EXIT LAW |
| PASS | 6.4 | store is reachable (in-world entrance or module door) | entered via "SeraphelWatcher of the ThresholdThe Watchers (The Grigori)Th" |
| FAIL | 7.1 | avatar upload control exists in Settings | no Settings control found on the home surface |
| MANUAL | 7.2 | uploading an avatar takes effect | settings/avatar surface not reached this run — upload unchecked, not failed |
| FAIL | 7.3 | avatar persists across a reload | settings unreachable after reload |
| MANUAL | 7.4 | mute/SFX toggle exists and governs | settings not reached this run — mute toggle unchecked, not failed |
| FAIL | 8.1 | tutorial / Learn entry point is findable | no Learn/Tutorial entry anywhere on the home surface |
| MANUAL | 8.2 | tutorial can be skipped/exited (≥44px, Exit Law) | no skip control matched in the tutorial's first screen — verify by eye: a SKIP/EXIT ≥44px must be visible at every step |

## Globe button inventory (6 tappables)
- "🖍️ First time? The founding lessons exp" — 342×44px
- "SeraphelWatcher of the ThresholdThe Watc" — 342×310px
- "Found The Cradle" — 292×44px
- "✕" — 44×44px
- "Got it →" — 230×44px
- "Skip lesson" — 91×44px

## Exploration durations seen
- none visible this run

## JS exceptions (first 10)
- Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e
- Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e
- ENV: script load failed with ERR_INSUFFICIENT_RESOURCES — the lab box is out of resources; game verdicts from this run are void
- Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message or use the non-minified dev environment for full e

Screenshots: site/flow-check/shots/ · Checklist: design/flow-checklist.md