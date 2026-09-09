/**
 * Manual indexer runner: `npm run index`.
 * Runs a single indexer pass (fetch events → persist → rebuild bounty state).
 */

import { getDb } from '../db';
import { indexOnce } from '../services/indexer';

async function main(): Promise<void> {
  getDb();
  const inserted = await indexOnce();

  console.log(JSON.stringify({ insertedEvents: inserted }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
