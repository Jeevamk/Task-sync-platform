import { Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';

const logger = new Logger('Background');

/**
 * Run work after the HTTP response has been sent.
 * On Vercel, waitUntil keeps the function alive until the promise settles.
 * Locally (a normal Node process) the promise simply keeps running.
 */
export function runInBackground(label: string, work: () => Promise<unknown>): void {
  const started = Date.now();
  logger.debug(`${label}: started`);
  const promise = work()
    .then(() => logger.debug(`${label}: done in ${Date.now() - started}ms`))
    .catch((err: unknown) => {
      logger.error(`${label} failed after ${Date.now() - started}ms: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
    });
  try {
    waitUntil(promise);
  } catch {
    // Not on Vercel and no request context: nothing else to do.
  }
}
