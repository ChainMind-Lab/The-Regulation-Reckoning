/**
 * Server bootstrap: config validation, database init, initial ingestion,
 * indexer startup, then listen.
 */

import type { Server } from 'node:http';
import { createApp } from './app';
import { closeDb, getDb } from './db';
import { config } from './config';
import { logger } from './logger';
import { ingestPolicies } from './services/ingest/policies';
import { ingestIssues } from './services/ingest/issues';
import { startIndexer, stopIndexer } from './services/indexer';

let server: Server | null = null;

export function shutdown(reason: string): void {
  logger.info('shutdown: draining', { reason });
  stopIndexer();
  const done = (): void => {
    closeDb();
    process.exit(0);
  };
  if (server) {
    server.close(done);
    // Don't hang forever on keep-alive connections.
    setTimeout(done, 5_000).unref();
  } else {
    done();
  }
}

async function main(): Promise<void> {
  getDb();
  logger.info('db ready', { path: config.dbPath });

  // Initial ingestion: only when requested, or when tables are empty.
  if (config.ingestOnStart) {
    const db = getDb();
    const policyCount = (
      db.prepare('SELECT COUNT(*) AS c FROM regulatory_events').get() as { c: number }
    ).c;
    const issueCount = (db.prepare('SELECT COUNT(*) AS c FROM issues').get() as { c: number }).c;
    if (config.reingestOnStart || policyCount === 0) {
      await ingestPolicies().catch((err) =>
        logger.error('initial policy ingest failed', { err: String(err) }),
      );
    }
    if (config.reingestOnStart || issueCount === 0) {
      await ingestIssues().catch((err) =>
        logger.error('initial issue ingest failed', { err: String(err) }),
      );
    }
  }

  startIndexer();

  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info('backend listening', { port: config.port, env: config.env });
  });
}

// Graceful shutdown.
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// In tests, importing server.ts would start listening; guard it.
if (require.main === module) {
  main().catch((err) => {
    logger.error('fatal boot error', { err: String(err) });
    process.exit(1);
  });
}

export { main };
