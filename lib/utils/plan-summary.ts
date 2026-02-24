import type { WeeklyBettingPlan, PlannedBet, RiskProfile } from "@/lib/types";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface PlanSummaryContent {
  /** 3–4 sentences in Norwegian */
  summaryText: string;
  confidence: ConfidenceLevel;
  /** Best single bet of the week (for "best bet" highlight) */
  bestBet: PlannedBet | null;
}

/**
 * Build the plain-language summary and best bet for the weekly plan.
 */
export function getPlanSummary(
  plan: WeeklyBettingPlan,
  riskProfile: RiskProfile
): PlanSummaryContent {
  const singles = plan.plannedBets.filter((b) => b.type === "single");
  const bestBet =
    singles.length > 0
      ? singles.reduce((a, b) => (b.odds > a.odds ? b : a))
      : null;

  // Confidence: more singles + lower risk = higher confidence
  let confidence: ConfidenceLevel = "medium";
  if (plan.plannedBets.length >= 4 && (riskProfile === "low" || riskProfile === "medium")) {
    confidence = "high";
  } else if (plan.plannedBets.length <= 2 || riskProfile === "high") {
    confidence = "low";
  }

  const riskText =
    riskProfile === "low"
      ? "Lav risiko betyr at vi holder oss til enkeltspill med lave odds for å begrense tap."
      : riskProfile === "medium"
        ? "Middels risiko innebærer en blanding av trygge enkeltspill og én accumulator for å øke avkastningspotensialet."
        : "Høy risiko betyr flere accumulators og høyere odds – større mulig gevinst, men også større svingninger.";

  const summaryText = `Denne uken er valgene tatt ut fra oddsverdi, form og ligatrender. Vi har siktet på spill der oddsen ser gunstig ut sammenlignet med sannsynligheten vi vurderer, og tatt hensyn til ligatrender (f.eks. målrike eller defensivt innstilte lag). ${riskText} Ukens strategi er å spre innsatsen på flere spill slik at én feil ikke tar hele budsjettet, og å satse mer der vi ser best verdi.`;

  return {
    summaryText,
    confidence,
    bestBet,
  };
}
