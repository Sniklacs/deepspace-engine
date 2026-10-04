// AllianceShipyard — the shared ship-factory UI.
//
// Rendered in the alliance home (Battles tab) AND in the Cradle page's
// alliance section, so both surfaces show the same build queue and fleet.
// Ordering / crewing goes through the engine actions (orderShipFn /
// contributeShipFn); this file reads `alliance.shipyard` and posts.
//
// Hans's rule: every button is always rendered and tappable. When the
// player can't afford a ship, tapping shows the missing requirement inline.
import { useMemo, useState } from "react";
import type { Alliance } from "../game/war/alliances";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import type { T } from "../game/i18n";
import {
  SHIP_CLASSES,
  SHIP_COST,
  ensureShipyard,
  shipBuildDurationMs,
  shipCostBlocker,
  shipName,
  shipNeedsAlliance,
  type ShipClass,
} from "../game/shipyard";
import { SHIP_FIREPOWER, SHIP_HULL } from "../game/raids";
import { classTurret } from "../game/turrets";
import { TurretThumb } from "./TurretThumb";
import { StackedShips, ShipArt } from "./StackedShips";
import { SegmentedControl } from "./SegmentedControl";
import { ShipGuide } from "./ShipyardGuides";
import { orderShipFn, contributeShipFn, donateShipyardFn, setTitheFn } from "../game/api";
import { useT } from "./i18n/I18n";
import { Icon } from "./icons";
import { Bdi } from "./ui/Bdi";
import { ActionButton } from "./ui/ActionButton";
import { ensureStockpile } from "../game/shipyard";
import { memberRole } from "../game/war/alliances";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

function fmtLeft(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function costLine(t: T, cls: ShipClass): string {
  const c = SHIP_COST[cls];
  const parts = [`${c.supplies.toLocaleString()} ${t("shipyard.costSupplies", "supplies")}`];
  if (c.raceMaterial > 0) parts.push(`${c.raceMaterial} ${t("shipyard.costMat", "race mat")}`);
  if (c.alloys > 0) parts.push(`${c.alloys} ${t("shipyard.costAlloys", "alloys")}`);
  return parts.join(" · ");
}

/** Compact armament strip: class turret art + armament line under a build button. */
function ArmamentStrip({ cls, t }: { cls: ShipClass; t: T }) {
  const def = classTurret(cls);
  return (
    <div
      className="mt-1 flex items-center gap-1.5 px-1"
      title={def.flavor}
    >
      <TurretThumb shipClass={cls} size={20} />
      <span className="text-[11px] text-text-3">
        {t("shipyard.armament", def.armamentLine)}
      </span>
    </div>
  );
}

/** Combat stat line for a ship class (owner 2026-10-03): ⚔ firepower · 🛡 hull. */
function combatLine(t: T, cls: ShipClass): string {
  return t(
    "shipyard.combatStats",
    "⚔ {fp} · 🛡 {hull}",
    { fp: SHIP_FIREPOWER[cls], hull: SHIP_HULL[cls] },
  );
}

function blockerHint(t: T, cls: ShipClass, state: GameState): string | null {
  const b = shipCostBlocker(state, cls);
  if (!b) return null;
  if (b.kind === "supplies") return t("shipyard.hintSupplies", "Needs {need} supplies — you have {have}.", { need: b.need.toLocaleString(), have: b.have.toLocaleString() });
  if (b.kind === "alloys") return t("shipyard.hintAlloys", "Needs {need} alloys — you have {have}. Forge them from race materials.", { need: b.need.toLocaleString(), have: b.have.toLocaleString() });
  return t("shipyard.hintMaterial", "Needs {need} race material — you have {have}. Raid to gather more.", { need: b.need.toLocaleString(), have: b.have.toLocaleString() });
}

export function AllianceShipyardSection({
  alliance,
  now,
  me,
  state,
  token,
  onAction,
}: {
  alliance: Alliance;
  now: number;
  me: string;
  state: GameState;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const sy = useMemo(() => ensureShipyard(alliance), [alliance]);
  const queue = sy.queue ?? [];
  const ships = sy.ships ?? [];
  const [hintFor, setHintFor] = useState<string | null>(null);
  const [tab, setTab] = useState("factory");
  const raceId = state.race ?? "draconians";
  const warships = SHIP_CLASSES.filter((c) => shipNeedsAlliance(c));

  const order = (cls: ShipClass) => {
    if (!token) {
      setHintFor(cls);
      return;
    }
    const hint = blockerHint(t, cls, state);
    if (hint) {
      setHintFor(cls);
      return;
    }
    setHintFor(null);
    onAction(() => orderShipFn({ data: { token, allianceId: alliance.id, shipClass: cls } }), "orderShip");
  };

  const contribute = (buildId: string) => {
    if (!token) return;
    onAction(() => contributeShipFn({ data: { token, allianceId: alliance.id, buildId } }), "contributeShip");
  };

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-2">
        <Icon name="hammer" size={13} aria-hidden="true" />
        {t("shipyard.title", "Ship Factory")}{" "}
        <span className="font-normal normal-case">
          · {t("shipyard.level", "Factory Level {level}", { level: sy.level })}
        </span>
      </h4>

      {/* In-module tabs: factory, fleet, and the ship field manual (owner 2026-10-04). */}
      <SegmentedControl
        options={[
          { id: "factory", label: t("shipyard.tabFactory", "Ship Factory") },
          { id: "fleet", label: t("shipyard.tabFleet", "Fleet") },
          { id: "guide", label: t("shipyard.tabShipGuide", "Ship Guide") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("shipyard.tabs", "Shipyard sections")}
        className="mb-3"
      />

      {tab === "factory" && (
        <>
      {/* Build controls — the five warship classes (owner 2026-10-03). */}
      <div className="mb-3 grid grid-cols-1 gap-1.5">
        {warships.map((cls) => {
          const time = fmtLeft(shipBuildDurationMs(cls, 0, sy.level));
          return (
            <div key={cls}>
              <ActionButton
                full
                size="sm"
                icon="hammer"
                label={
                  <span className="flex items-center gap-2">
                    <ShipArt raceId={raceId} shipClass={cls} size={44} />
                    <span>{t("shipyard.buildShip", "Build {ship}", { ship: shipName(raceId, cls) })}</span>
                  </span>
                }
                sub={`${costLine(t, cls)} · ~${time} · ${combatLine(t, cls)}`}
                onClick={() => order(cls)}
                testid={`shipyard-build-${cls}`}
              />
              <ArmamentStrip cls={cls} t={t} />
              {hintFor === cls && (
                <p className="mt-1 px-1 text-[11px] text-amber-300">
                  {!token
                    ? t("shipyard.hintSignIn", "Sign in to order ships.")
                    : (blockerHint(t, cls, state) ?? "")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Donations + tithe (owner 2026-10-03): fund the factory. */}
      <DonationSection alliance={alliance} me={me} token={token} onAction={onAction} />

      {queue.length === 0 ? (
        <p className="text-xs text-text-2">{t("cradleAlliance.noBuilds", "No ships under construction.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {queue.map((b) => {
            const total = Math.max(1, b.doneAt - b.startedAt);
            const pct = Math.max(0, Math.min(100, Math.round(((now - b.startedAt) / total) * 100)));
            const onCrew = b.contributors.includes(me);
            return (
              <li key={b.id} className="rounded-lg border border-line bg-surf-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ShipArt raceId={b.raceId} shipClass={b.shipClass} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-1">{shipName(b.raceId, b.shipClass)}</span>
                  <span className="shrink-0 text-[11px] text-text-2">
                    <Bdi dir="ltr" className="num">{pct}%</Bdi> · {fmtLeft(b.doneAt - now)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surf-3">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-text-2">
                    {t("shipyard.contributing", "{count} on crew", { count: b.contributors.length })}
                    {b.orderedByName ? ` · ${b.orderedByName}` : ""}
                  </p>
                  {onCrew ? (
                    <span className="shrink-0 text-[11px] text-emerald-300">
                      {t("shipyard.onCrew", "On crew ✓")}
                    </span>
                  ) : (
                    <button
                      className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-text-1"
                      onClick={() => contribute(b.id)}
                    >
                      {t("shipyard.contribute", "Join Build Crew")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}

      {tab === "fleet" && (
        <>
      <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {t("cradleAlliance.fleet", "Fleet")} <Bdi dir="ltr" className="num">({ships.length})</Bdi>
      </h5>
      {ships.length === 0 ? (
        <p className="text-xs text-text-2">{t("cradleAlliance.noShips", "No completed ships yet.")}</p>
      ) : (
        /* Identical ships stack into one row with a ×N badge (owner 2026-10-04);
           tap the stack to expand and inspect the individual ships. */
        <StackedShips
          ships={ships}
          testid="shipyard-fleet"
          renderShip={(s) => (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surf-1 px-3 py-1.5">
              <ShipArt raceId={s.raceId} shipClass={s.class} size={32} />
              <TurretThumb shipClass={s.class} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-1">{s.name}</span>
                <span className="block text-[10px] text-text-3">{combatLine(t, s.class)}</span>
              </span>
              <span className="shrink-0 text-[11px] text-text-2">
                {t(`shipyard.status.${s.status}`, s.status)}
              </span>
            </div>
          )}
        />
      )}
        </>
      )}

      {tab === "guide" && <ShipGuide raceId={raceId} />}
    </div>
  );
}

/** Donations + tithe controls (owner 2026-10-03). */
function DonationSection({
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
  const sy = ensureShipyard(alliance);
  const sp = ensureStockpile(sy);
  const [supplies, setSupplies] = useState("");
  const [alloys, setAlloys] = useState("");
  const [mats, setMats] = useState("");
  const [tithe, setTithe] = useState<string | null>(null);
  const role = memberRole(alliance, me);
  const isOfficer = role === "leader" || role === "officer";
  const titheRate = alliance.titheRate ?? 0;

  const donate = () => {
    if (!token) return;
    const s = Math.max(0, Math.floor(Number(supplies) || 0));
    const a = Math.max(0, Math.floor(Number(alloys) || 0));
    const m = Math.max(0, Math.floor(Number(mats) || 0));
    if (s === 0 && a === 0 && m === 0) return;
    onAction(() => donateShipyardFn({ data: { token, allianceId: alliance.id, supplies: s, alloys: a, raceMats: m } }), "donateShipyard");
    setSupplies(""); setAlloys(""); setMats("");
  };

  const saveTithe = () => {
    if (!token || tithe === null) return;
    const r = Math.max(0, Math.min(100, Math.round(Number(tithe) || 0)));
    onAction(() => setTitheFn({ data: { token, allianceId: alliance.id, rate: r } }), "setTithe");
    setTithe(null);
  };

  return (
    <div className="mb-3 rounded-lg border border-line bg-surf-1 px-3 py-2">
      <h5 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-2">
        <Icon name="crate" size={12} aria-hidden="true" />
        {t("shipyard.stockpile", "Factory Stockpile")}
      </h5>
      <p className="mb-2 text-[11px] text-text-2">
        <Bdi dir="ltr" className="num">{sp.supplies.toLocaleString()}</Bdi> {t("shipyard.costSupplies", "supplies")} ·{" "}
        <Bdi dir="ltr" className="num">{sp.alloys.toLocaleString()}</Bdi> {t("shipyard.costAlloys", "alloys")} ·{" "}
        <Bdi dir="ltr" className="num">{sp.raceMats.toLocaleString()}</Bdi> {t("shipyard.costMat", "race mat")}
      </p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <input
          type="number" min="0" placeholder={t("shipyard.donateSupplies", "Supplies")}
          value={supplies} onChange={(e) => setSupplies(e.target.value)}
          className="w-full rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-sm text-text-1"
          aria-label={t("shipyard.donateSupplies", "Supplies")}
        />
        <input
          type="number" min="0" placeholder={t("shipyard.donateAlloys", "Alloys")}
          value={alloys} onChange={(e) => setAlloys(e.target.value)}
          className="w-full rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-sm text-text-1"
          aria-label={t("shipyard.donateAlloys", "Alloys")}
        />
        <input
          type="number" min="0" placeholder={t("shipyard.donateMats", "Race mat")}
          value={mats} onChange={(e) => setMats(e.target.value)}
          className="w-full rounded-lg border border-line bg-surf-2 px-2 py-1.5 text-sm text-text-1"
          aria-label={t("shipyard.donateMats", "Race mat")}
        />
      </div>
      <ActionButton
        full size="sm" icon="crate"
        label={t("shipyard.donate", "Donate to Shipyard")}
        sub={t("shipyard.donateSub", "Fund the factory — warships are built from donations.")}
        onClick={donate}
        testid="shipyard-donate"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-text-2">
          {t("shipyard.tithe", "Tithe")}: <Bdi dir="ltr" className="num">{titheRate}%</Bdi>{" "}
          <span className="text-text-3">{t("shipyard.titheHint", "of raid/glean loot auto-flows here")}</span>
        </p>
        {isOfficer && (
          <div className="flex items-center gap-1.5">
            <input
              type="number" min="0" max="100"
              placeholder="0-100"
              value={tithe ?? ""}
              onChange={(e) => setTithe(e.target.value)}
              className="w-16 rounded-lg border border-line bg-surf-2 px-2 py-1 text-sm text-text-1"
              aria-label={t("shipyard.tithe", "Tithe")}
            />
            <button
              className="rounded-lg border border-line px-2 py-1 text-[11px] text-text-1"
              onClick={saveTithe}
            >
              {t("shipyard.setTithe", "Set")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Solo scout construction — no alliance needed (owner 2026-10-03). */
export function PersonalShipyardSection({
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
  const t = useT();
  const psy = state.worldMap?.shipyard;
  const queue = psy?.queue ?? [];
  const ships = psy?.ships ?? [];
  const [hint, setHint] = useState<string | null>(null);
  const raceId = state.race ?? "draconians";
  const cls: ShipClass = "scout";

  const order = () => {
    if (!token) {
      setHint(t("shipyard.hintSignIn", "Sign in to order ships."));
      return;
    }
    const h = blockerHint(t, cls, state);
    if (h) {
      setHint(h);
      return;
    }
    setHint(null);
    // Scouts don't need an alliance — allianceId is ignored server-side for scouts.
    onAction(() => orderShipFn({ data: { token, allianceId: "solo", shipClass: cls } }), "orderShip");
  };

  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-2">
        <Icon name="send" size={13} aria-hidden="true" />
        {t("shipyard.personalTitle", "Personal Shipyard")}
      </h4>
      <p className="mb-2 text-[11px] text-text-3">
        {t("shipyard.personalSub", "Solo scout construction — no alliance needed.")}
      </p>
      <ActionButton
        full
        size="sm"
        icon="send"
        label={
          <span className="flex items-center gap-2">
            <ShipArt raceId={raceId} shipClass={cls} size={44} />
            <span>{t("shipyard.buildShip", "Build {ship}", { ship: shipName(raceId, cls) })}</span>
          </span>
        }
        sub={`${costLine(t, cls)} · ~${fmtLeft(shipBuildDurationMs(cls, 0, 1))} · ${combatLine(t, cls)}`}
        onClick={order}
        testid="shipyard-build-scout"
      />
      <ArmamentStrip cls={cls} t={t} />
      {hint && <p className="mt-1 px-1 text-[11px] text-amber-300">{hint}</p>}
      {queue.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {queue.map((b) => {
            const total = Math.max(1, b.doneAt - b.startedAt);
            const pct = Math.max(0, Math.min(100, Math.round(((now - b.startedAt) / total) * 100)));
            return (
              <li key={b.id} className="rounded-lg border border-line bg-surf-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ShipArt raceId={b.raceId} shipClass={b.shipClass} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-1">{shipName(b.raceId, b.shipClass)}</span>
                  <span className="shrink-0 text-[11px] text-text-2">
                    <Bdi dir="ltr" className="num">{pct}%</Bdi> · {fmtLeft(b.doneAt - now)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surf-3">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ships.length > 0 && (
        <p className="mt-2 text-[11px] text-text-2">
          {t("shipyard.personalFleet", "{count} scout(s) ready", { count: ships.length })}
        </p>
      )}
      {/* The field manual lives here too (owner 2026-10-04) — scouts are
          where every commander starts, so the guide belongs in this view. */}
      <details className="mt-3 rounded-lg border border-line bg-surf-1 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-text-1">
          {t("shipyard.shipGuideToggle", "Ship Guide — what each hull does")}
        </summary>
        <div className="mt-2">
          <ShipGuide raceId={raceId} />
        </div>
      </details>
    </div>
  );
}
