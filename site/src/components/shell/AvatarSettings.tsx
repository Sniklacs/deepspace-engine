// AvatarSettings — "Your face" in Settings (owner 2026-10-14).
//
// Hans: avatars belong "in the settings area with the player's shit" — not
// buried behind alliance membership. This section writes the player's OWN
// avatar (setMyAvatarFn): a preset sigil, an uploaded photo (square-cropped
// and downscaled here to a 256px data URL, then passed through the same
// avatar.ts gate the server enforces), or a reset back to the race emblem.
// The choice lives on the player's own save; the server mirrors it onto the
// war band record while the player is in an alliance.
import { useRef, useState } from "react";
import { resolvePlayerAvatar, validateAvatarDataUrl } from "../../game/avatar";
import { setMyAvatarFn, type GameResult } from "../../game/api";
import { AVATAR_PRESETS } from "../../game/war/alliances";
import { allianceOf } from "../../game/war/alliances";
import type { GameState } from "../../game/types";
import { PlayerAvatar } from "../PlayerAvatar";
import { useT } from "../i18n/I18n";

/** Square-crop + downscale an uploaded image to a 256px JPEG data URL. */
function downscaleSquare(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const side = Math.min(img.width, img.height);
        if (side <= 0) throw new Error("empty image");
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no ctx");
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          256,
          256,
        );
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

const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
const UPLOAD_RAW_MAX = 12_000_000;

export default function AvatarSettings({
  state,
  token,
  onApplied,
}: {
  state: GameState;
  token: string;
  /** The fresh server state after a change — the host applies it. */
  onApplied: (s: GameState) => void;
}) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = state.gameId ? allianceOf(state, state.gameId) : null;
  const member = mine?.members.find((m) => m.colonyId === state.gameId);
  const resolved = resolvePlayerAvatar({
    choice: state.avatarChoice,
    upload: state.avatarUpload,
    memberChoice: member?.avatar,
  });
  const hasChoice = !!state.avatarChoice || !!member?.avatar || !!state.avatarUpload;

  const call = async (
    avatar:
      | { kind: "preset"; key: string }
      | { kind: "upload"; dataUrl: string }
      | { kind: "clear" },
  ) => {
    setSaving(true);
    setHint(null);
    try {
      const res: GameResult = await setMyAvatarFn({ data: { token, avatar } });
      if (res.ok && res.state) {
        onApplied(res.state);
      } else if (!res.ok) {
        setHint(res.error ?? t("settings.avatar.failed", "That didn't save — try again."));
      }
    } catch {
      setHint(t("settings.avatar.failed", "That didn't save — try again."));
    }
    setSaving(false);
  };

  const uploadFile = async (file: File) => {
    if (!UPLOAD_TYPES.includes(file.type)) {
      setHint(
        t("settings.avatar.badType", "Avatars are pictures — PNG, JPEG or WebP. That file isn't one."),
      );
      return;
    }
    if (file.size > UPLOAD_RAW_MAX) {
      setHint(t("settings.avatar.tooBig", "That image is too large."));
      return;
    }
    try {
      const dataUrl = await downscaleSquare(file);
      // The same gate the server runs — fail here with the same words.
      const v = validateAvatarDataUrl(dataUrl);
      if (!v.ok) {
        setHint(v.error);
        return;
      }
      await call({ kind: "upload", dataUrl });
    } catch {
      setHint(t("settings.avatar.badImage", "That image didn't load — try another."));
    }
  };

  const faceLabel =
    resolved.kind === "upload"
      ? t("settings.avatar.photo", "Your photo")
      : resolved.kind === "preset"
        ? (AVATAR_PRESETS.find((p) => p.key === resolved.key)?.label ?? resolved.key)
        : t("settings.avatar.emblem", "Race emblem");

  return (
    <section aria-labelledby="settings-avatar" className="space-y-1.5">
      <h3 id="settings-avatar" className="eyebrow">
        {t("settings.avatar", "Your face")}
      </h3>
      <div className="flex items-center gap-3">
        <PlayerAvatar state={state} size={56} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-1">{faceLabel}</p>
          <p className="text-[11px] leading-snug text-text-3">
            {t(
              "settings.avatarSub",
              "The face the hall, your war band and comms see. It lives on your colony record — not on this device.",
            )}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-8 gap-1.5 pt-1" data-testid="settings-avatar-presets">
        {AVATAR_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.label}
            aria-label={`Avatar: ${p.label}`}
            aria-pressed={resolved.kind === "preset" && resolved.key === p.key}
            disabled={saving}
            onClick={() => void call({ kind: "preset", key: p.key })}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg ${
              resolved.kind === "preset" && resolved.key === p.key ? "ring-2 ring-ember" : "bg-surf-2"
            }`}
          >
            {p.glyph}
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving}
          onClick={() => fileRef.current?.click()}
          data-testid="settings-avatar-upload"
          className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-text-1 disabled:opacity-60"
        >
          {t("settings.avatar.upload", "📷 Upload your own photo")}
        </button>
        {hasChoice && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void call({ kind: "clear" })}
            data-testid="settings-avatar-clear"
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-text-2 disabled:opacity-60"
          >
            {t("settings.avatar.remove", "Reset to race emblem")}
          </button>
        )}
      </div>
      {hint && (
        <p className="text-xs text-amber-200" role="alert">
          {hint}
        </p>
      )}
      {saving && <p className="text-xs text-text-3">{t("settings.avatar.saving", "Saving…")}</p>}
    </section>
  );
}
