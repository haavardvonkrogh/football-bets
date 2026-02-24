import type { FootballDataMatch } from "@/lib/types";
import type { StandingTableEntry } from "@/lib/types";

export interface Last5Summary {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export function getLast5Summary(matches: FootballDataMatch[], teamId: number): Last5Summary {
  let wins = 0,
    draws = 0,
    losses = 0,
    goalsFor = 0,
    goalsAgainst = 0;
  for (const m of matches) {
    const home = m.score?.fullTime?.home ?? 0;
    const away = m.score?.fullTime?.away ?? 0;
    const isHome = m.homeTeam.id === teamId;
    const our = isHome ? home : away;
    const their = isHome ? away : home;
    goalsFor += our;
    goalsAgainst += their;
    if (our > their) wins++;
    else if (our < their) losses++;
    else draws++;
  }
  return { wins, draws, losses, goalsFor, goalsAgainst };
}

export function formatLast5Results(matches: FootballDataMatch[], teamId: number): string[] {
  return matches.map((m) => {
    const home = m.score?.fullTime?.home ?? 0;
    const away = m.score?.fullTime?.away ?? 0;
    const isHome = m.homeTeam.id === teamId;
    const our = isHome ? home : away;
    const their = isHome ? away : home;
    if (our > their) return "W";
    if (our < their) return "L";
    return "D";
  });
}

/**
 * Generate Norwegian bet analysis from match stats, last 5, standings, h2h and odds.
 */
export function generateBetAnalysis(params: {
  homeName: string;
  awayName: string;
  homeLast5: Last5Summary;
  awayLast5: Last5Summary;
  homeStanding?: StandingTableEntry | null;
  awayStanding?: StandingTableEntry | null;
  h2hMatches: FootballDataMatch[];
  homeTeamId: number;
  awayTeamId: number;
  odds?: {
    btts?: { yes: number; no: number };
    overUnder?: Array<{ line: number; over: number; under: number }>;
    asianHandicap?: Array<{ home: { line: number; odds: number }; away: { line: number; odds: number } }>;
  };
}): string {
  const {
    homeName,
    awayName,
    homeLast5,
    awayLast5,
    homeStanding,
    awayStanding,
    h2hMatches,
    homeTeamId,
    awayTeamId,
    odds,
  } = params;

  const homeAvgScored = homeLast5.wins + homeLast5.draws + homeLast5.losses > 0
    ? (homeLast5.goalsFor / 5).toFixed(1)
    : "–";
  const homeAvgConceded = homeLast5.wins + homeLast5.draws + homeLast5.losses > 0
    ? (homeLast5.goalsAgainst / 5).toFixed(1)
    : "–";
  const awayAvgScored = awayLast5.wins + awayLast5.draws + awayLast5.losses > 0
    ? (awayLast5.goalsFor / 5).toFixed(1)
    : "–";
  const awayAvgConceded = awayLast5.wins + awayLast5.draws + awayLast5.losses > 0
    ? (awayLast5.goalsAgainst / 5).toFixed(1)
    : "–";

  const totalLast5Home = homeLast5.goalsFor + homeLast5.goalsAgainst;
  const totalLast5Away = awayLast5.goalsFor + awayLast5.goalsAgainst;
  const totalLast5 = totalLast5Home + totalLast5Away;
  const expectedGoalsSimple =
    totalLast5 > 0 ? (totalLast5 / 10).toFixed(1) : "–";

  let bttsLikely = "Ukjent.";
  const homeScores = homeLast5.goalsFor > 0;
  const awayScores = awayLast5.goalsFor > 0;
  if (homeLast5.wins + homeLast5.draws + homeLast5.losses >= 3 && awayLast5.wins + awayLast5.draws + awayLast5.losses >= 3) {
    if (homeScores && awayScores) {
      bttsLikely = `Begge lag scorer jevnt i de siste kampene (${homeName} ${homeLast5.goalsFor} mål på 5 kamper, ${awayName} ${awayLast5.goalsFor} mål). BTTS Ja kan være aktuelt.`;
    } else if (!homeScores || !awayScores) {
      bttsLikely = `Ét eller begge lag har slitt med å score (${homeName} ${homeLast5.goalsFor} mål, ${awayName} ${awayLast5.goalsFor} mål på 5 kamper). BTTS Nei kan ha verdi.`;
    }
  }

  const lines: string[] = [];

  lines.push(`**Form og plassering:** ${homeName} har ${homeLast5.wins}-${homeLast5.draws}-${homeLast5.losses} (W-D-L) i de siste 5 kampene med ${homeLast5.goalsFor} mål scoret og ${homeLast5.goalsAgainst} innsluppet. ${awayName} har ${awayLast5.wins}-${awayLast5.draws}-${awayLast5.losses} med ${awayLast5.goalsFor} mål scoret og ${awayLast5.goalsAgainst} innsluppet.`);
  if (homeStanding && awayStanding) {
    lines.push(`${homeName} ligger på ${homeStanding.position}. plass med ${homeStanding.points} poeng, ${awayName} på ${awayStanding.position}. plass med ${awayStanding.points} poeng.`);
  }

  lines.push(`**Forventet mål:** Basert på siste 5 kamper scorer ${homeName} i snitt ${homeAvgScored} mål per kamp og slipper inn ${homeAvgConceded}. ${awayName} scorer i snitt ${awayAvgScored} og slipper inn ${awayAvgConceded}. Et grovt estimat for forventede mål i kampen er rundt ${expectedGoalsSimple}.`);

  lines.push(`**BTTS:** ${bttsLikely}`);

  if (h2hMatches.length > 0) {
    let h2hHomeWins = 0;
    let h2hAwayWins = 0;
    for (const m of h2hMatches) {
      const h = m.score?.fullTime?.home ?? 0;
      const a = m.score?.fullTime?.away ?? 0;
      const homeIsOurHome = m.homeTeam.id === homeTeamId;
      const ourGoals = homeIsOurHome ? h : a;
      const theirGoals = homeIsOurHome ? a : h;
      if (ourGoals > theirGoals) h2hHomeWins++;
      else if (ourGoals < theirGoals) h2hAwayWins++;
    }
    const h2hDraws = h2hMatches.length - h2hHomeWins - h2hAwayWins;
    lines.push(`**Oppgjørshistorikk:** I de siste møtene: ${homeName} ${h2hHomeWins} seire, ${awayName} ${h2hAwayWins} seire, ${h2hDraws} uavgjort.`);
  }

  if (odds?.overUnder && odds.overUnder.length > 0) {
    const line25 = odds.overUnder.find((r) => r.line === 2.5) ?? odds.overUnder[0];
    if (line25) {
      lines.push(`**Over/Under 2.5:** Oddsen er Over @ ${line25.over.toFixed(2)} og Under @ ${line25.under.toFixed(2)}. Basert på formen kan Over 2.5 være interessant hvis begge lag scorer ofte, ellers vurder Under.`);
    }
  }

  if (odds?.asianHandicap?.length) {
    const spreadStr = odds.asianHandicap
      .map(({ home, away }) => `${home.line > 0 ? "+" : ""}${home.line} (${home.odds.toFixed(2)} / ${away.odds.toFixed(2)})`)
      .join("; ");
    lines.push(`**Asian handicap:** Tilgjengelige linjer: ${spreadStr}. Hvis ${homeName} er klart sterkere på form og tabell, kan hjemmelag -0.5 eller -1.0 være aktuelt. Hvis kampen er jevn, vurder underdog +0.5.`);
  }

  return lines.join("\n\n");
}
