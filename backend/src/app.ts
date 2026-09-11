/**
 * Express app assembly (exported separately from the listen bootstrap so tests
 * can exercise it without binding a port).
 */

import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import { config } from './config';
import { requestLogger } from './logger';
import { metrics } from './metrics';
import { pingHorizon } from './services/horizon';
import { isContractInitialised } from './services/soroban';
import apiRouter from './routes/api';
import { errorHandler, notFound } from './middleware/error';
import { rateLimit } from './middleware/rateLimit';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // When behind the bundled nginx proxy, trust its X-Forwarded-For header so
  // rate limiting keys on the real client IP rather than the proxy's.
  if (config.trustProxy) app.set('trust proxy', true);

  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: '256kb' }));
  app.use(requestLogger);
  // Count every response (success and failure) exactly once, from one place.
  app.use((req, res, next) => {
    res.on('finish', () => {
      metrics.inc('http_requests_total', { method: req.method, status: String(res.statusCode) });
    });
    next();
  });
  app.use(rateLimit());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/health/ready', async (_req, res) => {
    let dbOk = true;
    try {
      getDb().prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    let horizonOk = false;
    try {
      await pingHorizon();
      horizonOk = true;
    } catch {
      horizonOk = false;
    }
    let sorobanOk = true;
    try {
      if (config.bountyContractId) await isContractInitialised();
    } catch {
      sorobanOk = false;
    }
    const ready = dbOk && horizonOk && sorobanOk;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      db: dbOk,
      horizon: horizonOk,
      soroban: sorobanOk,
    });
  });

  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.render());
  });

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
