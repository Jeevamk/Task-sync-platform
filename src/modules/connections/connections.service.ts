import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenCrypto } from '../../common/crypto/token-crypto.service';
import { maskEmail, shortId } from '../../common/logging/redact';

const STATE_TTL_MS = 10 * 60_000;

/** Each organization's own Trello / Slack account. Tokens are encrypted at rest and never returned by the API. */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCrypto,
  ) {}

  async getToken(organizationId: string, provider: Provider): Promise<string> {
    const c = await this.prisma.connection.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
    if (!c) {
      this.logger.warn(`Org ${shortId(organizationId)}: ${provider} is not connected`);
      throw new BadRequestException(
        provider === 'TRELLO' ? 'Connect Trello first (Connections → Connect Trello)' : 'Add Taskvane to Slack first (Connections → Add to Slack)',
      );
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
    return this.prisma.connection.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  }

  async status(organizationId: string) {
    const rows = await this.prisma.connection.findMany({ where: { organizationId } });
    const view = (p: Provider) => {
      const c = rows.find((r) => r.provider === p);
      return c
        ? { connected: true, account: c.externalName, externalId: c.externalId, connectedBy: c.connectedBy, since: c.createdAt }
        : { connected: false };
    };
    return { trello: view('TRELLO'), slack: view('SLACK') };
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
    const saved = await this.prisma.connection.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: { organizationId, provider, ...fields },
      update: fields,
    });
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} connected as "${data.externalName}" by ${maskEmail(data.connectedBy)}`);
    return saved;
  }

  async remove(organizationId: string, provider: Provider): Promise<void> {
    const r = await this.prisma.connection.deleteMany({ where: { organizationId, provider } });
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} disconnected (${r.count} removed)`);
  }

  /** A one-time value carried through the Trello/Slack "Connect" redirect, so we know which organization started it. */
  async createState(organizationId: string, provider: Provider, userEmail: string): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    const expired = await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (expired.count) this.logger.debug(`Removed ${expired.count} expired connect links`);
    await this.prisma.oAuthState.create({
      data: { state, organizationId, provider, userEmail, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    this.logger.log(`Org ${shortId(organizationId)}: ${provider} connect started by ${maskEmail(userEmail)}`);
    return state;
  }

  /** Returns the state's organization once; the state can't be used again. */
  async consumeState(state: string, provider: Provider) {
    if (!state) {
      this.logger.warn(`${provider} connect callback without state`);
      throw new BadRequestException('Missing state');
    }
    const row = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (row) await this.prisma.oAuthState.delete({ where: { state } });
    if (!row || row.provider !== provider || row.expiresAt < new Date()) {
      const why = !row ? 'unknown or already used' : row.provider !== provider ? `meant for ${row.provider}` : 'expired';
      this.logger.warn(`${provider} connect link rejected: ${why}`);
      throw new BadRequestException('This connect link expired or was already used. Start again.');
    }
    return row;
  }
}
