/**
 * Writes the API description (the same one served at /docs) to a JSON file, for the separate
 * front-end project (task-sync-FE), so its API reference always matches the code.
 *   Run: npm run export:openapi                       -> ../task-sync-FE/src/data/openapi.json
 *        npm run export:openapi -- path/to/out.json   -> another file
 * Nothing connects to the database or to Trello/Slack: the app is created but never started.
 */
const fs = require('fs');
const path = require('path');

// Config validation needs these to exist. Real values from .env win; placeholders are only used when missing (e.g. CI).
const placeholders = {
  PUBLIC_BASE_URL: 'https://example.com',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/db',
  TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  JWT_SECRET: 'x'.repeat(40),
  TRELLO_API_KEY: 'placeholder',
  TRELLO_APP_SECRET: 'placeholder',
  SLACK_CLIENT_ID: 'placeholder',
  SLACK_CLIENT_SECRET: 'placeholder',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'placeholder@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'placeholder',
  INTERNAL_API_KEY: 'k'.repeat(20),
};
for (const [k, v] of Object.entries(placeholders)) if (!process.env[k]) process.env[k] = v;
process.env.OUTBOX_POLL_MS = '0';

const root = path.resolve(__dirname, '..');
const { NestFactory } = require(path.join(root, 'node_modules/@nestjs/core'));
const { AppModule } = require(path.join(root, 'dist/app.module'));
const { buildOpenApiDocument } = require(path.join(root, 'dist/openapi'));

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = buildOpenApiDocument(app);
  const out = path.resolve(process.argv[2] || path.join(root, '../task-sync-FE/src/data/openapi.json'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  const count = Object.values(doc.paths).reduce((n, ops) => n + Object.keys(ops).length, 0);
  console.log(`Wrote ${out}: ${count} operations`);
  await app.close();
})().catch((err) => {
  console.error('Could not export the OpenAPI document:', err);
  process.exit(1);
});
