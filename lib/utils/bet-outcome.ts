/**
 * Resolve bet outcome from match result (football-data.org).
 * Used for auto-setting results when match is FINISHED.
 */

import type { PlacedBet } from "@/lib/types";

export interface MatchResult {
  home: number;
  away: number;
  status: string;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
}

export interface ResolvedOutcome {
  won: boolean;
  returns: number;
  scoreDisplay: string;
}

/**
 * Parse line from selection e.g. "Over 2.5 mål" -> 2.5, "Under 3.5" -> 3.5
 */
function parseTotalsLine(selection: string): number | null {
  const m = selection.match(/(\d+(?:[.,]\d+)?)\s*mål/);
  if (m) return parseFloat(m[1].replace(",", "."));
  const m2 = selection.match(/[Oo]ver\s+(\d+(?:[.,]\d+)?)|[Uu]nder\s+(\d+(?:[.,]\d+)?)/);
  if (m2) return parseFloat((m2[1] ?? m2[2] ?? "").replace(",", "."));
  return null;
}

/**
 * Parse Asian Handicap: "TeamName +0.5" or "TeamName -0.5" -> { teamPart, line }
 */
function parseAsianHandicap(selection: string): { teamPart: string; line: number } | null {
  const m = selection.match(/^(.+?)\s+([+-]?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const line = parseFloat(m[2].replace(",", "."));
  if (Number.isNaN(line)) return null;
  return { teamPart: m[1].trim().toLowerCase(), line };
}

/**
 * Determine if the bet is on home or away for Asian Handicap (selection contains team name).
 */
function isHomeSide(selection: string, homeTeamName: string, awayTeamName: string): boolean {
  const home = homeTeamName.toLowerCase();
  const away = awayTeamName.toLowerCase();
  const sel = selection.toLowerCase();
  const homeShort = home.split(/\s+/)[0] ?? home;
  const awayShort = away.split(/\s+/)[0] ?? away;
  if (sel.includes(home) || sel.includes(homeShort)) return true;
  if (sel.includes(away) || sel.includes(awayShort)) return false;
  return true;
}

/**
 * Compute bet outcome from match result. Returns null if market/selection cannot be resolved.
 */
export function computeBetOutcome(
  bet: PlacedBet,
  result: MatchResult
): ResolvedOutcome | null {
  if (result.status !== "FINISHED") return null;
  const home = result.home ?? 0;
  const away = result.away ?? 0;
  const total = home + away;
  const scoreDisplay = `${home}-${away}`;

  if (bet.market === "totals") {
    const line = parseTotalsLine(bet.selection);
    if (line == null) return null;
    const isOver = /over/i.test(bet.selection);
    const isUnder = /under/i.test(bet.selection);
    if (isOver) {
      if (total > line) return { won: true, returns: Math.round(bet.stake * bet.odds * 100) / 100, scoreDisplay };
      if (total < line) return { won: false, returns: 0, scoreDisplay };
      return { won: false, returns: 0, scoreDisplay };
    }
    if (isUnder) {
      if (total < line) return { won: true, returns: Math.round(bet.stake * bet.odds * 100) / 100, scoreDisplay };
      if (total > line) return { won: false, returns: 0, scoreDisplay };
      return { won: false, returns: 0, scoreDisplay };
    }
    return null;
  }

  if (bet.market === "btts") {
    const bothScored = home > 0 && away > 0;
    const isYes = /ja|yes/i.test(bet.selection);
    const won = isYes ? bothScored : !bothScored;
    return {
      won,
      returns: won ? Math.round(bet.stake * bet.odds * 100) / 100 : 0,
      scoreDisplay,
    };
  }

  if (bet.market === "spreads") {
    const parsed = parseAsianHandicap(bet.selection);
    if (!parsed || result.homeTeamName == null || result.awayTeamName == null) return null;
    const homeAdjusted = home + (isHomeSide(bet.selection, result.homeTeamName, result.awayTeamName) ? parsed.line : 0);
    const awayAdjusted = away + (isHomeSide(bet.selection, result.homeTeamName, result.awayTeamName) ? 0 : parsed.line);
    const won = homeAdjusted > awayAdjusted;
    return {
      won,
      returns: won ? Math.round(bet.stake * bet.odds * 100) / 100 : 0,
      scoreDisplay,
    };
  }

  return null;
}
