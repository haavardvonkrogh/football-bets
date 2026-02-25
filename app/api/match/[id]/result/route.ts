/**
 * GET /api/match/[id]/result
 * Returns minimal match result from football-data.org for settling bets.
 * Response: { home, away, status, homeTeamName?, awayTeamName? } when status is FINISHED.
 */

import { NextResponse } from "next/server";
import { getMatch } from "@/lib/api/football-data";

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
    const match = await getMatch(matchId);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const status = match.status ?? "";
    const home = match.score?.fullTime?.home ?? null;
    const away = match.score?.fullTime?.away ?? null;
    const homeTeamName = match.homeTeam?.name ?? null;
    const awayTeamName = match.awayTeam?.name ?? null;

    return NextResponse.json({
      home,
      away,
      status,
      homeTeamName,
      awayTeamName,
    });
  } catch (e) {
    console.error("[api/match/result]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch result" },
      { status: 500 }
    );
  }
}
