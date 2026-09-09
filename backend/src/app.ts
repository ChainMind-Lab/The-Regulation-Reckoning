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

  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: '256kb' }));
  app.use(requestLogger);
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
    res.status(dbOk && horizonOk ? 200 : 503).json({
      status: dbOk && horizonOk ? 'ready' : 'degraded',
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
