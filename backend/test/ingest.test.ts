import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db';
import {
  classifyPolicyRecord,
  classifyPolicyRecords,
  loadPolicyDataset,
  persistPolicies,
  validatePolicyRecord,
  type RawPolicyRecord,
} from '../src/services/ingest/policies';
import { computeAnalytics, computeRiskIndex } from '../src/services/analytics';

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM regulatory_events');
});

const validRecord: RawPolicyRecord = {
  id: 'eu-mica-stablecoin-rules',
  title: 'EU MiCA stablecoin rules enter into force',
  jurisdiction: 'EU',
  category: 'stablecoin-regulation',
  eventDate: '2024-06-30',
  summary: 'Title III of MiCA applies to asset-referenced and e-money tokens in the EU.',
  sourceName: 'European Commission',
  sourceUrl: 'https://finance.ec.europa.eu/digital-finance/markets-crypto-assets-mica_en',
  scope: 'regional',
  enforcement: 'action',
};

describe('validatePolicyRecord', () => {
  it('accepts a valid record', () => {
    expect(validatePolicyRecord(validRecord)).toEqual([]);
  });

  it('rejects invalid id, jurisdiction, category, date, url, scope, enforcement', () => {
    const errors = validatePolicyRecord({
      ...validRecord,
      id: 'BAD ID!',
      jurisdiction: 'nowhere',
      category: 'not-a-category',
      eventDate: '2024/06/30',
      sourceUrl: 'ftp://nope',
      scope: 'galaxy',
      enforcement: 'maybe',
    });
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects missing source and empty summary/title', () => {
    const errors = validatePolicyRecord({
      ...validRecord,
      sourceName: '',
      summary: 'short',
      title: 'x',
    });
    expect(errors).toContain('title too short for eu-mica-stablecoin-rules');
    expect(errors).toContain('summary too short for eu-mica-stablecoin-rules');
    expect(errors).toContain('sourceName missing for eu-mica-stablecoin-rules');
  });

  it('accepts GLOBAL jurisdiction', () => {
    expect(validatePolicyRecord({ ...validRecord, jurisdiction: 'GLOBAL' })).toEqual([]);
  });

  it('validates impact areas and survival signals against the taxonomy', () => {
    const withValid = {
      ...validRecord,
      impact: ['stablecoin-issuers', 'exchanges'],
      survival_signals: ['licensing-requirements'],
    };
    expect(validatePolicyRecord(withValid)).toEqual([]);

    const badImpact = validatePolicyRecord({
      ...validRecord,
      impact: ['not-an-area'],
    });
    expect(badImpact).toContain('impact area invalid for eu-mica-stablecoin-rules: not-an-area');

    const badSignal = validatePolicyRecord({
      ...validRecord,
      survival_signals: ['not-a-signal'],
    });
    expect(badSignal).toContain(
      'survival signal invalid for eu-mica-stablecoin-rules: not-a-signal',
    );

    const emptyImpact = validatePolicyRecord({ ...validRecord, impact: [] });
    expect(emptyImpact).toContain('impact must be a non-empty array for eu-mica-stablecoin-rules');
  });
});

describe('classifyPolicyRecord', () => {
  it('is deterministic and bounded 1..5', () => {
    const a = classifyPolicyRecord(validRecord);
    const b = classifyPolicyRecord(validRecord);
    expect(a).toEqual(b);
    expect(a.severity).toBeGreaterThanOrEqual(1);
    expect(a.severity).toBeLessThanOrEqual(5);
  });

  it('scores enforcement + scope into severity', () => {
    // Use a low-base category so the +1 bonuses are visible before the cap.
    const lowBase: RawPolicyRecord = { ...validRecord, category: 'taxation' }; // base 2
    const action = classifyPolicyRecord(lowBase); // 2 + 0 (regional) + 1 (action) = 3
    const none = classifyPolicyRecord({ ...lowBase, enforcement: 'none' }); // 2 + 0 - 1 = 1
    const global = classifyPolicyRecord({ ...lowBase, scope: 'global' }); // 2 + 1 + 1 = 4
    expect(action.severity).toBe(3);
    expect(none.severity).toBe(1);
    expect(global.severity).toBe(4);
    expect(action.severity).toBeGreaterThan(none.severity);
    expect(global.severity).toBeGreaterThan(action.severity);
  });
});

describe('ingest pipeline', () => {
  it('loads, validates, classifies and persists the bundled dataset', () => {
    const raw = loadPolicyDataset();
    expect(raw.length).toBeGreaterThanOrEqual(15);
    for (const r of raw) {
      expect(validatePolicyRecord(r)).toEqual([]);
    }
    const classified = classifyPolicyRecords(raw);
    const persisted = persistPolicies(classified);
    expect(persisted).toBe(raw.length);

    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM regulatory_events').get() as { c: number })
      .c;
    expect(count).toBe(raw.length);
  });

  it('is idempotent: re-persisting the same records does not duplicate', () => {
    const raw = loadPolicyDataset();
    persistPolicies(classifyPolicyRecords(raw));
    persistPolicies(classifyPolicyRecords(raw));
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM regulatory_events').get() as { c: number })
      .c;
    expect(count).toBe(raw.length);
  });
});

describe('analytics', () => {
  it('computes a stable risk index for a known set', () => {
    const records = [
      { ...validRecord, id: 'a', severity: 5 },
      { ...validRecord, id: 'b', severity: 1 },
    ].map((r) => ({ ...r, severity: r.severity as number }));
    const rows = records.map((r) => ({
      id: r.id,
      title: r.title,
      jurisdiction: r.jurisdiction,
      category: r.category,
      eventDate: r.eventDate,
      severity: r.severity,
      summary: r.summary,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      ingestionSource: 'test',
    }));
    // (5 + 1) / 2 = 3 avg severity; weight for stablecoin = 1.0 → (5*1 + 1*1)/(2*5) = 0.6 → 60
    expect(computeRiskIndex(rows)).toBe(60);
  });

  it('returns deterministic aggregates from the persisted dataset', () => {
    const raw = loadPolicyDataset();
    persistPolicies(classifyPolicyRecords(raw));

    const snapshot1 = computeAnalytics();
    const snapshot2 = computeAnalytics();
    // Everything except the generatedAt timestamp must be deterministic.
    expect({ ...snapshot1, generatedAt: undefined }).toEqual({
      ...snapshot2,
      generatedAt: undefined,
    });
    expect(snapshot1.totals.events).toBe(raw.length);
    expect(snapshot1.totals.jurisdictions).toBeGreaterThan(5);
    expect(snapshot1.riskIndex).toBeGreaterThan(0);
    expect(snapshot1.riskIndex).toBeLessThanOrEqual(100);
    expect(Object.keys(snapshot1.byYear)).toContain('2024');
  });

  it('exposes timeline, heatmap, impact, survival signals and jurisdiction risk', () => {
    const raw = loadPolicyDataset();
    persistPolicies(classifyPolicyRecords(raw));
    const s = computeAnalytics();

    expect(s.timeline.length).toBeGreaterThanOrEqual(1);
    expect(s.timeline[0].month).toMatch(/^\d{4}-\d{2}$/);
    expect(s.timeline[0].averageSeverity).toBeGreaterThanOrEqual(1);

    expect(s.heatmap.length).toBeGreaterThanOrEqual(10);
    const cell = s.heatmap[0];
    expect(cell.jurisdiction).toBeTruthy();
    expect(cell.category).toBeTruthy();
    expect(cell.risk).toBeGreaterThanOrEqual(0);
    expect(cell.risk).toBeLessThanOrEqual(100);

    expect(s.impact.length).toBeGreaterThan(0);
    expect(s.impact[0].totalSeverity).toBeGreaterThan(0);
    expect(s.survivalSignals.length).toBeGreaterThan(0);
    expect(s.survivalSignals[0].totalSeverity).toBeGreaterThan(0);

    expect(Object.keys(s.jurisdictionRisk)).toContain('EU');
    for (const risk of Object.values(s.jurisdictionRisk)) {
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(100);
    }
  });

  it('persists impact and survival signals in the read model', () => {
    const raw = loadPolicyDataset();
    persistPolicies(classifyPolicyRecords(raw));
    const db = getDb();
    const row = db
      .prepare('SELECT impact, survival_signals FROM regulatory_events LIMIT 1')
      .get() as { impact: string; survival_signals: string };
    expect(JSON.parse(row.impact).length).toBeGreaterThan(0);
    expect(JSON.parse(row.survival_signals).length).toBeGreaterThan(0);
  });
});
