// ALLIANCE PANEL — the war band's hearth, inside the Battles tab (the war
// slot owns everything war-shaped; the nav spec coins no new slot for it).
//
// Create / join / manage the alliance, call rallies and pledge into them,
// send and host reinforcements, and spend help ticks on alliance-mates.
// All gating math lives in game/war/{alliances,rallies}.ts (pure, tested) —
// this file only renders rows and posts through the api.ts server fns.
import { useEffect, useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import type { Alliance, AllianceRole, GuestMirror, Reinforcement } from "../game/war/alliances";
import type { AllianceDirectoryEntry } from "../game/alliance-transact";
import { ALLIANCE_CONFIG, allianceOf, allianceReverb, helpRemaining, memberRole } from "../game/war/alliances";
import type { BattlePlan, PlannedManeuver } from "../game/war/maneuvers";
import type { Rally } from "../game/war/rallies";
import { rallyForce } from "../game/war/rallies";
import { availableWeight } from "../game/war/troops";
import {
  allianceAnswerFn,
  allianceApplyFn,
  allianceCreateFn,
  allianceDemoteFn,
  allianceDirectoryFn,
  allianceDisbandFn,
  allianceInviteFn,
  allianceKickFn,
  allianceLeaveFn,
  alliancePromoteFn,
  allianceTransferFn,
  helpTickFn,
  rallyCancelFn,
  rallyCreateFn,
  rallyLaunchFn,
  rallyPlanFn,
  rallyPledgeFn,
  rallyUnpledgeFn,
  reinforceDismissFn,
  reinforceRecallFn,
  reinforceSendFn,
} from "../game/api";
import { Icon } from "./icons";
import PageBanner from "./PageBanner";
import { AllianceShipyardSection } from "./AllianceShipyard";
import { Bdi } from "./ui/Bdi";
import { useT } from "./i18n/I18n";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const ROLE_LABEL: Record<AllianceRole, string> = { leader: "Leader", officer: "Officer", member: "Member" };

// ---------------------------------------------------------------------------
// LEAVE-ALLIANCE CONFIRMATION — the ugly pop-up (owner 2026-10-04).
// Deliberately stark: full overlay, blunt language, impossible to click
// through by accident. Cancel is the safe default (Escape, backdrop tap, or
// the Cancel button all close with zero side effects).
// ---------------------------------------------------------------------------
function LeaveAllianceDialog({
  alliance,
  role,
  onConfirm,
  onClose,
}: {
  alliance: Alliance;
  role: AllianceRole | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      onClick={onClose}
      data-testid="leave-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-dialog-title"
      aria-describedby="leave-dialog-body"
    >
      <div
        className="my-auto w-full max-w-md border-4 border-red-600 bg-[#14090b] p-6 shadow-[0_0_60px_rgba(220,38,38,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="leave-dialog-title" className="text-center text-2xl font-black uppercase tracking-wide text-red-500">
          ⚠ Leave {alliance.name}?
        </h3>
        <div id="leave-dialog-body" className="mt-4 space-y-2 text-sm text-red-100">
          <p className="font-bold">
            You are about to walk away from your war band. There is no take-back button.
          </p>
          <ul className="list-disc space-y-1 ps-5">
            <li>You lose your rank ({ROLE_LABEL[role ?? "member"]}).</li>
            <li>You lose access to the shared stockpile, the rally board, and reinforcements.</li>
            <li>Rallies you pledged to finish without you.</li>
            <li>You can rejoin later — <b>if they will have you.</b></li>
          </ul>
        </div>
        <div className="mt-6 grid gap-2">
          <button
            className="w-full rounded-lg bg-red-700 px-4 py-3 text-base font-black uppercase tracking-wide text-white hover:bg-red-600"
            onClick={onConfirm}
            data-testid="leave-confirm-yes"
          >
            Yes, leave {alliance.name}
          </button>
          <button
            className="w-full rounded-lg border-2 border-white/40 bg-white/10 px-4 py-3 text-base font-bold text-white hover:bg-white/20"
            onClick={onClose}
            data-testid="leave-confirm-cancel"
            autoFocus
          >
            Cancel — stay with the war band
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Battle-plan presets — the caller picks a shape, the panel sizes it to the
// pledged pool. Troop types are weight-only in v1, so the presets use the
// workhorse bulwark (REAR rides warden weight to satisfy the escort rule).
// ---------------------------------------------------------------------------
type PresetId = "thrust" | "pincer" | "hammer";
const PRESETS: { id: PresetId; label: string; blurb: string }[] = [
  { id: "thrust", label: "Main thrust", blurb: "Everything through the MAIN at T+0." },
  { id: "pincer", label: "Pincer", blurb: "MAIN holds, both flanks close at T+10." },
  { id: "hammer", label: "Hammer & anvil", blurb: "MAIN pins, the REAR drops at T+20." },
];

function presetPlan(preset: PresetId, pool: number): BattlePlan {
  const at = (pct: number) => Math.max(1, Math.round((pool * pct) / 100));
  const maneuvers: PlannedManeuver[] = [];
  if (preset === "thrust") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: pool } });
  } else if (preset === "pincer") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(60) } });
    maneuvers.push({ id: "m-fl", vector: "FLANK_LEFT", enterAtMin: 10, composition: { bulwark: at(20) } });
    maneuvers.push({ id: "m-fr", vector: "FLANK_RIGHT", enterAtMin: 10, composition: { bulwark: at(20) } });
  } else {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(50) } });
    maneuvers.push({ id: "m-rear", vector: "REAR", enterAtMin: 20, composition: { warden: at(50) } });
  }
  return { id: `plan-${Date.now()}`, maneuvers };
}

// ---------------------------------------------------------------------------
export default function AlliancePanel({
  state,
  now,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction: Act;
}) {
  const me = state.gameId ?? "";
  const alliance = useMemo(() => (me ? allianceOf(state, me) : null), [state, me]);
  if (!me) return null;
  if (!alliance) return <NoAlliance state={state} me={me} token={token} onAction={onAction} />;
  return <AllianceHome state={state} now={now} me={me} alliance={alliance} token={token} onAction={onAction} />;
}

// ---------------------------------------------------------------------------
// No alliance yet: found one, or answer a standing invite.
// Exported for the dedicated Alliance page (owner 2026-10-04).
// ---------------------------------------------------------------------------
export function NoAlliance({ state, me, token, onAction }: { state: GameState; me: string; token?: string; onAction: Act }) {
  const t = useT();
  const [name, setName] = useState("");
  const [banner, setBanner] = useState("⚔️");
  const [motto, setMotto] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const invites = useMemo(() => {
    const out: { alliance: Alliance; invite: Alliance["invites"][number] }[] = [];
    for (const a of Object.values(state.alliances ?? {})) {
      const inv = a.invites.find((i) => i.colonyId === me);
      if (inv) out.push({ alliance: a, invite: inv });
    }
    return out;
  }, [state, me]);
  const post = (fn: () => Promise<GameResult>, label: string) => {
    if (!token) return;
    onAction(fn, label);
  };
  return (
    <section className="rounded-xl border border-line bg-surf-2/40 p-4">
      {/* war council hall behind the header (owner 2026-10-01: every page gets
          a background picture) */}
      <PageBanner
        image="/art/pages/alliance-banner.webp"
        title={<span className="flex items-center gap-2"><Icon name="shield" size={16} /> War band</span>}
        sub="No colony stands alone. Found a war band — or answer an invite — and rallies, reinforcements, and help ticks unlock."
        className="-m-4 mb-4 rounded-t-xl"
        titleClassName="text-sm font-semibold text-white drop-shadow"
        focal="center 60%"
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          className="rounded-lg border border-line bg-surf-1 px-3 py-2 text-sm text-text-1"
          placeholder="War band name (min 3 characters)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          aria-label="War band name"
        />
        <input
          className="rounded-lg border border-line bg-surf-1 px-3 py-2 text-sm text-text-1"
          placeholder="Banner"
          value={banner}
          onChange={(e) => setBanner(e.target.value)}
          maxLength={8}
          aria-label="Banner"
        />
        <button
          className="rounded-lg bg-acc px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            if (name.trim().length < 3) {
              setHint(t("alliance.hintNameShort", "Give your alliance a name — at least 3 characters."));
              return;
            }
            setHint(null);
            post(() => allianceCreateFn({ data: { token: token!, name: name.trim(), banner: banner || undefined, motto: motto || undefined } }), "found");
          }}
        >
          Found (500 supplies)
        </button>
      </div>
      {hint && <p className="mb-2 text-xs text-amber-200">{hint}</p>}
      <input
        className="mb-4 w-full rounded-lg border border-line bg-surf-1 px-3 py-2 text-sm text-text-1"
        placeholder="Motto (optional)"
        value={motto}
        onChange={(e) => setMotto(e.target.value)}
        maxLength={120}
        aria-label="Motto"
      />
      {invites.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Invitations</h4>
          <ul className="space-y-2">
            {invites.map(({ alliance, invite }) => (
              <li key={alliance.id} className="flex items-center justify-between rounded-lg border border-line bg-surf-1 px-3 py-2">
                <span className="text-sm text-text-1">
                  {alliance.banner} {alliance.name} <span className="text-xs text-text-2">— {invite.colonyName === me ? "you" : invite.colonyName} invited</span>
                </span>
                <span className="flex gap-2">
                  <button
                    className="rounded-lg bg-acc px-3 py-1 text-xs font-semibold text-white"
                    onClick={() => post(() => allianceAnswerFn({ data: { token: token!, allianceId: alliance.id, colonyId: me, accept: true } }), "join")}
                  >
                    Join
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1 text-xs text-text-2"
                    onClick={() => post(() => allianceAnswerFn({ data: { token: token!, allianceId: alliance.id, colonyId: me, accept: false } }), "decline")}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <AllianceSearch query={query} onQuery={setQuery} />
      <KnownAlliances state={state} me={me} token={token} onAction={onAction} query={query} />
      <DirectorySection state={state} token={token} onAction={onAction} query={query} />
    </section>
  );
}

// The alliance browser (owner 2026-10-02): search across every war band on
// the server — name, member count, reverb — then knock. Hans's rule: the
// Apply button is always tappable; a full war band explains itself inline.
function AllianceSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const t = useT();
  return (
    <div className="mb-3">
      <input
        className="w-full rounded-lg border border-line bg-surf-1 px-3 py-2 text-sm text-text-1"
        placeholder={t("alliance.searchPlaceholder", "Search war bands…")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        maxLength={60}
        aria-label={t("alliance.searchPlaceholder", "Search war bands…")}
      />
    </div>
  );
}

// War bands already flying in this world — knock and ask to join.
function KnownAlliances({ state, me, token, onAction, query }: { state: GameState; me: string; token?: string; onAction: Act; query: string }) {
  const t = useT();
  const [hintFor, setHintFor] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const known = useMemo(() => {
    const out: Alliance[] = [];
    for (const a of Object.values(state.alliances ?? {})) {
      if (a.members.some((m) => m.colonyId === me)) continue;
      if (a.applications.some((x) => x.colonyId === me)) continue;
      if (a.invites.some((x) => x.colonyId === me)) continue;
      if (q && !a.name.toLowerCase().includes(q)) continue;
      out.push(a);
    }
    return out;
  }, [state, me, q]);
  if (known.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Flying their colors</h4>
      <ul className="space-y-1">
        {known.map((a) => {
          const full = a.members.length >= ALLIANCE_CONFIG.sizeCap;
          return (
            <li key={a.id} className="rounded-lg border border-line bg-surf-1 px-3 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-text-1">
                  {a.banner} {a.name}{" "}
                  <span className="text-xs text-text-2">
                    · <Bdi dir="ltr" className="num">{a.members.length}/{ALLIANCE_CONFIG.sizeCap}</Bdi>{" "}
                    {t("alliance.members", "members")} · {t("alliance.reverb", "Reverb")}{" "}
                    <Bdi dir="ltr" className="num">{allianceReverb(a)}</Bdi>
                  </span>
                  {a.motto ? <span className="block truncate text-xs italic text-text-3">“{a.motto}”</span> : null}
                </span>
                <button
                  className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-text-2"
                  onClick={() => {
                    if (full) {
                      setHintFor(a.id);
                      return;
                    }
                    setHintFor(null);
                    if (token) onAction(() => allianceApplyFn({ data: { token: token!, allianceId: a.id } }), "apply");
                  }}
                >
                  {a.joinPolicy === "open" ? "Join" : "Apply"}
                </button>
              </div>
              {hintFor === a.id && (
                <p className="mt-1 text-xs text-amber-200">
                  {t("alliance.hintFull", "This war band is full ({n}/{cap}).", { n: a.members.length, cap: ALLIANCE_CONFIG.sizeCap })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// War bands flying on other accounts — the directory scans every account's
// saves, so this is how you find a flag you have no mirror of yet. Applying
// routes to the canonical founder's account; the mirror arrives on your save.
function DirectorySection({ state, token, onAction, query }: { state: GameState; token?: string; onAction: Act; query: string }) {
  const t = useT();
  const [entries, setEntries] = useState<AllianceDirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hintFor, setHintFor] = useState<string | null>(null);
  useEffect(() => {
    if (!token || entries !== null) return;
    let live = true;
    setLoading(true);
    allianceDirectoryFn({ data: { token } })
      .then((res) => {
        if (live && res.ok) setEntries(res.entries ?? []);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [token, entries]);
  const q = query.trim().toLowerCase();
  const fresh = useMemo(() => {
    if (!entries) return [];
    const knownIds = new Set(Object.keys(state.alliances ?? {}));
    return entries.filter((e) => !knownIds.has(e.id) && (!q || e.name.toLowerCase().includes(q)));
  }, [entries, state, q]);
  if (!token) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Across the void</h4>
      {loading && entries === null ? (
        <p className="text-xs text-text-2">Scanning the void for war bands…</p>
      ) : fresh.length === 0 ? (
        <p className="text-xs text-text-2">No distant war bands flying right now.</p>
      ) : (
        <ul className="space-y-1">
          {fresh.map((e) => {
            const full = e.memberCount >= ALLIANCE_CONFIG.sizeCap;
            return (
              <li key={e.id} className="rounded-lg border border-line bg-surf-1 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-text-1">
                    {e.banner} {e.name}{" "}
                    <span className="text-xs text-text-2">
                      · <Bdi dir="ltr" className="num">{e.memberCount}/{ALLIANCE_CONFIG.sizeCap}</Bdi>{" "}
                      {t("alliance.members", "members")} · {t("alliance.reverb", "Reverb")} —
                    </span>
                    {e.motto ? <span className="block truncate text-xs italic text-text-3">“{e.motto}”</span> : null}
                  </span>
                  <button
                    className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-text-2"
                    onClick={() => {
                      if (full) {
                        setHintFor(e.id);
                        return;
                      }
                      setHintFor(null);
                      if (token) onAction(() => allianceApplyFn({ data: { token: token!, allianceId: e.id } }), "apply");
                    }}
                  >
                    {e.joinPolicy === "open" ? "Join" : "Apply"}
                  </button>
                </div>
                {hintFor === e.id && (
                  <p className="mt-1 text-xs text-amber-200">
                    {t("alliance.hintFull", "This war band is full ({n}/{cap}).", { n: e.memberCount, cap: ALLIANCE_CONFIG.sizeCap })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The alliance home: members, applications, rally board, reinforcements, help.
// Exported for the dedicated Alliance page (owner 2026-10-04).
// ---------------------------------------------------------------------------
export function AllianceHome({
  state,
  now,
  me,
  alliance,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  me: string;
  alliance: Alliance;
  token?: string;
  onAction: Act;
}) {
  const role = memberRole(alliance, me);
  const isLeader = role === "leader";
  const isOfficer = role === "officer" || isLeader;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const post = (fn: () => Promise<GameResult>, label: string) => {
    if (!token) return;
    onAction(fn, label);
  };
  const doLeave = () => {
    setLeaveOpen(false);
    post(() => allianceLeaveFn({ data: { token: token! } }), "leave");
  };
  const rallies = useMemo(
    () =>
      Object.values(state.rallies ?? {})
        .filter((r) => r.allianceId === alliance.id)
        .sort((a, b) => a.launchAt - b.launchAt),
    [state, alliance.id],
  );
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surf-2/40 p-4">
      {/* war council hall behind the header (owner 2026-10-01: every page gets
          a background picture) */}
      <PageBanner
        image="/art/pages/alliance-banner.webp"
        title={<><span aria-hidden>{alliance.banner || "⚔️"}</span> {alliance.name}</>}
        sub={alliance.motto ? <>“{alliance.motto}”</> : undefined}
        className="-m-4 rounded-t-xl"
        titleClassName="text-sm font-semibold text-white drop-shadow"
        focal="center 60%"
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-normal text-text-2">{ROLE_LABEL[role ?? "member"]}</span>
          <p className="text-xs text-text-2">{alliance.members.length}/{ALLIANCE_CONFIG.sizeCap} sworn</p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/50"
            onClick={() => setLeaveOpen(true)}
            data-testid="alliance-leave-header"
          >
            Leave alliance
          </button>
          {isLeader && (
            <button
              className="rounded-lg border border-red-900/50 px-3 py-1 text-xs text-red-400"
              onClick={() => { if (window.confirm("Disband the war band? This ends the family.")) post(() => allianceDisbandFn({ data: { token: token!, allianceId: alliance.id } }), "disband"); }}
            >
              Disband
            </button>
          )}
        </div>
      </div>

      <Members me={me} alliance={alliance} isLeader={isLeader} isOfficer={isOfficer} token={token} onAction={onAction} />
      {isOfficer && alliance.applications.length > 0 && (
        <Applications alliance={alliance} token={token} onAction={onAction} />
      )}
      <RallyBoard now={now} me={me} isOfficer={isOfficer} rallies={rallies} token={token} onAction={onAction} />
      <Reinforcements state={state} me={me} alliance={alliance} token={token} onAction={onAction} />
      <HelpBoard state={state} now={now} me={me} alliance={alliance} token={token} onAction={onAction} />
      <AllianceShipyardSection alliance={alliance} now={now} me={me} state={state} token={token} onAction={onAction} />
      {/* Danger zone — the leave button lives here, big and impossible to miss
          (owner 2026-10-04: the old header button was too hidden). */}
      <div className="rounded-xl border-2 border-red-800/70 bg-red-950/20 p-4">
        <h4 className="text-sm font-black uppercase tracking-widest text-red-400">Danger zone</h4>
        <p className="mt-1 text-xs text-text-2">
          Leaving ends your oath to {alliance.name}. You keep your colonies and your ships — everything shared stays shared.
        </p>
        <button
          className="mt-3 w-full rounded-lg border-2 border-red-500 bg-red-800/60 px-4 py-3 text-base font-black uppercase tracking-widest text-white hover:bg-red-700"
          onClick={() => setLeaveOpen(true)}
          data-testid="alliance-leave"
        >
          🚪 Leave alliance
        </button>
      </div>
      {leaveOpen && (
        <LeaveAllianceDialog
          alliance={alliance}
          role={role}
          onConfirm={doLeave}
          onClose={() => setLeaveOpen(false)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Members({ me, alliance, isLeader, isOfficer, token, onAction }: {
  me: string; alliance: Alliance; isLeader: boolean; isOfficer: boolean; token?: string; onAction: Act;
}) {
  const t = useT();
  const [inviteId, setInviteId] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const post = (fn: () => Promise<GameResult>, label: string) => { if (token) onAction(fn, label); };
  const sorted = [...alliance.members].sort((a, b) => ({ leader: 0, officer: 1, member: 2 }[a.role] - { leader: 0, officer: 1, member: 2 }[b.role]));
  return (
    <div data-testid="alliance-roster">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Sworn ({alliance.members.length})</h4>
      <ul className="space-y-1">
        {sorted.map((m) => (
          <li key={m.colonyId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surf-1 px-3 py-1.5">
            <span className="text-sm text-text-1">
              {m.colonyName} {m.colonyId === me && <span className="text-xs text-text-2">(you)</span>}
              <span className="ms-2 rounded-full border border-line px-2 py-0.5 text-[10px] text-text-2">{ROLE_LABEL[m.role]}</span>
            </span>
            {m.colonyId !== me && (isLeader || (isOfficer && m.role === "member")) && (
              <span className="flex gap-1">
                {isLeader && m.role !== "officer" && m.role !== "leader" && (
                  <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => post(() => alliancePromoteFn({ data: { token: token!, allianceId: alliance.id, targetId: m.colonyId } }), "promote")}>Promote</button>
                )}
                {isLeader && m.role === "officer" && (
                  <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => post(() => allianceDemoteFn({ data: { token: token!, allianceId: alliance.id, targetId: m.colonyId } }), "demote")}>Demote</button>
                )}
                {isLeader && (
                  <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => { if (window.confirm(`Hand leadership of ${alliance.name} to ${m.colonyName}?`)) post(() => allianceTransferFn({ data: { token: token!, allianceId: alliance.id, targetId: m.colonyId } }), "transfer"); }}>Make leader</button>
                )}
                <button className="rounded border border-red-900/50 px-2 py-0.5 text-[11px] text-red-400" onClick={() => { if (window.confirm(`Cast out ${m.colonyName}?`)) post(() => allianceKickFn({ data: { token: token!, allianceId: alliance.id, targetId: m.colonyId } }), "kick"); }}>Kick</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {isOfficer && (
        <div>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-line bg-surf-1 px-3 py-1.5 text-sm text-text-1"
              placeholder="Colony ID to invite"
              value={inviteId}
              onChange={(e) => setInviteId(e.target.value)}
              aria-label="Colony ID to invite"
            />
            <button
              className="rounded-lg bg-acc px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => {
                if (!inviteId.trim()) {
                  setHint(t("alliance.hintInviteEmpty", "Enter a colony name or ID to invite."));
                  return;
                }
                setHint(null);
                post(() => allianceInviteFn({ data: { token: token!, allianceId: alliance.id, targetId: inviteId.trim(), targetName: inviteId.trim() } }), "invite");
                setInviteId("");
              }}
            >
              Invite
            </button>
          </div>
          {hint && <p className="mt-1 text-xs text-amber-200">{hint}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Applications({ alliance, token, onAction }: { alliance: Alliance; token?: string; onAction: Act }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Knocking ({alliance.applications.length})</h4>
      <ul className="space-y-1">
        {alliance.applications.map((a) => (
          <li key={a.colonyId} className="flex items-center justify-between rounded-lg border border-line bg-surf-1 px-3 py-1.5">
            <span className="text-sm text-text-1">{a.colonyName}</span>
            <span className="flex gap-1">
              <button className="rounded bg-acc px-2 py-0.5 text-[11px] font-semibold text-white" onClick={() => token && onAction(() => allianceAnswerFn({ data: { token: token!, allianceId: alliance.id, colonyId: a.colonyId, accept: true } }), "accept")}>Accept</button>
              <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => token && onAction(() => allianceAnswerFn({ data: { token: token!, allianceId: alliance.id, colonyId: a.colonyId, accept: false } }), "decline")}>Decline</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RallyBoard({ now, me, isOfficer, rallies, token, onAction }: {
  now: number; me: string; isOfficer: boolean; rallies: Rally[]; token?: string; onAction: Act;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [leadMin, setLeadMin] = useState(60);
  const [pledgeAmt, setPledgeAmt] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<Record<string, PresetId>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [pledgeHint, setPledgeHint] = useState<{ id: string; msg: string } | null>(null);
  const post = (fn: () => Promise<GameResult>, label: string) => { if (token) onAction(fn, label); };
  const myPledge = (r: Rally) => r.pledges.find((p) => p.colonyId === me);
  const canCall = isOfficer;
  return (
    <div data-testid="alliance-rally" className="scroll-mt-28">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Rally board</h4>
      {canCall && (
        <div className="mb-3">
          <div className="grid gap-2 rounded-lg border border-line bg-surf-1 p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input className="rounded-lg border border-line bg-surf-2 px-3 py-1.5 text-sm text-text-1" placeholder="Rally name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Rally name" />
            <input className="rounded-lg border border-line bg-surf-2 px-3 py-1.5 text-sm text-text-1" placeholder="Target (Chorus site)" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={80} aria-label="Rally target" />
            <select className="rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-sm text-text-1" value={leadMin} onChange={(e) => setLeadMin(Number(e.target.value))} aria-label="Muster time">
              {[30, 60, 180, 360, 720, 1440].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60}h` : `${m}m`} muster</option>)}
            </select>
            <button
              className="rounded-lg bg-acc px-4 py-1.5 text-sm font-semibold text-white"
              onClick={() => {
                const missing: string[] = [];
                if (name.trim().length < 3) missing.push(t("alliance.hintRallyName", "Rally needs a name (3+ characters)."));
                if (!target.trim()) missing.push(t("alliance.hintRallyTarget", "Pick a target for the rally."));
                if (missing.length > 0) {
                  setHint(missing.join(" "));
                  return;
                }
                setHint(null);
                post(() => rallyCreateFn({ data: { token: token!, name: name.trim(), targetKind: "chorus-site", targetLabel: target.trim(), zoneId: `chorus-${Date.now()}`, launchAt: Date.now() + leadMin * 60000 } }), "rally");
                setName(""); setTarget("");
              }}
            >
              Call rally
            </button>
          </div>
          {hint && <p className="mt-1 text-xs text-amber-200">{hint}</p>}
        </div>
      )}
      {rallies.length === 0 && <p className="text-xs text-text-2">No rallies called. The board is quiet — for now.</p>}
      <ul className="space-y-2">
        {rallies.map((r) => {
          const force = rallyForce(r);
          const mine = myPledge(r);
          const isCaller = r.callerId === me;
          return (
            <li key={r.id} className="rounded-lg border border-line bg-surf-1 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-text-1">{r.name} <span className="font-normal text-text-2">→ {r.target.label}</span></p>
                  <p className="text-xs text-text-2">
                    {r.state === "open" && <>Marches in {fmtCountdown(r.launchAt - now)} · {force.troops} pledged by {r.pledges.length}</>}
                    {r.state === "launched" && <>⚔️ Underway · {force.troops} in the field</>}
                    {r.state === "resolved" && r.outcome && <>{r.outcome.victory ? "🏆 Victory" : "💀 Defeat"} · {r.outcome.lootSupplies} supplies taken · your share {r.outcome.shares[me] ?? 0}, your fallen {r.outcome.losses[me] ?? 0}</>}
                    {r.state === "cancelled" && <>Called off — every pledge marched home.</>}
                  </p>
                  {r.plan && r.state === "open" && (
                    <p className="text-xs text-text-2">Plan: {r.plan.maneuvers.map((m) => `${m.vector}@${m.enterAtMin}m`).join(" · ")}</p>
                  )}
                </div>
                {(isCaller || isOfficer) && r.state === "open" && (
                  <span className="flex gap-1">
                    <button className="rounded bg-acc px-2 py-1 text-[11px] font-semibold text-white" onClick={() => post(() => rallyLaunchFn({ data: { token: token!, rallyId: r.id } }), "launch")}>Launch now</button>
                    <button className="rounded border border-line px-2 py-1 text-[11px] text-text-2" onClick={() => { if (window.confirm("Call off this rally? Pledges march home.")) post(() => rallyCancelFn({ data: { token: token!, rallyId: r.id } }), "cancel"); }}>Cancel</button>
                  </span>
                )}
              </div>
              {r.state === "open" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {mine ? (
                    <>
                      <span className="text-xs text-text-2">You pledged {mine.troops}</span>
                      <button className="rounded border border-line px-2 py-1 text-[11px] text-text-2" onClick={() => post(() => rallyUnpledgeFn({ data: { token: token!, rallyId: r.id } }), "unpledge")}>Withdraw</button>
                    </>
                  ) : (
                    <>
                      <input
                        className="w-24 rounded-lg border border-line bg-surf-2 px-2 py-1 text-sm text-text-1"
                        type="number" min={1} placeholder="Troops"
                        value={pledgeAmt[r.id] ?? ""}
                        onChange={(e) => setPledgeAmt({ ...pledgeAmt, [r.id]: e.target.value })}
                        aria-label={`Troops to pledge to ${r.name}`}
                      />
                      <button
                        className="rounded bg-acc px-3 py-1 text-[11px] font-semibold text-white"
                        onClick={() => {
                          if (!(Number(pledgeAmt[r.id]) > 0)) {
                            setPledgeHint({ id: r.id, msg: t("alliance.hintPledgeAmt", "Enter how many troops to pledge.") });
                            return;
                          }
                          setPledgeHint(null);
                          post(() => rallyPledgeFn({ data: { token: token!, rallyId: r.id, troops: Math.trunc(Number(pledgeAmt[r.id])) } }), "pledge");
                        }}
                      >
                        Pledge (locks now)
                      </button>
                      {pledgeHint?.id === r.id && <p className="w-full text-xs text-amber-200">{pledgeHint.msg}</p>}
                    </>
                  )}
                  {(isCaller || isOfficer) && !r.plan && (
                    <span className="flex items-center gap-1">
                      <select
                        className="rounded-lg border border-line bg-surf-2 px-2 py-1 text-[11px] text-text-1"
                        value={preset[r.id] ?? "thrust"}
                        onChange={(e) => setPreset({ ...preset, [r.id]: e.target.value as PresetId })}
                        aria-label="Battle plan preset"
                      >
                        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <button
                        className="rounded border border-line px-2 py-1 text-[11px] text-text-2"
                        title={PRESETS.find((p) => p.id === (preset[r.id] ?? "thrust"))!.blurb}
                        onClick={() => {
                          const plan = presetPlan(preset[r.id] ?? "thrust", Math.max(1, force.troops));
                          post(() => rallyPlanFn({ data: { token: token!, rallyId: r.id, plan: { id: plan.id, maneuvers: plan.maneuvers.map((m) => ({ id: m.id, vector: m.vector, enterAtMin: m.enterAtMin, composition: m.composition })) } } }), "plan");
                        }}
                      >
                        Set plan
                      </button>
                    </span>
                  )}
                </div>
              )}
              {r.pledges.length > 0 && (
                <p className="mt-1 text-[11px] text-text-2">
                  {r.pledges.map((p) => `${p.colonyName}: ${p.troops}`).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Reinforcements({ state, me, alliance, token, onAction }: {
  state: GameState; me: string; alliance: Alliance; token?: string; onAction: Act;
}) {
  const t = useT();
  const [toId, setToId] = useState("");
  const [troops, setTroops] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const post = (fn: () => Promise<GameResult>, label: string) => { if (token) onAction(fn, label); };
  const all = state.reinforcements ?? [];
  // Stationed guests live on the HOST's save as mirrors (the sender's
  // Reinforcement records live on the sender's save — filtering those by
  // toColonyId would miss every cross-account guest).
  const mirrors: GuestMirror[] = (state.guestMirrors ?? []).filter((m) => m.weight > 0);
  const abroad = all.filter((r: Reinforcement) => r.fromColonyId === me && r.state === "stationed");
  const spare = state.troops ? availableWeight(state.troops.home.roster) : 0;
  const mates = alliance.members.filter((m) => m.colonyId !== me);
  return (
    <div data-testid="alliance-reinforce" className="scroll-mt-28">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Reinforcements</h4>
      {mirrors.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] text-text-2">Stationed with you (you feed them — 1 supply per 10 troops/hr):</p>
          <ul className="space-y-1">
            {mirrors.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-line bg-surf-1 px-3 py-1.5">
                <span className="text-sm text-text-1">{m.fromColonyName}: {m.weight} troops</span>
                <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => post(() => reinforceDismissFn({ data: { token: token!, reinforcementId: m.id } }), "dismiss")}>Send home</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {abroad.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] text-text-2">Your troops abroad (locked until recalled):</p>
          <ul className="space-y-1">
            {abroad.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-line bg-surf-1 px-3 py-1.5">
                <span className="text-sm text-text-1">{r.troops} with {r.toColonyName}</span>
                <button className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2" onClick={() => post(() => reinforceRecallFn({ data: { token: token!, reinforcementId: r.id } }), "recall")}>Recall</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mates.length > 0 && (
        <div>
          <div className="flex gap-2">
            <select className="flex-1 rounded-lg border border-line bg-surf-1 px-3 py-1.5 text-sm text-text-1" value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Ally to reinforce">
              <option value="">Reinforce an ally…</option>
              {mates.map((m) => <option key={m.colonyId} value={m.colonyId}>{m.colonyName}</option>)}
            </select>
            <input className="w-24 rounded-lg border border-line bg-surf-1 px-2 py-1.5 text-sm text-text-1" type="number" min={1} max={spare} placeholder={`max ${spare}`} value={troops} onChange={(e) => setTroops(e.target.value)} aria-label="Troops to send" />
            <button
              className="rounded-lg bg-acc px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => {
                const missing: string[] = [];
                if (!toId) missing.push(t("alliance.hintSendTo", "Choose who to send troops to."));
                if (!(Number(troops) > 0)) missing.push(t("alliance.hintSendAmt", "Enter how many troops to send."));
                if (missing.length > 0) {
                  setHint(missing.join(" "));
                  return;
                }
                setHint(null);
                const m = mates.find((x) => x.colonyId === toId)!;
                post(() => reinforceSendFn({ data: { token: token!, toId: m.colonyId, toName: m.colonyName, troops: Math.trunc(Number(troops)) } }), "reinforce");
                setTroops("");
              }}
            >
              Send
            </button>
          </div>
          {hint && <p className="mt-1 text-xs text-amber-200">{hint}</p>}
        </div>
      )}
      {mirrors.length === 0 && abroad.length === 0 && mates.length === 0 && (
        <p className="text-xs text-text-2">No allies to reinforce yet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function HelpBoard({ state, now, me, alliance, token, onAction }: {
  state: GameState; now: number; me: string; alliance: Alliance; token?: string; onAction: Act;
}) {
  const remaining = helpRemaining(state, now);
  const mates = alliance.members.filter((m) => m.colonyId !== me);
  if (mates.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">
        Help ticks <span className="font-normal">({remaining}/5 today — buildings & research only, never troops)</span>
      </h4>
      <ul className="space-y-1">
        {mates.map((m) => (
          <li key={m.colonyId} className="flex items-center justify-between rounded-lg border border-line bg-surf-1 px-3 py-1.5">
            <span className="text-sm text-text-1">{m.colonyName}</span>
            <button
              className="rounded border border-line px-2 py-0.5 text-[11px] text-text-2 disabled:opacity-40"
              disabled={remaining <= 0}
              title="Lend a hand on their build/research timers"
              onClick={() => token && onAction(() => helpTickFn({ data: { token: token!, targetId: m.colonyId, targetName: m.colonyName } }), "help")}
            >
              Lend a hand
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
