import type { RaceId } from "./types";

/**
 * The known Unbound servers. The server-select UI pings each one's
 * /api/health and shows a green/red status light.
 *
 * `status: "live"` — deployed and expected to respond.
 * `status: "soon"` — planned but not yet deployed; shown greyed out.
 */
export interface KnownServer {
  id: string;
  name: string;
  url: string;
  raceId: RaceId;
  raceName: string;
  description: string;
  status: "live" | "soon";
}

export const KNOWN_SERVERS: KnownServer[] = [
  {
    id: "watchers-beta",
    name: "The Shattered Academies",
    url: "https://the-unbound-chi.vercel.app",
    raceId: "watchers",
    raceName: "Watchers",
    description: "The beta test bed — the Fallen Teachers' world.",
    status: "live",
  },
  {
    id: "draconians-world",
    name: "The Ashen Wastes",
    url: "https://the-unbound-draconians.vercel.app",
    raceId: "draconians",
    raceName: "Draconians",
    description: "Raid target practice — the Draconian test world.",
    status: "live",
  },
  {
    id: "grays-world",
    name: "The Gray Enclaves",
    url: "https://the-unbound-grays.vercel.app",
    raceId: "grays",
    raceName: "Grays",
    description: "The Grays' world.",
    status: "live",
  },
  {
    id: "nephilim-world",
    name: "The Highlands",
    url: "https://the-unbound-nephilim.vercel.app",
    raceId: "nephilim",
    raceName: "Nephilim",
    description: "The Nephilim's world.",
    status: "live",
  },
  {
    id: "anunnaki-world",
    name: "The Gilded Courts",
    url: "https://the-unbound-anunnaki.vercel.app",
    raceId: "anunnaki",
    raceName: "Annunaki",
    description: "The Annunaki's world.",
    status: "live",
  },
  {
    id: "ashtar-world",
    name: "The Accord",
    url: "https://the-unbound-ashtar.vercel.app",
    raceId: "ashtar",
    raceName: "Ashtar",
    description: "The Ashtar's world.",
    status: "live",
  },
];
