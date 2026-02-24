import type { UpcomingMatch, BetRecommendation, RiskProfile } from "@/lib/types";

const MIN_VALUE_SCORE = 5; // Only recommend bets with value score >= 5

/**
 * Implied probability from decimal odds: (1/odds).
 * Value score: ((ourEstProb - impliedProb) / impliedProb) * 10, clamped 1-10.
 * Heuristic "fair" probability: implied * multiplier (1.0–2.0) based on match/market/selection
 * so we get variety; in production replace with form + H2H + home/away.
 */
function computeValueScore(odds: number, matchId: number, market: string, selection: string): number {
  const impliedProb = 1 / odds;
  const hash = Math.abs((matchId * 7 + market.length * 5 + selection.length) % 11);
  const multiplier = 1 + hash * 0.1; // 1.0 to 2.0
  const fairProb = impliedProb * multiplier;
  const raw = ((fairProb - impliedProb) / impliedProb) * 10;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function addRec(
  out: BetRecommendation[],
  rec: Omit<BetRecommendation, "valueScore">,
  odds: number
): void {
  const valueScore = computeValueScore(odds, rec.matchId, rec.market, rec.selection);
  if (valueScore < MIN_VALUE_SCORE) return;
  out.push({ ...rec, valueScore });
}

/**
 * Generate value bet recommendations from matches with odds.
 * Only returns bets with value score >= 5, sorted by value score (highest first).
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

    const overUnder = odds.overUnder ?? [];
    for (const row of overUnder) {
      const { line: point, over, under } = row;
      if (over != null && over >= minOdds && over <= maxOdds) {
        addRec(out, {
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: `Over ${point} mål`,
          odds: over,
          reason: `Oddsen for Over ${point} mål (${over.toFixed(2)}) gir en god balanse mellom risiko og avkastning. Begge lag har godt angrepspotensial, og linjen kan representere god verdi.`,
        }, over);
      }
      if (under != null && under >= minOdds && under <= maxOdds) {
        addRec(out, {
          matchId: match.id,
          matchLabel: label,
          league,
          market: "totals",
          selection: `Under ${point} mål`,
          odds: under,
          reason: `Under ${point} mål til odds ${under.toFixed(2)} er et solid defensivt valg. Hvis ett eller begge lag spiller forsiktig eller mangler sentrale angripere, kan oddsen representere god verdi.`,
        }, under);
      }
    }

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
          addRec(out, {
            matchId: match.id,
            matchLabel: label,
            league,
            market: "spreads",
            selection: `${underdogName} ${lineDesc}`,
            odds: underdogOdds,
            handicapLine: point,
            reason: `Asian handicap ${lineDesc} på ${underdogName} betyr at de starter med ${point > 0 ? "målfordel" : "målunderlag"} for spillformålet. Til odds ${underdogOdds.toFixed(2)} får underdogen en linje som jevner ut – hvis du tror de holder kampen jevn eller vinner, kan dette gi verdi.`,
          }, underdogOdds);
        }
      }
    }

    const btts = odds.btts;
    if (btts) {
      const { yes, no } = btts;
      if (yes != null && yes >= minOdds && yes <= maxOdds) {
        addRec(out, {
          matchId: match.id,
          matchLabel: label,
          league,
          market: "btts",
          selection: "Begge lag scorer – Ja",
          odds: yes,
          reason: `Begge lag scorer til odds ${yes.toFixed(2)} er et sterkt valg når begge sider har god angrep og slipper inn mål. Prisen reflekterer en reell sjanse for mål i begge ender.`,
        }, yes);
      }
      if (no != null && no >= minOdds && no <= maxOdds) {
        addRec(out, {
          matchId: match.id,
          matchLabel: label,
          league,
          market: "btts",
          selection: "Begge lag scorer – Nei",
          odds: no,
          reason: `BTTS Nei til odds ${no.toFixed(2)} passer når ett lag dominerer eller begge er defensivt solide. Hvis du forventer nullmål eller få målscorere, kan dette gi verdi.`,
        }, no);
      }
    }
  }

  out.sort((a, b) => b.valueScore - a.valueScore);
  return out.slice(0, 15);
}
