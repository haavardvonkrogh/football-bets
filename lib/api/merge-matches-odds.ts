/**
 * Merges football-data.org matches with the-odds-api odds.
 * Matching is by league (sport), home/away team names, and approximate kickoff time.
 */

import type { FootballDataMatch } from "@/lib/types";
import type { OddsApiEvent } from "@/lib/types";
import type { MatchOdds, MarketOddsSummary, OddsOutcome } from "@/lib/types";
import { ODDS_MARKETS } from "@/lib/constants/leagues";

/** Normalize team name for fuzzy matching (lowercase, trim, remove common suffixes). */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+(fc|cf|cfc|sc|ud|afc|cf)\b/gi, "")
    .replace(/\s+/g, " ");
}

/** Check if two team names refer to the same team. */
function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
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
    if (market.key === ODDS_MARKETS.TOTALS && market.outcomes?.length) {
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
      const key = point != null ? String(point) : "default";
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
      if (market.key === ODDS_MARKETS.TOTALS && market.outcomes?.length) {
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
        const key = point != null ? String(point) : "default";
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
