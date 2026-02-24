/**
 * localStorage keys and helpers for the dashboard.
 * Data is only refreshed when the user clicks Refresh; we never auto-fetch on load.
 */

import type { UpcomingMatch } from "@/lib/types";
import type { UserSettings, PlacedBet, BetResult, WeekSummary } from "@/lib/types";

const PREFIX = "football-bets";

export const StorageKeys = {
  matches: `${PREFIX}:matches`,
  refreshedAt: `${PREFIX}:refreshedAt`,
  usage: `${PREFIX}:usage`,
  settings: `${PREFIX}:settings`,
  bets: `${PREFIX}:bets`,
  results: `${PREFIX}:results`,
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

export function getStoredResults(): BetResult[] {
  return safeJsonParse(StorageKeys.results, []);
}

export function setStoredResults(results: BetResult[]): void {
  safeSet(StorageKeys.results, results);
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
