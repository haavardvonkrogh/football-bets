"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { FootballDataMatch } from "@/lib/types";
import type { ResponseOdds } from "@/lib/types";
import type { StandingTableEntry } from "@/lib/types";
import { getStoredMatches } from "@/lib/utils/storage";
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
        <Link href="/" className="text-[#14b8a6] hover:underline">Tilbake til oversikten</Link>
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
      <header className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-sm font-medium text-[var(--muted)] hover:text-white transition">
            ← Tilbake til oversikten
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* 1. Match header */}
        <section className="glass-card mb-6 overflow-hidden">
          <div className="border-b border-[var(--card-border)] bg-gradient-to-r from-[#14b8a6]/10 to-[#8b5cf6]/10 p-6">
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
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">BTTS</h3>
              {odds?.btts ? (
                <p className="text-lg font-bold text-white">
                  Ja @ {odds.btts.yes.toFixed(2)} / Nei @ {odds.btts.no.toFixed(2)}
                </p>
              ) : (
                <p className="text-[var(--muted)]">–</p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Over/Under</h3>
              {odds?.overUnder && odds.overUnder.length > 0 ? (
                <div className="space-y-1 text-sm">
                  {odds.overUnder.slice(0, 3).map((row) => (
                    <p key={row.line} className="font-medium text-white">
                      {row.line}: O {row.over.toFixed(2)} / U {row.under.toFixed(2)}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--muted)]">–</p>
              )}
            </div>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Asian Handicap</h3>
              {odds?.asianHandicap?.length ? (
                <div className="space-y-1 text-sm">
                  {odds.asianHandicap.map(({ home, away }, i) => (
                    <p key={i} className="font-medium text-white">
                      {home.line > 0 ? "+" : ""}{home.line} @ {home.odds.toFixed(2)} / {away.odds.toFixed(2)}
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
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
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
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
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
        <section className="glass-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Spillanalyse</h2>
          <div className="prose prose-invert max-w-none text-[var(--fg)]">
            {renderAnalysisText(analysisText)}
          </div>
        </section>
      </main>
    </div>
  );
}
