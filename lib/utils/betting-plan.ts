import type { BetRecommendation, RiskProfile, WeeklyBettingPlan, PlannedBet } from "@/lib/types";

/** Sort planned bets by value score (highest first). */
function sortByValueScore(plannedBets: PlannedBet[]): PlannedBet[] {
  return [...plannedBets].sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0));
}

/**
 * Redistribute stakes so they sum exactly to weeklyBudgetNok. Uses proportional
 * allocation of the remainder (from Math.floor) so 100% of budget is used.
 */
function normalizeStakesToBudget(plannedBets: PlannedBet[], weeklyBudgetNok: number): PlannedBet[] {
  const totalStaked = plannedBets.reduce((s, b) => s + b.stakeNok, 0);
  const remainder = Math.round(weeklyBudgetNok - totalStaked);
  if (remainder <= 0 || plannedBets.length === 0) {
    return totalStaked === 0 ? plannedBets : plannedBets.map((b) => ({
      ...b,
      potentialReturnNok: Math.round(b.stakeNok * b.odds * 100) / 100,
    }));
  }
  const n = plannedBets.length;
  let allocated = 0;
  const extra: number[] = [];
  for (let i = 0; i < n; i++) {
    const share = i < n - 1
      ? Math.round((remainder * plannedBets[i].stakeNok) / totalStaked)
      : remainder - allocated;
    extra.push(Math.max(0, share));
    allocated += extra[i];
  }
  return plannedBets.map((b, i) => {
    const newStake = b.stakeNok + (extra[i] ?? 0);
    return {
      ...b,
      stakeNok: newStake,
      potentialReturnNok: Math.round(newStake * b.odds * 100) / 100,
    };
  });
}

/**
 * Build a weekly betting plan from recommendations, budget and risk profile.
 * Low: 3–4 singles, 10–15% per bet, odds 1.6–2.2.
 * Medium: 3–4 singles + one 2-fold, 15–25% per bet, acca 20%, odds 1.8–2.8.
 * High: 2–3 singles + 3-fold + 4-fold, 25–40% per single, 30% on accas, odds 2.5–5.0, prioritize value.
 * Stakes are normalized so total always equals 100% of weekly budget.
 */
export function getWeeklyBettingPlan(
  recommendations: BetRecommendation[],
  weeklyBudgetNok: number,
  riskProfile: RiskProfile
): WeeklyBettingPlan | null {
  if (recommendations.length === 0 || weeklyBudgetNok <= 0) return null;

  const budget = weeklyBudgetNok;
  const plannedBets: PlannedBet[] = [];

  if (riskProfile === "low") {
    // 3–4 singles, 10–15% per bet, odds 1.6–2.2
    const inRange = recommendations.filter((r) => r.odds >= 1.6 && r.odds <= 2.2);
    const picks = (inRange.length >= 3 ? inRange : recommendations).slice(0, 4);
    if (picks.length === 0) return null;
    const n = picks.length;
    const pctPerBet = Math.min(15, Math.max(10, Math.floor(100 / n))); // 10–15%
    const stakePerBet = Math.floor((budget * pctPerBet) / 100);
    let allocated = 0;
    for (let i = 0; i < picks.length; i++) {
      const rec = picks[i];
      const stake = i < picks.length - 1 ? stakePerBet : Math.max(0, budget - allocated - stakePerBet * (picks.length - 1));
      if (stake <= 0) continue;
      allocated += stake;
      plannedBets.push({
        type: "single",
        matchId: rec.matchId,
        market: rec.market,
        matchLabel: rec.matchLabel,
        selection: `${rec.matchLabel}: ${rec.selection}`,
        odds: rec.odds,
        stakeNok: stake,
        potentialReturnNok: Math.round(stake * rec.odds * 100) / 100,
        reason: `Lav risiko: enkeltspill med odds 1,6–2,2. Innsats ${pctPerBet}% av budsjettet.`,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      });
    }
    const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
    const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
    const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Lav risiko: ${normalized.length} enkeltspill, 10–15% av budsjettet per bet, odds 1,6–2,2. Ingen akkumulatorer. Total mulig retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  if (riskProfile === "medium") {
    // 3–4 singles (15–25% per bet) + one 2-fold (20% of budget), odds 1.8–2.8
    const inRange = recommendations.filter((r) => r.odds >= 1.8 && r.odds <= 2.8);
    const pool = inRange.length >= 4 ? inRange : recommendations;
    const singlePicks = pool.slice(0, 4);
    const usedMatchIds = new Set(singlePicks.map((r) => r.matchId));
    const accaLegs = pool.filter((r) => !usedMatchIds.has(r.matchId)).slice(0, 2);
    const hasAcca = accaLegs.length >= 2;
    const accaStakeNok = hasAcca ? Math.floor(budget * 0.2) : 0; // 20%
    const singleBudget = budget - accaStakeNok;
    const nSingles = singlePicks.length;
    const pctPerSingle = Math.min(25, Math.max(15, Math.floor(singleBudget / budget * 100 / nSingles))); // 15–25% of total
    const stakePerSingle = nSingles > 0 ? Math.floor(singleBudget / nSingles) : 0;
    let allocated = 0;
    for (let i = 0; i < singlePicks.length; i++) {
      const rec = singlePicks[i];
      const stake = i < singlePicks.length - 1 ? stakePerSingle : singleBudget - allocated;
      if (stake <= 0) continue;
      allocated += stake;
      plannedBets.push({
        type: "single",
        matchId: rec.matchId,
        market: rec.market,
        matchLabel: rec.matchLabel,
        selection: `${rec.matchLabel}: ${rec.selection}`,
        odds: rec.odds,
        stakeNok: stake,
        potentialReturnNok: Math.round(stake * rec.odds * 100) / 100,
        reason: `Enkeltspill 15–25% av budsjettet, odds 1,8–2,8. Mulig retur: ${Math.round(stake * rec.odds * 100) / 100} NOK.`,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      });
    }
    if (hasAcca) {
      const combinedOdds = accaLegs[0].odds * accaLegs[1].odds;
      plannedBets.push({
        type: "accumulator",
        legs: accaLegs,
        matchId: accaLegs[0].matchId,
        market: "totals",
        matchLabel: accaLegs.map((l) => l.matchLabel).join(" · "),
        selection: accaLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combinedOdds * 100) / 100,
        stakeNok: accaStakeNok,
        potentialReturnNok: Math.round(accaStakeNok * combinedOdds * 100) / 100,
        reason: `2-fold akkumulator, 20% av budsjettet. Mulig retur: ${Math.round(accaStakeNok * combinedOdds * 100) / 100} NOK.`,
        valueScore: Math.min(...accaLegs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...accaLegs.map((l) => l.confidenceScore)),
      });
    }
    const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
    const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
    const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Middels risiko: ${singlePicks.length} enkeltspill (15–25% per bet) + én 2-fold (20% av budsjettet). Odds 1,8–2,8. Total mulig retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  // High (aggressive): 2 singles (3.0–6.0, 25% each) + 3-fold (10–20, 15%) + 4-fold (25–50, 15%) + mega 5–6 fold (60–150+, 20%)
  // Prioritize: higher odds, Over 2.5, BTTS Yes, Asian handicap underdogs
  const preferred = (r: BetRecommendation) =>
    (r.market === "totals" && r.selection.toLowerCase().includes("over")) ||
    (r.market === "btts" && (r.selection.toLowerCase().includes("yes") || r.selection.toLowerCase().includes("ja"))) ||
    r.market === "spreads";
  const pool = [...recommendations]
    .filter((r) => r.odds >= 2.0)
    .sort((a, b) => {
      const pa = preferred(a) ? 1 : 0;
      const pb = preferred(b) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return b.odds - a.odds;
    });

  const usedMatchIds = new Set<number>();
  const take = (n: number, minOdds?: number, maxOdds?: number): BetRecommendation[] => {
    const out: BetRecommendation[] = [];
    for (const r of pool) {
      if (usedMatchIds.has(r.matchId)) continue;
      if (minOdds != null && r.odds < minOdds) continue;
      if (maxOdds != null && r.odds > maxOdds) continue;
      out.push(r);
      usedMatchIds.add(r.matchId);
      if (out.length >= n) break;
    }
    return out;
  };

  const singleLegs = take(2, 3.0, 6.0); // 2 singles, odds 3.0–6.0
  const threeFoldLegs = take(3); // next 3 for 3-fold (target 10–20 combined)
  const fourFoldLegs = take(4); // next 4 for 4-fold (target 25–50)
  const megaLegs = take(6); // up to 6 for mega (target 60–150+); use 5 if only 5 available

  const stakeSingle = Math.floor(budget * 0.25); // 25% each
  const stake3 = Math.floor(budget * 0.15); // 15%
  const stake4 = Math.floor(budget * 0.15); // 15%
  const stakeMega = Math.floor(budget * 0.2); // 20%

  for (const rec of singleLegs) {
    const ret = Math.round(stakeSingle * rec.odds * 100) / 100;
    plannedBets.push({
      type: "single",
      matchId: rec.matchId,
      market: rec.market,
      matchLabel: rec.matchLabel,
      selection: `${rec.matchLabel}: ${rec.selection}`,
      odds: rec.odds,
      stakeNok: stakeSingle,
      potentialReturnNok: ret,
      reason: `Verdibet (odds 3,0–6,0), 25% av budsjettet. Prioriterer Over 2.5 / BTTS Ja / Asian handicap. Potensiell retur ved treff: ${ret} NOK.`,
      valueScore: rec.valueScore,
      confidenceScore: rec.confidenceScore,
    });
  }

  if (threeFoldLegs.length >= 3) {
    const combined = threeFoldLegs[0].odds * threeFoldLegs[1].odds * threeFoldLegs[2].odds;
    const ret = Math.round(stake3 * combined * 100) / 100;
    plannedBets.push({
      type: "accumulator",
      legs: threeFoldLegs,
      matchId: threeFoldLegs[0].matchId,
      market: "totals",
      matchLabel: threeFoldLegs.map((l) => l.matchLabel).join(" · "),
      selection: threeFoldLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stake3,
      potentialReturnNok: ret,
      reason: `3-fold (sikter kombinert odds 10–20), 15% av budsjettet. Potensiell retur ved treff: ${ret} NOK.`,
      valueScore: Math.min(...threeFoldLegs.map((l) => l.valueScore)),
      confidenceScore: Math.min(...threeFoldLegs.map((l) => l.confidenceScore)),
    });
  }

  if (fourFoldLegs.length >= 4) {
    const combined = fourFoldLegs[0].odds * fourFoldLegs[1].odds * fourFoldLegs[2].odds * fourFoldLegs[3].odds;
    const ret = Math.round(stake4 * combined * 100) / 100;
    plannedBets.push({
      type: "accumulator",
      legs: fourFoldLegs,
      matchId: fourFoldLegs[0].matchId,
      market: "totals",
      matchLabel: fourFoldLegs.map((l) => l.matchLabel).join(" · "),
      selection: fourFoldLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stake4,
      potentialReturnNok: ret,
      reason: `4-fold (sikter kombinert odds 25–50), 15% av budsjettet. Potensiell retur ved treff: ${ret} NOK.`,
      valueScore: Math.min(...fourFoldLegs.map((l) => l.valueScore)),
      confidenceScore: Math.min(...fourFoldLegs.map((l) => l.confidenceScore)),
    });
  }

  const megaCount = megaLegs.length >= 5 ? (megaLegs.length >= 6 ? 6 : 5) : 0;
  const megaUse = megaLegs.slice(0, megaCount);
  if (megaUse.length >= 5) {
    const combined = megaUse.reduce((p, l) => p * l.odds, 1);
    const ret = Math.round(stakeMega * combined * 100) / 100;
    plannedBets.push({
      type: "accumulator",
      legs: megaUse,
      matchId: megaUse[0].matchId,
      market: "totals",
      matchLabel: megaUse.map((l) => l.matchLabel).join(" · "),
      selection: megaUse.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stakeMega,
      potentialReturnNok: ret,
      reason: `Mega-akkumulator (${megaCount}-fold, sikter odds 60–150+), 20% av budsjettet. Potensiell retur ved treff: ${ret} NOK.`,
      valueScore: Math.min(...megaUse.map((l) => l.valueScore)),
      confidenceScore: Math.min(...megaUse.map((l) => l.confidenceScore)),
    });
  }

  const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
  const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
  const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
  const megaText = megaCount >= 5 ? ` + mega ${megaCount}-fold (20%, odds 60–150+)` : "";
  return {
    plannedBets: normalized,
    totalStaked,
    totalPotentialReturn: Math.round(totalReturn * 100) / 100,
    summaryReason: `Høy risiko: 2 enkeltspill (25% hver, odds 3–6) + 3-fold (15%, odds 10–20) + 4-fold (15%, odds 25–50)${megaText}. Prioriterer Over 2.5, BTTS Ja og Asian handicap. Total potensiell retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
  };
}
