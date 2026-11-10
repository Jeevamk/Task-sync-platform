import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: needed to verify Trello (and later Slack) signatures over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  // Vercel runs this same bootstrap and sets PORT itself.
  const port = Number(process.env.PORT) || config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`Task Sync API running on port ${port}  (docs: /docs, health: /health)`, 'Bootstrap');
}

void bootstrap();
