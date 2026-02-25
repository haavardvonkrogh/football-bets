/**
 * The Odds API client (v4).
 * Fetches odds for soccer: totals (Over/Under), spreads (Asian Handicap), and BTTS via event endpoint.
 * @see https://the-odds-api.com/liveapi/guides/v4/
 */

import type { OddsApiEvent } from "@/lib/types";
import { ODDS_API_SPORT_KEYS, ODDS_MARKETS } from "@/lib/constants/leagues";

const BASE_URL = "https://api.the-odds-api.com/v4";

function getApiKey(): string {
  const key = process.env.ODDS_API_KEY;
  console.log("[odds-api] ODDS_API_KEY present:", !!key, "(length:", key?.length ?? 0, ")");
  if (!key || key.trim() === "") {
    throw new Error(
      "ODDS_API_KEY is required. Add it to .env.local (see .env.local.example)."
    );
  }
  return key.trim();
}

export type OddsRegions = "uk" | "eu" | "us" | "au";

interface OddsRequestParams {
  regions?: OddsRegions;
  markets?: string[];
  oddsFormat?: "decimal" | "american";
}

export interface OddsApiUsage {
  requestsRemaining: number | null;
  requestsUsed: number | null;
}

/**
 * Fetch odds for a sport. Use markets: totals, spreads, and optionally h2h.
 * BTTS is not in the main odds response; use getEventOdds for btts.
 * Returns usage from response headers when available (x-requests-remaining, x-requests-used).
 */
export async function getSportOdds(
  sportKey: string,
  params: OddsRequestParams = {}
): Promise<{ events: OddsApiEvent[]; usage: OddsApiUsage }> {
  const apiKey = getApiKey();
  const searchParams = new URLSearchParams({
    apiKey,
    regions: params.regions ?? "uk",
    oddsFormat: params.oddsFormat ?? "decimal",
    markets: (params.markets ?? [ODDS_MARKETS.TOTALS, ODDS_MARKETS.SPREADS]).join(","),
  });

  const url = `${BASE_URL}/sports/${sportKey}/odds?${searchParams.toString()}`;
  console.log("[odds-api] Fetching odds for sport:", sportKey, "| URL (no key):", `${BASE_URL}/sports/${sportKey}/odds?regions=...&markets=...`);
  const res = await fetch(url, { cache: "no-store" });

  // Log all response headers to debug usage tracking (header names may be lowercased)
  const headerNames = Array.from(res.headers.keys()).filter((h) => h.toLowerCase().includes("request"));
  console.log("[odds-api] Response status:", res.status, "| Usage-related headers:", headerNames);
  for (const name of headerNames) {
    console.log("[odds-api]   ", name, "=", res.headers.get(name));
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("[odds-api] Error response body:", text.slice(0, 200));
    throw new Error(`The Odds API error ${res.status}: ${text}`);
  }

  // Headers are often lowercased by fetch; fallback: find by name containing "remaining" / "used"
  let remaining = res.headers.get("x-requests-remaining") ?? res.headers.get("X-Requests-Remaining");
  let used = res.headers.get("x-requests-used") ?? res.headers.get("X-Requests-Used");
  if (remaining == null || used == null) {
    for (const [name, value] of res.headers.entries()) {
      const lower = name.toLowerCase();
      if (lower.includes("remaining")) remaining = value;
      if (lower.includes("used") && !lower.includes("last")) used = value;
    }
  }
  console.log("[odds-api] Parsed usage: remaining =", remaining, ", used =", used);

  const data = (await res.json()) as OddsApiEvent[];
  const events = Array.isArray(data) ? data : [];
  const parsedRemaining = remaining != null && remaining !== "" ? parseInt(remaining, 10) : null;
  const parsedUsed = used != null && used !== "" ? parseInt(used, 10) : null;
  if (isNaN(parsedRemaining ?? NaN)) console.warn("[odds-api] parseInt(remaining) NaN for:", remaining);
  if (isNaN(parsedUsed ?? NaN)) console.warn("[odds-api] parseInt(used) NaN for:", used);

  // Log raw response: first event and spreads market for debugging
  console.log("[odds-api] getSportOdds response: events count =", events.length);
  if (events.length > 0) {
    const first = events[0];
    console.log("[odds-api] First event id =", first.id, "home_team =", first.home_team, "away_team =", first.away_team);
    for (const bm of first.bookmakers ?? []) {
      const spreadsMarket = bm.markets?.find((m) => m.key === "spreads");
      if (spreadsMarket) {
        console.log("[odds-api] RAW spreads market (bookmaker =", bm.key, "):", JSON.stringify(spreadsMarket, null, 2));
        break; // log first bookmaker that has spreads
      }
    }
    const anySpreads = (first.bookmakers ?? []).some((b) => b.markets?.some((m) => m.key === "spreads"));
    if (!anySpreads) console.log("[odds-api] No spreads market in any bookmaker for first event. Market keys present:", first.bookmakers?.flatMap((b) => b.markets?.map((m) => m.key) ?? []) ?? []);
  }

  return {
    events,
    usage: {
      requestsRemaining: parsedRemaining != null && !isNaN(parsedRemaining) ? parsedRemaining : null,
      requestsUsed: parsedUsed != null && !isNaN(parsedUsed) ? parsedUsed : null,
    },
  };
}

/**
 * Fetch odds for a single event (used for BTTS and other additional markets).
 * Returns event and usage so the caller can cache and aggregate usage.
 */
export async function getEventOdds(
  sportKey: string,
  eventId: string,
  params: OddsRequestParams & { markets: string[] } = {
    markets: [ODDS_MARKETS.BTTS],
    regions: "uk",
    oddsFormat: "decimal",
  }
): Promise<{ event: OddsApiEvent | null; usage: OddsApiUsage }> {
  const apiKey = getApiKey();
  const searchParams = new URLSearchParams({
    apiKey,
    regions: params.regions ?? "uk",
    oddsFormat: params.oddsFormat ?? "decimal",
    markets: params.markets.join(","),
  });

  const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?${searchParams.toString()}`;
  const res = await fetch(url, { cache: "no-store" });

  let remaining: string | null = res.headers.get("x-requests-remaining") ?? res.headers.get("X-Requests-Remaining");
  let used = res.headers.get("x-requests-used") ?? res.headers.get("X-Requests-Used");
  if (remaining == null || used == null) {
    for (const [name, value] of res.headers.entries()) {
      const lower = name.toLowerCase();
      if (lower.includes("remaining")) remaining = value;
      if (lower.includes("used") && !lower.includes("last")) used = value;
    }
  }
  const usage: OddsApiUsage = {
    requestsRemaining: remaining != null && remaining !== "" ? parseInt(remaining, 10) : null,
    requestsUsed: used != null && used !== "" ? parseInt(used, 10) : null,
  };

  if (!res.ok) {
    if (res.status === 404) return { event: null, usage };
    const text = await res.text();
    throw new Error(`The Odds API event odds error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as OddsApiEvent;
  return { event: data ?? null, usage };
}

/**
 * Get sport keys we use for our configured leagues.
 */
export function getOddsSportKeys(): Record<string, string> {
  return { ...ODDS_API_SPORT_KEYS };
}

export { ODDS_API_SPORT_KEYS, ODDS_MARKETS };
