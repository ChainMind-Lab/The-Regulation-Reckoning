/**
 * Structured JSON logging with level filtering.
 *
 * Logs are emitted as single-line JSON objects so they can be shipped to
 * log aggregators (CloudWatch, Loki, Datadog, ...) without parsing.
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configuredLevel: Level = (() => {
  const raw = (config.logLevel ?? 'info').toLowerCase();
  if (raw in LEVEL_ORDER) return raw as Level;
  return 'info';
})();

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/** Express middleware: one structured access-log line per request. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    emit('info', 'http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(elapsedMs * 100) / 100,
      ip: req.ip,
      user_agent: req.headers['user-agent'],
    });
  });
  next();
}
