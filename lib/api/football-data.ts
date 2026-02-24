/**
 * football-data.org API client (v4).
 * Fetches upcoming matches, match detail, team matches, standings, head2head.
 * Free tier: max 10 calls/min → cache 1 hour.
 * @see https://docs.football-data.org/general/v4/
 */

import type {
  FootballDataMatch,
  FootballDataMatchesResponse,
  FootballDataMatchDetail,
  TeamMatchesResponse,
  StandingsResponse,
  Head2HeadResponse,
} from "@/lib/types";
import { FOOTBALL_DATA_LEAGUES } from "@/lib/constants/leagues";
import {
  getCached,
  setCached,
  CacheKeys,
  FOOTBALL_DATA_TTL_MS,
} from "@/lib/cache/server-cache";

const BASE_URL = "https://api.football-data.org/v4";

function getToken(): string {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    throw new Error(
      "FOOTBALL_DATA_API_TOKEN is required. Add it to .env.local (see .env.local.example)."
    );
  }
  return token;
}

async function fetchApi<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch upcoming matches for a single competition.
 * Uses status=SCHEDULED and optional date range to limit to upcoming games.
 */
export async function getMatchesForCompetition(
  competitionCode: string,
  options?: { dateFrom?: string; dateTo?: string }
): Promise<FootballDataMatch[]> {
  const params = new URLSearchParams();
  params.set("status", "SCHEDULED");
  if (options?.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options?.dateTo) params.set("dateTo", options.dateTo);

  const query = params.toString();
  const path = `/competitions/${competitionCode}/matches${query ? `?${query}` : ""}`;
  const data = await fetchApi<FootballDataMatchesResponse>(path);
  return data.matches ?? [];
}

/**
 * Get date range for "upcoming" (e.g. next 14 days).
 */
function getUpcomingDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateFrom = now.toISOString().slice(0, 10);
  const to = new Date(now);
  to.setDate(to.getDate() + 14);
  const dateTo = to.toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

/**
 * Fetch upcoming matches for all configured leagues.
 * Cached for 1 hour to respect free tier (10 req/min).
 */
export async function getUpcomingMatches(): Promise<FootballDataMatch[]> {
  const cached = getCached<FootballDataMatch[]>(CacheKeys.upcomingMatches);
  if (cached) return cached;

  const { dateFrom, dateTo } = getUpcomingDateRange();
  const allMatches: FootballDataMatch[] = [];

  for (const league of FOOTBALL_DATA_LEAGUES) {
    try {
      const matches = await getMatchesForCompetition(league.code, {
        dateFrom,
        dateTo,
      });
      allMatches.push(...matches);
    } catch (e) {
      console.error(
        `[football-data] Failed to fetch ${league.name} (${league.code}):`,
        e
      );
    }
  }

  allMatches.sort(
    (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
  );
  setCached(CacheKeys.upcomingMatches, allMatches, FOOTBALL_DATA_TTL_MS);
  return allMatches;
}

/** Fetch a single match by id (cached 1h). */
export async function getMatch(matchId: number): Promise<FootballDataMatchDetail | null> {
  const cached = getCached<FootballDataMatchDetail>(CacheKeys.match(matchId));
  if (cached) return cached;
  try {
    const data = await fetchApi<FootballDataMatchDetail>(`/matches/${matchId}`);
    setCached(CacheKeys.match(matchId), data, FOOTBALL_DATA_TTL_MS);
    return data;
  } catch {
    return null;
  }
}

/** Last N finished matches for a team (cached 1h). */
export async function getTeamLastMatches(teamId: number, limit = 5): Promise<FootballDataMatch[]> {
  const cacheKey = CacheKeys.teamMatches(teamId);
  const cached = getCached<FootballDataMatch[]>(cacheKey);
  if (cached) return cached;
  try {
    const now = new Date();
    const dateTo = now.toISOString().slice(0, 10);
    const dateFrom = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 90);
    const params = new URLSearchParams({
      status: "FINISHED",
      limit: String(Math.min(limit, 20)),
      dateFrom: dateFrom.toISOString().slice(0, 10),
      dateTo,
    });
    const data = await fetchApi<TeamMatchesResponse>(`/teams/${teamId}/matches?${params}`);
    const matches = (data.matches ?? [])
      .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
      .slice(0, limit);
    setCached(cacheKey, matches, FOOTBALL_DATA_TTL_MS);
    return matches;
  } catch {
    return [];
  }
}

/** Standings for a competition (cached 1h). */
export async function getStandings(competitionId: number): Promise<StandingsResponse | null> {
  const cacheKey = CacheKeys.standings(competitionId);
  const cached = getCached<StandingsResponse>(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchApi<StandingsResponse>(`/competitions/${competitionId}/standings`);
    setCached(cacheKey, data, FOOTBALL_DATA_TTL_MS);
    return data;
  } catch {
    return null;
  }
}

/** Head-to-head between the two teams of this match (cached 1h). */
export async function getHead2Head(matchId: number, limit = 5): Promise<Head2HeadResponse | null> {
  const cacheKey = CacheKeys.head2head(matchId);
  const cached = getCached<Head2HeadResponse>(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchApi<Head2HeadResponse>(`/matches/${matchId}/head2head?limit=${limit}`);
    setCached(cacheKey, data, FOOTBALL_DATA_TTL_MS);
    return data;
  } catch {
    return null;
  }
}

export { FOOTBALL_DATA_LEAGUES };
