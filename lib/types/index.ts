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
  /** Odds from the-odds-api (when merged) */
  odds?: MatchOdds;
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

// ---- Budget & tracking (localStorage) ----

export type RiskProfile = "low" | "medium" | "high";

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
}
