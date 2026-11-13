import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createAppLogger } from './common/logging/logger';
import { requestLogger } from './common/logging/request-logger';
import { buildOpenApiDocument } from './openapi';

const processLogger = new Logger('Process');

// Last line of defence: anything not caught elsewhere is logged instead of disappearing.
process.on('unhandledRejection', (reason) => {
  processLogger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined);
});
process.on('uncaughtException', (err) => {
  processLogger.fatal(`Uncaught exception: ${err.message}`, err.stack);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  // rawBody: needed to verify Trello (and later Slack) signatures over the exact bytes received.
  // bufferLogs: startup messages wait until the configured logger is in place.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(createAppLogger());
  app.use(requestLogger);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const webApp = config.get<string>('WEB_APP_URL');
  app.enableCors({ origin: webApp ? [webApp] : false });

  // Interactive API docs at /docs (use "Authorize" with the token from /auth/google or /auth/dev-login)
  // The UI files come from a CDN: Vercel does not bundle node_modules/swagger-ui-dist, so serving them
  // locally gives a blank page there. Keep the version in step with the installed swagger-ui-dist.
  const swaggerCdn = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    customCssUrl: `${swaggerCdn}/swagger-ui.css`,
    customJs: [`${swaggerCdn}/swagger-ui-bundle.js`, `${swaggerCdn}/swagger-ui-standalone-preset.js`],
  });

  // Vercel runs this same bootstrap and sets PORT itself.
  const port = Number(process.env.PORT) || config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`Taskvane API running on port ${port}  (docs: /docs, health: /health)`, 'Bootstrap');
  Logger.log(
    `Environment ${process.env.NODE_ENV ?? 'development'}, public URL ${config.get<string>('PUBLIC_BASE_URL')}, ` +
      `log level ${process.env.LOG_LEVEL || 'default'}, dev login ${config.get<boolean>('ALLOW_DEV_LOGIN') ? 'ON' : 'off'}`,
    'Bootstrap',
  );
}

bootstrap().catch((err: unknown) => {
  // e.g. a missing .env value or the database is down: say why, then stop.
  processLogger.fatal(`Startup failed: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
  process.exit(1);
});
