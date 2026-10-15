import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  getState, createGameFn, switchGameFn, resetGameFn, deleteGameFn, trashAccountFn,
  launchFn, studyFn, deployFn, purifyFn, craftFn, beginResearchFn, chooseRevelationFn,
  buildProbeFn, launchProbeFn, collectProbeFn,
  claimHuskFn,
  createRaidFn, setRaidTargetFn, clearRaidTargetFn, assignRaidShipsFn, loadRaidTroopsFn, loadRaidSuppliesFn, launchRaidFn, deployRaidFn, tacticalRoundFn, quickResolveTacticalFn, joinRaidFn, hireDesertersFn, dismissDesertersFn,
  acknowledgeRaidAlarmFn,
  rallyCreateFn,
  allocateLeaderPointFn, chooseSpecializationFn,
  signupFn, loginFn, logoutFn, meFn,
  submitFeedbackFn, listMyFeedbackFn, dismissNoticeFn,
  weaponBuildFn, refinePlasmaFn,
  forgeRollFn, forgeMeltFn,
  equipForgeItemFn, unequipForgeItemFn,
  claimDailyRewardFn,
  musterTroopsFn,
  applyTimeTokenFn,
  leaveActOneFn,
  setMemorialEpitaphFn,
  relocateColonyFn,
} from "../game/api";
import type { GameSummary } from "../game/api";
import { RACES, UNBOUND_LEGEND, getRace } from "../game/races";
import TutorialHost from "../components/tutorial/TutorialHost";
import { noteTutEvent } from "../game/tutorial/framework";
import { startTutorialAct } from "../game/tutorial/ui-store";
import { crewFromHeroes } from "../game/war/battle-scene-ui-store";
import { WORLD_CONFIG_PUBLIC, worldAllowedRaces, worldLockPlain } from "../game/world-config";
import { ZONES, DOMAINS, getZone } from "../game/zones";
import { engineHelpers } from "../game/client-utils";
import { Bdi } from "../components/ui/Bdi";
import { fmtDuration, formatTime } from "../game/i18n/format";
// The domain-label convention the Cradle already uses (slot-label.ts): the
// catalogue key wins, the data table's English is only the fallback. The
// DOMAINS table itself is never edited — i18n §10 asserts it stays
// catalogue-identical.
import { domainDescription } from "../game/i18n";
import {
  DEEP, isDeepZone, hazmatPerScientist,
  requiredGear, convoyNeeds,
  hasStepOutGear,
} from "../game/engine";
import type { CraftKind } from "../game/engine";
import WorkshopShelf from "../components/WorkshopShelf";
import RaceStats from "../components/RaceStats";
import {
  raceFamilies, ARMORY_FAMILY_TECH, weaponStats, weaponCost, weaponTimeMs, modelName, STAT_LABELS,
  ARMORY_CONFIG, ARMORY_BUILD_SLOTS,
} from "../game/armory";
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
import MaterialSheet, { MaterialTag } from "../components/MaterialSheet";
import { openMaterialSheet, type MaterialSheetId } from "../game/material-sheet";
import SettingsSheet from "../components/shell/SettingsSheet";
import MailboxSheet from "../components/Mailbox";
import RaidAlarmOverlay from "../components/RaidAlarmOverlay";

import { configureChat } from "../game/chat/chat-store";
import { configureChatMembers } from "../game/chat/chat-members";
import { useT, useLang } from "../components/i18n/I18n";
import { navBadges } from "../game/nav-badges";
import type { Tab } from "../game/nav-slots";
import { allianceOf } from "../game/war/alliances";
import { openRallies } from "../game/war/rallies";
import CradleScreen from "../components/screens/CradleScreen";
import HeroesHallScreen from "../components/screens/HeroesHallScreen";
import CradlePlate from "../components/CradlePlate";
import PageBanner from "../components/PageBanner";
import { Icon } from "../components/icons";
import StarMap from "../components/StarMap";
import type { KnownServer } from "../game/servers";
import { ForgedRack } from "../components/ForgeViews";
import { JournalButton } from "../components/JournalButton";
import { CircuitPage } from "../components/CircuitPage";
import WorldMapView from "../components/WorldMapView";
import BattlesTab from "../components/BattlesTab";
import BeachheadPage from "../components/BeachheadPage";
import ArenaPanel from "../components/ArenaPanel";
import AllianceTab from "../components/AllianceTab";
import LoadoutTab from "../components/LoadoutTab";
import FormationsTab from "../components/FormationsTab";
import TroopsTab from "../components/TroopsTab";
import { HeroCard, weaponThumbUrl } from "../components/HeroCard";
import { diffResolvedEventsT } from "../game/report-events";
import { tip, tipT, RESOURCE_TIPS, DOMAIN_TIPS, EXPEDITION_TIPS, LAB_TIPS, OWNER_TIPS, ARMORY_TIPS } from "../game/tooltips";
import type { GameState, RaceId, DomainId, Zone, FeedbackRecord, FeedbackCategory, FeedbackSeverity } from "../game/types";
import { timeTokenRefusalText } from "../components/screens/CradleScreen";
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
  const t = useT();
  const [token, setToken] = useState<string | null>(readToken);
  // null = still checking a persisted session; false = signed out; true = signed in
  const [signedIn, setSignedIn] = useState<boolean | null>(token ? null : false);
  const [state, setState] = useState<GameState | null>(null);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // ---- Back from Xsolla Pay Station (Payments). `intent` is the note written at click time
  // (game/payments/purchase-intent.ts). What the player is told is derived from the
  // SERVER's wallet compared against that note — never from the URL — and this panel
  // grants nothing: the entitlement arrives only through the signed webhook.
  const [purchaseReturn, setPurchaseReturn] = useState<{
    skuId: string | null;
    intent: PurchaseIntent | null;
    seenAt: number;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("colony");
  // The exploration room's destination lives HERE, not inside the tab
  // (owner 2026-10-14): the globe's Explore hands its chosen site across,
  // and the room must keep showing THAT site until the player picks
  // another. The tab unmounts on every tab switch, so tab-local state
  // silently reverted the room to the default site ("outer-ruins").
  const [expZoneId, setExpZoneId] = useState<string>("outer-ruins");
  // Tutorial bus: page opens are real, observable steps for the guided acts.
  useEffect(() => {
    noteTutEvent({ name: "tab", orderKind: tab });
  }, [tab]);
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
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const prevStateRef = useRef<GameState | null>(null);
  const reportIdRef = useRef(0);
  const reportOpenRef = useRef(false);
  useEffect(() => { reportOpenRef.current = reportOpen; }, [reportOpen]);

  const applyState = useCallback((next: GameState | null) => {
    const prev = prevStateRef.current;
    if (next && prev && prev.gameId === next.gameId) {
      const fresh = diffResolvedEventsT(t, prev, next);
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
  // ---- CHAT (slice A1, chat-mail-spec §1 D8) ---------------------------------
  // The chat store is pointed at the session here and nowhere else. It is a
  // SEPARATE cadence from the 4s state poll above: chat's own ~5s beat runs only
  // while the dock bar is on screen or the sheet is open, and it pauses on
  // `visibilitychange` inside the store. `me` is a placeholder only — the server
  // answers with the real account id on every sync, which is what decides whether
  // a line is mine.
  useEffect(() => {
    configureChat(signedIn === true ? token : null, null);
  }, [signedIn, token]);
  // ---- CHAT MEMBER DIRECTORY (owner 2026-10-11) ------------------------------
  // The chat window resolves sender avatars + tap-to-profile from the alliance
  // roster. Published here on every state/token change so avatars stay in sync
  // when someone changes theirs.
  useEffect(() => {
    if (signedIn !== true || !token || !state) {
      configureChatMembers(null);
      return;
    }
    const me = state.gameId ?? "";
    const alliance = allianceOf(state, me);
    if (!alliance) {
      configureChatMembers(null);
      return;
    }
    const mine = alliance.members.find((m) => m.colonyId === me);
    configureChatMembers({
      token,
      me,
      alliance,
      isLeader: mine?.role === "leader",
      isOfficer: mine?.role === "officer",
    });
  }, [signedIn, token, state]);
  // ---- PAYMENT RETURN (Payments) ----------------------------------------------------
  // Xsolla sends the player back to /play?purchase=return&sku=… (the return_url
  // minted with the token). The URL proves nothing, so it is never used to
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

  // TIME TOKENS (owner direction 2026-09-27): what the last Devotion claim
  // granted, straight off the server reply's own figures — the panel lists them
  // back to the player rather than deriving a count.
  const [claimTokens, setClaimTokens] = useState<Record<string, number> | null>(null);
  // SUPPLY BONUS (owner direction 2026-10-01): the supplies the last Devotion
  // claim paid — the daily login boost, listed back the same way.
  const [claimSupplies, setClaimSupplies] = useState<number | null>(null);
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
        // A refusal that carries a catalogue key is shown in the player's own
        // language; one without a key keeps the server's own English.
        flash(res.errorKey ? timeTokenRefusalText(t, res.errorKey) : res.error);
        sound.error();
      } else if (res && res.ok) {
        sound.success();
        (OK_SOUNDS[okSfx] || OK_SOUNDS.success)();
      }
      return res;
    } catch (e: any) {
      flash(e?.message || t("play.errors.cradleBroke", "Something broke in the Cradle."));
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

  // RAID RESPOND (owner 2026-10-04): "where is the respond button, how do we
  // even respond?" The war band's real response to an incoming raid is a
  // defense rally — the alliance musters and pledges against this raid.
  // Returns null on success (the caller clears/navigates), or an inline
  // error message when the rally can't be called (Hans's UI rule: the button
  // stays visible and tapping says what's missing).
  // HIVE RELOCATION (owner 2026-10-04, WS-E): "Relocate to hive" → globe
  // pick-mode → confirm. Returns null on success, or an inline error
  // message when the move can't happen (Hans's UI rule: the button stays
  // tappable and explains).
  const relocateColony = async (lat: number, lon: number): Promise<string | null> => {
    const res: any = await act(
      () => relocateColonyFn({ data: { token: token!, lat, lon } }),
      "relocate",
    );
    if (res && res.ok === false) {
      return res.errorKey ? timeTokenRefusalText(t, res.errorKey) : (res.error ?? "Relocation refused.");
    }
    if (!res || !res.ok) return t("play.errors.cradleBroke", "Something broke in the Cradle.");
    return null;
  };

  const respondToIncomingRaid = async (input: {
    raidId: string;
    nodeName: string;
    landsAt: number;
  }): Promise<string | null> => {
    const me = state?.gameId ?? "";
    const a = state ? allianceOf(state, me) : null;
    // One defense rally per raid: if the war band already mustered for this
    // raid, just take the player there instead of calling a second one.
    const existing = a
      ? openRallies(state!, a.id).find(
          (r) => r.target.kind === "defense-point" && r.target.zoneId === input.raidId,
        )
      : null;
    if (existing) {
      await act(() => acknowledgeRaidAlarmFn({ data: { token: token! } }), "alarm");
      switchTab("battles");
      return null;
    }
    const res = await act(
      () =>
        rallyCreateFn({
          data: {
            token: token!,
            name: `Defense of ${input.nodeName}`.slice(0, 60),
            targetKind: "defense-point",
            targetLabel: input.nodeName,
            zoneId: input.raidId,
            launchAt: input.landsAt,
          },
        }),
      "rally",
    );
    if (!res || res.ok === false) {
      // act() already flashed; the klaxon overlay sits above the toast, so
      // return the reason for the overlay's own inline error line.
      return res?.error || t("play.errors.serverUnreachable", "Failed to reach the server.");
    }
    // Rally called — clear the klaxon and take them to the war band where the
    // rally is mustering pledges.
    await act(() => acknowledgeRaidAlarmFn({ data: { token: token! } }), "alarm");
    switchTab("battles");
    return null;
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

  const [showServerSelect, setShowServerSelect] = useState(false);
  const doSignup = async (username: string, password: string): Promise<string | null> => {
    const res = await signupFn({ data: { username, password } });
    if (res.ok && res.token) {
      storeToken(res.token);
      setToken(res.token);
      setSignedIn(true);
      setState(null);
      setShowServerSelect(true);
      return null;
    }
    return res.error || t("play.auth.signupFailed", "Sign up failed.");
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
    return res.error || t("play.auth.loginFailed", "Log in failed.");
  };

  // ---- THE FALL: leaving the height (opening-prologue-spec §3) ----
  // The height is its own seat in the account, so "leave" is a plain hand-back
  // to a colony of the player's own. If they have no other colony yet they
  // simply stay where they are — the button can never strand anyone.
  const doLeaveAct1 = async (): Promise<void> => {
    sound.click();
    const res = await leaveActOneFn({ data: { token: token! } }).catch(() => null);
    if (!res) { flash(t("play.errors.serverUnreachable", "Failed to reach the server.")); return; }
    if (res.signedOut) { localLogout(); return; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? null);
      setTab("colony");
      sound.success();
      flash(t("play.games.backAtColony", "Back at your colony."));
      return;
    }
    flash(res.error || t("play.errors.leaveField", "Could not leave the field."));
  };
  // ---- Games modal actions (return server-side error string or null = ok) ----

  const doCreate = async (name: string, race: RaceId): Promise<string | null> => {
    sound.click();
    const res = await createGameFn({ data: { token: token!, name, race } }).catch(() => null);
    if (!res) return t("play.errors.serverUnreachable", "Failed to reach the server.");
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? null);
      setGamesOpen(false);
      sound.success();
      return null;
    }
    return res.error || t("play.errors.foundColony", "Could not found the colony.");
  };

  // Founding-flow entry point (owner P0 2026-10-05): the RaceSelect "Found The
  // Cradle" button must NEVER silently do nothing. Previously the inline
  // onStart wrapper discarded doCreate's error string (and silently returned
  // when the token wasn't ready), so a server-side refusal — e.g. the race
  // lock rejecting a race the client wrongly offered — left new players
  // staring at a dead button with no feedback. Every failure now flashes.
  const doFound = async (name: string, race: RaceId): Promise<void> => {
    if (!token) {
      flash(t("play.errors.noSession", "Session not ready — wait a moment and try again."));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const err = await doCreate(name, race);
      if (err) flash(err);
      else noteTutEvent({ name: "colony" });
    } finally {
      setBusy(false);
    }
  };

  const doSwitch = async (gameId: string): Promise<string | null> => {
    sound.click();
    const res = await switchGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return t("play.errors.serverUnreachable", "Failed to reach the server.");
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      setState(res.state);
      setActiveGameId(res.activeGameId ?? gameId);
      setGamesOpen(false);
      sound.success();
      return null;
    }
    return res.error || t("play.errors.switchColonies", "Could not switch colonies.");
  };

  const doReset = async (gameId: string): Promise<string | null> => {
    const res = await resetGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return t("play.errors.serverUnreachable", "Failed to reach the server.");
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok && res.state) {
      prevStateRef.current = null;
      setState(res.state);
      setActiveGameId(gameId);
      setGamesOpen(false);
      sound.success();
      flash(t("play.games.colonyWiped", "Colony wiped. Choose a new legend and name to found it again."));
      return null;
    }
    return res.error || t("play.errors.resetColony", "Could not reset the colony.");
  };

  const doDelete = async (gameId: string): Promise<string | null> => {
    const res = await deleteGameFn({ data: { token: token!, gameId } }).catch(() => null);
    if (!res) return t("play.errors.serverUnreachable", "Failed to reach the server.");
    if (res.signedOut) { localLogout(); return null; }
    if (res.ok) {
      sound.success();
      await refresh();
      return null;
    }
    return res.error || t("play.errors.deleteColony", "Could not delete the colony.");
  };

  const doTrash = async (u: string, p: string): Promise<string | null> => {
    const res = await trashAccountFn({ data: { token: token!, username: u, password: p } }).catch(() => null);
    if (!res) return t("play.errors.serverUnreachable", "Failed to reach the server.");
    // Success always signs out.
    if (res.ok && res.signedOut) {
      localLogout();
      return null;
    }
    if (res.signedOut) { localLogout(); return null; }
    return res.error || t("play.errors.deleteAccount", "Could not delete the account.");
  };

  // Not yet resolved a persisted session.
  if (signedIn === null) {
    return (
      <div className="min-h-screen bg-[#070910] text-gray-200 flex items-center justify-center">
        <div className="animate-pulse text-xl">{t("play.app.waking", "Waking the Cradle…")}</div>
      </div>
    );
  }

  // Signed out — show sign-up / login.
  if (signedIn === false) {
    return <AuthScreen busy={busy} onSignup={doSignup} onLogin={doLogin} />;
  }

  // Signed in but has no active game:
  //  - fresh signup → server select (pick a world = pick a race)
  //  - no colonies at all  → first-run "Found a Colony" (race select)
  //  - colonies exist but none active → colony picker screen
  if (!state) {
    if (showServerSelect) {
      const handleServerPick = (server: KnownServer) => {
        // Same origin = this server: dismiss and continue to colony founding.
        // Different origin = navigate there (separate deployment + database).
        try {
          const target = new URL(server.url);
          if (target.origin === window.location.origin) {
            setShowServerSelect(false);
            return;
          }
        } catch { /* fall through to navigate */ }
        window.location.href = server.url;
      };
      return (
        <div className="min-h-screen bg-[#070910] text-gray-200">
          <StarMap onSelect={handleServerPick} />
        </div>
      );
    }
    if (!games || games.length === 0) {
      return (
        <div className="min-h-screen bg-[#070910] text-gray-200">
          <RaceSelect busy={busy} onStart={(name, race) => { void doFound(name, race); }} />
          <TutorialHost />
          {firstRunNotice && <FirstRunNudge onDismiss={dismissNudge} />}
          {toast && <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
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
        {toast && <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      </div>
    );
  }

  // A Reset wiped this game's progress back to the race-selection screen: the
  // slot still exists but has no race yet — pick a NEW race AND name for it.
  if (state && !state.race) {
    return (
      <div className="min-h-screen bg-[#070910] text-gray-200">
        {firstRunNotice && <FirstRunNudge onDismiss={dismissNudge} />}
        <RaceSelect busy={busy} resetNote
          onStart={(name, race) => { void doFound(name, race); }} />
        <TutorialHost />
        {toast && <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      </div>
    );
  }

  const activeSummary = games?.find((g) => g.gameId === state.gameId);
  // Nav badges come from the closed predicate list (game/nav-badges.ts) — a dot
  // always means "an action is available here", never a notification (§1.3).
  const badges = navBadges(state, tab);
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      <TutorialHost crew={crewFromHeroes(state.prologue?.heroes)} attackerRace={state.race} currentTab={tab} />
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
          onMailbox={() => { setMailboxOpen(true); sound.click(); }}
          // ORBITAL WATCH: the NodeSheet's satellite section upgrades the
          // satellite right in the pop-up — appoint a Leader, no detour.
          onOpenLab={() => { switchTab("lab"); sound.click(); }}
          now={now}
          onBeginResearch={(t, l) => act(() => beginResearchFn({ data: { token: token!, techId: t, leaderId: l } }), "research")}
        />
      ) : tab === "beachhead" ? (
        <BeachheadPage
          state={state}
          now={now}
          token={token ?? undefined}
          onAction={(fn, label) => act(fn, label)}
          onClose={() => { switchTab("colony"); requestAnimationFrame(() => document.getElementById("nav-tab-beachhead")?.focus()); }}
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
        onMailbox={() => { setMailboxOpen(true); sound.click(); }}
        onOpenStores={() => { setCradleOpen(true); sound.click(); }}
        onAlertGo={() => switchTab("colony")}
        windowCtx={{
          state,
          now,
          onBeginResearch: (t, l) => act(() => beginResearchFn({ data: { token: token!, techId: t, leaderId: l } }), "research"),
        }}
        token={token ?? undefined}
        onAction={(fn, label) => act(fn, label)}
      >
      {firstRunNotice && tab !== "battles" && <FirstRunNudge onDismiss={dismissNudge} />}
      {toast && <div className="pointer-events-none fixed bottom-[calc(var(--spacing-nav)+var(--dock-h,0px)+env(safe-area-inset-bottom)+12px)] left-1/2 -translate-x-1/2 z-50 rounded-lg bg-black/85 border border-amber-400/40 px-4 py-2 text-sm text-amber-100 max-w-md shadow-lg">{toast}</div>}
      {tab === "colony" && (
        <CradleScreen
          state={state}
          now={now}
          timeTokens={state.timeTokens ?? {}}
          onPurify={(n) => act(() => purifyFn({ data: { token: token!, spend: n } }), "purify")}
          onSpeedup={(kind, id, sizeId) => act(() => applyTimeTokenFn({ data: { token: token!, sizeId, requestId: crypto.randomUUID(), kind, id } }), "success")}
          onOpenAlliance={() => switchTab("alliance")}
          tokenGrant={claimTokens}
          supplyGrant={claimSupplies}
          onClaim={async () => {
            const r = await act(() => claimDailyRewardFn({ data: { token: token! } }), "success");
            setClaimTokens(r && r.ok && r.granted ? (r.granted.timeTokens ?? null) : null);
            setClaimSupplies(r && r.ok && r.granted && typeof r.granted.supplies === "number" ? r.granted.supplies : null);
          }}
          onDeploy={(d) => act(() => deployFn({ data: { token: token!, domain: d } }), "deploy")}
          onOpenCodex={() => { setCodexOpen(true); sound.tab(); }}
          onOpenStore={() => { setLedgerOpen(true); sound.click(); }}
          onForgeRoll={(recipeId, requestId) => act(() => forgeRollFn({ data: { token: token!, recipeId, requestId } }), "build")}
          onForgeMelt={(itemId) => act(() => forgeMeltFn({ data: { token: token!, itemId } }), "success")}
          forgeBusy={busy}
          onField={() => switchTab("battles")}
          onLeaveHeight={doLeaveAct1}
          canLeaveHeight={!!games?.some((g) => g.gameId !== state.gameId && !!g.race)}
          token={token ?? undefined}
          onAction={(fn, label) => act(fn, label)}
          onNavigate={switchTab}
        />
      )}
      {tab === "expeditions" && <ExpeditionTab state={state} now={now} zoneId={expZoneId} onZoneChange={setExpZoneId} onLaunch={(z, s) => act(() => launchFn({ data: { token: token!, zoneId: z, scientists: s } }), "launch")} onFlash={flash} onCraft={(k, n, eventId) => act(() => craftFn({ data: { token: token!, kind: k, count: n, eventId } }), "success")} onDeploy={(d) => act(() => deployFn({ data: { token: token!, domain: d } }), "deploy")} onOpenStore={() => { setLedgerOpen(true); sound.click(); }} />}
      {tab === "armory" && <ArmoryTab state={state} now={now} busy={busy} onBuild={(f) => act(() => weaponBuildFn({ data: { token: token!, familyId: f } }), "build")} onRefine={() => act(() => refinePlasmaFn({ data: { token: token! } }), "refine")} onForgeMelt={(itemId) => act(() => forgeMeltFn({ data: { token: token!, itemId } }), "success")} />}
      {tab === "loadout" && <LoadoutTab state={state} busy={busy} onEquip={(itemId, bearer, slot) => act(() => equipForgeItemFn({ data: { token: token!, itemId, bearer, slot } }), "success")} onUnequip={(itemId) => act(() => unequipForgeItemFn({ data: { token: token!, itemId } }), "success")} />}
      {/* FORMATIONS (owner 2026-10-04): the dedicated loadout page — raid
          loadouts, exploration loadouts, response teams. One module, one page. */}
      {tab === "formations" && (
        <FormationsTab
          state={state}
          busy={busy}
          token={token}
          onAction={(fn, label) => act(fn, label)}
          onGoToWorld={() => setTab("world")}
        />
      )}
      {/* BARRACKS (owner 2026-10-04): the dedicated troop-building page — one module, one page. */}
      {tab === "troops" && <TroopsTab state={state} now={now} onMuster={(type, count, tier) => act(() => musterTroopsFn({ data: { token: token!, type, count, tier: tier ?? 1 } }), "muster")} />}
      {/* HEROES & LEADERS HALL (owner 2026-10-12): one module, one page — the
          roster, attributes, deed tiers and the level ladder. Display only:
          heroes are earned, never bought, and nothing here sells anything. */}
      {tab === "heroes" && <HeroesHallScreen state={state} now={now} />}
      {/* The arena is a permanent fixture — its own tab, not war-gated (owner 2026-10-01). */}
      {tab === "arena" && (
        <ArenaPanel
          state={state}
          token={token ?? undefined}
          onAction={(fn, label) => act(fn, label)}
        />
      )}
      {/* The war band's own page (owner 2026-10-04): reverb feed, roster,
          settings, shipyard — "don't be afraid to make pages." */}
      {tab === "alliance" && (
        <AllianceTab
          state={state}
          now={now}
          token={token ?? undefined}
          onAction={(fn, label) => act(fn, label)}
          onNavigate={(t) => switchTab(t)}
        />
      )}
      {/* THE WORLD STAGE (owner 2026-10-14): no PageBanner here — the
          globe is a full-screen place you stand in, not a picture band
          over a scroll column. Its title/sub live as scene overlays and
          its panels behind the desk door inside WorldMapView. */}
      {tab === "world" && (
        <WorldMapView
          state={state}
          now={now}
          onClaimHusk={(_colony, key) => act(() => claimHuskFn({ data: { token: token!, key } }), "claimHusk")}
          onFormRaid={() => act(() => createRaidFn({ data: { token: token! } }), "createRaid")}
          onSetRaidTarget={(raidId, key) => act(() => setRaidTargetFn({ data: { token: token!, raidId, key } }), "setRaidTarget")}
          onClearRaidTarget={(raidId) => act(() => clearRaidTargetFn({ data: { token: token!, raidId } }), "clearRaidTarget")}
          onAssignRaidShips={(raidId, shipIds) => act(() => assignRaidShipsFn({ data: { token: token!, raidId, shipIds } }), "assignRaidShips")}
          onLoadRaidTroops={(raidId, type, count) => act(() => loadRaidTroopsFn({ data: { token: token!, raidId, type, count } }), "loadRaidTroops")}
          onLoadRaidSupplies={(raidId, amount) => act(() => loadRaidSuppliesFn({ data: { token: token!, raidId, amount } }), "loadRaidSupplies")}
          onLaunchRaid={(raidId) => act(() => launchRaidFn({ data: { token: token!, raidId } }), "launchRaid")}
          onDeployRaid={(raidId, deployment, shipsHoldOrbit) => act(() => deployRaidFn({ data: { token: token!, raidId, deployment, shipsHoldOrbit } }), "deployRaid")}
          onJoinRaid={(inviteCode) => act(() => joinRaidFn({ data: { token: token!, inviteCode } }), "joinRaid")}
          onHireDeserters={(raidId, bandId) => act(() => hireDesertersFn({ data: { token: token!, raidId, bandId } }), "hireDeserters")}
          onDismissDeserters={(raidId, bandId) => act(() => dismissDesertersFn({ data: { token: token!, raidId, bandId } }), "dismissDeserters")}
          onTacticalRound={(raidId, orders) => act(() => tacticalRoundFn({ data: { token: token!, raidId, orders } }), "tacticalRound")}
          onQuickResolveTactical={(raidId) => act(() => quickResolveTacticalFn({ data: { token: token!, raidId } }), "quickResolveTactical")}
          onEpitaph={(plaqueId, epitaph) => act(() => setMemorialEpitaphFn({ data: { token: token!, plaqueId, epitaph } }), "setMemorialEpitaph")}
          onRespondToRaid={(r) => respondToIncomingRaid(r)}
          onOpenWarBand={() => switchTab("battles")}
          onEnterArena={() => switchTab("arena")}
          onEnterBeachhead={() => switchTab("beachhead")}
          onExploreSite={(zone) => { setExpZoneId(zone.id); switchTab("expeditions"); }}
          onRelocateColony={relocateColony}
          onBuildProbe={() => act(() => buildProbeFn({ data: { token: token! } }), "buildProbe")}
          onLaunchProbe={(sid) => act(() => launchProbeFn({ data: { token: token!, serverId: sid } }), "launchProbe")}
          onCollectProbe={(pid) => act(() => collectProbeFn({ data: { token: token!, probeId: pid } }), "collectProbe")}
        />
      )}
      {tab === "battles" && (
        <BattlesTab
          state={state}
          now={now}
          token={token ?? undefined}
          onDecision={() => { void refresh(); }}
          onAction={(fn, label) => act(fn, label)}
          onEnterBeachhead={() => switchTab("beachhead")}
          muted={muted}
        />
      )}
      {tab === "lab" && <LabTab state={state} now={now} onStudy={(k) => act(() => studyFn({ data: { token: token!, kind: k } }), "study")} onDeploy={(d) => act(() => deployFn({ data: { token: token!, domain: d } }), "deploy")} onBeginResearch={(t, l) => act(() => beginResearchFn({ data: { token: token!, techId: t, leaderId: l } }), "research")} onAllocatePoint={(lid, attr) => act(() => allocateLeaderPointFn({ data: { token: token!, leaderId: lid, attr } }), "success")} onChooseSpec={(lid, path) => act(() => chooseSpecializationFn({ data: { token: token!, leaderId: lid, path } }), "success")} onChooseRevelation={(c) => act(() => chooseRevelationFn({ data: { token: token!, choice: c } }), "success")} onBuildProbe={() => act(() => buildProbeFn({ data: { token: token! } }), "buildProbe")} onLaunchProbe={(sid) => act(() => launchProbeFn({ data: { token: token!, serverId: sid } }), "launchProbe")} onCollectProbe={(pid) => act(() => collectProbeFn({ data: { token: token!, probeId: pid } }), "collectProbe")} />}
      </AppShell>
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        player={state && token ? { state, token, onApplied: applyState } : null}
      />
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
      {/* THE MATERIAL EXPLANATION BOX (owner 2026-10-14): one shared sheet —
          any material named anywhere can open it with a plain tap. */}
      <MaterialSheet />
      {state && (
        <StorefrontOverlay
          state={state}
          open={ledgerOpen}
          onClose={() => { setLedgerOpen(false); sound.click(); }}
          accountId={username}
          token={token}
          purchaseReturn={purchaseReturnView}
          onError={flash}
          onPurchaseState={(s) => applyState(s)}
        />
      )}
      {feedbackOpen && <FeedbackModal token={token!} colonyName={state.playerName} onClose={() => setFeedbackOpen(false)} flash={flash} />}
      <ReportsSheet open={reportOpen} onClose={() => { setReportOpen(false); sound.click(); }} reports={reports} />
      {mailboxOpen && state && (
        <MailboxSheet
          state={state}
          now={now}
          token={token ?? undefined}
          onAction={(fn, label) => act(fn, label)}
          onClose={() => { setMailboxOpen(false); sound.click(); }}
          onGoTo={(tab) => { setMailboxOpen(false); switchTab(tab); }}
        />
      )}
      {/* SATELLITE KLAXON (owner 2026-10-03): full-screen raid alarm. Renders
          above everything while state.raidAlarm is live; acknowledge clears
          it server-side. The overlay itself runs the siren. */}
      {state?.raidAlarm && (
        <RaidAlarmOverlay
          alarm={state.raidAlarm}
          onAcknowledge={() => act(() => acknowledgeRaidAlarmFn({ data: { token: token! } }), "alarm")}
          onRespond={() =>
            respondToIncomingRaid({
              raidId: state.raidAlarm!.raidId,
              nodeName: state.raidAlarm!.nodeName,
              landsAt: state.raidAlarm!.landsAt,
            })
          }
        />
      )}
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
            placeholder={t("play.auth.namePlaceholder", "e.g. The Emberhold")}
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
          {t("play.auth.passwordNote", "Your password is hashed (scrypt) and never stored in plain text. This is a lightweight MVP — use a password you don't reuse elsewhere.")}
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
          <p><b className="text-amber-200">{t("play.help.step1Title", "1 · Send Explorations")}</b> {t("play.help.step1BodyA", "— fund teams into the Shatterlands (Exploration tab) to salvage")} <b className="text-amber-200">{t("play.help.resourceEmbers", "Embers")}</b> {t("play.help.step1BodyB", "and rare")} <b className="text-cyan-300">{t("play.help.resourceChipsets", "Chipsets")}</b>{t("play.help.step1BodyC", ". Exports run in real time; they keep going even logged out.")}</p>
          <p><b className="text-amber-200">{t("play.help.step2Title", "2 · Study in the Lab")}</b> {t("play.help.step2BodyA", "— scientists study the fragments over real time to distill")} <b className="text-ember-soft">{t("play.help.resourceInsight", "insight")}</b>{t("play.help.step2BodyB", ".")}</p>
          <p><b className="text-amber-200">{t("play.help.step3Title", "3 · Deploy recovered AI")}</b> {t("play.help.step3Body", "— spend Embers + insight to advance five domains: ⚔️ Weaponry, 🌾 Agriculture, 💰 Economy, ⚙️ Industry, 🚚 Logistics. Each grants passive bonuses.")}</p>
          <p><b className="text-amber-200">{t("play.help.step4Title", "4 · Push deeper")}</b> {t("play.help.step4Body", "— growth funds riskier explorations. Watch your ☣️ taint and 🔺 Chorus — high taint dulls salvage; Purify it in the Colony tab. Hover any icon for details.")}</p>
          <p><b className="text-amber-200">{t("play.help.step5Title", "5 · The deep needs gear")}</b> {t("play.help.step5Body", "— deep radiation sites sit in the ☢️ Hangar: suits let you EXPLORE, alloy-armed diggers (forged in the 🏭 Workshop from 5 race materials) let you EXTRACT. Under-geared runs show a pre-launch risk pop-up — you are always free to go, and you own what you risk.")}</p>
          <p><b className="text-amber-200">{t("play.help.multiTitle", "Multiple colonies")}</b> {t("play.help.multiBodyA", "— the")} <b className="text-gray-200">{t("play.help.multiGames", "Games")}</b> {t("play.help.multiBodyB", "button in the header lets you found new colonies, switch active ones, reset a game (all the way back to race selection, to pick a new legend and name), or delete it. The whole account (all colonies) can be removed from the Account section.")}</p>
          <p className="text-xs text-text-3">{t("play.help.mvpNote", "This is a colony-sim MVP on a persistent world that lives on in real time — a long game, not a click-session.")}</p>
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
/* Feedback category/severity labels are built with t() inside FeedbackModal (hooks can't run at module scope). */
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
  const catLabel: Record<FeedbackCategory, string> = {
    bug: t("play.feedback.catBug", "🐞 Bug"),
    flow_issue: t("play.feedback.catFlow", "🔄 Flow issue"),
    feature_suggestion: t("play.feedback.catSuggest", "💡 Suggestion"),
  };
  const sevLabel: Record<FeedbackSeverity, string> = {
    low: t("play.feedback.sevLow", "Low"),
    medium: t("play.feedback.sevMedium", "Medium"),
    high: t("play.feedback.sevHigh", "High"),
    critical: t("play.feedback.sevCritical", "Critical"),
  };
  const doSubmit = async () => {
    const titleText = title.trim();
    const d = description.trim();
    if (!titleText) { setError(t("play.feedback.errTitle", "Please give your report a title.")); return; }
    if (titleText.length > 80) { setError(t("play.feedback.errTitleLong", "Title must be 80 characters or fewer.")); return; }
    if (d.length < 10) { setError(t("play.feedback.errDescShort", "Description needs at least 10 characters — a little more detail helps.")); return; }
    if (d.length > 2000) { setError(t("play.feedback.errDescLong", "Description must be 2000 characters or fewer.")); return; }
    if (category === "bug" && !severity) { setError(t("play.feedback.errSeverity", "Pick a severity for the bug.")); return; }
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
    if (!res) { setError(t("play.feedback.errServer", "Could not reach the server — please try again.")); return; }
    if (res.signedOut) { onClose(); flash(t("play.feedback.sessionExpired", "Session expired — please log in again.")); return; }
    if (!res.ok) { setError(res.error || t("play.feedback.errSubmit", "Could not submit your report.")); return; }
    setTitle(""); setDescription(""); setSeverity("");
    flash(t("play.feedback.sent", "Feedback sent — thank you. The team reads every report."));
    sound.success();
    loadRecords();
  };
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t("play.feedback.title", "💬 Feedback")}</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("help.close")}</button>
        </div>
        <p className="mt-1 text-xs text-text-3">{t("play.feedback.sub", "This is the first world — tell us what broke or what you'd like to see. Reports go straight to the dev team.")}</p>
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("play.feedback.category", "Category")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["bug", "flow_issue", "feature_suggestion"] as const).map((c) => (
                <button key={c} type="button" onClick={() => { setCategory(c); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${category === c ? "border-amber-400/60 bg-amber-400/10 text-amber-200" : "border-white/15 text-gray-300 hover:bg-white/10"}`}>{catLabel[c]}</button>
              ))}
            </div>
          </div>
          {category === "bug" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("play.feedback.severity", "Severity")} <span className="text-text-3">{t("play.feedback.required", "(required)")}</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["low", "medium", "high", "critical"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => { setSeverity(s); setError(null); }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${severity === s ? "border-red-400/60 bg-red-400/10 text-red-200" : "border-white/15 text-gray-300 hover:bg-white/10"}`}>{sevLabel[s]}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-400"><span>{t("play.feedback.titleLabel", "Title")}</span><span className="text-text-3">{t("play.feedback.titleCount", "{n}/80", { n: title.length })}</span></div>
            <input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} maxLength={80} placeholder={t("play.feedback.titlePlaceholder", "Short summary, e.g. Exploration stuck at 100%")}
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-400"><span>{t("play.feedback.descLabel", "Description")}</span><span className="text-text-3">{t("play.feedback.descCount", "{n}/2000", { n: description.length })}</span></div>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setError(null); }} rows={4} placeholder={t("play.feedback.descPlaceholder", "What happened? What did you expect? (10+ characters)")}
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("play.feedback.playerLabel", "Player / Colony (optional)")}</div>
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={64} placeholder={t("play.feedback.playerPlaceholder", "Who filed this?")}
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-gray-200 placeholder:text-text-3 outline-none focus:border-amber-400/50" />
          </div>
          {error && <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
          <button onClick={doSubmit} disabled={submitting} className="w-full rounded-lg bg-ember px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-50">
            {submitting ? t("play.feedback.sending", "Sending…") : t("play.feedback.send", "Send Feedback")}
          </button>
        </div>
        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("play.feedback.yourSubmissions", "Your submissions")}</div>
          {records === null ? (
            <p className="mt-2 text-xs text-text-3">{t("play.feedback.loading", "Loading…")}</p>
          ) : records.length === 0 ? (
            <p className="mt-2 text-xs text-text-3">{t("play.feedback.nothingYet", "Nothing yet. Reports you send will appear here.")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {records.map((r) => (
                <li key={r.id} className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-200">{catLabel[r.category]}{r.severity ? ` · ${sevLabel[r.severity]}` : ""}</span>
                    <span className="text-xs text-text-3">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-200">{r.title}</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-xs text-gray-400">{r.description}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-text-3">{t("play.feedback.status", "status: {s}", { s: r.status })}</div>
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

function RaceSelect({ busy, onStart, resetNote }: { busy: boolean; onStart: (name: string, race: RaceId) => void; resetNote?: boolean }) {
  const t = useT();
  // Owner 2026-10-01: NO pre-filled default — every player must name their own
  // Cradle. The Found button stays disabled until a real name is typed.
  const [name, setName] = useState("");
  const nameOk = name.trim().length > 0;
  const [selected, setSelected] = useState<RaceId>(worldAllowedRaces()[0] ?? "watchers");
  const race = getRace(selected);
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80">{resetNote ? t("play.races.kickerReborn", "A Colony Reborn") : t("play.races.kickerFound", "Founding a Colony")}</p>
        <h1 className="mt-2 text-center text-3xl md:text-4xl font-bold text-white">{t("play.races.title", "Choose Your Legend")}</h1>
        {resetNote && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-100">
            {t("play.races.resetTitle", "This colony was ")}<b>{t("play.races.resetBold", "Reset")}</b>{t("play.races.resetBodyA", ". Its progress is gone forever. Found it anew with a ")}<b className="text-amber-200">{t("play.races.resetFresh", "fresh legend ")}<em>{t("play.races.resetAnd", "and")}</em>{t("play.races.resetFreshName", " a fresh name")}</b>{t("play.races.resetBodyB", " — or close the browser to leave the slot empty.")}
          </div>
        )}
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-400 text-sm">
          {t("play.races.introA", "Seven races are told around the ember-fires of the Shatterlands. These are ")}<span className="text-amber-200">{t("play.races.introLegends", "legends the colonies believe")}</span>{t("play.races.introB", " about the world that burned — not records of fact. Each race is incomplete alone; to become whole, you will venture into the others' territories and salvage ")}<em>{t("play.races.introTheir", "their")}</em>{t("play.races.introC", " AI.")}
        </p>

        <div className="mt-2 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-center text-xs text-gray-400">
          {t("play.races.codexFiction", "Codex fiction — in-game mythology only. Nothing here refers to any real-world group, religion, nationality, or person.")}
        </div>

        <div className="mt-3 text-center">
          <button
            type="button"
            data-testid="races-learn-founding"
            onClick={() => startTutorialAct("founding")}
            className="min-h-[44px] rounded-lg border border-amber-300/50 bg-amber-400/10 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-400/20"
          >
            {t("play.races.learnFounding", "🖍️ First time? The founding lessons explain the choice — purpose first, two minutes")}
          </button>
        </div>

        {WORLD_CONFIG_PUBLIC.raceLock && (
          <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-purple-400/40 bg-purple-400/10 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-white">
              🌍 {WORLD_CONFIG_PUBLIC.worldName}
              {WORLD_CONFIG_PUBLIC.debugWorld && (
                <span className="ms-2 rounded bg-purple-400/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-purple-200">{t("play.races.betaTestWorld", "Beta Test World")}</span>
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
              <div className="flex items-start gap-3">
                <HeroCard heroId={rid} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-white">{r.name}</span>
                    <span className="text-xs text-gray-400">{r.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-300">{r.blurb}</p>
                  <RaceStats race={r} compact />
                </div>
              </div>
            </button>
          );
          })}
          {/* locked Unbound preview */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 opacity-70">
            <div className="flex items-start gap-3">
              <HeroCard heroId="unbound" size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-amber-200">{t("play.races.unboundName", "The Unbound")}</span>
                  <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">{t("play.races.unboundEarned", "Earned")}</span>
                </div>
                <p className="mt-1 text-sm text-gray-300">{UNBOUND_LEGEND.blurb}</p>
                <p className="mt-2 text-xs text-text-3">
                  {t("play.races.unboundBlurb", "Not pickable at start. The Unbound are a rare, ascended inner circle earned only through a long track of special missions and badges of honor — the proof that a colony can rebuild without being rebuilt by what it used.")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* selected race detail */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            <HeroCard heroId={selected} size="lg" lazy={false} />
            <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold text-white">{race.name}</h2>
            <span className="text-sm text-gray-400">{race.title}</span>
            <span className="ms-auto text-xs text-text-3">{t("play.races.homeRegion", "Home region: ")}<span className="text-gray-300">{race.homeRegion}</span></span>
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
            <RaceStats race={race} />
            <p className="mt-2 text-[11px] text-text-3">
              {t("play.races.pillsNote", "Sky-blue dashed pills (e.g. warfare, stealth, defense, diplomacy) arrive with the combat & survival layer — they are not playable in this beta build yet.")}
            </p>
          </div>
          <blockquote className="mt-4 border-s-2 border-amber-400/60 ps-4 text-amber-200/90 italic">{race.flavorQuote}</blockquote>

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1">
              <span className="block text-xs text-gray-400 mb-1">{t("play.races.nameColony", "Name your colony (The Cradle)")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder={t("play.races.namePlaceholder", "Give your Cradle its name")}
                className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400"
              />
              {!nameOk && (
                <p className="mt-1 text-xs text-amber-200/80">{t("play.races.nameRequired", "A Cradle needs a name before it can be founded.")}</p>
              )}
            </label>
            <button
              onClick={() => onStart(name.trim(), selected)}
              disabled={busy || !nameOk}
              className="rounded-lg bg-ember px-6 py-2.5 font-semibold text-black hover:brightness-110 disabled:opacity-40"
            >
              {t("play.races.foundCradle", "Found The Cradle")}
            </button>
          </div>
            </div>
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
  // The device's language in force right now — `useT()` hands back the lookup only,
  // it carries no language of its own. Formatted numerals in this file take their
  // locale from here, never from the device default.
  const lang = useLang();
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} labelledBy="reports-title" title={t("play.reports.title", "Cradle Reports")}>
      <SheetHeader id="reports-title" title={t("play.reports.title", "Cradle Reports")} subtitle={t("play.reports.subtitle", "what came home while you watched — newest first")} onClose={onClose} />
      <div className="sheet-body px-4 py-3 md:px-5">
        {reports.length === 0 ? (
          <p className="text-sm text-text-3">{t("play.reports.empty", "Nothing new — every work the Cradle sent out is still in flight.")}</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surf-2/60 px-3 py-2 text-xs leading-relaxed text-text-2">
                {r.text}
                <Bdi dir="ltr" className="num mt-1 block text-[11px] text-text-3">{formatTime(lang, r.ts)}</Bdi>
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
          <h2 className="text-lg font-bold text-white">{t("play.games.title", "Your Colonies")}</h2>
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
  const t = useT();

  const neverMind = () => { setConfirmResetId(null); setConfirmDeleteId(null); setTrashOpen(false); sound.click(); };

  return (
    <div className={forced ? "mx-auto max-w-3xl px-6 py-10" : "mt-4"}>
      {forced && (
        <>
          <p className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80">{t("play.games.title", "Your Colonies")}</p>
          <h1 className="mt-1 text-center text-3xl font-bold text-white">{t("play.games.choose", "Choose a Colony")}</h1>
          <p className="mt-2 text-center text-sm text-gray-400">{t("play.games.noneActive", "You have colonies, but none are active. Pick one to resume, found a new one, or manage them below.")}</p>
        </>
      )}

      {/* 1 · Your colonies */}
      <section className="mt-6">
        <h3 className="font-semibold text-white">{t("play.games.yourColonies", "Your colonies")} <span className="text-xs font-normal text-text-3">{t("play.games.colonyCount", "({n}/5)", { n: games.length })}</span></h3>
        {games.length === 0 ? (
          <p className="mt-2 text-sm text-text-3">{t("play.games.noColonies", "No colonies yet. Found your first below.")}</p>
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
                        {isActive && <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">{t("play.games.active", "Active")}</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        {race ? `${race.name} · ${race.homeRegion}` : "—"}{t("play.games.founded", " · found {date}", { date: new Date(g.createdAt).toLocaleDateString() })}
                      </div>
                      <div className="mt-1 text-xs text-text-3">{g.summary}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isActive && (
                        <button onClick={() => onPlay(g.gameId)} disabled={busy} className="rounded-lg bg-ember px-3 py-2 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40">{t("play.games.play", "Play")}</button>
                      )}
                      <button onClick={() => { setConfirmDeleteId(null); setConfirmResetId(isConfirmingReset ? null : g.gameId); sound.click(); }} disabled={busy} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-300 hover:bg-white/10">{t("play.games.reset", "Reset")}</button>
                      <button onClick={() => { setConfirmResetId(null); setConfirmDeleteId(isConfirmingDelete ? null : g.gameId); sound.click(); }} disabled={busy} className="rounded border border-red-400/30 px-3 py-2 text-xs text-red-300 hover:bg-red-400/10">{t("play.games.delete", "Delete")}</button>
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
        <h3 className="font-semibold text-white">{t("play.games.foundNew", "Found a New Colony")} <span className="text-xs font-normal text-text-3">{t("play.games.foundNewSub", "— a new game: one race, one colony")}</span></h3>
        {games.length >= 5 ? (
          <p className="mt-2 text-sm text-amber-200/80">{t("play.games.maxColonies", "You've reached the maximum of 5 colonies. Delete one to found another.")}</p>
        ) : (
          <InlineFoundColony busy={busy} onCreate={onCreate} flash={flash} />
        )}
      </section>

      {/* 3 · Account */}
      <section className="mt-8 rounded-xl border border-red-400/20 bg-red-400/5 p-4">
        <h3 className="font-semibold text-red-200">{t("play.games.account", "Account")}</h3>
        <p className="mt-1 text-xs text-gray-400">{t("play.games.signedInAs", "Signed in as ")}<b className="text-gray-200">{username || "…"}</b>{t("play.games.deleteWarnA", ". Deleting your account permanently removes ")}<b className="text-red-200">{t("play.games.deleteWarnCount", "all {n} {unit}", { n: games.length, unit: games.length === 1 ? t("play.games.colonyOne", "colony") : t("play.games.colonyMany", "colonies") })}</b>{t("play.games.deleteWarnB", " and the account itself. This cannot be undone.")}</p>
        {!trashOpen ? (
          <button onClick={() => { setTrashOpen(true); sound.click(); }} disabled={busy} className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-400/20 disabled:opacity-40">{t("play.games.deleteAccount", "Delete entire account…")}</button>
        ) : (
          <TrashConfirm username={username} onCancel={neverMind} onConfirm={onTrash} flash={flash} />
        )}
      </section>
    </div>
  );
}

/* Inline "found a new colony" race picker (reuses the race-select flow). */
function InlineFoundColony({ busy, onCreate, flash }: { busy: boolean; onCreate: (n: string, r: RaceId) => Promise<string | null>; flash: (m?: string) => void }) {
  const t = useT();
  const [name, setName] = useState(t("play.races.defaultName", "The Emberhold"));
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
          {t("play.games.worldLock", "🌍 {world} is the {lock} debug world — only {lock} colonies can be founded here.", { world: WORLD_CONFIG_PUBLIC.worldName, lock: worldLockPlain() })}
        </p>
      )}
      <div className="mt-2 text-sm text-gray-400"><span className="font-semibold text-amber-200">{race.name}</span> — <span className="text-text-3">{race.blurb}</span></div>
      <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end">
        <label className="flex-1">
          <span className="block text-xs text-gray-400 mb-1">{t("play.games.nameColony", "Name your colony")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-amber-400" />
        </label>
        <button onClick={async () => { const err = await onCreate(name, selected); if (err) { flash(err); sound.error(); } }} disabled={busy} className="rounded-lg bg-ember px-5 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
          {t("play.races.foundCradle", "Found The Cradle")}
        </button>
      </div>
    </div>
  );
}

/* 2-step reset confirm: checkbox + 3s countdown; extra warning when there's active content. */
function ResetConfirm({ game, onCancel, onConfirm }: { game: GameSummary; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
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
      <p className="text-amber-200"><b>{t("play.games.resetTitle", "Reset “{name}”?", { name: game.name })}</b>{t("play.games.resetBodyA", " This wipes all progress forever and returns you to the ")}<b>{t("play.games.resetBodyB", "race-selection screen to pick a NEW legend AND a new name")}</b>{t("play.games.resetBodyC", " for this colony slot ")}{game.race ? t("play.games.resetLegend", "(the current legend is {legend})", { legend: getRace(game.race).name }) : ""}{t("play.games.resetBodyD", ".")}</p>
      {game.activeContent && (
        <p className="mt-1 text-amber-300/90">{t("play.games.resetActiveWarn", "⚠️ This colony has explorations or studies still in flight. They will be abandoned immediately.")}</p>
      )}
      <p className="mt-1 text-xs text-text-3">{t("play.games.resetNoShortcut", "There is no fresh-colony-same-race shortcut anymore — a reset takes you all the way back to the start.")}</p>
      <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
        <span className="text-xs text-gray-400">{t("play.games.resetUnderstand", "I understand this destroys the current colony's progress forever and cannot be undone.")}</span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onConfirm} disabled={!ready || !checked} className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/20 disabled:opacity-40">
          {ready ? t("play.games.resetConfirm", "Confirm Reset") : t("play.games.resetHold", "Hold {n}s", { n: count })}
        </button>
        <button onClick={onCancel} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("play.common.cancel", "Cancel")}</button>
      </div>
    </div>
  );
}

/* Delete confirm: must type the colony name to enable the red confirm. */
function DeleteConfirm({ game, onCancel, onConfirm }: { game: GameSummary; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const canConfirm = typed.trim() === game.name;
  return (
    <div className="text-sm">
      <p className="text-red-200"><b>{t("play.games.deleteTitle", "Delete “{name}”?", { name: game.name })}</b>{t("play.games.deleteBody", " This permanently removes this colony and its save. It cannot be recovered.")}</p>
      <p className="mt-1 text-xs text-gray-400">{t("play.games.deleteTypeName", "Type the colony's name to confirm:")}</p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={game.name} className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onConfirm} disabled={!canConfirm} className="rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-40">{t("play.games.deleteConfirm", "Permanently Delete")}</button>
        <button onClick={onCancel} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("play.common.cancel", "Cancel")}</button>
      </div>
    </div>
  );
}

/* Trash account confirm: username + re-entered password (server-verified) + final checkbox. */
function TrashConfirm({ username, onCancel, onConfirm, flash }: { username: string | null; onCancel: () => void; onConfirm: (u: string, p: string) => Promise<string | null>; flash: (m?: string) => void }) {
  const t = useT();
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
      <p className="text-red-200 font-semibold">{t("play.games.trashTitle", "This permanently deletes your account and every colony on it.")}</p>
      <p className="mt-1 text-xs text-gray-400">{t("play.games.trashVerify", "Your password is verified on the server before anything is deleted.")}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">{t("play.games.username", "Username")}</span>
          <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" placeholder={username || t("play.games.usernamePlaceholder", "your username")} className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">{t("play.games.reenterPassword", "Re-enter password")}</span>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none focus:border-red-400" />
        </label>
      </div>
      {!nameOk && u.trim() !== "" && <p className="mt-2 text-xs text-red-400">{t("play.games.usernameMismatch", "That doesn't match this account's username.")}</p>}
      <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={finalCk} onChange={(e) => setFinalCk(e.target.checked)} className="mt-0.5" />
        <span className="text-xs text-gray-400">{t("play.games.trashUnderstand", "I understand this is permanent — the account, password, and all colonies will be destroyed.")}</span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={submit} disabled={!canConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40">
          {submitting ? t("play.games.deleting", "Deleting…") : t("play.games.trashConfirm", "Delete Entire Account")}
        </button>
        <button onClick={onCancel} disabled={submitting} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("play.common.cancel", "Cancel")}</button>
      </div>
    </div>
  );
}

/* ---------------- Expeditions tab ---------------- */

/** Per-site material breakdown (owner 2026-09-30): what a run to THIS site
 *  needs from the stores, have-vs-need, on the site's own card. Radiation gear
 *  scales with the planned team size; convoy stores (fuel, battery, mechanics)
 *  are the zone's own after the colony's research discounts — the same figures
 *  the launch gate enforces, so the card and the gate never disagree. What is
 *  shown is the need; the WHY behind each figure stays the player's discovery. */
function SiteNeeds({ state, zone, scientists }: { state: GameState; zone: Zone; scientists: number }) {
  const t = useT();
  const r = state.resources;
  const gear = requiredGear(zone, scientists);
  const convoy = convoyNeeds(state, zone);
  const rows = [
    gear.hazmat > 0 ? { id: "hazmat" as MaterialSheetId, icon: "🧥", label: t("play.gear.hazmatLabel", "Hazmat suits"), have: Math.floor(r.hazmat), need: gear.hazmat } : null,
    gear.shots > 0 ? { id: "shots" as MaterialSheetId, icon: "💉", label: t("play.gear.shotsLabel", "Radiation shots"), have: Math.floor(r.shots), need: gear.shots } : null,
    gear.alloys > 0 ? { id: "alloy" as MaterialSheetId, icon: "⚙️", label: t("play.gear.alloyLabel", "Alloy diggers"), have: Math.floor(r.alloys), need: gear.alloys } : null,
    convoy.gas > 0 ? { id: "gas" as MaterialSheetId, icon: "⛽", label: t("play.gear.fuelLabel", "Vehicle fuel"), have: Math.floor(r.gas), need: convoy.gas } : null,
    convoy.battery > 0 ? { id: "battery" as MaterialSheetId, icon: "🔋", label: t("play.gear.batteryLabel", "Battery packs"), have: Math.floor(r.battery), need: convoy.battery } : null,
    convoy.skmech > 0 ? { id: "skmech" as MaterialSheetId, icon: "🔧", label: t("play.gear.skmechLabel", "Skilled mechanics"), have: Math.floor(r.skmech), need: convoy.skmech } : null,
  ].filter((x): x is { id: MaterialSheetId; icon: string; label: string; have: number; need: number } => x !== null);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-3">
        {t("play.gear.toField", "To field — team of {n}", { n: scientists })}
      </p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => {
          const ok = row.have >= row.need;
          return (
            <li key={row.label} className="flex items-center justify-between text-[11px]">
              {/* the material's name is a door (owner 2026-10-14): tap it and
                  the explanation box opens — what it is, what it's for, how
                  you get it. */}
              <button
                type="button"
                onClick={() => openMaterialSheet({ id: row.id, count: row.have })}
                className="py-1 text-left text-gray-300 underline decoration-dotted decoration-gray-500 underline-offset-2 hover:text-text-1"
              >
                {row.icon} {row.label} <span aria-hidden="true" className="text-text-3">ⓘ</span>
              </button>
              <span className={ok ? "text-ember-soft" : "text-red-300"}>
                <Bdi dir="ltr">{row.have}/{row.need}</Bdi>
                {!ok && <span className="text-text-3">{t("play.gear.short", " — short")}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExpeditionTab({ state, now, zoneId, onZoneChange, onLaunch, onFlash, onCraft, onDeploy, onOpenStore }: {
  state: GameState; now: number;
  /** The destination site — owned by PlayPage so the globe's Explore choice
   *  (and any pick made here) survives this tab unmounting (owner 2026-10-14). */
  zoneId: string; onZoneChange: (id: string) => void;
  onLaunch: (zone: string, sci: number) => void;
  onFlash: (m?: string) => void; onCraft: (k: CraftKind, count: number, eventId: string) => Promise<any>;
  onDeploy: (d: DomainId) => void;
  /** Open the War Market (the Cradle Ledger) — the depot stall's door. */
  onOpenStore: () => void;
}) {
  const t = useT();
  const sel = zoneId;
  const setSel = onZoneChange;
  const [sci, setSci] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [riskZone, setRiskZone] = useState<Zone | null>(null);
  const active = state.expeditions.filter((e) => e.status === "out");
  const maxSlots = 1 + state.deployedDomains.logistics;
  const canLaunch = active.length < maxSlots;
  const stepOut = hasStepOutGear(state); // Tier 0 — gates fielding ANY expedition
  // The workshop lives on THIS page now (owner 2026-09-30) — "go back and
  // prepare" scrolls to it instead of leaving for the Cradle.
  const scrollToWorkshop = () => {
    document.getElementById("exp-workshop")?.scrollIntoView({ behavior: "smooth", block: "start" });
    sound.tab();
  };

  // Deep zones are visited through the hangar: they are visible-but-locked until
  // the colony owns enough hazmat for a single-scientist recon team (suits =
  // exploration key). Alloys (extraction key) are policed by the risk pop-up.
  const deepZones = ZONES.filter((z) => isDeepZone(z.radiationLevel));
  const mildZones = ZONES.filter((z) => !isDeepZone(z.radiationLevel));
  const accessibleDeep = deepZones.filter((z) => state.resources.hazmat >= Math.max(1, hazmatPerScientist(z.radiationLevel)));
  const accessible = [...mildZones, ...accessibleDeep];
  // If the destination arrived from the globe it can be a deep site this
  // colony can't reach yet — the picker must still NAME it (the room is
  // showing that site on purpose), not silently display another site.
  const selZone = getZone(sel);
  const selListed = accessible.some((z) => z.id === selZone.id);
  // The skinned site picker's rows: every reachable site, with the current
  // destination first when it arrived from the globe beyond this colony's
  // reach (a deep site) — the picker must show the site being explored.
  const pickerZones = selListed ? accessible : [selZone, ...accessible];
  const zoneThumb = (z: Zone) => (z.owner !== "shared" && z.owner !== "special" ? `/art/globe/${z.owner}-globe.webp` : "/art/pages/exploration-banner.webp");
  const ownerLine = (z: Zone) => (z.owner === "shared" ? t("play.zones.noRaceHome", "No race's home") : z.owner !== "special" ? t("play.zones.ownerTerritory", "{race} territory", { race: getRace(z.owner).name }) : "");

  const commit = () => {
    const zone = getZone(sel);
    // Tier 0 stepping-out gear gates fielding ANY expedition.
    if (!stepOut) {
      onFlash(t("play.exp.stepOutFlash", "The Cradle hasn't stepped out yet. Forge a Medical kit, a Mechanics kit, and an Armor kit in the 🏭 Workshop below before any team leaves."));
      sound.error();
      return;
    }
    const cost = engineHelpers.suppliesCost(state, zone);
    if (state.resources.supplies < cost) {
      onFlash(t("play.exp.suppliesFlash", "Not enough supplies. {zone} needs {cost} 📦, have {have}.", { zone: zone.name, cost, have: Math.floor(state.resources.supplies) }));
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
      {/* the Cradle name plate + domain tiles (owner 2026-10-01: moved here from
          the top of the Cradle page — the colony's home now greets expeditions) */}
      <CradlePlate state={state} onDeploy={onDeploy} />
      {/* exploration vista behind the page header (owner 2026-10-01: every page
          gets a background picture) */}
      <PageBanner
        image="/art/pages/exploration-banner.webp"
        raceId={state?.race}
        skinDir="exploration"
        title={t("exp.title")}
        focal="center 60%"
        className="mt-6 rounded-xl"
      />
      {/* THE DEPOT STALL (owner 2026-10-14): the store's door in the world.
          The Exploration page is the depot — teams launch here, the workshop
          below builds expedition gear here — so the market keeps its counter
          here too: one striped awning, one honest sign, and through it the
          Cradle Ledger (daily specials, war bundles, supplies). The store
          stays a place you walk into, never a floating tab. */}
      <section
        data-testid="expedition-market-stall"
        className="mt-4 overflow-hidden rounded-xl border border-amber-200/30 bg-surf-2"
      >
        <div
          aria-hidden="true"
          className="h-3"
          style={{
            background: "repeating-linear-gradient(45deg, #92400e 0 10px, #f59e0b 10px 20px)",
          }}
        />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Icon name="crate" size={26} className="shrink-0 text-amber-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-text-1">
              {t("exp.market.title", "War Market — Depot Stall")}
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-text-3">
              {t(
                "exp.market.sub",
                "Daily specials, war bundles and supplies at the depot counter. The workshop below builds what the market doesn't stock.",
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="expedition-market-enter"
            onClick={onOpenStore}
            className="flex min-h-tap flex-none items-center gap-1.5 rounded-lg border border-amber-200/50 bg-surf-3 px-4 py-2 text-sm font-bold text-amber-100"
          >
            <Icon name="ledger" size={15} className="shrink-0 text-amber-300" aria-hidden="true" />
            {t("exp.market.enter", "Enter the War Market")}
          </button>
        </div>
      </section>
      <div className="mt-3">
        <p className="text-sm text-gray-400">{t("play.exp.teamsAway", "Teams away:")} <b className="text-white">{active.length}/{maxSlots}</b> {!canLaunch && <span className="text-amber-300">{t("play.exp.moreSlots", " — deploy Logistics AI for more slots")}</span>}</p>
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
                  <Tooltip content={tip({ what: t("play.zones.tipActiveWhat", "Active exploration — a team out in the Shatterlands."), does: t("play.zones.tipActiveDoes", "Runs in real time and resolves while you're away, returning Embers (and maybe a Chipset) to the Cradle."), how: t("play.zones.tipActiveHow", "Returns automatically once the timer hits zero. Runs launched under-geared carry their accepted radiation loss.") })}><span className="font-semibold text-amber-100">🚚 {e.label}</span></Tooltip>
                  <span className="text-xs text-gray-400">{t("play.exp.scientistCount", "{n} scientist(s)", { n: e.assignedScientists })}{e.lossPct ? t("play.exp.lossPct", " · ☢️ {pct}%", { pct: e.lossPct }) : ""}</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{t("exp.returnsIn")} <b className="text-amber-200"><Bdi dir="ltr">{fmtDuration(t, msLeft)}</Bdi></b></p>
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
            🏗️ <b>{t("play.exp.stepOutTitle", "The Cradle hasn't stepped out yet.")}</b> {t("play.exp.stepOutBodyA", "Fielding any exploration requires everyday logistics gear forged in the")} <b className="text-amber-200">{t("play.exp.stepOutWorkshop", "🏭 Workshop")}</b> {t("play.exp.stepOutBodyB", "below: a")} <b>{t("play.exp.kitMedical", "Medical kit")}</b> {t("play.exp.stepOutSep1", "🩺, a")} <b>{t("play.exp.kitMech", "Mechanics kit")}</b> {t("play.exp.stepOutSep2", "🔧, and an")} <b>{t("play.exp.kitArmor", "Armor kit")}</b> {t("play.exp.stepOutTail", "🛡️ (Tier 0, ~18 📦 total). Forge all three before you Commit.")}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="w-full text-xs text-gray-400">{t("exp.destination")}</label>
          {/* Skinned site picker (owner 2026-10-14): the native <select> was a
              blocky black-and-white OS widget dropped into a fully-skinned
              game. The destination is picked from an in-fiction site list —
              the world's own artwork, territory, risk and cost at a glance,
              full-width tappable rows. The picked site IS the explored site:
              `sel` is PlayPage-owned (see the zoneId prop), so a site chosen
              on the globe is the site this room is set on. */}
          <button
            type="button"
            data-testid="site-picker-button"
            aria-expanded={pickerOpen}
            onClick={() => { setPickerOpen((o) => !o); sound.click(); }}
            style={{ backgroundImage: `linear-gradient(rgba(4,6,10,.78), rgba(4,6,10,.78)), url(/art/exploration/${state.race}-skin.webp)`, backgroundSize: "cover", backgroundPosition: "center" }}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-amber-400/40 bg-black/60 px-3 py-2 text-left hover:border-amber-300"
          >
            <img src={zoneThumb(selZone)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{selZone.name}{isDeepZone(selZone.radiationLevel) ? " ☢️" : ""}</span>
              <span className="block truncate text-[11px] uppercase text-text-3">{ownerLine(selZone)}</span>
            </span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1 text-[11px]">
              <span className="rounded bg-white/10 px-2 py-0.5 text-red-300">{t("play.zones.risk", "Risk {n}", { n: selZone.risk })}</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-lime-300">{t("play.zones.cost", "Cost {n} 📦", { n: engineHelpers.suppliesCost(state, selZone) })}</span>
            </span>
            <span aria-hidden className="shrink-0 text-lg text-amber-300">{pickerOpen ? "▴" : "▾"}</span>
          </button>
          {pickerOpen && (
            <div data-testid="site-picker-panel" className="w-full overflow-hidden rounded-xl border border-white/15 bg-black/80">
              <div
                className="flex items-center justify-between border-b border-white/10 py-1.5 pe-1.5 ps-3"
                style={{ backgroundImage: `linear-gradient(rgba(4,6,10,.85), rgba(4,6,10,.85)), url(/art/exploration/${state.race}-skin.webp)`, backgroundSize: "cover", backgroundPosition: "center" }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-200">{t("play.zones.pickerTitle", "Choose a site")}</span>
                <button type="button" aria-label={t("play.zones.pickerClose", "Close site list")} onClick={() => { setPickerOpen(false); sound.click(); }} className="flex h-11 w-11 items-center justify-center rounded-lg text-lg text-gray-200 hover:bg-white/10">✕</button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {pickerZones.map((z) => {
                  const isSel = z.id === sel;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      data-testid={`site-row-${z.id}`}
                      aria-current={isSel || undefined}
                      onClick={() => { setSel(z.id); setPickerOpen(false); sound.tab(); }}
                      className={`flex min-h-[56px] w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left last:border-b-0 ${isSel ? "bg-amber-400/10" : "hover:bg-white/5"}`}
                    >
                      <img src={zoneThumb(z)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">{z.name}{isDeepZone(z.radiationLevel) ? " ☢️" : ""}</span>
                        <span className="block truncate text-[11px] text-gray-400">{z.flavor}</span>
                      </span>
                      <span className="flex max-w-[148px] shrink-0 flex-wrap justify-end gap-1 text-[11px]">
                        <span className="rounded bg-white/5 px-2 py-0.5 text-red-300">{t("play.zones.risk", "Risk {n}", { n: z.risk })}</span>
                        {z.radiationLevel > 0 && <span className="rounded bg-amber-400/10 px-2 py-0.5 text-amber-300">{t("play.zones.radiation", "☢️ {n}", { n: z.radiationLevel })}</span>}
                        <span className="rounded bg-white/5 px-2 py-0.5 text-lime-300">{t("play.zones.cost", "Cost {n} 📦", { n: engineHelpers.suppliesCost(state, z) })}</span>
                      </span>
                      {isSel && <span className="shrink-0 rounded bg-ember px-2 py-0.5 text-[11px] font-semibold text-black">{t("play.zones.destinationTag", "Destination")}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Tooltip content={tipT(t, "lab", "scientists", LAB_TIPS.scientists)}><label className="text-xs text-gray-400">{t("exp.scientists")}</label></Tooltip>
          <input type="number" min={1} max={state.scientists} value={sci} onChange={(e) => setSci(Math.max(1, Math.min(state.scientists, Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-white/15 bg-black/60 px-2 py-2 text-white outline-none focus:border-amber-400" />
          <Tooltip content={tip({ what: t("play.zones.tipCommitWhat", "Commit Supplies — launch this exploration."), does: t("play.zones.tipCommitDoes", "Spends the destination's Supplies cost and sends your team out in real time. Deep zones open the pre-launch risk pop-up first. Farther sites also draw on the convoy's fuel & battery stores."), how: t("play.zones.tipCommitHow", "Requires a stepped-out Cradle (Tier 0 kits), enough Supplies, a free field slot, and enough fuel/battery for the distance. Returns Embers (and maybe a Chipset) when it completes.") })}>
            <button onClick={commit} disabled={!canLaunch} className="ms-auto rounded-lg bg-ember px-5 py-2 font-semibold text-black hover:brightness-110 disabled:opacity-40">
              {t("play.exp.commit", "Commit Supplies")}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* the workshop — the page's own forge (owner 2026-09-30: most of it is
          built FOR exploration, so it lives here now, with a value box per kit
          instead of the old one-at-a-time sheet) */}
      <div id="exp-workshop" className="mt-6 scroll-mt-24">
        <WorkshopShelf state={state} onCraft={onCraft} />
      </div>

      {/* zone list — mild zones */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {mildZones.map((z) => {
          const cost = engineHelpers.suppliesCost(state, z);
          const stats = engineHelpers.zoneProspects(state, z);
          const ownerRace = z.owner !== "shared" && z.owner !== "special" ? getRace(z.owner) : null;
          const owner = z.owner === "shared" ? t("play.zones.noRaceHome", "No race's home") : ownerRace ? t("play.zones.ownerTerritory", "{race} territory", { race: ownerRace.name }) : "";
          const ownerTip = z.owner === "shared"
            ? OWNER_TIPS.shared
            : ownerRace
              ? { what: t("play.zones.ownerTipWhat", "{race} territory — a home region of the Shatterlands.", { race: ownerRace.name }), does: t("play.zones.ownerTipDoes", "Rich in that race's own AI — embers, chipsets, and a UNIQUE territory material used in the alloy recipe. Every race is incomplete alone."), how: t("play.zones.ownerTipHow", "Reach this region to loot {race} embers + their territory material alongside the site's base yield.", { race: ownerRace.name }) }
              : OWNER_TIPS.shared;
          return (
            <div key={z.id} className={`rounded-xl border p-4 ${sel === z.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30"}`} onClick={() => { setSel(z.id); sound.tab(); }}>
              <div className="flex items-baseline justify-between gap-2">
                <Tooltip content={tip({ what: z.name, does: z.flavor, how: t("play.zones.selectHow", "Select it above and Commit Supplies to send a team here.") })}><span className="font-semibold text-white cursor-pointer">{z.name}</span></Tooltip>
                <Tooltip content={tip(ownerTip)}><span className="text-[11px] uppercase text-text-3">{owner}</span></Tooltip>
              </div>
              <p className="mt-1 text-xs text-gray-400">{z.flavor}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <Tooltip content={tipT(t, "expedition", "risk", EXPEDITION_TIPS.risk)}><span className="rounded bg-white/5 px-2 py-0.5 text-red-300">{t("play.zones.risk", "Risk {n}", { n: z.risk })}</span></Tooltip>
                <Tooltip content={tipT(t, "expedition", "radiation", EXPEDITION_TIPS.radiation)}><span className={`rounded px-2 py-0.5 ${z.radiationLevel > 0 ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-gray-400"}`}>{t("play.zones.radiation", "☢️ {n}", { n: z.radiationLevel })}</span></Tooltip>
                {z.radiationLevel >= 20 && z.radiationLevel < DEEP && (
                  <Tooltip content={tipT(t, "expedition", "radiation", EXPEDITION_TIPS.radiation)}><span className="rounded bg-amber-400/10 px-2 py-0.5 text-amber-300/90">{t("play.zones.mildRad", "⚠️ mild radiation — recovery possible but thin without shots")}</span></Tooltip>
                )}
                {ownerRace && <Tooltip content={tipT(t, "resource", "mats", RESOURCE_TIPS.mats)}><span className="rounded bg-white/5 px-2 py-0.5 text-purple-300">{t("play.zones.material", "◈ material: {m}", { m: ownerRace.name.replace("The ", "") })}</span></Tooltip>}
                <Tooltip content={tipT(t, "expedition", "embers", EXPEDITION_TIPS.embers)}><span className="rounded bg-white/5 px-2 py-0.5 text-amber-200">{t("play.zones.embers", "~{n} Embers", { n: stats.embers })}</span></Tooltip>
                <Tooltip content={tipT(t, "expedition", "chipset", EXPEDITION_TIPS.chipset)}><span className="rounded bg-white/5 px-2 py-0.5 text-cyan-300">{t("play.zones.chipset", "Chipset {pct}%", { pct: Math.round(stats.chipsetChance * 100) })}</span></Tooltip>
                <Tooltip content={tipT(t, "expedition", "cost", EXPEDITION_TIPS.cost)}><span className="rounded bg-white/5 px-2 py-0.5 text-lime-300">{t("play.zones.cost", "Cost {n} 📦", { n: cost })}</span></Tooltip>
              </div>
              <SiteNeeds state={state} zone={z} scientists={sci} />
            </div>
          );
        })}
      </div>

      {/* the hangar — deep radiation zones, visible but gated */}
      <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-white">{t("play.zones.hangarTitle", "☢️ The Hangar — Deep Shatterlands")} <span className="text-xs font-normal text-gray-400">{t("play.zones.hangarSub", "— visually distant, radiation-locked")}</span></h3>
          <span className="text-[11px] text-gray-400">{t("exp.suits")}</span>
        </div>
        {deepZones.map((z) => {
          const locked = !accessibleDeep.includes(z);
          const cost = engineHelpers.suppliesCost(state, z);
          const stats = engineHelpers.zoneProspects(state, z);
          return (
            <div key={z.id} className={`mt-3 rounded-xl border p-4 ${locked ? "border-white/10 bg-black/40 opacity-70" : sel === z.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Tooltip content={tip({ what: t("play.zones.deepTipWhat", "{zone} — a hangared deep site.", { zone: z.name }), does: z.flavor, how: locked ? t("play.zones.deepTipLocked", "Locked until you forge enough hazmat for a suited recon team. Craft suits in the Workshop.") : t("play.zones.deepTipUnlocked", "Selectable through the hangar. Committing opens the pre-launch risk pop-up.") })}>
                  <span className={`font-semibold ${locked ? "text-text-3" : "text-white"}`}>{locked ? "🔒 " : "☢️ "}{z.name}</span>
                </Tooltip>
                <span className="text-[11px] uppercase text-text-3">{t("exp.deepSite")}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{z.flavor}</p>
              {locked ? (
                <p className="mt-2 text-xs text-amber-300/90">{t("play.zones.hangaredA", "🔒 Hangared — needs ")}<b className="text-amber-200">{t("play.zones.hangaredSuits", "{n} hazmat suit(s)", { n: Math.max(1, hazmatPerScientist(z.radiationLevel)) })}</b>{t("play.zones.hangaredB", " for a suited recon team before this deep site is reachable. Forge them in the 🏭 Workshop below.")}</p>
              ) : (
                <>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <Tooltip content={tipT(t, "expedition", "risk", EXPEDITION_TIPS.risk)}><span className="rounded bg-white/5 px-2 py-0.5 text-red-300">{t("play.zones.risk", "Risk {n}", { n: z.risk })}</span></Tooltip>
                  <Tooltip content={tipT(t, "expedition", "radiation", EXPEDITION_TIPS.radiation)}><span className="rounded bg-red-400/10 px-2 py-0.5 text-red-300">{t("play.zones.deepRadiation", "☢️ {n} deep radiation", { n: z.radiationLevel })}</span></Tooltip>
                  <Tooltip content={tipT(t, "expedition", "embers", EXPEDITION_TIPS.embers)}><span className="rounded bg-white/5 px-2 py-0.5 text-amber-200">{t("play.zones.embers", "~{n} Embers", { n: stats.embers })}</span></Tooltip>
                  <Tooltip content={tipT(t, "expedition", "chipset", EXPEDITION_TIPS.chipset)}><span className="rounded bg-white/5 px-2 py-0.5 text-cyan-300">{t("play.zones.chipset", "Chipset {pct}%", { pct: Math.round(stats.chipsetChance * 100) })}</span></Tooltip>
                  <Tooltip content={tipT(t, "expedition", "cost", EXPEDITION_TIPS.cost)}><span className="rounded bg-white/5 px-2 py-0.5 text-lime-300">{t("play.zones.cost", "Cost {n} 📦", { n: cost })}</span></Tooltip>
                <Tooltip content={tipT(t, "expedition", "alloyShort", EXPEDITION_TIPS.alloyShort)}>
                  <span className={`rounded px-2 py-0.5 ${state.resources.alloys >= 1 ? "bg-ember/10 text-ember-soft" : "bg-red-400/10 text-red-300"}`}>
                    {state.resources.alloys >= 1 ? t("play.zones.extractReady", "⚙️ extraction ready") : t("play.zones.noAlloy", "⚙️ no alloy — find ≠ retrieve")}
                  </span>
                </Tooltip>
              </div>
              <SiteNeeds state={state} zone={z} scientists={sci} />
              </>
            )}
              {!locked && (
                <button onClick={() => { setSel(z.id); sound.tab(); setRiskZone(null); }} disabled={sel === z.id} className="mt-2 rounded border border-white/15 px-3 py-1 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-40">
                  {sel === z.id ? t("play.zones.readyCommit", "✓ Ready — Commit Supplies above") : t("play.zones.selectDeep", "Select this deep site")}
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
          onPrepare={() => { setRiskZone(null); scrollToWorkshop(); onFlash(t("play.exp.workshopFlash", "The Workshop is just below — forge what's missing, then Commit.")); }}
          onSafer={() => {
            setRiskZone(null);
            const safe = mildZones.find((z) => z.radiationLevel === 0) || mildZones[0];
            if (safe) { setSel(safe.id); onFlash(t("play.exp.saferFlash", "Selected a safer destination. The deep can wait.")); }
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
  const table: { id: MaterialSheetId; icon: string; label: string; have: number; need: number }[] = [
    { id: "hazmat", icon: "🧥", label: t("play.gear.hazmatLabel", "Hazmat suits"), have: r.hazmat, need: need.hazmat },
    { id: "shots", icon: "💉", label: t("play.gear.shotsLabel", "Radiation shots"), have: r.shots, need: need.shots },
    { id: "alloy", icon: "⚙️", label: t("play.gear.alloyArmedLabel", "Alloy-armed diggers"), have: r.alloys, need: need.alloys },
  ];
  // OWNER 2026-09-30: this pop-up explains what's missing — it stays open until
  // the player clicks it shut. No backdrop-click dismiss, no Escape dismiss; the
  // ✕ and the three choice buttons below are the only ways out.
  return (
    <div className="fixed inset-0 z-[90] modal-wrap bg-black/75">
      <div className="my-auto w-full max-w-lg rounded-2xl border border-red-400/40 bg-[#0b0e16] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-red-300">{t("play.risk.title", "☢️ High radiation: {zone}", { zone: zone.name })}</h3>
          <button onClick={onCancel} aria-label={t("play.common.cancel", "Cancel")} className="flex min-h-11 min-w-11 items-center justify-center rounded border border-white/15 px-2.5 py-2 text-sm text-gray-400 hover:bg-white/10">✕</button>
        </div>

        <div className={`mt-4 rounded-lg border p-3 text-center ${fullyCovered ? "border-ember/30 bg-ember/5" : "border-red-400/30 bg-red-400/5"}`}>
          <div className={`text-3xl font-bold ${fullyCovered ? "text-ember-soft" : success >= 50 ? "text-amber-300" : "text-red-300"}`}>
            {t("play.risk.cleanReturn", "Clean return: {pct}%", { pct: success })}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {t("play.risk.teamLine", "Team of {n} into {zone} ({rad} radiation)", { n: scientists, zone: zone.name, rad: zone.radiationLevel })}
            {fullyCovered ? t("play.risk.fullyGeared", " — fully geared, the run should come back clean.") : t("play.risk.projectedLoss", " — projected loss {pct}%: attrition, reduced loot{cas}.", { pct: loss, cas: scientists > 1 ? t("play.risk.casualties", ", possible scientist casualties") : "" })}
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
                    <td className="py-1.5 text-gray-300">
                      <button
                        type="button"
                        onClick={() => openMaterialSheet({ id: row.id, count: Math.floor(row.have) })}
                        className="py-1 text-left underline decoration-dotted decoration-gray-500 underline-offset-2 hover:text-text-1"
                      >
                        {row.icon} {row.label} <span aria-hidden="true" className="text-text-3">ⓘ</span>
                      </button>
                    </td>
                    <td className="py-1.5 text-end">
                      {row.need > 0 ? (
                        <span className={ok ? "text-ember-soft" : "text-red-300"}>
                          {row.have}/{row.need} <span className="text-text-3">{t("play.risk.coverPct", "({pct}% cover)", { pct: Math.round(cover * 100) })}</span>
                        </span>
                      ) : (
                        <span className="text-ember-soft">{t("play.risk.notNeeded", "not needed")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-400">
            {t("play.risk.gearExplainer", "Suits are the exploration key — they let you get in and look. Alloy-armed diggers are the extraction key — without them you find, but largely cannot bring it back. What you lack shapes the loss rate. Losing scientists never wipes your colony below one; corruption rises with the taint left behind.")}
          </p>
        </div>

        <p className="mt-4 text-center text-xs italic text-text-3">{t("play.risk.quote", "\"You are always free to go. This is what you risk.\"")}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={onGo} className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-400">
            {t("play.risk.goAnyway", "☢️ Go Anyway — accept {pct}% loss", { pct: loss })}
          </button>
          <button onClick={onPrepare} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-400/20">
            {t("play.risk.goPrepare", "🏭 Go Back & Prepare")}
          </button>
          <button onClick={onSafer} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/10">
            {t("play.risk.safer", "🗺️ Safer Destination")}
          </button>
          <button onClick={onCancel} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-400 hover:bg-white/10">
            {t("play.common.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Lab tab ---------------- */

function LabTab({ state, now, onStudy, onDeploy, onBeginResearch, onAllocatePoint, onChooseSpec, onChooseRevelation, onBuildProbe, onLaunchProbe, onCollectProbe }: { state: GameState; now: number; onStudy: (k: "ember" | "chipset") => void; onDeploy: (d: DomainId) => void; onBeginResearch: (techId: string, leaderId: string) => void; onAllocatePoint: (leaderId: string, attr: "research" | "economy" | "combat" | "engineering") => void; onChooseSpec: (leaderId: string, path: "scholar" | "marshal" | "quartermaster") => void; onChooseRevelation: (choice: "sealed" | "open") => void; onBuildProbe: () => void; onLaunchProbe: (serverId: string) => void; onCollectProbe: (probeId: string) => void }) {
  const t = useT();
  const studying = engineHelpers.studying(state);
  const busy = studying.length >= state.scientists;
  const r = state.resources;
  const [view, setView] = useState<"deploy" | "research" | "leaders">("deploy");
  const leaderCount = state.leaders.filter((l) => l.status === "active").length;
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* lab interior behind the page header (owner 2026-10-01: every page gets
          a background picture — Hans's own lab photo wasn't in the media
          library, so this one was generated to match the game's art) */}
      <PageBanner
        image="/art/pages/lab-banner.webp"
        title={t("lab.title")}
        sub={
          <>{t("play.lab.twoTracks", "Two tracks:")} <b className="text-amber-200">{t("play.lab.trackRecovered", "Recovered AI")}</b> {t("play.lab.trackRecoveredSub", "(study Embers & Chipsets → Deploy) and")} <b className="text-purple-300">{t("play.lab.trackHuman", "Human knowledge")}</b> {t("play.lab.trackHumanSub", "(spend 📜 Codices on the Research Tree, run by your Leaders).")}</>
        }
        focal="center 45%"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {([["deploy", t("lab.tabDeploy")], ["research", t("lab.tabResearch")], ["leaders", t("lab.tabLeaders", { n: leaderCount, cap: engineHelpers.leaderSlots(state) })]] as [typeof view, string][]).map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); sound.tab(); }} className={`rounded-lg px-3 py-2 text-sm font-medium ${view === id ? "bg-ember text-black" : "text-gray-300 hover:bg-white/10"}`}>{label}</button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 items-center text-sm">
        <Tooltip content={tipT(t, "resource", "insight", RESOURCE_TIPS.insight)}><button type="button" onClick={() => openMaterialSheet({ id: "insight", count: Math.round(state.insight) })} className="rounded-lg bg-ember/10 border border-ember/30 px-3 py-1.5 text-ember-soft">{t("play.lab.insight", "Insight: {n}", { n: Math.round(state.insight) })} <span aria-hidden="true" className="opacity-70">ⓘ</span></button></Tooltip>
        <Tooltip content={tipT(t, "resource", "codices", RESOURCE_TIPS.codices)}><button type="button" onClick={() => openMaterialSheet({ id: "codices", count: state.codices })} className="rounded-lg bg-purple-400/10 border border-purple-400/30 px-3 py-1.5 text-purple-200">{t("play.lab.codices", "📜 Codices: {n}", { n: state.codices })} <span aria-hidden="true" className="opacity-70">ⓘ</span></button></Tooltip>
        <Tooltip content={tipT(t, "lab", "scientists", LAB_TIPS.scientists)}><span className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-gray-300">{t("play.lab.scientists", "Scientists: {n}", { n: state.scientists })} <span className="text-text-3">{t("play.lab.scientistsBusy", "({busy} busy / {cap} cap)", { busy: studying.length, cap: engineHelpers.scientistCap(state) })}</span></span></Tooltip>
      </div>

      {view === "research" && <ResearchTreeView state={state} now={now} onBeginResearch={onBeginResearch} onBuildProbe={onBuildProbe} onLaunchProbe={onLaunchProbe} onCollectProbe={onCollectProbe} />}
      {engineHelpers.hasRevelation(state, "rv3") && !state.revelationAnswered && <RevelationChoiceModal onPick={onChooseRevelation} />}
      {view === "leaders" && <LeadersView state={state} now={now} onAllocatePoint={onAllocatePoint} onChooseSpec={onChooseSpec} />}

      {view === "deploy" && (<>
      {/* study */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
        <Tooltip content={tipT(t, "lab", "studyEmbers", LAB_TIPS.studyEmbers)}>
          <h3 className="font-semibold text-white">{t("lab.studyTitle")}</h3>
        </Tooltip>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Tooltip content={tipT(t, "lab", "studyEmbers", LAB_TIPS.studyEmbers)}>
              <div className="flex items-center justify-between"><span className="font-semibold text-amber-200">{t("lab.studyEmbers")}</span><span className="text-xs text-text-3">{t("play.lab.studyCostEmber", "cost: 2 🧯 · ~{secs}s", { secs: engineHelpers.studySecs(state, "ember") })}</span></div>
            </Tooltip>
            <p className="mt-1 text-xs text-gray-400">{t("play.lab.studyEmberDesc", "Consumes 2 Embers, yields ~{n} insight, over real time.", { n: engineHelpers.insightFor(state, "ember") })}</p>
            <div className="mt-2">
              <MaterialTag id="embers" count={Math.floor(r.embers)} />
            </div>
            <button onClick={() => onStudy("ember")} disabled={busy || r.embers < 2} className="mt-3 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
              {busy ? t("play.lab.allBusy", "All scientists busy") : r.embers < 2 ? t("play.lab.needEmbers", "Need 2 Embers") : t("play.lab.beginStudy", "Begin Study")}
            </button>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
            <Tooltip content={tipT(t, "lab", "studyChipset", LAB_TIPS.studyChipset)}>
              <div className="flex items-center justify-between"><span className="font-semibold text-cyan-300">{t("lab.studyChipset")}</span><span className="text-xs text-text-3">{t("play.lab.studyCostChipset", "1 🔩 · ~{secs}s", { secs: engineHelpers.studySecs(state, "chipset") })}</span></div>
            </Tooltip>
            <p className="mt-1 text-xs text-gray-400">{t("play.lab.studyChipsetDesc", "Consumes a rare Chipset, yields ~{n} insight. A real leap forward.", { n: engineHelpers.insightFor(state, "chipset") })}</p>
            <div className="mt-2">
              <MaterialTag id="chipsets" count={r.chipsets} />
            </div>
            <button onClick={() => onStudy("chipset")} disabled={busy || r.chipsets < 1} className="mt-3 w-full rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40">
              {busy ? t("play.lab.allBusy", "All scientists busy") : r.chipsets < 1 ? t("play.lab.needChipset", "Need a Chipset") : t("play.lab.beginStudy", "Begin Study")}
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
                    <span>{s.kind === "ember" ? t("play.lab.studyingEmbers", "🔬 Studying Embers") : t("play.lab.studyingChipset", "🔬 Studying a Chipset")}</span>
                    <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, s.startedAt + s.durationMs - now))}</Bdi> {t("play.lab.timeLeft", "left")}</span>
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
        <Tooltip content={tipT(t, "lab", "deploy", LAB_TIPS.deploy)}>
          <h3 className="font-semibold text-white">{t("lab.deployTitle")} <span className="text-xs font-normal text-gray-400">{t("lab.deploySub")}</span></h3>
        </Tooltip>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((d) => {
            const cost = engineHelpers.deployCost(state, d.id);
            const atMax = engineHelpers.domainAtMax(state, d.id);
            const can = !atMax && r.embers >= cost.embers && state.insight >= cost.insight;
            return (
              <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <Tooltip content={tipT(t, "domain", d.id, DOMAIN_TIPS[d.id])}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{d.icon} {t(`domain.${d.id}.name`, d.name)}</span>
                    {/* `tile.lv` keeps its own English byte-for-byte ("Lv 3") and its
                        Persian ("سطح 3") is already the right way round — a dir="ltr"
                        run around a translated label+numeral would MIRROR the phrase,
                        so the isolated-node fix for that shape is the renderer
                        decision this slice does not take. */}
                    <span className="text-xs text-amber-300">{t("tile.lv", { level: state.deployedDomains[d.id] })}</span>
                  </div>
                </Tooltip>
                <p className="mt-1 text-xs text-gray-400">{domainDescription(t, d.id, d.description)}</p>
                <Tooltip content={tipT(t, "lab", "deployButton", LAB_TIPS.deployButton)}>
                  {/* the Cradle's own cost line, same words, same key: "… Embers · … insight" */}
                  <p className="mt-2 text-xs text-text-3">{t("cradle.advanceSub", "{embers} Embers · {insight} insight", { embers: cost.embers.toLocaleString(), insight: cost.insight.toLocaleString() })}</p>
                </Tooltip>
                {atMax ? (
                  <p className="mt-2 text-xs text-text-3">{t("cradle.domainMaxReason")}</p>
                ) : (
                  <Tooltip content={tipT(t, "lab", "deployButton", LAB_TIPS.deployButton)}>
                    <button onClick={() => onDeploy(d.id)} disabled={!can} className="mt-2 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                      {/* the catalogue's ONE word for this action (the landing page spells it,
                          the Cradle spells it به‌کارگیری): a new `lab.deployAction` key would
                          be a new key, which this slice adds none of. */}
                      {t("landing.step.deploy.title", "Deploy")}
                    </button>
                  </Tooltip>
                )}
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
      {/* armory interior behind the page header (owner 2026-10-01: every page
          gets a background picture) */}
      <PageBanner
        image="/art/pages/armory-banner.webp"
        title={t("play.armory.title", "🏛️ The Armory")}
        sub={
          <>
            {race ? <><span style={{ color: race.accentText }}>{race.name}</span>{t("play.armory.raceIntro", "'s mustered war hardware — built at the Cradle from supplies, embers, fuel and refined ")}<b className="text-fuchsia-300">{t("play.armory.plasmaWord", "plasma")}</b>{t("play.armory.raceIntroTail", ".")}</> : t("play.armory.genericIntro", "War hardware, built at the Cradle.")} {t("play.armory.earnedOnly", "Earned only — nothing here is ever bought.")}
          </>
        }
        focal="center 55%"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Tooltip content={tipT(t, "armory", "plasma", ARMORY_TIPS.plasma)}>
          <span className="rounded-lg bg-fuchsia-400/10 border border-fuchsia-400/30 px-3 py-1.5 text-fuchsia-200">{t("play.armory.plasma", "🔮 Plasma: {n}", { n: Math.floor(r.plasma) })}</span>
        </Tooltip>
      </div>
      {!hubDone ? (
        <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-6 text-sm text-gray-300">
          <p className="text-amber-200 font-semibold">{t("play.armory.notOpened", "🔒 The Armory hasn't been opened.")}</p>
          <p className="mt-1 text-xs text-gray-400">{t("play.armory.forgesAnswer", "The forges answer only to the Cradle's command. Research ")}<b className="text-purple-300">{t("play.armory.armoryWord", "🏛️ Armory")}</b>{t("play.armory.forgesTail", " in the Lab (🌳 Research — the amber section) to begin building weapon families.")}</p>
        </div>
      ) : families.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-gray-400">
          {t("play.armory.noFamilies", "This world's race has no catalogued war families yet — the Watchers' catalog ships with the beta world; other races' catalogs arrive with their worlds.")}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span className="rounded-lg bg-white/5 border border-white/10 px-2 py-1">{t("play.armory.researched", "🏛️ Armory researched")}</span>
            <Tooltip content={tipT(t, "armory", "plasmaRefine", ARMORY_TIPS.plasmaRefine)}>
              <button onClick={() => { sound.click(); onRefine(); }} disabled={!engineHelpers.hasTech(state, "plasma_refinement") || r.embers < PLASMA_REFINE_EMBERS}
                className="rounded-lg bg-fuchsia-400/15 border border-fuchsia-400/40 px-3 py-1.5 text-fuchsia-200 hover:bg-fuchsia-400/25 disabled:opacity-40">
                {!engineHelpers.hasTech(state, "plasma_refinement") ? t("play.armory.refineLocked", "🔒 Plasma Refinement (research in Lab)") : t("play.armory.refine", "🔮 Refine {n} 🧯 → 1 plasma", { n: PLASMA_REFINE_EMBERS })}
              </button>
            </Tooltip>
            <span className="text-[11px] text-text-3">{t("play.armory.plasmaNote", "Deep chipset sites also bleed raw plasma — the risk-of-depth reward.")}</span>
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
                  {/* weapon thumbnail — public/art/loadout/weapons/{race}-{family}.webp */}
                  <div className="flex items-start gap-3">
                    <img
                      src={weaponThumbUrl(state.race ?? "watchers", f.id)}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 shrink-0 rounded-xl border border-white/15 object-cover"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tooltip content={tip({ what: model ?? t("play.armory.notBuilt", "Not built yet"), does: f.identity, how: t("play.armory.familyHow", "Researched: {tech}. Built in real time at the Cradle — upgrades require the current tier's resources.", { tech: unlockTech ? unlockTech.name : "" }) })}>
                          <h3 className="font-semibold text-white">{f.name}</h3>
                        </Tooltip>
                        <span className="text-[11px] uppercase tracking-wider text-text-3">{f.role}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] italic text-gray-400">{f.identity}</p>
                    </div>
                  </div>
                  {/* tier pips 1-4 */}
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-text-3">{t("play.armory.tier", "Tier")}</span>
                    {[1, 2, 3, 4].map((t) => (
                      <span key={t} className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${tier >= t ? "bg-ember text-black" : "bg-white/10 text-text-3"}`}>{t}</span>
                    ))}
                    {build && <span className="ms-auto text-[11px] text-purple-300">{t("play.armory.timeLeft", "{dur} left", { dur: fmtDuration(t, leftMs) })}</span>}
                  </div>
                  {!unlocked ? (
                    <div className="mt-3 rounded-lg border border-purple-400/20 bg-purple-400/5 p-2.5 text-[11px] text-purple-200">
                      {t("play.armory.lockedA", "🔒 Forges locked — research ")}<b>{unlockTech ? `${unlockTech.icon} ${unlockTech.name}` : t("play.armory.lockedFallback", "the family's forge")}</b>{t("play.armory.lockedB", " in the Lab to unlock.")}
                    </div>
                  ) : tier < 1 ? (
                    <div className="mt-3 space-y-2">
                      {/* T1 preview + build */}
                      <StatsRow stats={weaponStats(f.id, 1)} label={t("play.armory.t1Primer", "T1 Primer Mk I")} />
                      {cost && <CostRow cost={cost} r={r} />}
                      <button onClick={() => { sound.click(); onBuild(f.id); }} disabled={!canAfford || !!build}
                        className="mt-1 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                        {build ? t("play.armory.forging", "Forging — {dur}", { dur: fmtDuration(t, leftMs) }) : canAfford ? t("play.armory.build", "Build ({dur})", { dur: fmtDuration(t, weaponTimeMs(1)) }) : t("play.armory.cantAfford", "Can't afford yet")}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <StatsRow stats={stats!} label={t("play.armory.nowLabel", "Now · {model}", { model: model ?? "" })} />
                      {tier < 4 && nextStats && (
                        <div className="rounded-lg border border-ember/20 bg-ember/5 p-2">
                          <StatsRow stats={nextStats} label={t("play.armory.nextLabel", "Next · {model}", { model: modelName(state.race ?? "watchers", f, nextTier) })} compare={stats!} preview />
                          {cost && <CostRow cost={cost} r={r} />}
                          <button onClick={() => { sound.click(); onBuild(f.id); }} disabled={!canAfford || !!build}
                            className="mt-1 w-full rounded-lg bg-ember px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40">
                            {build ? t("play.armory.upgrading", "Upgrading — {dur}", { dur: fmtDuration(t, leftMs) }) : canAfford ? t("play.armory.upgrade", "Upgrade ({dur})", { dur: fmtDuration(t, weaponTimeMs(nextTier)) }) : t("play.armory.cantAfford", "Can't afford yet")}
                          </button>
                        </div>
                      )}
                      {tier >= 4 && <p className="rounded-lg bg-ember/5 border border-ember/20 p-2 text-[11px] text-ember-soft">{t("play.armory.finalTier", "Final tier — this family is complete.")}</p>}
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
            <p><b className="text-gray-300">{t("play.armory.howTitle", "How the Armory works:")}</b> {t("play.armory.howA", "each family is built at")} <b className="text-amber-200">{t("play.armory.howTier1", "Tier 1")}</b> {t("play.armory.howB", "and upgraded T1→T2→T3→T4. Every tier raises")} <b className="text-white">{t("play.armory.howStats", "all four stats")}</b> <Bdi dir="ltr">{ARMORY_CONFIG.tierMult.slice(1).map((m) => `×${m}`).join(" / ")}</Bdi>{t("play.armory.howC", ", costs more, and takes real time —")} <Bdi dir="ltr">{([1, 2, 3, 4] as const).map((k) => fmtDuration(t, weaponTimeMs(k))).join(" · ")}</Bdi>{t("play.armory.howD", ". The Cradle holds")} <b className="text-amber-200">{ARMORY_BUILD_SLOTS}</b> {t("play.armory.howE", "builds at once (and never two on the same family); builds finish offline. Plasma enters at Tier 2. The battle side (later) reads these families into marches and sieges.")}</p>
            <p className="mt-1 text-[11px] text-text-3">{t("play.armory.deedA", "First weapon built and first Tier-4 weapon each earn a durable ")}<b className="text-amber-300">{t("play.armory.deedWord", "deed")}</b>{t("play.armory.deedB", " — the dent earns attention. Weapons never feed the contribution formula directly.")}</p>
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
  const t = useT();
  const rows: { id: MaterialSheetId; label: string; icon: string; have: number; need: number }[] = [
    { id: "supplies", label: t("play.gear.suppliesLabel", "Supplies"), icon: "📦", have: Math.floor(r.supplies), need: cost.supplies },
    { id: "embers", label: t("play.gear.embersLabel", "Embers"), icon: "🧯", have: Math.floor(r.embers), need: cost.embers },
    { id: "gas", label: t("play.gear.fuelLabelCost", "Fuel"), icon: "⛽", have: Math.floor(r.gas), need: cost.fuel },
  ];
  if (cost.plasma > 0) rows.push({ id: "plasma", label: t("play.gear.plasmaLabel", "Plasma"), icon: "🔮", have: Math.floor(r.plasma), need: cost.plasma });
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
      {rows.map((row) => (
        <button
          key={row.label}
          type="button"
          onClick={() => openMaterialSheet({ id: row.id, count: row.have })}
          aria-label={t("material.explain", "What is {name}? What is it for, and how do I get it?", { name: row.label })}
          className={`py-1 underline decoration-dotted decoration-gray-500 underline-offset-2 ${row.have >= row.need ? "text-lime-300" : "text-red-300"}`}
        >
          {row.icon} {row.label} {row.need} <span className="text-text-3">({row.have})</span> <span aria-hidden="true" className="text-text-3">ⓘ</span>
        </button>
      ))}
    </div>
  );
}
const PLASMA_REFINE_EMBERS = 25;
// The tier table's build time is NOT copied here (2026-09-27, the armory-tiers
// slice). `weaponTimeFor()` used to hold a second, minutes-only copy of the
// ladder ("45m" · "3h" · "12h" · "2d") — hardcoded, English and wrong the
// moment the ratified times moved to 12h/3d/12d/45d. The button now renders
// `fmtDuration(t, weaponTimeMs(tier))`: the ONE duration formatter, day-scale
// and keyed in all five languages, reading the ONE time table.
/* ---------------- Codex / lore (Rung 1a §E — folds into the Cradle as a modal) ---------------- */
function CodexContent() {
  const t = useT();
  return (
    <div>
      <div className="mt-2 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-xs text-gray-400">
        {t("play.codex.disclaimer", "Everything here is the mythology the colonies tell about the old world — never documentary fact. The races are legends worn as ways of life, not records of a real lineage. Nothing refers to any real-world group, religion, nationality, or person.")}
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
            <p className="mt-3 text-xs text-text-3">{t("play.races.homeRegion", "Home region: ")}<span className="text-gray-300">{r.homeRegion}</span></p>
            <blockquote className="mt-2 border-s-2 border-amber-400/50 ps-3 text-amber-200/80 italic">{r.flavorQuote}</blockquote>
          </div>
        ))}
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-amber-200">{UNBOUND_LEGEND.name}</h3>
            <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-200">{t("play.codex.unboundEarned", "Earned — locked")}</span>
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
  const t = useT();
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70" onClick={onClose}>
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white">{t("play.codex.title", "The Codex — Legends of the Shatterlands")}</h2>
          <button onClick={onClose} aria-label={t("play.codex.close", "Close the Codex")} className="flex min-h-11 min-w-11 items-center justify-center rounded border border-white/15 px-2.5 py-1.5 text-sm text-gray-400 hover:bg-white/10">✕</button>
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
  const t = useT();
  return (
    <div className="fixed inset-0 z-[80] modal-wrap bg-black/70">
      <div className="my-auto max-w-md rounded-2xl border border-white/15 bg-[#0b0e16] p-6 shadow-2xl">
        <div className="text-center text-3xl">🌒</div>
        <p className="mt-3 text-center text-sm leading-relaxed text-gray-300">
          {t("play.research.revelationIntro", "A glimpse only. The path does not show itself twice. Something in the Cradle waits for an answer.")}
        </p>
        <div className="mt-5 space-y-2">
          <button onClick={() => { sound.click(); onPick("sealed"); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-white/40 hover:bg-white/10">
            <div className="font-semibold text-white">{t("play.research.sealTitle", "Seal the Record in bone")}</div>
            <p className="mt-1 text-xs text-gray-400">{t("play.research.sealSub", "Keep what the Cradle knows the way marrow keeps its memory.")}</p>
          </button>
          <button onClick={() => { sound.click(); onPick("open"); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-white/40 hover:bg-white/10">
            <div className="font-semibold text-white">{t("play.research.openTitle", "Leave it open")}</div>
            <p className="mt-1 text-xs text-gray-400">{t("play.research.openSub", "Let the pages turn in the wind no machine makes.")}</p>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- formatting ---------------- */
// The duration formatter is NOT here (2026-09-27). It moved to
// `game/i18n/format.ts` as `fmtDuration(t, ms)` — the ONE duration formatter —
// because this screen's private copy was the SECOND one in the build and
// `ResearchViews.tsx` carried a third that was still minutes-only. One
// formatter, day-scale and keyed, so no two surfaces can disagree about what a
// week is. The rules are unchanged: never a client-clock derivation (the
// argument is always `startedAt + durationMs` or a duration itself), and the
// result is rendered inside `<Bdi dir="ltr">` at the call site.
