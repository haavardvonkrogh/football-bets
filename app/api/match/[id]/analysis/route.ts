/**
 * POST /api/match/[id]/analysis
 * Generates AI match preview using Anthropic Claude. Body: match summary + odds.
 */

import { NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;
const CACHE_HOURS = 12;

export interface MatchRecommendation {
  market: string;
  selection: string;
  odds: number;
  valueScore: number;
  confidenceScore: number;
}

export interface AnalysisRequestBody {
  match: {
    homeTeam: { name: string; shortName?: string | null };
    awayTeam: { name: string; shortName?: string | null };
    competition: { name: string };
    utcDate: string;
  };
  odds?: {
    btts?: { yes: number; no: number };
    overUnder?: Array<{ line: number; over: number; under: number }>;
    asianHandicap?: Array<{
      home: { line: number; odds: number };
      away: { line: number; odds: number };
    }>;
  };
  /** Our automated recommendations for this match; AI should support or explain disagreement */
  recommendations?: MatchRecommendation[];
}

function buildPrompt(body: AnalysisRequestBody): string {
  const { match, odds, recommendations } = body;
  const home = match.homeTeam.shortName ?? match.homeTeam.name;
  const away = match.awayTeam.shortName ?? match.awayTeam.name;
  const date = new Date(match.utcDate).toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let oddsBlock = "Ingen odds oppgitt.";
  if (odds) {
    const parts: string[] = [];
    if (odds.btts) {
      parts.push(`BTTS: Ja @ ${odds.btts.yes.toFixed(2)}, Nei @ ${odds.btts.no.toFixed(2)}`);
    }
    if (odds.overUnder?.length) {
      parts.push(
        "Over/Under: " +
          odds.overUnder.map((r) => `${r.line} mål – Over @ ${r.over.toFixed(2)}, Under @ ${r.under.toFixed(2)}`).join("; ")
      );
    }
    if (odds.asianHandicap?.length) {
      parts.push(
        "Asian Handicap: " +
          odds.asianHandicap
            .map(
              (a) =>
                `Hjemme ${a.home.line >= 0 ? "+" : ""}${a.home.line} @ ${a.home.odds.toFixed(2)}, Borte ${a.away.line >= 0 ? "+" : ""}${a.away.line} @ ${a.away.odds.toFixed(2)}`
            )
            .join("; ")
      );
    }
    oddsBlock = parts.join("\n");
  }

  let recommendationBlock = "";
  if (recommendations?.length) {
    recommendationBlock = `

**Vår systemanbefaling for denne kampen**
Vi har anbefalt følgende spill for denne kampen (basert på oddsverdi og konfidens):
${recommendations
  .map(
    (r) =>
      `- ${r.selection} @ ${r.odds.toFixed(2)} (markedstype: ${r.market}, verdiscore: ${r.valueScore}/10, konfidens: ${r.confidenceScore}%)`
  )
  .join("\n")}

**Viktig:** Din analyse skal enten støtte denne anbefalingen (forklar hvorfor den er fornuftig) eller tydelig forklare hvorfor du er uenig og hva du anbefaler i stedet. Avslutt analysen med nøyaktig én linje: <!-- AGREEMENT: yes --> hvis du støtter anbefalingen, eller <!-- AGREEMENT: no --> hvis du er uenig.
`;
  }

  return `Du er en erfaren fotballanalyseekspert. Skriv en kort, saklig kampanalyse på norsk for denne kampen.

**Kamp:** ${home} – ${away}
**Liga:** ${match.competition.name}
**Dato og tid:** ${date}

**Tilgjengelige odds:**
${oddsBlock}
${recommendationBlock}

Skriv analysen på norsk med disse fire delene (bruk overskrifter som vist):

**Forventninger til kampen**
(2–3 setninger om hva vi kan forvente: spillestil, form, viktige faktorer.)

**Hvilke markeder ser mest interessante ut og hvorfor**
(Vurder BTTS, Over/Under og/eller Asian Handicap ut fra oddsene og kampen. Forklar kort hvorfor noen markeder er mer interessante.)

**Anbefalt bet med begrunnelse**
(Velg ett konkret bet og gi odds og kort begrunnelse. Hvis du støtter vår anbefaling, bruk den; hvis ikke, forklar hva du anbefaler i stedet og hvorfor.)

**Risikovurdering**
(1–2 setninger om risiko ved anbefalingen og eventuelle forbehold.)

Hold analysen konsis og lesbar. Ikke bruk emojis.${recommendations?.length ? "\n\nAvslutt med nøyaktig én linje: <!-- AGREEMENT: yes --> eller <!-- AGREEMENT: no -->" : ""}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const { id } = await params;
  const matchId = parseInt(id, 10);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
  }

  let body: AnalysisRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.match?.homeTeam?.name || !body?.match?.awayTeam?.name) {
    return NextResponse.json(
      { error: "Body must include match.homeTeam and match.awayTeam" },
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
      console.error("[api/match/analysis] Anthropic error:", res.status, err);
      return NextResponse.json(
        { error: "AI analysis failed", details: err.slice(0, 200) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };
    const textBlock = data.content?.find((c) => c.type === "text");
    let analysis = textBlock?.text?.trim() ?? "";

    if (!analysis) {
      return NextResponse.json(
        { error: "Empty analysis from AI" },
        { status: 502 }
      );
    }

    const agreementMatch = analysis.match(/\s*<!--\s*AGREEMENT:\s*(yes|no)\s*-->\s*$/im);
    let agreesWithRecommendation = true;
    if (agreementMatch) {
      agreesWithRecommendation = agreementMatch[1].toLowerCase() === "yes";
      analysis = analysis.replace(/\s*<!--\s*AGREEMENT:\s*(yes|no)\s*-->\s*$/im, "").trim();
    }

    return NextResponse.json({
      analysis,
      agreesWithRecommendation: body.recommendations?.length ? agreesWithRecommendation : true,
      cachedUntil: new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000).toISOString(),
    });
  } catch (e) {
    console.error("[api/match/analysis]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis request failed" },
      { status: 500 }
    );
  }
}
