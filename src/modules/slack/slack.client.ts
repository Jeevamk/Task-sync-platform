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
    logger.debug(`Listed ${out.length} Slack channels`);
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
    const started = Date.now();
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as { ok: boolean; error?: string } & T;
    // Method name and timing only: message text and emails are never logged.
    logger.verbose(`${method} -> ${json.ok ? 'ok' : json.error} ${Date.now() - started}ms`);
    if (!json.ok) {
      // users_not_found is a normal answer for lookupByEmail, not a problem.
      if (json.error === 'users_not_found') logger.debug(`Slack ${method} -> ${json.error}`);
      else logger.warn(`Slack ${method} -> ${json.error}${slackHint(json.error)}`);
      throw new SlackError(method, json.error ?? `http_${res.status}`);
    }
    return json;
  }
}

@Injectable()
export class SlackClient {
  private readonly logger = new Logger(SlackClient.name);

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
    if (!json.ok || !json.access_token || !json.team) {
      this.logger.warn(`Slack install failed at oauth.v2.access: ${json.error ?? 'no_token'}${slackHint(json.error)}`);
      throw new SlackError('oauth.v2.access', json.error ?? 'no_token');
    }
    this.logger.log(`Slack install OK: workspace "${json.team.name}" (${json.team.id}), scopes ${json.scope ?? '-'}`);
    return { token: json.access_token, teamId: json.team.id, teamName: json.team.name, botUserId: json.bot_user_id ?? '', scopes: json.scope ?? '' };
  }
}

/** A short fix-it hint for the Slack errors people actually hit, appended to log lines. */
function slackHint(code: string | undefined): string {
  switch (code) {
    case 'not_in_channel':
    case 'channel_not_found':
      return ' (invite the bot: /invite @Taskvane)';
    case 'missing_scope':
      return ' (add the scope in the Slack app, then reinstall with Add to Slack)';
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
      return ' (the workspace must click Add to Slack again)';
    case 'bad_redirect_uri':
      return ' (add PUBLIC_BASE_URL/connect/slack/callback to the Slack app Redirect URLs)';
    case 'ratelimited':
      return ' (Slack rate limit: will be retried)';
    default:
      return '';
  }
}

@Global()
@Module({ providers: [SlackClient], exports: [SlackClient] })
export class SlackModule {}
