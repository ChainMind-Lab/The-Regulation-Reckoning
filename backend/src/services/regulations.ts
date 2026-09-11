/**
 * Regulation version history + change detection.
 *
 * Every ingestion run hashes each policy record over the fields that materially
 * define it. The hash is compared with the latest stored revision:
 *
 *  - no revision yet      → a `new` baseline revision (version 1)
 *  - hash unchanged       → nothing to do (idempotent; re-running is a no-op)
 *  - hash changed         → a new revision with the field-level diff, plus an
 *                           alert whose severity reflects the nature of the
 *                           change (a severity escalation is critical)
 *
 * History is append-only: `regulation_versions` is never updated in place, so
 * users can audit exactly what a regulation said at any point in time and what
 * changed between revisions.
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { logger } from '../logger';
import { metrics } from '../metrics';

/** The fields tracked for change detection, in a stable order. */
export const TRACKED_FIELDS = [
  'title',
  'jurisdiction',
  'category',
  'eventDate',
  'severity',
  'summary',
  'sourceName',
  'sourceUrl',
  'impact',
  'survivalSignals',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** A snapshot of the fields that define one regulation revision. */
export interface RegulationSnapshot {
  title: string;
  jurisdiction: string;
  category: string;
  eventDate: string;
  severity: number;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  impact: string[];
  survivalSignals: string[];
}

/** A single changed field between two revisions. */
export interface FieldChange {
  field: TrackedField;
  from: string | number | string[];
  to: string | number | string[];
}

export interface RegulationVersion extends RegulationSnapshot {
  id: string;
  policyId: string;
  version: number;
  contentHash: string;
  changedFields: FieldChange[];
  changeType: 'new' | 'updated';
  detectedAt: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface RegulationAlert {
  id: string;
  policyId: string;
  version: number;
  alertType: 'new-regulation' | 'regulation-changed' | 'severity-escalation';
  severity: AlertSeverity;
  title: string;
  message: string;
  changedFields: FieldChange[];
  sourceUrl: string | null;
  createdAt: string;
  acknowledged: boolean;
}

/**
 * Deterministic content hash over the tracked fields.
 *
 * Array fields are sorted so that re-ordering the same set of tags is *not*
 * treated as a change, and a separator that cannot appear in the data is used
 * so that `("ab","c")` and `("a","bc")` cannot collide.
 */
export function contentHash(s: RegulationSnapshot): string {
  const canonical = [
    s.title,
    s.jurisdiction,
    s.category,
    s.eventDate,
    String(s.severity),
    s.summary,
    s.sourceName,
    s.sourceUrl,
    [...s.impact].sort().join(','),
    [...s.survivalSignals].sort().join(','),
  ].join('\u0000');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Field-level diff between two revisions. Pure and deterministic. */
export function diffSnapshots(prev: RegulationSnapshot, next: RegulationSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const before = prev[field];
    const after = next[field];
    if (Array.isArray(before) || Array.isArray(after)) {
      const a = [...((before as string[]) ?? [])].sort();
      const b = [...((after as string[]) ?? [])].sort();
      if (a.join('\u0000') !== b.join('\u0000')) {
        changes.push({ field, from: a, to: b });
      }
      continue;
    }
    if (String(before) !== String(after)) {
      changes.push({ field, from: before as string | number, to: after as string | number });
    }
  }
  return changes;
}

/** Severity classification for a detected change. */
export function classifyChange(
  changeType: 'new' | 'updated',
  diff: FieldChange[],
): { alertType: RegulationAlert['alertType']; severity: AlertSeverity } {
  if (changeType === 'new') return { alertType: 'new-regulation', severity: 'info' };
  const severityChange = diff.find((d) => d.field === 'severity');
  if (severityChange && Number(severityChange.to) > Number(severityChange.from)) {
    const delta = Number(severityChange.to) - Number(severityChange.from);
    return { alertType: 'severity-escalation', severity: delta >= 2 ? 'critical' : 'warning' };
  }
  if (diff.some((d) => d.field === 'sourceUrl' || d.field === 'summary' || d.field === 'title')) {
    return { alertType: 'regulation-changed', severity: 'warning' };
  }
  return { alertType: 'regulation-changed', severity: 'info' };
}

function rowToVersion(row: Record<string, unknown>): RegulationVersion {
  return {
    id: String(row.id),
    policyId: String(row.policy_id),
    version: Number(row.version),
    title: String(row.title),
    jurisdiction: String(row.jurisdiction),
    category: String(row.category),
    eventDate: String(row.event_date),
    severity: Number(row.severity),
    summary: String(row.summary),
    sourceName: String(row.source_name),
    sourceUrl: String(row.source_url),
    contentHash: String(row.content_hash),
    changedFields: safeJson<FieldChange[]>(row.changed_fields, []),
    changeType: String(row.change_type) as 'new' | 'updated',
    detectedAt: String(row.detected_at),
    impact: safeJson<string[]>(row.impact, []),
    survivalSignals: safeJson<string[]>(row.survival_signals, []),
  };
}

function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The latest stored revision for a policy, or null when none exists yet. */
export function latestVersion(policyId: string): RegulationVersion | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM regulation_versions WHERE policy_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(policyId) as Record<string, unknown> | undefined;
  return row ? rowToVersion(row) : null;
}

/** One recorded revision. */
export function getVersion(policyId: string, version: number): RegulationVersion | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM regulation_versions WHERE policy_id = ? AND version = ?`)
    .get(policyId, version) as Record<string, unknown> | undefined;
  return row ? rowToVersion(row) : null;
}

/** Full revision history for a policy, newest first. */
export function listVersions(policyId: string): RegulationVersion[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM regulation_versions WHERE policy_id = ? ORDER BY version DESC`)
    .all(policyId) as unknown as Record<string, unknown>[];
  return rows.map(rowToVersion);
}

/** Every revision recorded so far, newest first. */
export function listAllVersions(limit = 100): RegulationVersion[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM regulation_versions ORDER BY detected_at DESC LIMIT ?`)
    .all(limit) as unknown as Record<string, unknown>[];
  return rows.map(rowToVersion);
}

function insertVersion(
  policyId: string,
  version: number,
  changeType: 'new' | 'updated',
  snapshot: RegulationSnapshot,
  changedFields: FieldChange[],
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO regulation_versions
       (id, policy_id, version, title, jurisdiction, category, event_date, severity, summary,
        source_name, source_url, content_hash, changed_fields, change_type, detected_at, impact, survival_signals)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(policy_id, version) DO NOTHING`,
  ).run(
    `${policyId}:v${version}`,
    policyId,
    version,
    snapshot.title,
    snapshot.jurisdiction,
    snapshot.category,
    snapshot.eventDate,
    snapshot.severity,
    snapshot.summary,
    snapshot.sourceName,
    snapshot.sourceUrl,
    contentHash(snapshot),
    JSON.stringify(changedFields),
    changeType,
    new Date().toISOString(),
    JSON.stringify(snapshot.impact),
    JSON.stringify(snapshot.survivalSignals),
  );
}

function insertAlert(
  policyId: string,
  version: number,
  alertType: RegulationAlert['alertType'],
  severity: AlertSeverity,
  snapshot: RegulationSnapshot,
  changedFields: FieldChange[],
): void {
  const db = getDb();
  const title =
    alertType === 'new-regulation'
      ? `New regulation: ${snapshot.title}`
      : alertType === 'severity-escalation'
        ? `Severity increased: ${snapshot.title}`
        : `Regulation updated: ${snapshot.title}`;
  const message =
    alertType === 'new-regulation'
      ? `${snapshot.jurisdiction} · ${snapshot.category} · severity ${snapshot.severity}`
      : `Fields changed: ${changedFields.map((c) => c.field).join(', ')} (revision v${version})`;
  db.prepare(
    `INSERT INTO regulation_alerts
       (id, policy_id, version, alert_type, severity, title, message, changed_fields, source_url, created_at, acknowledged)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    randomUUID(),
    policyId,
    version,
    alertType,
    severity,
    title,
    message,
    JSON.stringify(changedFields),
    snapshot.sourceUrl,
    new Date().toISOString(),
  );
  metrics.inc('regulation_alerts_total', { severity, type: alertType });
}

export interface ChangeDetectionResult {
  versionsCreated: number;
  alertsRaised: number;
  changed: string[];
  /** Current revision number per policy id, so callers can persist it. */
  versions: Record<string, number>;
}

/**
 * Compare the incoming snapshot set with the stored history, appending a new
 * revision (and alert) for anything new or changed. Idempotent.
 */
export function detectRegulationChanges(
  records: Array<{ id: string } & RegulationSnapshot>,
): ChangeDetectionResult {
  const result: ChangeDetectionResult = {
    versionsCreated: 0,
    alertsRaised: 0,
    changed: [],
    versions: {},
  };
  for (const record of records) {
    const snapshot: RegulationSnapshot = {
      title: record.title,
      jurisdiction: record.jurisdiction,
      category: record.category,
      eventDate: record.eventDate,
      severity: record.severity,
      summary: record.summary,
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      impact: record.impact ?? [],
      survivalSignals: record.survivalSignals ?? [],
    };
    const hash = contentHash(snapshot);
    const previous = latestVersion(record.id);

    if (!previous) {
      insertVersion(record.id, 1, 'new', snapshot, []);
      result.versionsCreated += 1;
      result.versions[record.id] = 1;
      continue;
    }
    if (previous.contentHash === hash) {
      result.versions[record.id] = previous.version;
      continue;
    }

    const version = previous.version + 1;
    result.versions[record.id] = version;
    const diff = diffSnapshots(previous, snapshot);
    insertVersion(record.id, version, 'updated', snapshot, diff);
    const { alertType, severity } = classifyChange('updated', diff);
    insertAlert(record.id, version, alertType, severity, snapshot, diff);
    result.versionsCreated += 1;
    result.alertsRaised += 1;
    result.changed.push(record.id);
    logger.warn('regulation change detected', {
      policyId: record.id,
      version,
      severity,
      fields: diff.map((d) => d.field),
    });
    metrics.inc('regulation_changes_total', { severity });
  }
  return result;
}

export interface AlertQuery {
  policyId?: string;
  severity?: AlertSeverity;
  acknowledged?: boolean;
  limit?: number;
}

/** Alerts raised by change detection, newest first. */
export function listAlerts(query: AlertQuery = {}): RegulationAlert[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.policyId) {
    clauses.push('policy_id = ?');
    params.push(query.policyId);
  }
  if (query.severity) {
    clauses.push('severity = ?');
    params.push(query.severity);
  }
  if (query.acknowledged !== undefined) {
    clauses.push('acknowledged = ?');
    params.push(query.acknowledged ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT * FROM regulation_alerts ${where} ORDER BY created_at DESC, policy_id ASC LIMIT ?`,
    )
    .all(...(params as never[]), limit) as unknown as Record<string, unknown>[];
  return rows.map(
    (row): RegulationAlert => ({
      id: String(row.id),
      policyId: String(row.policy_id),
      version: Number(row.version),
      alertType: String(row.alert_type) as RegulationAlert['alertType'],
      severity: String(row.severity) as AlertSeverity,
      title: String(row.title),
      message: String(row.message),
      changedFields: safeJson<FieldChange[]>(row.changed_fields, []),
      sourceUrl: row.source_url ? String(row.source_url) : null,
      createdAt: String(row.created_at),
      acknowledged: Boolean(row.acknowledged),
    }),
  );
}

/** Mark an alert acknowledged. Returns false when the id is unknown. */
export function acknowledgeAlert(id: string): boolean {
  const db = getDb();
  const res = db.prepare(`UPDATE regulation_alerts SET acknowledged = 1 WHERE id = ?`).run(id);
  return res.changes > 0;
}

/** Field-level diff between two stored revisions of a policy. */
export function diffVersions(
  policyId: string,
  from: number,
  to: number,
): { from: RegulationVersion; to: RegulationVersion; changes: FieldChange[] } | null {
  const a = getVersion(policyId, from);
  const b = getVersion(policyId, to);
  if (!a || !b) return null;
  return { from: a, to: b, changes: diffSnapshots(a, b) };
}
