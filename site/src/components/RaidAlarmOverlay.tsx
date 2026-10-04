// RAID ALARM OVERLAY — the satellite klaxon (owner 2026-10-03).
//
// NOT a toast, NOT an email. A full-screen red-alert klaxon: flashing border,
// pulsing warning, synthesized siren (WebAudio, no files), stage-gated intel:
//   stage 1: "UNIDENTIFIED SIGNATURE" + sector/node name. Nothing else.
//   stage 2: + identity (attacker names/world) + PARTIAL ship types.
//   stage 3: + every ship class + ship/troop counts.
// Dismissable via MAN YOUR DEFENSES (acknowledge) — persists until then.

import { useEffect, useMemo, useState } from "react";
import type { RaidAlarm } from "../game/raid-protocol";
import type { ShipClass } from "../game/worldmap";
import { sound } from "../game/sound";

const SHIP_CLASS_LABEL: Record<ShipClass, string> = {
  scout: "Scout",
  frigate: "Frigate",
  bulwark: "Bulwark",
  vanguard: "Vanguard",
  fatcat: "Fat Cat",
  herald: "Herald",
};

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "IMMINENT";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function RaidAlarmOverlay({
  alarm,
  onAcknowledge,
  onRespond,
}: {
  alarm: RaidAlarm;
  onAcknowledge: () => void;
  /** Rally the defense (owner 2026-10-04): the war band's real response —
   *  calls a defense rally against this raid, clears the klaxon, and takes
   *  the player to the war band to muster pledges. Resolves with an error
   *  message when the rally can't be called (shown inline); null on success. */
  onRespond: () => Promise<string | null>;
}) {
  const [now, setNow] = useState(Date.now());
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const doRespond = async () => {
    if (responding) return;
    setResponding(true);
    setRespondError(null);
    try {
      const err = await onRespond();
      if (err) setRespondError(err);
      // Success: the parent clears the alarm and navigates — this unmounts.
    } finally {
      setResponding(false);
    }
  };

  // Klaxon lifecycle: siren on while the overlay is up, off on unmount.
  useEffect(() => {
    sound.sirenStart();
    return () => sound.sirenStop();
  }, []);

  // Tick the touchdown countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ships = useMemo(
    () => (alarm.revealedShipClasses ?? []).map((c) => SHIP_CLASS_LABEL[c] ?? c),
    [alarm],
  );

  const intel = alarm.intel; // "presence" | "identity" | "full"

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(20, 0, 0, 0.82)",
        animation: "raid-alarm-pulse 1.1s ease-in-out infinite",
        padding: 16,
      }}
    >
      <style>{`
        @keyframes raid-alarm-pulse {
          0%, 100% { background-color: rgba(20, 0, 0, 0.82); }
          50% { background-color: rgba(90, 0, 0, 0.88); }
        }
        @keyframes raid-alarm-border {
          0%, 100% { box-shadow: 0 0 0 4px #ff2222, 0 0 42px 10px rgba(255, 34, 34, 0.75); }
          50% { box-shadow: 0 0 0 8px #ff6666, 0 0 70px 18px rgba(255, 34, 34, 0.95); }
        }
        @keyframes raid-alarm-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#140404",
          borderRadius: 14,
          padding: "26px 24px",
          textAlign: "center",
          color: "#ffe9e9",
          animation: "raid-alarm-border 1.1s ease-in-out infinite",
        }}
      >
        <div
          style={{
            fontSize: 44,
            animation: "raid-alarm-blink 1.1s ease-in-out infinite",
          }}
        >
          🚨
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            letterSpacing: 4,
            color: "#ff8888",
            fontWeight: 700,
          }}
        >
          SATELLITE KLAXON
        </div>
        <h2
          style={{
            margin: "10px 0 4px",
            fontSize: 30,
            letterSpacing: 2,
            color: "#ff3333",
            textShadow: "0 0 18px rgba(255, 40, 40, 0.9)",
            animation: "raid-alarm-blink 1.1s ease-in-out infinite",
          }}
        >
          UNIDENTIFIED SIGNATURE
        </h2>
        <div style={{ fontSize: 15, color: "#ffb3b3", marginBottom: 14 }}>
          Inbound to{" "}<strong style={{ color: "#fff" }}>{alarm.nodeName}</strong>
        </div>

        {(intel === "identity" || intel === "full") && (
          <div
            style={{
              background: "rgba(255, 60, 60, 0.12)",
              border: "1px solid rgba(255, 80, 80, 0.4)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 12,
              textAlign: "left",
              fontSize: 14,
            }}
          >
            <div style={{ color: "#ff9999", fontSize: 12, letterSpacing: 2, marginBottom: 6 }}>
              TRACKING — HOSTILE IDENTITY
            </div>
            <div>
              <strong>{(alarm.attackerNames ?? []).join(", ") || "Unknown raiders"}</strong>
            </div>
            <div style={{ color: "#ffb3b3" }}>{alarm.attackerWorldName}</div>
            {ships.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span style={{ color: "#ff9999", fontSize: 12, letterSpacing: 2 }}>
                  {intel === "full" ? "FULL FLEET COMPOSITION" : "PARTIAL CONTACTS"}
                </span>
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ships.map((s) => (
                    <span
                      key={s}
                      style={{
                        background: "#3a0d0d",
                        border: "1px solid #ff5555",
                        borderRadius: 20,
                        padding: "3px 12px",
                        fontSize: 13,
                      }}
                    >
                      {s}
                    </span>
                  ))}
                  {alarm.shipsPartial && (
                    <span style={{ color: "#ff8888", fontSize: 13, alignSelf: "center" }}>
                      + more unknown
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {intel === "full" && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 26,
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            <div>
              <div style={{ color: "#ff9999", fontSize: 11, letterSpacing: 2 }}>HULLS</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{alarm.shipCount ?? "?"}</div>
            </div>
            <div>
              <div style={{ color: "#ff9999", fontSize: 11, letterSpacing: 2 }}>TROOPS</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                {(alarm.troopCount ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            fontSize: 15,
            marginBottom: 18,
            color: alarm.landsAt - now <= 0 ? "#ff4444" : "#ffd9d9",
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          TOUCHDOWN: {fmtCountdown(alarm.landsAt - now)}
        </div>

        <button
          onClick={doRespond}
          disabled={responding}
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 2,
            color: "#fff",
            background: responding
              ? "linear-gradient(180deg, #6b1414, #3d0a0a)"
              : "linear-gradient(180deg, #c81e1e, #7f1010)",
            border: "2px solid #ff6666",
            borderRadius: 10,
            cursor: responding ? "wait" : "pointer",
            opacity: responding ? 0.7 : 1,
          }}
        >
          {responding ? "⏳ RALLYING…" : "⚔️ RALLY THE DEFENSE"}
        </button>
        {respondError && (
          <div
            role="status"
            style={{
              marginTop: 10,
              padding: "8px 12px",
              fontSize: 13,
              color: "#ffd9d9",
              background: "rgba(255, 60, 60, 0.14)",
              border: "1px solid rgba(255, 80, 80, 0.5)",
              borderRadius: 8,
            }}
          >
            {respondError}
          </div>
        )}
        <button
          onClick={onAcknowledge}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 0",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 1,
            color: "#cc8888",
            background: "transparent",
            border: "1px solid rgba(255, 100, 100, 0.35)",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          Dismiss alarm
        </button>
        <div style={{ marginTop: 10, fontSize: 12, color: "#cc8888" }}>
          Your war band has been alerted.
        </div>
      </div>
    </div>
  );
}
