/**
 * SofaScore unofficial API client.
 * Fetches match-related data (form with xG, injuries, season xG, H2H).
 * Cache: 6 hours in localStorage. Fails silently on errors.
 */

import type { BetRecommendation } from "@/lib/types";

const BASE = "https://api.sofascore.com/api/v1";
const CACHE_PREFIX = "sofascore:match:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(matchId: number): string {
  return `${CACHE_PREFIX}${matchId}`;
}

function getCached<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw) as { t: number; data: T };
    if (Date.now() - t > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function setCached(key: string, data: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    // ignore
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const short = (s: string) => s.split(/\s+/)[0] ?? s;
  return short(x) === short(y) || x.includes(short(y)) || y.includes(short(x));
}

// --- Response types (minimal) ---

export interface SofaScoreEvent {
  id: number;
  homeTeam?: { id: number; name: string; slug?: string };
  awayTeam?: { id: number; name: string; slug?: string };
  tournament?: { name?: string };
}

export interface SofaScoreScheduledResponse {
  events?: SofaScoreEvent[];
  data?: { events?: SofaScoreEvent[] };
}

export interface SofaScoreTeamEvent {
  id: number;
  homeTeam?: { id: number; name: string };
  awayTeam?: { id: number; name: string };
  startTimestamp?: number;
  homeScore?: { current?: number };
  awayScore?: { current?: number };
  tournament?: { name?: string };
}

export interface SofaScoreTeamEventsResponse {
  events?: SofaScoreTeamEvent[];
  data?: { events?: SofaScoreTeamEvent[] };
}

export interface SofaScoreEventStatsGroup {
  group?: string;
  statisticsItems?: Array<{
    name?: string;
    homeValue?: number | string;
    awayValue?: number | string;
  }>;
}

export interface SofaScoreEventStatisticsResponse {
  statistics?: SofaScoreEventStatsGroup[];
}

export interface SofaScoreInjury {
  player?: { name?: string; shortName?: string };
  reason?: string;
  expectedReturn?: string;
}

export interface SofaScoreInjuriesResponse {
  injuries?: SofaScoreInjury[];
  suspensions?: SofaScoreInjury[];
}

export interface SofaScoreTeamSeasonStatsResponse {
  statistics?: Array<{
    name?: string;
    value?: number | string;
  }>;
}

export interface SofaScoreH2HResponse {
  events?: SofaScoreTeamEvent[];
  data?: { events?: SofaScoreTeamEvent[] };
}

// --- Aggregated data we expose to the UI ---

export interface SofaScoreFormMatch {
  opponent: string;
  result: string;
  goalsFor: number;
  goalsAgainst: number;
  xgFor?: number;
  xgAgainst?: number;
  isHome: boolean;
  date?: string;
}

export interface SofaScoreTeamForm {
  teamName: string;
  teamId: number;
  last5: SofaScoreFormMatch[];
  seasonAvgXg?: number;
}

export interface SofaScoreUnavailablePlayer {
  name: string;
  reason?: string;
  expectedReturn?: string;
}

export interface SofaScoreInjuriesData {
  home: SofaScoreUnavailablePlayer[];
  away: SofaScoreUnavailablePlayer[];
}

export interface SofaScoreH2HMatch {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  date?: string;
}

export interface SofaScoreMatchData {
  homeForm: SofaScoreTeamForm;
  awayForm: SofaScoreTeamForm;
  injuries: SofaScoreInjuriesData;
  h2h: SofaScoreH2HMatch[];
  eventId: number | null;
}

function findEvent(
  events: SofaScoreEvent[] | undefined,
  homeName: string,
  awayName: string
): SofaScoreEvent | null {
  if (!events?.length) return null;
  const h = normalizeName(homeName);
  const a = normalizeName(awayName);
  for (const e of events) {
    const eh = e.homeTeam?.name ?? "";
    const ea = e.awayTeam?.name ?? "";
    if (namesMatch(eh, homeName) && namesMatch(ea, awayName)) return e;
    if (namesMatch(eh, h) && namesMatch(ea, a)) return e;
  }
  for (const e of events) {
    const eh = (e.homeTeam?.name ?? "").toLowerCase();
    const ea = (e.awayTeam?.name ?? "").toLowerCase();
    if (
      (eh.includes(h) || h.includes(eh)) &&
      (ea.includes(a) || a.includes(ea))
    )
      return e;
  }
  return null;
}

function formatResult(
  homeId: number,
  homeScore: number,
  awayScore: number,
  homeTeamId: number,
  awayTeamId: number
): string {
  const isHome = homeId === homeTeamId;
  const for_ = isHome ? homeScore : awayScore;
  const against = isHome ? awayScore : homeScore;
  if (for_ > against) return "W";
  if (for_ < against) return "L";
  return "D";
}

function parseTeamLastEvents(
  teamId: number,
  teamName: string,
  events: SofaScoreTeamEvent[] | undefined,
  eventStatsMap: Map<number, { homeXg?: number; awayXg?: number }>
): SofaScoreTeamForm {
  const last5: SofaScoreFormMatch[] = (events ?? []).slice(0, 5).map((ev) => {
    const homeId = ev.homeTeam?.id ?? 0;
    const awayId = ev.awayTeam?.id ?? 0;
    const homeScore = ev.homeScore?.current ?? 0;
    const awayScore = ev.awayScore?.current ?? 0;
    const isHome = homeId === teamId;
    const opponent = isHome ? (ev.awayTeam?.name ?? "?") : (ev.homeTeam?.name ?? "?");
    const stats = eventStatsMap.get(ev.id);
    const xgFor = stats ? (isHome ? stats.homeXg : stats.awayXg) : undefined;
    const xgAgainst = stats ? (isHome ? stats.awayXg : stats.homeXg) : undefined;
    return {
      opponent,
      result: formatResult(teamId, homeScore, awayScore, homeId, awayId),
      goalsFor: isHome ? homeScore : awayScore,
      goalsAgainst: isHome ? awayScore : homeScore,
      xgFor,
      xgAgainst,
      isHome,
      date:
        ev.startTimestamp != null
          ? new Date(ev.startTimestamp * 1000).toLocaleDateString("nb-NO", {
              day: "numeric",
              month: "short",
            })
          : undefined,
    };
  });
  return { teamName, teamId, last5 };
}

function parseInjuries(res: SofaScoreInjuriesResponse | null): SofaScoreUnavailablePlayer[] {
  if (!res) return [];
  const out: SofaScoreUnavailablePlayer[] = [];
  for (const i of res.injuries ?? []) {
    const name = i.player?.name ?? i.player?.shortName ?? "?";
    out.push({
      name,
      reason: i.reason,
      expectedReturn: i.expectedReturn,
    });
  }
  for (const s of res.suspensions ?? []) {
    const name = s.player?.name ?? s.player?.shortName ?? "?";
    out.push({
      name,
      reason: s.reason ?? "Suspensjon",
      expectedReturn: s.expectedReturn,
    });
  }
  return out;
}

/**
 * Fetch SofaScore data for a match. Uses cache (6h). Returns null on any failure.
 */
export async function fetchSofaScoreMatchData(
  matchId: number,
  utcDate: string,
  homeTeamName: string,
  awayTeamName: string
): Promise<SofaScoreMatchData | null> {
  const key = cacheKey(matchId);
  const cached = getCached<SofaScoreMatchData>(key);
  if (cached) return cached;

  const dateStr = new Date(utcDate).toISOString().slice(0, 10);
  const scheduledUrl = `${BASE}/sport/football/scheduled-events/${dateStr}`;
  const scheduled = await fetchJson<SofaScoreScheduledResponse>(scheduledUrl);
  const eventsList = scheduled?.events ?? scheduled?.data?.events ?? [];
  const event = findEvent(eventsList, homeTeamName, awayTeamName);
  if (!event?.homeTeam?.id || !event?.awayTeam?.id) return null;

  const homeId = event.homeTeam.id;
  const awayId = event.awayTeam.id;
  const homeName = event.homeTeam.name ?? homeTeamName;
  const awayName = event.awayTeam.name ?? awayTeamName;

  const [
    homeEventsRes,
    awayEventsRes,
    homeInjuriesRes,
    awayInjuriesRes,
    h2hRes,
  ] = await Promise.all([
    fetchJson<SofaScoreTeamEventsResponse>(
      `${BASE}/team/${homeId}/events/last/0`
    ),
    fetchJson<SofaScoreTeamEventsResponse>(
      `${BASE}/team/${awayId}/events/last/0`
    ),
    fetchJson<SofaScoreInjuriesResponse>(`${BASE}/team/${homeId}/injuries`),
    fetchJson<SofaScoreInjuriesResponse>(`${BASE}/team/${awayId}/injuries`),
    fetchJson<SofaScoreH2HResponse>(
      `${BASE}/event/${event.id}/head-to-head`
    ).catch(() => null),
  ]);

  const homeEvents = homeEventsRes?.events ?? homeEventsRes?.data?.events ?? [];
  const awayEvents = awayEventsRes?.events ?? awayEventsRes?.data?.events ?? [];

  const eventIds = [
    ...homeEvents.slice(0, 5).map((e) => e.id),
    ...awayEvents.slice(0, 5).map((e) => e.id),
  ];
  const statsMap = new Map<number, { homeXg?: number; awayXg?: number }>();
  await Promise.all(
    [...new Set(eventIds)].map(async (eid) => {
      const stat = await fetchJson<SofaScoreEventStatisticsResponse>(
        `${BASE}/event/${eid}/statistics`
      );
      for (const group of stat?.statistics ?? []) {
        for (const item of group.statisticsItems ?? []) {
          const name = (item.name ?? "").toLowerCase();
          if (name.includes("expected goals") || name === "xg") {
            const homeVal = item.homeValue;
            const awayVal = item.awayValue;
            const h = typeof homeVal === "number" ? homeVal : parseFloat(String(homeVal ?? 0));
            const a = typeof awayVal === "number" ? awayVal : parseFloat(String(awayVal ?? 0));
            if (!Number.isNaN(h) || !Number.isNaN(a)) {
              statsMap.set(eid, { homeXg: h, awayXg: a });
            }
            break;
          }
        }
      }
    })
  );

  const homeForm = parseTeamLastEvents(
    homeId,
    homeName,
    homeEvents,
    statsMap
  );
  const awayForm = parseTeamLastEvents(
    awayId,
    awayName,
    awayEvents,
    statsMap
  );

  const homeSeasonUrl = `${BASE}/team/${homeId}/season/statistics`;
  const awaySeasonUrl = `${BASE}/team/${awayId}/season/statistics`;
  const [homeSeason, awaySeason] = await Promise.all([
    fetchJson<SofaScoreTeamSeasonStatsResponse>(homeSeasonUrl),
    fetchJson<SofaScoreTeamSeasonStatsResponse>(awaySeasonUrl),
  ]);
  const pickXgAvg = (res: SofaScoreTeamSeasonStatsResponse | null): number | undefined => {
    const items = res?.statistics ?? [];
    for (const it of items) {
      const n = (it.name ?? "").toLowerCase();
      if (n.includes("expected goals") || n.includes("xg")) {
        const v = typeof it.value === "number" ? it.value : parseFloat(String(it.value ?? ""));
        if (!Number.isNaN(v)) return v;
      }
    }
    return undefined;
  };
  homeForm.seasonAvgXg = pickXgAvg(homeSeason);
  awayForm.seasonAvgXg = pickXgAvg(awaySeason);

  const h2hEvents = h2hRes?.events ?? h2hRes?.data?.events ?? [];
  const h2h: SofaScoreH2HMatch[] = h2hEvents.slice(0, 5).map((ev) => ({
    homeName: ev.homeTeam?.name ?? "?",
    awayName: ev.awayTeam?.name ?? "?",
    homeScore: ev.homeScore?.current ?? 0,
    awayScore: ev.awayScore?.current ?? 0,
    date:
      ev.startTimestamp != null
        ? new Date(ev.startTimestamp * 1000).toLocaleDateString("nb-NO", {
            day: "numeric",
            month: "short",
          })
        : undefined,
  }));

  const data: SofaScoreMatchData = {
    homeForm,
    awayForm,
    injuries: {
      home: parseInjuries(homeInjuriesRes),
      away: parseInjuries(awayInjuriesRes),
    },
    h2h,
    eventId: event.id,
  };

  setCached(key, data);
  return data;
}

// --- Recommendation adjustments using SofaScore ---

const CONFIDENCE_DELTA_INJURY = 10; // reduce confidence for attacking bets when team has injuries
const CONFIDENCE_DELTA_HIGH_XG = 5;  // increase for Over 2.5 / BTTS Yes when both teams xG 1.5+
const CONFIDENCE_DELTA_WON_LAST_5 = 5; // increase for Asian Handicap when that team won last 5

function selectionRefersToHome(selection: string, homeName: string, homeShort: string | null): boolean {
  const s = selection.toLowerCase();
  const h = (homeShort ?? homeName).toLowerCase();
  const hFull = homeName.toLowerCase();
  return s.includes(h) || s.includes(hFull) || h.includes(s.split(/\s+/)[0] ?? "");
}

function selectionRefersToAway(selection: string, awayName: string, awayShort: string | null): boolean {
  const s = selection.toLowerCase();
  const a = (awayShort ?? awayName).toLowerCase();
  const aFull = awayName.toLowerCase();
  return s.includes(a) || s.includes(aFull) || a.includes(s.split(/\s+/)[0] ?? "");
}

/**
 * Adjust recommendation confidence scores using SofaScore data.
 * - Key player injured (any injury) on a team → lower confidence for that team's attacking bets (Over, BTTS Yes).
 * - Both teams season xG 1.5+ → increase confidence for Over 2.5 and BTTS Yes.
 * - Team won last 5 → increase confidence for their Asian Handicap.
 */
export function adjustRecommendationsWithSofaScore(
  recommendations: BetRecommendation[],
  sofascore: SofaScoreMatchData | null,
  homeName: string,
  awayName: string,
  homeShort: string | null,
  awayShort: string | null
): BetRecommendation[] {
  if (!sofascore) return recommendations;

  const homeInjuries = sofascore.injuries.home.length;
  const awayInjuries = sofascore.injuries.away.length;
  const homeXg = sofascore.homeForm.seasonAvgXg ?? 0;
  const awayXg = sofascore.awayForm.seasonAvgXg ?? 0;
  const bothHighXg = homeXg >= 1.5 && awayXg >= 1.5;
  const homeWonLast5 =
    sofascore.homeForm.last5.length === 5 &&
    sofascore.homeForm.last5.every((f) => f.result === "W");
  const awayWonLast5 =
    sofascore.awayForm.last5.length === 5 &&
    sofascore.awayForm.last5.every((f) => f.result === "W");

  return recommendations.map((r) => {
    let delta = 0;

    if (r.market === "totals" && r.selection.toLowerCase().includes("over")) {
      if (homeInjuries > 0) delta -= CONFIDENCE_DELTA_INJURY;
      if (awayInjuries > 0) delta -= CONFIDENCE_DELTA_INJURY;
      if (bothHighXg) {
        const line = r.selection.match(/(\d+(?:[.,]\d+)?)/)?.[1];
        const lineNum = line ? parseFloat(line.replace(",", ".")) : 0;
        if (lineNum >= 2.5) delta += CONFIDENCE_DELTA_HIGH_XG;
      }
    }

    if (r.market === "btts" && (r.selection.toLowerCase().includes("yes") || r.selection.toLowerCase().includes("ja"))) {
      if (homeInjuries > 0) delta -= CONFIDENCE_DELTA_INJURY;
      if (awayInjuries > 0) delta -= CONFIDENCE_DELTA_INJURY;
      if (bothHighXg) delta += CONFIDENCE_DELTA_HIGH_XG;
    }

    if (r.market === "spreads") {
      if (homeWonLast5 && selectionRefersToHome(r.selection, homeName, homeShort)) delta += CONFIDENCE_DELTA_WON_LAST_5;
      if (awayWonLast5 && selectionRefersToAway(r.selection, awayName, awayShort)) delta += CONFIDENCE_DELTA_WON_LAST_5;
    }

    const confidenceScore = Math.max(0, Math.min(100, (r.confidenceScore ?? 50) + delta));
    return { ...r, confidenceScore };
  });
}

/**
 * Build a short text summary of SofaScore data for the AI analysis prompt.
 */
export function buildSofaScoreContextSummary(sofascore: SofaScoreMatchData | null): string {
  if (!sofascore) return "";
  const parts: string[] = [];
  if (sofascore.injuries.home.length > 0) {
    parts.push(
      `Hjemmelag skader/suspensjoner: ${sofascore.injuries.home.map((p) => `${p.name}${p.reason ? ` (${p.reason})` : ""}`).join(", ")}.`
    );
  }
  if (sofascore.injuries.away.length > 0) {
    parts.push(
      `Bortelag skader/suspensjoner: ${sofascore.injuries.away.map((p) => `${p.name}${p.reason ? ` (${p.reason})` : ""}`).join(", ")}.`
    );
  }
  const hXg = sofascore.homeForm.seasonAvgXg;
  const aXg = sofascore.awayForm.seasonAvgXg;
  if (hXg != null || aXg != null) {
    parts.push(
      `xG sesongsnitt: ${sofascore.homeForm.teamName} ${hXg?.toFixed(2) ?? "–"}, ${sofascore.awayForm.teamName} ${aXg?.toFixed(2) ?? "–"}.`
    );
  }
  const hForm = sofascore.homeForm.last5.map((f) => f.result).join("");
  const aForm = sofascore.awayForm.last5.map((f) => f.result).join("");
  if (hForm || aForm) {
    parts.push(`Form siste 5: ${sofascore.homeForm.teamName} ${hForm || "–"}, ${sofascore.awayForm.teamName} ${aForm || "–"}.`);
  }
  return parts.join(" ");
}
