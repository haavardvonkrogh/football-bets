import type { BetRecommendation, RiskProfile, WeeklyBettingPlan, PlannedBet } from "@/lib/types";

/** Target total potential return as multiplier of weekly budget (min–max). */
const RETURN_MULTIPLIERS: Record<RiskProfile, { min: number; max: number }> = {
  low: { min: 1.2, max: 1.8 },
  medium: { min: 3, max: 6 },
  high: { min: 10, max: 30 },
  extreme: { min: 50, max: 100 },
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
 * - Low: 1.2x–1.8x (singles, odds 1.2–1.8)
 * - Medium: 3x–6x (2–3 fold accumulators, odds 1.8–2.5 per leg)
 * - High: 10x–30x (3–4 fold accas + 1 single, odds 2.0–2.8 per leg)
 * - Extreme: 50x–100x (mega 5–6 legs, value 6+, confidence 35%+, odds ≥2.20; prefer Over 3.5/4.5, BTTS Yes; AH only if confidence >40%)
 * Stakes are % of budget; odds targets and leg counts hit these return ranges.
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
    // Target 3x–6x budget. 2–3 fold accumulators only, odds 1.8–2.5 per leg. 50% on 2-fold, 50% on 3-fold.
    const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.medium;
    const legOddsMin = 1.8;
    const legOddsMax = 2.5;
    const pool = recommendations.filter((r) => r.odds >= legOddsMin && r.odds <= legOddsMax);
    const used = new Set<number>();
    const take = (n: number): BetRecommendation[] => {
      const out: BetRecommendation[] = [];
      for (const r of pool) {
        if (used.has(r.matchId)) continue;
        out.push(r);
        used.add(r.matchId);
        if (out.length >= n) break;
      }
      return out;
    };
    const twoFoldLegs = take(2);
    const threeFoldLegs = take(3);
    const stake2 = Math.round(budget * 0.5);
    const stake3 = Math.round(budget * 0.5);
    if (twoFoldLegs.length >= 2) {
      const combined = twoFoldLegs[0].odds * twoFoldLegs[1].odds;
      plannedBets.push({
        type: "accumulator",
        legs: twoFoldLegs,
        matchId: twoFoldLegs[0].matchId,
        market: "totals",
        matchLabel: twoFoldLegs.map((l) => l.matchLabel).join(" · "),
        selection: twoFoldLegs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combined * 100) / 100,
        stakeNok: stake2,
        potentialReturnNok: Math.round(stake2 * combined * 100) / 100,
        reason: `2-fold akkumulator, 50% av budsjettet, odds ${legOddsMin}–${legOddsMax} per kamp.`,
        valueScore: Math.min(...twoFoldLegs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...twoFoldLegs.map((l) => l.confidenceScore)),
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
        reason: `3-fold akkumulator, 50% av budsjettet, odds ${legOddsMin}–${legOddsMax} per kamp.`,
        valueScore: Math.min(...threeFoldLegs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...threeFoldLegs.map((l) => l.confidenceScore)),
      });
    }
    if (plannedBets.length === 0 && pool.length >= 2) {
      const legs = pool.slice(0, 2);
      const combined = legs[0].odds * legs[1].odds;
      plannedBets.push({
        type: "accumulator",
        legs,
        matchId: legs[0].matchId,
        market: "totals",
        matchLabel: legs.map((l) => l.matchLabel).join(" · "),
        selection: legs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combined * 100) / 100,
        stakeNok: budget,
        potentialReturnNok: Math.round(budget * combined * 100) / 100,
        reason: `2-fold (middels risiko, få anbefalinger), 100% av budsjettet.`,
        valueScore: Math.min(...legs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...legs.map((l) => l.confidenceScore)),
      });
    }
    if (plannedBets.length === 0 && pool.length === 1) {
      const rec = pool[0];
      plannedBets.push({
        type: "single",
        matchId: rec.matchId,
        market: rec.market,
        matchLabel: rec.matchLabel,
        selection: `${rec.matchLabel}: ${rec.selection}`,
        odds: rec.odds,
        stakeNok: budget,
        potentialReturnNok: Math.round(budget * rec.odds * 100) / 100,
        reason: `Enkeltspill (middels risiko, én anbefaling i området), 100% av budsjettet.`,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      });
    }
    if (plannedBets.length === 0) return null;
    const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
    const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
    const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
    const targetMin = Math.round(budget * minMult);
    const targetMax = Math.round(budget * maxMult);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Middels risiko: 2–3 fold akkumulatorer (odds ${legOddsMin}–${legOddsMax} per kamp). Mål total retur: ${targetMin}–${targetMax} NOK. Total mulig retur: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  if (riskProfile === "high") {
    // Target 10x–30x budget. Max 4 legs per accumulator. Strict odds 2.0–2.8 per leg only.
    const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.high;
    const legOddsMin = 2.0;
    const legOddsMax = 2.8;
    const pool = recommendations.filter((r) => r.odds >= legOddsMin && r.odds <= legOddsMax);
    // High never uses more than 4 legs in any acca
    const used = new Set<number>();
    const take = (n: number): BetRecommendation[] => {
      const out: BetRecommendation[] = [];
      for (const r of pool) {
        if (used.has(r.matchId)) continue;
        out.push(r);
        used.add(r.matchId);
        if (out.length >= n) break;
      }
      return out;
    };
    const fourFoldLegs = take(4);
    const threeFoldLegs = take(3);
    const singleRec = take(1)[0];
    const stake4 = Math.round(budget * 0.35);
    const stake3 = Math.round(budget * 0.35);
    const stakeSingle = Math.round(budget * 0.3);
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
        reason: `4-fold, 35% av budsjettet, odds ${legOddsMin}–${legOddsMax} per kamp.`,
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
        reason: `3-fold, 35% av budsjettet, odds ${legOddsMin}–${legOddsMax} per kamp.`,
        valueScore: Math.min(...threeFoldLegs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...threeFoldLegs.map((l) => l.confidenceScore)),
      });
    }
    if (singleRec) {
      plannedBets.push({
        type: "single",
        matchId: singleRec.matchId,
        market: singleRec.market,
        matchLabel: singleRec.matchLabel,
        selection: `${singleRec.matchLabel}: ${singleRec.selection}`,
        odds: singleRec.odds,
        stakeNok: stakeSingle,
        potentialReturnNok: Math.round(stakeSingle * singleRec.odds * 100) / 100,
        reason: `Enkeltspill, 30% av budsjettet, odds ${legOddsMin}–${legOddsMax}.`,
        valueScore: singleRec.valueScore,
        confidenceScore: singleRec.confidenceScore,
      });
    }
    if (plannedBets.length === 0 && pool.length >= 3) {
      const legs = pool.slice(0, 3);
      const combined = legs.reduce((p, l) => p * l.odds, 1);
      plannedBets.push({
        type: "accumulator",
        legs,
        matchId: legs[0].matchId,
        market: "totals",
        matchLabel: legs.map((l) => l.matchLabel).join(" · "),
        selection: legs.map((l, i) => `Kamp ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · "),
        odds: Math.round(combined * 100) / 100,
        stakeNok: budget,
        potentialReturnNok: Math.round(budget * combined * 100) / 100,
        reason: `3-fold (høy risiko, få anbefalinger), 100% av budsjettet.`,
        valueScore: Math.min(...legs.map((l) => l.valueScore)),
        confidenceScore: Math.min(...legs.map((l) => l.confidenceScore)),
      });
    }
    if (plannedBets.length === 0 && recommendations.length > 0) {
      const best = [...recommendations].filter((r) => r.odds >= legOddsMin && r.odds <= legOddsMax).sort((a, b) => b.odds - a.odds)[0]
        ?? [...recommendations].sort((a, b) => b.odds - a.odds)[0];
      plannedBets.push({
        type: "single",
        matchId: best.matchId,
        market: best.market,
        matchLabel: best.matchLabel,
        selection: `${best.matchLabel}: ${best.selection}`,
        odds: best.odds,
        stakeNok: budget,
        potentialReturnNok: Math.round(budget * best.odds * 100) / 100,
        reason: `Enkeltspill (høy risiko, beste tilgjengelige), 100% av budsjettet.`,
        valueScore: best.valueScore,
        confidenceScore: best.confidenceScore,
      });
    }
    if (plannedBets.length === 0) return null;
    const normalized = sortByValueScore(normalizeStakesToBudget(plannedBets, budget));
    const totalStaked = normalized.reduce((s, b) => s + b.stakeNok, 0);
    const totalReturn = normalized.reduce((s, b) => s + b.potentialReturnNok, 0);
    const targetMin = Math.round(budget * minMult);
    const targetMax = Math.round(budget * maxMult);
    return {
      plannedBets: normalized,
      totalStaked,
      totalPotentialReturn: Math.round(totalReturn * 100) / 100,
      summaryReason: `Høy risiko: 3–4 fold akkumulatorer + 1 enkeltspill (odds ${legOddsMin}–${legOddsMax} per kamp). Mål total retur: ${targetMin}–${targetMax} NOK. Total potensiell retur: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  // Extreme: target 50x–100x. Value 6+ and confidence 35%+ only; AH underdogs only if confidence >40%.
  // Min odds 2.20 per leg. Prioritize Over 3.5/4.5, then BTTS Yes, then others. 5–6 legs in mega.
  if (riskProfile === "extreme") {
    const { min: minMult, max: maxMult } = RETURN_MULTIPLIERS.extreme;
    const EXTREME_MIN_ODDS = 2.2;
    const MIN_VALUE_SCORE = 6;
    const MIN_CONFIDENCE = 35;
    const MIN_CONFIDENCE_ASIAN_HANDICAP = 40;

    const sel = (r: BetRecommendation) => r.selection.toLowerCase();
    const isOver35 = (r: BetRecommendation) => r.market === "totals" && sel(r).includes("over") && (sel(r).includes("3.5") || sel(r).includes("3,5"));
    const isOver45 = (r: BetRecommendation) => r.market === "totals" && sel(r).includes("over") && (sel(r).includes("4.5") || sel(r).includes("4,5"));
    const isBttsYes = (r: BetRecommendation) =>
      r.market === "btts" && (sel(r).includes("yes") || sel(r).includes("ja"));
    const isAsianHandicap = (r: BetRecommendation) => r.market === "spreads";

    const passesQuality = (r: BetRecommendation): boolean => {
      if ((r.valueScore ?? 0) < MIN_VALUE_SCORE || (r.confidenceScore ?? 0) < MIN_CONFIDENCE) return false;
      if (isAsianHandicap(r)) return (r.confidenceScore ?? 0) > MIN_CONFIDENCE_ASIAN_HANDICAP;
      return true;
    };

    const baseFiltered = recommendations.filter(
      (r) => r.odds >= EXTREME_MIN_ODDS && passesQuality(r)
    );
    const byValueThenConfidenceThenOdds = (a: BetRecommendation, b: BetRecommendation) =>
      (b.valueScore ?? 0) - (a.valueScore ?? 0) || (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) || b.odds - a.odds;

    const poolOver35_45 = baseFiltered.filter((r) => isOver35(r) || isOver45(r)).sort(byValueThenConfidenceThenOdds);
    const poolBttsYes = baseFiltered.filter((r) => isBttsYes(r)).sort(byValueThenConfidenceThenOdds);
    const poolOther = baseFiltered.filter(
      (r) => !isOver35(r) && !isOver45(r) && !isBttsYes(r)
    ).sort(byValueThenConfidenceThenOdds);

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
      let out = takeFrom(poolOver35_45, n);
      if (out.length < n) out = [...out, ...takeFrom(poolBttsYes, n - out.length)];
      if (out.length < n) out = [...out, ...takeFrom(poolOther, n - out.length)];
      return out;
    };

    const megaLegs = take(6); // 5 or 6 legs; each leg value 6+, confidence 35+, odds ≥2.20
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
        reason: `Mega-akkumulator (${megaLegs.length} kamper), 20% av budsjettet. Potensiell retur ved treff: ${Math.round(stakeMega * combined * 100) / 100} NOK.`,
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
        reason: `4-fold, 15% av budsjettet. Potensiell retur ved treff: ${Math.round(stake4 * combined * 100) / 100} NOK.`,
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
        reason: `3-fold, 15% av budsjettet. Potensiell retur ved treff: ${Math.round(stake3 * combined * 100) / 100} NOK.`,
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
        reason: `Enkeltspill, 25% av budsjettet. Potensiell retur: ${Math.round(stakeSingle * single1.odds * 100) / 100} NOK.`,
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
        reason: `Enkeltspill, 25% av budsjettet. Potensiell retur: ${Math.round(stakeSingle * single2.odds * 100) / 100} NOK.`,
        valueScore: single2.valueScore,
        confidenceScore: single2.confidenceScore,
      });
    }

    if (plannedBets.length === 0 && (megaLegs.length >= 1 || recommendations.length > 0)) {
      const legs = megaLegs.length >= 3 ? megaLegs.slice(0, 3) : megaLegs.length >= 2 ? megaLegs.slice(0, 2) : [];
      if (legs.length >= 2) {
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
          reason: `${legs.length}-fold (ekstrem risiko, få anbefalinger), 50% av budsjettet.`,
          valueScore: Math.min(...legs.map((l) => l.valueScore)),
          confidenceScore: Math.min(...legs.map((l) => l.confidenceScore)),
        });
      } else if (megaLegs.length === 1) {
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
          reason: `Enkeltspill (ekstrem risiko, én anbefaling), 100% av budsjettet.`,
          valueScore: rec.valueScore,
          confidenceScore: rec.confidenceScore,
        });
      } else if (recommendations.length > 0) {
        const qualified = recommendations.filter((r) => r.odds >= EXTREME_MIN_ODDS && passesQuality(r));
        const best = (qualified.length > 0 ? qualified : recommendations).sort(byValueThenConfidenceThenOdds)[0];
        plannedBets.push({
          type: "single",
          matchId: best.matchId,
          market: best.market,
          matchLabel: best.matchLabel,
          selection: `${best.matchLabel}: ${best.selection}`,
          odds: best.odds,
          stakeNok: budget,
          potentialReturnNok: Math.round(budget * best.odds * 100) / 100,
          reason: `Enkeltspill (ekstrem risiko, beste tilgjengelige), 100% av budsjettet.`,
          valueScore: best.valueScore,
          confidenceScore: best.confidenceScore,
        });
      }
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
      summaryReason: `Ekstrem risiko: mega 5–6 kamper (verdi 6+, konfidens 35%+, odds ≥2,20 per kamp; prioriterer Over 3,5/4,5 og BTTS Ja). Mål total retur: ${targetMin}–${targetMax} NOK. Total potensiell retur ved alle treff: ${Math.round(totalReturn * 100) / 100} NOK.`,
    };
  }

  return null;
}
