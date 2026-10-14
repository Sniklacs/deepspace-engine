// PlayerAvatar — the player's OWN face (owner 2026-10-14).
//
// Renders what game/avatar.ts resolves from the player's own save: their
// uploaded photo, their chosen preset sigil, or — when nothing was ever
// chosen — the race-emblem default (the race's canon accent carrying the
// sigil mark). Until a personal choice exists, the war band record's face
// is honored so a face set through the old alliance profile doesn't vanish
// from the personal surfaces (ribbon identity tile, Cradle sheet, Settings
// preview). Alliance MATES render through MemberAvatar instead — their
// uploads are fetched on demand; this component is only ever the viewer.
import { resolvePlayerAvatar } from "../game/avatar";
import { getRace } from "../game/races";
import { allianceOf } from "../game/war/alliances";
import type { GameState } from "../game/types";
import { Icon } from "./icons";

export function PlayerAvatar({
  state,
  size = 24,
  className = "",
}: {
  state: Pick<GameState, "avatarChoice" | "avatarUpload" | "race" | "gameId" | "alliances">;
  size?: number;
  className?: string;
}) {
  const mine = state.gameId ? allianceOf(state as GameState, state.gameId) : null;
  const member = mine?.members.find((m) => m.colonyId === state.gameId);
  const avatar = resolvePlayerAvatar({
    choice: state.avatarChoice,
    upload: state.avatarUpload,
    memberChoice: member?.avatar,
  });
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };

  if (avatar.kind === "upload") {
    return (
      <img
        src={avatar.dataUrl}
        alt=""
        aria-hidden="true"
        style={style}
        className={`flex-none rounded-full object-cover ${className}`}
      />
    );
  }
  if (avatar.kind === "preset") {
    return (
      <span
        aria-hidden="true"
        style={style}
        className={`flex flex-none items-center justify-center rounded-full bg-ember/20 ${className}`}
      >
        {avatar.glyph}
      </span>
    );
  }
  // The race-emblem default: the race's canon accent + the sigil mark.
  const race = getRace(state.race ?? "watchers");
  return (
    <span
      aria-hidden="true"
      style={{ ...style, background: `${race.accent}2b`, color: race.accentText }}
      className={`flex flex-none items-center justify-center rounded-full ${className}`}
    >
      <Icon name="emblem" size={Math.round(size * 0.58)} />
    </span>
  );
}

export default PlayerAvatar;
