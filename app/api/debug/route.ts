/**
 * GET /api/debug - Development only: check if API keys are loaded (no values exposed).
 */
import { NextResponse } from "next/server";

export async function GET() {
  const footballDataSet = Boolean(process.env.FOOTBALL_DATA_API_TOKEN?.trim());
  const oddsApiSet = Boolean(process.env.ODDS_API_KEY?.trim());
  return NextResponse.json({
    env: {
      FOOTBALL_DATA_API_TOKEN: footballDataSet ? "set" : "missing",
      ODDS_API_KEY: oddsApiSet ? "set" : "missing",
    },
    hint: !oddsApiSet
      ? "Add ODDS_API_KEY to .env.local and restart the dev server (npm run dev)."
      : undefined,
  });
}
