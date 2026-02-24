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

  // High risk: Mega (20%) → Four-fold (15%) → Three-fold (15%) → Single (25%) → Single (25%)
  // Prefer Over 2.5, Over 3.5, BTTS Yes; fall back to ANY recs (Under, Asian Handicap) to fill. Always show at least mega + 1 single when possible.
  const sel = (r: BetRecommendation) => r.selection.toLowerCase();
  const isOver = (r: BetRecommendation) => r.market === "totals" && sel(r).includes("over");
  const isBttsYes = (r: BetRecommendation) =>
    r.market === "btts" && (sel(r).includes("yes") || sel(r).includes("ja"));
  const isOverOrBtts = (r: BetRecommendation) => isOver(r) || isBttsYes(r);

  const preferredPool = [...recommendations]
    .filter((r) => r.odds >= 2.0 && isOverOrBtts(r))
    .sort((a, b) => b.odds - a.odds);
  const fallbackPool = [...recommendations]
    .filter((r) => r.odds >= 2.0)
    .sort((a, b) => b.odds - a.odds);

  if (typeof console !== "undefined" && console.log) {
    console.log("[High risk] Over/BTTS recommendations available:", preferredPool.length, "| Total recommendations (odds >= 2):", fallbackPool.length);
  }

  const usedMatchIds = new Set<number>();
  const takeFrom = (pool: BetRecommendation[], n: number): BetRecommendation[] => {
    const out: BetRecommendation[] = [];
    for (const r of pool) {
      if (usedMatchIds.has(r.matchId)) continue;
      out.push(r);
      usedMatchIds.add(r.matchId);
      if (out.length >= n) break;
    }
    return out;
  };
  const take = (n: number): BetRecommendation[] => {
    const fromPreferred = takeFrom(preferredPool, n);
    const needed = n - fromPreferred.length;
    if (needed <= 0) return fromPreferred;
    const fromFallback = takeFrom(fallbackPool, needed);
    return [...fromPreferred, ...fromFallback];
  };

  const megaLegs = take(5);
  const fourFoldLegs = take(4);
  const threeFoldLegs = take(3);
  const single1 = take(1)[0];
  const single2 = take(1)[0];

  const stakeMega = Math.round(budget * 0.2);
  const stake4 = Math.round(budget * 0.15);
  const stake3 = Math.round(budget * 0.15);
  const stakeSingle = Math.round(budget * 0.25);

  if (megaLegs.length >= 5) {
    const combined = megaLegs.reduce((p, l) => p * l.odds, 1);
    plannedBets.push({
      type: "accumulator",
      legs: megaLegs,
      matchId: megaLegs[0].matchId,
      market: "totals",
      matchLabel: megaLegs.map((l) => l.matchLabel).join(" · "),
      selection: megaLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stakeMega,
      potentialReturnNok: Math.round(stakeMega * combined * 100) / 100,
      reason: `Mega-akkumulator (5 kamper, Over/BTTS Ja), 20% av budsjettet. Potensiell retur ved treff: ${Math.round(stakeMega * combined * 100) / 100} NOK.`,
      valueScore: Math.min(...megaLegs.map((l) => l.valueScore)),
      confidenceScore: Math.min(...megaLegs.map((l) => l.confidenceScore)),
    });
  }

  if (fourFoldLegs.length >= 4) {
    const combined = fourFoldLegs.reduce((p, l) => p * l.odds, 1);
    plannedBets.push({
      type: "accumulator",
      legs: fourFoldLegs,
      matchId: fourFoldLegs[0].matchId,
      market: "totals",
      matchLabel: fourFoldLegs.map((l) => l.matchLabel).join(" · "),
      selection: fourFoldLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stake4,
      potentialReturnNok: Math.round(stake4 * combined * 100) / 100,
      reason: `4-fold (Over 2.5 / BTTS Ja), 15% av budsjettet. Potensiell retur ved treff: ${Math.round(stake4 * combined * 100) / 100} NOK.`,
      valueScore: Math.min(...fourFoldLegs.map((l) => l.valueScore)),
      confidenceScore: Math.min(...fourFoldLegs.map((l) => l.confidenceScore)),
    });
  }

  if (threeFoldLegs.length >= 3) {
    const combined = threeFoldLegs.reduce((p, l) => p * l.odds, 1);
    plannedBets.push({
      type: "accumulator",
      legs: threeFoldLegs,
      matchId: threeFoldLegs[0].matchId,
      market: "totals",
      matchLabel: threeFoldLegs.map((l) => l.matchLabel).join(" · "),
      selection: threeFoldLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
      odds: Math.round(combined * 100) / 100,
      stakeNok: stake3,
      potentialReturnNok: Math.round(stake3 * combined * 100) / 100,
      reason: `3-fold (Over 2.5 / BTTS Ja), 15% av budsjettet. Potensiell retur ved treff: ${Math.round(stake3 * combined * 100) / 100} NOK.`,
      valueScore: Math.min(...threeFoldLegs.map((l) => l.valueScore)),
      confidenceScore: Math.min(...threeFoldLegs.map((l) => l.confidenceScore)),
    });
  }

  if (single1) {
    plannedBets.push({
      type: "single",
      matchId: single1.matchId,
      market: single1.market,
      matchLabel: single1.matchLabel,
      selection: `${single1.matchLabel}: ${single1.selection}`,
      odds: single1.odds,
      stakeNok: stakeSingle,
      potentialReturnNok: Math.round(stakeSingle * single1.odds * 100) / 100,
      reason: `Enkeltspill (høyest odds, Over/BTTS), 25% av budsjettet. Potensiell retur: ${Math.round(stakeSingle * single1.odds * 100) / 100} NOK.`,
      valueScore: single1.valueScore,
      confidenceScore: single1.confidenceScore,
    });
  }

  if (single2) {
    plannedBets.push({
      type: "single",
      matchId: single2.matchId,
      market: single2.market,
      matchLabel: single2.matchLabel,
      selection: `${single2.matchLabel}: ${single2.selection}`,
      odds: single2.odds,
      stakeNok: stakeSingle,
      potentialReturnNok: Math.round(stakeSingle * single2.odds * 100) / 100,
      reason: `Enkeltspill (nest høyest odds, Over/BTTS), 25% av budsjettet. Potensiell retur: ${Math.round(stakeSingle * single2.odds * 100) / 100} NOK.`,
      valueScore: single2.valueScore,
      confidenceScore: single2.confidenceScore,
    });
  }

  if (plannedBets.length === 0 && megaLegs.length >= 1) {
    if (megaLegs.length >= 3) {
      const legs = megaLegs.slice(0, 3);
      const combined = legs.reduce((p, l) => p * l.odds, 1);
      plannedBets.push({
        type: "accumulator",
        legs,
        matchId: legs[0].matchId,
        market: "totals",
        matchLabel: legs.map((l) => l.matchLabel).join(" · "),
        selection: legs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combined * 100) / 100,
        stakeNok: Math.round(budget * 0.5),
        potentialReturnNok: Math.round(Math.round(budget * 0.5) * combined * 100) / 100,
        reason: `3-fold (høy risiko, få anbefalinger), 50% av budsjettet.`,
        valueScore: Math.min(...legs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...legs.map((l) => l.confidenceScore)),
      });
    }
    if (megaLegs.length >= 2 && megaLegs.length < 3) {
      const legs = megaLegs.slice(0, 2);
      const combined = legs[0].odds * legs[1].odds;
      plannedBets.push({
        type: "accumulator",
        legs,
        matchId: legs[0].matchId,
        market: "totals",
        matchLabel: legs.map((l) => l.matchLabel).join(" · "),
        selection: legs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combined * 100) / 100,
        stakeNok: Math.round(budget * 0.5),
        potentialReturnNok: Math.round(Math.round(budget * 0.5) * combined * 100) / 100,
        reason: `2-fold (høy risiko, få anbefalinger), 50% av budsjettet.`,
        valueScore: Math.min(...legs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...legs.map((l) => l.confidenceScore)),
      });
    }
    if (megaLegs.length === 1) {
      const rec = megaLegs[0];
      plannedBets.push({
        type: "single",
        matchId: rec.matchId,
        market: rec.market,
        matchLabel: rec.matchLabel,
        selection: `${rec.matchLabel}: ${rec.selection}`,
        odds: rec.odds,
        stakeNok: budget,
        potentialReturnNok: Math.round(budget * rec.odds * 100) / 100,
        reason: `Enkeltspill (høy risiko, én anbefaling), 100% av budsjettet.`,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      });
    }
  }

  if (plannedBets.length === 0 && recommendations.length > 0) {
    const best = [...recommendations].sort((a, b) => b.odds - a.odds)[0];
    plannedBets.push({
      type: "single",
      matchId: best.matchId,
      market: best.market,
      matchLabel: best.matchLabel,
      selection: `${best.matchLabel}: ${best.selection}`,
      odds: best.odds,
      stakeNok: budget,
      potentialReturnNok: Math.round(budget * best.odds * 100) / 100,
      reason: `Enkeltspill (høy risiko, bruker beste tilgjengelige anbefaling), 100% av budsjettet.`,
      valueScore: best.valueScore,
      confidenceScore: best.confidenceScore,
    });
  }

  const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
  const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
  const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
  return {
    plannedBets: normalized,
    totalStaked,
    totalPotentialReturn: Math.round(totalReturn * 100) / 100,
    summaryReason: `Høy risiko: 1 mega (5 kamper, 20%) + 1 four-fold (15%) + 1 three-fold (15%) + 2 enkeltspill (25% hver). Kun Over 2.5/3.5 og BTTS Ja. Total potensiell retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
  };
}
