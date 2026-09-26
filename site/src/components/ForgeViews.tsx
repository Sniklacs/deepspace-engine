// FORGE VIEWS — the room and the rack (owner 2026-09-26).
//
// Presentation only, from the existing design system (Panel / ActionButton /
// RowButton / Tooltip, tokens only — no new visual language). Two surfaces:
//
//   • ForgeRoom — the facility in the Cradle: what it costs, what the colony
//     holds, the recovered-AI gate with its numbers, the roll, the odds, the
//     grade floor, the last piece it rendered, and the racks with melt-down.
//   • ForgedRack — the Armory's "Forged pieces" section: every rolled item with
//     its grade, its stats, its power against the earnable ceiling, where it is
//     (Cradle / in transit / field) and the melt-down valve.
//
// NOTHING here rolls anything. The roll is a server operation (api.ts →
// engine.forgeRoll): the client sends a recipe id and a request id and receives
// an item it did not choose. Every number rendered below is read from state or
// from the shared config tables (forge.ts), never invented here.
//
// Every player-facing string is a catalogue key (five languages, same commit).
import { Panel, PanelHeader } from "./ui/Panel";
import { ActionButton } from "./ui/ActionButton";
import { RowButton } from "./ui/RowButton";
import { useT } from "./i18n/I18n";
import {
  FORGE_GRADES,
  FORGE_RECIPES,
  forgeCeilingPower,
  forgeGrade,
  forgeGradeChances,
  meltRefund,
  type ForgeItem,
  type ForgeRecipe,
} from "../game/forge";
import { DOMAIN_BY_ID } from "../game/zones";
import type { GameState } from "../game/types";

/** A unique-ish request id for one roll: the server keys idempotency on it, so a
 *  double-submit replays the FIRST result instead of buying a second roll. */
export function forgeRequestId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function shortDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** One item's card: identity, grade, stats, power against the ceiling, and where
 *  it is. `onMelt` is undefined where melting makes no sense (the Armory's
 *  read-only list uses the same card with the button). */
export function ForgedPieceCard({
  item,
  now,
  onMelt,
  busy,
}: {
  item: ForgeItem;
  now: number;
  onMelt?: (itemId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const grade = forgeGrade(item.grade);
  const ceiling = item.ceilingAtRoll || forgeCeilingPower();
  const refund = meltRefund(item);
  const whereParams = item.transit ? { time: shortDuration(item.transit.arriveAt - now) } : undefined;
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-text-1">{item.name}</p>
        <span className="pill shrink-0 border border-amber-400/40 bg-amber-400/10 text-amber-100">
          {t(`forge.grade.${grade.id}`)}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-text-3">
        {t("forge.resultSub", { grade: t(`forge.grade.${grade.id}`), power: item.power })}
      </p>
      <p className="mt-1 text-[11px] text-text-3">{t("forge.ceiling", { power: item.power, ceiling })}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-text-2">
        {(["power", "precision", "guard", "logistics"] as const).map((axis) => (
          <p key={axis}>
            <span className="text-text-3">{t(`forge.stat.${axis}`)}</span>
            <b className="num ms-1 text-text-1">{item.stats[axis]}</b>
          </p>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-text-3">
        {t(`forge.where.${item.location}`, whereParams)}
      </p>
      <p className="mt-0.5 text-[11px] text-text-3">{t("forge.unique")}</p>
      {onMelt && item.location !== "transit" ? (
        <div className="mt-2">
          <ActionButton
            size="sm"
            variant="secondary"
            label={t("forge.melt")}
            sub={t("forge.meltSub", { warplate: refund.warplate, supplies: refund.supplies })}
            busy={busy}
            onClick={() => onMelt(item.id)}
            testid="forge-melt"
          />
        </div>
      ) : null}
    </div>
  );
}

/** One recipe: what it consumes, what it guarantees, what it might give. */
function RecipeCard({
  state,
  recipe,
  onRoll,
  busy,
}: {
  state: GameState;
  recipe: ForgeRecipe;
  onRoll: (recipeId: string, requestId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const r = state.resources;
  const domainName = t(`domain.${recipe.unlock.domain}.name`, DOMAIN_BY_ID[recipe.unlock.domain].name);
  const have = state.deployedDomains[recipe.unlock.domain] ?? 0;
  const unlocked = have >= recipe.unlock.level;
  const chances = forgeGradeChances(recipe);
  const enough =
    Math.floor(r.warplate ?? 0) >= recipe.cost.warplate &&
    Math.floor(r.supplies) >= recipe.cost.supplies &&
    Math.floor(r.embers) >= recipe.cost.embers;
  const locked = !unlocked || !enough;
  const reason = !unlocked
    ? t("forge.needs", { domain: domainName, level: recipe.unlock.level, have })
    : !enough
      ? t("forge.none")
      : undefined;
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3">
      <p className="text-sm font-semibold text-text-1">{t(`forge.recipe.${recipe.id}`)}</p>
      <p className="text-[11px] text-text-3">{t(`forge.recipe.${recipe.id}Sub`)}</p>
      <p className="mt-2 text-[11px] text-text-3">{t("forge.cost")}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
        <span className="pill border border-line bg-surf-2 text-text-2">
          <b className="num text-text-1">{r.warplate ?? 0}</b>
          <span className="ms-1">{t("forge.warplate")}</span>
        </span>
        <span className="pill border border-line bg-surf-2 text-text-2">
          <b className="num text-text-1">{Math.floor(r.supplies)}</b>
          <span className="ms-1">{t("ribbon.supplies")}</span>
        </span>
        <span className="pill border border-line bg-surf-2 text-text-2">
          <b className="num text-text-1">{Math.floor(r.embers)}</b>
          <span className="ms-1">{t("ribbon.embers")}</span>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-text-3">
        {t("forge.floor", { grade: t(`forge.grade.${forgeGrade(recipe.minGrade).id}`) })}
      </p>
      <p className="mt-1 text-[11px] text-text-3">
        {t("forge.odds")}
      </p>
      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-text-2">
        {FORGE_GRADES.map((g, i) =>
          chances[i] > 0 ? (
            <span key={g.id} className="chip border border-line">
              {t(`forge.grade.${g.id}`)}
              <b className="num ms-1 text-text-1">{Math.round(chances[i] * 100)}%</b>
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-2">
        <ActionButton
          full
          label={t("forge.roll")}
          sub={t("forge.rollSub", {
            warplate: recipe.cost.warplate,
            supplies: recipe.cost.supplies,
            embers: recipe.cost.embers,
          })}
          icon="flame"
          locked={locked}
          reason={reason}
          busy={busy}
          onClick={() => onRoll(recipe.id, forgeRequestId())}
          testid={`forge-roll-${recipe.id}`}
        />
      </div>
    </div>
  );
}

/**
 * THE ROOM — the Forge in the Cradle. Shows the stock, both recipes with their
 * real costs and odds, the recovered-AI gate (with numbers, never a hard-lock),
 * the most recent piece and the racks.
 */
export function ForgeRoom({
  state,
  now,
  onRoll,
  onMelt,
  busy,
}: {
  state: GameState;
  now: number;
  onRoll: (recipeId: string, requestId: string) => void;
  onMelt: (itemId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const items = state.forgeItems ?? [];
  const warplate = Math.floor(state.resources.warplate ?? 0);
  const newest = [...items].sort((a, b) => (b.provenance?.rolledAt ?? 0) - (a.provenance?.rolledAt ?? 0))[0];
  return (
    <div className="space-y-3">
      <Panel testid="forge-room">
        <PanelHeader
          eyebrow={t("forge.warplate")}
          title={t("forge.title")}
          sub={t("forge.sub")}
          right={
            <span className="pill border border-amber-400/40 bg-amber-400/10 text-amber-100">
              <b className="num">{warplate}</b>
              <span className="ms-1">{t("forge.warplate")}</span>
            </span>
          }
        />
        <p className="mt-2 text-[11px] text-text-3">{t("forge.warplateSub")}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-text-2">
          {[0, 1, 2, 3].map((tier) => (
            <span key={tier} className="chip border border-line">
              {t(`forge.depth.${tier}`)}
            </span>
          ))}
        </div>
        {warplate === 0 ? (
          <p className="mt-1 text-[11px] text-amber-200">{t("forge.none")}</p>
        ) : null}
      </Panel>

      {newest && newest.provenance?.rolledAt ? (
        <Panel variant="tinted" testid="forge-last">
          <PanelHeader
            eyebrow={t("forge.result")}
            title={newest.name}
            sub={t("forge.resultSub", {
              grade: t(forgeGrade(newest.grade).labelKey),
              power: newest.power,
            })}
          />
          <div className="mt-2">
            <ForgedPieceCard item={newest} now={now} onMelt={onMelt} busy={busy} />
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {FORGE_RECIPES.map((recipe) => (
          <RecipeCard key={recipe.id} state={state} recipe={recipe} onRoll={onRoll} busy={busy} />
        ))}
      </div>

      <Panel testid="forge-racks">
        <PanelHeader title={t("forge.rack")} sub={t("forge.shipNote")} />
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-text-3">{t("forge.rackEmpty")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {items.map((it) => (
              <ForgedPieceCard key={it.id} item={it} now={now} onMelt={onMelt} busy={busy} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** THE RACK — the Armory's forged-gear section. Read-only except melt-down: a
 *  forged piece IS a weapon of this colony (it rides the same four stats and the
 *  same unit power the battle engine prices a kit with). */
export function ForgedRack({
  state,
  now,
  onMelt,
  busy,
}: {
  state: GameState;
  now: number;
  onMelt: (itemId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const items = state.forgeItems ?? [];
  const ceiling = forgeCeilingPower();
  if (items.length === 0) {
    return (
      <Panel testid="armory-forged">
        <PanelHeader title={t("forge.armory")} sub={t("forge.armorySub")} />
        <p className="mt-2 text-sm text-text-3">{t("forge.armoryEmpty")}</p>
      </Panel>
    );
  }
  return (
    <Panel testid="armory-forged">
      <PanelHeader
        title={t("forge.armory")}
        sub={t("forge.armorySub")}
        right={
          <span className="chip border border-line text-text-2">
            <b className="num text-text-1">{items.length}</b>
          </span>
        }
      />
      <p className="mt-1 text-[11px] text-text-3">{t("forge.ceiling", { power: ceiling, ceiling })}</p>
      <div className="mt-2 space-y-2">
        {items.map((it) => (
          <ForgedPieceCard key={it.id} item={it} now={now} onMelt={onMelt} busy={busy} />
        ))}
      </div>
    </Panel>
  );
}

/** The Cradle's door to the room (a RowButton in the home's own idiom). */
export function ForgeDoor({
  state,
  onOpen,
}: {
  state: GameState;
  onOpen: () => void;
}) {
  const t = useT();
  const items = (state.forgeItems ?? []).length;
  return (
    <RowButton
      icon="flame"
      title={t("forge.open")}
      sub={t("forge.openSub")}
      chip={
        <span className="chip border border-line text-text-2">
          <b className="num text-text-1">{items}</b>
        </span>
      }
      onClick={onOpen}
    />
  );
}
