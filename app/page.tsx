"use client";

import { useCallback, useEffect, useState } from "react";
import type { UpcomingMatch } from "@/lib/types";
import type { UserSettings, RiskProfile } from "@/lib/types";
import {
  getStoredMatches,
  getStoredRefreshedAt,
  getStoredUsage,
  setStoredMatchesPayload,
  getStoredSettings,
  setStoredSettings,
  getWeekSummaries,
  type StoredUsage,
} from "@/lib/utils/storage";
import { getRecommendations } from "@/lib/utils/recommendations";
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
  }, [settings]);

  const leagues = ["all", ...FOOTBALL_DATA_LEAGUES.map((l) => l.name)];
  const filteredMatches =
    leagueFilter === "all"
      ? matches
      : matches.filter((m) => m.competition.name === leagueFilter);
  const recommendations = getRecommendations(filteredMatches, settings.riskProfile);

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#e5e5e5]">
      <header className="sticky top-0 z-10 border-b border-[#2a2a2a] bg-[#0f0f0f]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Football Betting Advisor
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            <APIUsage usage={usage} />
            <span className="text-sm text-[#737373]">
              {refreshedAt ? `Sist oppdatert: ${formatDate(refreshedAt)}` : "Ingen data – klikk Oppdater"}
            </span>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#16a34a] disabled:opacity-50"
            >
              {loading ? "Oppdaterer…" : "Oppdater data"}
            </button>
          </div>
        </div>
        {error && (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        {/* Budget & Risk */}
        <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
          <h2 className="mb-4 text-lg font-medium text-white">Innstillinger</h2>
          <div className="flex flex-wrap gap-8">
            <div>
              <label className="mb-1 block text-sm text-[#a3a3a3]">Ukentlig budsjett (NOK)</label>
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
                className="w-32 rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none focus:ring-1 focus:ring-[#22c55e]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[#a3a3a3]">Risikoprofil</label>
              <select
                value={settings.riskProfile}
                onChange={(e) =>
                  handleSettingsChange({
                    riskProfile: e.target.value as RiskProfile,
                  })
                }
                className="rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
              >
                <option value="low">Lav</option>
                <option value="medium">Middels</option>
                <option value="high">Høy</option>
              </select>
            </div>
          </div>
        </section>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h2 className="mb-4 text-lg font-medium text-white">Anbefalinger</h2>
            <p className="mb-4 text-sm text-[#a3a3a3]">
              Forslag basert på odds og valgt risikoprofil. Les alltid analysen før du spiller.
            </p>
            <ul className="space-y-4">
              {recommendations.map((rec, i) => (
                <li
                  key={`${rec.matchId}-${rec.market}-${rec.selection}-${i}`}
                  className="rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-white">{rec.matchLabel}</span>
                    <span className="text-sm text-[#22c55e]">{rec.league}</span>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-[#2a2a2a] px-2 py-0.5 text-[#e5e5e5]">
                      {rec.selection}
                    </span>
                    <span className="font-mono text-[#22c55e]">@{rec.odds.toFixed(2)}</span>
                    {rec.handicapLine != null && (
                      <span className="text-[#a3a3a3]">
                        Handicap: {rec.handicapLine > 0 ? "+" : ""}{rec.handicapLine}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-[#a3a3a3]">{rec.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Match list */}
        <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-medium text-white">Kommende kamper</h2>
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2 text-sm text-white focus:border-[#22c55e] focus:outline-none"
            >
              {leagues.map((l) => (
                <option key={l} value={l}>
                  {l === "all" ? "Alle ligaer" : l}
                </option>
              ))}
            </select>
          </div>
          {filteredMatches.length === 0 ? (
            <p className="py-8 text-center text-[#737373]">
              {matches.length === 0
                ? "Ingen kamper lastet. Klikk «Oppdater data» for å hente kamper og odds."
                : "Ingen kamper i valgt liga."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a2a2a] text-[#a3a3a3]">
                    <th className="pb-3 pr-4 font-medium">Kamp</th>
                    <th className="pb-3 pr-4 font-medium">Liga</th>
                    <th className="pb-3 pr-4 font-medium">Dato</th>
                    <th className="pb-3 pr-4 font-medium">BTTS</th>
                    <th className="pb-3 pr-4 font-medium">Over/Under</th>
                    <th className="pb-3 font-medium">Asian Handicap</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#0f0f0f]/50"
                    >
                      <td className="py-3 pr-4">
                        <span className="text-white">
                          {m.homeTeam.shortName ?? m.homeTeam.name} – {m.awayTeam.shortName ?? m.awayTeam.name}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[#a3a3a3]">{m.competition.name}</td>
                      <td className="py-3 pr-4 text-[#a3a3a3]">{formatDate(m.utcDate)}</td>
                      <td className="py-3 pr-4">
                        <OddsCell
                          summary={m.odds?.btts}
                          labels={{ yes: "Ja", no: "Nei" }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <TotalsCell totals={m.odds?.totals} />
                      </td>
                      <td className="py-3">
                        <SpreadsCell spreads={m.odds?.spreads} homeName={m.homeTeam.name} awayName={m.awayTeam.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* P/L Tracker */}
        <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
          <h2 className="mb-4 text-lg font-medium text-white">Resultat uke for uke</h2>
          {weekSummaries.length === 0 ? (
            <p className="py-4 text-center text-sm text-[#737373]">
              Ingen spilte kamper registrert ennå. Her vil du se innsats, retur og resultat per uke.
            </p>
          ) : (
            <ul className="space-y-3">
              {weekSummaries.map((w) => (
                <li
                  key={w.weekKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-4 py-3"
                >
                  <span className="font-medium text-white">
                    {w.weekKey} ({w.startDate} – {w.endDate})
                  </span>
                  <span className="text-[#a3a3a3]">
                    Innsats: {formatNok(w.totalStaked)} · Retur: {formatNok(w.totalReturns)}
                  </span>
                  <span
                    className={
                      w.profitLoss >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                    }
                  >
                    {w.profitLoss >= 0 ? "+" : ""}{formatNok(w.profitLoss)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function APIUsage({ usage }: { usage: StoredUsage | null }) {
  if (!usage) return null;
  const remaining = usage.oddsApiRemaining;
  const used = usage.oddsApiUsed;
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm">
      <span className="text-[#a3a3a3]">Odds API: </span>
      {remaining != null && (
        <span className="text-white">
          <strong>{remaining}</strong> kall igjen
        </span>
      )}
      {used != null && (
        <span className="ml-2 text-[#737373]">
          ({used} brukt denne måneden)
        </span>
      )}
      {remaining == null && used == null && (
        <span className="text-[#737373]">Bruk lastet fra cache</span>
      )}
    </div>
  );
}

function OddsCell({
  summary,
  labels,
}: {
  summary?: { bestOdds: Record<string, number> };
  labels: { yes: string; no: string };
}) {
  if (!summary?.bestOdds || Object.keys(summary.bestOdds).length === 0) {
    return <span className="text-[#737373]">–</span>;
  }
  const yes = summary.bestOdds["Yes"] ?? summary.bestOdds["yes"];
  const no = summary.bestOdds["No"] ?? summary.bestOdds["no"];
  return (
    <span className="text-[#a3a3a3]">
      {yes != null ? `${labels.yes} ${yes.toFixed(2)}` : ""}
      {yes != null && no != null ? " / " : ""}
      {no != null ? `${labels.no} ${no.toFixed(2)}` : ""}
    </span>
  );
}

function TotalsCell({ totals }: { totals?: Record<string, { bestOdds: Record<string, number>; point?: number }> }) {
  if (!totals || Object.keys(totals).length === 0) {
    return <span className="text-[#737373]">–</span>;
  }
  const lines = Object.entries(totals).slice(0, 2);
  return (
    <div className="space-y-1">
      {lines.map(([line, s]) => {
        const over = s.bestOdds["Over"] ?? s.bestOdds["Over 2.5"];
        const under = s.bestOdds["Under"] ?? s.bestOdds["Under 2.5"];
        return (
          <div key={line} className="text-[#a3a3a3]">
            {s.point != null ? `${s.point} ` : ""}
            {over != null ? `O ${over.toFixed(2)}` : ""}
            {over != null && under != null ? " / " : ""}
            {under != null ? `U ${under.toFixed(2)}` : ""}
          </div>
        );
      })}
    </div>
  );
}

function SpreadsCell({
  spreads,
  homeName,
  awayName,
}: {
  spreads?: Record<string, { bestOdds: Record<string, number>; point?: number }>;
  homeName: string;
  awayName: string;
}) {
  if (!spreads || Object.keys(spreads).length === 0) {
    return <span className="text-[#737373]">–</span>;
  }
  const lines = Object.entries(spreads).slice(0, 2);
  return (
    <div className="space-y-1">
      {lines.map(([key, s]) => {
        const point = s.point ?? parseFloat(key);
        const home = s.bestOdds[homeName] ?? s.bestOdds["Home"];
        const away = s.bestOdds[awayName] ?? s.bestOdds["Away"];
        const homeOdds = home != null ? `${point > 0 ? "+" : ""}${point} @ ${home.toFixed(2)}` : null;
        const awayOdds = away != null ? `${-point > 0 ? "+" : ""}${-point} @ ${away.toFixed(2)}` : null;
        return (
          <div key={key} className="text-[#a3a3a3]">
            {homeOdds ?? "–"} / {awayOdds ?? "–"}
          </div>
        );
      })}
    </div>
  );
}
