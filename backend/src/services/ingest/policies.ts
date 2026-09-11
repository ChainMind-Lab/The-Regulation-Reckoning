/**
 * Regulatory policy ingestion pipeline.
 *
 * Stage 1 — Load: read `backend/data/policy-regulations.json` (versioned,
 * source-cited dataset). Could be swapped for an API-backed source.
 * Stage 2 — Validate: schema + domain validation; invalid records fail loudly.
 * Stage 3 — Classify: derive a deterministic severity score and region from the
 *           raw record fields (pure function, unit-tested).
 * Stage 4 — Persist: upsert into `regulatory_events` and record an `ingest_runs`
 *           audit row. Ingestion is idempotent (records keyed by `id`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../db';
import { logger } from '../../logger';
import { metrics } from '../../metrics';
import {
  contentHash,
  detectRegulationChanges,
  type RegulationSnapshot,
} from '../regulations';

export const POLICY_CATEGORIES = [
  'stablecoin-regulation',
  'crypto-markets',
  'anti-money-laundering',
  'securities',
  'data-protection',
  'cross-border-payments',
  'sanctions',
  'taxation',
  'consumer-protection',
  'operational-resilience',
] as const;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** Ecosystem-impact taxonomy (curated per record in the dataset). */
export const IMPACT_AREAS = [
  'stablecoin-issuers',
  'exchanges',
  'cross-border-payments',
  'wallets-and-custody',
  'defi-protocols',
  'institutional-adoption',
  'tokenization',
  'sanctions-compliance',
  'consumer-protection',
  'infrastructure-providers',
] as const;

export type ImpactArea = (typeof IMPACT_AREAS)[number];

/** Project-survival signal taxonomy (curated per record in the dataset). */
export const SURVIVAL_SIGNALS = [
  'higher-compliance-cost',
  'licensing-requirements',
  'jurisdiction-shift',
  'delisting-risk',
  'reserve-and-audit-requirements',
  'disclosure-burden',
  'operational-risk-management',
  'enforcement-action',
  'market-access-barrier',
  'capital-requirement',
] as const;

export type SurvivalSignal = (typeof SURVIVAL_SIGNALS)[number];

export interface RawPolicyRecord {
  id: string;
  title: string;
  jurisdiction: string; // ISO-3166 alpha-2, or 'GLOBAL'
  category: string;
  eventDate: string; // YYYY-MM-DD
  summary: string;
  sourceName: string;
  sourceUrl: string;
  scope: 'global' | 'regional' | 'national';
  enforcement: 'none' | 'warning' | 'action';
  impact?: ImpactArea[]; // ecosystem areas affected
  survival_signals?: SurvivalSignal[]; // project-survival implications
}

export interface ClassifiedPolicyRecord extends RawPolicyRecord {
  severity: number; // 1..5
}

// ── Validation ────────────────────────────────────────────────────

export function validatePolicyRecord(r: RawPolicyRecord): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9-]{3,80}$/.test(r.id)) errors.push(`id invalid: ${r.id}`);
  if (!r.title || r.title.length < 10) errors.push(`title too short for ${r.id}`);
  if (!/^([A-Z]{2}|GLOBAL)$/.test(r.jurisdiction)) {
    errors.push(`jurisdiction invalid for ${r.id}: ${r.jurisdiction}`);
  }
  if (!(POLICY_CATEGORIES as readonly string[]).includes(r.category)) {
    errors.push(`category invalid for ${r.id}: ${r.category}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.eventDate) || Number.isNaN(Date.parse(r.eventDate))) {
    errors.push(`eventDate invalid for ${r.id}: ${r.eventDate}`);
  }
  if (!r.summary || r.summary.length < 20) errors.push(`summary too short for ${r.id}`);
  if (!r.sourceName) errors.push(`sourceName missing for ${r.id}`);
  if (!/^https?:\/\//.test(r.sourceUrl)) errors.push(`sourceUrl invalid for ${r.id}`);
  if (!['global', 'regional', 'national'].includes(r.scope)) {
    errors.push(`scope invalid for ${r.id}: ${r.scope}`);
  }
  if (!['none', 'warning', 'action'].includes(r.enforcement)) {
    errors.push(`enforcement invalid for ${r.id}: ${r.enforcement}`);
  }
  if (r.impact !== undefined) {
    if (!Array.isArray(r.impact) || r.impact.length === 0) {
      errors.push(`impact must be a non-empty array for ${r.id}`);
    } else {
      for (const a of r.impact) {
        if (!(IMPACT_AREAS as readonly string[]).includes(a)) {
          errors.push(`impact area invalid for ${r.id}: ${a}`);
        }
      }
    }
  }
  if (r.survival_signals !== undefined) {
    if (!Array.isArray(r.survival_signals) || r.survival_signals.length === 0) {
      errors.push(`survival_signals must be a non-empty array for ${r.id}`);
    } else {
      for (const s of r.survival_signals) {
        if (!(SURVIVAL_SIGNALS as readonly string[]).includes(s)) {
          errors.push(`survival signal invalid for ${r.id}: ${s}`);
        }
      }
    }
  }
  return errors;
}

// ── Classification (pure, deterministic) ──────────────────────────

/** Base severity by category: how directly a rule touches Stellar-style rails. */
const CATEGORY_BASE: Record<string, number> = {
  'stablecoin-regulation': 4,
  'anti-money-laundering': 4,
  sanctions: 4,
  'crypto-markets': 3,
  securities: 3,
  taxation: 2,
  'consumer-protection': 2,
  'data-protection': 2,
  'cross-border-payments': 3,
  'operational-resilience': 2,
};

const SCOPE_BONUS: Record<string, number> = { global: 1, regional: 0, national: 0 };
const ENFORCEMENT_BONUS: Record<string, number> = { action: 1, warning: 0, none: -1 };

export function classifyPolicyRecord(r: RawPolicyRecord): ClassifiedPolicyRecord {
  const raw =
    (CATEGORY_BASE[r.category] ?? 2) + SCOPE_BONUS[r.scope] + ENFORCEMENT_BONUS[r.enforcement];
  const severity = Math.min(5, Math.max(1, raw));
  return { ...r, severity };
}

export function classifyPolicyRecords(records: RawPolicyRecord[]): ClassifiedPolicyRecord[] {
  return records.map(classifyPolicyRecord);
}

// ── Load ──────────────────────────────────────────────────────────

export function loadPolicyDataset(): RawPolicyRecord[] {
  const file = join(__dirname, '..', '..', '..', 'data', 'policy-regulations.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    events: RawPolicyRecord[];
  };
  return parsed.events;
}

// ── Persist ───────────────────────────────────────────────────────

/** Convert a classified record into the snapshot shape used for versioning. */
export function toSnapshot(r: ClassifiedPolicyRecord): RegulationSnapshot {
  return {
    title: r.title,
    jurisdiction: r.jurisdiction,
    category: r.category,
    eventDate: r.eventDate,
    severity: r.severity,
    summary: r.summary,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    impact: r.impact ?? [],
    survivalSignals: r.survival_signals ?? [],
  };
}

export function persistPolicies(
  records: ClassifiedPolicyRecord[],
  versions: Record<string, number> = {},
): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO regulatory_events
      (id, title, jurisdiction, category, event_date, severity, summary, source_name, source_url, ingested_at, ingestion_source, impact, survival_signals, content_hash, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dataset', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      jurisdiction = excluded.jurisdiction,
      category = excluded.category,
      event_date = excluded.event_date,
      severity = excluded.severity,
      summary = excluded.summary,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      ingested_at = excluded.ingested_at,
      impact = excluded.impact,
      survival_signals = excluded.survival_signals,
      content_hash = excluded.content_hash,
      version = excluded.version
  `);
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const r of records) {
      upsert.run(
        r.id,
        r.title,
        r.jurisdiction,
        r.category,
        r.eventDate,
        r.severity,
        r.summary,
        r.sourceName,
        r.sourceUrl,
        now,
        JSON.stringify(r.impact ?? []),
        JSON.stringify(r.survival_signals ?? []),
        contentHash(toSnapshot(r)),
        versions[r.id] ?? 1,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.inc('ingest_records_total', { pipeline: 'policies' }, records.length);
  return records.length;
}

export function recordIngestRun(
  pipeline: string,
  status: 'success' | 'error',
  records: number,
  message?: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO ingest_runs (id, pipeline, status, records, message, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    pipeline,
    status,
    records,
    message ?? null,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

/**
 * Run the full pipeline:
 * load → validate → classify → detect changes → persist.
 *
 * Change detection runs against the append-only version history, so an
 * unchanged dataset is a no-op and a changed one appends a revision + alert.
 */
export async function ingestPolicies(): Promise<{
  records: number;
  errors: string[];
  versionsCreated: number;
  alertsRaised: number;
  changed: string[];
}> {
  const started = Date.now();
  const raw = loadPolicyDataset();
  const errors: string[] = [];
  for (const r of raw) {
    errors.push(...validatePolicyRecord(r).map((e) => `${r.id}: ${e}`));
  }
  if (errors.length > 0) {
    recordIngestRun('policies', 'error', 0, errors.join('; '));
    throw new Error(`Policy dataset validation failed:\n${errors.join('\n')}`);
  }
  const classified = classifyPolicyRecords(raw);
  const detection = detectRegulationChanges(
    classified.map((r) => ({ id: r.id, ...toSnapshot(r) })),
  );
  const count = persistPolicies(classified, detection.versions);
  recordIngestRun('policies', 'success', count);
  logger.info('ingest.policies: done', {
    records: count,
    versionsCreated: detection.versionsCreated,
    alertsRaised: detection.alertsRaised,
    tookMs: Date.now() - started,
  });
  return {
    records: count,
    errors: [],
    versionsCreated: detection.versionsCreated,
    alertsRaised: detection.alertsRaised,
    changed: detection.changed,
  };
}
