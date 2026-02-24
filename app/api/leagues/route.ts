/**
 * GET /api/leagues
 * Returns the list of leagues we support (for filters and display).
 */

import { NextResponse } from "next/server";
import { FOOTBALL_DATA_LEAGUES } from "@/lib/api/football-data";
import { ODDS_API_SPORT_KEYS } from "@/lib/constants/leagues";

export async function GET() {
  const leagues = FOOTBALL_DATA_LEAGUES.map((l) => ({
    code: l.code,
    name: l.name,
    oddsSportKey: ODDS_API_SPORT_KEYS[l.name] ?? null,
  }));
  return NextResponse.json({ leagues });
}
