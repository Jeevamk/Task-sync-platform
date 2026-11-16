import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errMsg, shortId } from '../../common/logging/redact';
import { GoogleOAuthClient } from '../google/google-oauth.client';
import { SlackClient } from '../slack/slack.client';
import { TrelloClient } from '../trello/trello.client';
import { ConnectionsService } from './connections.service';
import { SIGNUP } from './signup-links';

/** What a start call returns: the link to open, and where to sign up first if the user has no account. */
export interface ConnectStart {
  authorizeUrl: string;
  signupUrl: string;
  howTo: string;
}

/**
 * The "Connect Trello", "Add to Slack" and "Connect Google" flows:
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
    private readonly google: GoogleOAuthClient,
    private readonly config: ConfigService,
  ) {}

  // ── Trello ──

  async startTrello(orgId: string, userEmail: string): Promise<ConnectStart> {
    const state = await this.connections.createState(orgId, 'TRELLO', userEmail);
    return { authorizeUrl: this.trello.authorizeUrl(`${this.baseUrl()}/connect/trello/callback?state=${state}`), ...SIGNUP.TRELLO };
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

  async startSlack(orgId: string, userEmail: string): Promise<ConnectStart> {
    const state = await this.connections.createState(orgId, 'SLACK', userEmail);
    return { authorizeUrl: this.slack.authorizeUrl(state, this.slackRedirectUri()), ...SIGNUP.SLACK };
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

  // ── Google ──

  async startGoogle(orgId: string, userEmail: string): Promise<ConnectStart> {
    this.google.assertConfigured(); // clear message before a connect link is made
    const state = await this.connections.createState(orgId, 'GOOGLE', userEmail);
    return { authorizeUrl: this.google.authorizeUrl(state, this.googleRedirectUri()), ...SIGNUP.GOOGLE };
  }

  /** Returns the Google account email. Throws with a readable message if anything fails. */
  async finishGoogle(code: string, state: string): Promise<string> {
    const st = await this.connections.consumeState(state, 'GOOGLE');
    const account = await this.google.exchangeCode(code, this.googleRedirectUri());
    await this.connections.save(st.organizationId, 'GOOGLE', {
      externalId: account.sub,
      externalName: account.email,
      token: account.refreshToken,
      scopes: account.scopes,
      connectedBy: st.userEmail,
    });
    return account.email;
  }

  // ── helpers ──

  /** Must be listed in the Google OAuth client's "Authorized redirect URIs". */
  private googleRedirectUri(): string {
    return `${this.baseUrl()}/connect/google/callback`;
  }

  /** Must match the Redirect URL saved in the Slack app exactly. */
  private slackRedirectUri(): string {
    return `${this.baseUrl()}/connect/slack/callback`;
  }

  private baseUrl(): string {
    return this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '');
  }
}
