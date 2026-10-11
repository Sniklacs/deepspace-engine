// MemberProfile — tap a member, see who they are (owner 2026-10-11).
//
// Avatar (preset or their own upload), name, role, and the SERVICE RECORD:
// troops lost in alliance service (reinforcements/reserves that bled for
// the war band), battles bled in, and the contribution score derived from
// it. Leaders/officers also manage this member's permissions here.

import { useRef, useState } from "react";
import {
  AVATAR_PRESETS,
  avatarFor,
  memberCan,
  memberContribution,
  serviceOf,
  type Alliance,
  type AllianceMember,
  type AlliancePermission,
} from "../../game/war/alliances";
import {
  allianceSetAvatarFn,
  allianceSetPermissionsFn,
} from "../../game/api";
import type { GameResult } from "../../game/api";
import { MemberAvatar, bustAvatarCache } from "./MemberAvatar";

const ROLE_LABEL: Record<string, string> = { leader: "Leader", officer: "Officer", member: "Member" };

/** Downscale an uploaded image to a 256px data URL (keeps saves lean). */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no ctx");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

const ALL_PERMISSIONS: { key: AlliancePermission; label: string; blurb: string }[] = [
  { key: "doctrines", label: "Doctrines", blurb: "View the alliance doctrine library" },
];

export function MemberProfile({
  member,
  alliance,
  me,
  isLeader,
  isOfficer,
  token,
  onAction,
  onClose,
}: {
  member: AllianceMember;
  alliance: Alliance;
  me: string;
  isLeader: boolean;
  isOfficer: boolean;
  token?: string;
  onAction: (fn: () => Promise<GameResult>, label: string) => void;
  onClose: () => void;
}) {
  const mine = member.colonyId === me;
  const canManage = (isLeader || isOfficer) && !mine && member.role !== "leader";
  const service = serviceOf(member);
  const contribution = memberContribution(member);
  const avatar = avatarFor(member);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const post = (fn: () => Promise<GameResult>, label: string) => {
    if (!token) return;
    setSaving(true);
    setHint(null);
    onAction(fn, label);
    setSaving(false);
  };

  const pickPreset = (key: string) => {
    bustAvatarCache(member.colonyId);
    post(() => allianceSetAvatarFn({ data: { token: token!, avatar: { kind: "preset", key } } }), "avatar");
  };

  const uploadFile = async (file: File) => {
    try {
      const dataUrl = await downscaleImage(file);
      bustAvatarCache(member.colonyId);
      post(
        () => allianceSetAvatarFn({ data: { token: token!, avatar: { kind: "upload", dataUrl } } }),
        "avatar",
      );
    } catch {
      setHint("That image didn't load — try another.");
    }
  };

  const togglePermission = (key: AlliancePermission) => {
    const cur = memberCan(alliance, member.colonyId, key);
    const next = cur
      ? (member.permissions ?? []).filter((p) => p !== key)
      : [...(member.permissions ?? []), key];
    post(
      () => allianceSetPermissionsFn({ data: { token: token!, allianceId: alliance.id, targetId: member.colonyId, permissions: next } }),
      "permissions",
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
      data-testid="member-profile"
    >
      <div
        className="w-full max-w-sm rounded-t-2xl border border-line bg-surf-1 p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <MemberAvatar member={member} token={token} size={56} />
            <div>
              <p className="text-base font-bold text-text-1">{member.colonyName}</p>
              <p className="text-xs text-text-3">
                {ROLE_LABEL[member.role] ?? member.role}
                {mine ? " · you" : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-lg border border-line px-2 py-1 text-sm text-text-2"
          >
            ✕
          </button>
        </div>

        {/* service record — what they've given the war band */}
        <div className="mt-4 rounded-xl border border-line bg-surf-2 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-3">Service record</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-extrabold text-red-300" data-testid="profile-troops-lost">
                {service.troopsLost.toLocaleString()}
              </p>
              <p className="text-[10px] text-text-3">troops lost in service</p>
            </div>
            <div>
              <p className="text-lg font-extrabold text-text-1">{service.battles}</p>
              <p className="text-[10px] text-text-3">battles bled in</p>
            </div>
            <div>
              <p className="text-lg font-extrabold text-amber-300" data-testid="profile-contribution">
                {contribution.toLocaleString()}
              </p>
              <p className="text-[10px] text-text-3">contribution</p>
            </div>
          </div>
          {service.troopsLost === 0 && (
            <p className="mt-2 text-[11px] text-text-3">
              No recorded sacrifice yet — reinforcements lost in allied battles are honored here.
            </p>
          )}
        </div>

        {/* avatar picker — your own face */}
        {mine && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-3">Your avatar</p>
            <div className="grid grid-cols-8 gap-1.5">
              {AVATAR_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.label}
                  aria-label={`Avatar: ${p.label}`}
                  aria-pressed={avatar.kind === "preset" && avatar.key === p.key}
                  onClick={() => pickPreset(p.key)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
                    avatar.kind === "preset" && avatar.key === p.key
                      ? "ring-2 ring-ember"
                      : "bg-surf-2"
                  }`}
                >
                  {p.glyph}
                </button>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-text-1"
            >
              📷 Upload your own photo
            </button>
            {hint && <p className="mt-1 text-xs text-amber-200">{hint}</p>}
          </div>
        )}

        {/* permissions — leader/officer only */}
        {canManage && (
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-3">
              Permissions
            </p>
            {ALL_PERMISSIONS.map((p) => {
              const has = memberCan(alliance, member.colonyId, p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => togglePermission(p.key)}
                  aria-pressed={has}
                  data-testid={`perm-${p.key}-${member.colonyId}`}
                  className="flex w-full items-center justify-between rounded-lg border border-line bg-surf-2 px-3 py-2"
                >
                  <span className="text-left">
                    <span className="block text-xs font-bold text-text-1">{p.label}</span>
                    <span className="block text-[11px] text-text-3">{p.blurb}</span>
                  </span>
                  <span
                    className={`flex h-6 w-11 flex-none items-center rounded-full px-0.5 ${
                      has ? "justify-end bg-emerald-600" : "justify-start bg-zinc-600"
                    }`}
                  >
                    <span className="h-5 w-5 rounded-full bg-white" />
                  </span>
                </button>
              );
            })}
            <p className="mt-1 text-[11px] text-text-3">
              New members join with doctrines off — grant it when the recruit is ready.
            </p>
          </div>
        )}

        {saving && <p className="mt-2 text-center text-xs text-text-3">Saving…</p>}
      </div>
    </div>
  );
}

export default MemberProfile;
