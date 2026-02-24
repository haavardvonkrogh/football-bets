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
  const minOdds = riskProfile === "low" ? 1.6 : riskProfile === "medium" ? 1.8 : 2.5;
  const maxOdds = riskProfile === "low" ? 2.2 : riskProfile === "medium" ? 2.8 : 6.0;

  for (const match of matches) {
    const label = `${match.homeTeam.shortName ?? match.homeTeam.name} v ${match.awayTeam.shortName ?? match.awayTeam.name}`;
    const league = match.competition.name;
    const odds = match.odds;
    if (!odds) continue;

    // Over/Under – use overUnder array from API response
    const overUnder = odds.overUnder ?? [];
    for (const row of overUnder) {
      const { line: point, over, under } = row;
      if (over != null && over >= minOdds && over <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: `Over ${point} goals`,
          odds: over,
          reason: `The odds for Over ${point} goals (${over.toFixed(2)}) offer a good balance of risk and reward. Both teams have reasonable attacking potential, and this line can represent value.`,
        });
      }
      if (under != null && under >= minOdds && under <= maxOdds) {
        out.push({
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: `Under ${point} goals`,
          odds: under,
          reason: `Under ${point} goals at ${under.toFixed(2)} is a solid defensive pick. If one or both sides tend to play cautiously or have key attackers missing, the odds can represent value.`,
        });
      }
    }

    // Asian Handicap – use asianHandicap array from API response (all 0.5-increment lines)
    const ahList = odds.asianHandicap;
    if (ahList?.length) {
      const homeName = match.homeTeam.shortName ?? match.homeTeam.name;
      const awayName = match.awayTeam.shortName ?? match.awayTeam.name;
      for (const ah of ahList) {
        const { home, away } = ah;
        const point = home.line;
        const underdogOdds = point < 0 ? away.odds : home.odds;
        const underdogName = point < 0 ? awayName : homeName;
        if (underdogOdds >= minOdds && underdogOdds <= maxOdds) {
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

    // BTTS – use btts.yes / btts.no from API response
    const btts = odds.btts;
    if (btts) {
      const { yes, no } = btts;
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
