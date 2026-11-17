/** App-level check: boots the whole API with a fake database and calls the real routes.  Run: npm run build && npm run test:app */
Object.assign(process.env, {
  NODE_ENV: 'development', PUBLIC_BASE_URL: 'https://example.ngrok-free.dev',
  MONGODB_URI: 'mongodb://localhost:27017/x',
  TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32), JWT_SECRET: 'x'.repeat(40), ALLOW_DEV_LOGIN: 'true',
  TRELLO_API_KEY: 'trellokey123', TRELLO_APP_SECRET: 'trellosecret',
  SLACK_CLIENT_ID: '111.222', SLACK_CLIENT_SECRET: 'slacksecret',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'tasksync@proj.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'dummy',
  INTERNAL_API_KEY: 'k'.repeat(20), OUTBOX_POLL_MS: '0',
  // Empty on purpose: values set here win over your .env, so a local n8n setting can't make the test call it.
  N8N_BASE_URL: '', N8N_EVENT_WEBHOOK_URL: '', N8N_EVENT_SIGNING_SECRET: '',
});
const root = require('path').resolve(__dirname, '..') + '/';
const { randomUUID } = require('crypto');
const { Test } = require(root + 'node_modules/@nestjs/testing');
const { DocumentBuilder, SwaggerModule } = require(root + 'node_modules/@nestjs/swagger');
const { AppModule } = require(root + 'dist/app.module');
const { DatabaseService } = require(root + 'dist/database/database.service');
const assert = require('assert');

/**
 * In-memory stand-in for one Mongoose model. Supports the calls the tested routes make
 * (plain equality, $in, $lt/$gt filters; $set/$setOnInsert updates; upsert). Like the real models
 * (see plain-documents.ts), reads return plain copies with `id` instead of `_id`.
 */
function fakeModel() {
  const rows = [];
  const plain = (r) => { if (!r) return null; const { _id, ...rest } = r; return { id: _id, ...rest }; };
  const test = (v, cond) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, x]) =>
        op === '$in' ? x.includes(v) : op === '$nin' ? !x.includes(v) : op === '$ne' ? v !== x
        : op === '$lt' ? v < x : op === '$lte' ? v <= x : op === '$gt' ? v > x : op === '$gte' ? v >= x
        : (() => { throw new Error(`fake db: unsupported operator ${op}`); })());
    }
    return v === cond;
  };
  const matches = (filter = {}) => (r) => Object.entries(filter).every(([k, cond]) => test(r[k], cond));
  // Thenable like a Mongoose query; chain calls are accepted and ignored.
  const query = (fn) => {
    const q = { then: (ok, fail) => Promise.resolve().then(fn).then(ok, fail), exec: () => Promise.resolve().then(fn) };
    for (const m of ['sort', 'limit', 'skip', 'select', 'lean', 'session']) q[m] = () => q;
    return q;
  };
  const apply = (row, update, inserting) => {
    Object.assign(row, update.$set ?? {}, inserting ? update.$setOnInsert ?? {} : {});
    for (const [k, n] of Object.entries(update.$inc ?? {})) row[k] = (row[k] ?? 0) + n;
  };
  const insert = (data) => { const row = { _id: randomUUID(), createdAt: new Date(), ...data }; rows.push(row); return row; };
  return {
    rows,
    find: (filter) => query(() => rows.filter(matches(filter)).map(plain)),
    findOne: (filter) => query(() => plain(rows.find(matches(filter)))),
    countDocuments: (filter) => query(() => rows.filter(matches(filter)).length),
    create: async (docs) => (Array.isArray(docs) ? docs : [docs]).map((d) => plain(insert(d))),
    findOneAndUpdate: (filter, update, opts = {}) => query(() => {
      let row = rows.find(matches(filter));
      const before = plain(row);
      if (!row && !opts.upsert) return null;
      if (!row) { row = insert({}); Object.assign(row, Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object'))); apply(row, update, true); }
      else apply(row, update, false);
      return opts.new || opts.returnDocument === 'after' ? plain(row) : before;
    }),
    updateOne: (filter, update) => query(() => {
      const row = rows.find(matches(filter));
      if (row) apply(row, update, false);
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    }),
    findOneAndDelete: (filter) => query(() => {
      const i = rows.findIndex(matches(filter));
      return i < 0 ? null : plain(rows.splice(i, 1)[0]);
    }),
    deleteMany: (filter) => query(() => {
      const keep = rows.filter((r) => !matches(filter)(r));
      const deletedCount = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { deletedCount };
    }),
  };
}

const db = {
  organizations: fakeModel(), users: fakeModel(), memberships: fakeModel(), connections: fakeModel(),
  oauthStates: fakeModel(), projects: fakeModel(), teamMembers: fakeModel(), tasks: fakeModel(),
  taskEvents: fakeModel(), processedEvents: fakeModel(), outboxEvents: fakeModel(), syncErrors: fakeModel(),
  transaction: async (work) => work(undefined),
  ping: async () => {},
  outboxCounts: async () => ({}),
};

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DatabaseService).useValue(db).compile();
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

  let res = await fetch(base + '/sheet-template');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /taskvane-sheet-template\.xlsx/);
  const xlsx = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(xlsx.readUInt32LE(0), 0x04034b50, 'xlsx is a zip');
  assert.strictEqual(xlsx.readUInt32LE(xlsx.length - 22), 0x06054b50, 'zip has its end record');
  res = await fetch(base + '/sheet-template?format=csv&tab=tasks');
  assert.strictEqual(res.status, 200);
  assert.ok((await res.text()).startsWith('Task ID,Title,Status,'));
  r = await call('GET', '/sheet-template?format=csv&tab=nope');
  assert.strictEqual(r.status, 400);
  console.log('✔ sample sheet downloads without login (.xlsx with all tabs, or one tab as CSV)');

  await app.close();
  console.log('All app-level checks passed.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
