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
  apiTokens: fakeModel(),
  transaction: async (work) => work(undefined),
  ping: async () => {},
  outboxCounts: async () => ({}),
};

(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DatabaseService).useValue(db).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  require(root + 'dist/common/http/cors').configureCors(app, 'https://app.example.com');
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

  // Personal access tokens (for MCP clients)
  r = await call('POST', '/auth/tokens', { token, body: { name: 'Claude Desktop' } });
  assert.strictEqual(r.status, 201);
  const pat = r.json.token;
  assert.ok(pat.startsWith('tv_pat_') && pat.length > 40);
  assert.strictEqual(r.json.scope, 'read'); assert.strictEqual(r.json.status, 'active');
  const days = (new Date(r.json.expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 89.9 && days <= 90, 'expires in 90 days by default');
  assert.ok(!JSON.stringify(db.apiTokens.rows).includes(pat), 'only the hash is stored, never the token');
  const patId = r.json.id;
  r = await call('GET', '/auth/me', { token: pat });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.email, 'jeeva@example.com');
  assert.ok(db.apiTokens.rows[0].lastUsedAt instanceof Date, 'lastUsedAt is saved');
  r = await call('GET', `/orgs/${orgId}`, { token: pat });
  assert.strictEqual(r.status, 200);
  r = await call('GET', `/orgs/33333333-3333-4333-8333-333333333333`, { token: pat });
  assert.strictEqual(r.status, 403, 'a token only reaches the organizations of its own user');
  r = await call('POST', '/orgs', { token: pat, body: { name: 'Sneaky Org' } });
  assert.strictEqual(r.status, 403); assert.match(r.json.message, /read-only/);
  r = await call('POST', '/auth/tokens', { token: pat, body: { name: 'escalate', scope: 'read+write' } });
  assert.strictEqual(r.status, 403, 'a token cannot create tokens');
  r = await call('GET', '/auth/tokens', { token: pat });
  assert.strictEqual(r.status, 403, 'a token cannot list tokens');
  console.log('✔ access token: created once (only its hash stored), logs in, read-only, no access to other orgs or to token management');

  r = await call('POST', '/auth/tokens', { token, body: { name: 'Script', scope: 'read+write', expiresInDays: null } });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.json.expiresAt, null);
  const rw = r.json.token;
  r = await call('POST', '/orgs', { token: rw, body: { name: 'Second Team' } });
  assert.strictEqual(r.status, 201, 'a read+write token can make changes');
  for (const body of [{ name: '' }, { name: 'x', scope: 'admin' }, { name: 'x', expiresInDays: 0 }, { name: 'x', expiresInDays: 400 }, { name: 'x', expiresInDays: 1.5 }]) {
    r = await call('POST', '/auth/tokens', { token, body });
    assert.strictEqual(r.status, 400, 'refused: ' + JSON.stringify(body));
  }
  r = await call('GET', '/auth/tokens', { token });
  assert.strictEqual(r.json.length, 2);
  assert.ok(r.json.every((t) => !('token' in t) && !('tokenHash' in t)), 'the list never shows tokens or hashes');
  r = await call('DELETE', `/auth/tokens/${patId}`, { token });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.status, 'revoked');
  r = await call('GET', '/auth/me', { token: pat });
  assert.strictEqual(r.status, 401, 'a revoked token stops working at once');
  r = await call('DELETE', `/auth/tokens/${patId}`, { token });
  assert.strictEqual(r.status, 200, 'revoking twice is fine');
  r = await call('DELETE', '/auth/tokens/44444444-4444-4444-8444-444444444444', { token });
  assert.strictEqual(r.status, 404);
  db.apiTokens.rows.find((t) => t.name === 'Script').expiresAt = new Date(Date.now() - 1000);
  r = await call('GET', '/auth/me', { token: rw });
  assert.strictEqual(r.status, 401, 'an expired token stops working');
  r = await call('GET', '/auth/me', { token: 'tv_pat_made-up' });
  assert.strictEqual(r.status, 401);
  console.log('✔ access tokens: read+write and never-expiring work; bad input refused; list hides secrets; revoke and expiry stop them');

  // MCP endpoint (Streamable HTTP, stateless)
  const mcpRead = (await call('POST', '/auth/tokens', { token, body: { name: 'MCP read' } })).json.token;
  const mcpRw = (await call('POST', '/auth/tokens', { token, body: { name: 'MCP rw', scope: 'read+write' } })).json.token;
  let rpcId = 0;
  const mcp = (tok, method, params, accept = 'application/json, text/event-stream') =>
    call('POST', '/mcp', { token: tok, headers: { Accept: accept }, body: { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) } });
  const tool = async (tok, name, args = {}) => {
    const res = await mcp(tok, 'tools/call', { name, arguments: args });
    assert.strictEqual(res.status, 200);
    const out = res.json.result;
    return { isError: !!out.isError, text: out.content[0].text };
  };

  r = await mcp(undefined, 'tools/list');
  assert.strictEqual(r.status, 401, 'MCP needs a token');
  r = await call('GET', '/mcp', { token: mcpRead });
  assert.strictEqual(r.status, 405);
  r = await call('DELETE', '/mcp', { token });
  assert.strictEqual(r.status, 405);
  r = await call('DELETE', '/mcp', { token: mcpRead });
  assert.strictEqual(r.status, 403, 'read tokens may only POST to /mcp');
  r = await mcp(mcpRead, 'tools/list', undefined, 'application/json');
  assert.strictEqual(r.status, 406, 'clients must accept both JSON and event-stream');
  const preflight = (path) => fetch(base + path, { method: 'OPTIONS', headers: { Origin: 'http://localhost:6274', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  let pf = await preflight('/mcp');
  assert.strictEqual(pf.headers.get('access-control-allow-origin'), 'http://localhost:6274', 'browser MCP clients may call /mcp');
  assert.strictEqual(pf.headers.get('access-control-allow-credentials'), null, 'no cookies on /mcp');
  pf = await preflight('/orgs');
  assert.strictEqual(pf.headers.get('access-control-allow-origin'), null, 'other routes stay closed to other origins');
  r = await mcp(mcpRead, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.result.serverInfo, { name: 'taskvane', version: '0.3.0' });
  assert.ok(r.json.result.capabilities.tools);
  r = await mcp(mcpRead, 'tools/list');
  const toolNames = r.json.result.tools.map((t) => t.name).sort();
  assert.deepStrictEqual(toolNames, ['get_organization', 'list_organizations']);
  console.log('✔ MCP: needs a token; GET/DELETE refused (405); wrong Accept refused (406); initialize + tools/list work with a read token');

  let t1 = await tool(mcpRead, 'list_organizations');
  assert.ok(!t1.isError);
  const mcpOrgs = JSON.parse(t1.text);
  assert.ok(mcpOrgs.some((o) => o.id === orgId && o.name === 'Acme Dev Team'), 'lists the user\'s organization');
  t1 = await tool(mcpRead, 'get_organization', { orgId });
  assert.ok(!t1.isError);
  const overview = JSON.parse(t1.text);
  assert.strictEqual(overview.googleSheets.shareWith, 'tasksync@proj.iam.gserviceaccount.com');
  assert.strictEqual(overview.connections.trello.connected, false);
  t1 = await tool(mcpRead, 'get_organization', { orgId: '33333333-3333-4333-8333-333333333333' });
  assert.ok(t1.isError); assert.match(t1.text, /not a member/);
  t1 = await tool(mcpRead, 'get_organization', { orgId: 'not-a-uuid' });
  assert.ok(t1.isError); assert.match(t1.text, /Invalid UUID/);
  t1 = await tool(mcpRead, 'no_such_tool');
  assert.ok(t1.isError);
  r = await mcp(token, 'tools/list');
  assert.strictEqual(r.status, 200, 'the login token works on MCP too');
  t1 = await tool(mcpRw, 'list_organizations');
  assert.ok(!t1.isError, 'a read+write token can use read tools');
  console.log('✔ MCP tools: list_organizations + get_organization return the user\'s data; other orgs, bad ids and unknown tools give tool errors');

  const { McpAccessService } = require(root + 'dist/modules/mcp/mcp-access.service');
  const access = app.get(McpAccessService);
  const me = (await call('GET', '/auth/me', { token })).json;
  const asRead = { id: me.id, email: me.email, via: 'token', scope: 'read' };
  const asRw = { ...asRead, scope: 'read+write' };
  const asLogin = { id: me.id, email: me.email, via: 'login' };
  assert.throws(() => access.requireWrite(asRead), /read-only/);
  access.requireWrite(asRw);
  access.requireWrite(asLogin);
  await assert.rejects(access.requireWriteRole(asRead, orgId, ['OWNER']), /read-only/);
  assert.strictEqual(await access.requireWriteRole(asRw, orgId, ['OWNER']), 'OWNER');
  await assert.rejects(access.requireRole(asLogin, orgId, ['COORDINATOR']), /Only COORDINATOR/);
  await assert.rejects(access.requireRole(asLogin, '33333333-3333-4333-8333-333333333333', ['OWNER']), /not a member/);
  console.log('✔ MCP access: read tokens refused by requireWrite; read+write and login pass; roles enforced');

  for (const tk of db.apiTokens.rows.filter((x) => x.name.startsWith('MCP '))) {
    await call('DELETE', `/auth/tokens/${tk._id}`, { token });
  }
  r = await mcp(mcpRead, 'tools/list');
  assert.strictEqual(r.status, 401, 'a revoked token is refused by MCP');
  console.log('✔ MCP: revoked tokens are refused');

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
