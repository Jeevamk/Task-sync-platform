/** App-level check: boots the whole API with a fake database and calls the real routes.  Run: npm run build && npm run test:app */
Object.assign(process.env, {
  NODE_ENV: 'development', PUBLIC_BASE_URL: 'https://example.ngrok-free.dev',
  DATABASE_URL: 'postgresql://a:b@localhost:5432/x', DIRECT_URL: 'postgresql://a:b@localhost:5432/x',
  TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32), JWT_SECRET: 'x'.repeat(40), ALLOW_DEV_LOGIN: 'true',
  TRELLO_API_KEY: 'trellokey123', TRELLO_APP_SECRET: 'trellosecret',
  SLACK_CLIENT_ID: '111.222', SLACK_CLIENT_SECRET: 'slacksecret',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'tasksync@proj.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'dummy',
  INTERNAL_API_KEY: 'k'.repeat(20), OUTBOX_POLL_MS: '0',
});
const root = require('path').resolve(__dirname, '..') + '/';
const { Test } = require(root + 'node_modules/@nestjs/testing');
const { DocumentBuilder, SwaggerModule } = require(root + 'node_modules/@nestjs/swagger');
const { AppModule } = require(root + 'dist/app.module');
const { PrismaService } = require(root + 'dist/prisma/prisma.service');
const assert = require('assert');

const users = {}; const memberships = []; const orgs = {}; const states = {};
const prisma = {
  $queryRaw: async () => 1,
  outboxEvent: { groupBy: async () => [], findMany: async () => [] },
  user: {
    upsert: async ({ where, create }) => (users[where.email] ??= { id: '11111111-1111-4111-8111-111111111111', ...create }),
    findUniqueOrThrow: async ({ where }) => ({ ...Object.values(users).find((u) => u.id === where.id), memberships: memberships.map((m) => ({ ...m, organization: orgs[m.organizationId] })) }),
  },
  organization: {
    findUniqueOrThrow: async ({ where }) => ({ ...orgs[where.id], _count: { projects: 0, teamMembers: 0 } }),
    create: async ({ data }) => { const id = '22222222-2222-4222-8222-222222222222'; orgs[id] = { id, name: data.name }; memberships.push({ userId: data.memberships.create.userId, organizationId: id, role: 'OWNER' }); return orgs[id]; },
  },
  membership: {
    findUnique: async ({ where }) => memberships.find((m) => m.userId === where.userId_organizationId.userId && m.organizationId === where.userId_organizationId.organizationId) ?? null,
    findMany: async () => memberships.map((m) => ({ ...m, organization: orgs[m.organizationId] })),
  },
  oAuthState: { findUnique: async ({ where }) => states[where.state] ?? null, delete: async () => ({}), deleteMany: async () => ({}), create: async ({ data }) => (states[data.state] = data) },
  connection: { findMany: async () => [], findUnique: async () => null },
};

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build()));
  await app.listen(0);
  const base = await app.getUrl();
  const call = async (method, path, { token, body, headers } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };

  let r = await call('GET', '/health');
  assert.strictEqual(r.json.status, 'ok'); assert.strictEqual(r.json.checks.n8n.status, 'not-configured');
  r = await call('GET', '/docs-json');
  const paths = Object.keys(r.json.paths);
  console.log('✔ app boots; health ok; docs list', paths.length, 'routes:', paths.filter((p) => !p.startsWith('/connect')).join(' '));

  r = await call('GET', '/orgs');
  assert.strictEqual(r.status, 401);
  r = await call('POST', '/auth/dev-login', { body: { email: 'Jeeva@Example.com', name: 'Jeeva' } });
  const token = r.json.token; assert.ok(token);
  r = await call('POST', '/orgs', { token, body: { name: 'Acme Dev Team' } });
  const orgId = r.json.id; assert.strictEqual(r.json.role, 'OWNER');
  r = await call('GET', '/auth/me', { token });
  assert.strictEqual(r.json.organizations[0].name, 'Acme Dev Team');
  console.log('✔ dev login → create organization → /auth/me lists it');

  r = await call('GET', `/orgs/${orgId}`, { token });
  assert.strictEqual(r.json.connections.trello.connected, false);
  assert.strictEqual(r.json.googleSheets.shareWith, 'tasksync@proj.iam.gserviceaccount.com');
  r = await call('POST', `/orgs/${orgId}/connections/trello/start`, { token });
  const t = new URL(r.json.authorizeUrl);
  assert.strictEqual(t.origin + t.pathname, 'https://trello.com/1/authorize');
  assert.ok(t.searchParams.get('return_url').startsWith('https://example.ngrok-free.dev/connect/trello/callback?state='));
  r = await call('POST', `/orgs/${orgId}/connections/slack/start`, { token });
  const s = new URL(r.json.authorizeUrl);
  assert.strictEqual(s.searchParams.get('redirect_uri'), 'https://example.ngrok-free.dev/connect/slack/callback');
  assert.ok(s.searchParams.get('scope').includes('channels:read'));
  console.log('✔ overview shows not-connected + share email; Connect Trello / Add to Slack links are correct');

  r = await call('GET', `/orgs/33333333-3333-4333-8333-333333333333`, { token });
  assert.strictEqual(r.status, 403);
  r = await call('GET', `/orgs/${orgId}/trello/boards`, { token });
  assert.strictEqual(r.status, 400); assert.match(r.json.message, /Connect Trello first/);
  console.log('✔ other organizations are refused (403); using Trello before connecting gives a clear message');

  r = await call('POST', '/webhooks/trello', { body: {} });
  assert.strictEqual(r.status, 401);
  r = await call('GET', '/connect/trello/callback?state=abc');
  assert.ok(String(r.json).includes('/connect/trello/complete'));
  r = await call('POST', '/connect/trello/complete', { body: { state: 'nope', token: 'a'.repeat(64) } });
  assert.strictEqual(r.status, 400);
  console.log('✔ Trello webhook still rejects bad signatures; connect callback page served; unknown state refused');

  await app.close();
  console.log('All app-level checks passed.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
