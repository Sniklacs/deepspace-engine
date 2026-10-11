// MemberAvatar — an alliance member's face (owner 2026-10-11).
//
// Renders the preset sigil or the member's uploaded image. Uploads are
// fetched on demand from the member's own save (allianceGetAvatarFn) and
// cached per session — the member record carries only the reference, so
// avatars stay in sync when someone changes theirs: the next render reads
// the fresh reference.

import { useEffect, useState } from "react";
import { avatarFor, avatarGlyph, type AllianceMember } from "../../game/war/alliances";
import { allianceGetAvatarFn } from "../../game/api";

/** Session cache: colonyId -> data URL (or "" when none). */
const uploadCache = new Map<string, string>();

export function MemberAvatar({
  member,
  token,
  size = 24,
  className = "",
}: {
  member: Pick<AllianceMember, "colonyId" | "avatar">;
  token?: string;
  size?: number;
  className?: string;
}) {
  const avatar = avatarFor(member);
  const [upload, setUpload] = useState<string | null>(
    avatar.kind === "upload" ? (uploadCache.get(member.colonyId) ?? null) : null,
  );

  useEffect(() => {
    if (avatar.kind !== "upload" || !token) return;
    if (uploadCache.has(member.colonyId)) {
      setUpload(uploadCache.get(member.colonyId) ?? "");
      return;
    }
    let live = true;
    allianceGetAvatarFn({ data: { token, colonyId: member.colonyId } })
      .then((res) => {
        if (!live) return;
        const url = res.ok ? (res.dataUrl ?? "") : "";
        uploadCache.set(member.colonyId, url);
        setUpload(url);
      })
      .catch(() => {
        if (live) setUpload("");
      });
    return () => {
      live = false;
    };
  }, [avatar.kind, member.colonyId, token]);

  /** Bust the session cache when a member changes their avatar. */
  useEffect(() => {
    if (avatar.kind !== "upload") uploadCache.delete(member.colonyId);
  }, [avatar.kind, member.colonyId]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };
  if (avatar.kind === "upload" && upload) {
    return (
      <img
        src={upload}
        alt=""
        aria-hidden="true"
        style={style}
        className={`flex-none rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`flex flex-none items-center justify-center rounded-full bg-ember/20 ${className}`}
    >
      {avatar.kind === "upload" ? "🪖" : avatarGlyph(avatar.key)}
    </span>
  );
}

/** Drop a cached upload (e.g. right after the member changes it). */
export function bustAvatarCache(colonyId: string): void {
  uploadCache.delete(colonyId);
}

export default MemberAvatar;
