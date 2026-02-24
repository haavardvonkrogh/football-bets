/**
 * Merges football-data.org matches with the-odds-api odds.
 * Matching is by league (sport), home/away team names, and approximate kickoff time.
 */

import type { FootballDataMatch } from "@/lib/types";
import type { OddsApiEvent } from "@/lib/types";
import type { MatchOdds, MarketOddsSummary, OddsOutcome } from "@/lib/types";
import { ODDS_MARKETS } from "@/lib/constants/leagues";

/** Allowed Asian Handicap lines: 0.5 increments only (no quarter lines). */
const ALLOWED_SPREAD_POINTS = [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2];

function isAllowedSpreadPoint(point: number): boolean {
  if (Math.abs(point) > 2) return false;
  return ALLOWED_SPREAD_POINTS.some((p) => Math.abs(p - point) < 1e-6);
}

/** Totals market key (Over/Under goals). */
const TOTALS_KEYS = [ODDS_MARKETS.TOTALS];

const MIN_FUZZY_PREFIX_LEN = 4;

/**
 * Normalize team name for matching: remove common prefixes/suffixes, lowercase,
 * collapse spaces, remove accents and non-alphanumeric.
 */
function normalizeTeamName(name: string): string {
  let s = name
    .trim()
    .toLowerCase();
  // Remove common club prefixes/suffixes (standalone or with trailing space)
  s = s
    .replace(/\bfc\b\.?/g, " ")
    .replace(/\bafc\b\.?/g, " ")
    .replace(/\bcf\b\.?/g, " ")
    .replace(/\bsc\b\.?/g, " ")
    .replace(/\bac\b\.?/g, " ")
    .replace(/\b1\.\s*/g, " ")
    .replace(/\bud\b\.?/gi, " ")
    .replace(/\bcfc\b\.?/gi, " ");
  // Remove special chars, keep letters numbers spaces; normalize accents (basic)
  s = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/**
 * True if two team names refer to the same team: exact match, one contains the other,
 * or normalized forms share at least MIN_FUZZY_PREFIX_LEN leading characters.
 */
function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= MIN_FUZZY_PREFIX_LEN && na.slice(0, MIN_FUZZY_PREFIX_LEN) === nb.slice(0, MIN_FUZZY_PREFIX_LEN)) return true;
  // Also check: one's first token equals the other's (e.g. "borussia dortmund" vs "dortmund")
  const tokensA = na.split(/\s+/).filter(Boolean);
  const tokensB = nb.split(/\s+/).filter(Boolean);
  const longer = tokensA.length >= tokensB.length ? tokensA : tokensB;
  const shorter = tokensA.length < tokensB.length ? tokensA : tokensB;
  const matchByToken = shorter.some((t) => t.length >= MIN_FUZZY_PREFIX_LEN && longer.some((u) => u.startsWith(t) || t.startsWith(u)));
  if (matchByToken) return true;
  return false;
}

/** Exported for debugging: log first N team name pairs from each source. */
export function logTeamNameSample(
  footballDataMatches: FootballDataMatch[],
  oddsEvents: OddsApiEvent[],
  maxPairs = 3
): void {
  console.log("[merge-matches-odds] --- Team name sample (football-data.org) ---");
  footballDataMatches.slice(0, maxPairs).forEach((m, i) => {
    const home = m.homeTeam.name;
    const away = m.awayTeam.name;
    console.log(`  ${i + 1}. "${home}" vs "${away}" -> normalized: "${normalizeTeamName(home)}" vs "${normalizeTeamName(away)}"`);
  });
  console.log("[merge-matches-odds] --- Team name sample (the-odds-api.com) ---");
  oddsEvents.slice(0, maxPairs).forEach((e, i) => {
    const home = e.home_team;
    const away = e.away_team;
    console.log(`  ${i + 1}. "${home}" vs "${away}" -> normalized: "${normalizeTeamName(home)}" vs "${normalizeTeamName(away)}"`);
  });
}

/** Same day (UTC date string). */
function isSameDay(iso1: string, iso2: string): boolean {
  return iso1.slice(0, 10) === iso2.slice(0, 10);
}

/**
 * Find an Odds API event that corresponds to a football-data match.
 */
export function findMatchingOddsEvent(
  match: FootballDataMatch,
  oddsEvents: OddsApiEvent[]
): OddsApiEvent | undefined {
  const matchDate = match.utcDate;
  const homeName = match.homeTeam.name;
  const awayName = match.awayTeam.name;

  return oddsEvents.find((event) => {
    if (!isSameDay(event.commence_time, matchDate)) return false;
    return (
      teamNamesMatch(event.home_team, homeName) &&
      teamNamesMatch(event.away_team, awayName)
    );
  });
}

/**
 * Build best odds from bookmakers' outcomes (decimal).
 */
function bestOddsFromOutcomes(outcomes: OddsOutcome[]): MarketOddsSummary {
  const bestOdds: Record<string, number> = {};
  for (const o of outcomes) {
    const name = o.name;
    const price = typeof o.price === "number" ? o.price : 0;
    if (!(name in bestOdds) || price > bestOdds[name]) {
      bestOdds[name] = price;
    }
  }
  return { bestOdds };
}

/**
 * Extract merged MatchOdds from an Odds API event.
 */
export function extractMatchOdds(event: OddsApiEvent): MatchOdds {
  const result: MatchOdds = {};
  const firstBookmaker = event.bookmakers?.[0];
  if (!firstBookmaker?.markets) return result;

  for (const market of firstBookmaker.markets) {
    if (market.key === ODDS_MARKETS.BTTS && market.outcomes?.length) {
      result.btts = bestOddsFromOutcomes(market.outcomes);
    }
    if (TOTALS_KEYS.includes(market.key) && market.outcomes?.length) {
      const point = market.outcomes[0]?.point;
      const key = point != null ? String(point) : "default";
      if (!result.totals) result.totals = {};
      result.totals[key] = {
        ...bestOddsFromOutcomes(market.outcomes),
        point,
      };
    }
    if (market.key === ODDS_MARKETS.SPREADS && market.outcomes?.length) {
      const point = market.outcomes[0]?.point;
      if (point == null || !isAllowedSpreadPoint(point)) continue;
      const key = String(point);
      if (!result.spreads) result.spreads = {};
      result.spreads[key] = {
        ...bestOddsFromOutcomes(market.outcomes),
        point,
      };
    }
    if (market.key === ODDS_MARKETS.H2H && market.outcomes?.length) {
      result.h2h = bestOddsFromOutcomes(market.outcomes);
    }
  }

  return result;
}

/**
 * Merge best odds across all bookmakers for an event.
 */
export function extractBestOddsAcrossBookmakers(event: OddsApiEvent): MatchOdds {
  const result: MatchOdds = {};
  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (market.key === ODDS_MARKETS.BTTS && market.outcomes?.length) {
        const next = bestOddsFromOutcomes(market.outcomes);
        if (!result.btts) result.btts = next;
        else
          for (const [name, odds] of Object.entries(next.bestOdds))
            if (odds > (result.btts.bestOdds[name] ?? 0))
              result.btts.bestOdds[name] = odds;
      }
      if (TOTALS_KEYS.includes(market.key) && market.outcomes?.length) {
        const point = market.outcomes[0]?.point;
        const key = point != null ? String(point) : "default";
        if (!result.totals) result.totals = {};
        const next = { ...bestOddsFromOutcomes(market.outcomes), point };
        if (!result.totals[key]) result.totals[key] = next;
        else
          for (const [name, odds] of Object.entries(next.bestOdds))
            if (odds > (result.totals[key].bestOdds[name] ?? 0))
              result.totals[key].bestOdds[name] = odds;
      }
      if (market.key === ODDS_MARKETS.SPREADS && market.outcomes?.length) {
        const point = market.outcomes[0]?.point;
        if (point == null || !isAllowedSpreadPoint(point)) continue;
        const key = String(point);
        if (!result.spreads) result.spreads = {};
        const next = { ...bestOddsFromOutcomes(market.outcomes), point };
        if (!result.spreads[key]) result.spreads[key] = next;
        else
          for (const [name, odds] of Object.entries(next.bestOdds))
            if (odds > (result.spreads[key].bestOdds[name] ?? 0))
              result.spreads[key].bestOdds[name] = odds;
      }
      if (market.key === ODDS_MARKETS.H2H && market.outcomes?.length) {
        const next = bestOddsFromOutcomes(market.outcomes);
        if (!result.h2h) result.h2h = next;
        else
          for (const [name, odds] of Object.entries(next.bestOdds))
            if (odds > (result.h2h!.bestOdds[name] ?? 0))
              result.h2h!.bestOdds[name] = odds;
      }
    }
  }
  return result;
}
