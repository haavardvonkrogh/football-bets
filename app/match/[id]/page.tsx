"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { FootballDataMatch } from "@/lib/types";
import type { ResponseOdds } from "@/lib/types";
import type { StandingTableEntry } from "@/lib/types";
import { getStoredMatches, getStoredSettings } from "@/lib/utils/storage";
import { getRecommendations } from "@/lib/utils/recommendations";
import {
  getLast5Summary,
  formatLast5Results,
  generateBetAnalysis,
  type Last5Summary,
} from "@/lib/utils/match-analysis";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "short",
  });
}

function renderAnalysisText(text: string) {
  return text.split(/\n\n+/).map((para, i) => {
    const parts = para.split(/(\*\*[^*]+\*\*)/g).map((segment, j) => {
      if (segment.startsWith("**") && segment.endsWith("**")) {
        return <strong key={j}>{segment.slice(2, -2)}</strong>;
      }
      return segment;
    });
    return (
      <p key={i} className="mb-3 leading-relaxed last:mb-0">
        {parts}
      </p>
    );
  });
}

export default function MatchPreviewPage() {
  const params = useParams();
  const [matchId, setMatchId] = useState<number | null>(null);
  const [data, setData] = useState<{
    match: {
      id: number;
      utcDate: string;
      status: string;
      matchday: number | null;
      venue?: string;
      competition: { id: number; name: string; code: string };
      homeTeam: { id: number; name: string; shortName: string | null; crest: string | null };
      awayTeam: { id: number; name: string; shortName: string | null; crest: string | null };
    };
    homeLast5: FootballDataMatch[];
    awayLast5: FootballDataMatch[];
    standings: { home?: StandingTableEntry | null; away?: StandingTableEntry | null };
    head2head: { aggregates?: unknown; matches: FootballDataMatch[] } | null;
  } | null>(null);
  const [odds, setOdds] = useState<ResponseOdds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAgreesWithRecommendation, setAiAgreesWithRecommendation] = useState<boolean | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const id = params?.id;
    if (typeof id === "string") setMatchId(parseInt(id, 10));
  }, [params?.id]);

  const load = useCallback(async () => {
    if (matchId == null || !Number.isFinite(matchId)) return;
    setLoading(true);
    setError(null);
    try {
      const [res, storedMatches] = await Promise.all([
        fetch(`/api/match/${matchId}`),
        Promise.resolve(getStoredMatches()),
      ]);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      const withOdds = storedMatches.find((m) => m.id === matchId);
      setOdds(withOdds?.odds ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke laste kamp");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  const CACHE_KEY_PREFIX = "ai-analysis:";
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  const loadAiAnalysis = useCallback(async () => {
    if (matchId == null || !data?.match) return;
    const cacheKey = `${CACHE_KEY_PREFIX}${matchId}`;
    try {
      const cached = typeof localStorage !== "undefined" ? localStorage.getItem(cacheKey) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as {
          text: string;
          fetchedAt: number;
          agreesWithRecommendation?: boolean;
        };
        if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) {
          setAiAnalysis(parsed.text);
          setAiAgreesWithRecommendation(parsed.agreesWithRecommendation ?? true);
          setAiError(null);
          return;
        }
      }
      setAiLoading(true);
      setAiError(null);
      const storedMatches = getStoredMatches();
      const settings = getStoredSettings();
      const allRecs = getRecommendations(storedMatches, settings.riskProfile);
      const matchRecs = allRecs.filter((r) => r.matchId === matchId).map((r) => ({
        market: r.market,
        selection: r.selection,
        odds: r.odds,
        valueScore: r.valueScore,
        confidenceScore: r.confidenceScore,
      }));
      const res = await fetch(`/api/match/${matchId}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match: {
            homeTeam: data.match.homeTeam,
            awayTeam: data.match.awayTeam,
            competition: data.match.competition,
            utcDate: data.match.utcDate,
          },
          odds: odds ?? undefined,
          recommendations: matchRecs.length ? matchRecs : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        analysis: string;
        agreesWithRecommendation?: boolean;
      };
      setAiAnalysis(json.analysis);
      setAiAgreesWithRecommendation(json.agreesWithRecommendation ?? true);
      setAiError(null);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            text: json.analysis,
            fetchedAt: Date.now(),
            agreesWithRecommendation: json.agreesWithRecommendation ?? true,
          })
        );
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Kunne ikke laste AI-analyse");
      setAiAnalysis(null);
    } finally {
      setAiLoading(false);
    }
  }, [matchId, data?.match, odds]);

  useEffect(() => {
    if (data?.match && !aiLoading && aiAnalysis === null && aiError === null) {
      loadAiAnalysis();
    }
  }, [data?.match, aiLoading, aiAnalysis, aiError, loadAiAnalysis]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] flex items-center justify-center">
        <p className="text-[var(--muted)]">Laster kamp…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-[var(--value-high-risk)]">{error}</p>
        <Link href="/" className="text-[var(--accent)] hover:underline">Tilbake til oversikten</Link>
      </div>
    );
  }

  if (!data) return null;

  const { match, homeLast5, awayLast5, standings, head2head } = data;
  const homeSummary: Last5Summary = getLast5Summary(homeLast5, match.homeTeam.id);
  const awaySummary: Last5Summary = getLast5Summary(awayLast5, match.awayTeam.id);
  const homeResults = formatLast5Results(homeLast5, match.homeTeam.id);
  const awayResults = formatLast5Results(awayLast5, match.awayTeam.id);
  const analysisText = generateBetAnalysis({
    homeName: match.homeTeam.name,
    awayName: match.awayTeam.name,
    homeLast5: homeSummary,
    awayLast5: awaySummary,
    homeStanding: standings.home,
    awayStanding: standings.away,
    h2hMatches: head2head?.matches ?? [],
    homeTeamId: match.homeTeam.id,
    awayTeamId: match.awayTeam.id,
    odds: odds ?? undefined,
  });

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <header className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--bg)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-sm font-medium text-[var(--muted)] transition duration-200 hover:text-[var(--accent)]">
            ← Tilbake til oversikten
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* 1. Match header */}
        <section className="glass-card mb-6 overflow-hidden">
          <div className="border-b border-[var(--card-border)] bg-gradient-to-r from-[var(--accent)]/10 to-[var(--accent-secondary)]/10 p-6">
            <p className="mb-1 text-sm font-medium text-[var(--muted)]">{match.competition.name}</p>
            <p className="text-sm text-[var(--muted)]">
              {formatDate(match.utcDate)}
              {match.venue ? ` · ${match.venue}` : ""}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-8">
              <div className="flex flex-col items-center gap-2">
                {match.homeTeam.crest && (
                  <img src={match.homeTeam.crest} alt="" className="h-16 w-16 object-contain" />
                )}
                <span className="font-bold text-white">{match.homeTeam.shortName ?? match.homeTeam.name}</span>
              </div>
              <span className="text-2xl font-bold text-[var(--muted)]">vs</span>
              <div className="flex flex-col items-center gap-2">
                {match.awayTeam.crest && (
                  <img src={match.awayTeam.crest} alt="" className="h-16 w-16 object-contain" />
                )}
                <span className="font-bold text-white">{match.awayTeam.shortName ?? match.awayTeam.name}</span>
              </div>
            </div>
          </div>
          {/* Current odds */}
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4 backdrop-blur-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">BTTS</h3>
              {odds?.btts ? (
                <p className="text-lg font-bold text-[var(--accent)]">
                  Ja @ {odds.btts.yes.toFixed(2)} / Nei @ {odds.btts.no.toFixed(2)}
                </p>
              ) : (
                <p className="text-[var(--muted)]">–</p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4 backdrop-blur-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Over/Under</h3>
              {odds?.overUnder && odds.overUnder.length > 0 ? (
                <div className="space-y-1 text-sm">
                  {odds.overUnder.slice(0, 3).map((row) => (
                    <p key={row.line} className="font-medium">
                      <span className="text-[var(--muted)]">{row.line}:</span> O <span className="font-bold text-[var(--accent)]">{row.over.toFixed(2)}</span> / U <span className="font-bold text-[var(--accent)]">{row.under.toFixed(2)}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--muted)]">–</p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4 backdrop-blur-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Asian Handicap</h3>
              {odds?.asianHandicap?.length ? (
                <div className="space-y-1 text-sm">
                  {odds.asianHandicap.map(({ home, away }, i) => (
                    <p key={i} className="font-medium">
                      {home.line > 0 ? "+" : ""}{home.line} <span className="font-bold text-[var(--accent)]">{home.odds.toFixed(2)}</span> / <span className="font-bold text-[var(--accent)]">{away.odds.toFixed(2)}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--muted)]">–</p>
              )}
            </div>
          </div>
        </section>

        {/* 2. Team stats */}
        <section className="glass-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Siste 5 kamper</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                {match.homeTeam.crest && <img src={match.homeTeam.crest} alt="" className="h-8 w-8 object-contain" />}
                <span className="font-semibold text-white">{match.homeTeam.shortName ?? match.homeTeam.name}</span>
              </div>
              <div className="mb-2 flex gap-1">
                {homeResults.map((r, i) => (
                  <span
                    key={i}
                    className={`flex h-8 w-8 items-center justify-center rounded text-sm font-bold ${
                      r === "W" ? "bg-[var(--value-good)]/30 text-[var(--value-good)]" : r === "L" ? "bg-[var(--value-high-risk)]/30 text-[var(--value-high-risk)]" : "bg-[var(--value-medium)]/30 text-[var(--value-medium)]"
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </div>
              <p className="text-sm text-[var(--muted)]">
                {homeSummary.goalsFor} mål scoret, {homeSummary.goalsAgainst} innsluppet
              </p>
              {standings.home && (
                <p className="mt-2 text-sm text-white">
                  {standings.home.position}. plass · {standings.home.points} poeng
                </p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                {match.awayTeam.crest && <img src={match.awayTeam.crest} alt="" className="h-8 w-8 object-contain" />}
                <span className="font-semibold text-white">{match.awayTeam.shortName ?? match.awayTeam.name}</span>
              </div>
              <div className="mb-2 flex gap-1">
                {awayResults.map((r, i) => (
                  <span
                    key={i}
                    className={`flex h-8 w-8 items-center justify-center rounded text-sm font-bold ${
                      r === "W" ? "bg-[var(--value-good)]/30 text-[var(--value-good)]" : r === "L" ? "bg-[var(--value-high-risk)]/30 text-[var(--value-high-risk)]" : "bg-[var(--value-medium)]/30 text-[var(--value-medium)]"
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </div>
              <p className="text-sm text-[var(--muted)]">
                {awaySummary.goalsFor} mål scoret, {awaySummary.goalsAgainst} innsluppet
              </p>
              {standings.away && (
                <p className="mt-2 text-sm text-white">
                  {standings.away.position}. plass · {standings.away.points} poeng
                </p>
              )}
            </div>
          </div>
        </section>

        {/* 3. Head to head */}
        <section className="glass-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Siste møter</h2>
          {head2head?.matches?.length ? (
            <ul className="space-y-2">
              {head2head.matches.slice(0, 5).map((m) => {
                const h = m.score?.fullTime?.home ?? 0;
                const a = m.score?.fullTime?.away ?? 0;
                const homeName = m.homeTeam.shortName ?? m.homeTeam.name;
                const awayName = m.awayTeam.shortName ?? m.awayTeam.name;
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--bg)]/80 px-3 py-2 text-sm">
                    <span className="text-white">{homeName} – {awayName}</span>
                    <span className="font-mono font-bold text-white">{h} – {a}</span>
                    <span className="text-[var(--muted)]">{formatShortDate(m.utcDate)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">Ingen tidligere møter tilgjengelig.</p>
          )}
        </section>

        {/* 4. Bet analysis */}
        <section className="glass-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Spillanalyse</h2>
          <div className="prose prose-invert max-w-none text-[var(--fg)]">
            {renderAnalysisText(analysisText)}
          </div>
        </section>

        {/* 5. AI-analyse */}
        <section className="relative rounded-2xl border border-[var(--card-border)] p-[2px] bg-gradient-to-br from-[var(--accent-secondary)] via-[#6366f1] to-[var(--accent)] shadow-[0_0_24px_-8px_rgba(124,58,237,0.3)]">
          <div className="relative overflow-hidden rounded-[14px] bg-[var(--glass)] p-5 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-secondary)]/5 via-transparent to-[var(--accent)]/5 pointer-events-none" />
            <div className="relative">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent)] text-xs font-bold text-white">
                AI
              </span>
              AI-analyse
            </h2>
            {aiLoading && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-[var(--muted)]">
                <svg
                  className="h-10 w-10 animate-spin text-[var(--accent-secondary)]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <p className="text-sm">Genererer AI-analyse…</p>
              </div>
            )}
            {!aiLoading && aiError && (
              <p className="py-4 text-sm text-[var(--value-high-risk)]">{aiError}</p>
            )}
            {!aiLoading && aiAnalysis && aiAgreesWithRecommendation === false && (
              <div className="mb-4 rounded-xl border border-[var(--value-high-risk)]/50 bg-[var(--value-high-risk)]/10 px-4 py-3 text-sm text-[var(--value-high-risk)]">
                ⚠️ AI-analysen er uenig med vår anbefaling — les analysen nøye før du spiller
              </div>
            )}
            {!aiLoading && aiAnalysis && (
              <div className="prose prose-invert max-w-none text-[var(--fg)]">
                {renderAnalysisText(aiAnalysis)}
              </div>
            )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
