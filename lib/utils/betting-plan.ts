import type { BetRecommendation, RiskProfile, WeeklyBettingPlan, PlannedBet } from "@/lib/types";

/** Target total potential return as multiplier of weekly budget (min–max). */
const RETURN_MULTIPLIERS: Record<RiskProfile, { min: number; max: number }> = {
  low: { min: 1.2, max: 1.8 },
  medium: { min: 3, max: 6 },
  high: { min: 10, max: 30 },
};

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
 * Total potential return scales with budget:
 * - Low: 1.2x–1.8x budget (e.g. 500 → 600–900 NOK)
 * - Medium: 3x–6x budget (e.g. 500 → 1500–3000 NOK)
 * - High: 10x–30x budget (e.g. 500 → 5000–15000 NOK)
 * Stakes are % of budget; odds targets and leg counts are chosen to hit these return ranges.
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
    // Target total return 1.2x–1.8x budget. With 3–4 singles at ~25% each, we need odds 1.2–1.8.
    const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.low;
    const inRange = recommendations.filter((r) => r.odds >= minMult && r.odds <= maxMult);
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
        reason: `Lav risiko: enkeltspill med odds ${minMult}–${maxMult}. Innsats ${pctPerBet}% av budsjettet.`,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      });
    }
    const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
    const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
    const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
    const targetMin = Math.round(budget * minMult);
    const targetMax = Math.round(budget * maxMult);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Lav risiko: ${normalized.length} enkeltspill, 10–15% av budsjettet per bet, odds ${minMult}–${maxMult}. Total mulig retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK (mål: ${targetMin}–${targetMax} NOK).`,
    };
  }

  if (riskProfile === "medium") {
    // Target total return 3x–6x budget. 4 singles (20% each) + 1 2-fold (20%). Need sum_singles*0.2 + acca*0.2 in [3,6] => sum_singles + acca in [15,30].
    const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.medium;
    const singleOddsMin = 1.9;
    const singleOddsMax = 2.7;
    const inRange = recommendations.filter((r) => r.odds >= singleOddsMin && r.odds <= singleOddsMax);
    const pool = inRange.length >= 4 ? inRange : recommendations;
    const singlePicks = pool.slice(0, 4);
    const usedMatchIds = new Set(singlePicks.map((r) => r.matchId));
    const accaPool = pool.filter((r) => !usedMatchIds.has(r.matchId));
    // Prefer 2-fold with combined odds in [6, 20] to land total in 3–6x
    let accaLegs: BetRecommendation[] = [];
    for (let i = 0; i < accaPool.length; i++) {
      for (let j = i + 1; j < accaPool.length; j++) {
        const a = accaPool[i];
        const b = accaPool[j];
        const product = a.odds * b.odds;
        if (product >= 6 && product <= 20) {
          accaLegs = [a, b];
          break;
        }
      }
      if (accaLegs.length >= 2) break;
    }
    if (accaLegs.length < 2 && accaPool.length >= 2) accaLegs = accaPool.slice(0, 2);
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
        reason: `Enkeltspill 15–25% av budsjettet, odds ${singleOddsMin}–${singleOddsMax}. Mulig retur: ${Math.round(stake * rec.odds * 100) / 100} NOK.`,
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
    const targetMin = Math.round(budget * minMult);
    const targetMax = Math.round(budget * maxMult);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Middels risiko: ${singlePicks.length} enkeltspill (15–25% per bet) + én 2-fold (20% av budsjettet). Mål total retur: ${targetMin}–${targetMax} NOK. Total mulig retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  // High risk: target total return 10x–30x budget. Mega (20%) + 4-fold (15%) + 3-fold (15%) + 2 singles (25% each).
  // Prefer acca legs with odds 2.0–3.2 so combined odds stay in range (e.g. 5-fold 32–335, 0.2*100 ≈ 20).
  const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.high;
  const sel = (r: BetRecommendation) => r.selection.toLowerCase();
  const isOver = (r: BetRecommendation) => r.market === "totals" && sel(r).includes("over");
  const isBttsYes = (r: BetRecommendation) =>
    r.market === "btts" && (sel(r).includes("yes") || sel(r).includes("ja"));
  const isOverOrBtts = (r: BetRecommendation) => isOver(r) || isBttsYes(r);

  const preferredPool = [...recommendations]
    .filter((r) => r.odds >= 2.0 && r.odds <= 3.2 && isOverOrBtts(r))
    .sort((a, b) => b.odds - a.odds);
  const fallbackPool = [...recommendations]
    .filter((r) => r.odds >= 2.0 && r.odds <= 4.0)
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
  const targetMin = Math.round(budget * minMult);
  const targetMax = Math.round(budget * maxMult);
  return {
    plannedBets: normalized,
    totalStaked,
    totalPotentialReturn: Math.round(totalReturn * 100) / 100,
    summaryReason: `Høy risiko: 1 mega (5 kamper, 20%) + 1 four-fold (15%) + 1 three-fold (15%) + 2 enkeltspill (25% hver). Mål total retur: ${targetMin}–${targetMax} NOK. Total potensiell retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
  };
}
