/**
 * Jurisdiction comparison.
 *
 * Answers "how do regulatory requirements differ across jurisdictions?" over
 * the curated, source-cited policy dataset. Every comparison cell carries the
 * primary sources behind it, so a user can audit the claim rather than trust an
 * aggregate.
 *
 * The risk figures reuse the documented category weighting from
 * `services/analytics.ts`, so a jurisdiction's risk here is comparable with the
 * dashboard's global risk index.
 */

import { CATEGORY_WEIGHTS, loadPolicyRows, type PolicyRow } from './analytics';
import type { PolicyCategory } from './ingest/policies';

/** A citation back to the dataset record that contributed to a figure. */
export interface SourceRef {
  id: string;
  title: string;
  category: string;
  severity: number;
  eventDate: string;
  sourceName: string;
  sourceUrl: string;
}

export interface JurisdictionProfile {
  jurisdiction: string;
  regulationCount: number;
  categories: Record<string, number>;
  averageSeverity: number;
  maxSeverity: number;
  riskIndex: number;
  latestEventDate: string;
  impactAreas: Array<{ area: string; count: number }>;
  survivalSignals: Array<{ signal: string; count: number }>;
  sources: SourceRef[];
}

export interface ComparisonCell {
  jurisdiction: string;
  category: string;
  count: number;
  averageSeverity: number;
  maxSeverity: number;
  risk: number;
  sources: SourceRef[];
}

export interface ComparisonResult {
  generatedAt: string;
  jurisdictions: string[];
  categories: string[];
  cells: ComparisonCell[];
  /** Categories with at least one record, per jurisdiction. */
  coverage: Record<string, number>;
  profiles: JurisdictionProfile[];
}

function toSourceRef(row: PolicyRow): SourceRef {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    eventDate: row.eventDate,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
  };
}

/**
 * Severity-weighted risk (0..100) for a set of rows. Matches the global
 * definition: Σ(severity × categoryWeight) normalised against 5 × rowCount.
 */
export function riskForRows(rows: PolicyRow[]): number {
  if (rows.length === 0) return 0;
  const raw = rows.reduce((sum, r) => {
    const weight = CATEGORY_WEIGHTS[r.category as PolicyCategory] ?? 0.5;
    return sum + r.severity * weight;
  }, 0);
  return Math.round((raw / (rows.length * 5)) * 1000) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function topCounts(values: string[], limit = 5): Array<{ key: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return Object.entries(counts)
    .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function profileFor(jurisdiction: string, rows: PolicyRow[]): JurisdictionProfile {
  const categories: Record<string, number> = {};
  for (const r of rows) categories[r.category] = (categories[r.category] ?? 0) + 1;
  const severities = rows.map((r) => r.severity);
  return {
    jurisdiction,
    regulationCount: rows.length,
    categories,
    averageSeverity: rows.length ? round2(severities.reduce((a, b) => a + b, 0) / rows.length) : 0,
    maxSeverity: severities.length ? Math.max(...severities) : 0,
    riskIndex: riskForRows(rows),
    latestEventDate: rows.reduce((max, r) => (r.eventDate > max ? r.eventDate : max), ''),
    impactAreas: topCounts(rows.flatMap((r) => r.impact)).map(({ key, count }) => ({
      area: key,
      count,
    })),
    survivalSignals: topCounts(rows.flatMap((r) => r.survivalSignals)).map(({ key, count }) => ({
      signal: key,
      count,
    })),
    sources: rows
      .slice()
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate))
      .map(toSourceRef),
  };
}

/** Every jurisdiction present in the dataset, with headline figures. */
export function listJurisdictions(): Array<
  Pick<JurisdictionProfile, 'jurisdiction' | 'regulationCount' | 'riskIndex' | 'latestEventDate'>
> {
  const rows = loadPolicyRows();
  const byJurisdiction = new Map<string, PolicyRow[]>();
  for (const r of rows) {
    const list = byJurisdiction.get(r.jurisdiction) ?? [];
    list.push(r);
    byJurisdiction.set(r.jurisdiction, list);
  }
  return [...byJurisdiction.entries()]
    .map(([jurisdiction, list]) => ({
      jurisdiction,
      regulationCount: list.length,
      riskIndex: riskForRows(list),
      latestEventDate: list.reduce((max, r) => (r.eventDate > max ? r.eventDate : max), ''),
    }))
    .sort((a, b) => b.riskIndex - a.riskIndex || a.jurisdiction.localeCompare(b.jurisdiction));
}

/** Full profile for one jurisdiction. `null` when the dataset has no records. */
export function jurisdictionProfile(id: string): JurisdictionProfile | null {
  const rows = loadPolicyRows().filter((r) => r.jurisdiction === id);
  if (rows.length === 0) return null;
  return profileFor(id, rows);
}

/**
 * Compare jurisdictions side by side, optionally narrowed to one category.
 *
 * `cells` is sparse — only jurisdiction × category combinations with data are
 * returned — and every cell carries its sources, so the comparison is traceable
 * back to primary material.
 */
export function compareJurisdictions(ids: string[], category?: string): ComparisonResult {
  const all = loadPolicyRows();
  const wanted = ids.length > 0 ? ids : [...new Set(all.map((r) => r.jurisdiction))];
  const scoped = all.filter((r) => wanted.includes(r.jurisdiction));
  const rows = category ? scoped.filter((r) => r.category === category) : scoped;

  const cellMap = new Map<string, ComparisonCell>();
  for (const row of rows) {
    const key = `${row.jurisdiction}\u0000${row.category}`;
    const cell =
      cellMap.get(key) ??
      ({
        jurisdiction: row.jurisdiction,
        category: row.category,
        count: 0,
        averageSeverity: 0,
        maxSeverity: 0,
        risk: 0,
        sources: [],
      } satisfies ComparisonCell);
    cell.count += 1;
    cell.maxSeverity = Math.max(cell.maxSeverity, row.severity);
    cell.sources.push(toSourceRef(row));
    cellMap.set(key, cell);
  }

  const cells = [...cellMap.values()].map((cell) => {
    const cellRows = rows.filter(
      (r) => r.jurisdiction === cell.jurisdiction && r.category === cell.category,
    );
    return {
      ...cell,
      averageSeverity: round2(cellRows.reduce((s, r) => s + r.severity, 0) / cellRows.length),
      risk: riskForRows(cellRows),
      sources: cell.sources.sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    };
  });

  const coverage: Record<string, number> = {};
  for (const cell of cells) {
    coverage[cell.jurisdiction] = (coverage[cell.jurisdiction] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    jurisdictions: [...new Set(rows.map((r) => r.jurisdiction))].sort(),
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    cells: cells.sort(
      (a, b) =>
        a.jurisdiction.localeCompare(b.jurisdiction) || a.category.localeCompare(b.category),
    ),
    coverage,
    profiles: wanted
      .map((id) => {
        const list = rows.filter((r) => r.jurisdiction === id);
        return list.length ? profileFor(id, list) : null;
      })
      .filter((p): p is JurisdictionProfile => p !== null),
  };
}
