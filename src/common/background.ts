import { Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';

const logger = new Logger('Background');

/**
 * Run work after the HTTP response has been sent.
 * On Vercel, waitUntil keeps the function alive until the promise settles.
 * Locally (a normal Node process) the promise simply keeps running.
 */
export function runInBackground(label: string, work: () => Promise<unknown>): void {
  const promise = work().catch((err: unknown) => {
    logger.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  try {
    waitUntil(promise);
  } catch {
    // Not on Vercel and no request context: nothing else to do.
  }
}
