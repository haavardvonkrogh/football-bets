/**
 * Shared types for the football betting advisor app.
 */

// ---- Football Data API (matches) ----

export interface FootballDataTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

export interface FootballDataMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string | null;
  group: string | null;
  lastUpdated: string;
  competition: {
    id: number;
    name: string;
    code: string;
    emblem: string | null;
  };
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score?: {
    fullTime: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
  };
}

export interface FootballDataMatchesResponse {
  matches: FootballDataMatch[];
}

/** Single match from GET /matches/{id} (includes venue etc.) */
export interface FootballDataMatchDetail extends FootballDataMatch {
  venue?: string;
}

/** Team matches response: GET /teams/{id}/matches */
export interface TeamMatchesResponse {
  matches: FootballDataMatch[];
  resultSet?: { count: number; first: string; last: string; played: number; wins: number; draws: number; losses: number };
}

/** Standings table entry */
export interface StandingTableEntry {
  position: number;
  team: { id: number; name: string; shortName: string | null; tla: string | null; crest: string | null };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface StandingsResponse {
  standings: { table: StandingTableEntry[] }[];
}

/** Head2head: GET /matches/{id}/head2head */
export interface Head2HeadResponse {
  aggregates?: { numberOfMatches: number; homeTeam: { wins: number; draws: number; losses: number }; awayTeam: { wins: number; draws: number; losses: number } };
  matches: FootballDataMatch[];
}

// ---- The Odds API ----

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number; // for spreads/totals
}

export interface OddsMarket {
  key: string;
  last_update?: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

// ---- App domain (normalized) ----

export interface MatchTeam {
  id: number;
  name: string;
  shortName: string | null;
  crest: string | null;
}

export interface UpcomingMatch {
  /** football-data.org match id */
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  competition: {
    id: number;
    name: string;
    code: string;
  };
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  /** Odds from the-odds-api (normalized shape from /api/matches) */
  odds?: ResponseOdds;
}

export type OddsMarketType = "btts" | "totals" | "spreads" | "h2h";

export interface MarketOddsSummary {
  /** Best decimal odds for each outcome (across bookmakers) */
  bestOdds: Record<string, number>;
  /** Line/point if applicable (e.g. Over 2.5, handicap -0.5) */
  point?: number;
  /** Bookmaker that offered best for each outcome */
  bookmaker?: string;
}

export interface MatchOdds {
  btts?: MarketOddsSummary;
  totals?: Record<string, MarketOddsSummary>; // key e.g. "2.5"
  spreads?: Record<string, MarketOddsSummary>; // key e.g. "-0.5"
  h2h?: MarketOddsSummary;
}

/** Normalized odds shape returned by /api/matches (and used by the UI). */
export interface ResponseOdds {
  btts?: { yes: number; no: number };
  overUnder?: Array<{ line: number; over: number; under: number }>;
  /** All 0.5-increment Asian Handicap lines (home/away pair per line). */
  asianHandicap?: Array<{ home: { line: number; odds: number }; away: { line: number; odds: number } }>;
}

// ---- Budget & tracking (localStorage) ----

export type RiskProfile = "low" | "medium" | "high" | "extreme";

export interface UserSettings {
  weeklyBudget: number;
  riskProfile: RiskProfile;
}

export interface PlacedBet {
  id: string;
  matchId: number;
  matchLabel: string;
  market: OddsMarketType;
  selection: string;
  odds: number;
  stake: number;
  placedAt: string;
  /** ISO week key e.g. "2025-W08" */
  weekKey: string;
}

export interface BetResult {
  betId: string;
  won: boolean;
  returns: number;
  settledAt: string;
  /** Optional display of actual score when auto-settled (e.g. "2-1") */
  scoreDisplay?: string;
}

export interface WeekSummary {
  weekKey: string;
  startDate: string;
  endDate: string;
  totalStaked: number;
  totalReturns: number;
  profitLoss: number;
  bets: (PlacedBet & { result?: BetResult })[];
}

export interface BetRecommendation {
  matchId: number;
  matchLabel: string;
  league: string;
  market: OddsMarketType;
  selection: string;
  odds: number;
  /** Plain-language explanation for the recommendation */
  reason: string;
  /** Optional handicap line for spreads */
  handicapLine?: number;
  /** Value bet score 1–10 (5+ = value bet). Based on (our est. prob - implied prob) / implied prob * 10. */
  valueScore: number;
  /** Confidence 0–100: how likely we think this bet is to win (form, home/away, trends). */
  confidenceScore: number;
}

/** A recommendation saved to history (for Anbefalingshistorikk). */
export interface SavedRecommendation {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  betType: OddsMarketType;
  odds: number;
  valueScore: number;
  confidenceScore: number;
  /** Display label for the selection (e.g. "Over 2.5", "Hjemmeseier") */
  selection: string;
  status: "pending" | "won" | "lost";
  /** Optional stable id for list keys and future result linking */
  id?: string;
}

/** A single planned bet (single or accumulator) in the weekly plan */
export interface PlannedBet {
  type: "single" | "accumulator";
  /** For accumulator: the legs that make up the bet */
  legs?: BetRecommendation[];
  /** Display label: selection (single) or "Leg 1 / Leg 2 / …" (accumulator) */
  selection: string;
  odds: number;
  stakeNok: number;
  potentialReturnNok: number;
  /** Why this bet and stake fit the plan */
  reason: string;
  /** For single: match id for PlacedBet; for accumulator use first leg */
  matchId?: number;
  /** For single: market type for PlacedBet */
  market?: OddsMarketType;
  /** For single: match label for PlacedBet (e.g. "Liverpool v Chelsea") */
  matchLabel?: string;
  /** Value bet score 1–10 (for sorting: highest first). */
  valueScore?: number;
  /** Confidence 0–100 for single; for accumulator = min of legs. */
  confidenceScore?: number;
}

export interface WeeklyBettingPlan {
  plannedBets: PlannedBet[];
  totalStaked: number;
  totalPotentialReturn: number;
  /** Short explanation of the allocation strategy */
  summaryReason: string;
}
