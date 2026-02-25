/**
 * POST /api/plan/summary
 * Generates a 3–4 sentence AI summary of the weekly betting plan using Claude.
 */

import { NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 512;

interface PlannedBetPayload {
  type: "single" | "accumulator";
  selection: string;
  odds: number;
  stakeNok: number;
  potentialReturnNok: number;
  reason?: string;
  legs?: unknown[];
}

export interface PlanSummaryRequestBody {
  plan: {
    plannedBets: PlannedBetPayload[];
    totalStaked: number;
    totalPotentialReturn: number;
    summaryReason: string;
  };
  riskProfile: string;
  weeklyBudget: number;
}

function buildPrompt(body: PlanSummaryRequestBody): string {
  const { plan, riskProfile, weeklyBudget } = body;
  const betsText = plan.plannedBets
    .map(
      (b, i) =>
        `${i + 1}. ${b.selection} · Odds ${b.odds.toFixed(2)} · Innsats ${b.stakeNok} NOK · Mulig retur ${b.potentialReturnNok.toFixed(0)} NOK${b.type === "accumulator" ? " (akkumulator)" : ""}`
    )
    .join("\n");

  return `Du er en erfaren spillanalytiker. Basert på den ukentlige spilleplanen nedenfor, skriv en kort oppsummering på norsk (3–4 setninger). Bruk vanlig norsk og vær saklig.

**Spilleplan:**
- Risikoprofil: ${riskProfile}
- Ukentlig budsjett: ${weeklyBudget} NOK
- Total innsats denne uken: ${plan.totalStaked} NOK
- Total mulig retur ved alle treff: ${plan.totalPotentialReturn.toFixed(0)} NOK

**Spill i planen:**
${betsText}

**Systemets korte begrunnelse:** ${plan.summaryReason}

**Oppgaven din:** Skriv 3–4 setninger som dekker:
1. Hva slags uke dette er (defensiv, offensiv eller blandet) ut fra valgene i planen.
2. Hvorfor disse betene er valgt denne uken.
3. Hva man bør se etter i kampene for å vurdere om spillet er på vei mot treff.
4. En kort advarsel om risiko (tap, varians, at ingen garanti finnes).

Skriv kun oppsummeringen, ingen overskrifter eller punktlister. Ikke bruk emojis.`;
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: PlanSummaryRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.plan?.plannedBets?.length) {
    return NextResponse.json(
      { error: "Body must include plan with plannedBets" },
      { status: 400 }
    );
  }

  const prompt = buildPrompt(body);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[api/plan/summary] Anthropic error:", res.status, err);
      return NextResponse.json(
        { error: "AI summary failed", details: err.slice(0, 200) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const textBlock = data.content?.find((c) => c.type === "text");
    const summary = textBlock?.text?.trim() ?? "";

    if (!summary) {
      return NextResponse.json(
        { error: "Empty summary from AI" },
        { status: 502 }
      );
    }

    return NextResponse.json({ summary });
  } catch (e) {
    console.error("[api/plan/summary]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Summary request failed" },
      { status: 500 }
    );
  }
}
