/**
 * GET /api/match/[id]
 * Returns match detail, team last 5, standings, head2head (football-data.org only).
 * Odds are not included; client should merge from stored matches or pass separately.
 */

import { NextResponse } from "next/server";
import { getMatch, getTeamLastMatches, getStandings, getHead2Head } from "@/lib/api/football-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const matchId = parseInt(id, 10);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
  }

  try {
    const [match, head2head] = await Promise.all([
      getMatch(matchId),
      getHead2Head(matchId, 5),
    ]);

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const [homeMatches, awayMatches, standings] = await Promise.all([
      getTeamLastMatches(match.homeTeam.id, 5),
      getTeamLastMatches(match.awayTeam.id, 5),
      getStandings(match.competition.id),
    ]);

    const table = standings?.standings?.[0]?.table ?? [];
    const homeStanding = table.find((r) => r.team.id === match.homeTeam.id);
    const awayStanding = table.find((r) => r.team.id === match.awayTeam.id);

    return NextResponse.json({
      match: {
        id: match.id,
        utcDate: match.utcDate,
        status: match.status,
        matchday: match.matchday,
        venue: (match as { venue?: string }).venue,
        competition: match.competition,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      },
      homeLast5: homeMatches,
      awayLast5: awayMatches,
      standings: { home: homeStanding ?? null, away: awayStanding ?? null, table },
      head2head: head2head
        ? {
            aggregates: head2head.aggregates,
            matches: head2head.matches ?? [],
          }
        : null,
    });
  } catch (e) {
    console.error("[api/match]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch match" },
      { status: 500 }
    );
  }
}
