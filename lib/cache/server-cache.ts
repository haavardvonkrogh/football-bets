/**
 * In-memory server cache with TTL for API responses.
 * football-data.org: 1 hour (10 calls/min limit)
 * the-odds-api: 6 hours (500 calls/month limit)
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
  oddsEvent: (sportKey: string) => `odds:${sportKey}`,
};

export { FOOTBALL_DATA_TTL_MS, ODDS_TTL_MS };
