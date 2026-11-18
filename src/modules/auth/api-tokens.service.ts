import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthUser } from '../../common/auth/auth-user';
import { shortId } from '../../common/logging/redact';
import { DatabaseService } from '../../database/database.service';
import { insertOne } from '../../database/helpers';
import type { ApiToken, ApiTokenScope } from '../../database/types';

/** Every personal access token starts with this, so the auth guard (and secret scanners) can recognise it. */
export const API_TOKEN_PREFIX = 'tv_pat_';
export const DEFAULT_TOKEN_DAYS = 90;
export const MAX_TOKEN_DAYS = 365;
/** Active (not revoked, not expired) tokens one user may have at once. */
export const MAX_ACTIVE_TOKENS = 20;
/** lastUsedAt is saved at most this often per token, so busy clients don't cause a write on every request. */
const LAST_USED_EVERY_MS = 60_000;

export type ApiTokenStatus = 'active' | 'expired' | 'revoked';

/** What the API shows about a token: never the token itself or its hash. */
export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  status: ApiTokenStatus;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** tokens are 32 random bytes, so a plain SHA-256 is enough (no slow hash needed: there is nothing to guess). */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Personal access tokens: long-lived tokens for MCP clients and scripts, which the 7-day login token does not suit.
 * Each one can be revoked on its own, and is `read` (GET only) or `read+write`.
 */
@Injectable()
export class ApiTokensService {
  private readonly logger = new Logger(ApiTokensService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Creates a token. The full token is returned only here: it is not stored, only its hash.
   * expiresInDays: undefined = the default (90 days), null = never expires.
   */
  async create(userId: string, input: { name: string; scope?: ApiTokenScope; expiresInDays?: number | null }) {
    const now = new Date();
    const active = (await this.db.apiTokens.find({ userId, revokedAt: null })).filter((t) => statusOf(t, now) === 'active');
    if (active.length >= MAX_ACTIVE_TOKENS) {
      throw new BadRequestException(`You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use first.`);
    }

    const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const days = input.expiresInDays === undefined ? DEFAULT_TOKEN_DAYS : input.expiresInDays;
    const saved = await insertOne(this.db.apiTokens, {
      userId,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, API_TOKEN_PREFIX.length + 4),
      scope: input.scope ?? 'read',
      lastUsedAt: null,
      expiresAt: days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdAt: now,
    });
    this.logger.log(`User ${shortId(userId)} created API token ${shortId(saved.id)} (${saved.scope}, ${days === null ? 'never expires' : `${days} days`})`);
    return { token, ...view(saved, now) };
  }

  async list(userId: string): Promise<ApiTokenView[]> {
    const now = new Date();
    const tokens = await this.db.apiTokens.find({ userId }).sort({ createdAt: -1 });
    return tokens.map((t) => view(t, now));
  }

  /** Revokes one of the user's tokens. Revoking an already revoked token is fine (nothing changes). */
  async revoke(userId: string, id: string): Promise<ApiTokenView> {
    const token = await this.db.apiTokens.findOne({ _id: id, userId });
    if (!token) throw new NotFoundException('Token not found');
    if (!token.revokedAt) {
      token.revokedAt = new Date();
      await this.db.apiTokens.updateOne({ _id: id, userId }, { $set: { revokedAt: token.revokedAt } });
      this.logger.log(`User ${shortId(userId)} revoked API token ${shortId(id)}`);
    }
    return view(token, new Date());
  }

  /** For the auth guard: the user behind a tv_pat_ token, or null when it is unknown, revoked or expired. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const found = await this.db.apiTokens.findOne({ tokenHash: hashToken(token) });
    const now = new Date();
    if (!found || statusOf(found, now) !== 'active') return null;
    const user = await this.db.users.findOne({ _id: found.userId });
    if (!user) return null;
    if (!found.lastUsedAt || now.getTime() - new Date(found.lastUsedAt).getTime() > LAST_USED_EVERY_MS) {
      try {
        await this.db.apiTokens.updateOne({ _id: found.id }, { $set: { lastUsedAt: now } });
      } catch (err) {
        // Only bookkeeping: the request itself goes on.
        this.logger.warn(`Could not save lastUsedAt of API token ${shortId(found.id)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { id: user.id, email: user.email, via: 'token', tokenId: found.id, scope: found.scope };
  }
}

function statusOf(token: Pick<ApiToken, 'revokedAt' | 'expiresAt'>, now: Date): ApiTokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

function view(t: ApiToken, now: Date): ApiTokenView {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope,
    status: statusOf(t, now),
    createdAt: t.createdAt,
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
    revokedAt: t.revokedAt,
  };
}
