/**
 * GET /api/matches
 * Returns upcoming matches with merged odds. Uses server cache (1h matches, 6h odds).
 * Odds: fetched per league using specific sport keys; BTTS fetched per event (cached 6h).
 */

import { NextResponse } from "next/server";
import { getUpcomingMatches } from "@/lib/api/football-data";
import { getSportOdds, getEventOdds } from "@/lib/api/odds-api";
import { getOddsSportKeys } from "@/lib/api";
import {
  findMatchingOddsEvent,
  extractBestOddsAcrossBookmakers,
  logTeamNameSample,
} from "@/lib/api/merge-matches-odds";
import {
  getCached,
  setCached,
  CacheKeys,
  ODDS_TTL_MS,
} from "@/lib/cache/server-cache";
import type { MatchOdds, ResponseOdds } from "@/lib/types";
import type { UpcomingMatch } from "@/lib/types";
import type { FootballDataMatch } from "@/lib/types";
import type { OddsApiEvent } from "@/lib/types";

/** Convert internal MatchOdds to the normalized API response shape (always include odds key).
 * For spreads, outcome names come from the Odds API (event.home_team / event.away_team); pass apiHomeTeam/apiAwayTeam when available so lookup succeeds. */
function toResponseOdds(
  odds: MatchOdds | undefined,
  homeName?: string,
  awayName?: string,
  apiHomeTeam?: string,
  apiAwayTeam?: string
): ResponseOdds {
  const out: ResponseOdds = {};
  if (!odds || Object.keys(odds).length === 0) return out;

  if (odds.btts?.bestOdds) {
    const yes = odds.btts.bestOdds["Yes"] ?? odds.btts.bestOdds["yes"];
    const no = odds.btts.bestOdds["No"] ?? odds.btts.bestOdds["no"];
    if (yes != null && no != null) out.btts = { yes, no };
  }

  if (odds.totals && Object.keys(odds.totals).length > 0) {
    out.overUnder = [];
    for (const [, s] of Object.entries(odds.totals)) {
      const over = s.bestOdds["Over"] ?? s.bestOdds["Over 2.5"];
      const under = s.bestOdds["Under"] ?? s.bestOdds["Under 2.5"];
      const point = s.point ?? 2.5;
      if (over != null && under != null) out.overUnder!.push({ line: point, over, under });
    }
    out.overUnder!.sort((a, b) => a.line - b.line);
  }

  if (odds.spreads && Object.keys(odds.spreads).length > 0 && (homeName != null || apiHomeTeam != null) && (awayName != null || apiAwayTeam != null)) {
    const lines: Array<{ home: { line: number; odds: number }; away: { line: number; odds: number } }> = [];
    for (const [, s] of Object.entries(odds.spreads)) {
      const point = s.point ?? 0;
      // Odds API outcome names are the event's home_team/away_team; try those first, then football-data names
      const homeOdds = s.bestOdds[apiHomeTeam ?? ""] ?? s.bestOdds[homeName ?? ""] ?? s.bestOdds["Home"];
      const awayOdds = s.bestOdds[apiAwayTeam ?? ""] ?? s.bestOdds[awayName ?? ""] ?? s.bestOdds["Away"];
      if (homeOdds == null || awayOdds == null) continue;
      lines.push({
        home: { line: point, odds: homeOdds },
        away: { line: -point, odds: awayOdds },
      });
    }
    lines.sort((a, b) => a.home.line - b.home.line);
    if (lines.length) out.asianHandicap = lines;
  }
  return out;
}

function toUpcomingMatch(
  match: FootballDataMatch,
  odds?: ReturnType<typeof extractBestOddsAcrossBookmakers>,
  oddsEvent?: OddsApiEvent
): UpcomingMatch {
  const responseOdds = toResponseOdds(
    odds,
    match.homeTeam.name,
    match.awayTeam.name,
    oddsEvent?.home_team,
    oddsEvent?.away_team
  );
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
    odds: responseOdds,
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
        if (leagueMatches.length === 0) continue;

        const cacheKey = CacheKeys.oddsEvent(sportKey);
        let events = getCached<OddsApiEvent[]>(cacheKey);
        if (events) {
          console.log("[api/matches] Using cached odds for", leagueName, "(", events.length, "events)");
        } else {
          try {
            console.log("[api/matches] Fetching odds for", leagueName, "sportKey:", sportKey);
            const { events: fetched, usage } = await getSportOdds(sportKey, {
              regions: "eu", // eu has spreads for soccer; market key is "spreads"
              markets: ["totals", "spreads", "h2h"],
              oddsFormat: "decimal",
            });
            events = fetched ?? [];
            setCached(cacheKey, events, ODDS_TTL_MS);
            if (usage.requestsRemaining != null) oddsApiRemaining = usage.requestsRemaining;
            if (usage.requestsUsed != null) oddsApiUsed = usage.requestsUsed;
            console.log("[api/matches] Odds for", leagueName, ":", events.length, "events | usage:", usage);
          } catch (e) {
            console.error("[api/matches] Odds fetch failed for", leagueName, e);
            continue;
          }
        }
        if (events?.length) leagueToOddsEvents.set(leagueName, events);
      }
    }

    // Log what we have for merging
    const leagueNames = Array.from(leagueToOddsEvents.keys());
    console.log("[api/matches] Leagues with odds events:", leagueNames.join(", ") || "(none)");
    leagueToOddsEvents.forEach((evs, name) => {
      console.log("[api/matches]   ", name, "->", evs.length, "events");
    });

    // Log first 3 team names from each API to compare formats
    const firstLeagueKey = leagueNames[0];
    const firstLeagueEvents = firstLeagueKey ? leagueToOddsEvents.get(firstLeagueKey) ?? [] : [];
    logTeamNameSample(matches, firstLeagueEvents, 3);

    console.log("[api/matches] Returning usage: remaining =", oddsApiRemaining, ", used =", oddsApiUsed);

    // Build matches with main odds (totals, spreads); then enrich with BTTS from event-level API (cached 6h).
    const bttsUsage: { remaining: number | null; used: number | null }[] = [];
    const result = await Promise.all(
      matches.map(async (match, index): Promise<UpcomingMatch> => {
        const leagueName = match.competition.name;
        const events = leagueToOddsEvents.get(leagueName);
        const oddsEvent = events
          ? findMatchingOddsEvent(match, events)
          : undefined;
        let odds: MatchOdds | undefined = oddsEvent
          ? extractBestOddsAcrossBookmakers(oddsEvent)
          : undefined;

        // Debug first match only (spreads: log outcome names so we can verify team name lookup)
        if (index === 0) {
          console.log("[api/matches] First match:", match.homeTeam.name, "vs", match.awayTeam.name, "| league =", leagueName);
          console.log("[api/matches]   events for league =", events?.length ?? 0, "| oddsEvent found =", !!oddsEvent);
          if (oddsEvent) {
            console.log("[api/matches]   oddsEvent id =", oddsEvent.id, "| home_team =", oddsEvent.home_team, "| away_team =", oddsEvent.away_team);
          }
          console.log("[api/matches]   extracted odds keys =", odds ? Object.keys(odds) : []);
          if (odds?.totals) console.log("[api/matches]   totals keys =", Object.keys(odds.totals));
          if (odds?.spreads) {
            console.log("[api/matches]   spreads keys =", Object.keys(odds.spreads));
            for (const [lineKey, s] of Object.entries(odds.spreads)) {
              console.log("[api/matches]   spreads[" + lineKey + "] outcome names =", Object.keys(s.bestOdds));
            }
          }
          if (odds?.btts) console.log("[api/matches]   btts =", odds.btts.bestOdds);
        }

        // BTTS is a separate market: fetch per event (cached 6h).
        const sportKey = hasOddsApiKey ? sportKeys[match.competition.name] : undefined;
        if (oddsEvent && sportKey) {
          const bttsCacheKey = CacheKeys.btts(sportKey, oddsEvent.id);
          let bttsEvent = getCached<OddsApiEvent>(bttsCacheKey);
          if (!bttsEvent) {
            try {
              const { event, usage } = await getEventOdds(sportKey, oddsEvent.id, {
                markets: ["btts"],
                regions: "uk",
                oddsFormat: "decimal",
              });
              if (event) {
                bttsEvent = event;
                setCached(bttsCacheKey, event, ODDS_TTL_MS);
              }
              bttsUsage.push({
                remaining: usage.requestsRemaining,
                used: usage.requestsUsed,
              });
            } catch (e) {
              console.warn("[api/matches] BTTS fetch failed for", oddsEvent.id, e);
            }
          }
          if (bttsEvent) {
            const merged = extractBestOddsAcrossBookmakers(bttsEvent);
            if (merged.btts) odds = { ...odds, btts: merged.btts };
          }
        }

        return toUpcomingMatch(match, odds, oddsEvent);
      })
    );

    if (bttsUsage.length > 0) {
      const minRemaining = Math.min(
        ...bttsUsage.map((u) => u.remaining ?? Infinity).filter((n) => n !== Infinity)
      );
      const maxUsed = Math.max(
        ...bttsUsage.map((u) => u.used ?? -1).filter((n) => n >= 0)
      );
      if (minRemaining !== Infinity && minRemaining < (oddsApiRemaining ?? Infinity)) {
        oddsApiRemaining = minRemaining;
      }
      if (maxUsed >= 0 && (oddsApiUsed == null || maxUsed > oddsApiUsed)) {
        oddsApiUsed = maxUsed;
      }
    }

    const matchesWithOddsCount = result.filter((m) => m.odds && Object.keys(m.odds).length > 0).length;
    console.log("[api/matches] Result: matches with odds =", matchesWithOddsCount, "/", result.length);
    if (result.length > 0) {
      const first = result[0];
      console.log("[api/matches] First match in response has odds key =", "odds" in first, "| odds keys =", first.odds ? Object.keys(first.odds) : []);
    }

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
