import { ConsoleLogger, LogLevel } from '@nestjs/common';

/** Lowest level first: LOG_LEVEL=log prints error, warn and log; debug adds debug; verbose prints everything. */
const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

export function logLevelsFrom(value: string | undefined, fallback: LogLevel): LogLevel[] {
  const wanted = (LEVELS as string[]).includes(String(value)) ? (value as LogLevel) : fallback;
  return LEVELS.slice(0, LEVELS.indexOf(wanted) + 1);
}

/**
 * App logger, set up from the environment (read directly: it is created before ConfigModule loads).
 *   LOG_LEVEL  = error | warn | log | debug | verbose   (default: debug in development, log otherwise)
 *   LOG_FORMAT = pretty | json                          (default: json in production, pretty otherwise)
 * JSON puts one object per line, which Vercel's log viewer and log drains can search and filter.
 */
export function createAppLogger(env: NodeJS.ProcessEnv = process.env): ConsoleLogger {
  const production = env.NODE_ENV === 'production';
  const json = (env.LOG_FORMAT || (production ? 'json' : 'pretty')) === 'json';
  return new ConsoleLogger({
    logLevels: logLevelsFrom(env.LOG_LEVEL, production ? 'log' : 'debug'),
    json,
    colors: !json && !production,
    timestamp: !json,
    prefix: 'TaskSync',
  });
}
