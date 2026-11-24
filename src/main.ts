import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import type { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from './app.module';
import { configureCors } from './common/http/cors';
import { createAppLogger } from './common/logging/logger';
import { requestLogger } from './common/logging/request-logger';
import { buildOpenApiDocument } from './openapi';

const processLogger = new Logger('Process');
/** Vercel sets VERCEL=1 in its functions. There we export a request handler instead of listening on a port. */
const onVercel = Boolean(process.env.VERCEL);

// Last line of defence: anything not caught elsewhere is logged instead of disappearing.
process.on('unhandledRejection', (reason) => {
  processLogger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined);
});
process.on('uncaughtException', (err) => {
  processLogger.fatal(`Uncaught exception: ${err.message}`, err.stack);
  process.exit(1);
});

/** Builds the whole app (logger, CORS, /docs) and runs its startup (database connection, indexes), without listening. */
async function createApp(): Promise<INestApplication> {
  // rawBody: needed to verify Trello (and later Slack) signatures over the exact bytes received.
  // bufferLogs: startup messages wait until the configured logger is in place.
  // abortOnError: false: a startup error is thrown to us (logged, then 503 on Vercel) instead of Nest killing the process.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true, abortOnError: false });
  app.useLogger(createAppLogger());
  app.use(requestLogger);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const webApp = config.get<string>('WEB_APP_URL');
  configureCors(app, webApp); // /mcp open to any origin (Bearer auth only); the rest only to the web app

  // Interactive API docs at /docs (use "Authorize" with the token from /auth/google or /auth/dev-login)
  // The UI files come from a CDN: Vercel does not bundle node_modules/swagger-ui-dist, so serving them
  // locally gives a blank page there. Keep the version in step with the installed swagger-ui-dist.
  const swaggerCdn = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    customCssUrl: `${swaggerCdn}/swagger-ui.css`,
    customJs: [`${swaggerCdn}/swagger-ui-bundle.js`, `${swaggerCdn}/swagger-ui-standalone-preset.js`],
  });

  await app.init();
  Logger.log(
    `Environment ${process.env.NODE_ENV ?? 'development'}, public URL ${config.get<string>('PUBLIC_BASE_URL')}, ` +
      `log level ${process.env.LOG_LEVEL || 'default'}, dev login ${config.get<boolean>('ALLOW_DEV_LOGIN') ? 'ON' : 'off'}`,
    'Bootstrap',
  );
  return app;
}

function logStartupFailure(err: unknown): void {
  // e.g. a missing environment value or the database is down: say why.
  processLogger.fatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
  // bufferLogs holds every message until app.useLogger() runs. When startup fails before that, nothing
  // would ever be printed (the app just dies silently), so write the buffered messages out first.
  Logger.flush();
}

// ---------- Vercel: export a request handler ----------
// Vercel loads this file and calls the default export for every request. The app is started once per
// function instance (on the first request) and reused while the instance stays warm.
type ExpressHandler = (req: IncomingMessage, res: ServerResponse) => void;
let server: Promise<ExpressHandler> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  server ??= createApp().then((app) => app.getHttpAdapter().getInstance() as ExpressHandler);
  let express: ExpressHandler;
  try {
    express = await server;
  } catch (err) {
    server = null; // try again on the next request (e.g. the database was briefly unreachable)
    logStartupFailure(err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ statusCode: 503, message: 'The API could not start. See the server logs for the reason.' }));
    return;
  }
  express(req, res);
}

// ---------- Anywhere else (npm run start / start:dev): listen on a port ----------
if (!onVercel) {
  createApp()
    .then(async (app) => {
      const port = Number(process.env.PORT) || app.get(ConfigService).get<number>('PORT', 3000);
      await app.listen(port);
      Logger.log(`Taskvane API running on port ${port}  (docs: /docs, health: /health)`, 'Bootstrap');
    })
    .catch((err: unknown) => {
      logStartupFailure(err);
      process.exit(1);
    });
}
