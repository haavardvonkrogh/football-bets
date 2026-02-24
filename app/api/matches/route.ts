/**
 * GET /api/matches
 * Returns upcoming matches with merged odds. Uses server cache (1h matches, 6h odds).
 * Only hits external APIs on cache miss. Client should call only on explicit Refresh.
 */

import { NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/api/football-data";
import { getSportOdds } from "@/lib/api/odds-api";
import { getOddsSportKeys } from "@/lib/api";
import {
  findMatchingOddsEvent,
  extractBestOddsAcrossBookmakers,
} from "@/lib/api/merge-matches-odds";
import {
  getCached,
  setCached,
  CacheKeys,
  ODDS_TTL_MS,
} from "@/lib/cache/server-cache";
import type { UpcomingMatch } from "@/lib/types";
import type { FootballDataMatch } from "@/lib/types";
import type { OddsApiEvent } from "@/lib/types";

function toUpcomingMatch(
  match: FootballDataMatch,
  odds?: ReturnType<typeof extractBestOddsAcrossBookmakers>
): UpcomingMatch {
  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,
    matchday: match.matchday,
    competition: {
      id: match.competition.id,
      name: match.competition.name,
      code: match.competition.code,
    },
    homeTeam: {
      id: match.homeTeam.id,
      name: match.homeTeam.name,
      shortName: match.homeTeam.shortName,
      crest: match.homeTeam.crest,
    },
    awayTeam: {
      id: match.awayTeam.id,
      name: match.awayTeam.name,
      shortName: match.awayTeam.shortName,
      crest: match.awayTeam.crest,
    },
    ...(odds && Object.keys(odds).length > 0 ? { odds } : {}),
  };
}

export async function GET() {
  try {
    const matches = await getUpcomingMatches();
    const hasOddsApiKey = Boolean(process.env.ODDS_API_KEY?.trim());
    const sportKeys = getOddsSportKeys();

    console.log("[api/matches] Matches count:", matches.length, "| ODDS_API_KEY set:", hasOddsApiKey);

    const leagueToOddsEvents = new Map<string, OddsApiEvent[]>();
    let oddsApiRemaining: number | null = null;
    let oddsApiUsed: number | null = null;

    if (!hasOddsApiKey) {
      console.log("[api/matches] Skipping odds fetch: no ODDS_API_KEY in env");
    } else {
      const byLeague = new Map<string, typeof matches>();
      for (const m of matches) {
        const name = m.competition.name;
        if (!byLeague.has(name)) byLeague.set(name, []);
        byLeague.get(name)!.push(m);
      }

      for (const [leagueName, leagueMatches] of byLeague) {
        const sportKey = sportKeys[leagueName];
        if (!sportKey) {
          console.log("[api/matches] No sport key for league:", leagueName);
          continue;
        }
        if (leagueMatches.length === 0) {
          console.log("[api/matches] Skipping", leagueName, "(no matches)");
          continue;
        }
        const cacheKey = CacheKeys.oddsEvent(sportKey);
        let events = getCached<OddsApiEvent[]>(cacheKey);
        if (events) {
          console.log("[api/matches] Using cached odds for", leagueName, "(", events.length, "events)");
        } else {
          try {
            console.log("[api/matches] Fetching odds for", leagueName, "sportKey:", sportKey);
            const { events: fetched, usage } = await getSportOdds(sportKey, {
              regions: "uk",
              markets: ["totals", "spreads"],
              oddsFormat: "decimal",
            });
            events = fetched;
            setCached(cacheKey, events, ODDS_TTL_MS);
            console.log("[api/matches] Odds for", leagueName, ":", events.length, "events | usage:", usage);
            if (usage.requestsRemaining != null) oddsApiRemaining = usage.requestsRemaining;
            if (usage.requestsUsed != null) oddsApiUsed = usage.requestsUsed;
          } catch (e) {
            console.error(`[api/matches] Odds fetch failed for ${leagueName}:`, e);
            continue;
          }
        }
        if (events?.length) leagueToOddsEvents.set(leagueName, events);
      }
    }

    console.log("[api/matches] Returning usage: remaining =", oddsApiRemaining, ", used =", oddsApiUsed);

    const result: UpcomingMatch[] = matches.map((match) => {
      const events = leagueToOddsEvents.get(match.competition.name);
      const oddsEvent = events
        ? findMatchingOddsEvent(match, events)
        : undefined;
      const odds = oddsEvent
        ? extractBestOddsAcrossBookmakers(oddsEvent)
        : undefined;
      return toUpcomingMatch(match, odds);
    });

    return NextResponse.json({
      matches: result,
      usage: {
        oddsApiRemaining,
        oddsApiUsed,
      },
    });
  } catch (error) {
    console.error("[api/matches]", error);
    const message = error instanceof Error ? error.message : "Failed to fetch matches";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
