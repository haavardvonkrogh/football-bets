/**
 * localStorage keys and helpers for the dashboard.
 * Data is only refreshed when the user clicks Refresh; we never auto-fetch on load.
 */

import type { UpcomingMatch } from "@/lib/types";
import type { UserSettings, PlacedBet, BetResult, WeekSummary, WeeklyBettingPlan, PlannedBet, BetRecommendation, SavedRecommendation } from "@/lib/types";
import type { MatchResult } from "@/lib/utils/bet-outcome";

const PREFIX = "football-bets";

export const StorageKeys = {
  matches: `${PREFIX}:matches`,
  refreshedAt: `${PREFIX}:refreshedAt`,
  usage: `${PREFIX}:usage`,
  settings: `${PREFIX}:settings`,
  bets: `${PREFIX}:bets`,
  results: `${PREFIX}:results`,
  recommendationHistory: `${PREFIX}:recommendation-history`,
  matchResult: (matchId: number) => `${PREFIX}:match-result:${matchId}`,
} as const;

export interface StoredUsage {
  oddsApiRemaining: number | null;
  oddsApiUsed: number | null;
  updatedAt: string;
}

export interface StoredMatchesPayload {
  matches: UpcomingMatch[];
  refreshedAt: string;
  usage: StoredUsage;
}

function safeJsonParse<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[storage] set failed", key, e);
  }
}

export function getStoredMatches(): UpcomingMatch[] {
  return safeJsonParse(StorageKeys.matches, []);
}

export function getStoredRefreshedAt(): string | null {
  return safeJsonParse(StorageKeys.refreshedAt, null);
}

export function getStoredUsage(): StoredUsage | null {
  return safeJsonParse(StorageKeys.usage, null);
}

export function setStoredMatchesPayload(payload: StoredMatchesPayload): void {
  safeSet(StorageKeys.matches, payload.matches);
  safeSet(StorageKeys.refreshedAt, payload.refreshedAt);
  if (payload.usage) {
    safeSet(StorageKeys.usage, {
      ...payload.usage,
      updatedAt: new Date().toISOString(),
    });
  }
}

const defaultSettings: UserSettings = {
  weeklyBudget: 500,
  riskProfile: "medium",
};

export function getStoredSettings(): UserSettings {
  return safeJsonParse(StorageKeys.settings, defaultSettings);
}

export function setStoredSettings(settings: UserSettings): void {
  safeSet(StorageKeys.settings, settings);
}

export function getStoredBets(): PlacedBet[] {
  return safeJsonParse(StorageKeys.bets, []);
}

export function setStoredBets(bets: PlacedBet[]): void {
  safeSet(StorageKeys.bets, bets);
}

export function getStoredRecommendationHistory(): SavedRecommendation[] {
  return safeJsonParse(StorageKeys.recommendationHistory, []);
}

export function setStoredRecommendationHistory(history: SavedRecommendation[]): void {
  safeSet(StorageKeys.recommendationHistory, history);
}

/** Merge new recommendations into stored history. Adds only items not already present (same matchId + betType + selection + date). */
export function mergeRecommendationHistory(recommendations: BetRecommendation[], matches: UpcomingMatch[]): void {
  const existing = getStoredRecommendationHistory();
  const key = (r: SavedRecommendation) => `${r.matchId}:${r.betType}:${r.selection}:${r.date}`;
  const existingKeys = new Set(existing.map(key));
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const toAdd: SavedRecommendation[] = [];
  for (const r of recommendations) {
    const match = matchById.get(r.matchId);
    if (!match) continue;
    const date = (match.utcDate || "").slice(0, 10);
    const saved: SavedRecommendation = {
      matchId: r.matchId,
      homeTeam: match.homeTeam?.name ?? "",
      awayTeam: match.awayTeam?.name ?? "",
      league: r.league,
      date,
      betType: r.market,
      odds: r.odds,
      valueScore: r.valueScore,
      confidenceScore: r.confidenceScore,
      selection: r.selection,
      status: "pending",
      id: `rec-${r.matchId}-${r.market}-${r.selection}-${date}`.replace(/\s/g, "_"),
    };
    if (!existingKeys.has(key(saved))) {
      existingKeys.add(key(saved));
      toAdd.push(saved);
    }
  }
  if (toAdd.length > 0) {
    setStoredRecommendationHistory([...existing, ...toAdd]);
  }
}

export function getStoredResults(): BetResult[] {
  return safeJsonParse(StorageKeys.results, []);
}

export function setStoredResults(results: BetResult[]): void {
  safeSet(StorageKeys.results, results);
}

/** Cache finished match result (client). Once FINISHED we never refetch. */
export function getCachedMatchResult(matchId: number): MatchResult | null {
  return safeJsonParse(StorageKeys.matchResult(matchId), null as MatchResult | null);
}

export function setCachedMatchResult(matchId: number, result: MatchResult): void {
  safeSet(StorageKeys.matchResult(matchId), result);
}

/** Get ISO week key for a date (e.g. "2025-W08") */
export function getCurrentWeekKey(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Update or add a single bet result */
export function setBetResult(result: BetResult): void {
  const results = getStoredResults();
  const idx = results.findIndex((r) => r.betId === result.betId);
  const next = idx >= 0 ? results.map((r, i) => (i === idx ? result : r)) : [...results, result];
  setStoredResults(next);
}

/** Add a placed bet */
export function addPlacedBet(bet: Omit<PlacedBet, "id" | "placedAt" | "weekKey">): PlacedBet {
  const bets = getStoredBets();
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `bet-${Date.now()}`;
  const weekKey = getCurrentWeekKey();
  const placed: PlacedBet = {
    ...bet,
    id,
    placedAt: new Date().toISOString(),
    weekKey,
  };
  setStoredBets([...bets, placed]);
  return placed;
}

/** Save the entire weekly plan as placed bets (current week). Used when user confirms plan. */
export function confirmWeeklyPlan(plan: WeeklyBettingPlan): void {
  for (const bet of plan.plannedBets) {
    const matchId = bet.matchId ?? (bet.legs?.[0]?.matchId ?? 0);
    const matchLabel = bet.matchLabel ?? (bet.type === "accumulator" ? `Accumulator (${bet.legs?.length ?? 0} legs)` : bet.selection.split(":")[0]?.trim() ?? "");
    const market = bet.market ?? "totals";
    addPlacedBet({
      matchId,
      matchLabel,
      market,
      selection: bet.selection,
      odds: bet.odds,
      stake: bet.stakeNok,
    });
  }
}

/** Remove a week from results: delete all bets with that weekKey and their results. Use for "Angre bekreftelse". */
export function removeWeekFromResults(weekKey: string): void {
  const bets = getStoredBets();
  const removedIds = new Set(bets.filter((b) => b.weekKey === weekKey).map((b) => b.id));
  setStoredBets(bets.filter((b) => b.weekKey !== weekKey));
  const results = getStoredResults();
  setStoredResults(results.filter((r) => !removedIds.has(r.betId)));
}

/** Build week summaries from bets + results for P/L tracker */
export function getWeekSummaries(): WeekSummary[] {
  const bets = getStoredBets();
  const results = getStoredResults();
  const byWeek = new Map<string, (PlacedBet & { result?: BetResult })[]>();
  for (const bet of bets) {
    const list = byWeek.get(bet.weekKey) ?? [];
    const result = results.find((r) => r.betId === bet.id);
    list.push({ ...bet, result });
    byWeek.set(bet.weekKey, list);
  }
  const summaries: WeekSummary[] = [];
  for (const [weekKey, weekBets] of byWeek) {
    const totalStaked = weekBets.reduce((s, b) => s + b.stake, 0);
    const totalReturns = weekBets.reduce((s, b) => s + (b.result?.returns ?? 0), 0);
    const [y, w] = weekKey.split("-");
    const year = parseInt(y ?? "0", 10);
    const week = parseInt((w ?? "").replace("W", ""), 10);
    const d = new Date(year, 0, 1 + (week - 1) * 7);
    const startDate = d.toISOString().slice(0, 10);
    const endDate = new Date(d);
    endDate.setDate(endDate.getDate() + 6);
    summaries.push({
      weekKey,
      startDate,
      endDate: endDate.toISOString().slice(0, 10),
      totalStaked,
      totalReturns,
      profitLoss: totalReturns - totalStaked,
      bets: weekBets.sort(
        (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
      ),
    });
  }
  summaries.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  return summaries;
}
