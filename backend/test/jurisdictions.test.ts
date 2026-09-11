import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../src/db';
import {
  compareJurisdictions,
  jurisdictionProfile,
  listJurisdictions,
  riskForRows,
} from '../src/services/jurisdictions';
import {
  classifyPolicyRecords,
  loadPolicyDataset,
  persistPolicies,
} from '../src/services/ingest/policies';

beforeEach(() => {
  resetDb();
  persistPolicies(classifyPolicyRecords(loadPolicyDataset()));
});

describe('listJurisdictions', () => {
  it('returns every jurisdiction in the dataset', () => {
    const list = listJurisdictions();
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(entry.jurisdiction).toMatch(/^([A-Z]{2}|GLOBAL)$/);
      expect(entry.regulationCount).toBeGreaterThan(0);
      expect(entry.riskIndex).toBeGreaterThanOrEqual(0);
      expect(entry.riskIndex).toBeLessThanOrEqual(100);
    }
  });

  it('sorts by risk descending', () => {
    const list = listJurisdictions();
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1].riskIndex).toBeGreaterThanOrEqual(list[i].riskIndex);
    }
  });
});

describe('jurisdictionProfile', () => {
  it('includes the primary sources behind the figures', () => {
    const id = listJurisdictions()[0].jurisdiction;
    const profile = jurisdictionProfile(id);
    expect(profile).not.toBeNull();
    expect(profile!.jurisdiction).toBe(id);
    expect(profile!.sources.length).toBe(profile!.regulationCount);
    for (const source of profile!.sources) {
      expect(source.sourceUrl).toMatch(/^https?:\/\//);
      expect(source.id).toBeTruthy();
    }
    // Sources are newest-first.
    const dates = profile!.sources.map((s) => s.eventDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('returns null for an unknown jurisdiction', () => {
    expect(jurisdictionProfile('ZZ')).toBeNull();
  });
});

describe('compareJurisdictions', () => {
  it('compares the requested jurisdictions and omits others', () => {
    const ids = listJurisdictions()
      .slice(0, 2)
      .map((j) => j.jurisdiction);
    const result = compareJurisdictions(ids);
    expect(result.jurisdictions.sort()).toEqual([...ids].sort());
    for (const cell of result.cells) {
      expect(ids).toContain(cell.jurisdiction);
      expect(cell.count).toBeGreaterThan(0);
      expect(cell.sources).toHaveLength(cell.count);
      expect(cell.risk).toBeGreaterThanOrEqual(0);
      expect(cell.averageSeverity).toBeGreaterThan(0);
    }
    expect(Object.keys(result.coverage).sort()).toEqual([...ids].sort());
    expect(result.profiles).toHaveLength(ids.length);
  });

  it('narrows to a single category when asked', () => {
    const ids = listJurisdictions().map((j) => j.jurisdiction);
    const all = compareJurisdictions(ids);
    const category = all.categories[0];
    const filtered = compareJurisdictions(ids, category);
    expect(filtered.categories).toEqual([category]);
    expect(filtered.cells.every((c) => c.category === category)).toBe(true);
    expect(filtered.cells.length).toBeLessThanOrEqual(all.cells.length);
  });

  it('compares every jurisdiction when none are requested', () => {
    const result = compareJurisdictions([]);
    expect(result.jurisdictions.length).toBe(listJurisdictions().length);
  });

  it('returns an empty result for an unknown jurisdiction', () => {
    const result = compareJurisdictions(['ZZ']);
    expect(result.cells).toEqual([]);
    expect(result.profiles).toEqual([]);
  });
});

describe('riskForRows', () => {
  it('is zero for no rows and bounded for many', () => {
    expect(riskForRows([])).toBe(0);
  });
});
