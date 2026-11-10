/**
 * Self-tests for the multi-tenant pieces (no network, no database). Run after `npm run build`:
 *   npm run test:unit
 */
const assert = require('assert');
const { TokenCrypto } = require('../dist/common/crypto/token-crypto.service');
const { columnLetter, parseSheetId, tabRef } = require('../dist/modules/google/sheets.client');
const { parseBoard } = require('../dist/modules/projects/projects.service');
const { buildDeliveryPlan } = require('../dist/modules/delivery/messages');
const { DeliveryService } = require('../dist/modules/delivery/delivery.service');

(async () => {
  // 1. Token encryption
  const crypto = new TokenCrypto({ getOrThrow: () => 'ab'.repeat(32) });
  const enc = crypto.encrypt('xoxb-secret-token');
  assert.ok(enc.startsWith('v1.') && !enc.includes('xoxb'));
  assert.strictEqual(crypto.decrypt(enc), 'xoxb-secret-token');
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => crypto.decrypt(tampered));
  assert.notStrictEqual(crypto.encrypt('x'), crypto.encrypt('x'), 'random IV');
  console.log('✔ tokens are encrypted, decrypted, and tampering is detected');

  // 2. Helpers
  assert.deepStrictEqual([0, 25, 26, 27, 51, 52, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  assert.strictEqual(parseSheetId('https://docs.google.com/spreadsheets/d/1QqwrFKyO6W2TVJQCDIduufFS_THND45TycOWGgPPEbY/edit#gid=0'), '1QqwrFKyO6W2TVJQCDIduufFS_THND45TycOWGgPPEbY');
  assert.strictEqual(parseSheetId('/d/abc'), null);
  assert.strictEqual(tabRef("Bob's Tasks"), "'Bob''s Tasks'");
  assert.strictEqual(parseBoard('https://trello.com/b/AbC12xYz/website-revamp'), 'AbC12xYz');
  assert.strictEqual(parseBoard('AbC12xYz'), 'AbC12xYz');
  console.log('✔ column letters, sheet links, board links');

  // 3. Delivery plan (what goes to the sheet and Slack)
  const event = {
    eventId: 'e1', type: 'task.status_changed', occurredAt: '2026-11-10T05:00:00Z',
    project: { id: 'p', organizationId: 'o', name: 'T', sheetId: 'S', slackChannelId: 'C1' },
    task: { id: 't', key: 'TASK-7', title: 'Login', description: 'Check rules', status: 'READY_FOR_TESTING', statusLabel: 'Ready for Testing',
      assignee: { name: 'Athira', slackUserId: 'U1' }, labels: ['High'], dueDate: null, pickedUpAt: null, startedAt: '2026-11-09T04:30:00Z',
      readyForTestingAt: '2026-11-10T05:00:00Z', completedAt: null, reopenCount: 0, progressNotes: null, trelloCardId: 'CARD', trelloUrl: 'https://trello.com/c/CARD', slackThreadTs: null },
    change: { field: 'status', from: 'IN_PROGRESS', to: 'READY_FOR_TESTING', fromLabel: 'In Progress', toLabel: 'Ready for Testing', source: 'TRELLO', actor: 'Athira' },
  };
  const plan = buildDeliveryPlan(event);
  assert.strictEqual(plan.taskRow['Started At'], '2026-11-09 10:00');
  assert.strictEqual(plan.taskRow.Description, 'Check rules');
  assert.ok(plan.slack.threadText.includes('Ready for testing') && plan.slack.broadcast);
  assert.ok(plan.slack.parentText.startsWith('*TASK-7 · Login*'));
  const desc = buildDeliveryPlan({ ...event, type: 'task.updated', change: { ...event.change, field: 'description', fromLabel: 'old long text', toLabel: 'new long text' } });
  assert.strictEqual(desc.slack.threadText, '📝 Description updated by Athira');
  assert.strictEqual(desc.historyRow['New Value'], '(description updated)');
  console.log('✔ sheet row, history row and Slack text');

  // 4. Delivery: writes only known columns, creates the thread once, and a retry skips finished steps
  const calls = [];
  let slackFails = true;
  let threadTs = null;
  const sheets = {
    getHeaders: async (_s, tab) => (tab === 'Tasks' ? ['Task ID', 'Title', 'Status', 'Cycle Time (days)', 'Started At'] : ['Timestamp', 'Task ID', 'Field']),
    findRow: async () => ({ row: null, nextRow: 5 }),
    updateCells: async (_s, tab, row, cells) => calls.push(['cells', tab, row, cells.map((c) => c.col)]),
    appendRow: async (_s, tab, values) => calls.push(['append', tab, values.length]),
  };
  const slack = {
    forOrg: async (org) => ({
      postMessage: async (m) => {
        if (slackFails) throw new Error('slack down');
        calls.push(['slack', org, m.thread_ts ?? 'parent']);
        return { ts: '1731111111.000100' };
      },
    }),
  };
  const prisma = { task: {
    findUnique: async () => ({ slackThreadTs: threadTs }),
    updateMany: async ({ data }) => { threadTs = data.slackThreadTs; },
  } };
  const delivery = new DeliveryService(prisma, sheets, slack, { get: () => undefined, getOrThrow: () => '' });
  let progress = {};
  await assert.rejects(delivery.deliver({ ...event, type: 'task.created' }, progress, async (p) => { progress = p; }));
  assert.deepStrictEqual(progress, { sheet: true, history: true });
  assert.deepStrictEqual(calls[0], ['cells', 'Tasks', 5, [0, 1, 2, 4]], 'only matching headers, never the formula column');
  slackFails = false;
  await delivery.deliver({ ...event, type: 'task.created' }, progress, async (p) => { progress = p; });
  assert.strictEqual(calls.filter((c) => c[0] === 'cells').length, 1, 'sheet not written twice on retry');
  assert.deepStrictEqual(calls.at(-1), ['slack', 'o', 'parent']);
  assert.strictEqual(threadTs, '1731111111.000100');
  await delivery.deliver(event, {}, async () => {});
  assert.deepStrictEqual(calls.at(-1), ['slack', 'o', '1731111111.000100'], 'next event replies in the thread');
  console.log('✔ delivery: safe retries, one Slack thread per task, formulas untouched');

  console.log('All multi-tenant unit tests passed.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
