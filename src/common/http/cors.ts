import type { INestApplication } from '@nestjs/common';

/** True for the MCP endpoint (POST /mcp), with or without a query string. */
function isMcpPath(url: string | undefined): boolean {
  return url === '/mcp' || url?.startsWith('/mcp?') === true;
}

/**
 * CORS rules:
 * - /mcp is open to any origin: browser-based MCP clients (e.g. MCP Inspector) call it from their own
 *   origin. Safe because it authenticates with a Bearer header, never cookies (credentials stay off).
 * - Everything else only accepts the web app (WEB_APP_URL), or no browser origin when that is unset.
 */
export function configureCors(app: INestApplication, webAppUrl: string | undefined): void {
  app.enableCors((req: { url?: string }, cb: (err: Error | null, options: object) => void) => {
    cb(
      null,
      isMcpPath(req.url)
        ? { origin: true, credentials: false, exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'] }
        : { origin: webAppUrl ? [webAppUrl] : false },
    );
  });
}
