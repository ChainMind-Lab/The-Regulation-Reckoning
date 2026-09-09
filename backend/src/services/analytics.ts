/**
 * Reproducible analytics over the ingested regulatory dataset.
 *
 * All aggregations are pure functions of the persisted rows (deterministic,
 * unit-tested). No randomness, no external calls. The risk index is a
 * documented weighted formula: severity × category weight, normalised to 0..100.
 */

import { getDb } from '../db';
import type { PolicyCategory } from './ingest/policies';

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
              ingestion_source AS ingestionSource
       FROM regulatory_events`,
    )
    .all() as unknown as PolicyRow[];
  return rows;
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
}

export function computeAnalytics(): AnalyticsSnapshot {
  const rows = loadPolicyRows();
  const byJurisdiction: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byYear: Record<string, number> = {};

  for (const r of rows) {
    byJurisdiction[r.jurisdiction] = (byJurisdiction[r.jurisdiction] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    const year = r.eventDate.slice(0, 4);
    byYear[year] = (byYear[year] ?? 0) + 1;
  }

  const averageSeverity =
    rows.length === 0
      ? 0
      : Math.round((rows.reduce((s, r) => s + r.severity, 0) / rows.length) * 100) / 100;

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
  };
}

function sortDesc(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).sort(([, a], [, b]) => b - a));
}

function sortAsc(obj: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}
