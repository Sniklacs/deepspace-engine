import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  getState, createGameFn, switchGameFn, resetGameFn, deleteGameFn, trashAccountFn,
  launchFn, studyFn, deployFn, purifyFn, craftFn, beginResearchFn, chooseRevelationFn,
  allocateLeaderPointFn, chooseSpecializationFn,
  signupFn, loginFn, logoutFn, meFn,
  submitFeedbackFn, listMyFeedbackFn, dismissNoticeFn,
  weaponBuildFn, refinePlasmaFn,
  forgeRollFn, forgeMeltFn,
  claimDailyRewardFn,
  leaveActOneFn,
} from "../game/api";
import type { GameSummary } from "../game/api";
import { RACES, UNBOUND_LEGEND, getRace, raceModLines } from "../game/races";
import { WORLD_CONFIG_PUBLIC, worldAllowedRaces, worldLockPlain } from "../game/world-config";
import { ZONES, DOMAINS, getZone } from "../game/zones";
import { engineHelpers } from "../game/client-utils";
import {
  DEEP, isDeepZone, hazmatPerScientist,
  requiredGear, canForgeAlloy, alloyRecipeRaces, CRAFT,
  hasStepOutGear,
} from "../game/engine";
import type { CraftKind } from "../game/engine";
import { raceFamilies, ARMORY_FAMILY_TECH, weaponStats, weaponCost, modelName, STAT_LABELS } from "../game/armory";
import { DAILY_ITEM_BY_ID } from "../game/daily";
import { ARMORY_TREE } from "../game/research";
import { sound } from "../game/sound";
import { voiceEngine } from "../game/voice/voice-engine";
import { Tooltip } from "../components/Tooltip";
import { StorefrontOverlay } from "../components/StorefrontOverlay";
import {
  clearPurchaseIntent,
  readPurchaseIntent,
  walletSignature,
  type PurchaseIntent,
} from "../game/payments/purchase-intent";
import { Sheet, SheetHeader } from "../components/Sheet";
import AppShell from "../components/shell/AppShell";
import CradleSheet from "../components/shell/CradleSheet";
import SettingsSheet from "../components/shell/SettingsSheet";
import { useT } from "../components/i18n/I18n";
import { navBadges } from "../game/nav-badges";
import type { Tab } from "../game/nav-slots";
import CradleScreen from "../components/screens/CradleScreen";
import { ForgedRack } from "../components/ForgeViews";
import { JournalButton } from "../components/JournalButton";
import { CircuitPage } from "../components/CircuitPage";
import BattlesTab from "../components/BattlesTab";
import { diffResolvedEvents } from "../game/report-events";
import { tip, RESOURCE_TIPS, DOMAIN_TIPS, METER_TIPS, EXPEDITION_TIPS, LAB_TIPS, OWNER_TIPS, ARMORY_TIPS } from "../game/tooltips";
import type { GameState, RaceId, DomainId, Zone, FeedbackRecord, FeedbackCategory, FeedbackSeverity } from "../game/types";
import { ResearchTreeView, LeadersView } from "../components/ResearchViews";

export const Route = createFileRoute("/play")({
  component: PlayPage,
});

// Nav consolidation (Rung 1a, spec §E): 7 -> 5, plus the conditional war slot
// (game-ui-shell-spec A1). The `Tab` union now comes from the shell's own slot
// table (game/nav-slots.ts) so no screen can be orphaned from the nav.

const TOKEN_KEY = "deepspace_session_token";

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function storeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

function PlayPage() {
  const [token, setToken] = useState<string | null>(readToken);
  // null = still checking a persisted session; false = signed out; true = signed in
  const [signedIn, setSignedIn] = useState<boolean | null>(token ? null : false);
  const [state, setState] = useState<GameState | null>(null);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // ---- Back from Stripe (Payments). `intent` is the note written at click time
  // (game/payments/purchase-intent.ts). What the player is told is derived from the
  // SERVER's wallet compared against that note — never from the URL — and this panel
  // grants nothing: the entitlement arrives only through the signed webhook.
  const [purchaseReturn, setPurchaseReturn] = useState<{
    skuId: string | null;
    intent: PurchaseIntent | null;
    seenAt: number;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("colony");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [firstRunNotice, setFirstRunNotice] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // ---- The shell (game-ui-shell-spec §1): the Cradle sheet is the home of
  // every control the old header held, and `isWide` only flips the (CSS-only)
  // data-shell-layout switch — no layout is re-decided in JS (§7).
  const [cradleOpen, setCradleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ---- Reports bell (owner 2026-09-13) ----
  // Every server state lands through applyState, which diffs against the
  // previous snapshot of the SAME game and collects events that were
  // in-flight and are now done (an expedition home, a study or research
  // complete, an armory build ready). The bell blinks ONLY on these real
  // transitions — never on a timer or countdown.
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportsSeen, setReportsSeen] = useState(0); // how many were read
  const [reportOpen, setReportOpen] = useState(false);
  const prevStateRef = useRef<GameState | null>(null);
  const reportIdRef = useRef(0);
  const reportOpenRef = useRef(false);
  useEffect(() => { reportOpenRef.current = reportOpen; }, [reportOpen]);

  const applyState = useCallback((next: GameState | null) => {
    const prev = prevStateRef.current;
    if (next && prev && prev.gameId === next.gameId) {
      const fresh = diffResolvedEvents(prev, next);
      if (fresh.length > 0) {
        const ts = Date.now();
        setReports((rs) => [
          ...fresh.map((f) => ({ id: ++reportIdRef.current, text: f.text, ts })),
          ...rs,
        ].slice(0, 30));
        if (reportOpenRef.current) setReportsSeen((c) => c + fresh.length);
      }
    }
    prevStateRef.current = next;
    setState(next);
  }, []);

  const localLogout = useCallback(() => {
    storeToken(null);
    setToken(null);
    setSignedIn(false);
    setState(null);
    prevStateRef.current = null;
    setGames(null);
    setActiveGameId(null);
  }, []);

  // Confirm any persisted session on load.
  useEffect(() => {
    if (!token) return;
    (async () => {
      const me = await meFn({ data: { token } }).catch(() => null);
      if (!me || me.signedOut) { localLogout(); return; }
      const s = await getState({ data: { token } }).catch(() => null);
      if (!s || s.signedOut) { localLogout(); return; }
      setSignedIn(true);
      applyState(s.state ?? null);
      setGames(s.games ?? []);
      setActiveGameId(s.activeGameId ?? null);
      if (s.username) setUsername(s.username);
      if (typeof s.showFirstRunNotice === "boolean") setFirstRunNotice(s.showFirstRunNotice);
      setNow(Date.now());
    })();
  }, [token, localLogout]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const s = await getState({ data: { token } });
    if (s.signedOut) { localLogout(); return; }
    if (s.ok) {
      applyState(s.state ?? null);
      setGames(s.games ?? []);
      setActiveGameId(s.activeGameId ?? null);
      if (s.username) setUsername(s.username);
      if (typeof s.showFirstRunNotice === "boolean") setFirstRunNotice(s.showFirstRunNotice);
      setNow(Date.now());
    }
  }, [token, localLogout]);
  // First-Run nudge: one-time dismissible banner for new accounts ("this is the
  // first world — tell us what broke"). Persisted server-side per account.
  const dismissNudge = () => {
    setFirstRunNotice(false);
    sound.click();
    dismissNoticeFn({ data: { token: token ?? "" } }).catch(() => {});
  };

  useEffect(() => {
    if (signedIn !== true) return;
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [signedIn, refresh]);
  // ---- PAYMENT RETURN (Payments) ----------------------------------------------------
  // Stripe sends the player back to /play?purchase=return&sku=…&session_id=… . The
  // session id is kept for support only: it proves nothing, so it is never used to
  // grant or to claim anything. The panel re-reads what the server holds.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") !== "return") return;
    const skuId = params.get("sku");
    const intent = readPurchaseIntent(window.localStorage, Date.now());
    setPurchaseReturn({ skuId: skuId ?? intent?.skuId ?? null, intent, seenAt: Date.now() });
    setLedgerOpen(true);
    // One-shot signal: strip it so a reload cannot re-open the panel.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  // "confirmed" needs a BEFORE and an AFTER: with no note (another device, cleared
  // storage) the honest answer is "not confirmed yet", never a claim. The 4s poll
  // moves a fresh return from "checking" to "pending" without the player doing anything.
  const purchaseReturnView = (() => {
    if (!purchaseReturn) return null;
    const status: "checking" | "confirmed" | "pending" = !purchaseReturn.intent
      ? "pending"
      : state && walletSignature(state) !== purchaseReturn.intent.signature
        ? "confirmed"
        : now - purchaseReturn.seenAt > 8000
          ? "pending"
          : "checking";
    return {
      status,
      onCheckAgain: () => { void refresh(); },
      onDismiss: () => {
        clearPurchaseIntent(typeof window === "undefined" ? null : window.localStorage);
        setPurchaseReturn(null);
        sound.click();
      },
    };
  })();

  // Browser autoplay rule: audio may only begin on a user gesture. The SAME
  // gesture arms the speech engine (voice-direction §5.2): one 1-character
  // priming utterance unlocks iOS Safari's speech queue, and the one line the
  // plate raised before the gesture is released — if its cue is still active.
  useEffect(() => {
    const onFirst = () => {
      sound.prime();
      sound.startMusic();
      voiceEngine.arm();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst);
    window.addEventListener("keydown", onFirst);
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, []);

  // Fullscreen state tracking.
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const flash = (msg: string | undefined) => {
    if (!msg) return;
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const OK_SOUNDS: Record<string, () => void> = {
    success: () => sound.success(),
    launch: () => sound.launch(),
    deploy: () => sound.deploy(),
    study: () => sound.success(),
    purify: () => sound.purify(),
  };

  const act = async (fn: () => Promise<any>, okSfx = "success") => {
    if (busy) return;
    setBusy(true);
    sound.click();
    try {
      const res = await fn();
      if (res && res.signedOut) { localLogout(); return; }
      if (res && res.state) {
        applyState(res.state);
        setNow(Date.now());
      }
      if (res && res.ok === false) {
        flash(res.error);
        sound.error();
      } else if (res && res.ok) {
        sound.success();
        (OK_SOUNDS[okSfx] || OK_SOUNDS.success)();
      }
    } catch (e: any) {
      flash(e?.message || "Something broke in the Cradle.");
      sound.error();
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    // Mobile-game convention (§1.1 rule 5): a tab switch lands at the top of the
    // new screen. Focus stays on the nav slot the player pressed (native), so
    // keyboard users are not thrown and the nav never moves under them.
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    sound.tab();
  };

  const toggleMute = () => {
    const next = sound.toggleMute();
    // §5.1: a mute press must be silent within one frame, so the voice engine is
    // told in the SAME tick (the state update only redraws the chip).
    voiceEngine.setMuted(next);
    setMuted(next);
  };

  const doLogout = async () => {
    if (token) { try { await logoutFn({ data: { token } }); } catch { /* ignore */ } }
    localLogout();
  };

  const doSignup = async (username: string, password: string): Promise<string | null> => {
    const res = await signupFn({ data: { username, password } });
    if (res.ok && res.token) {
      storeToken(res.token);
      setToken(res.token);
      setSignedIn(true);
      setState(null);
      return null;
    }
    return res.error || "Sign up failed.";
  };

  const doLogin = async (username: string, password: string): Promise<string | null> => {
    const res = await loginFn({ data: { username, password } });
    if (res.ok && res.token) {
      storeToken(res.token);
      setToken(res.token);
      setSignedIn(true);
      setState(null);
      return null;
    }
    return res.error || "Log in failed.";
  };

  // ---- THE FALL: leaving the height (opening-prologue-spec §3) ----
  // The height is its own seat in the account, so "leave" is a plain hand-back
  // to a colony of the player's own. If they have no other colony yet they
  // simply stay where they are — the button can never strand anyone.
  const doLeaveAct1 = async (): Promise<void> => {
    sound.click();
    const res = await leaveActOneFn({ data: { token: token! } }).catch(() => null);
    if (!res) { flash("Failed to reach the server."); return; }
    if (res.signedOut) { localLogout(); return; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? null);
      setTab("colony");
      sound.success();
      flash("Back at your colony.");
      return;
    }
    flash(res.error || "Could not leave the field.");
  };
  // ---- Games modal actions (return server-side error string or null = ok) ----

  const doCreate = async (name: string, race: RaceId): Promise<string | null> => {
    sound.click();
    const res = await createGameFn({ data: { token: token!, name, race } }).catch(() => null);
    if (!res) return "Failed to reach the server.";
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? null);
      setGamesOpen(false);
      sound.success();
      return null;
    }
    return res.error || "Could not found the colony.";
  };

  const doSwitch = async (gameId: string): Promise<string | null> => {
    sound.click();
    const res = await switchGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return "Failed to reach the server.";
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? gameId);
      setGamesOpen(false);
      sound.success();
      return null;
    }
    return res.error || "Could not switch colonies.";
  };

  const doReset = async (gameId: string): Promise<string | null> => {
    const res = await resetGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return "Failed to reach the server.";
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      prevStateRef.current = null;
      setState(res.state);
      setActiveGameId(gameId);
      setGamesOpen(false);
      sound.success();
      flash(`Colony wiped. Choose a new legend and name to found it again.`);
      return null;
    }
    return res.error || "Could not reset the colony.";
  };

  const doDelete = async (gameId: string): Promise<string | null> => {
    const res = await deleteGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return "Failed to reach the server.";
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok) {
      sound.success();
      await refresh();
      return null;
    }
    return res.error || "Could not delete the colony.";
  };

  const doTrash = async (u: string, p: string): Promise<string | null> => {
    const res = await trashAccountFn({ data: { token: token!, username: u, password: p } }).catch(() => null);
    if (!res) return "Failed to reach the server.";
    // Success always signs out.
    if (res.ok && res.signedOut) {
      localLogout();
      return null;
    }
    if (res.signedOut) { localLogout(); return null; }
    return res.error || "Could not delete the account.";
  };

  // Not yet resolved a persisted session.
  if (signedIn === null) {
    return (
      <div className="min-h-screen bg-[#070910] text-gray-200 flex items-center justify-center">
        <div className="animate-pulse text-xl">Waking the Cradle…</div>
      </div>
    );
  }

  // Signed out — show sign-up / login.
  if (signedIn === false) {
    return <AuthScreen busy={busy} onSignup={doSignup} onLogin={doLogin} />;
  }

  // Signed in but has no active game:
  //  - no colonies at all  → first-run "Found a Colony" (race select)
  //  - colonies exist but none active → colony picker screen
  if (!state) {
    if (!games || games.length === 0) {
      return (
        <div className="min-h-screen bg-[#070910] text-gray-200">
          <RaceSelect busy={busy} username={username} onStart={(name, race) => { if (!token) return; doCreate(name, race); }} />
          {firstRunNotice && <FirstRunNudge onDismiss={dismissNudge} />}
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#070910] text-gray-200">
        {firstRunNotice && <FirstRunNudge onDismiss={dismissNudge} />}
        <GamesPanel
          forced
          games={games}
          activeGameId={activeGameId}
          username={username}
          busy={busy}
          onPlay={doSwitch}
          onReset={doReset}
          onDelete={doDelete}
          onCreate={doCreate}
          onTrash={doTrash}
          flash={flash}
        />
        {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      </div>
    );
  }

  // A Reset wiped this game's progress back to the race-selection screen: the
  // slot still exists but has no race yet — pick a NEW race AND name for it.
  if (state && !state.race) {
    return (
      <div className="min-h-screen bg-[#070910] text-gray-200">
        {firstRunNotice && <FirstRunNudge onDismiss={dismissNudge} />}
        <RaceSelect busy={busy} username={null} resetNote
          onStart={(name, race) => { if (!token) return; doCreate(name, race); }} />
        {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      </div>
    );
  }

  const activeSummary = games?.find((g) => g.gameId === state.gameId);
  // Nav badges come from the closed predicate list (game/nav-badges.ts) — a dot
  // always means "an action is available here", never a notification (§1.3).
  const badges = navBadges(state, tab);
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      {tab === "circuit" ? (
        <CircuitPage
          state={state}
          token={token!}
          onClose={() => { switchTab("colony"); requestAnimationFrame(() => document.getElementById("nav-tab-circuit")?.focus()); }}
          muted={muted}
          onToggleMute={toggleMute}
          onToggleFullscreen={toggleFullscreen}
        onSettings={() => { setCradleOpen(false); setSettingsOpen(true); }}
          isFullscreen={isFullscreen}
          onLedger={() => { setLedgerOpen(true); sound.click(); }}
          unread={Math.max(0, reports.length - reportsSeen)}
          onReports={() => { setReportsSeen(reports.length); setReportOpen(true); sound.click(); }}
        />
      ) : (
        <>
      <AppShell
        state={state}
        tab={tab}
        isWide={isWide}
        unread={Math.max(0, reports.length - reportsSeen)}
        busy={busy}
        badges={badges}
        onSwitch={switchTab}
        onIdentity={() => { setCradleOpen(true); sound.click(); }}
        onLedger={() => { setLedgerOpen(true); sound.click(); }}
        onReports={() => { setReportsSeen(reports.length); setReportOpen(true); sound.click(); }}
        onOpenStores={() => { setCradleOpen(true); sound.click(); }}
        onAlertGo={() => switchTab("colony")}
      >
      {firstRunNotice && tab !== "battles" && <FirstRunNudge onDismiss={dismissNudge} />}
      {toast && <div className="fixed bottom-[calc(var(--spacing-nav)+var(--dock-h,0px)+env(safe-area-inset-bottom)+12px)] left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      {tab === "colony" && (
        <CradleScreen
          state={state}
          onPurify={(n) => act(() => purifyFn({ data: { token: token!, spend: n } }), "purify")}
          onCraft={(k) => act(() => craftFn({ data: { token: token!, kind: k } }), "success")}
          onClaim={() => act(() => claimDailyRewardFn({ data: { token: token! } }), "success")}
          onDeploy={(d) => act(() => deployFn({ data: { token: token!, domain: d } }), "deploy")}
          onOpenCodex={() => { setCodexOpen(true); sound.tab(); }}
          onForgeRoll={(recipeId, requestId) => act(() => forgeRollFn({ data: { token: token!, recipeId, requestId } }), "build")}
          onForgeMelt={(itemId) => act(() => forgeMeltFn({ data: { token: token!, itemId } }), "success")}
          forgeBusy={busy}
          onField={() => switchTab("battles")}
          onLeaveHeight={doLeaveAct1}
          canLeaveHeight={!!games?.some((g) => g.gameId !== state.gameId && !!g.race)}
        />
      )}
      {tab === "expeditions" && <ExpeditionTab state={state} now={now} onLaunch={(z, s) => act(() => launchFn({ data: { token: token!, zoneId: z, scientists: s } }), "launch")} onFlash={flash} onPrepare={() => { setTab("colony"); sound.tab(); }} />}
      {tab === "armory" && <ArmoryTab state={state} now={now} busy={busy} onBuild={(f) => act(() => weaponBuildFn({ data: { token: token!, familyId: f } }), "build")} onRefine={() => act(() => refinePlasmaFn({ data: { token: token! } }), "refine")} onForgeMelt={(itemId) => act(() => forgeMeltFn({ data: { token: token!, itemId } }), "success")} />}
      {tab === "battles" && (
        <BattlesTab
          state={state}
          now={now}
          token={token ?? undefined}
          onDecision={() => { void refresh(); }}
          muted={muted}
        />
      )}
      {tab === "lab" && <LabTab state={state} now={now} onStudy={(k) => act(() => studyFn({ data: { token: token!, kind: k } }), "study")} onDeploy={(d) => act(() => deployFn({ data: { token: token!, domain: d } }), "deploy")} onBeginResearch={(t, l) => act(() => beginResearchFn({ data: { token: token!, techId: t, leaderId: l } }), "research")} onAllocatePoint={(lid, attr) => act(() => allocateLeaderPointFn({ data: { token: token!, leaderId: lid, attr } }), "success")} onChooseSpec={(lid, path) => act(() => chooseSpecializationFn({ data: { token: token!, leaderId: lid, path } }), "success")} onChooseRevelation={(c) => act(() => chooseRevelationFn({ data: { token: token!, choice: c } }), "success")} />}
      </AppShell>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </>
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {codexOpen && <CodexModal onClose={() => { setCodexOpen(false); sound.tab(); }} />}
      <CradleSheet
        state={state}
        open={cradleOpen}
        onClose={() => { setCradleOpen(false); sound.click(); }}
        muted={muted}
        isFullscreen={isFullscreen}
        onToggleMute={toggleMute}
        onToggleFullscreen={toggleFullscreen}
        onSettings={() => { setCradleOpen(false); setSettingsOpen(true); }}
        onHelp={() => { setCradleOpen(false); setHelpOpen(true); }}
        onFeedback={() => { setCradleOpen(false); setFeedbackOpen(true); sound.click(); }}
        onGames={() => { setCradleOpen(false); setGamesOpen(true); sound.click(); }}
        onLogout={doLogout}
      />
      {state && (
        <StorefrontOverlay
          state={state}
          open={ledgerOpen}
          onClose={() => { setLedgerOpen(false); sound.click(); }}
          accountId={username}
          purchaseReturn={purchaseReturnView}
        />
      )}
      {feedbackOpen && <FeedbackModal token={token!} colonyName={state.playerName} onClose={() => setFeedbackOpen(false)} flash={flash} />}
      <ReportsSheet open={reportOpen} onClose={() => { setReportOpen(false); sound.click(); }} reports={reports} />
      {gamesOpen && (
        <GamesModal
          games={games ?? (activeSummary ? [activeSummary] : [])}
          activeGameId={activeGameId}
          username={username}
          busy={busy}
          onClose={() => { setGamesOpen(false); sound.click(); }}
          onPlay={doSwitch}
          onReset={doReset}
          onDelete={doDelete}
          onCreate={doCreate}
          onTrash={doTrash}
          flash={flash}
        />
      )}
    </div>
  );
}

/* ---------------- Sign up / Log in ---------------- */

function AuthScreen({ busy, onSignup, onLogin }: {
  busy: boolean;
  onSignup: (u: string, p: string) => Promise<string | null>;
  onLogin: (u: string, p: string) => Promise<string | null>;
}) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    if (username.trim().length < 2) { setError(t("auth.nameError")); return; }
    if (password.length < 4) { setError(t("auth.passwordError")); return; }
    setSubmitting(true);
    const err = mode === "signup" ? await onSignup(username, password) : await onLogin(username, password);
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen bg-[#070910] text-gray-200 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80">{t("app.name")}</p>
        <h1 className="mt-2 text-center text-3xl font-bold text-white">
          {mode === "signup" ? t("auth.foundColony") : t("auth.returnToCradle")}
        </h1>
        <p className="mt-2 text-center text-sm text-gray-400">
          {mode === "signup"
            ? t("auth.subSignup")
            : t("auth.subLogin")}
        </p>

        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 p-1 flex">
          {(["signup", "login"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === m ? "bg-ember text-black" : "text-gray-400 hover:bg-white/10"
              }`}
            >
              {m === "signup" ? t("auth.tabSignup") : t("auth.tabLogin")}
            </button>
          ))}
        </div>

        <label className="mt-6 block">
          <span className="block text-xs text-gray-400 mb-1">{t("auth.colonyName")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400"
            placeholder="e.g. The Emberhold"
          />
        </label>
        <label className="mt-3 block">
          <span className="block text-xs text-gray-400 mb-1">{t("auth.password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400"
            placeholder={mode === "signup" ? t("auth.passwordPlaceholderSignup") : t("auth.passwordPlaceholderLogin")}
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={submit}
          disabled={busy || submitting}
          className="mt-6 w-full rounded-lg bg-ember px-6 py-2.5 font-semibold text-black hover:brightness-110 disabled:opacity-40"
        >
          {mode === "signup" ? t("auth.submitSignup") : t("auth.submitLogin")}
        </button>

        <p className="mt-4 text-center text-[11px] text-text-3">
          Your password is hashed (scrypt) and never stored in plain text. This is a lightweight MVP — use a password you don't reuse elsewhere.
        </p>
      </div>
    </div>
  );
}

/* ---------------- How to Play modal ---------------- */

function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const t = useT();
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto max-w-lg rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t("help.title")}</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("help.close")}</button>
        </div>
        <div className="mt-3 space-y-3 text-sm text-gray-300">
          <p><b className="text-amber-200">1 · Send Explorations</b> — fund teams into the Shatterlands (Exploration tab) to salvage <b className="text-amber-200">Embers</b> and rare <b className="text-cyan-300">Chipsets</b>. Exports run in real time; they keep going even logged out.</p>
          <p><b className="text-amber-200">2 · Study in the Lab</b> — scientists study the fragments over real time to distill <b className="text-ember-soft">insight</b>.</p>
          <p><b className="text-amber-200">3 · Deploy recovered AI</b> — spend Embers + insight to advance five domains: ⚔️ Weaponry, 🌾 Agriculture, 💰 Economy, ⚙️ Industry, 🚚 Logistics. Each grants passive bonuses.</p>
          <p><b className="text-amber-200">4 · Push deeper</b> — growth funds riskier explorations. Watch your ☣️ taint and 🔺 Chorus — high taint dulls salvage; Purify it in the Colony tab. Hover any icon for details.</p>
          <p><b className="text-amber-200">5 · The deep needs gear</b> — deep radiation sites sit in the ☢️ Hangar: suits let you EXPLORE, alloy-armed diggers (forged in the 🏭 Workshop from 5 race materials) let you EXTRACT. Under-geared runs show a pre-launch risk pop-up — you are always free to go, and you own what you risk.</p>
          <p><b className="text-amber-200">Multiple colonies</b> — the <b className="text-gray-200">Games</b> button in the header lets you found new colonies, switch active ones, reset a game (all the way back to race selection, to pick a new legend and name), or delete it. The whole account (all colonies) can be removed from the Account section.</p>
          <p className="text-xs text-text-3">This is a colony-sim MVP on a persistent world that lives on in real time — a long game, not a click-session.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- First-Run nudge (beta feedback) ---------------- */
function FirstRunNudge({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="fixed top-[calc(var(--spacing-ribbon)+8px)] left-1/2 -translate-x-1/2 z-[60] w-[min(94vw,44rem)] rounded-xl border border-amber-400/40 bg-[#0b0e16]/95 px-4 py-3 shadow-2xl flex items-center gap-3 backdrop-blur">
      <span className="text-xl">🛰️</span>
      <div className="flex-1 text-sm text-amber-100">
        <b>{t("nudge.line")}</b>
        <span className="text-gray-400"> {t("nudge.sub")}</span>
      </div>
      <button onClick={onDismiss} className="shrink-0 rounded border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/10">{t("nudge.gotIt")}</button>
    </div>
  );
}
/* ---------------- Feedback modal ---------------- */
const FEED_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "🐞 Bug",
  flow_issue: "🔄 Flow issue",
  feature_suggestion: "💡 Suggestion",
};
const FEED_SEVERITY_LABEL: Record<FeedbackSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
function FeedbackModal({ token, colonyName, onClose, flash }: {
  token: string; colonyName: string; onClose: () => void; flash: (m?: string) => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [severity, setSeverity] = useState<FeedbackSeverity | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [playerName, setPlayerName] = useState(colonyName);
  const [records, setRecords] = useState<FeedbackRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const loadRecords = useCallback(async () => {
    const res = await listMyFeedbackFn({ data: { token } }).catch(() => null);
    if (res && res.ok && res.records) setRecords(res.records);
  }, [token]);
  useEffect(() => {
    loadRecords();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [loadRecords, onClose]);
  const t = useT();
  const doSubmit = async () => {
    // NOT `t` — the lookup above owns that name in this component.
    const titleText = title.trim();
    const d = description.trim();
    if (!titleText) { setError("Please give your report a title."); return; }
    if (titleText.length > 80) { setError("Title must be 80 characters or fewer."); return; }
    if (d.length < 10) { setError("Description needs at least 10 characters — a little more detail helps."); return; }
    if (d.length > 2000) { setError("Description must be 2000 characters or fewer."); return; }
    if (category === "bug" && !severity) { setError("Pick a severity for the bug."); return; }
    setSubmitting(true); setError(null);
    const res = await submitFeedbackFn({
      data: {
        token, category,
        title: titleText, description: d,
        playerName: playerName.trim() || undefined,
        severity: category === "bug" && severity ? severity : undefined,
      },
    }).catch(() => null);
    setSubmitting(false);
    if (!res) { setError("Could not reach the server — please try again."); return; }
    if (res.signedOut) { onClose(); flash("Session expired — please log in again."); return; }
    if (!res.ok) { setError(res.error || "Could not submit your report."); return; }
    setTitle(""); setDescription(""); setSeverity("");
    flash("Feedback sent — thank you. The team reads every report.");
    sound.success();
    loadRecords();
  };
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">💬 Feedback</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("help.close")}</button>
        </div>
        <p className="mt-1 text-xs text-text-3">This is the first world — tell us what broke or what you'd like to see. Reports go straight to the dev team.</p>
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Category</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["bug", "flow_issue", "feature_suggestion"] as const).map((c) => (
                <button key={c} type="button" onClick={() => { setCategory(c); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${category === c ? "border-amber-400/60 bg-amber-400/10 text-amber-200" : "border-white/15 text-gray-300 hover:bg-white/10"}`}>{FEED_CATEGORY_LABEL[c]}</button>
              ))}
            </div>
          </div>
          {category === "bug" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Severity <span className="text-text-3">(required)</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["low", "medium", "high", "critical"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => { setSeverity(s); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${severity === s ? "border-red-400/60 bg-red-400/10 text-red-200" : "border-white/15 text-gray-300 hover:bg-white/10"}`}>{FEED_SEVERITY_LABEL[s]}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-400"><span>Title</span><span className="text-text-3">{title.length}/80</span></div>
            <input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} maxLength={80} placeholder="Short summary, e.g. Exploration stuck at 100%"
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-400"><span>Description</span><span className="text-text-3">{description.length}/2000</span></div>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setError(null); }} rows={4} placeholder="What happened? What did you expect? (10+ characters)"
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Player / Colony (optional)</div>
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={64} placeholder="Who filed this?"
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          {error && <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
          <button onClick={doSubmit} disabled={submitting} className="w-full rounded-lg bg-ember px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50">
            {submitting ? "Sending…" : "Send Feedback"}
          </button>
        </div>
        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your submissions</div>
          {records === null ? (
            <p className="mt-2 text-xs text-text-3">Loading…</p>
          ) : records.length === 0 ? (
            <p className="mt-2 text-xs text-text-3">Nothing yet. Reports you send will appear here.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {records.map((r) => (
                <li key={r.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-200">{FEED_CATEGORY_LABEL[r.category]}{r.severity ? ` · ${FEED_SEVERITY_LABEL[r.severity]}` : ""}</span>
                    <span className="text-xs text-text-3">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-200">{r.title}</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-xs text-gray-400">{r.description}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-text-3">status: {r.status}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Race selection (first colony / full-screen) ---------------- */

function RaceSelect({ busy, username, onStart, resetNote }: { busy: boolean; username: string | null; onStart: (name: string, race: RaceId) => void; resetNote?: boolean }) {
  const [name, setName] = useState(username ? `${username}'s Colony` : "The Emberhold");
  const [selected, setSelected] = useState<RaceId>(worldAllowedRaces()[0] ?? "watchers");
  const race = getRace(selected);
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80">{resetNote ? "A Colony Reborn" : "Founding a Colony"}</p>
        <h1 className="mt-2 text-center text-3xl md:text-4xl font-bold text-white">Choose Your Legend</h1>
        {resetNote && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-100">
            This colony was <b>Reset</b>. Its progress is gone forever. Found it anew with a <b className="text-amber-200">fresh legend <em>and</em> a fresh name</b> — or close the browser to leave the slot empty.
          </div>
        )}
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-400 text-sm">
          Seven races are told around the ember-fires of the Shatterlands. These are <span className="text-amber-200">legends the colonies believe</span> about the world that burned — not records of fact. Each race is incomplete alone; to become whole, you will venture into the others' territories and salvage <em>their</em> AI.
        </p>

        <div className="mt-2 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-center text-xs text-gray-400">
          Codex fiction — in-game mythology only. Nothing here refers to any real-world group, religion, nationality, or person.
        </div>

        {WORLD_CONFIG_PUBLIC.raceLock && (
          <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-purple-400/40 bg-purple-400/10 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-white">
              🌍 {WORLD_CONFIG_PUBLIC.worldName}
              {WORLD_CONFIG_PUBLIC.debugWorld && (
                <span className="ms-2 rounded bg-purple-400/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-purple-200">Beta Test World</span>
              )}
            </p>
            <p className="mt-1 text-xs text-purple-100/80">{WORLD_CONFIG_PUBLIC.tagline}</p>
          </div>
        )}

        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {worldAllowedRaces().map((rid) => {
            const r = getRace(rid);
            return (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`text-start rounded-xl border p-4 transition ${
                selected === r.id ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-white/5 hover:border-white/30"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-white">{r.name}</span>
                <span className="text-xs text-gray-400">{r.title}</span>
              </div>
              <p className="mt-1 text-sm text-gray-300">{r.blurb}</p>
            </button>
          );
          })}
          {/* locked Unbound preview */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 opacity-70">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold text-amber-200">The Unbound</span>
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">Earned</span>
            </div>
            <p className="mt-1 text-sm text-gray-300">{UNBOUND_LEGEND.blurb}</p>
            <p className="mt-2 text-xs text-text-3">
              Not pickable at start. The Unbound are a rare, ascended inner circle earned only through a long track of
              special missions and badges of honor — the proof that a colony can rebuild without being rebuilt by what it used.
            </p>
          </div>
        </div>

        {/* selected race detail */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold text-white">{race.name}</h2>
            <span className="text-sm text-gray-400">{race.title}</span>
            <span className="ms-auto text-xs text-text-3">Home region: <span className="text-gray-300">{race.homeRegion}</span></span>
          </div>
          <p className="mt-3 leading-relaxed text-gray-300 text-sm">{race.lore}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {race.attributes.map((a) => (
              <span key={a.label} className={`rounded-full px-3 py-1 text-xs font-medium ${
                a.kind === "strength" ? "bg-ember/10 text-ember-soft border border-ember/30"
                : a.kind === "weakness" ? "bg-red-400/10 text-red-300 border border-red-400/30"
                : a.kind === "future" ? "bg-sky-400/10 text-sky-300 border border-dashed border-sky-400/40"
                : "bg-purple-400/10 text-purple-300 border border-purple-400/30"
              }`}>
                {a.label}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-text-3">
              Live engine bonuses <span className="normal-case tracking-normal">— wired into the current build</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {raceModLines(race).map((b) => (
                <span key={b.label} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  b.good ? "bg-ember/10 text-ember-soft border-ember/30"
                         : "bg-rose-400/10 text-rose-300 border-rose-400/30"
                }`}>
                  {b.label}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-3">
              Sky-blue dashed pills (e.g. warfare, stealth, defense, diplomacy) arrive with the combat &amp; survival
              layer — they are not playable in this beta build yet.
            </p>
          </div>
          <blockquote className="mt-4 border-s-2 border-amber-400/60 ps-4 text-amber-200/90 italic">{race.flavorQuote}</blockquote>

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1">
              <span className="block text-xs text-gray-400 mb-1">Name your colony (The Cradle)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400"
              />
            </label>
            <button
              onClick={() => onStart(name, selected)}
              disabled={busy}
              className="rounded-lg bg-ember px-6 py-2.5 font-semibold text-black hover:brightness-110 disabled:opacity-40"
            >
              Found The Cradle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the frame ----------------
   The old web <header> (identity block, five emoji resource chips, the mute /
   full screen / feedback / help / games / logout cluster, the ☣️/🔺 nav row and
   its second navigation) is GONE — deleted in the same commit that landed the
   ribbon, the bottom nav and the Cradle sheet. Every control it held lives on:
   resources + Ledger + reports in the ribbon, the rest in the Cradle sheet
   (game-ui-shell-spec §1.4). There is exactly one navigation now. */

/* ---------------- reports sheet (owner 2026-09-13) ---------------- */

interface ReportItem { id: number; text: string; ts: number; }

function ReportsSheet({ open, onClose, reports }: { open: boolean; onClose: () => void; reports: ReportItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="reports-title" title="Cradle Reports">
      <SheetHeader id="reports-title" title="Cradle Reports" subtitle="what came home while you watched — newest first" onClose={onClose} />
      <div className="sheet-body px-4 py-3 md:px-5">
        {reports.length === 0 ? (
          <p className="text-sm text-text-3">Nothing new — every work the Cradle sent out is still in flight.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surf-2/60 px-3 py-2 text-xs leading-relaxed text-text-2">
                {r.text}
                <span className="num mt-1 block text-[11px] text-text-3">{new Date(r.ts).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- Games modal / panel ---------------- */

function GamesModal({ games, activeGameId, username, busy, onClose, onPlay, onReset, onDelete, onCreate, onTrash, flash }: {
  games: GameSummary[]; activeGameId: string | null; username: string | null; busy: boolean;
  onClose: () => void; onPlay: (id: string) => Promise<string | null>; onReset: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>; onCreate: (n: string, r: RaceId) => Promise<string | null>;
  onTrash: (u: string, p: string) => Promise<string | null>; flash: (m?: string) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const t = useT();
  return (
    <div className="fixed inset-0 z-[70] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Your Colonies</h2>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("help.close")}</button>
        </div>
        <GamesPanel
          forced={false}
          games={games}
          activeGameId={activeGameId}
          username={username}
          busy={busy}
          onPlay={onPlay}
          onReset={onReset}
          onDelete={onDelete}
          onCreate={onCreate}
          onTrash={onTrash}
          flash={flash}
        />
      </div>
    </div>
  );
}

function GamesPanel({ forced, games, activeGameId, username, busy, onPlay, onReset, onDelete, onCreate, onTrash, flash }: {
  forced: boolean; games: GameSummary[]; activeGameId: string | null; username: string | null; busy: boolean;
  onPlay: (id: string) => Promise<string | null>; onReset: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>; onCreate: (n: string, r: RaceId) => Promise<string | null>;
  onTrash: (u: string, p: string) => Promise<string | null>; flash: (m?: string) => void;
}) {
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const neverMind = () => { setConfirmResetId(null); setConfirmDeleteId(null); setTrashOpen(false); sound.click(); };

  return (
    <div className={forced ? "mx-auto max-w-3xl px-6 py-10" : "mt-4"}>
      {forced && (
        <>
          <p className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80">Your Colonies</p>
          <h1 className="mt-1 text-center text-3xl font-bold text-white">Choose a Colony</h1>
          <p className="mt-2 text-center text-sm text-gray-400">You have colonies, but none are active. Pick one to resume, found a new one, or manage them below.</p>
        </>
      )}

      {/* 1 · Your colonies */}
      <section className="mt-6">
        <h3 className="font-semibold text-white">Your colonies <span className="text-xs font-normal text-text-3">({games.length}/5)</span></h3>
        {games.length === 0 ? (
          <p className="mt-2 text-sm text-text-3">No colonies yet. Found your first below.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {games.map((g) => {
              const race = g.race ? getRace(g.race) : null;
              const isActive = g.gameId === activeGameId;
              const isConfirmingReset = confirmResetId === g.gameId;
              const isConfirmingDelete = confirmDeleteId === g.gameId;
              return (
                <div key={g.gameId} className={`rounded-xl border p-4 ${isActive ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-black/30"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white truncate">{g.name}</span>
                        {isActive && <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">Active</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        {race ? `${race.name} · ${race.homeRegion}` : "—"} · found {new Date(g.createdAt).toLocaleDateString()}
                      </div>
                      <div className="mt-1 text-xs text-text-3">{g.summary}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isActive && (
                        <button onClick={() => onPlay(g.gameId)} disabled={busy} className="rounded-lg bg-ember px-3 py-2 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40">Play</button>
                      )}
                      <button onClick={() => { setConfirmDeleteId(null); setConfirmResetId(isConfirmingReset ? null : g.gameId); sound.click(); }} disabled={busy} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-300 hover:bg-white/10">Reset</button>
                      <button onClick={() => { setConfirmResetId(null); setConfirmDeleteId(isConfirmingDelete ? null : g.gameId); sound.click(); }} disabled={busy} className="rounded border border-red-400/30 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10">Delete</button>
                    </div>
                  </div>
                  {isConfirmingReset && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <ResetConfirm game={g} onCancel={neverMind} onConfirm={async () => { const err = await onReset(g.gameId); if (err) { flash(err); sound.error(); } }} />
                    </div>
                  )}
                  {isConfirmingDelete && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <DeleteConfirm game={g} onCancel={neverMind} onConfirm={async () => { const err = await onDelete(g.gameId); if (err) { flash(err); sound.error(); } else { setConfirmDeleteId(null); } }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2 · Found a New Colony */}
      <section className="mt-8">
        <h3 className="font-semibold text-white">Found a New Colony <span className="text-xs font-normal text-text-3">— a new game: one race, one colony</span></h3>
        {games.length >= 5 ? (
          <p className="mt-2 text-sm text-amber-200/80">You've reached the maximum of 5 colonies. Delete one to found another.</p>
        ) : (
          <InlineFoundColony busy={busy} onCreate={onCreate} flash={flash} />
        )}
      </section>

      {/* 3 · Account */}
      <section className="mt-8 rounded-xl border border-red-400/20 bg-red-400/5 p-4">
        <h3 className="font-semibold text-red-200">Account</h3>
        <p className="mt-1 text-xs text-gray-400">Signed in as <b className="text-gray-200">{username || "…"}</b>. Deleting your account permanently removes <b className="text-red-200">all {games.length} colon{games.length === 1 ? "y" : "ies"}</b> and the account itself. This cannot be undone.</p>
        {!trashOpen ? (
          <button onClick={() => { setTrashOpen(true); sound.click(); }} disabled={busy} className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-400/20 disabled:opacity-40">Delete entire account…</button>
        ) : (
          <TrashConfirm username={username} onCancel={neverMind} onConfirm={onTrash} flash={flash} />
        )}
      </section>
    </div>
  );
}

/* Inline "found a new colony" race picker (reuses the race-select flow). */
function InlineFoundColony({ busy, onCreate, flash }: { busy: boolean; onCreate: (n: string, r: RaceId) => Promise<string | null>; flash: (m?: string) => void }) {
  const [name, setName] = useState("The Emberhold");
  const [selected, setSelected] = useState<RaceId>(worldAllowedRaces()[0] ?? "watchers");
  const race = getRace(selected);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-wrap gap-2">
        {worldAllowedRaces().map((rid) => {
          const r = getRace(rid);
          return (
          <button key={r.id} onClick={() => { setSelected(r.id); sound.click(); }} className={`rounded-lg px-3 py-2 text-xs font-medium ${selected === r.id ? "bg-ember text-black" : "border border-white/15 text-gray-300 hover:bg-white/10"}`}>
            {r.name}
          </button>
        );
        })}
      </div>
      {WORLD_CONFIG_PUBLIC.raceLock && (
        <p className="mt-2 rounded border border-purple-400/30 bg-purple-400/10 px-2 py-1.5 text-xs text-purple-100/90">
          🌍 {WORLD_CONFIG_PUBLIC.worldName} is the {worldLockPlain()} debug world — only {worldLockPlain()} colonies can be founded here.
        </p>
      )}
      <div className="mt-2 text-sm text-gray-400"><span className="font-semibold text-amber-200">{race.name}</span> — <span className="text-text-3">{race.blurb}</span></div>
      <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end">
        <label className="flex-1">
          <span className="block text-xs text-gray-400 mb-1">Name your colony</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400" />
        </label>
        <button onClick={async () => { const err = await onCreate(name, selected); if (err) { flash(err); sound.error(); } }} disabled={busy} className="rounded-lg bg-ember px-5 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
          Found The Cradle
        </button>
      </div>
    </div>
  );
}

/* 2-step reset confirm: checkbox + 3s countdown; extra warning when there's active content. */
function ResetConfirm({ game, onCancel, onConfirm }: { game: GameSummary; onCancel: () => void; onConfirm: () => void }) {
  const [checked, setChecked] = useState(false);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(3);
  useEffect(() => {
    const iv = setInterval(() => setCount((c) => Math.max(0, c - 1)), 1000);
    const to = setTimeout(() => setReady(true), 3000);
    return () => { clearInterval(iv); clearTimeout(to); };
  }, []);
  return (
    <div className="text-sm">
      <p className="text-amber-200"><b>Reset “{game.name}”?</b> This wipes all progress forever and returns you to the <b>race-selection screen to pick a NEW legend AND a new name</b> for this colony slot {game.race ? `(the current legend is ${getRace(game.race).name})` : ""}.</p>
      {game.activeContent && (
        <p className="mt-1 text-amber-300/90">⚠️ This colony has explorations or studies still in flight. They will be abandoned immediately.</p>
      )}
      <p className="mt-1 text-xs text-text-3">There is no fresh-colony-same-race shortcut anymore — a reset takes you all the way back to the start.</p>
      <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
        <span className="text-xs text-gray-400">I understand this destroys the current colony's progress forever and cannot be undone.</span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onConfirm} disabled={!ready || !checked} className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/20 disabled:opacity-40">
          {ready ? "Confirm Reset" : `Hold ${count}s`}
        </button>
        <button onClick={onCancel} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">Cancel</button>
      </div>
    </div>
  );
}

/* Delete confirm: must type the colony name to enable the red confirm. */
function DeleteConfirm({ game, onCancel, onConfirm }: { game: GameSummary; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const canConfirm = typed.trim() === game.name;
  return (
    <div className="text-sm">
      <p className="text-red-200"><b>Delete “{game.name}”?</b> This permanently removes this colony and its save. It cannot be recovered.</p>
      <p className="mt-1 text-xs text-gray-400">Type the colony's name to confirm:</p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={game.name} className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onConfirm} disabled={!canConfirm} className="rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-40">Permanently Delete</button>
        <button onClick={onCancel} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">Cancel</button>
      </div>
    </div>
  );
}

/* Trash account confirm: username + re-entered password (server-verified) + final checkbox. */
function TrashConfirm({ username, onCancel, onConfirm, flash }: { username: string | null; onCancel: () => void; onConfirm: (u: string, p: string) => Promise<string | null>; flash: (m?: string) => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [finalCk, setFinalCk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nameOk = u.trim().toLowerCase() === ((username || "").toLowerCase());
  const canConfirm = nameOk && p.length >= 4 && finalCk && !submitting;
  const submit = async () => {
    setSubmitting(true);
    const err = await onConfirm(u, p);
    setSubmitting(false);
    if (err) { flash(err); sound.error(); }
    // on success the account is signed out and this panel unmounts
  };
  return (
    <div className="mt-3 text-sm">
      <p className="text-red-200 font-semibold">This permanently deletes your account and every colony on it.</p>
      <p className="mt-1 text-xs text-gray-400">Your password is verified on the server before anything is deleted.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Username</span>
          <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" placeholder={username || "your username"} className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Re-enter password</span>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
        </label>
      </div>
      {!nameOk && u.trim() !== "" && <p className="mt-2 text-xs text-red-400">That doesn't match this account's username.</p>}
      <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={finalCk} onChange={(e) => setFinalCk(e.target.checked)} className="mt-0.5" />
        <span className="text-xs text-gray-400">I understand this is permanent — the account, password, and all colonies will be destroyed.</span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={submit} disabled={!canConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40">
          {submitting ? "Deleting…" : "Delete Entire Account"}
        </button>
        <button onClick={onCancel} disabled={submitting} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">Cancel</button>
      </div>
    </div>
  );
}

/* ---------------- Daily to-do + Oracle Devotion (V7) ----------------
   Compact panel on the Colony tab (§5 sketch). Rows flip to done automatically
   (completion is server-derived from real events); the only interaction is the
   single Claim button. Quiet state = zero chrome. TD5: Devotion total + streak
   are PUBLIC; favor internals/Oracle thresholds never appear in any copy here
   (silence discipline — the tooltip mentions only the Oracle's watchfulness). */
function DevotionPanel({ state, onClaim }: { state: GameState; onClaim: () => void }) {
  const daily = state.daily;
  const list = daily?.list ?? [];
  const completed = daily?.completed ?? [];
  const claimed = daily?.claimed ?? [];
  const devotion = typeof state.devotion === "number" ? state.devotion : 0;
  const streak = typeof state.devotionStreak === "number" ? state.devotionStreak : 0;
  const quiet = !list || list.length === 0;
  const pending = completed.filter((id) => !claimed.includes(id));
  const allDone = list.length >= 1 && completed.length >= list.length;
  const pendingScrip = pending.length * 30 + (allDone && !daily?.bonusClaimed ? 80 : 0);
  const pendingDevotion = pending.length * 1 + (allDone && !daily?.bonusClaimed ? 3 : 0);
  return (
    <div className="mb-6 rounded-xl border border-purity/15 bg-black/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Tooltip content={tip({
          what: "Today's Devotion — a small daily practice, drawn from what the Cradle already does.",
          does: "Four optional acts; each banks +30 Scrip and +1 Devotion when you Claim. Finish the list for a +80 Scrip / +3 Devotion bonus. Devotion is the path the Oracles watch.",
          how: "Items complete themselves as you play — the only button is Claim. Work done but unclaimed banks forever; missed days punish nothing.",
        })}>
          <h3 className="font-semibold text-white">🕯️ Today's Devotion <span className="text-xs font-normal text-gray-400">({completed.length}/{list.length})</span></h3>
        </Tooltip>
        <div className="flex items-center gap-3 text-xs text-gray-300">
          <span>Devotion <b className="text-purity">{devotion}</b></span>
          {streak > 0 && <span title={`${streak} consecutive days of practice`}>🔥 <b className="text-purity">{streak}-day streak</b></span>}
        </div>
      </div>
      {quiet ? (
        <p className="mt-2 text-sm text-text-3">The Cradle asks nothing of you today.</p>
      ) : (
        <>
          <div className="mt-3 space-y-1.5">
            {list.map((id) => {
              const def = DAILY_ITEM_BY_ID[id as keyof typeof DAILY_ITEM_BY_ID];
              const done = completed.includes(id);
              const banked = claimed.includes(id);
              return (
                <div key={id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <span className={"w-4 text-center " + (done ? "text-ember-soft" : "text-text-3")}>{done ? "✓" : "○"}</span>
                  <span className={"text-[13px] " + (done ? "text-gray-100" : "text-gray-400")}>
                    {def?.icon ?? ""} {def?.label ?? id}
                    {done && banked && <span className="ms-1.5 text-[11px] uppercase tracking-wide text-ember-soft/80">claimed</span>}
                  </span>
                  <span className="ms-auto text-xs text-text-3">+30 · +1</span>
                </div>
              );
            })}
          </div>
          {allDone && <p className="mt-2 text-xs text-purity">🕯️ The day's devotion is complete — +80 bonus.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={onClaim}
              disabled={pendingScrip <= 0}
              className="rounded-lg bg-purity px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
            >
              {pendingScrip > 0 ? `Claim — ${pendingScrip} Scrip · ${pendingDevotion} Devotion` : "Claimed ✓"}
            </button>
            <p className="text-[11px] text-text-3">Daily devotion, long-term trust — the Oracle watches what you do, not what you buy.</p>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Colony tab ---------------- */

function ColonyTab({ state, onPurify, onCraft, onClaim }: { state: GameState; onPurify: (n: number) => void; onCraft: (k: CraftKind) => void; onClaim: () => void }) {
  const r = state.resources;
  const spm = engineHelpers.suppliesPerMinute(state);
  const recipe = alloyRecipeRaces(state); // 5 race ids when forgeable, else []
  const ownMat = state.race ? r.mats[state.race] : 0;
  // Rung 1a §E — Codex folds into the Cradle as the Lore modal.
  const [codexOpen, setCodexOpen] = useState(false);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* V7 — Daily to-do + Oracle Devotion (opt-in, never gated; TD5: total +
          streak public; favor internals never leave the server) */}
      <DevotionPanel state={state} onClaim={onClaim} />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/30 p-5">
          <h3 className="font-semibold text-white">Colony Health</h3>
          <div className="mt-3 space-y-2 text-sm">
            <Meter label="Corruption (taint)" value={state.corruption} danger={state.corruption > 50} tip={tip(METER_TIPS.corruption)} />
            <Meter label="Chorus Attention" value={state.chorusAttention} danger={state.chorusAttention > 50} tip={tip(METER_TIPS.chorus)} />
          </div>
          <Tooltip content={tip(LAB_TIPS.purify)}>
            <button onClick={() => onPurify(1)} disabled={r.supplies < 10} className="mt-4 w-full rounded-lg border border-purple-400/40 bg-purple-400/10 px-3 py-2 text-sm text-purple-200 hover:bg-purple-400/20 disabled:opacity-40">
              Purify the Cradle (10 📦)
            </button>
          </Tooltip>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-5 md:col-span-2">
          <h3 className="font-semibold text-white">The Cradle advances</h3>
          <p className="mt-1 text-xs text-gray-400">Deploy recovered AI to strengthen the colony. Supplies grow here while you're away: <b className="text-lime-300">+{spm.toFixed(1)}/min</b>.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DOMAINS.map((d) => {
              const lvl = state.deployedDomains[d.id];
              const bonus = engineHelpers.domainEffect(state, d.id);
              return (
                <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <Tooltip content={tip(DOMAIN_TIPS[d.id])}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{d.icon} {d.name}</span>
                      <span className="text-xs text-amber-300">Lv {lvl}</span>
                    </div>
                  </Tooltip>
                  <p className="mt-1 text-xs text-gray-400">{d.description}</p>
                  <p className="mt-1 text-xs text-ember-soft">{bonus}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Workshop — everyday gear & logistics + the forged alloy */}
      <div className="mt-6 rounded-xl border border-amber-400/20 bg-black/30 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-white">🏭 Workshop <span className="text-xs font-normal text-gray-400">— gear & logistics, forged with Supplies</span></h3>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Tooltip content={tip(RESOURCE_TIPS.medkit)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">🩺 <b className="text-white">{r.medkit}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.mechkit)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">🔧 <b className="text-white">{r.mechkit}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.armorkit)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">🛡️ <b className="text-white">{r.armorkit}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.skmech)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">👷 <b className="text-white">{r.skmech}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.gas)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">⛽ <b className="text-white">{r.gas}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.battery)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">🔋 <b className="text-white">{r.battery}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.hazmat)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">🧥 <b className="text-white">{r.hazmat}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.shots)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">💉 <b className="text-white">{r.shots}</b></span></Tooltip>
            <Tooltip content={tip(RESOURCE_TIPS.alloy)}><span className="rounded bg-white/5 px-2 py-0.5 text-gray-200">⚙️ <b className="text-white">{r.alloys}</b></span></Tooltip>
          </div>
        </div>

        {[
          { note: "Tier 0 · Step Out — gates fielding ANY exploration", kinds: ["medkit", "mechkit", "armorkit"] as CraftKind[] },
          { note: "Tier 1 · Outer & mild zones — radiation shots, skilled mechanics, fuel & battery", kinds: ["skmech", "gas", "battery", "shots"] as CraftKind[] },
          { note: "Tier 2 · Deep zones — suits let you EXPLORE, alloys let you EXTRACT", kinds: ["hazmat", "alloy"] as CraftKind[] },
        ].map((tier, ti) => (
          <div key={ti} className="mt-4">
            <p className="text-[11px] uppercase tracking-wider text-text-3">{tier.note}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tier.kinds.map((k) => {
                const def = CRAFT[k];
                const can = r.supplies >= def.supplies && (k !== "alloy" || canForgeAlloy(state));
                const desc = k === "alloy" && !canForgeAlloy(state)
                  ? `Missing the recipe — need ${ownMat >= 1 ? "own ✓" : "your own"} + ${4 - (recipe.length ? recipe.filter((rid) => rid !== state.race).length : 0)} more race materials.`
                  : def.description;
                return (
                  <div key={k} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <Tooltip content={tip({ what: def.label, does: def.description, how: `Costs ${def.supplies} 📦. ${k === "alloy" ? "Consumes 5 race materials (own + 4 others)." : k === "gas" || k === "battery" ? "Consumed each exploration you launch." : "Stacks in the colony stores."}` })}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{def.icon} {def.label}</span>
                        <span className="text-xs text-lime-300">{def.supplies} 📦</span>
                      </div>
                    </Tooltip>
                    <p className="mt-1 text-xs text-gray-400">{desc}</p>
                    <button onClick={() => onCraft(k)} disabled={!can} className="mt-2 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                      {k === "alloy" && !canForgeAlloy(state) ? "Recipe locked" : can ? "Forge" : `Need ${def.supplies} 📦`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* The alloy recipe — cross-race territory materials */}
        <div className="mt-4 rounded-lg border border-white/10 bg-black/40 p-3">
          <Tooltip content={tip(RESOURCE_TIPS.mats)}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-amber-200">🔑 Alloy recipe — 5 unique race materials</span>
              <span className="text-gray-400">your own + any 4 other races.</span>
              <span className={`ms-auto font-semibold ${canForgeAlloy(state) ? "text-ember-soft" : "text-gray-300"}`}>
                {canForgeAlloy(state) ? "✓ Recipe complete — forge an alloy" : `${recipe.length === 0 ? 1 : 1 + recipe.filter((rid) => rid !== state.race).length}/5 held`}
              </span>
            </div>
          </Tooltip>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RACES.map((race) => {
              const count = r.mats[race.id] ?? 0;
              const isOwn = state.race === race.id;
              const inRecipe = recipe.includes(race.id);
              return (
                <Tooltip key={race.id} content={tip({ what: `${race.name} territory material`, does: "A unique supply found only in their home region — part of the alloy recipe.", how: `Loot it by running Explorations into ${race.homeRegion}. ${isOwn ? "This is YOUR race's material." : "One of the 4 foreign materials needed."}` })}>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${inRecipe ? "border-ember/50 bg-ember/10 text-ember-soft" : count > 0 ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 bg-white/5 text-text-3"}`}>
                    {race.id === "grays" ? "👽" : race.id === "nephilim" ? "🗿" : race.id === "draconians" ? "🐉" : race.id === "anunnaki" ? "🏛️" : race.id === "ashtar" ? "⭐" : "📖"} {race.name.replace("The ", "")}{isOwn ? " (own)" : ""} ×{count}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-5">
        <h3 className="font-semibold text-white">Exploration Ledger <span className="text-xs text-text-3">({state.completedExpeditions} completed)</span></h3>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Stat label="Total Embers looted" value={state.totalEmbersLooted} />
          <Stat label="Total Chipsets looted" value={state.totalChipsetsLooted} />
          <Stat label="Insight distilled" value={Math.round(state.insight)} />
          <Stat label="Colony founded" value={new Date(state.createdAt).toLocaleDateString()} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => { setCodexOpen(true); sound.tab(); }}
        aria-haspopup="dialog"
        className="mt-6 flex w-full items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-start transition-colors hover:border-amber-400/60 hover:bg-amber-400/10"
      >
        <span className="text-lg" aria-hidden="true">📖</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-amber-200">Open the Codex — Legends of the Shatterlands</span>
          <span className="block text-xs text-text-3">the myths the colonies tell about the world that burned — fiction, worn as ways of life</span>
        </span>
        <span className="chip shrink-0 border border-amber-400/40 bg-amber-400/10 text-amber-200">{RACES.length + 1} legends</span>
      </button>
      <JournalButton title="Chronicle of the Cradle" subtitle="the world as the colony remembers it — newest first" log={state.log} />
      {codexOpen && <CodexModal onClose={() => { setCodexOpen(false); sound.tab(); }} />}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="text-xs text-text-3">{label}</div>
    </div>
  );
}

function Meter({ label, value, danger, tip: tooltip }: { label: string; value: number; danger: boolean; tip: ReactNode }) {
  const color = danger ? "bg-danger" : "bg-ember";
  return (
    <Tooltip content={tooltip}>
      <div>
        <div className="flex justify-between text-xs text-gray-400"><span>{label}</span><span className={danger ? "text-red-400" : ""}>{Math.round(value)}%</span></div>
        <div className="mt-1 h-2 rounded bg-white/10"><div className={"h-2 rounded " + color} style={{ width: `${value}%` }} /></div>
      </div>
    </Tooltip>
  );
}

/* ---------------- Expeditions tab ---------------- */

function ExpeditionTab({ state, now, onLaunch, onFlash, onPrepare }: {
  state: GameState; now: number; onLaunch: (zone: string, sci: number) => void;
  onFlash: (m?: string) => void; onPrepare: () => void;
}) {
  const t = useT();
  const [sel, setSel] = useState("outer-ruins");
  const [sci, setSci] = useState(1);
  const [riskZone, setRiskZone] = useState<Zone | null>(null);
  const active = state.expeditions.filter((e) => e.status === "out");
  const maxSlots = 1 + state.deployedDomains.logistics;
  const canLaunch = active.length < maxSlots;
  const stepOut = hasStepOutGear(state); // Tier 0 — gates fielding ANY expedition

  // Deep zones are visited through the hangar: they are visible-but-locked until
  // the colony owns enough hazmat for a single-scientist recon team (suits =
  // exploration key). Alloys (extraction key) are policed by the risk pop-up.
  const deepZones = ZONES.filter((z) => isDeepZone(z.radiationLevel));
  const mildZones = ZONES.filter((z) => !isDeepZone(z.radiationLevel));
  const accessibleDeep = deepZones.filter((z) => state.resources.hazmat >= Math.max(1, hazmatPerScientist(z.radiationLevel)));
  const accessible = [...mildZones, ...accessibleDeep];

  const commit = () => {
    const zone = getZone(sel);
    // Tier 0 stepping-out gear gates fielding ANY expedition.
    if (!stepOut) {
      onFlash("The Cradle hasn't stepped out yet. Forge a Medical kit, a Mechanics kit, and an Armor kit in the 🏭 Workshop (Colony tab) before any team leaves.");
      sound.error();
      return;
    }
    const cost = engineHelpers.suppliesCost(state, zone);
    if (state.resources.supplies < cost) {
      onFlash(`Not enough supplies. ${zone.name} needs ${cost} 📦, have ${Math.floor(state.resources.supplies)}.`);
      sound.error();
      return;
    }
    if (isDeepZone(zone.radiationLevel)) {
      setRiskZone(zone); // pre-launch risk pop-up governs deep runs
      sound.click();
      return;
    }
    onLaunch(sel, sci);
  };

  const goAnyway = () => {
    const zone = riskZone;
    setRiskZone(null);
    if (zone) onLaunch(zone.id, sci);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between">
        <h2 className="text-2xl font-bold text-white">{t("exp.title")}</h2>
        <p className="text-sm text-gray-400">Teams away: <b className="text-white">{active.length}/{maxSlots}</b> {!canLaunch && <span className="text-amber-300"> — deploy Logistics AI for more slots</span>}</p>
      </div>

      {/* active */}
      {active.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {active.map((e) => {
            const remain = e.startedAt + e.durationMs - now;
            const msLeft = Math.max(0, remain);
            const pct = Math.min(100, ((e.durationMs - msLeft) / e.durationMs) * 100);
            return (
              <div key={e.id} className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
                <div className="flex items-center justify-between">
                  <Tooltip content={tip({ what: "Active exploration — a team out in the Shatterlands.", does: "Runs in real time and resolves while you're away, returning Embers (and maybe a Chipset) to the Cradle.", how: "Returns automatically once the timer hits zero. Runs launched under-geared carry their accepted radiation loss." })}><span className="font-semibold text-amber-100">🚚 {e.label}</span></Tooltip>
                  <span className="text-xs text-gray-400">{e.assignedScientists} scientist(s){e.lossPct ? ` · ☢️ ${e.lossPct}%` : ""}</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{t("exp.returnsIn")} <b className="text-amber-200">{fmtDur(msLeft)}</b></p>
                <div className="mt-2 h-2 rounded bg-white/10"><div className="h-2 rounded bg-ember" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}

      {/* planning */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
        <h3 className="font-semibold text-white">{t("exp.plan")} <span className="text-xs font-normal text-gray-400">{t("exp.planSub")}</span></h3>
        {!stepOut && (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            🏗️ <b>The Cradle hasn't stepped out yet.</b> Fielding any exploration requires everyday logistics gear forged in the <b className="text-amber-200">🏭 Workshop</b> (Colony tab): a <b>Medical kit</b> 🩺, a <b>Mechanics kit</b> 🔧, and an <b>Armor kit</b> 🛡️ (Tier 0, ~18 📦 total). Forge all three before you Commit.
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-400">{t("exp.destination")}</label>
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-white outline-none focus:border-amber-400">
            {accessible.map((z) => <option key={z.id} value={z.id}>{z.name}{isDeepZone(z.radiationLevel) ? " ☢️" : ""}</option>)}
          </select>
          <Tooltip content={tip(LAB_TIPS.scientists)}><label className="text-xs text-gray-400">{t("exp.scientists")}</label></Tooltip>
          <input type="number" min={1} max={state.scientists} value={sci} onChange={(e) => setSci(Math.max(1, Math.min(state.scientists, Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-white/15 bg-black/60 px-2 py-2 text-white outline-none focus:border-amber-400" />
          <Tooltip content={tip({ what: "Commit Supplies — launch this exploration.", does: "Spends the destination's Supplies cost and sends your team out in real time. Deep zones open the pre-launch risk pop-up first. Farther sites also draw on the convoy's fuel & battery stores.", how: "Requires a stepped-out Cradle (Tier 0 kits), enough Supplies, a free field slot, and enough fuel/battery for the distance. Returns Embers (and maybe a Chipset) when it completes." })}>
            <button onClick={commit} disabled={!canLaunch} className="ms-auto rounded-lg bg-ember px-5 py-2 font-semibold text-black hover:brightness-110 disabled:opacity-40">
              Commit Supplies
            </button>
          </Tooltip>
        </div>
      </div>

      {/* zone list — mild zones */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {mildZones.map((z) => {
          const cost = engineHelpers.suppliesCost(state, z);
          const stats = engineHelpers.zoneProspects(state, z);
          const ownerRace = z.owner !== "shared" && z.owner !== "special" ? getRace(z.owner) : null;
          const owner = z.owner === "shared" ? "No race's home" : ownerRace ? `${ownerRace.name} territory` : "";
          const ownerTip = z.owner === "shared"
            ? OWNER_TIPS.shared
            : ownerRace
              ? { what: `${ownerRace.name} territory — a home region of the Shatterlands.`, does: "Rich in that race's own AI — embers, chipsets, and a UNIQUE territory material used in the alloy recipe. Every race is incomplete alone.", how: `Reach this region to loot ${ownerRace.name} embers + their territory material alongside the site's base yield.` }
              : OWNER_TIPS.shared;
          return (
            <div key={z.id} className={`rounded-xl border p-4 ${sel === z.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30"}`} onClick={() => { setSel(z.id); sound.tab(); }}>
              <div className="flex items-baseline justify-between gap-2">
                <Tooltip content={tip({ what: z.name, does: z.flavor, how: "Select it above and Commit Supplies to send a team here." })}><span className="font-semibold text-white cursor-pointer">{z.name}</span></Tooltip>
                <Tooltip content={tip(ownerTip)}><span className="text-[11px] uppercase text-text-3">{owner}</span></Tooltip>
              </div>
              <p className="mt-1 text-xs text-gray-400">{z.flavor}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <Tooltip content={tip(EXPEDITION_TIPS.risk)}><span className="rounded bg-white/5 px-2 py-0.5 text-red-300">Risk {z.risk}</span></Tooltip>
                <Tooltip content={tip(EXPEDITION_TIPS.radiation)}><span className={`rounded px-2 py-0.5 ${z.radiationLevel > 0 ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-gray-400"}`}>☢️ {z.radiationLevel}</span></Tooltip>
                {z.radiationLevel >= 20 && z.radiationLevel < DEEP && (
                  <Tooltip content={tip(EXPEDITION_TIPS.radiation)}><span className="rounded bg-amber-400/10 px-2 py-0.5 text-amber-300/90">⚠️ mild radiation — recovery possible but thin without shots</span></Tooltip>
                )}
                {ownerRace && <Tooltip content={tip(RESOURCE_TIPS.mats)}><span className="rounded bg-white/5 px-2 py-0.5 text-purple-300">◈ material: {ownerRace.name.replace("The ", "")}</span></Tooltip>}
                <Tooltip content={tip(EXPEDITION_TIPS.embers)}><span className="rounded bg-white/5 px-2 py-0.5 text-amber-200">~{stats.embers} Embers</span></Tooltip>
                <Tooltip content={tip(EXPEDITION_TIPS.chipset)}><span className="rounded bg-white/5 px-2 py-0.5 text-cyan-300">Chipset {Math.round(stats.chipsetChance * 100)}%</span></Tooltip>
                <Tooltip content={tip(EXPEDITION_TIPS.cost)}><span className="rounded bg-white/5 px-2 py-0.5 text-lime-300">Cost {cost} 📦</span></Tooltip>
              </div>
            </div>
          );
        })}
      </div>

      {/* the hangar — deep radiation zones, visible but gated */}
      <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-white">☢️ The Hangar — Deep Shatterlands <span className="text-xs font-normal text-gray-400">— visually distant, radiation-locked</span></h3>
          <span className="text-[11px] text-gray-400">{t("exp.suits")}</span>
        </div>
        {deepZones.map((z) => {
          const locked = !accessibleDeep.includes(z);
          const cost = engineHelpers.suppliesCost(state, z);
          const stats = engineHelpers.zoneProspects(state, z);
          return (
            <div key={z.id} className={`mt-3 rounded-xl border p-4 ${locked ? "border-white/10 bg-black/40 opacity-70" : sel === z.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Tooltip content={tip({ what: `${z.name} — a hangared deep site.`, does: z.flavor, how: locked ? "Locked until you forge enough hazmat for a suited recon team. Craft suits in the Workshop." : "Selectable through the hangar. Committing opens the pre-launch risk pop-up." })}>
                  <span className={`font-semibold ${locked ? "text-text-3" : "text-white"}`}>{locked ? "🔒 " : "☢️ "}{z.name}</span>
                </Tooltip>
                <span className="text-[11px] uppercase text-text-3">{t("exp.deepSite")}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{z.flavor}</p>
              {locked ? (
                <p className="mt-2 text-xs text-amber-300/90">🔒 Hangared — needs <b className="text-amber-200">{Math.max(1, hazmatPerScientist(z.radiationLevel))} hazmat suit(s)</b> for a suited recon team before this deep site is reachable. Forge them in the 🏭 Workshop (Colony tab).</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <Tooltip content={tip(EXPEDITION_TIPS.risk)}><span className="rounded bg-white/5 px-2 py-0.5 text-red-300">Risk {z.risk}</span></Tooltip>
                  <Tooltip content={tip(EXPEDITION_TIPS.radiation)}><span className="rounded bg-red-400/10 px-2 py-0.5 text-red-300">☢️ {z.radiationLevel} deep radiation</span></Tooltip>
                  <Tooltip content={tip(EXPEDITION_TIPS.embers)}><span className="rounded bg-white/5 px-2 py-0.5 text-amber-200">~{stats.embers} Embers</span></Tooltip>
                  <Tooltip content={tip(EXPEDITION_TIPS.chipset)}><span className="rounded bg-white/5 px-2 py-0.5 text-cyan-300">Chipset {Math.round(stats.chipsetChance * 100)}%</span></Tooltip>
                  <Tooltip content={tip(EXPEDITION_TIPS.cost)}><span className="rounded bg-white/5 px-2 py-0.5 text-lime-300">Cost {cost} 📦</span></Tooltip>
                <Tooltip content={tip(EXPEDITION_TIPS.alloyShort)}>
                  <span className={`rounded px-2 py-0.5 ${state.resources.alloys >= 1 ? "bg-ember/10 text-ember-soft" : "bg-red-400/10 text-red-300"}`}>
                    {state.resources.alloys >= 1 ? "⚙️ extraction ready" : "⚙️ no alloy — find ≠ retrieve"}
                  </span>
                </Tooltip>
              </div>
            )}
              {!locked && (
                <button onClick={() => { setSel(z.id); sound.tab(); setRiskZone(null); }} disabled={sel === z.id} className="mt-2 rounded border border-white/15 px-3 py-1 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-40">
                  {sel === z.id ? "✓ Ready — Commit Supplies above" : "Select this deep site"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* pre-launch risk pop-up (deep zones only — free-play, never a lock) */}
      {riskZone && (
        <RiskModal
          state={state}
          zone={riskZone}
          scientists={sci}
          onGo={goAnyway}
          onPrepare={() => { setRiskZone(null); onPrepare(); }}
          onSafer={() => {
            setRiskZone(null);
            const safe = mildZones.find((z) => z.radiationLevel === 0) || mildZones[0];
            if (safe) { setSel(safe.id); onFlash("Selected a safer destination. The deep can wait."); }
          }}
          onCancel={() => { setRiskZone(null); sound.click(); }}
        />
      )}
    </main>
  );
}

/* Pre-launch radiation risk pop-up — shows % success, has-vs-need gear, and the
 * projected loss for the planned team; the player freely chooses to go. */
function RiskModal({ state, zone, scientists, onGo, onPrepare, onSafer, onCancel }: {
  state: GameState; zone: Zone; scientists: number;
  onGo: () => void; onPrepare: () => void; onSafer: () => void; onCancel: () => void;
}) {
  const r = state.resources;
  const need = requiredGear(zone, scientists);
  const loss = engineHelpers.loss(state, zone, scientists);
  const success = engineHelpers.success(state, zone, scientists);
  const fullyCovered = loss === 0;
  const t = useT();
  const table: { icon: string; label: string; have: number; need: number }[] = [
    { icon: "🧥", label: "Hazmat suits", have: r.hazmat, need: need.hazmat },
    { icon: "💉", label: "Radiation shots", have: r.shots, need: need.shots },
    { icon: "⚙️", label: "Alloy-armed diggers", have: r.alloys, need: need.alloys },
  ];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[90] modal-wrap bg-black/75" onClick={onCancel}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-red-400/40 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-red-300">☢️ High radiation: {zone.name}</h3>
          <button onClick={onCancel} className="rounded border border-white/15 px-2.5 py-2 text-xs text-gray-400 hover:bg-white/10">✕</button>
        </div>

        <div className={`mt-4 rounded-lg border p-3 text-center ${fullyCovered ? "border-ember/30 bg-ember/5" : "border-red-400/30 bg-red-400/5"}`}>
          <div className={`text-3xl font-bold ${fullyCovered ? "text-ember-soft" : success >= 50 ? "text-amber-300" : "text-red-300"}`}>
            Clean return: {success}%
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Team of {scientists} into {zone.name} ({zone.radiationLevel} radiation)
            {fullyCovered ? " — fully geared, the run should come back clean." : ` — projected loss ${loss}%: attrition, reduced loot${scientists > 1 ? ", possible scientist casualties" : ""}.`}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-text-3">{t("exp.gearLine")}</p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {table.map((row) => {
                const ok = row.have >= row.need;
                const cover = row.need > 0 ? Math.min(1, row.have / row.need) : 1;
                return (
                  <tr key={row.label} className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 text-gray-300">{row.icon} {row.label}</td>
                    <td className="py-1.5 text-end">
                      {row.need > 0 ? (
                        <span className={ok ? "text-ember-soft" : "text-red-300"}>
                          {row.have}/{row.need} <span className="text-text-3">({Math.round(cover * 100)}% cover)</span>
                        </span>
                      ) : (
                        <span className="text-ember-soft">not needed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-400">
            Suits are the exploration key — they let you get in and look. Alloy-armed diggers are the extraction key — without them you find, but largely cannot bring it back. What you lack shapes the loss rate. Losing scientists never wipes your colony below one; corruption rises with the taint left behind.
          </p>
        </div>

        <p className="mt-4 text-center text-xs italic text-text-3">"You are always free to go. This is what you risk."</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={onGo} className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-400">
            ☢️ Go Anyway — accept {loss}% loss
          </button>
          <button onClick={onPrepare} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-400/20">
            🏭 Go Back & Prepare
          </button>
          <button onClick={onSafer} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/10">
            🗺️ Safer Destination
          </button>
          <button onClick={onCancel} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-400 hover:bg-white/10">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Lab tab ---------------- */

function LabTab({ state, now, onStudy, onDeploy, onBeginResearch, onAllocatePoint, onChooseSpec, onChooseRevelation }: { state: GameState; now: number; onStudy: (k: "ember" | "chipset") => void; onDeploy: (d: DomainId) => void; onBeginResearch: (techId: string, leaderId: string) => void; onAllocatePoint: (leaderId: string, attr: "research" | "economy" | "combat" | "engineering") => void; onChooseSpec: (leaderId: string, path: "scholar" | "marshal" | "quartermaster") => void; onChooseRevelation: (choice: "sealed" | "open") => void }) {
  const t = useT();
  const studying = engineHelpers.studying(state);
  const busy = studying.length >= state.scientists;
  const r = state.resources;
  const [view, setView] = useState<"deploy" | "research" | "leaders">("deploy");
  const leaderCount = state.leaders.filter((l) => l.status === "active").length;
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h2 className="text-2xl font-bold text-white">{t("lab.title")}</h2>
      <p className="mt-1 text-sm text-gray-400">Two tracks: <b className="text-amber-200">Recovered AI</b> (study Embers & Chipsets → Deploy) and <b className="text-purple-300">Human knowledge</b> (spend 📜 Codices on the Research Tree, run by your Leaders).</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {([["deploy", t("lab.tabDeploy")], ["research", t("lab.tabResearch")], ["leaders", t("lab.tabLeaders", { n: leaderCount, cap: engineHelpers.leaderSlots(state) })]] as [typeof view, string][]).map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); sound.tab(); }} className={`rounded-lg px-3 py-2 text-sm font-medium ${view === id ? "bg-ember text-black" : "text-gray-300 hover:bg-white/10"}`}>{label}</button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 items-center text-sm">
        <Tooltip content={tip(RESOURCE_TIPS.insight)}><span className="rounded-lg bg-ember/10 border border-ember/30 px-3 py-1.5 text-ember-soft">Insight: {Math.round(state.insight)}</span></Tooltip>
        <Tooltip content={tip(RESOURCE_TIPS.codices)}><span className="rounded-lg bg-purple-400/10 border border-purple-400/30 px-3 py-1.5 text-purple-200">📜 Codices: {state.codices}</span></Tooltip>
        <Tooltip content={tip(LAB_TIPS.scientists)}><span className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-gray-300">Scientists: {state.scientists} <span className="text-text-3">({studying.length} busy / {engineHelpers.scientistCap(state)} cap)</span></span></Tooltip>
      </div>

      {view === "research" && <ResearchTreeView state={state} now={now} onBeginResearch={onBeginResearch} />}
      {engineHelpers.hasRevelation(state, "rv3") && !state.revelationAnswered && <RevelationChoiceModal onPick={onChooseRevelation} />}
      {view === "leaders" && <LeadersView state={state} now={now} onAllocatePoint={onAllocatePoint} onChooseSpec={onChooseSpec} />}

      {view === "deploy" && (<>
      {/* study */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
        <Tooltip content={tip(LAB_TIPS.studyEmbers)}>
          <h3 className="font-semibold text-white">{t("lab.studyTitle")}</h3>
        </Tooltip>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Tooltip content={tip(LAB_TIPS.studyEmbers)}>
              <div className="flex items-center justify-between"><span className="font-semibold text-amber-200">{t("lab.studyEmbers")}</span><span className="text-xs text-text-3">cost: 2 🧯 · ~{engineHelpers.studySecs(state, "ember")}s</span></div>
            </Tooltip>
            <p className="mt-1 text-xs text-gray-400">Consumes 2 Embers, yields ~{engineHelpers.insightFor(state, "ember")} insight, over real time.</p>
            <button onClick={() => onStudy("ember")} disabled={busy || r.embers < 2} className="mt-3 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
              {busy ? "All scientists busy" : r.embers < 2 ? "Need 2 Embers" : "Begin Study"}
            </button>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
            <Tooltip content={tip(LAB_TIPS.studyChipset)}>
              <div className="flex items-center justify-between"><span className="font-semibold text-cyan-300">{t("lab.studyChipset")}</span><span className="text-xs text-text-3">1 🔩 · ~{engineHelpers.studySecs(state, "chipset")}s</span></div>
            </Tooltip>
            <p className="mt-1 text-xs text-gray-400">Consumes a rare Chipset, yields ~{engineHelpers.insightFor(state, "chipset")} insight. A real leap forward.</p>
            <button onClick={() => onStudy("chipset")} disabled={busy || r.chipsets < 1} className="mt-3 w-full rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40">
              {busy ? "All scientists busy" : r.chipsets < 1 ? "Need a Chipset" : "Begin Study"}
            </button>
          </div>
        </div>

        {studying.length > 0 && (
          <div className="mt-4 space-y-2">
            {studying.map((s) => {
              const pct = Math.min(100, ((now - s.startedAt) / s.durationMs) * 100);
              return (
                <div key={s.id} className="rounded-lg bg-white/5 p-3">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>🔬 Studying {s.kind === "ember" ? "Embers" : "a Chipset"}</span>
                    <span>{fmtDur(Math.max(0, s.startedAt + s.durationMs - now))} left</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-ember" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* deploy */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
        <Tooltip content={tip(LAB_TIPS.deploy)}>
          <h3 className="font-semibold text-white">{t("lab.deployTitle")} <span className="text-xs font-normal text-gray-400">{t("lab.deploySub")}</span></h3>
        </Tooltip>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((d) => {
            const cost = engineHelpers.deployCost(state, d.id);
            const can = r.embers >= cost.embers && state.insight >= cost.insight;
            return (
              <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <Tooltip content={tip(DOMAIN_TIPS[d.id])}>
                  <div className="flex items-center justify-between"><span className="font-semibold text-white">{d.icon} {d.name}</span><span className="text-xs text-amber-300">Lv {state.deployedDomains[d.id]}</span></div>
                </Tooltip>
                <p className="mt-1 text-xs text-gray-400">{d.description}</p>
                <Tooltip content={tip(LAB_TIPS.deployButton)}>
                  <p className="mt-2 text-xs text-text-3">Cost: {cost.embers} 🧯 · {cost.insight} insight</p>
                </Tooltip>
                <Tooltip content={tip(LAB_TIPS.deployButton)}>
                  <button onClick={() => onDeploy(d.id)} disabled={!can} className="mt-2 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                    Deploy
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
      </>)}

      <JournalButton title={t("lab.journal")} subtitle={t("lab.journalSub")} log={state.log} />
    </main>
  );
}

/* ---------------- Armory tab (V6 — colony-side war hardware, earn-only) ---------------- */
function ArmoryTab({ state, now, onBuild, onRefine, onForgeMelt, busy }: {
  state: GameState; now: number;
  onBuild: (familyId: string) => void;
  onRefine: () => void;
  /** melt a forged piece back into the crucible (the Forge's junk valve) */
  onForgeMelt: (itemId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const r = state.resources;
  const race = state.race ? getRace(state.race) : null;
  const families = state.race ? raceFamilies(state.race) : [];
  const hubDone = engineHelpers.hasTech(state, "armory_hub");
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">🏛️ The Armory</h2>
          <p className="mt-1 text-sm text-gray-400">
            {race ? <><span style={{ color: race.accentText }}>{race.name}</span>'s mustered war hardware — built at the Cradle from supplies, embers, fuel and refined <b className="text-fuchsia-300">plasma</b>.</> : "War hardware, built at the Cradle."} Earned only — nothing here is ever bought.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Tooltip content={tip(ARMORY_TIPS.plasma)}>
            <span className="rounded-lg bg-fuchsia-400/10 border border-fuchsia-400/30 px-3 py-1.5 text-fuchsia-200">🔮 Plasma: {Math.floor(r.plasma)}</span>
          </Tooltip>
        </div>
      </div>
      {!hubDone ? (
        <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 text-sm text-gray-300">
          <p className="text-amber-200 font-semibold">🔒 The Armory hasn't been opened.</p>
          <p className="mt-1 text-xs text-gray-400">The forges answer only to the Cradle's command. Research <b className="text-purple-300">🏛️ Armory</b> in the Lab (🌳 Research — the amber section) to begin building weapon families.</p>
        </div>
      ) : families.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-gray-400">
          This world's race has no catalogued war families yet — the Watchers' catalog ships with the beta world; other races' catalogs arrive with their worlds.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span className="rounded-lg bg-white/5 border border-white/10 px-2 py-1">🏛️ Armory researched</span>
            <Tooltip content={tip(ARMORY_TIPS.plasmaRefine)}>
              <button onClick={() => { sound.click(); onRefine(); }} disabled={!engineHelpers.hasTech(state, "plasma_refinement") || r.embers < PLASMA_REFINE_EMBERS}
                className="rounded-lg bg-fuchsia-400/15 border border-fuchsia-400/40 px-3 py-1.5 text-fuchsia-200 hover:bg-fuchsia-400/25 disabled:opacity-40">
                {!engineHelpers.hasTech(state, "plasma_refinement") ? "🔒 Plasma Refinement (research in Lab)" : `🔮 Refine ${PLASMA_REFINE_EMBERS} 🧯 → 1 plasma`}
              </button>
            </Tooltip>
            <span className="text-[11px] text-text-3">Deep chipset sites also bleed raw plasma — the risk-of-depth reward.</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {families.map((f) => {
              const cur = engineHelpers.armoryState(state, f.id);
              const build = state.armoryBuilds?.[f.id] ?? null;
              const unlocked = hubDone && engineHelpers.hasTech(state, ARMORY_FAMILY_TECH[f.id]);
              const unlockTech = ARMORY_TREE.find((t) => t.id === ARMORY_FAMILY_TECH[f.id]);
              const tier = cur.tier as 1 | 2 | 3 | 4;
              const stats = tier >= 1 ? weaponStats(f.id, tier) : null;
              const nextTier = (Math.min(4, tier + 1)) as 1 | 2 | 3 | 4;
              const nextStats = tier >= 1 && tier < 4 ? weaponStats(f.id, nextTier) : null;
              const cost = tier < 4 ? weaponCost(nextTier) : null;
              const canAfford = cost ? r.supplies >= cost.supplies && r.embers >= cost.embers && r.gas >= cost.fuel && r.plasma >= cost.plasma : false;
              const leftMs = build ? Math.max(0, build.doneAt - now) : 0;
              const pct = build ? Math.min(100, ((now - build.startedAt) / (build.doneAt - build.startedAt)) * 100) : 0;
              const model = tier >= 1 ? modelName(state.race ?? "watchers", f, tier) : null;
              return (
                <div key={f.id} className={`relative rounded-2xl border p-4 ${unlocked ? "border-white/10 bg-black/40" : "border-white/5 bg-black/20 opacity-75"}`}>
                  {/* race-sigil block */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: race ? race.accent + "22" : "#ffffff14", border: `1px solid ${race ? race.accent + "55" : "#ffffff22"}` }}>
                      {f.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tooltip content={tip({ what: model ?? "Not built yet", does: f.identity, how: `Researched: ${unlockTech ? unlockTech.name : ""}. Built in real time at the Cradle — upgrades require the current tier's resources.` })}>
                          <h3 className="font-semibold text-white">{f.name}</h3>
                        </Tooltip>
                        <span className="text-[11px] uppercase tracking-wider text-text-3">{f.role}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] italic text-gray-400">{f.identity}</p>
                    </div>
                  </div>
                  {/* tier pips 1-4 */}
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-text-3">Tier</span>
                    {[1, 2, 3, 4].map((t) => (
                      <span key={t} className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${tier >= t ? "bg-ember text-black" : "bg-white/10 text-text-3"}`}>{t}</span>
                    ))}
                    {build && <span className="ms-auto text-[11px] text-purple-300">{fmtDur(leftMs)} left</span>}
                  </div>
                  {!unlocked ? (
                    <div className="mt-3 rounded-lg border border-purple-400/20 bg-purple-400/5 p-2.5 text-[11px] text-purple-200">
                      🔒 Forges locked — research <b>{unlockTech ? `${unlockTech.icon} ${unlockTech.name}` : "the family's forge"}</b> in the Lab to unlock.
                    </div>
                  ) : tier < 1 ? (
                    <div className="mt-3 space-y-2">
                      {/* T1 preview + build */}
                      <StatsRow stats={weaponStats(f.id, 1)} label="T1 Primer Mk I" />
                      {cost && <CostRow cost={cost} r={r} />}
                      <button onClick={() => { sound.click(); onBuild(f.id); }} disabled={!canAfford || !!build}
                        className="mt-1 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                        {build ? `Forging — ${fmtDur(leftMs)}` : canAfford ? `Build (${weaponTimeFor(1)})` : "Can't afford yet"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <StatsRow stats={stats!} label={`Now · ${model}`} />
                      {tier < 4 && nextStats && (
                        <div className="rounded-lg border border-ember/20 bg-ember/5 p-2">
                          <StatsRow stats={nextStats} label={`Next · ${modelName(state.race ?? "watchers", f, nextTier)}`} compare={stats!} preview />
                          {cost && <CostRow cost={cost} r={r} />}
                          <button onClick={() => { sound.click(); onBuild(f.id); }} disabled={!canAfford || !!build}
                            className="mt-1 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                            {build ? `Upgrading — ${fmtDur(leftMs)}` : canAfford ? `Upgrade (${weaponTimeFor(nextTier)})` : "Can't afford yet"}
                          </button>
                        </div>
                      )}
                      {tier >= 4 && <p className="rounded-lg bg-ember/5 border border-ember/20 p-2 text-[11px] text-ember-soft">Final tier — this family is complete.</p>}
                    </div>
                  )}
                  {build && (
                    <div className="mt-2 h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-purple-400" style={{ width: `${pct}%` }} /></div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-gray-400">
            <p><b className="text-gray-300">How the Armory works:</b> each family is built at <b className="text-amber-200">Tier 1</b> and upgraded T1→T2→T3→T4. Every tier raises <b className="text-white">all four stats</b> (×1.5 / ×2.2 / ×3.2), costs more, and takes real time — 45m · 3h · 12h · 2d. One build per family at a time; builds finish offline. Plasma enters at Tier 2. The battle side (later) reads these families into marches and sieges.</p>
            <p className="mt-1 text-[11px] text-text-3">First weapon built and first Tier-4 weapon each earn a durable <b className="text-amber-300">deed</b> — the dent earns attention. Weapons never feed the contribution formula directly.</p>
          </div>
        </>
      )}
      <div className="mt-4">
        <ForgedRack state={state} now={now} onMelt={onForgeMelt} busy={busy} />
      </div>
      <JournalButton title={t("armory.journal")} subtitle={t("armory.journalSub")} log={state.log} />
    </main>
  );
}
function StatsRow({ stats, label, compare, preview }: { stats: { power: number; precision: number; guard: number; logistics: number }; label: string; compare?: { power: number; precision: number; guard: number; logistics: number }; preview?: boolean }) {
  const rows: { key: "power" | "precision" | "guard" | "logistics"; icon: string; label: string }[] = [
    { key: "power", icon: STAT_LABELS.power.icon, label: STAT_LABELS.power.label },
    { key: "precision", icon: STAT_LABELS.precision.icon, label: STAT_LABELS.precision.label },
    { key: "guard", icon: STAT_LABELS.guard.icon, label: STAT_LABELS.guard.label },
    { key: "logistics", icon: STAT_LABELS.logistics.icon, label: STAT_LABELS.logistics.label },
  ];
  return (
    <div className={preview ? "" : "rounded-lg border border-white/10 bg-white/5 p-2"}>
      <div className="text-[11px] uppercase tracking-wider text-text-3">{label}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {rows.map((row) => (
          <span key={row.key} className="text-[11px] text-gray-300">{row.icon} {row.label} <b className={preview ? "text-ember-soft" : "text-white"}>{stats[row.key]}</b>{compare && preview ? <span className="text-text-3"> ▸ {compare[row.key]}</span> : null}</span>
        ))}
      </div>
    </div>
  );
}
function CostRow({ cost, r }: { cost: { supplies: number; embers: number; fuel: number; plasma: number }; r: GameState["resources"] }) {
  const rows: { label: string; icon: string; have: number; need: number }[] = [
    { label: "Supplies", icon: "📦", have: Math.floor(r.supplies), need: cost.supplies },
    { label: "Embers", icon: "🧯", have: Math.floor(r.embers), need: cost.embers },
    { label: "Fuel", icon: "⛽", have: Math.floor(r.gas), need: cost.fuel },
  ];
  if (cost.plasma > 0) rows.push({ label: "Plasma", icon: "🔮", have: Math.floor(r.plasma), need: cost.plasma });
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
      {rows.map((row) => (
        <span key={row.label} className={row.have >= row.need ? "text-lime-300" : "text-red-300"}>
          {row.icon} {row.need} <span className="text-text-3">({row.have})</span>
        </span>
      ))}
    </div>
  );
}
const PLASMA_REFINE_EMBERS = 25;
function weaponTimeFor(tier: 1 | 2 | 3 | 4): string {
  return tier === 1 ? "45m" : tier === 2 ? "3h" : tier === 3 ? "12h" : "2d";
}
/* ---------------- Codex / lore (Rung 1a §E — folds into the Cradle as a modal) ---------------- */
function CodexContent() {
  return (
    <div>
      <div className="mt-2 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-xs text-gray-400">
        Everything here is the mythology the colonies tell about the old world — never documentary fact. The races are legends worn as ways of life, not records of a real lineage. Nothing refers to any real-world group, religion, nationality, or person.
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {RACES.map((r) => (
          <div key={r.id} className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-lg font-bold text-white">{r.name}</h3>
              <span className="text-xs text-gray-400">{r.title}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-gray-300">{r.lore}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.attributes.map((a) => (
                <span key={a.label} className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  a.kind === "strength" ? "bg-ember/10 text-ember-soft" : a.kind === "weakness" ? "bg-red-400/10 text-red-300" : "bg-purple-400/10 text-purple-300"
                }`}>{a.label}</span>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-3">Home region: <span className="text-gray-300">{r.homeRegion}</span></p>
            <blockquote className="mt-2 border-s-2 border-amber-400/50 ps-3 text-amber-200/80 italic">{r.flavorQuote}</blockquote>
          </div>
        ))}
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-amber-200">{UNBOUND_LEGEND.name}</h3>
            <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">Earned — locked</span>
          </div>
          <p className="mt-2 text-sm text-gray-400">{UNBOUND_LEGEND.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-gray-300">{UNBOUND_LEGEND.lore}</p>
          <div className="mt-3 flex flex-wrap gap-2">{UNBOUND_LEGEND.attributes.map((a) => <span key={a.label} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-gray-300">{a.label}</span>)}</div>
          <blockquote className="mt-3 border-s-2 border-amber-400/50 ps-3 text-amber-200/80 italic">{UNBOUND_LEGEND.flavorQuote}</blockquote>
        </div>
      </div>
    </div>
  );
}
function CodexModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white">The Codex — Legends of the Shatterlands</h2>
          <button onClick={onClose} aria-label="Close the Codex" className="rounded border border-white/15 px-2.5 py-1.5 text-sm text-gray-400 hover:bg-white/10">✕</button>
        </div>
        <CodexContent />
      </div>
    </div>
  );
}

/* ---------------- the glimpse decision (rv3 payoff; one per game) ---------------- */
// Rendered exactly once: when the client sees the resolved rv3 glyph. The
// server holds the real answered-state and rejects double answers, so this
// modal can show unconditionally on rv3-resolved — answering hides it when the
// next state arrives. No Tooltip, no explanation; the two buttons are the
// whole choice. Mobile pattern matches the other modals (items-start,
// overflow-y-auto) so nothing clips on short screens.
function RevelationChoiceModal({ onPick }: { onPick: (choice: "sealed" | "open") => void }) {
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70">
      <div className="my-auto max-w-md rounded-2xl border border-white/15 bg-[#0b0e16] p-6 shadow-2xl">
        <div className="text-center text-3xl">🌒</div>
        <p className="mt-3 text-center text-sm leading-relaxed text-gray-300">
          A glimpse only. The path does not show itself twice. Something in the Cradle waits for an answer.
        </p>
        <div className="mt-5 space-y-2">
          <button onClick={() => { sound.click(); onPick("sealed"); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-white/40 hover:bg-white/10">
            <div className="font-semibold text-white">Seal the Record in bone</div>
            <p className="mt-1 text-xs text-gray-400">Keep what the Cradle knows the way marrow keeps its memory.</p>
          </button>
          <button onClick={() => { sound.click(); onPick("open"); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-white/40 hover:bg-white/10">
            <div className="font-semibold text-white">Leave it open</div>
            <p className="mt-1 text-xs text-gray-400">Let the pages turn in the wind no machine makes.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- formatting ---------------- */

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
