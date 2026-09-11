/**
 * Fixed-window in-memory rate limiter.
 *
 * Suitable for single-instance deployments and dev; for multi-instance
 * production replace with a shared store (Redis). Returns 429 with a
 * Retry-After header when exceeded.
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function prune(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export function rateLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    prune(now);
    const key = req.ip ?? 'unknown';
    const window = windows.get(key);
    if (!window || window.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs });
      next();
      return;
    }
    window.count += 1;
    if (window.count > config.rateLimitMax) {
      // 429 responses are counted by the central metrics middleware in app.ts.
      res.setHeader('Retry-After', String(Math.ceil((window.resetAt - now) / 1000)));
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfterSec: Math.ceil((window.resetAt - now) / 1000),
      });
      return;
    }
    next();
  };
}

/** Clear all windows (exported for tests). */
export function resetRateLimiter(): void {
  windows.clear();
}
