/**
 * Reproducible analytics over the ingested regulatory dataset.
 *
 * All aggregations are pure functions of the persisted rows (deterministic,
 * unit-tested). No randomness, no external calls. The risk index is a
 * documented weighted formula: severity × category weight, normalised to 0..100.
 *
 * Added intelligence surfaces:
 *  - timeline        — policy activity by month (charts).
 *  - heatmap         — jurisdiction × category severity-weighted matrix.
 *  - impact          — ecosystem-impact area aggregation (per curated record).
 *  - survivalSignals — project-survival signal aggregation.
 *  - jurisdictionRisk— per-jurisdiction risk index (0..100).
 */

import { getDb } from '../db';
import type { ImpactArea, PolicyCategory, SurvivalSignal } from './ingest/policies';

export interface PolicyRow {
  id: string;
  title: string;
  jurisdiction: string;
  category: string;
  eventDate: string;
  severity: number;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  ingestionSource: string;
  impact: ImpactArea[];
  survivalSignals: SurvivalSignal[];
}

/** Category weights used by the risk index (documented in docs/DATA.md). */
export const CATEGORY_WEIGHTS: Record<PolicyCategory, number> = {
  'stablecoin-regulation': 1.0,
  sanctions: 1.0,
  'anti-money-laundering': 0.9,
  'crypto-markets': 0.8,
  'cross-border-payments': 0.7,
  securities: 0.6,
  'consumer-protection': 0.5,
  'data-protection': 0.4,
  taxation: 0.3,
  'operational-resilience': 0.3,
};

export function loadPolicyRows(): PolicyRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, jurisdiction, category, event_date AS eventDate,
              severity, summary, source_name AS sourceName, source_url AS sourceUrl,
              ingestion_source AS ingestionSource, impact, survival_signals AS survivalSignals
       FROM regulatory_events`,
    )
    .all() as unknown as Array<
    Omit<PolicyRow, 'impact' | 'survivalSignals'> & {
      impact: string;
      survivalSignals: string;
    }
  >;
  return rows.map((r) => ({
    ...r,
    impact: safeJsonArray(r.impact) as ImpactArea[],
    survivalSignals: safeJsonArray(r.survivalSignals) as SurvivalSignal[],
  }));
}

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Risk index (0..100) for a list of policy rows. Deterministic. */
export function computeRiskIndex(rows: PolicyRow[]): number {
  if (rows.length === 0) return 0;
  const raw = rows.reduce((sum, r) => {
    const weight = CATEGORY_WEIGHTS[r.category as PolicyCategory] ?? 0.5;
    return sum + r.severity * weight;
  }, 0);
  // Normalise: max plausible total = 5 (severity) * 1.0 (weight) * row count.
  const normalised = (raw / (rows.length * 5)) * 100;
  return Math.round(normalised * 10) / 10;
}

export interface TimelinePoint {
  month: string; // YYYY-MM
  count: number;
  averageSeverity: number;
}

export interface HeatmapCell {
  jurisdiction: string;
  category: string;
  count: number;
  severityScore: number; // Σ(severity) — for colouring
  risk: number; // severity-weighted index 0..100 within this cell
}

export interface ImpactAggregate {
  area: ImpactArea;
  count: number;
  totalSeverity: number;
}

export interface SurvivalSignalAggregate {
  signal: SurvivalSignal;
  count: number;
  totalSeverity: number;
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  totals: {
    events: number;
    jurisdictions: number;
    categories: number;
    averageSeverity: number;
  };
  riskIndex: number;
  byJurisdiction: Record<string, number>;
  byCategory: Record<string, number>;
  bySeverity: Record<number, number>;
  byYear: Record<string, number>;
  timeline: TimelinePoint[];
  heatmap: HeatmapCell[];
  impact: ImpactAggregate[];
  survivalSignals: SurvivalSignalAggregate[];
  jurisdictionRisk: Record<string, number>;
}

export function computeAnalytics(): AnalyticsSnapshot {
  const rows = loadPolicyRows();
  const byJurisdiction: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byYear: Record<string, number> = {};
  const byMonth: Record<string, { count: number; sevSum: number }> = {};
  const heatmapKey: Record<string, HeatmapCell> = {};
  const impactAgg: Record<string, ImpactAggregate> = {};
  const signalAgg: Record<string, SurvivalSignalAggregate> = {};

  for (const r of rows) {
    byJurisdiction[r.jurisdiction] = (byJurisdiction[r.jurisdiction] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    const year = r.eventDate.slice(0, 4);
    byYear[year] = (byYear[year] ?? 0) + 1;
    const month = r.eventDate.slice(0, 7);
    const m = byMonth[month] ?? { count: 0, sevSum: 0 };
    m.count += 1;
    m.sevSum += r.severity;
    byMonth[month] = m;

    const key = `${r.jurisdiction}\u0000${r.category}`;
    const cell = heatmapKey[key] ?? {
      jurisdiction: r.jurisdiction,
      category: r.category,
      count: 0,
      severityScore: 0,
      risk: 0,
    };
    cell.count += 1;
    cell.severityScore += r.severity;
    heatmapKey[key] = cell;

    for (const area of r.impact) {
      const a = impactAgg[area] ?? { area, count: 0, totalSeverity: 0 };
      a.count += 1;
      a.totalSeverity += r.severity;
      impactAgg[area] = a;
    }
    for (const signal of r.survivalSignals) {
      const s = signalAgg[signal] ?? { signal, count: 0, totalSeverity: 0 };
      s.count += 1;
      s.totalSeverity += r.severity;
      signalAgg[signal] = s;
    }
  }

  const averageSeverity =
    rows.length === 0
      ? 0
      : Math.round((rows.reduce((s, r) => s + r.severity, 0) / rows.length) * 100) / 100;

  const timeline: TimelinePoint[] = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      count: v.count,
      averageSeverity: Math.round((v.sevSum / v.count) * 100) / 100,
    }));

  const heatmap: HeatmapCell[] = Object.values(heatmapKey).map((cell) => ({
    ...cell,
    // Cell risk = weighted severity score normalised to the max plausible 5/event.
    risk: Math.min(100, Math.round((cell.severityScore / (cell.count * 5)) * 100)),
  }));

  const jurisdictionRisk: Record<string, number> = {};
  for (const jurisdiction of Object.keys(byJurisdiction)) {
    jurisdictionRisk[jurisdiction] = computeRiskIndex(
      rows.filter((r) => r.jurisdiction === jurisdiction),
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      events: rows.length,
      jurisdictions: Object.keys(byJurisdiction).length,
      categories: Object.keys(byCategory).length,
      averageSeverity,
    },
    riskIndex: computeRiskIndex(rows),
    byJurisdiction: sortDesc(byJurisdiction),
    byCategory: sortDesc(byCategory),
    bySeverity,
    byYear: sortAsc(byYear),
    timeline,
    heatmap,
    impact: Object.values(impactAgg).sort((a, b) => b.totalSeverity - a.totalSeverity),
    survivalSignals: Object.values(signalAgg).sort((a, b) => b.totalSeverity - a.totalSeverity),
    jurisdictionRisk,
  };
}

function sortDesc(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).sort(([, a], [, b]) => b - a));
}

function sortAsc(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
