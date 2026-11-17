import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Provider } from '../../database/types';
import { randomBytes, randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { insertOne } from '../../database/helpers';
import { TokenCrypto } from '../../common/crypto/token-crypto.service';
import { maskEmail, shortId } from '../../common/logging/redact';
import { SIGNUP } from './signup-links';

const STATE_TTL_MS = 10 * 60_000;

/** What to do when a provider is not connected yet. */
const NOT_CONNECTED: Record<Provider, string> = {
  TRELLO: 'Connect Trello first (Connections → Connect Trello)',
  SLACK: 'Add Taskvane to Slack first (Connections → Add to Slack)',
  GOOGLE: 'Connect Google first (Connections → Connect Google), or use an existing sheet link instead of "new"',
};

/** Each organization's own Trello / Slack / Google account. Tokens are encrypted at rest and never returned by the API. */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: TokenCrypto,
  ) {}

  async getToken(organizationId: string, provider: Provider): Promise<string> {
    const c = await this.db.connections.findOne({ organizationId, provider });
    if (!c) {
      this.logger.warn(`Org ${shortId(organizationId)}: ${provider} is not connected`);
      throw new BadRequestException(NOT_CONNECTED[provider]);
    }
    try {
      return this.crypto.decrypt(c.encryptedToken);
    } catch (err) {
      // Happens when TOKEN_ENCRYPTION_KEY changed after the account was connected.
      this.logger.error(`Org ${shortId(organizationId)}: stored ${provider} token cannot be decrypted (was TOKEN_ENCRYPTION_KEY changed?)`);
      throw err;
    }
  }

  get(organizationId: string, provider: Provider) {
    return this.db.connections.findOne({ organizationId, provider });
  }

  async status(organizationId: string) {
    const rows = await this.db.connections.find({ organizationId });
    const view = (p: Provider) => {
      const c = rows.find((r) => r.provider === p);
      return c
        ? { connected: true, account: c.externalName, externalId: c.externalId, connectedBy: c.connectedBy, since: c.createdAt }
        : { connected: false, ...SIGNUP[p] };
    };
    return { trello: view('TRELLO'), slack: view('SLACK'), google: view('GOOGLE') };
  }

  /** Step-by-step checklist for a new organization: what is done and what to call next. */
  async setup(organizationId: string) {
    const [rows, projects] = await Promise.all([
      this.db.connections.find({ organizationId }, { provider: 1, externalName: 1 }),
      this.db.projects.countDocuments({ organizationId }),
    ]);
    const has = (p: Provider) => rows.find((r) => r.provider === p);
    const base = `/orgs/${organizationId}`;
    const connect = (p: Provider, label: string, path: string, optional?: string) => {
      const c = has(p);
      return c
        ? { step: label, done: true, account: c.externalName }
        : { step: label, done: false, next: `POST ${base}/connections/${path}/start`, ...SIGNUP[p], ...(optional ? { optional } : {}) };
    };
    const steps = [
      connect('TRELLO', 'Connect Trello', 'trello'),
      connect('SLACK', 'Add Taskvane to Slack', 'slack'),
      connect('GOOGLE', 'Connect Google', 'google', 'Only needed for sheet: "new". Skip it if you share your own sheet (sample with all headers: GET /sheet-template).'),
      projects
        ? { step: 'Create a project', done: true, projects }
        : {
            step: 'Create a project',
            done: false,
            next: `POST ${base}/projects`,
            example: { name: 'My Project', trelloBoard: 'new', sheet: 'new', slackChannelId: 'new' },
          },
    ];
    const pending = steps.find((s) => !s.done && !('optional' in s));
    return { ready: !pending, nextStep: pending?.step ?? null, steps };
  }

  async save(
    organizationId: string,
    provider: Provider,
    data: { externalId: string; externalName: string; token: string; scopes?: string; botUserId?: string; connectedBy?: string },
  ) {
    const fields = {
      externalId: data.externalId,
      externalName: data.externalName,
      encryptedToken: this.crypto.encrypt(data.token),
      scopes: data.scopes ?? null,
      botUserId: data.botUserId ?? null,
      connectedBy: data.connectedBy ?? null,
    };
    const saved = (await this.db.connections.findOneAndUpdate(
      { organizationId, provider },
      { $set: fields, $setOnInsert: { _id: randomUUID() } },
      { upsert: true, new: true },
    ))!;
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} connected as "${data.externalName}" by ${maskEmail(data.connectedBy)}`);
    return saved;
  }

  async remove(organizationId: string, provider: Provider): Promise<void> {
    const r = await this.db.connections.deleteMany({ organizationId, provider });
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} disconnected (${r.deletedCount} removed)`);
  }

  /** A one-time value carried through the Trello/Slack/Google "Connect" redirect, so we know which organization started it. */
  async createState(organizationId: string, provider: Provider, userEmail: string): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    // MongoDB's TTL index also removes them, but only about once a minute.
    const expired = await this.db.oauthStates.deleteMany({ expiresAt: { $lt: new Date() } });
    if (expired.deletedCount) this.logger.debug(`Removed ${expired.deletedCount} expired connect links`);
    await insertOne(this.db.oauthStates, { state, organizationId, provider, userEmail, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} connect started by ${maskEmail(userEmail)}`);
    return state;
  }

  /** Returns the state's organization once; the state can't be used again. */
  async consumeState(state: string, provider: Provider) {
    if (!state) {
      this.logger.warn(`${provider} connect callback without state`);
      throw new BadRequestException('Missing state');
    }
    // Read and delete in one step, so two callbacks with the same state can't both succeed.
    const row = await this.db.oauthStates.findOneAndDelete({ state });
    if (!row || row.provider !== provider || row.expiresAt < new Date()) {
      const why = !row ? 'unknown or already used' : row.provider !== provider ? `meant for ${row.provider}` : 'expired';
      this.logger.warn(`${provider} connect link rejected: ${why}`);
      throw new BadRequestException('This connect link expired or was already used. Start again.');
    }
    return row;
  }
}
