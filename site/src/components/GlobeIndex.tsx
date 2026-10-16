// GLOBE INDEX — the everything pull-down (owner 2026-10-16): "a pull-down
// menu of everything on the globe — when you click it, it zooms to it."
// Every marker buildGlobeMarkers lays down, grouped (your colonies,
// other colonies, alliance holdings, world sites, Chorus sites, places,
// raids, memorials & husks, satellites), searchable by name — and the
// search box also reads COORDINATES: type "X 214 · Y 63" (or a bare
// "214, 63") and the top row flies the camera straight there. The
// owner's navigation law rides along: search on the page, exits ≥44px,
// every row a real button that visibly does its thing.
import { useMemo, useState } from "react";
import {
  globeIndexGroups,
  type GlobeIndexGroupId,
  type GlobeMarker,
} from "../game/globe-layers";
import { globeIconURL } from "./WorldGlobe";
import { formatCoords, formatCoordPair, latLonOfCoords, parseCoordsInput } from "../game/globe-coords";
import { sound } from "../game/sound";
import { useT } from "./i18n/I18n";

const GROUP_LABEL: Record<GlobeIndexGroupId, { key: string; fallback: string }> = {
  yours: { key: "worldglobe.index.yours", fallback: "Your colonies" },
  colonies: { key: "worldglobe.index.colonies", fallback: "Other colonies" },
  alliance: { key: "worldglobe.index.alliance", fallback: "Alliance holdings" },
  sites: { key: "worldglobe.index.sites", fallback: "World sites" },
  chorus: { key: "worldglobe.index.chorus", fallback: "Chorus sites" },
  places: { key: "worldglobe.index.places", fallback: "Places" },
  raids: { key: "worldglobe.index.raids", fallback: "Raids in progress" },
  memorials: { key: "worldglobe.index.memorials", fallback: "Memorials & husks" },
  satellites: { key: "worldglobe.index.satellites", fallback: "Satellites" },
};

export default function GlobeIndex({
  markers,
  onPick,
  onPickCoords,
  onClose,
}: {
  markers: GlobeMarker[];
  /** Fly to a marker and open its sheet. */
  onPick: (marker: GlobeMarker) => void;
  /** Fly to raw coordinates (from the search box's coordinate read). */
  onPickCoords: (lat: number, lon: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const coordHit = useMemo(() => parseCoordsInput(query), [query]);
  const groups = useMemo(() => {
    const all = globeIndexGroups(markers);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((g) => ({
        ...g,
        markers: g.markers.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.sublabel.toLowerCase().includes(q) ||
            formatCoords(m.lat, m.lon).toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.markers.length > 0);
  }, [markers, query]);
  const total = groups.reduce((n, g) => n + g.markers.length, 0);

  return (
    <div
      role="dialog"
      aria-label={t("worldglobe.index.title", "Everything on the globe")}
      className="absolute right-2 top-[5.75rem] z-30 flex max-h-[72%] w-80 max-w-[86vw] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a0d18]/95 shadow-2xl backdrop-blur-md"
      data-testid="globe-index"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <p className="flex-1 text-[12px] font-bold uppercase tracking-wider text-gray-200">
          {t("worldglobe.index.title", "Everything on the globe")}
        </p>
        <button
          type="button"
          onClick={() => { sound.click(); onClose(); }}
          aria-label={t("worldglobe.close", "Close")}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-base text-white"
        >
          ✕
        </button>
      </div>
      <div className="border-b border-white/10 px-3 py-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("worldglobe.index.searchHint", "Search places — or type X 214 · Y 63")}
          aria-label={t("worldglobe.index.searchHint", "Search places — or type X 214 · Y 63")}
          className="min-h-[44px] w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-sky-400"
        />
        {coordHit && (
          <button
            type="button"
            onClick={() => { sound.click(); const ll = latLonOfCoords(coordHit); onPickCoords(ll.lat, ll.lon); }}
            className="mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-left text-sm font-semibold text-sky-200 hover:bg-sky-400/20"
            data-testid="globe-index-coords-row"
          >
            <span aria-hidden>📍</span>
            <span className="flex-1">
              {t("worldglobe.index.flyToCoords", "Fly to {coords}", { coords: formatCoordPair(coordHit) })}
            </span>
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {total === 0 && (
          <p className="px-2 py-3 text-[13px] text-gray-400">
            {t("worldglobe.index.empty", "Nothing on the globe matches that.")}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.id} className="mb-2">
            <p className="flex items-baseline justify-between px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              <span>{t(GROUP_LABEL[g.id].key, GROUP_LABEL[g.id].fallback)}</span>
              <span>{g.markers.length}</span>
            </p>
            {g.markers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { sound.click(); onPick(m); }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10"
                data-testid={`globe-index-row-${m.id}`}
              >
                <img
                  src={globeIconURL(m.icon, m.color)}
                  alt=""
                  aria-hidden
                  className="h-5 w-5 shrink-0"
                  style={{ filter: `drop-shadow(0 0 4px ${m.color})` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-gray-100">{m.label}</span>
                  <span className="block truncate text-[11px] text-gray-500">{m.sublabel}</span>
                </span>
                <span dir="ltr" className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                  {formatCoords(m.lat, m.lon)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
