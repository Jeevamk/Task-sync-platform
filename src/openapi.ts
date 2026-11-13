import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * The OpenAPI description of the API, shared by the live docs page (/docs, see main.ts)
 * and `npm run export:openapi`, which writes it for the front-end project's API reference (task-sync-FE).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Task Sync API')
    .setDescription('Each organization connects its own Trello, Slack and Google Sheet. Log in, create an organization, connect, then add a project.')
    .setVersion('0.3.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Sync-Secret', description: 'SHEET_SYNC_SECRET (sheet import only)' }, 'sync-secret')
    .build();
  return SwaggerModule.createDocument(app, config);
}
