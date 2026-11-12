import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/** Noisy, routine paths: logged at debug level only. */
const QUIET = [/^\/health/, /^\/docs/, /^\/favicon/];

/**
 * One line per request: method, path, status, time taken, request ID.
 * - The query string is left out: OAuth callbacks carry codes and state values in it.
 * - Request bodies and headers are never logged (they can hold tokens).
 * - The request ID is taken from X-Request-Id (or Vercel's X-Vercel-Id) or generated, and sent back
 *   in the X-Request-Id response header, so a user can quote it when reporting a problem.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const header = req.headers['x-request-id'] ?? req.headers['x-vercel-id'];
  const requestId = (Array.isArray(header) ? header[0] : header)?.slice(0, 128) || randomUUID();
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const path = (req.originalUrl || req.url).split('?')[0];
    const line = `${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms [${requestId}]`;
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else if (QUIET.some((r) => r.test(path))) logger.debug(line);
    else logger.log(line);
  });
  next();
}
