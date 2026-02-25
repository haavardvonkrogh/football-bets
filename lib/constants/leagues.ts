/**
 * League configuration for football-data.org and the-odds-api.
 * Maps our app leagues to each provider's identifiers.
 */

export const FOOTBALL_DATA_LEAGUES = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "BL2", name: "2. Bundesliga" },
  { code: "DED", name: "Eredivisie" },
  { code: "BEL", name: "Belgian Pro League" },
  { code: "CL", name: "UEFA Champions League" },
  { code: "EL", name: "UEFA Europa League" },
] as const;

export type FootballDataLeagueCode = (typeof FOOTBALL_DATA_LEAGUES)[number]["code"];

/**
 * Map football-data.org competition names to UI display names.
 * Use getLeagueDisplayName() so "Primera Division" shows as "La Liga" etc.
 */
export const LEAGUE_DISPLAY_NAMES: Record<string, string> = {
  "Primera Division": "La Liga",
};

export function getLeagueDisplayName(apiName: string): string {
  return LEAGUE_DISPLAY_NAMES[apiName] ?? apiName;
}

/**
 * the-odds-api sport keys for soccer.
 * Must match leagues we fetch from football-data.org for merging.
 */
export const ODDS_API_SPORT_KEYS: Record<string, string> = {
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Primera Division": "soccer_spain_la_liga",
  "Bundesliga": "soccer_germany_bundesliga",
  "Serie A": "soccer_italy_serie_a",
  "2. Bundesliga": "soccer_germany_bundesliga2",
  "Eredivisie": "soccer_netherlands_eredivisie",
  "Belgian Pro League": "soccer_belgium_first_div",
  "UEFA Champions League": "soccer_uefa_champs_league",
  "UEFA Europa League": "soccer_uefa_europa_league",
};

export const ODDS_MARKETS = {
  /** Both Teams To Score - use event-level endpoint */
  BTTS: "btts",
  /** Over/Under goals */
  TOTALS: "totals",
  /** Asian Handicap / spreads */
  SPREADS: "spreads",
  /** Match result (for reference) */
  H2H: "h2h",
} as const;
