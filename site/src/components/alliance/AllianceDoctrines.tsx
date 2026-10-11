// AllianceDoctrines — the war band's way of war (owner 2026-10-11).
//
// The doctrine library is how the alliance teaches its way of war: new
// members open it, see how the alliance fights, watch the attached replay,
// and build their forces to fit the doctrine. Alliance-scoped — it lives
// here, never on the globe. Viewing requires the "doctrines" permission.

import { useState } from "react";
import {
  doctrinesOf,
  doctrineGuide,
  memberCan,
  memberRole,
  type Alliance,
  type AllianceDoctrine,
} from "../../game/war/alliances";
import { formationSlots, validateLoads, type SavedFormation } from "../../game/war/playbook";
import { encodeFormationShare } from "../../game/war/formation-share";
import { allianceDeleteDoctrineFn, type GameResult } from "../../game/api";
import type { GameState } from "../../game/types";
import { FormationDiagram } from "../BattleScene/FormationDiagram";
import { BattleReplayViewer } from "../BattleScene/BattleReplayViewer";
import { MemberAvatar } from "./MemberAvatar";

function fmtDate(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function AllianceDoctrines({
  state,
  alliance,
  me,
  token,
  onAction,
}: {
  state: GameState;
  alliance: Alliance;
  me: string;
  token?: string;
  onAction: (fn: () => Promise<GameResult>, label: string) => void;
}) {
  const canView = memberCan(alliance, me, "doctrines");
  const [openId, setOpenId] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const doctrines = doctrinesOf(alliance);
  const role = memberRole(alliance, me);
  const roster = state.troops?.home.roster ?? null;

  if (!canView) {
    return (
      <div data-testid="doctrines-locked" className="rounded-xl border border-line bg-surf-1 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-2">📜 Doctrines</h4>
        <p className="mt-1 text-xs text-text-3">
          The war band's way of war lives here. Your leader or an officer grants access when you're ready — ask them.
        </p>
      </div>
    );
  }

  const watching = watchId ? doctrines.find((d) => d.id === watchId) ?? null : null;

  const asFormation = (d: AllianceDoctrine): SavedFormation => ({
    id: d.id,
    name: d.name,
    playId: d.playId,
    locked: false,
    loads: d.loads,
    slotMeta: d.slotMeta,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
  });

  const canRemove = (d: AllianceDoctrine) =>
    d.authorId === me || role === "leader" || role === "officer";

  return (
    <div data-testid="alliance-doctrines" className="rounded-xl border border-line bg-surf-1 p-4">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-2">
        📜 Doctrines — how we fight ({doctrines.length})
      </h4>
      <p className="mb-3 text-[11px] text-text-3">
        Battle-proven formations from the war band's own fights. Open one, watch the tape, build to it.
      </p>
      {doctrines.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-text-3">
          No doctrines yet. Win a battle, save the formation as a doctrine, and it lands here.
        </p>
      )}
      <ul className="space-y-2">
        {doctrines.map((d) => {
          const guide = doctrineGuide(d);
          const author = alliance.members.find((m) => m.colonyId === d.authorId);
          return (
            <li key={d.id} className="rounded-lg border border-line bg-surf-2">
              <button
                type="button"
                onClick={() => setOpenId(openId === d.id ? null : d.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                aria-expanded={openId === d.id}
                data-testid={`doctrine-row-${d.id}`}
              >
                {author && <MemberAvatar member={author} token={token} size={28} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-text-1">{d.name}</span>
                  <span className="block text-[11px] text-text-3">
                    by {d.authorName} · {fmtDate(d.createdAt)} · {guide.total} troops
                    {d.victor ? ` · ${d.victor === "attacker" ? "won" : "lost"} in ${fmtDuration(d.durationS)}` : ""}
                  </span>
                </span>
                <span className="flex-none text-text-3">{openId === d.id ? "▾" : "▸"}</span>
              </button>
              {openId === d.id && (
                <div className="border-t border-line px-3 py-3" data-testid={`doctrine-detail-${d.id}`}>
                  {/* battle proof */}
                  <p className="mb-2 text-[11px] text-text-3">
                    📼 From “{d.battleName}” — {d.victor === "attacker" ? "victory" : d.victor === "defender" ? "defeat" : "unresolved"},{" "}
                    {fmtDuration(d.durationS)}, {d.killsAttacker} enemy / {d.killsDefender} own kills.
                  </p>
                  {/* formation preview */}
                  <FormationDiagram play={null} formation={asFormation(d)} loads={d.loads} compact />
                  {/* build to this doctrine */}
                  <div className="mt-2 rounded-lg border border-line bg-surf-1 p-2.5">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-text-3">
                      Build to this doctrine
                    </p>
                    <ul className="space-y-0.5">
                      {guide.lines.map((l) => (
                        <li key={`${l.type}-${l.tier}`} className="text-xs text-text-2">
                          <span className="font-bold text-text-1">{l.count}×</span> {l.type} <span className="text-text-3">T{l.tier}</span>
                        </li>
                      ))}
                    </ul>
                    {roster && (() => {
                      const deficits = validateLoads(d.loads, roster);
                      return deficits.length > 0 ? (
                        <p className="mt-1.5 text-[11px] text-amber-200">
                          You're short: {deficits.slice(0, 3).join(" ")}
                          {deficits.length > 3 ? ` (+${deficits.length - 3} more)` : ""}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-emerald-300">
                          ✓ Your roster can field this doctrine.
                        </p>
                      );
                    })()}
                    <p className="mt-1 text-[11px] text-text-3">
                      Slots: {formationSlots(asFormation(d)).filter((s) => (d.loads[s.id] ?? []).length > 0).map((s) => s.name).join(" · ")}
                    </p>
                  </div>
                  {/* actions */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.replay && (
                      <button
                        type="button"
                        onClick={() => setWatchId(d.id)}
                        className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-text-1"
                        data-testid={`doctrine-watch-${d.id}`}
                      >
                        🎬 Watch the tape
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShareId(shareId === d.id ? null : d.id)}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-text-1"
                      aria-label={`Share ${d.name}`}
                    >
                      🔗 Share
                    </button>
                    {canRemove(d) && token && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Remove the doctrine “${d.name}” from the war band?`)) {
                            onAction(
                              () => allianceDeleteDoctrineFn({ data: { token, allianceId: alliance.id, doctrineId: d.id } }),
                              "doctrine",
                            );
                          }
                        }}
                        className="rounded-lg border border-red-900/50 px-2.5 py-1.5 text-xs text-red-400"
                      >
                        🗑 Remove
                      </button>
                    )}
                  </div>
                  {shareId === d.id && (
                    <SharePanel
                      code={encodeFormationShare({ name: d.name, playId: d.playId, loads: d.loads, slotMeta: d.slotMeta })}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {watching?.replay && (
        <BattleReplayViewer
          replay={watching.replay}
          title={`${watching.name} — the tape`}
          onClose={() => setWatchId(null)}
        />
      )}
    </div>
  );
}

function SharePanel({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-line bg-surf-1 p-2.5" data-testid="doctrine-share-panel">
      <p className="mb-1 text-[11px] text-text-3">
        Send this code to a specific player — they paste it into their war room's Import box.
      </p>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={code}
          onFocus={(e) => e.target.select()}
          aria-label="Doctrine share code"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surf-2 px-2 py-1.5 font-mono text-[10px] text-text-1"
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false));
          }}
          className="flex-none rounded-lg bg-acc px-3 py-1.5 text-xs font-semibold text-white"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default AllianceDoctrines;
