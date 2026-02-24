import type { UpcomingMatch, BetRecommendation, RiskProfile } from "@/lib/types";

/**
 * Generate value bet recommendations from matches with odds.
 * Uses simple heuristics: attractive odds + implied value.
 */
export function getRecommendations(
  matches: UpcomingMatch[],
  riskProfile: RiskProfile
): BetRecommendation[] {
  const out: BetRecommendation[] = [];
  const minOdds = riskProfile === "low" ? 1.5 : riskProfile === "medium" ? 1.4 : 1.3;
  const maxOdds = riskProfile === "low" ? 2.2 : riskProfile === "medium" ? 2.8 : 3.5;

  for (const match of matches) {
    const label = `${match.homeTeam.shortName ?? match.homeTeam.name} v ${match.awayTeam.shortName ?? match.awayTeam.name}`;
    const league = match.competition.name;
    const odds = match.odds;
    if (!odds) continue;

    // Over/Under 2.5 goals
    const totals25 = odds.totals?.["2.5"];
    if (totals25?.bestOdds) {
      const over = totals25.bestOdds["Over"] ?? totals25.bestOdds["Over 2.5"];
      const under = totals25.bestOdds["Under"] ?? totals25.bestOdds["Under 2.5"];
      if (over != null && over >= minOdds && over <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: "Over 2.5 goals",
          odds: over,
          reason: `The odds for Over 2.5 goals (${over.toFixed(2)}) offer a good balance of risk and reward. Both teams have reasonable attacking potential, and this line is one of the most liquid markets, so the price is efficient.`,
        });
      }
      if (under != null && under >= minOdds && under <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: "Under 2.5 goals",
          odds: under,
          reason: `Under 2.5 goals at ${under.toFixed(2)} is a solid defensive pick. If one or both sides tend to play cautiously or have key attackers missing, the odds can represent value.`,
        });
      }
    }

    // Asian Handicap (spreads)
    const spreads = odds.spreads;
    if (spreads) {
      for (const [lineKey, summary] of Object.entries(spreads)) {
        const point = summary.point ?? parseFloat(lineKey);
        if (Number.isNaN(point)) continue;
        const home = summary.bestOdds[match.homeTeam.name] ?? summary.bestOdds["Home"];
        const away = summary.bestOdds[match.awayTeam.name] ?? summary.bestOdds["Away"];
        const [fav, underdog, favName, underdogName] =
          point < 0
            ? [home, away, match.homeTeam.shortName ?? match.homeTeam.name, match.awayTeam.shortName ?? match.awayTeam.name]
            : [away, home, match.awayTeam.shortName ?? match.awayTeam.name, match.homeTeam.shortName ?? match.homeTeam.name];
        const underdogOdds = underdog ?? (point < 0 ? away : home);
        if (underdogOdds != null && underdogOdds >= minOdds && underdogOdds <= maxOdds) {
          const lineDesc = point > 0 ? `+${point}` : String(point);
          out.push({
            matchId: match.id,
            matchLabel: label,
            league,
            market: "spreads",
            selection: `${underdogName} ${lineDesc}`,
            odds: underdogOdds,
            handicapLine: point,
            reason: `Asian Handicap ${lineDesc} on ${underdogName} means they start with ${point > 0 ? "a goal advantage" : "a goal disadvantage"} for betting purposes. At ${underdogOdds.toFixed(2)}, the underdog is getting a line that can level the playing field—if you think they can keep the match close or win, this offers value.`,
          });
        }
      }
    }

    // BTTS
    const btts = odds.btts;
    if (btts?.bestOdds) {
      const yes = btts.bestOdds["Yes"];
      const no = btts.bestOdds["No"];
      if (yes != null && yes >= minOdds && yes <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "btts",
          selection: "Both teams to score – Yes",
          odds: yes,
          reason: `Both teams to score at ${yes.toFixed(2)} is a strong pick when both sides have decent attack and tend to concede. The price reflects a real chance of goals at both ends.`,
        });
      }
      if (no != null && no >= minOdds && no <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "btts",
          selection: "Both teams to score – No",
          odds: no,
          reason: `BTTS No at ${no.toFixed(2)} suits matches where one team is likely to dominate or both are defensively solid. If you expect a clean sheet or a single scorer, this can offer value.`,
        });
      }
    }
  }

  return out.slice(0, 15); // cap at 15 recommendations
}
