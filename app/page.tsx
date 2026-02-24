"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import type { UpcomingMatch } from "@/lib/types";
import type { UserSettings, RiskProfile, WeeklyBettingPlan, PlannedBet, BetRecommendation } from "@/lib/types";
import {
  getStoredMatches,
  getStoredRefreshedAt,
  getStoredUsage,
  setStoredMatchesPayload,
  getStoredSettings,
  setStoredSettings,
  getWeekSummaries,
  setBetResult,
  addPlacedBet,
  getCurrentWeekKey,
  confirmWeeklyPlan,
  removeWeekFromResults,
  type StoredUsage,
} from "@/lib/utils/storage";
import { getRecommendations } from "@/lib/utils/recommendations";
import { getWeeklyBettingPlan } from "@/lib/utils/betting-plan";
import { getPlanSummary } from "@/lib/utils/plan-summary";
import { FOOTBALL_DATA_LEAGUES } from "@/lib/constants/leagues";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("nb-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNok(n: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function DashboardPage() {
  const [matches, setMatches] = useState<UpcomingMatch[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [usage, setUsage] = useState<StoredUsage | null>(null);
  const [settings, setSettings] = useState<UserSettings>(getStoredSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [weekSummaries, setWeekSummaries] = useState(getWeekSummaries());
  const [activeTab, setActiveTab] = useState<"matches" | "plan" | "results">("matches");
  const [planConfirmedMessage, setPlanConfirmedMessage] = useState(false);
  const [planEditMode, setPlanEditMode] = useState(false);
  const [planSource, setPlanSource] = useState<"computed" | "edited">("computed");
  const [draftPlan, setDraftPlan] = useState<WeeklyBettingPlan | null>(null);
  const [swapModal, setSwapModal] = useState<{ betIndex: number; legIndex?: number } | null>(null);
  const [editedPlan, setEditedPlan] = useState<WeeklyBettingPlan | null>(null);

  const loadFromStorage = useCallback(() => {
    setMatches(getStoredMatches());
    setRefreshedAt(getStoredRefreshedAt());
    setUsage(getStoredUsage());
    setSettings(getStoredSettings());
    setWeekSummaries(getWeekSummaries());
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/matches");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      const prevUsage = getStoredUsage();
      const nextUsage = {
        oddsApiRemaining: data.usage?.oddsApiRemaining ?? prevUsage?.oddsApiRemaining ?? null,
        oddsApiUsed: data.usage?.oddsApiUsed ?? prevUsage?.oddsApiUsed ?? null,
        updatedAt: new Date().toISOString(),
      };
      setStoredMatchesPayload({
        matches: data.matches ?? [],
        refreshedAt: new Date().toISOString(),
        usage: nextUsage,
      });
      loadFromStorage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, [loadFromStorage]);

  const handleSettingsChange = useCallback((next: Partial<UserSettings>) => {
    const nextSettings = { ...settings, ...next };
    setStoredSettings(nextSettings);
    setSettings(nextSettings);
    setPlanSource("computed");
    setEditedPlan(null);
    setPlanEditMode(false);
  }, [settings]);

  const leagues = ["all", ...FOOTBALL_DATA_LEAGUES.map((l) => l.name)];
  const filteredMatches =
    leagueFilter === "all"
      ? matches
      : matches.filter((m) => m.competition.name === leagueFilter);
  const recommendations = getRecommendations(filteredMatches, settings.riskProfile);
  const weeklyPlan = getWeeklyBettingPlan(
    recommendations,
    settings.weeklyBudget,
    settings.riskProfile
  );

  const displayPlan: WeeklyBettingPlan | null = planSource === "edited" && editedPlan ? editedPlan : weeklyPlan ?? null;

  const handleConfirmPlan = useCallback(() => {
    if (!displayPlan || displayPlan.plannedBets.length === 0) return;
    confirmWeeklyPlan(displayPlan);
    loadFromStorage();
    setActiveTab("results");
    setPlanConfirmedMessage(true);
    setTimeout(() => setPlanConfirmedMessage(false), 4000);
  }, [displayPlan, loadFromStorage]);

  const handleStartEditPlan = useCallback(() => {
    if (!displayPlan) return;
    setDraftPlan(JSON.parse(JSON.stringify(displayPlan)));
    setPlanEditMode(true);
  }, [displayPlan]);

  const handleSaveEditPlan = useCallback(() => {
    if (!draftPlan) return;
    setEditedPlan(JSON.parse(JSON.stringify(draftPlan)));
    setPlanEditMode(false);
    setDraftPlan(null);
    setSwapModal(null);
  }, [draftPlan]);

  const handleCancelEditPlan = useCallback(() => {
    setPlanEditMode(false);
    setDraftPlan(null);
    setSwapModal(null);
  }, []);

  const handleSwapSingle = useCallback((betIndex: number, rec: BetRecommendation) => {
    setDraftPlan((prev) => {
      if (!prev || !prev.plannedBets[betIndex] || prev.plannedBets[betIndex].type !== "single") return prev;
      const next = { ...prev, plannedBets: [...prev.plannedBets] };
      const stake = next.plannedBets[betIndex].stakeNok;
      next.plannedBets[betIndex] = {
        type: "single",
        matchId: rec.matchId,
        market: rec.market,
        matchLabel: rec.matchLabel,
        selection: `${rec.matchLabel}: ${rec.selection}`,
        odds: rec.odds,
        stakeNok: stake,
        potentialReturnNok: Math.round(stake * rec.odds * 100) / 100,
        reason: next.plannedBets[betIndex].reason,
        valueScore: rec.valueScore,
        confidenceScore: rec.confidenceScore,
      };
      next.totalStaked = next.plannedBets.reduce((s, b) => s + b.stakeNok, 0);
      next.totalPotentialReturn = next.plannedBets.reduce((s, b) => s + b.potentialReturnNok, 0);
      return next;
    });
    setSwapModal(null);
  }, []);

  const handleSwapAccaLeg = useCallback((betIndex: number, legIndex: number, rec: BetRecommendation) => {
    setDraftPlan((prev) => {
      if (!prev?.plannedBets[betIndex]?.legs) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as WeeklyBettingPlan;
      const bet = next.plannedBets[betIndex];
      if (bet.legs && legIndex >= 0 && legIndex < bet.legs.length) {
        bet.legs[legIndex] = rec;
        const combined = bet.legs.reduce((p, l) => p * l.odds, 1);
        bet.odds = Math.round(combined * 100) / 100;
        bet.potentialReturnNok = Math.round(bet.stakeNok * combined * 100) / 100;
        bet.selection = bet.legs.map((l, i) => `Leg ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · ");
        bet.matchLabel = bet.legs.map((l) => l.matchLabel).join(" · ");
        bet.valueScore = Math.min(...bet.legs.map((l) => l.valueScore));
        bet.confidenceScore = Math.min(...bet.legs.map((l) => l.confidenceScore));
      }
      next.totalPotentialReturn = next.plannedBets.reduce((s, b) => s + b.potentialReturnNok, 0);
      return next;
    });
    setSwapModal(null);
  }, []);

  const handleRemoveAccaLeg = useCallback((betIndex: number, legIndex: number) => {
    setDraftPlan((prev) => {
      if (!prev?.plannedBets[betIndex]?.legs) return prev;
      const legs = prev.plannedBets[betIndex].legs!;
      if (legs.length <= 2) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as WeeklyBettingPlan;
      next.plannedBets[betIndex].legs = legs.filter((_, i) => i !== legIndex);
      const bet = next.plannedBets[betIndex];
      const combined = bet.legs!.reduce((p, l) => p * l.odds, 1);
      bet.odds = Math.round(combined * 100) / 100;
      bet.potentialReturnNok = Math.round(bet.stakeNok * combined * 100) / 100;
      bet.selection = bet.legs!.map((l, i) => `Leg ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · ");
      bet.matchLabel = bet.legs!.map((l) => l.matchLabel).join(" · ");
      bet.valueScore = bet.legs!.length ? Math.min(...bet.legs!.map((l) => l.valueScore)) : undefined;
      bet.confidenceScore = bet.legs!.length ? Math.min(...bet.legs!.map((l) => l.confidenceScore)) : undefined;
      next.totalPotentialReturn = next.plannedBets.reduce((s, b) => s + b.potentialReturnNok, 0);
      return next;
    });
  }, []);

  const handleAddAccaLeg = useCallback((betIndex: number, rec: BetRecommendation) => {
    setDraftPlan((prev) => {
      if (!prev?.plannedBets[betIndex]?.legs) return prev;
      const legs = prev.plannedBets[betIndex].legs!;
      if (legs.length >= 6) return prev;
      const usedMatchIds = new Set(legs.map((l) => l.matchId));
      if (usedMatchIds.has(rec.matchId)) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as WeeklyBettingPlan;
      next.plannedBets[betIndex].legs = [...legs, rec];
      const bet = next.plannedBets[betIndex];
      const combined = bet.legs!.reduce((p, l) => p * l.odds, 1);
      bet.odds = Math.round(combined * 100) / 100;
      bet.potentialReturnNok = Math.round(bet.stakeNok * combined * 100) / 100;
      bet.selection = bet.legs!.map((l, i) => `Leg ${i + 1}: ${l.matchLabel} – ${l.selection}`).join(" · ");
      bet.matchLabel = bet.legs!.map((l) => l.matchLabel).join(" · ");
      bet.valueScore = Math.min(...bet.legs!.map((l) => l.valueScore));
      bet.confidenceScore = Math.min(...bet.legs!.map((l) => l.confidenceScore));
      next.totalPotentialReturn = next.plannedBets.reduce((s, b) => s + b.potentialReturnNok, 0);
      return next;
    });
    setSwapModal(null);
  }, []);

  const tabs = [
    { id: "matches" as const, label: "Kamper & Odds" },
    { id: "plan" as const, label: "Ukentlig spilleplan" },
    { id: "results" as const, label: "Resultater" },
  ];
  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Hero header */}
      <header className="hero-gradient-bg sticky top-0 z-10 border-b border-[var(--card-border)]">
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <h1 className="bg-gradient-to-r from-[#14b8a6] via-[#06b6d4] to-[#8b5cf6] bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            Football Betting Advisor
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            <APIUsage usage={usage} />
            <div className="flex flex-col items-end gap-0.5 text-sm">
              <span className={refreshedAt ? "text-white font-medium" : "text-[var(--muted)]"}>
                {refreshedAt
                  ? `Cache sist oppdatert: ${formatDate(refreshedAt)}`
                  : "Ingen cache – klikk «Oppdater data»"}
              </span>
              <span className="text-xs text-[var(--muted)]">
                Ny data hentes kun når du klikker «Oppdater data»
              </span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Oppdaterer…" : "Oppdater data"}
            </button>
          </div>
        </div>
        {error && (
          <div className="relative mx-auto max-w-6xl px-4 pb-2">
            <p className="text-sm text-[var(--value-high-risk)]">{error}</p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Ukens kamp - featured match */}
        {(() => {
          const bestRec =
            recommendations.length > 0
              ? recommendations.reduce((a, b) =>
                  a.valueScore + a.confidenceScore >= b.valueScore + b.confidenceScore ? a : b
                )
              : null;
          const featuredMatch = bestRec
            ? filteredMatches.find((m) => m.id === bestRec.matchId)
            : null;
          if (!featuredMatch || !bestRec) return null;
          const odds = featuredMatch.odds;
          const featuredReason =
            bestRec.market === "totals" && bestRec.selection.toLowerCase().includes("over")
              ? "Kampen har ukes beste verdi og konfidens på Over-markedet."
              : bestRec.market === "btts"
                ? "Kampen har ukes beste verdi og konfidens på BTTS-markedet."
                : bestRec.market === "spreads"
                  ? "Kampen har ukes beste verdi og konfidens på Asian handicap."
                  : "Kampen har ukes beste kombinasjon av verdiscore og konfidens.";
          return (
            <section className="relative mb-8 overflow-hidden rounded-2xl p-[2px] bg-gradient-to-r from-[#14b8a6] via-[#06b6d4] to-[#8b5cf6] shadow-[0_0_32px_-8px_rgba(20,184,166,0.4)]">
              <div className="rounded-[14px] bg-[var(--bg)]/95 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center gap-2">
                  <span className="rounded-lg bg-gradient-to-r from-[#14b8a6]/20 to-[#8b5cf6]/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#14b8a6]">
                    Ukens kamp
                  </span>
                  <span className="text-sm text-[var(--muted)]">{featuredMatch.competition.name}</span>
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-6">
                  <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
                    <div className="flex flex-col items-center gap-2">
                      {featuredMatch.homeTeam.crest && (
                        <img
                          src={featuredMatch.homeTeam.crest}
                          alt=""
                          className="h-14 w-14 object-contain sm:h-16 sm:w-16"
                        />
                      )}
                      <span className="text-center font-bold text-white sm:text-lg">
                        {featuredMatch.homeTeam.shortName ?? featuredMatch.homeTeam.name}
                      </span>
                    </div>
                    <span className="text-xl font-bold text-[var(--muted)]">vs</span>
                    <div className="flex flex-col items-center gap-2">
                      {featuredMatch.awayTeam.crest && (
                        <img
                          src={featuredMatch.awayTeam.crest}
                          alt=""
                          className="h-14 w-14 object-contain sm:h-16 sm:w-16"
                        />
                      )}
                      <span className="text-center font-bold text-white sm:text-lg">
                        {featuredMatch.awayTeam.shortName ?? featuredMatch.awayTeam.name}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="cursor-help text-xs font-semibold text-[var(--value-good)]" title="Verdiscore">
                      Verdi: {bestRec.valueScore}/10
                    </span>
                    <span className="cursor-help text-xs font-semibold text-[var(--value-medium)]" title="Konfidens">
                      Konfidens: {bestRec.confidenceScore}%
                    </span>
                    <Link
                      href={`/match/${featuredMatch.id}`}
                      className="rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
                    >
                      Se kamp
                    </Link>
                  </div>
                </div>
                <p className="mb-2 text-sm leading-relaxed text-[var(--fg)]">
                  {featuredReason}
                </p>
                <p className="mb-4 text-xs text-[var(--muted)]">
                  Beste spill: <span className="font-medium text-white">{bestRec.selection}</span> @ {bestRec.odds.toFixed(2)}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--glass)] p-3">
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">BTTS</h3>
                    {odds?.btts ? (
                      <p className="text-base font-bold text-white">
                        Ja @ {odds.btts.yes.toFixed(2)} / Nei @ {odds.btts.no.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">–</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--glass)] p-3">
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Over/Under</h3>
                    {odds?.overUnder && odds.overUnder.length > 0 ? (
                      <div className="space-y-1 text-sm">
                        {odds.overUnder.slice(0, 3).map((row) => (
                          <p key={row.line} className="font-medium text-white">
                            {row.line}: O {row.over.toFixed(2)} / U {row.under.toFixed(2)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">–</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-[var(--card-border)] bg-[var(--glass)] p-3">
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Asian Handicap</h3>
                    {odds?.asianHandicap?.length ? (
                      <div className="space-y-1 text-sm">
                        {odds.asianHandicap.slice(0, 2).map(({ home, away }, i) => (
                          <p key={i} className="font-medium text-white">
                            {home.line >= 0 ? "+" : ""}{home.line} @ {home.odds.toFixed(2)} / {away.odds.toFixed(2)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">–</p>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {formatDate(featuredMatch.utcDate)}
                </p>
              </div>
            </section>
          );
        })()}

        {/* Settings - glass card */}
        <section className="glass-card mb-6 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Innstillinger</h2>
          <div className="flex flex-wrap gap-8">
            <div>
              <label className="mb-1 block text-sm text-[var(--muted)]">Ukentlig budsjett (NOK)</label>
              <input
                type="number"
                min={0}
                step={50}
                value={settings.weeklyBudget}
                onChange={(e) =>
                  handleSettingsChange({
                    weeklyBudget: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-32 rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-white focus:border-[#14b8a6] focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--muted)]">Risikoprofil</label>
              <select
                value={settings.riskProfile}
                onChange={(e) =>
                  handleSettingsChange({
                    riskProfile: e.target.value as RiskProfile,
                  })
                }
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-white focus:border-[#14b8a6] focus:outline-none"
              >
                <option value="low">Lav</option>
                <option value="medium">Middels</option>
                <option value="high">Høy</option>
              </select>
            </div>
          </div>
        </section>

        {/* Tabs with underline indicator */}
        <div className="relative mb-6 flex border-b border-[var(--card-border)]">
          {tabs.map(({ id, label }, i) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex-1 px-4 py-3.5 text-sm font-medium transition hover:text-white ${
                activeTab === id ? "text-white" : "text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          ))}
          <span
            className="tab-indicator"
            style={{
              left: `${(100 * activeIndex) / tabs.length}%`,
              width: `${100 / tabs.length}%`,
            }}
          />
        </div>

        {/* Tab: Kamper & Odds */}
        {activeTab === "matches" && (
          <section className="glass-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-white">Kommende kamper</h2>
              <select
                value={leagueFilter}
                onChange={(e) => setLeagueFilter(e.target.value)}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2 text-sm text-white focus:border-[#14b8a6] focus:outline-none"
              >
                {leagues.map((l) => (
                  <option key={l} value={l}>
                    {l === "all" ? "Alle ligaer" : l}
                  </option>
                ))}
              </select>
            </div>
            {filteredMatches.length === 0 ? (
              <p className="py-8 text-center text-[var(--muted)]">
                {matches.length === 0
                  ? "Ingen kamper lastet. Klikk «Oppdater data» for å hente kamper og odds."
                  : "Ingen kamper i valgt liga."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
                      <th className="pb-3 pr-4 font-medium">Kamp</th>
                      <th className="pb-3 pr-4 font-medium">Liga</th>
                      <th className="pb-3 pr-4 font-medium">Dato</th>
                      <th className="pb-3 pr-4 font-medium">BTTS</th>
                      <th className="min-w-[180px] pb-3 pr-4 font-medium">Over/Under</th>
                      <th className="min-w-[200px] pb-3 pr-4 font-medium">Asian Handicap</th>
                      <th className="pb-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-[var(--card-border)] last:border-0 transition hover:bg-white/[0.03]"
                      >
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-3">
                            {m.homeTeam.crest && (
                              <img src={m.homeTeam.crest} alt="" className="h-6 w-6 object-contain" />
                            )}
                            <span className="font-medium text-white">
                              {m.homeTeam.shortName ?? m.homeTeam.name}
                            </span>
                            <span className="text-[var(--muted)]">–</span>
                            {m.awayTeam.crest && (
                              <img src={m.awayTeam.crest} alt="" className="h-6 w-6 object-contain" />
                            )}
                            <span className="font-medium text-white">
                              {m.awayTeam.shortName ?? m.awayTeam.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-[var(--muted)]">{m.competition.name}</td>
                        <td className="py-4 pr-4 text-[var(--muted)]">{formatDate(m.utcDate)}</td>
                        <td className="py-4 pr-4">
                          <OddsCell btts={m.odds?.btts} labels={{ yes: "Ja", no: "Nei" }} />
                        </td>
                        <td className="min-w-[180px] py-4 pr-4 align-top">
                          <TotalsCell overUnder={m.odds?.overUnder} />
                        </td>
                        <td className="min-w-[200px] py-4 align-top">
                          <SpreadsCell asianHandicap={m.odds?.asianHandicap} homeShort={m.homeTeam.shortName} awayShort={m.awayTeam.shortName} />
                        </td>
                        <td className="py-4">
                          <Link href={`/match/${m.id}`} className="text-sm font-medium text-[#14b8a6] hover:underline">
                            Se kamp
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab: Ukentlig spilleplan */}
        {activeTab === "plan" && (
          <>
        {/* Success message after confirming plan */}
        {planConfirmedMessage && (
          <div className="mb-6 rounded-xl border border-[var(--value-good)]/50 bg-[var(--value-good)]/20 p-4 text-center">
            <p className="font-semibold text-[var(--value-good)]">Ukens spilleplan er låst inn!</p>
            <p className="text-sm text-[var(--muted)]">Se Resultater-fanen for å registrere resultater.</p>
          </div>
        )}

        {/* Weekly summary - at top when we have a plan */}
        {displayPlan && displayPlan.plannedBets.length > 0 && (() => {
          const summary = getPlanSummary(displayPlan, settings.riskProfile);
          const confidenceLabel = summary.confidence === "high" ? "Høy" : summary.confidence === "medium" ? "Middels" : "Lav";
          const confidenceColor = summary.confidence === "high" ? "text-[var(--value-good)]" : summary.confidence === "medium" ? "text-[var(--value-medium)]" : "text-[var(--value-high-risk)]";
          return (
            <section className="glass-card mb-6 p-5">
              <h2 className="mb-4 text-lg font-semibold text-white">Ukas oppsummering</h2>
              <p className="mb-4 leading-relaxed text-[var(--fg)]">
                {summary.summaryText}
              </p>
              <div className="mb-4 flex flex-wrap items-center gap-4">
                <div>
                  <span className="text-sm text-[var(--muted)]">Tillit til planen: </span>
                  <span className={`font-semibold ${confidenceColor}`}>{confidenceLabel}</span>
                </div>
              </div>
              {summary.bestBet && (
                <div className="rounded-xl border border-[#14b8a6]/50 bg-[#14b8a6]/10 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#14b8a6]">Ukas beste spill</p>
                  <p className="font-medium text-white">{summary.bestBet.selection}</p>
                  <p className="text-sm text-[var(--muted)]">
                    Odds <span className="text-xl font-bold text-white">{summary.bestBet.odds.toFixed(2)}</span> · Potensiell retur {formatNok(summary.bestBet.potentialReturnNok)}
                  </p>
                </div>
              )}
            </section>
          );
        })()}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className="glass-card mb-6 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">Anbefalinger</h2>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Forslag basert på odds og valgt risikoprofil. Les alltid analysen før du spiller.
            </p>
            <ul className="space-y-4">
              {recommendations.map((rec, i) => {
                const valueTier = rec.odds <= 2 ? "good" : rec.odds <= 2.8 ? "medium" : "high-risk";
                const borderClass = valueTier === "good" ? "border-[var(--value-good)]/30" : valueTier === "medium" ? "border-[var(--value-medium)]/30" : "border-[var(--value-high-risk)]/30";
                return (
                  <li
                    key={`${rec.matchId}-${rec.market}-${rec.selection}-${i}`}
                    className={`bet-card-hover rounded-xl border ${borderClass} bg-[var(--glass)] p-4 backdrop-blur-sm`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-white">{rec.matchLabel}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <ValueScoreBadgeWithTooltip score={rec.valueScore} />
                        <ConfidenceBadgeWithTooltip score={rec.confidenceScore} />
                        <span className="text-sm font-medium text-[#14b8a6]">{rec.league}</span>
                        <Link
                          href={`/match/${rec.matchId}`}
                          className="text-sm font-medium text-[#14b8a6] hover:underline"
                        >
                          Se kamp
                        </Link>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-lg bg-white/5 px-2 py-1 text-[var(--fg)]">
                        {rec.selection}
                      </span>
                      <span className={`text-2xl font-bold ${valueColor(rec.odds)}`}>{rec.odds.toFixed(2)}</span>
                      {rec.handicapLine != null && (
                        <span className="text-[var(--muted)]">
                          Handicap: {rec.handicapLine > 0 ? "+" : ""}{rec.handicapLine}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-[var(--muted)]">{rec.reason}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Ukentlig spilleplan */}
        {displayPlan && displayPlan.plannedBets.length > 0 && (
          <section className="glass-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">Ukentlig spilleplan</h2>
              {!planEditMode ? (
                <button
                  type="button"
                  onClick={handleStartEditPlan}
                  className="rounded-xl border border-[var(--card-border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  Rediger spilleplan
                </button>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={handleCancelEditPlan} className="rounded-xl border border-[var(--card-border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition">
                    Avbryt
                  </button>
                  <button type="button" onClick={handleSaveEditPlan} className="rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-4 py-2 text-sm font-semibold text-white shadow-lg hover:opacity-90 transition">
                    Lagre endringer
                  </button>
                </div>
              )}
            </div>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Fordeling av budsjettet ({formatNok(settings.weeklyBudget)}) basert på risikoprofil og anbefalinger.
            </p>
            <p className="mb-6 rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-3 text-sm text-[var(--fg)]">
              {(planEditMode ? draftPlan ?? displayPlan : displayPlan).summaryReason}
            </p>
            <ul className="mb-6 space-y-4">
              {(planEditMode ? draftPlan ?? displayPlan : displayPlan)!.plannedBets.map((bet, i) => {
                const isAccumulator = bet.type === "accumulator";
                const isMega = isAccumulator && (bet.legs?.length ?? 0) >= 5;
                const valueTier = bet.odds <= 2 ? "good" : bet.odds <= 2.8 ? "medium" : "high-risk";
                const borderClass = valueTier === "good" ? "border-[var(--value-good)]/40" : valueTier === "medium" ? "border-[var(--value-medium)]/40" : "border-[var(--value-high-risk)]/40";
                return (
                  <li
                    key={i}
                    className={`bet-card-hover rounded-xl border ${borderClass} bg-[var(--glass)] p-5 backdrop-blur-sm ${isAccumulator ? "ring-1 ring-[#8b5cf6]/30" : ""}`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
                          {isMega ? "🔥 High Value · Mega accumulator" : isAccumulator ? "🔥 High Value · Accumulator" : "Enkeltspill"}
                        </span>
                        {bet.valueScore != null && (
                          <ValueScoreBadgeWithTooltip score={bet.valueScore} />
                        )}
                        {bet.confidenceScore != null && (
                          <ConfidenceBadgeWithTooltip score={bet.confidenceScore} />
                        )}
                      </div>
                      <span className={`text-2xl font-bold tabular-nums ${valueColor(bet.odds)}`}>
                        {bet.odds.toFixed(2)}
                      </span>
                    </div>
                    {isAccumulator && bet.legs ? (
                      <div className="mb-2 space-y-1">
                        {bet.legs.map((leg, legIdx) => (
                          <div key={legIdx} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 px-2 py-1.5 text-sm">
                            <span className="text-white">Leg {legIdx + 1}: {leg.matchLabel} – {leg.selection} @ {leg.odds.toFixed(2)}</span>
                            {planEditMode && (
                              <div className="flex gap-1">
                                <button type="button" onClick={() => setSwapModal({ betIndex: i, legIndex: legIdx })} className="rounded bg-[var(--card-border)] px-2 py-1 text-xs font-medium text-white hover:bg-white/20">
                                  Bytt kamp
                                </button>
                                {bet.legs && bet.legs.length > 2 && (
                                  <button type="button" onClick={() => handleRemoveAccaLeg(i, legIdx)} className="rounded bg-[var(--value-high-risk)]/30 px-2 py-1 text-xs font-medium text-[var(--value-high-risk)] hover:bg-[var(--value-high-risk)]/50">
                                    Fjern
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        {planEditMode && bet.legs && bet.legs.length < 6 && (
                          <button type="button" onClick={() => setSwapModal({ betIndex: i })} className="mt-1 rounded border border-dashed border-[var(--card-border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white">
                            + Legg til leg
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="mb-2 text-sm font-medium text-white">
                        {bet.selection}
                      </p>
                    )}
                    {!isAccumulator && planEditMode && (
                      <button type="button" onClick={() => setSwapModal({ betIndex: i })} className="mb-2 rounded bg-[var(--card-border)] px-2 py-1 text-xs font-medium text-white hover:bg-white/20">
                        Bytt kamp
                      </button>
                    )}
                    <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
                      <span className="text-[var(--muted)]">
                        Forslag innsats: <strong className="text-white">{formatNok(bet.stakeNok)}</strong>
                      </span>
                    </div>
                    <div className="mb-2 rounded-xl border border-[#14b8a6]/40 bg-[#14b8a6]/10 px-3 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#14b8a6]">Potensiell retur ved treff</span>
                      <p className="text-xl font-bold text-[#14b8a6]">{formatNok(bet.potentialReturnNok)}</p>
                    </div>
                    <p className="text-sm leading-relaxed text-[var(--muted)]">
                      {bet.reason}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/80 p-4">
              <div>
                <span className="text-sm text-[var(--muted)]">Total innsats denne uken</span>
                <p className="text-lg font-bold text-white">{formatNok((planEditMode ? draftPlan ?? displayPlan : displayPlan)!.totalStaked)}</p>
              </div>
              <div className="text-right">
                <span className="text-sm text-[var(--muted)]">Total mulig retur (hvis alle vinner)</span>
                <p className="text-lg font-bold bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] bg-clip-text text-transparent">{formatNok((planEditMode ? draftPlan ?? displayPlan : displayPlan)!.totalPotentialReturn)}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={handleConfirmPlan}
                disabled={planEditMode}
                className="rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-8 py-4 text-lg font-bold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Bekreft ukens spilleplan
              </button>
            </div>
            {/* Swap/select modal */}
            {swapModal != null && draftPlan && (
              <SwapLegModal
                betIndex={swapModal.betIndex}
                legIndex={swapModal.legIndex}
                bet={draftPlan.plannedBets[swapModal.betIndex]}
                recommendations={recommendations}
                onSelectSingle={(rec) => handleSwapSingle(swapModal.betIndex, rec)}
                onSelectLeg={(rec) => swapModal.legIndex != null ? handleSwapAccaLeg(swapModal.betIndex, swapModal.legIndex, rec) : handleAddAccaLeg(swapModal.betIndex, rec)}
                onClose={() => setSwapModal(null)}
              />
            )}
          </section>
        )}
          </>
        )}

        {/* Tab: Resultater */}
        {activeTab === "results" && (
          <ResultsTab
            weekSummaries={weekSummaries}
            onUpdate={() => loadFromStorage()}
            formatNok={formatNok}
          />
        )}
      </main>
    </div>
  );
}

function getBetTypeLabel(bet: { market: string; selection: string }): string {
  if (bet.selection.includes("Kamp 1") || (bet.selection.includes(" · ") && bet.selection.includes("Kamp"))) return "Akkumulator";
  if (bet.market === "totals") return "Over/Under";
  if (bet.market === "btts") return "BTTS";
  if (bet.market === "spreads") return "Asian Handicap";
  return "Annet";
}

function ResultsTab({
  weekSummaries,
  onUpdate,
  formatNok,
}: {
  weekSummaries: ReturnType<typeof getWeekSummaries>;
  onUpdate: () => void;
  formatNok: (n: number) => string;
}) {
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [showAddBet, setShowAddBet] = useState(false);
  const [newBet, setNewBet] = useState({ matchLabel: "", selection: "", odds: "", stake: "" });
  const [undoWeekKey, setUndoWeekKey] = useState<string | null>(null);

  const totalInvested = weekSummaries.reduce((s, w) => s + w.totalStaked, 0);
  const totalReturned = weekSummaries.reduce((s, w) => s + w.totalReturns, 0);
  const netPl = totalReturned - totalInvested;
  const roi = totalInvested > 0 ? ((netPl / totalInvested) * 100) : 0;
  const allBetsWithResult = weekSummaries.flatMap((w) => w.bets.filter((b) => b.result != null));
  const settledCount = allBetsWithResult.length;
  const wonCount = allBetsWithResult.filter((b) => b.result?.won).length;
  const winRate = settledCount > 0 ? (wonCount / settledCount) * 100 : 0;
  const bestWeek = weekSummaries.length > 0 ? weekSummaries.reduce((a, w) => (w.profitLoss > (a?.profitLoss ?? -Infinity) ? w : a), weekSummaries[0]) : null;
  const worstWeek = weekSummaries.length > 0 ? weekSummaries.reduce((a, w) => (w.profitLoss < (a?.profitLoss ?? Infinity) ? w : a), weekSummaries[0]) : null;

  const chartData = [...weekSummaries].reverse().map((w, i) => {
    let cumulative = 0;
    for (let j = 0; j <= i; j++) cumulative += weekSummaries[weekSummaries.length - 1 - j].profitLoss;
    return {
      name: `Uke ${w.weekKey.split("-")[1]?.replace("W", "") ?? w.weekKey}`,
      weekKey: w.weekKey,
      profitLoss: w.profitLoss,
      cumulative,
    };
  });

  const betTypeStats = (() => {
    const byType = new Map<string, { won: number; total: number }>();
    for (const w of weekSummaries) {
      for (const b of w.bets) {
        if (b.result == null) continue;
        const type = getBetTypeLabel(b);
        const cur = byType.get(type) ?? { won: 0, total: 0 };
        cur.total += 1;
        if (b.result.won) cur.won += 1;
        byType.set(type, cur);
      }
    }
    return Array.from(byType.entries()).map(([type, { won, total }]) => ({ type, won, total, rate: total > 0 ? (won / total) * 100 : 0 }));
  })();

  const handleMarkResult = (betId: string, won: boolean, stake: number, odds: number) => {
    setBetResult({
      betId,
      won,
      returns: won ? Math.round(stake * odds * 100) / 100 : 0,
      settledAt: new Date().toISOString(),
    });
    onUpdate();
  };

  const handleAddBet = () => {
    const odds = parseFloat(newBet.odds);
    const stake = parseFloat(newBet.stake);
    if (!newBet.matchLabel.trim() || !newBet.selection.trim() || !Number.isFinite(odds) || !Number.isFinite(stake) || stake <= 0) return;
    addPlacedBet({
      matchId: 0,
      matchLabel: newBet.matchLabel.trim(),
      market: "h2h",
      selection: newBet.selection.trim(),
      odds,
      stake,
    });
    setNewBet({ matchLabel: "", selection: "", odds: "", stake: "" });
    setShowAddBet(false);
    onUpdate();
  };

  const chartColorGood = "var(--value-good)";
  const chartColorBad = "var(--value-high-risk)";

  return (
    <section className="glass-card p-5">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Resultater</h2>
        <button
          type="button"
          onClick={() => setShowAddBet((v) => !v)}
          className="rounded-xl border border-[var(--card-border)] bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition"
        >
          {showAddBet ? "Avbryt" : "Legg til spill"}
        </button>
      </div>

      {showAddBet && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--glass)] p-5 backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-medium text-white">Nytt spill (uke {getCurrentWeekKey().split("-")[1]})</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Kamp (f.eks. Liverpool v Chelsea)"
              value={newBet.matchLabel}
              onChange={(e) => setNewBet((b) => ({ ...b, matchLabel: e.target.value }))}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[#14b8a6] focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/30"
            />
            <input
              placeholder="Valg (f.eks. Over 2.5 mål)"
              value={newBet.selection}
              onChange={(e) => setNewBet((b) => ({ ...b, selection: e.target.value }))}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[#14b8a6] focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/30"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Odds"
              value={newBet.odds}
              onChange={(e) => setNewBet((b) => ({ ...b, odds: e.target.value }))}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[#14b8a6] focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/30"
            />
            <input
              type="number"
              step="10"
              placeholder="Innsats (NOK)"
              value={newBet.stake}
              onChange={(e) => setNewBet((b) => ({ ...b, stake: e.target.value }))}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:border-[#14b8a6] focus:outline-none focus:ring-2 focus:ring-[#14b8a6]/30"
            />
          </div>
          <button type="button" onClick={handleAddBet} className="mt-3 rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#06b6d4] px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:opacity-90 transition">
            Legg til
          </button>
        </div>
      )}

      {/* Overview stats */}
      <div className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--bg)]/40 p-5 backdrop-blur-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Oversikt</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="text-xs text-[var(--muted)]">Total innsats</p>
            <p className="text-lg font-bold text-white">{formatNok(totalInvested)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Total retur</p>
            <p className="text-lg font-bold text-white">{formatNok(totalReturned)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Netto resultat</p>
            <p className={`text-lg font-bold ${netPl >= 0 ? "text-[var(--value-good)]" : "text-[var(--value-high-risk)]"}`}>
              {netPl >= 0 ? "+" : ""}{formatNok(netPl)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">ROI</p>
            <p className={`text-lg font-bold ${roi >= 0 ? "text-[var(--value-good)]" : "text-[var(--value-high-risk)]"}`}>
              {roi >= 0 ? "+" : ""}{roi.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Seierrate</p>
            <p className="text-lg font-bold text-white">{settledCount > 0 ? `${winRate.toFixed(0)}%` : "–"}</p>
            <p className="text-xs text-[var(--muted)]">{wonCount}/{settledCount} spill</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-[var(--muted)]">Beste / verste uke</p>
            <p className="text-sm font-medium text-[var(--value-good)]">
              {bestWeek ? `${bestWeek.weekKey}: ${bestWeek.profitLoss >= 0 ? "+" : ""}${formatNok(bestWeek.profitLoss)}` : "–"}
            </p>
            <p className="text-sm font-medium text-[var(--value-high-risk)]">
              {worstWeek ? `${worstWeek.weekKey}: ${worstWeek.profitLoss >= 0 ? "+" : ""}${formatNok(worstWeek.profitLoss)}` : "–"}
            </p>
          </div>
        </div>
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--bg)]/40 p-5 backdrop-blur-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Diagrammer</h3>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-[var(--muted)]">Resultat per uke</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(v) => `${v} kr`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--card-border)", borderRadius: "12px" }}
                      labelStyle={{ color: "var(--fg)" }}
                      formatter={(value: number) => [formatNok(value), "Resultat"]}
                      labelFormatter={(_, payload) => payload[0]?.payload?.weekKey ?? ""}
                    />
                    <Bar dataKey="profitLoss" name="Resultat" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.profitLoss >= 0 ? chartColorGood : chartColorBad} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs text-[var(--muted)]">Kumulativt resultat</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(v) => `${v} kr`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--card-border)", borderRadius: "12px" }}
                      formatter={(value: number) => [formatNok(value), "Kumulativt"]}
                    />
                    <Line type="monotone" dataKey="cumulative" stroke="#14b8a6" strokeWidth={2} dot={{ fill: "#14b8a6", r: 3 }} name="Kumulativt" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bet type analysis */}
      {betTypeStats.length > 0 && (
        <div className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--bg)]/40 p-5 backdrop-blur-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Resultat per markedstype</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {betTypeStats.map(({ type, won, total, rate }) => (
              <div key={type} className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/60 p-4">
                <p className="text-sm font-medium text-white">{type}</p>
                <p className="mt-1 text-2xl font-bold text-white">{rate.toFixed(0)}%</p>
                <p className="text-xs text-[var(--muted)]">Seierrate · {won}/{total} spill</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">Liga er ikke sporbart (ingen ligadata per spill).</p>
        </div>
      )}

      {/* Weekly breakdown */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg)]/40 p-5 backdrop-blur-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Ukentlig oversikt</h3>
        {weekSummaries.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            Ingen uker med spill ennå. Bruk «Legg til spill» eller bekreft en spilleplan for å registrere.
          </p>
        ) : (
          <ul className="space-y-4">
            {weekSummaries.map((w, index) => (
              <li key={w.weekKey} className="rounded-xl border border-[var(--card-border)] bg-[var(--bg)]/40 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedWeek((k) => (k === w.weekKey ? null : w.weekKey))}
                    className="flex flex-1 flex-wrap items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition rounded -m-2 p-2"
                  >
                    <span className="font-medium text-white">
                      Uke {w.weekKey.split("-")[1]?.replace("W", "") ?? w.weekKey} ({w.startDate} – {w.endDate})
                    </span>
                    <span className="text-[var(--muted)] text-sm">
                      Innsats {formatNok(w.totalStaked)} · Retur {formatNok(w.totalReturns)}
                    </span>
                    <span className={w.profitLoss >= 0 ? "text-[var(--value-good)] font-semibold" : "text-[var(--value-high-risk)] font-semibold"}>
                      {w.profitLoss >= 0 ? "+" : ""}{formatNok(w.profitLoss)}
                    </span>
                    <span className="text-[var(--muted)] text-sm">{expandedWeek === w.weekKey ? "▼" : "▶"}</span>
                  </button>
                  {index === 0 && (
                    <button
                      type="button"
                      onClick={() => setUndoWeekKey(w.weekKey)}
                      className="shrink-0 rounded-lg border border-[var(--value-high-risk)]/50 bg-[var(--value-high-risk)]/10 px-3 py-1.5 text-xs font-medium text-[var(--value-high-risk)] hover:bg-[var(--value-high-risk)]/20 transition"
                    >
                      Angre bekreftelse
                    </button>
                  )}
                </div>
                {expandedWeek === w.weekKey && (
                  <ul className="border-t border-[var(--card-border)] px-4 py-3 space-y-3">
                    {w.bets.map((b) => {
                      const potentialReturn = Math.round(b.stake * b.odds * 100) / 100;
                      return (
                        <li key={b.id} className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)]/80 p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white">{b.matchLabel}</p>
                              <p className="text-[var(--muted)]">{b.selection}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                Odds {b.odds.toFixed(2)} · Innsats {formatNok(b.stake)} · Mulig retur {formatNok(potentialReturn)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {b.result != null ? (
                                <span className={b.result.won ? "text-[var(--value-good)] font-medium" : "text-[var(--value-high-risk)] font-medium"}>
                                  {b.result.won ? "✅ Vunnet" : "❌ Tapt"} · {formatNok(b.result.returns)}
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkResult(b.id, true, b.stake, b.odds)}
                                    className="rounded-lg bg-[var(--value-good)]/20 px-3 py-1.5 text-xs font-medium text-[var(--value-good)] hover:bg-[var(--value-good)]/30 transition"
                                  >
                                    ✅ Vunnet
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkResult(b.id, false, b.stake, b.odds)}
                                    className="rounded-lg bg-[var(--value-high-risk)]/20 px-3 py-1.5 text-xs font-medium text-[var(--value-high-risk)] hover:bg-[var(--value-high-risk)]/30 transition"
                                  >
                                    ❌ Tapt
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {undoWeekKey != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setUndoWeekKey(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-white">Angre bekreftelse</h3>
            <p className="mb-4 text-sm text-[var(--fg)]">Er du sikker? Dette vil fjerne uken fra resultater.</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setUndoWeekKey(null)} className="rounded-xl border border-[var(--card-border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition">
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => {
                  removeWeekFromResults(undoWeekKey);
                  setUndoWeekKey(null);
                  onUpdate();
                }}
                className="rounded-xl bg-[var(--value-high-risk)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition"
              >
                Bekreft
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SwapLegModal({
  betIndex,
  legIndex,
  bet,
  recommendations,
  onSelectSingle,
  onSelectLeg,
  onClose,
}: {
  betIndex: number;
  legIndex?: number;
  bet: PlannedBet;
  recommendations: BetRecommendation[];
  onSelectSingle: (rec: BetRecommendation) => void;
  onSelectLeg: (rec: BetRecommendation) => void;
  onClose: () => void;
}) {
  const isSingle = bet.type === "single";
  const usedMatchIds = new Set((bet.legs ?? []).map((l) => l.matchId));
  const options = isSingle
    ? recommendations
    : recommendations.filter((r) => !usedMatchIds.has(r.matchId));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--card-border)] p-4">
          <h3 className="font-semibold text-white">
            {isSingle ? "Velg kamp" : legIndex != null ? "Bytt leg" : "Legg til leg"}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-white">✕</button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
          {options.length === 0 ? (
            <li className="p-3 text-sm text-[var(--muted)]">Ingen andre kamper tilgjengelig.</li>
          ) : (
            options.map((rec, i) => (
              <li key={`${rec.matchId}-${rec.market}-${rec.selection}-${i}`}>
                <button
                  type="button"
                  onClick={() => isSingle ? onSelectSingle(rec) : onSelectLeg(rec)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--card-border)] bg-white/5 p-3 text-left hover:bg-white/10"
                >
                  <span className="font-medium text-white">{rec.matchLabel}</span>
                  <span className="text-sm text-[var(--muted)]">{rec.selection}</span>
                  <span className={`font-bold ${valueColor(rec.odds)}`}>{rec.odds.toFixed(2)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function APIUsage({ usage }: { usage: StoredUsage | null }) {
  if (!usage) return null;
  const remaining = usage.oddsApiRemaining;
  const used = usage.oddsApiUsed;
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--glass)] px-3 py-2 text-sm backdrop-blur-sm">
      <span className="text-[var(--muted)]">Odds API: </span>
      {remaining != null && (
        <span className="text-white font-semibold">{remaining} kall igjen</span>
      )}
      {used != null && (
        <span className="ml-2 text-[var(--muted)]">
          ({used} brukt denne måneden)
        </span>
      )}
      {remaining == null && used == null && (
        <span className="text-[var(--muted)]">Bruk lastet fra cache</span>
      )}
    </div>
  );
}

function valueColor(odds: number) {
  if (odds <= 2) return "text-[var(--value-good)]";
  if (odds <= 2.8) return "text-[var(--value-medium)]";
  return "text-[var(--value-high-risk)]";
}

const VALUE_SCORE_TOOLTIP =
  "Verdiscore viser hvor godt oddsen er sammenlignet med vår estimerte sannsynlighet. 7–10 = god verdi (bookmaker undervurderer). Under 4 = dårlig verdi.";

const CONFIDENCE_TOOLTIP =
  "Konfidensscoren viser hvor sannsynlig vi mener det er at dette bettet vinner, basert på form, hjemmebane-fordel og historiske trender.";

function valueScoreBadge(score: number): { label: string; className: string } {
  if (score >= 7) return { label: `Verdi: ${score}/10 🟢`, className: "text-[var(--value-good)]" };
  if (score >= 4) return { label: `Verdi: ${score}/10 🟡`, className: "text-[var(--value-medium)]" };
  return { label: `Verdi: ${score}/10 🔴`, className: "text-[var(--value-high-risk)]" };
}

function confidenceBadge(score: number): { label: string; className: string } {
  if (score >= 70) return { label: `Konfidens: ${score}%`, className: "text-[var(--value-good)]" };
  if (score >= 50) return { label: `Konfidens: ${score}%`, className: "text-[var(--value-medium)]" };
  return { label: `Konfidens: ${score}%`, className: "text-[var(--value-high-risk)]" };
}

function ValueScoreBadgeWithTooltip({ score }: { score: number }) {
  const { label, className } = valueScoreBadge(score);
  return (
    <span className="group relative inline-block">
      <span className={`cursor-help text-xs font-semibold ${className}`}>{label}</span>
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 -translate-x-1/2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2.5 py-2 text-xs text-[var(--fg)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        role="tooltip"
      >
        {VALUE_SCORE_TOOLTIP}
      </span>
    </span>
  );
}

function ConfidenceBadgeWithTooltip({ score }: { score: number }) {
  const { label, className } = confidenceBadge(score);
  return (
    <span className="group relative inline-block">
      <span className={`cursor-help text-xs font-semibold ${className}`}>{label}</span>
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 -translate-x-1/2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2.5 py-2 text-xs text-[var(--fg)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        role="tooltip"
      >
        {CONFIDENCE_TOOLTIP}
      </span>
    </span>
  );
}

function OddsCell({
  btts,
  labels,
}: {
  btts?: { yes: number; no: number };
  labels: { yes: string; no: string };
}) {
  const yes = btts?.yes;
  const no = btts?.no;
  if (yes == null || no == null) return <span className="text-[var(--muted)]">–</span>;
  return (
    <div className="text-sm">
      <span><span className="text-[var(--muted)]">{labels.yes}</span> <span className={`font-bold ${valueColor(yes)}`}>@ {yes.toFixed(2)}</span></span>
      <span className="text-[var(--muted)]"> / </span>
      <span><span className="text-[var(--muted)]">{labels.no}</span> <span className={`font-bold ${valueColor(no)}`}>@ {no.toFixed(2)}</span></span>
    </div>
  );
}

function TotalsCell({ overUnder }: { overUnder?: Array<{ line: number; over: number; under: number }> }) {
  if (!overUnder?.length) return <span className="text-[var(--muted)]">–</span>;
  const sorted = [...overUnder].sort((a, b) => a.line - b.line);
  return (
    <div className="space-y-1.5 text-sm">
      {sorted.map(({ line, over, under }) => (
        <div key={line} className="space-y-0.5">
          <div className="text-[var(--muted)]">O {line} <span className={`font-bold ${valueColor(over)}`}>@ {over.toFixed(2)}</span> / U {line} <span className={`font-bold ${valueColor(under)}`}>@ {under.toFixed(2)}</span></div>
        </div>
      ))}
    </div>
  );
}

function formatHandicap(point: number): string {
  return point >= 0 ? `+${point}` : String(point);
}

function SpreadsCell({
  asianHandicap,
  homeShort,
  awayShort,
}: {
  asianHandicap?: Array<{ home: { line: number; odds: number }; away: { line: number; odds: number } }>;
  homeShort?: string | null;
  awayShort?: string | null;
}) {
  if (!asianHandicap?.length) return <span className="text-[var(--muted)]">–</span>;
  const homeLabel = homeShort ?? "Hjemme";
  const awayLabel = awayShort ?? "Borte";
  return (
    <div className="space-y-1.5 text-sm">
      {asianHandicap.map(({ home, away }, i) => (
        <div key={i} className="space-y-0.5">
          <div><span className="text-[var(--muted)]">{homeLabel} {formatHandicap(home.line)}</span> <span className={`font-bold ${valueColor(home.odds)}`}>@ {home.odds.toFixed(2)}</span></div>
          <div><span className="text-[var(--muted)]">{awayLabel} {formatHandicap(away.line)}</span> <span className={`font-bold ${valueColor(away.odds)}`}>@ {away.odds.toFixed(2)}</span></div>
        </div>
      ))}
    </div>
  );
}
