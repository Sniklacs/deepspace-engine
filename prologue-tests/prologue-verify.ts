// PROLOGUE STATE SPINE VERIFICATION — opening-prologue-spec §4–§8 (The Fall,
// Step 2: engine + state integration, NO UI/routes) · opening-script §7.
//
// The opening's state ledger: every GameState carries `prologue` (V11), the
// full-power seed (Act I) → scripted cataclysm (Act II) → single-Cradle reset
// (Act III) transitions are pure/deterministic, and the final choice ("what
// the ash remembers": Archive/Names/Light) is a one-time echo — never a
// purchase. This harness is the spine's contract:
//
//   1 · deterministic seed      — same `now` → byte-identical prologueState
//        (state, leaders, ledger, log); zero Math.random reachable in the
//        prologue modules (comment-aware scan).
//   2 · height shape            — 5 named Leaders (owner-locked names/titles/
//        specializations), 8 Watcher heroes at L10, 5-hero squad, Citadel FOB,
//        full armory/domains/supply; stage "height", completed false.
//   3 · transitions             — height→fallen→rebuilt; guards (cataclysm only
//        from height, reset only from fallen, both idempotent no-ops
//        otherwise); sealed ledger never deleted (leaders unfound, heroes
//        fallen, ids preserved); ashMemory recorded exactly once.
//   4 · echoes                  — archive/names/light each seed exactly their
//        stated echo and nothing else; completed=true only after reset.
//   5 · NO PURCHASE SURFACE     — no storefront/wallet vocabulary in executable
//        prologue code; currency+entitlements byte-identical across all three
//        transitions; cataclysm never touches the monetization block.
//   6 · V11 migration           — pre-V11 saves advance cleanly: additive +
//        idempotent default block (stage "rebuilt", completed false, no
//        echoes); partial blocks repaired field-by-field; valid state kept.
//   7 · engine wiring           — newGame/blankColony seed the block;
//        advance() backfills; publicState ships the player's whole story;
//        devotion monotonicity intact; daily claim flow unaffected; battles
//        clearing in the cataclysm orphans nothing advance()/api expect.
//
// Run:  cd /home/team/shared/prologue-tests && bun run prologue-verify.ts
// (pure imports — also runnable unchanged from the site dir; use
//  `env -u DATABASE_URL` in the full battery so store.ts stays on files.)
import { readFileSync } from "node:fs";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import {
  PROLOGUE_CONFIG,
  PROLOGUE_LEADERS,
  PROLOGUE_SQUAD,
  freshPrologue,
  ensurePrologue,
} from "/home/team/shared/site/src/game/prologue/prologue-state.ts";
import {
  prologueState,
  resolveCataclysm,
  resetToCradle,
} from "/home/team/shared/site/src/game/prologue/prologue-engine.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}
const T = 1_755_000_000_000;
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const prologueSrc = [
  readFileSync("/home/team/shared/site/src/game/prologue/prologue-state.ts", "utf8"),
  readFileSync("/home/team/shared/site/src/game/prologue/prologue-engine.ts", "utf8"),
];
const prologueExe = prologueSrc.map(stripComments).join("\n");
// ============================================================================
// 1 · deterministic seed + zero randomness
// ============================================================================
console.log("— 1 · deterministic seed —");
{
  const a = prologueState(T);
  const b = prologueState(T);
  check("same now → byte-identical full-power state", JSON.stringify(a) === JSON.stringify(b));
  check(
    "same now → byte-identical ledger + log",
    JSON.stringify(a.prologue) === JSON.stringify(b.prologue) && JSON.stringify(a.log) === JSON.stringify(b.log),
  );
  const c = prologueState(T + 1);
  check("different now → different joinedAt-encoded state", JSON.stringify(a) !== JSON.stringify(c));
  check(
    "no Math.random anywhere in the prologue modules' EXECUTABLE code (comment-aware scan)",
    !prologueExe.includes("Math.random") && !/\brandom\s*\(/.test(prologueExe),
  );
}
// ============================================================================
// 2 · height shape (Act I — "had it all")
// ============================================================================
console.log("— 2 · height shape —");
{
  const st = prologueState(T);
  check("stage height, not completed, no ash yet", st.prologue.stage === "height" && st.prologue.completed === false && st.prologue.ashMemory === null);
  const names = st.prologue.leaders.map((l) => `${l.name}|${l.title}|${l.specialization ?? "null"}|${l.level}|${l.fate ?? "null"}`);
  check(
    "five named Leaders, owner-locked names/titles/specializations",
    JSON.stringify(names) ===
      JSON.stringify([
        "Kael|the Steward|null|10|null",
        "Serev|the Marshal|marshal|10|null",
        "Vyra|the Scholar|scholar|10|null",
        "Miren|the Quartermaster|quartermaster|10|null",
        "Delen|the Purifier|null|10|null",
      ]),
    JSON.stringify(names),
  );
  check(
    "PROLOGUE_LEADERS defs match the same locked table",
    PROLOGUE_LEADERS.map((d) => d.name).join(",") === "Kael,Serev,Vyra,Miren,Delen" &&
      PROLOGUE_LEADERS[0].title === "the Steward" &&
      PROLOGUE_LEADERS[4].title === "the Purifier",
  );
  check(
    "live Leaders mirror the ledger (names/titles/specializations at L10)",
    st.leaders.length === 5 &&
      st.leaders.every((l) => l.status === "active" && l.xp === PROLOGUE_CONFIG.maxXp) &&
      st.leaders[0].name === "Kael" &&
      st.leaders[0].title === "the Steward" &&
      st.leaders[3].specialization === "quartermaster",
  );
  check(
    "full Watcher roster sealed (8 heroes, all fate null, all L10)",
    st.prologue.heroes.length === 8 && st.prologue.heroes.every((h) => h.fate === null && h.xp === PROLOGUE_CONFIG.maxXp),
    `${st.prologue.heroes.length}`,
  );
  check(
    "5-hero squad, all roster members",
    st.prologue.squad.length === PROLOGUE_CONFIG.squadSize &&
      st.prologue.squad.every((id) => st.prologue.heroes.some((h) => h.id === id)) &&
      JSON.stringify(st.prologue.squad) === JSON.stringify(PROLOGUE_SQUAD.filter((id) => st.prologue.heroes.some((h) => h.id === id))),
    JSON.stringify(st.prologue.squad),
  );
  check(
    "war posture: Citadel FOB snapshot, tier-4 armory, maxed domains",
    st.prologue.height !== null &&
      st.prologue.height.fobStage === PROLOGUE_CONFIG.fobStageAtHeight &&
      Object.values(st.prologue.height.armoryTiers).every((t) => t === 4) &&
      Object.values(st.deployedDomains).every((d) => d === PROLOGUE_CONFIG.maxDomainLevel) &&
      st.warReserve.troops === PROLOGUE_CONFIG.warReserveTroops,
  );
  check("final stand unset at the height; empty History Book", st.prologue.finalStand === null && st.prologue.historyBook.length === 0);
}
// ============================================================================
// 3 · transitions: height→fallen→rebuilt + guards + sealed ledger
// ============================================================================
console.log("— 3 · transitions —");
{
  // guards: cataclysm only from height
  const fresh = engine.newGame("Guard", "watchers", T) as GameState;
  const freshJson = JSON.stringify(fresh);
  resolveCataclysm(fresh, "archive", T);
  check("cataclysm on a fresh (rebuilt) colony is a no-op", JSON.stringify(fresh) === freshJson);
  resolveCataclysm(fresh, "bogus" as "archive", T);
  check("cataclysm with an invalid choice is a no-op", JSON.stringify(fresh) === freshJson);
  // reset only from fallen
  const height = prologueState(T);
  const heightJson = JSON.stringify(height);
  resetToCradle(height, T);
  check("reset on a height colony is a no-op", JSON.stringify(height) === heightJson);

  // the real fall
  const st = prologueState(T);
  const leaderIds = st.prologue.leaders.map((l) => l.id);
  const heroIds = st.prologue.heroes.map((h) => h.id);
  resolveCataclysm(st, "names", T);
  check("cataclysm moves height→fallen, records the choice once", st.prologue.stage === "fallen" && st.prologue.ashMemory === "names" && st.prologue.completed === false);
  check(
    "sealed ledger NEVER deleted: same leader/hero ids, fate-marked only",
    JSON.stringify(st.prologue.leaders.map((l) => l.id)) === JSON.stringify(leaderIds) &&
      JSON.stringify(st.prologue.heroes.map((h) => h.id)) === JSON.stringify(heroIds) &&
      st.prologue.leaders.every((l) => l.fate === "unfound") &&
      st.prologue.heroes.every((h) => h.fate === "fallen"),
  );
  check(
    "live Leaders marked lost (never removed), histories extended",
    st.leaders.length === 5 && st.leaders.every((l) => l.status === "lost" && l.assignment === null && l.history.length >= 1),
  );
  check(
    "final stand: honest unwinnable math, shown odds, never a paywall datum",
    st.prologue.finalStand !== null &&
      st.prologue.finalStand.chorusPower === st.prologue.finalStand.colonyPower * PROLOGUE_CONFIG.finalStandChorusMultiple &&
      st.prologue.finalStand.winChance > 0 &&
      st.prologue.finalStand.winChance < 0.5 &&
      typeof st.prologue.finalStand.line === "string",
    JSON.stringify(st.prologue.finalStand),
  );
  check(
    "colony stripped: zeroed resources/research/arsenal, Chorus at 100",
    st.resources.embers === 0 && st.resources.supplies === 0 && st.codices === 0 && st.techsResearched.length === 0 && Object.keys(st.armory).length === 0 && st.chorusAttention === 100 && st.corruption === 100,
  );
  check("battles cleared, war reserve reset, report ledger kept", st.battles.length === 0 && st.battleReports.length === 0 && st.warReserve.troops === 0);
  // idempotent: second fall is a no-op
  const fallenJson = JSON.stringify(st);
  resolveCataclysm(st, "light", T);
  check("second cataclysm is a no-op (choice recorded exactly once)", JSON.stringify(st) === fallenJson && st.prologue.ashMemory === "names");

  // the wake
  const woke = resetToCradle(st, T + 1000);
  check("reset moves fallen→rebuilt, sets completed, keeps the choice", woke.prologue.stage === "rebuilt" && woke.prologue.completed === true && woke.prologue.ashMemory === "names");
  check(
    "sealed records ride forward (memory is not deleted)",
    woke.prologue.leaders.length === 5 && woke.prologue.heroes.length === 8 && woke.prologue.finalStand !== null && woke.prologue.height !== null,
  );
  check("single fresh Cradle: starter-scale colony, live leaders are new hands", woke.leaders.length === 3 && woke.resources.supplies === 60 && woke.scientists === 2);
  // idempotent: reset on rebuilt is a no-op
  const wokeJson = JSON.stringify(woke);
  resetToCradle(woke, T + 2000);
  check("reset on a rebuilt colony is a no-op (echo never double-applied)", JSON.stringify(woke) === wokeJson);
}
// ============================================================================
// 4 · echoes (script §7 — each grants exactly its seed, nothing else)
// ============================================================================
console.log("— 4 · echoes —");
{
  const runEcho = (choice: "archive" | "names" | "light") => {
    const st = prologueState(T);
    resolveCataclysm(st, choice, T);
    return resetToCradle(st, T + 1000);
  };
  const archive = runEcho("archive");
  check(
    "archive: exactly one Codex + codex echo + Vyra line, no devotion",
    archive.codices === 1 && archive.totalCodicesEarned === 1 && archive.prologue.codexEcho === PROLOGUE_CONFIG.codexEchoLine && JSON.stringify(archive.prologue.historyBook) === JSON.stringify([PROLOGUE_CONFIG.vyraBookLine]) && archive.devotion === 0 && archive.prologue.devotionEcho === 0 && archive.prologue.riddleEcho === null,
  );
  const names = runEcho("names");
  check(
    "names: five Leader lines, no numeric bonus",
    JSON.stringify(names.prologue.historyBook) === JSON.stringify([...PROLOGUE_CONFIG.namesBookLines]) && names.codices === 0 && names.devotion === 0 && names.prologue.codexEcho === null && names.prologue.riddleEcho === null,
  );
  const light = runEcho("light");
  check(
    "light: small devotion head-start + Delen riddle + book line",
    light.devotion === PROLOGUE_CONFIG.devotionEcho && light.prologue.devotionEcho === PROLOGUE_CONFIG.devotionEcho && light.prologue.riddleEcho === PROLOGUE_CONFIG.delenRiddle && JSON.stringify(light.prologue.historyBook) === JSON.stringify([PROLOGUE_CONFIG.delenBookLine]) && light.codices === 0 && light.prologue.codexEcho === null,
    `devotion=${light.devotion}`,
  );
  check("ashMemory recorded exactly once per echo path", archive.prologue.ashMemory === "archive" && names.prologue.ashMemory === "names" && light.prologue.ashMemory === "light");
}
// ============================================================================
// 5 · NO PURCHASE SURFACE
// ============================================================================
console.log("— 5 · no purchase surface —");
{
  const FORBIDDEN = ["storefront", "votives", "scrip", "purchase", "premium", "wallet", "payment", "stripe", "price", "catalog", "entitlement", "battlePass", "battle_pass", "seasonPass"];
  const hits = FORBIDDEN.filter((w) => prologueExe.includes(w));
  check("no storefront/wallet vocabulary in executable prologue code", hits.length === 0, hits.join(","));
  for (const choice of ["archive", "names", "light"] as const) {
    const st = prologueState(T);
    const cur0 = JSON.stringify(st.currency);
    const ent0 = JSON.stringify(st.entitlements);
    resolveCataclysm(st, choice, T);
    const cur1 = JSON.stringify(st.currency);
    const ent1 = JSON.stringify(st.entitlements);
    const woke = resetToCradle(st, T + 1000);
    const cur2 = JSON.stringify(woke.currency);
    const ent2 = JSON.stringify(woke.entitlements);
    check(
      `currency+entitlements byte-identical across all three transitions (${choice})`,
      cur0 === cur1 && cur1 === cur2 && ent0 === ent1 && ent1 === ent2,
    );
  }
  const catSrc = stripComments(readFileSync("/home/team/shared/site/src/game/prologue/prologue-engine.ts", "utf8"));
  check("cataclysm never touches the monetization block", !catSrc.includes("currency") && !catSrc.includes("entitlements") && !catSrc.includes("battlePass"));
}
// ============================================================================
// 6 · V11 migration (additive, idempotent)
// ============================================================================
console.log("— 6 · V11 migration —");
{
  const legacy = engine.newGame("Legacy", "watchers", T) as unknown as Record<string, unknown>;
  delete legacy.prologue;
  legacy.version = 10;
  const adv = engine.advance(legacy as unknown as GameState, T + 5000);
  check(
    "pre-V11 save advances cleanly and gains the default block",
    adv.prologue.stage === "rebuilt" && adv.prologue.completed === false && adv.prologue.ashMemory === null && adv.prologue.historyBook.length === 0 && adv.prologue.devotionEcho === 0,
  );
  const again = JSON.stringify(adv.prologue);
  engine.advance(adv, T + 6000);
  check("migration idempotent on re-advance", JSON.stringify(adv.prologue) === again);
  // partial/garbled blocks repaired field-by-field, valid state kept
  const partial = engine.newGame("Partial", "watchers", T) as unknown as Record<string, unknown>;
  (partial.prologue as Record<string, unknown>).stage = "height";
  (partial.prologue as Record<string, unknown>).leaders = "garbage";
  (partial.prologue as Record<string, unknown>).ashMemory = "bogus";
  engine.advance(partial as unknown as GameState, T);
  const p = (partial as unknown as GameState).prologue;
  check("partial block repaired (garbage leaders/ashMemory), valid stage kept", Array.isArray(p.leaders) && p.leaders.length === 0 && p.ashMemory === null && p.stage === "height");
  const fresh = freshPrologue();
  check("freshPrologue is the documented default", fresh.stage === "rebuilt" && fresh.completed === false && fresh.ashMemory === null && fresh.leaders.length === 0 && fresh.height === null && fresh.finalStand === null);
  // ensurePrologue direct: never rewrites valid state
  const keep = prologueState(T);
  const keepJson = JSON.stringify(keep.prologue);
  ensurePrologue(keep);
  check("ensurePrologue never rewrites a valid block", JSON.stringify(keep.prologue) === keepJson);
}
// ============================================================================
// 7 · engine wiring (seeds, advance, publicState, devotion, battles)
// ============================================================================
console.log("— 7 · engine wiring —");
{
  check("ENGINE VERSION is 11", engine.VERSION === 11);
  const ng = engine.newGame("Wired", "watchers", T);
  check("newGame seeds the default block", ng.prologue.stage === "rebuilt" && ng.prologue.completed === false);
  const blank = engine.blankColony(T);
  check("blankColony seeds the default block", blank.prologue.stage === "rebuilt" && blank.prologue.completed === false);
  const pub = publicState(prologueState(T));
  check(
    "publicState ships the whole story block (stage/records/squad/stand/book/echoes)",
    pub.prologue.stage === "height" && pub.prologue.leaders.length === 5 && pub.prologue.heroes.length === 8 && pub.prologue.squad.length === 5 && pub.prologue.height !== null,
  );
  const mutated = JSON.stringify(prologueState(T).prologue);
  check("publicState prologue is a defensive copy (server state unmutated)", (() => {
    const st = prologueState(T);
    const p = publicState(st);
    p.prologue.stage = "rebuilt";
    p.prologue.leaders.length = 0;
    return st.prologue.stage === "height" && st.prologue.leaders.length === 5 && JSON.stringify(st.prologue).length === mutated.length;
  })());
  // devotion monotonicity: the light echo is a fresh-save starting value —
  // the daily claim path only ever ADDS, and ensureDaily never resets it.
  const light = resetToCradle((() => { const s = prologueState(T); resolveCataclysm(s, "light", T); return s; })(), T + 1000);
  const d0 = light.devotion;
  engine.advance(light, T + 2000);
  check("light-echo devotion survives advance (no daily-claim invariant breaks)", light.devotion === d0 && d0 === PROLOGUE_CONFIG.devotionEcho);
  // battles clearing orphans nothing: a fallen state advances quietly and its
  // public payload keeps valid (empty) battle shapes.
  const fallen = prologueState(T);
  resolveCataclysm(fallen, "archive", T);
  engine.advance(fallen, T + 60_000);
  const fallenPub = publicState(fallen);
  check("fallen state advances + publishes cleanly after battles cleared", Array.isArray(fallenPub.battles) && fallenPub.battles.length === 0 && Array.isArray(fallenPub.battleReports));
}
// ============================================================================
console.log(`\nprologue-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
