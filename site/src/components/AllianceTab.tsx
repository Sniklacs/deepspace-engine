// ALLIANCE TAB — the war band's own page (owner 2026-10-04).
//
// "Don't be afraid to make pages." The alliance is a module, and every module
// gets its own page: reverb feed (everything going on), member count +
// roster, settings (join policy, shipyard tithe), the ship factory, rallies,
// reinforcements, help — and a LEAVE ALLIANCE button you can't miss.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  ALLIANCE_CONFIG,
  allianceActivity,
  allianceOf,
  allianceReverb,
  memberRole,
  type Alliance,
  type AllianceActivityEntry,
  type AllianceActivityKind,
  type AllianceRole,
} from "../game/war/alliances";
import { setJoinPolicyFn, setTitheFn } from "../game/api";
import type { Tab } from "../game/nav-slots";
import { AllianceHome, NoAlliance } from "./AlliancePanel";
import AllianceHallScene from "./AllianceHallScene";
import { ActionButton } from "./ui/ActionButton";
import { Bdi } from "./ui/Bdi";
import { Icon } from "./icons";
import { useT } from "./i18n/I18n";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

const ROLE_LABEL: Record<AllianceRole, string> = { leader: "Leader", officer: "Officer", member: "Member" };

export default function AllianceTab({
  state,
  now,
  token,
  onAction,
  onNavigate,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction: Act;
  /** open a nav tab (the Arena hotspot walks off the scene) */
  onNavigate?: (tab: Tab) => void;
}) {
  const me = state.gameId ?? "";
  const alliance = useMemo(() => (me ? allianceOf(state, me) : null), [state, me]);
  if (!me) return null;
  if (!alliance) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-24">
        <NoAlliance state={state} me={me} token={token} onAction={onAction} />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-24" data-testid="alliance-page">
      {/* THE ALLIANCE HALL SCENE (owner 2026-10-04): the war band's home as a
          place — a grandiose valley vista where the buildings ARE the
          navigation. The war band's business panels live below it. */}
      <AllianceHallScene onNavigate={(tab) => onNavigate?.(tab)} />
      <AllianceHeader alliance={alliance} me={me} />
      <ReverbFeed alliance={alliance} now={now} />
      <AllianceSettings alliance={alliance} me={me} token={token} onAction={onAction} />
      <AllianceHome state={state} now={now} me={me} alliance={alliance} token={token} onAction={onAction} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header: the war band's colors, member count, reverb strength, your role.
// ---------------------------------------------------------------------------
function AllianceHeader({ alliance, me }: { alliance: Alliance; me: string }) {
  const role = memberRole(alliance, me);
  return (
    <section>
      {/* NO art banner here (owner 2026-10-14, the World-stage law): the
          hall scene above IS this page's skin. The old alliance-banner band
          sat directly under the scene and read as the page's real header —
          the new skin looked pasted onto the old page. Identity rides as a
          slim text plate; the scene carries the picture. */}
      <div className="px-1">
        <h2 className="flex items-center gap-2 text-xl font-bold text-text-1">
          <span aria-hidden="true">{alliance.banner || "⚔️"}</span> {alliance.name}
        </h2>
        {alliance.motto && <p className="mt-0.5 text-[13px] italic text-text-2">“{alliance.motto}”</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-line bg-surf-1 px-3 py-2 text-center">
          <p className="text-lg font-bold text-text-1">
            <Bdi dir="ltr" className="num">
              {alliance.members.length}
            </Bdi>
            <span className="text-sm font-normal text-text-3">/{ALLIANCE_CONFIG.sizeCap}</span>
          </p>
          <p className="text-[11px] uppercase tracking-wide text-text-3">Sworn</p>
        </div>
        <div className="rounded-xl border border-line bg-surf-1 px-3 py-2 text-center">
          <p className="text-lg font-bold text-text-1">
            <Bdi dir="ltr" className="num">
              {allianceReverb(alliance)}
            </Bdi>
          </p>
          <p className="text-[11px] uppercase tracking-wide text-text-3">Reverb</p>
        </div>
        <div className="rounded-xl border border-line bg-surf-1 px-3 py-2 text-center">
          <p className="flex items-center justify-center gap-1 text-lg font-bold text-text-1">
            <Icon name="shield" size={16} aria-hidden="true" />
          </p>
          <p className="text-[11px] uppercase tracking-wide text-text-3">{ROLE_LABEL[role ?? "member"]}</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reverb feed: everything going on in the war band, newest first.
// ---------------------------------------------------------------------------
const KIND_ICON: Record<AllianceActivityKind, string> = {
  founded: "🏴",
  joined: "🤝",
  left: "🚶",
  kicked: "🥾",
  invited: "✉️",
  promoted: "⭐",
  demoted: "📉",
  leadership: "👑",
  donated: "🎁",
  "ship-built": "🚀",
  "rally-called": "📯",
  "rally-launched": "⚔️",
  "rally-resolved": "🏆",
  "rally-cancelled": "📯",
  policy: "⚙️",
  tithe: "⚙️",
  sacrifice: "🩸",
};

function fmtAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}

function ReverbFeed({ alliance, now }: { alliance: Alliance; now: number }) {
  const entries = useMemo(() => allianceActivity(alliance), [alliance]);
  return (
    <section className="rounded-xl border border-line bg-surf-2/40 p-4" data-testid="alliance-reverb">
      <h3 className="mb-1 flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
        <Icon name="bell" size={15} aria-hidden="true" />
        Reverb
      </h3>
      <p className="mb-3 text-[12px] text-text-3">Everything going on in the war band.</p>
      {entries.length === 0 ? (
        <p className="text-[13px] text-text-2">
          Quiet… for now. Joins, departures, donations, ship builds, and rallies will echo here.
        </p>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {entries.map((e: AllianceActivityEntry) => (
            <li
              key={e.id}
              className="flex items-start gap-2 rounded-lg border border-line/60 bg-surf-1 px-3 py-1.5"
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-[14px]">
                {KIND_ICON[e.kind] ?? "•"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-text-1">{e.text}</p>
                <p className="text-[11px] text-text-3">
                  <Bdi dir="ltr" className="num">
                    {fmtAgo(e.at, now)}
                  </Bdi>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings: join policy + shipyard tithe. Officers edit; everyone else reads.
// Hans's UI rule: the controls are always visible; a tap without permission
// explains inline what's missing.
// ---------------------------------------------------------------------------
function AllianceSettings({
  alliance,
  me,
  token,
  onAction,
}: {
  alliance: Alliance;
  me: string;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const role = memberRole(alliance, me);
  const isOfficer = role === "leader" || role === "officer";
  const [hint, setHint] = useState<string | null>(null);
  const [tithe, setTithe] = useState<string>(String(alliance.titheRate ?? 0));
  const policy = alliance.joinPolicy ?? "apply";

  const guard = (): boolean => {
    if (!token) {
      setHint("Log in to change alliance settings.");
      return false;
    }
    if (!isOfficer) {
      setHint("Only officers can change alliance settings — ask your leader or an officer.");
      return false;
    }
    setHint(null);
    return true;
  };

  return (
    <section className="rounded-xl border border-line bg-surf-2/40 p-4" data-testid="alliance-settings">
      <h3 className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
        <Icon name="gear" size={15} aria-hidden="true" />
        War band settings
      </h3>

      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-text-1">Join policy</p>
          <div className="grid grid-cols-2 gap-2">
            {(["open", "apply"] as const).map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`alliance-policy-${p}`}
                className={`rounded-lg border px-3 py-2 text-left text-[13px] ${
                  policy === p
                    ? "border-acc bg-acc/15 text-text-1"
                    : "border-line bg-surf-1 text-text-2 hover:text-text-1"
                }`}
                onClick={() => {
                  if (!guard()) return;
                  if (p === policy) return;
                  onAction(() => setJoinPolicyFn({ data: { token: token!, allianceId: alliance.id, policy: p } }), "policy");
                }}
              >
                <span className="font-semibold">{p === "open" ? "Open" : "Apply"}</span>
                <span className="block text-[11px] text-text-3">
                  {p === "open" ? "Anyone can join instantly." : "Officers review applications."}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-text-1">Shipyard tithe</p>
          <p className="mb-1.5 text-[12px] text-text-3">
            % of raid loot and gleaning that flows straight to the ship factory. 0% = pure voluntary donations.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={tithe}
              onChange={(e) => setTithe(e.target.value)}
              aria-label="Shipyard tithe percent"
              data-testid="alliance-tithe-input"
              className="w-24 rounded-lg border border-line bg-surf-1 px-3 py-1.5 text-sm text-text-1"
            />
            <ActionButton
              size="sm"
              label="Set tithe"
              onClick={() => {
                if (!guard()) return;
                const rate = Math.max(0, Math.min(100, Math.round(Number(tithe) || 0)));
                setTithe(String(rate));
                onAction(() => setTitheFn({ data: { token: token!, allianceId: alliance.id, rate } }), "tithe");
              }}
              testid="alliance-tithe-set"
            />
          </div>
        </div>

        {hint && <p className="text-[12px] text-amber-200">{hint}</p>}
        {!isOfficer && !hint && (
          <p className="text-[12px] text-text-3">
            {t("alliance.settingsReadonly", "Officers manage these settings.")}
          </p>
        )}
      </div>
    </section>
  );
}
