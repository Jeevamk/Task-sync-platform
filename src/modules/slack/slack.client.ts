import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionsService } from '../connections/connections.service';

/** Bot scopes requested when a customer clicks "Add to Slack". */
export const SLACK_SCOPES = [
  'chat:write',
  'chat:write.public',
  'commands',
  'users:read',
  'users:read.email',
  'im:write',
  'channels:read',
  'groups:read',
].join(',');

const logger = new Logger('SlackApi');

export class SlackError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
  ) {
    super(`Slack ${method}: ${code}`);
  }
}

/** Slack Web API bound to ONE bot token (one customer's workspace). */
export class SlackApi {
  constructor(private readonly token: string) {}

  postMessage(body: { channel: string; text: string; thread_ts?: string; reply_broadcast?: boolean }): Promise<{ ts: string; channel: string }> {
    return this.call('chat.postMessage', { unfurl_links: false, ...body });
  }

  async listChannels(): Promise<{ id: string; name: string; is_private: boolean; is_member: boolean }[]> {
    const out: { id: string; name: string; is_private: boolean; is_member: boolean }[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const r = await this.call<{ channels: typeof out; response_metadata?: { next_cursor?: string } }>('conversations.list', {
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...r.channels.map((c) => ({ id: c.id, name: c.name, is_private: c.is_private, is_member: c.is_member })));
      cursor = r.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return out;
  }

  async channelInfo(channel: string): Promise<{ id: string; name: string; is_private: boolean; is_member: boolean }> {
    const r = await this.call<{ channel: { id: string; name: string; is_private: boolean; is_member: boolean } }>('conversations.info', { channel });
    return r.channel;
  }

  async lookupUserByEmail(email: string): Promise<{ id: string; name: string } | null> {
    try {
      const r = await this.call<{ user: { id: string; real_name?: string; name: string } }>('users.lookupByEmail', { email });
      return { id: r.user.id, name: r.user.real_name || r.user.name };
    } catch (err) {
      if (err instanceof SlackError && err.code === 'users_not_found') return null;
      throw err;
    }
  }

  async call<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T> {
    // users.lookupByEmail and conversations.* accept form fields; chat.* accepts JSON. Form works for all of these.
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) form.set(k, String(v));
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!json.ok) {
      logger.warn(`Slack ${method} -> ${json.error}`);
      throw new SlackError(method, json.error ?? `http_${res.status}`);
    }
    return json;
  }
}

@Injectable()
export class SlackClient {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: ConnectionsService,
  ) {}

  async forOrg(organizationId: string): Promise<SlackApi> {
    return new SlackApi(await this.connections.getToken(organizationId, 'SLACK'));
  }

  /** "Add to Slack" link. */
  authorizeUrl(state: string, redirectUri: string): string {
    const u = new URL('https://slack.com/oauth/v2/authorize');
    u.searchParams.set('client_id', this.config.getOrThrow('SLACK_CLIENT_ID'));
    u.searchParams.set('scope', SLACK_SCOPES);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  /** Exchange the code from Slack's redirect for the workspace's bot token. */
  async exchangeCode(code: string, redirectUri: string): Promise<{ token: string; teamId: string; teamName: string; botUserId: string; scopes: string }> {
    const form = new URLSearchParams({
      client_id: this.config.getOrThrow('SLACK_CLIENT_ID'),
      client_secret: this.config.getOrThrow('SLACK_CLIENT_SECRET'),
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      access_token?: string;
      scope?: string;
      bot_user_id?: string;
      team?: { id: string; name: string };
    };
    if (!json.ok || !json.access_token || !json.team) throw new SlackError('oauth.v2.access', json.error ?? 'no_token');
    return { token: json.access_token, teamId: json.team.id, teamName: json.team.name, botUserId: json.bot_user_id ?? '', scopes: json.scope ?? '' };
  }
}

@Global()
@Module({ providers: [SlackClient], exports: [SlackClient] })
export class SlackModule {}
