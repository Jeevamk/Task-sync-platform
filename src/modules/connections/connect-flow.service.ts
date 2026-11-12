import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errMsg, shortId } from '../../common/logging/redact';
import { SlackClient } from '../slack/slack.client';
import { TrelloClient } from '../trello/trello.client';
import { ConnectionsService } from './connections.service';

/**
 * The "Connect Trello" and "Add to Slack" flows:
 *  1. start  → we create a one-time state and return the provider's authorize link;
 *  2. finish → the provider sends the user back; we check the state, get the token and save it (encrypted).
 */
@Injectable()
export class ConnectFlowService {
  private readonly logger = new Logger(ConnectFlowService.name);

  constructor(
    private readonly connections: ConnectionsService,
    private readonly trello: TrelloClient,
    private readonly slack: SlackClient,
    private readonly config: ConfigService,
  ) {}

  // ── Trello ──

  async startTrello(orgId: string, userEmail: string): Promise<{ authorizeUrl: string }> {
    const state = await this.connections.createState(orgId, 'TRELLO', userEmail);
    return { authorizeUrl: this.trello.authorizeUrl(`${this.baseUrl()}/connect/trello/callback?state=${state}`) };
  }

  async finishTrello(state: string, token: string): Promise<{ ok: true; account: string }> {
    const st = await this.connections.consumeState(state, 'TRELLO');
    if (!token || !/^[A-Za-z0-9]{32,128}$/.test(token)) {
      this.logger.warn(`Org ${shortId(st.organizationId)}: Trello returned a token in an unexpected format`);
      throw new BadRequestException('Invalid Trello token');
    }

    // Checks the token works and tells us whose account it is.
    const me = await this.trello
      .withToken(token)
      .getMe()
      .catch((err: unknown) => {
        this.logger.warn(`Org ${shortId(st.organizationId)}: Trello token check failed: ${errMsg(err)}`);
        throw err;
      });

    await this.connections.save(st.organizationId, 'TRELLO', {
      externalId: me.id,
      externalName: `${me.fullName} (@${me.username})`,
      token,
      scopes: 'read,write',
      connectedBy: st.userEmail,
    });
    return { ok: true, account: me.fullName };
  }

  // ── Slack ──

  async startSlack(orgId: string, userEmail: string): Promise<{ authorizeUrl: string }> {
    const state = await this.connections.createState(orgId, 'SLACK', userEmail);
    return { authorizeUrl: this.slack.authorizeUrl(state, this.slackRedirectUri()) };
  }

  /** Returns the workspace name. Throws with a readable message if anything fails. */
  async finishSlack(code: string, state: string): Promise<string> {
    const st = await this.connections.consumeState(state, 'SLACK');
    const install = await this.slack.exchangeCode(code, this.slackRedirectUri());
    await this.connections.save(st.organizationId, 'SLACK', {
      externalId: install.teamId,
      externalName: install.teamName,
      token: install.token,
      botUserId: install.botUserId,
      scopes: install.scopes,
      connectedBy: st.userEmail,
    });
    return install.teamName;
  }

  // ── helpers ──

  /** Must match the Redirect URL saved in the Slack app exactly. */
  private slackRedirectUri(): string {
    return `${this.baseUrl()}/connect/slack/callback`;
  }

  private baseUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '');
  }
}
