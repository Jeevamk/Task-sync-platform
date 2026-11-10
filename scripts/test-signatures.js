/**
 * Self-test for the two signatures (no network, no database):
 *  1. Trello -> API: Base64(HMAC-SHA1(appSecret, rawBody + callbackURL))
 *  2. API -> n8n:   hex(HMAC-SHA256(signingSecret, body)) and the n8n Code node's re-computation
 * Run after `npm run build`:  npm run test:sign
 */
const { createHmac } = require('crypto');
const assert = require('assert');
const { TrelloWebhookService } = require('../dist/modules/webhooks/trello-webhook.service');

const cfg = {
  TRELLO_APP_SECRET: 'test-app-secret',
  PUBLIC_BASE_URL: 'https://example.ngrok-free.app/',
};
const config = { getOrThrow: (k) => cfg[k] };
const svc = new TrelloWebhookService(config, {}, {}, {}, {});

// 1. Trello signature
const raw = Buffer.from(JSON.stringify({ action: { id: 'a1', type: 'updateCard' } }));
const good = createHmac('sha1', cfg.TRELLO_APP_SECRET)
  .update(raw.toString() + 'https://example.ngrok-free.app/webhooks/trello')
  .digest('base64');
assert.strictEqual(svc.callbackUrl(), 'https://example.ngrok-free.app/webhooks/trello');
assert.strictEqual(svc.isSignatureValid(raw, good), true, 'valid Trello signature rejected');
assert.strictEqual(svc.isSignatureValid(raw, 'wrong'), false, 'bad Trello signature accepted');
assert.strictEqual(svc.isSignatureValid(Buffer.from(raw.toString() + ' '), good), false, 'changed body accepted');
assert.strictEqual(svc.isSignatureValid(undefined, good), false);
console.log('✔ Trello signature check works');

// 2. n8n signature: what the API sends vs what WF1's Code node recomputes from the parsed JSON
const secret = 'test-signing-secret';
const payload = { eventId: 'e1', type: 'task.status_changed', task: { title: 'Login – page “validation”', n: 1.5 } };
const body = JSON.stringify(payload);
const sent = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const recomputed = 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(JSON.parse(body))).digest('hex');
assert.strictEqual(recomputed, sent, 'n8n would reject a genuine event');
console.log('✔ n8n event signature round-trips');
console.log('All signature tests passed.');
