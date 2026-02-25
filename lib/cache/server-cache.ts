/**
 * In-memory server cache with TTL for API responses.
 * football-data.org: 1 hour (10 calls/min limit)
 * the-odds-api: 6 hours (500 calls/month)
 */

const CACHE = new Map<
  string,
  { value: unknown; expiresAt: number }
>();

const FOOTBALL_DATA_TTL_MS = 60 * 60 * 1000; // 1 hour
const ODDS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function getCached<T>(key: string): T | null {
  const entry = CACHE.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) CACHE.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export const CacheKeys = {
  upcomingMatches: "upcoming-matches",
  /** Single cache for all soccer odds (one API call for sport_key "soccer"). */
  oddsAllSoccer: "odds:all-soccer",
  oddsEvent: (sportKey: string) => `odds:${sportKey}`,
  /** League bulk odds (h2h, totals, spreads). Use this to avoid reusing stale/empty cache from different request shape. */
  oddsLeagueBulk: (sportKey: string) => `odds:${sportKey}:bulk`,
  btts: (sportKey: string, eventId: string) => `btts:${sportKey}:${eventId}`,
  match: (id: number) => `match:${id}`,
  teamMatches: (teamId: number) => `team-matches:${teamId}`,
  standings: (competitionId: number) => `standings:${competitionId}`,
  head2head: (matchId: number) => `head2head:${matchId}`,
};

export { FOOTBALL_DATA_TTL_MS, ODDS_TTL_MS };
