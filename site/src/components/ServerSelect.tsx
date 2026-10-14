import { useEffect, useState } from "react";
import { KNOWN_SERVERS, type KnownServer } from "../game/servers";
import { getRace } from "../game/races";
import RaceStats from "./RaceStats";
import { useT } from "./i18n/I18n";

type ServerHealth = "checking" | "up" | "down";

interface HealthData {
  playerCount?: number;
  reverb?: number;
}

interface ServerCardState {
  server: KnownServer;
  health: ServerHealth;
  data: HealthData;
}

/** Race → hero portrait for the detail view. */
const HERO_PORTRAIT: Record<string, string> = {
  draconians: "/art/heroes/hero-kaaroth.webp",
  watchers: "/art/heroes/hero-gadreel.webp",
  grays: "/art/heroes/hero-ilyra-voss.webp",
  ashtar: "/art/heroes/hero-mira-solenne.webp",
  anunnaki: "/art/heroes/hero-ensharra.webp",
  nephilim: "/art/heroes/hero-garruk-stonebrow.webp",
};

const HEALTH_TIMEOUT_MS = 5000;

async function checkHealth(server: KnownServer): Promise<{ health: ServerHealth; data: HealthData }> {
  if (server.status === "soon" || !server.url) return { health: "down", data: {} };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${server.url}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { health: "down", data: {} };
    const data = await res.json();
    if (data.status !== "up") return { health: "down", data: {} };
    return {
      health: "up",
      data: {
        playerCount: typeof data.playerCount === "number" ? data.playerCount : undefined,
        reverb: typeof data.reverb === "number" ? data.reverb : undefined,
      },
    };
  } catch {
    return { health: "down", data: {} };
  } finally {
    clearTimeout(timeout);
  }
}

const lightColor = (health: ServerHealth) =>
  health === "up" ? "#4ade80" : health === "down" ? "#f87171" : "#9ca3af";

/**
 * Server select — now also the race select. Each server is locked to one
 * race (RACE_LOCK), so picking a server = picking your race.
 *
 * Tap a card → expands to a detail view with the race's hero portrait,
 * lore, attributes, server status, inhabitants, and reverb. Then
 * "Claim colony here" to enter.
 *
 * Hans's rule: every button stays tappable. Tapping a down/soon server
 * shows an inline hint naming the problem instead of doing nothing.
 */
export default function ServerSelect({ onSelect }: { onSelect: (server: KnownServer) => void }) {
  const t = useT();
  const [cards, setCards] = useState<ServerCardState[]>(() =>
    KNOWN_SERVERS.map((server) => ({ server, health: "checking" as ServerHealth, data: {} })),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        KNOWN_SERVERS.map(async (server) => {
          const { health, data } = await checkHealth(server);
          return { server, health, data };
        }),
      );
      if (!cancelled) setCards(results);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCardTap = (card: ServerCardState) => {
    if (card.server.status === "soon") {
      setHint(t("servers.comingSoonHint", "{name} isn't deployed yet — check back soon.", { name: card.server.name }));
      setExpandedId(null);
      return;
    }
    if (card.health === "checking") {
      setHint(t("servers.checkingHint", "Still checking {name} — one moment.", { name: card.server.name }));
      return;
    }
    setHint(null);
    setExpandedId(expandedId === card.server.id ? null : card.server.id);
  };

  const handleClaim = (card: ServerCardState) => {
    if (card.health !== "up") {
      setHint(t("servers.downHint", "{name} is offline right now — try another server.", { name: card.server.name }));
      return;
    }
    setHint(null);
    onSelect(card.server);
  };

  const expanded = cards.find((c) => c.server.id === expandedId) ?? null;

  return (
    <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px" }}>{t("servers.title", "Choose Your World")}</h2>
      <p style={{ margin: "0 0 16px", opacity: 0.75, fontSize: 14 }}>
        {t("servers.subtitle", "Each race fights from its own world. Pick where your colony begins.")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((card) => {
          const isExpanded = card.server.id === expandedId;
          return (
            <div key={card.server.id}>
              <button
                onClick={() => handleCardTap(card)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: isExpanded ? "1px solid rgba(255,255,255,0.3)" : "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  opacity: card.server.status === "soon" ? 0.55 : 1,
                  width: "100%",
                }}
              >
                <span
                  aria-label={card.health}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: lightColor(card.health),
                    flexShrink: 0,
                    boxShadow: `0 0 8px ${lightColor(card.health)}`,
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{card.server.name}</span>
                  <span style={{ display: "block", fontSize: 13, opacity: 0.7 }}>
                    {card.server.raceName} — {card.server.description}
                  </span>
                  {card.health === "up" && (card.data.playerCount !== undefined || card.data.reverb !== undefined) && (
                    <span style={{ display: "block", fontSize: 12, opacity: 0.65, marginTop: 2 }}>
                      {card.data.playerCount !== undefined && (
                        <>{t("servers.inhabitants", "{count} inhabitants", { count: card.data.playerCount.toLocaleString() })}</>
                      )}
                      {card.data.playerCount !== undefined && card.data.reverb !== undefined && " · "}
                      {card.data.reverb !== undefined && (
                        <>{t("servers.reverb", "Reverb {score}", { score: card.data.reverb.toLocaleString() })}</>
                      )}
                    </span>
                  )}
                  {card.server.status === "soon" && (
                    <span style={{ display: "block", fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                      {t("servers.comingSoon", "Coming soon")}
                    </span>
                  )}
                </span>
              </button>

              {isExpanded && expanded && <ServerDetail card={expanded} onClaim={() => handleClaim(expanded)} />}
            </div>
          );
        })}
      </div>

      {hint && (
        <p style={{ marginTop: 12, fontSize: 14, color: "#fbbf24" }} role="status">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Expanded detail: hero portrait, race lore, attributes, claim button. */
function ServerDetail({ card, onClaim }: { card: ServerCardState; onClaim: () => void }) {
  const t = useT();
  const race = getRace(card.server.raceId);
  const portrait = HERO_PORTRAIT[card.server.raceId];

  return (
    <div
      style={{
        marginTop: 8,
        padding: 16,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      {portrait && (
        <img
          src={portrait}
          alt={race.name}
          style={{ width: "100%", maxWidth: 280, borderRadius: 8, display: "block", margin: "0 auto 12px" }}
        />
      )}
      <h3 style={{ margin: "0 0 2px", fontSize: 18 }}>{race.name}</h3>
      <p style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.7, fontStyle: "italic" }}>{race.title}</p>
      <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>{race.lore}</p>

      {race.attributes && race.attributes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {race.attributes.map((attr, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 4, opacity: 0.85 }}>
              <span style={{
                color: attr.kind === "strength" ? "#4ade80" : attr.kind === "weakness" ? "#f87171" : "#fbbf24",
                marginRight: 6,
              }}>
                {attr.kind === "strength" ? "▲" : attr.kind === "weakness" ? "▼" : "◆"}
              </span>
              {attr.label}
            </div>
          ))}
        </div>
      )}

      <RaceStats race={race} />

      <div style={{ display: "flex", gap: 16, fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: lightColor(card.health),
              marginRight: 6,
            }}
          />
          {card.health === "up"
            ? t("servers.statusUp", "Online")
            : card.health === "down"
              ? t("servers.statusDown", "Offline")
              : t("servers.statusChecking", "Checking…")}
        </span>
        {card.data.playerCount !== undefined && (
          <span>{t("servers.inhabitants", "{count} inhabitants", { count: card.data.playerCount.toLocaleString() })}</span>
        )}
        {card.data.reverb !== undefined && (
          <span>{t("servers.reverb", "Reverb {score}", { score: card.data.reverb.toLocaleString() })}</span>
        )}
      </div>

      <button
        onClick={onClaim}
        style={{
          width: "100%",
          padding: "12px",
          borderRadius: 8,
          border: "none",
          background: card.health === "up" ? "#7c3aed" : "rgba(255,255,255,0.1)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("servers.claimHere", "Claim Colony Here")}
      </button>
    </div>
  );
}
