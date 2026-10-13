// OFF THE WALL — the living chalkboards of the War Room
// (design/war-room-walls.md, owner Oct 12 2026; built Oct 13 2026).
//
// A hallway of chalkboards inside the War Room (the Logistics Hall's
// doctrinal home): the 24 playbook maxims and the field marks scrawled
// small in chalk — tap one and it magnifies. The OFF THE WALL board is
// the cryptic FAQ: one-liners, no explanation, ever. And three boards
// are LIVE, driven by the pure feed in game/war/off-the-wall.ts:
//   · THE WAR — the player's real fronts and last battle, off the ledger.
//   · THE LESSON — the maxim their last battle just taught them, pinned.
//   · THE WORD — their own race Oracle's riddle for today, plus corpus
//     tips surfaced by their actual Chorus/corruption meters.
// A board that never changed would be a poster. This one changes with
// every battle the player fights and every day that turns.

import { useMemo, useState } from "react";
import {
  WALL_MAXIMS,
  WALL_FIELD_MARKS,
  WALL_SCRAWLS,
  WALL_MAXIM_BY_ID,
  freshScrawls,
  type WallBoardId,
  type WallEntry,
  type WallLiveFeed,
  type WallOracleWord,
  type WallTipRef,
} from "../../game/war/off-the-wall";
import { tipT } from "../../game/tooltips";
import { useT } from "../i18n/I18n";

export interface OffTheWallProps {
  feed: WallLiveFeed;
  tips: WallTipRef[];
  oracle: WallOracleWord | null;
  now: number;
}

const BOARDS: { id: WallBoardId; label: string; icon: string }[] = [
  { id: "war", label: "The War", icon: "⚔️" },
  { id: "playbook", label: "Playbook", icon: "📖" },
  { id: "field-marks", label: "Field Marks", icon: "✒️" },
  { id: "scrawls", label: "Off The Wall", icon: "🖍️" },
  { id: "word", label: "The Word", icon: "🔮" },
];

/** Chalk handwriting stack — falls back gracefully where no hand font lives. */
const CHALK_FONT = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";

/** Deterministic slight tilt per entry, so the wall reads hand-scrawled. */
function tilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return ((h % 5) - 2) * 0.4; // −0.8°…+0.8°
}

function ChalkLine({
  entry,
  onTap,
  testId,
}: {
  entry: WallEntry;
  onTap: (e: WallEntry) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onTap(entry)}
      data-testid={testId}
      aria-label={`Magnify: ${entry.chalk}`}
      className="block w-full px-1 py-1 text-left text-[11px] leading-snug text-zinc-100/75 transition-colors hover:text-white sm:text-xs"
      style={{ fontFamily: CHALK_FONT, transform: `rotate(${tilt(entry.id)}deg)`, textShadow: "0 0 6px rgba(255,255,255,0.25)" }}
    >
      {entry.chalk}
      {entry.locked && <span className="ml-1 align-super text-[8px] text-amber-200/70">✦</span>}
    </button>
  );
}

export function OffTheWall({ feed, tips, oracle, now }: OffTheWallProps) {
  const t = useT();
  const [board, setBoard] = useState<WallBoardId>("war");
  const [magnified, setMagnified] = useState<WallEntry | null>(null);

  const lesson = WALL_MAXIM_BY_ID[feed.lessonMaximId] ?? WALL_MAXIMS[0];
  const todaysScrawls = useMemo(() => freshScrawls(now), [now]);
  const last = feed.lastBattle;

  const openBoard = (b: WallBoardId) => {
    setBoard(b);
    setMagnified(null);
  };

  return (
    <div data-testid="off-the-wall" className="space-y-3">
      <div>
        <h3 className="text-sm font-extrabold tracking-wide text-amber-200">
          🖍️ {t("wall.title", "OFF THE WALL")}
        </h3>
        <p className="text-[11px] text-zinc-500">
          {t("wall.intro", "The hallway remembers everything the field taught. Read the walls — tap the chalk to read it big.")}
        </p>
      </div>

      {/* board flipper */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("wall.boardsLabel", "Chalkboards")}>
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={board === b.id}
            onClick={() => openBoard(b.id)}
            data-testid={`wall-board-${b.id}`}
            className={`min-h-[44px] rounded-lg border px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${
              board === b.id
                ? "border-amber-300/60 bg-amber-400/10 text-amber-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {b.icon} {t(`wall.board.${b.id}`, b.label)}
            {b.id === "war" && feed.fronts.length > 0 && (
              <span className="ml-1 rounded-full bg-rose-500/80 px-1.5 text-[10px] text-white">{feed.fronts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* the board itself — chalk on slate, in the race-skinned room */}
      <div
        className="relative overflow-hidden rounded-xl border-4 border-[#4a3826] shadow-inner"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.05), transparent 55%), radial-gradient(ellipse at 75% 85%, rgba(255,255,255,0.04), transparent 50%), linear-gradient(160deg, #232d24 0%, #1b241c 55%, #161d17 100%)",
        }}
      >
        {/* magnifier — the tapped scrawl, pulled up big (Exit Law: its own ≥44px close) */}
        {magnified && (
          <div className="border-b border-white/10 bg-black/35 px-4 py-4" data-testid="wall-magnifier">
            <div className="flex items-start justify-between gap-3">
              <p
                className="text-lg leading-snug text-zinc-50 sm:text-xl"
                style={{ fontFamily: CHALK_FONT, textShadow: "0 0 10px rgba(255,255,255,0.35)" }}
              >
                {magnified.chalk}
              </p>
              <button
                type="button"
                onClick={() => setMagnified(null)}
                aria-label={t("wall.closeMagnifier", "Put it back on the wall")}
                data-testid="wall-magnifier-close"
                className="flex min-h-[44px] min-w-[44px] flex-none items-center justify-center rounded-lg border border-white/25 text-base text-zinc-200 hover:bg-white/10"
              >
                ✕
              </button>
            </div>
            {magnified.body ? (
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-zinc-300">{magnified.body}</p>
            ) : (
              <p className="mt-2 text-[11px] italic text-zinc-500">
                {t("wall.noExplanation", "No explanation. It'll make sense after it happens to you.")}
              </p>
            )}
          </div>
        )}

        <div className="max-h-[46vh] overflow-y-auto px-3 py-3 sm:px-4">
          {board === "war" && (
            <div data-testid="wall-board-war">
              {feed.fronts.length === 0 && !last ? (
                <p className="px-1 py-2 text-xs text-zinc-100/80" style={{ fontFamily: CHALK_FONT }}>
                  {t("wall.warQuiet", "No wars yet. The wall is patient.")}
                </p>
              ) : (
                <div className="space-y-3">
                  {feed.fronts.length > 0 && (
                    <div>
                      <p className="px-1 text-[10px] font-extrabold uppercase tracking-[0.25em] text-rose-200/80">
                        {t("wall.warNow", "The war right now")}
                      </p>
                      {feed.fronts.map((f) => (
                        <p key={f.battleId} className="px-1 py-1 text-xs text-zinc-100/85" style={{ fontFamily: CHALK_FONT }}>
                          {f.zoneName} — {f.attacking ? t("wall.youMarch", "you march on") : t("wall.youHold", "you hold against")} {f.foeName}
                        </p>
                      ))}
                    </div>
                  )}
                  {last && (
                    <div>
                      <p className="px-1 text-[10px] font-extrabold uppercase tracking-[0.25em] text-amber-200/80">
                        {t("wall.lastLesson", "The last lesson")}
                      </p>
                      <p className="px-1 py-1 text-xs text-zinc-100/85" style={{ fontFamily: CHALK_FONT }}>
                        {last.zoneName} —{" "}
                        {last.won === null
                          ? t("wall.standoff", "nobody held it")
                          : last.won
                            ? t("wall.youHeld", "you held the field")
                            : t("wall.youLost", "the field held you")}{" "}
                        · {t("wall.theirs", "theirs")} {last.theirCasualties} · {t("wall.yours", "yours")} {last.myCasualties}
                      </p>
                      <p className="px-1 text-[11px] text-zinc-400">
                        {t("wall.battlesFought", "Battles fought")}: {feed.battlesFought}
                      </p>
                    </div>
                  )}
                  {/* THE LESSON — the maxim the last battle taught, pinned big */}
                  <div className="rounded-lg border border-amber-200/25 bg-black/25 px-3 py-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-amber-200/90">
                      📌 {t("wall.lessonPinned", "Pinned for you")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMagnified(lesson)}
                      data-testid="wall-lesson"
                      aria-label={`Magnify the lesson: ${lesson.chalk}`}
                      className="mt-1 block min-h-[44px] w-full text-left text-base leading-snug text-amber-50 sm:text-lg"
                      style={{ fontFamily: CHALK_FONT, textShadow: "0 0 10px rgba(255,220,150,0.3)" }}
                    >
                      {lesson.chalk}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {board === "playbook" && (
            <div data-testid="wall-board-playbook" className="columns-1 gap-6 sm:columns-2">
              {WALL_MAXIMS.map((e) => (
                <ChalkLine key={e.id} entry={e} onTap={setMagnified} testId={`wall-maxim-${e.id}`} />
              ))}
            </div>
          )}

          {board === "field-marks" && (
            <div data-testid="wall-board-field-marks">
              {WALL_FIELD_MARKS.map((e) => (
                <ChalkLine key={e.id} entry={e} onTap={setMagnified} testId={`wall-mark-${e.id}`} />
              ))}
            </div>
          )}

          {board === "scrawls" && (
            <div data-testid="wall-board-scrawls">
              <p className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.25em] text-zinc-300/70">
                {t("wall.freshChalk", "Fresh chalk today")}
              </p>
              {todaysScrawls.map((e) => (
                <ChalkLine key={`fresh-${e.id}`} entry={e} onTap={setMagnified} testId={`wall-fresh-${e.id}`} />
              ))}
              <p className="px-1 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[0.25em] text-zinc-300/70">
                {t("wall.wholeWall", "The whole wall")}
              </p>
              {WALL_SCRAWLS.map((e) => (
                <ChalkLine key={e.id} entry={e} onTap={setMagnified} testId={`wall-scrawl-${e.id}`} />
              ))}
            </div>
          )}

          {board === "word" && (
            <div data-testid="wall-board-word" className="space-y-4 px-1 py-1">
              {oracle ? (
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-violet-200/80">
                    🔮 {oracle.oracleName}, {oracle.epithet} — {t("wall.todaysWord", "today's word")}
                  </p>
                  <p className="py-2 text-base leading-snug text-zinc-50 sm:text-lg" style={{ fontFamily: CHALK_FONT, textShadow: "0 0 10px rgba(255,255,255,0.3)" }}>
                    {oracle.line}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-zinc-400">{t("wall.noOracle", "Your Oracle hasn't found this wall yet.")}</p>
              )}
              {tips.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-zinc-300/70">
                    {t("wall.chalkedForYou", "Chalked up for your situation")}
                  </p>
                  {tips.map((ref) => (
                    <div key={`${ref.block}-${ref.id}`} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2" data-testid={`wall-tip-${ref.id}`}>
                      {ref.because && <p className="pb-1 text-[10px] font-bold uppercase tracking-wider text-amber-200/80">{ref.because}</p>}
                      <div className="text-[11px] leading-relaxed text-zinc-300">{tipT(t, ref.block, ref.id, ref.tip)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
