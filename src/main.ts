import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createAppLogger } from './common/logging/logger';
import { requestLogger } from './common/logging/request-logger';

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
  const doc = new DocumentBuilder()
    .setTitle('Task Sync API')
    .setDescription('Each organization connects its own Trello, Slack and Google Sheet. Log in, create an organization, connect, then add a project.')
    .setVersion('0.3.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Sync-Secret', description: 'SHEET_SYNC_SECRET (sheet import only)' }, 'sync-secret')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  // Vercel runs this same bootstrap and sets PORT itself.
  const port = Number(process.env.PORT) || config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`Task Sync API running on port ${port}  (docs: /docs, health: /health)`, 'Bootstrap');
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
