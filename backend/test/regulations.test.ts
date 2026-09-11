import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, getDb } from '../src/db';
import {
  acknowledgeAlert,
  classifyChange,
  contentHash,
  detectRegulationChanges,
  diffSnapshots,
  diffVersions,
  latestVersion,
  listAlerts,
  listVersions,
  type RegulationSnapshot,
} from '../src/services/regulations';

function snapshot(overrides: Partial<RegulationSnapshot> = {}): RegulationSnapshot {
  return {
    title: 'EU MiCA stablecoin rules enter into force',
    jurisdiction: 'EU',
    category: 'stablecoin-regulation',
    eventDate: '2024-06-30',
    severity: 4,
    summary: 'Title III of MiCA applies to asset-referenced and e-money tokens in the EU.',
    sourceName: 'European Commission',
    sourceUrl: 'https://finance.ec.europa.eu/digital-finance/markets-crypto-assets-mica_en',
    impact: ['stablecoin-issuers', 'exchanges'],
    survivalSignals: ['licensing-requirements'],
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
});

describe('contentHash', () => {
  it('is deterministic for the same input', () => {
    expect(contentHash(snapshot())).toBe(contentHash(snapshot()));
  });

  it('ignores the ordering of tag arrays', () => {
    const a = snapshot({ impact: ['a', 'b'] });
    const b = snapshot({ impact: ['b', 'a'] });
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('changes when a tracked field changes', () => {
    expect(contentHash(snapshot())).not.toBe(contentHash(snapshot({ severity: 5 })));
    expect(contentHash(snapshot())).not.toBe(contentHash(snapshot({ title: 'Other title here' })));
    expect(contentHash(snapshot())).not.toBe(
      contentHash(snapshot({ impact: ['stablecoin-issuers'] })),
    );
  });
});

describe('diffSnapshots', () => {
  it('reports only the changed fields', () => {
    const changes = diffSnapshots(snapshot(), snapshot({ severity: 5, sourceUrl: 'https://x.test' }));
    expect(changes.map((c) => c.field).sort()).toEqual(['severity', 'sourceUrl']);
    expect(changes.find((c) => c.field === 'severity')).toMatchObject({ from: 4, to: 5 });
  });

  it('returns nothing for identical snapshots', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([]);
  });

  it('compares tag arrays order-insensitively', () => {
    expect(diffSnapshots(snapshot({ impact: ['a', 'b'] }), snapshot({ impact: ['b', 'a'] }))).toEqual(
      [],
    );
  });
});

describe('classifyChange', () => {
  it('classifies a first-seen regulation as informational', () => {
    expect(classifyChange('new', [])).toEqual({
      alertType: 'new-regulation',
      severity: 'info',
    });
  });

  it('classifies a severity bump by magnitude', () => {
    const oneStep = classifyChange('updated', [{ field: 'severity', from: 3, to: 4 }]);
    expect(oneStep).toEqual({ alertType: 'severity-escalation', severity: 'warning' });

    const bigJump = classifyChange('updated', [{ field: 'severity', from: 1, to: 4 }]);
    expect(bigJump).toEqual({ alertType: 'severity-escalation', severity: 'critical' });
  });

  it('classifies a downgrade as informational rather than critical', () => {
    const change = classifyChange('updated', [{ field: 'severity', from: 5, to: 4 }]);
    expect(change.severity).toBe('info');
  });

  it('treats a source or summary change as a warning', () => {
    expect(classifyChange('updated', [{ field: 'sourceUrl', from: 'a', to: 'b' }]).severity).toBe(
      'warning',
    );
  });
});

describe('detectRegulationChanges', () => {
  it('records a version 1 baseline on first sight, without alerting', () => {
    const result = detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    expect(result.versionsCreated).toBe(1);
    expect(result.alertsRaised).toBe(0);
    expect(latestVersion('eu-mica')?.version).toBe(1);
    expect(latestVersion('eu-mica')?.changeType).toBe('new');
    expect(listAlerts()).toHaveLength(0);
  });

  it('is idempotent: re-running an unchanged dataset adds nothing', () => {
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    const second = detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    expect(second.versionsCreated).toBe(0);
    expect(second.alertsRaised).toBe(0);
    expect(listVersions('eu-mica')).toHaveLength(1);
  });

  it('appends a revision and raises an alert when a regulation changes', () => {
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    const result = detectRegulationChanges([
      { id: 'eu-mica', ...snapshot({ severity: 5, summary: 'A materially updated summary.' }) },
    ]);

    expect(result.versionsCreated).toBe(1);
    expect(result.alertsRaised).toBe(1);
    expect(result.changed).toEqual(['eu-mica']);
    expect(latestVersion('eu-mica')?.version).toBe(2);

    const alerts = listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertType).toBe('severity-escalation');
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].changedFields.map((c) => c.field).sort()).toEqual(['severity', 'summary']);
    expect(alerts[0].sourceUrl).toContain('https://');
  });

  it('keeps prior revisions immutable so history is auditable', () => {
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot({ severity: 5 }) }]);

    const versions = listVersions('eu-mica');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].severity).toBe(5);
    expect(versions[1].severity).toBe(4);
    expect(versions[0].contentHash).not.toBe(versions[1].contentHash);
  });

  it('diffs two stored revisions', () => {
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot({ severity: 5 }) }]);
    const diff = diffVersions('eu-mica', 1, 2);
    expect(diff?.changes).toEqual([{ field: 'severity', from: 4, to: 5 }]);
    expect(diffVersions('eu-mica', 1, 9)).toBeNull();
  });
});

describe('alerts', () => {
  it('filters by severity and can be acknowledged', () => {
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot() }]);
    detectRegulationChanges([
      { id: 'eu-mica', ...snapshot({ severity: 1 }) },
    ]);
    // Escalation to a *higher* severity is the interesting case.
    detectRegulationChanges([{ id: 'eu-mica', ...snapshot({ severity: 4 }) }]);

    // Two alerts so far: an informational downgrade and a critical escalation.
    expect(listAlerts()).toHaveLength(2);
    const critical = listAlerts({ severity: 'critical' });
    expect(critical).toHaveLength(1);
    expect(acknowledgeAlert(critical[0].id)).toBe(true);
    expect(listAlerts({ acknowledged: false })).toHaveLength(1);
    expect(listAlerts({ acknowledged: true })).toHaveLength(1);
    expect(acknowledgeAlert('nope')).toBe(false);
  });

  it('caps the returned number of alerts', () => {
    expect(listAlerts({ limit: 1 }).length).toBeLessThanOrEqual(1);
  });

  it('records one row per policy revision in regulation_versions', () => {
    detectRegulationChanges([
      { id: 'p1', ...snapshot() },
      { id: 'p2', ...snapshot({ title: 'A second regulation about payments' }) },
    ]);
    const db = getDb();
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM regulation_versions').get() as { c: number }
    ).c;
    expect(count).toBe(2);
  });
});
