#!/usr/bin/env node
/**
 * Enrich backend/data/policy-regulations.json with two curated fields per
 * record, derived from an editorial category → impact/signal taxonomy.
 *
 *   impact:           ecosystem areas affected (stablecoin-issuers, exchanges, …)
 *   survival_signals: what the rule means for project survival (licensing-requirements, …)
 *
 * Deterministic: re-running yields the same JSON. Run: node scripts/enrich-policy-data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'data/policy-regulations.json');

const CATEGORY_IMPACT = {
  'stablecoin-regulation': ['stablecoin-issuers', 'wallets-and-custody', 'institutional-adoption'],
  sanctions: ['sanctions-compliance', 'cross-border-payments', 'exchanges'],
  'anti-money-laundering': ['exchanges', 'wallets-and-custody', 'cross-border-payments'],
  'crypto-markets': ['exchanges', 'defi-protocols', 'tokenization'],
  'cross-border-payments': [
    'cross-border-payments',
    'stablecoin-issuers',
    'infrastructure-providers',
  ],
  securities: ['tokenization', 'exchanges', 'institutional-adoption'],
  'consumer-protection': ['consumer-protection', 'exchanges', 'wallets-and-custody'],
  'data-protection': ['consumer-protection', 'infrastructure-providers', 'exchanges'],
  taxation: ['exchanges', 'defi-protocols', 'institutional-adoption'],
  'operational-resilience': ['infrastructure-providers', 'exchanges', 'institutional-adoption'],
};

const CATEGORY_SIGNALS = {
  'stablecoin-regulation': ['reserve-and-audit-requirements', 'licensing-requirements'],
  sanctions: ['enforcement-action', 'delisting-risk'],
  'anti-money-laundering': ['enforcement-action', 'market-access-barrier'],
  'crypto-markets': ['licensing-requirements', 'disclosure-burden', 'market-access-barrier'],
  'cross-border-payments': ['market-access-barrier', 'jurisdiction-shift'],
  securities: ['disclosure-burden', 'licensing-requirements'],
  'consumer-protection': ['disclosure-burden', 'operational-risk-management'],
  'data-protection': ['operational-risk-management', 'disclosure-burden'],
  taxation: ['higher-compliance-cost', 'disclosure-burden'],
  'operational-resilience': ['operational-risk-management', 'higher-compliance-cost'],
};

// Explicit per-record overrides (id → fields). Keeps EU/US editorial nuance.
const OVERRIDES = {
  'us-biden-executive-order-crypto': {
    impact: ['institutional-adoption', 'cross-border-payments', 'stablecoin-issuers'],
    survival_signals: ['jurisdiction-shift', 'licensing-requirements'],
  },
  'us-fincen-crypto-routing': {
    impact: ['cross-border-payments', 'wallets-and-custody'],
    survival_signals: ['higher-compliance-cost', 'enforcement-action'],
  },
  'eu-mica-stablecoin-rules': {
    impact: ['stablecoin-issuers', 'institutional-adoption', 'wallets-and-custody'],
    survival_signals: [
      'reserve-and-audit-requirements',
      'licensing-requirements',
      'market-access-barrier',
    ],
  },
  'us-fed-now-vs-stablecoins': {
    impact: ['cross-border-payments', 'stablecoin-issuers', 'institutional-adoption'],
    survival_signals: ['market-access-barrier', 'jurisdiction-shift'],
  },
  'sg-mas-stablecoin-framework': {
    impact: ['stablecoin-issuers', 'institutional-adoption'],
    survival_signals: ['reserve-and-audit-requirements', 'licensing-requirements'],
  },
  'uk-fca-crypto-promotions': {
    impact: ['exchanges', 'consumer-protection'],
    survival_signals: ['market-access-barrier', 'disclosure-burden'],
  },
};

const data = JSON.parse(readFileSync(PATH, 'utf8'));
let changed = 0;
for (const ev of data.events) {
  const baseImpact = CATEGORY_IMPACT[ev.category] ?? ['exchanges'];
  const baseSignals = CATEGORY_SIGNALS[ev.category] ?? ['higher-compliance-cost'];
  const override = OVERRIDES[ev.id];
  const impact = override?.impact ?? baseImpact;
  const signals = override?.survival_signals ?? baseSignals;
  if (
    JSON.stringify(ev.impact) !== JSON.stringify(impact) ||
    JSON.stringify(ev.survival_signals) !== JSON.stringify(signals)
  ) {
    ev.impact = impact;
    ev.survival_signals = signals;
    changed += 1;
  }
}
data._meta.schemaVersion = 2;
data._meta.updatedAt = new Date().toISOString().slice(0, 10);
writeFileSync(PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(`enriched ${changed}/${data.events.length} records → ${PATH}`);
