/**
 * Manual ingestion runner: `npm run ingest`.
 * Re-runs both pipelines and prints results. Idempotent.
 */

import { getDb } from '../db';
import { ingestPolicies } from '../services/ingest/policies';
import { ingestIssues } from '../services/ingest/issues';

async function main(): Promise<void> {
  getDb();
  const policies = await ingestPolicies();
  const issues = await ingestIssues();

  console.log(JSON.stringify({ policies, issues }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
