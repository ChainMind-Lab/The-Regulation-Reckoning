/**
 * Central error handler: converts thrown errors into consistent JSON responses
 * and never leaks stack traces or internal details to clients.
 */

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';
import { SorobanError } from '../services/soroban';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL';
  let detail: unknown;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    code = err.code;
    detail = err.detail;
  } else if (err instanceof SorobanError) {
    status = 502;
    message = err.message;
    code = err.code;
    detail = err.detail;
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    message = 'Invalid JSON body';
    code = 'BAD_JSON';
  } else if (err instanceof Error) {
    // Log the real error server-side only.
    logger.error('unhandled error', {
      method: req.method,
      path: req.originalUrl,
      err: String(err),
    });
  }

  // NOTE: request/status metrics are emitted centrally in app.ts so that
  // successful and failed responses are counted from a single place.
  const body: Record<string, unknown> = { error: message, code };
  if (detail !== undefined && process.env.NODE_ENV !== 'production') body.detail = detail;
  res.status(status).json(body);
}
