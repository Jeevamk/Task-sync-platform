import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Provider } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { SlackClient } from '../slack/slack.client';
import { TrelloClient } from '../trello/trello.client';
import { ConnectionsService } from './connections.service';

class TrelloCompleteDto {
  @ApiProperty() state!: string;
  @ApiProperty() token!: string;
}

/** Connect each organization's OWN Trello and Slack. */
@ApiTags('Connections')
@Controller()
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly trello: TrelloClient,
    private readonly slack: SlackClient,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '');
  }

  @Get('orgs/:orgId/connections')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  status(@Param('orgId') orgId: string) {
    return this.connections.status(orgId);
  }

  /** Returns the link to open in the browser: Trello asks the user to allow Task Sync. */
  @Post('orgs/:orgId/connections/trello/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  async startTrello(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    const state = await this.connections.createState(orgId, 'TRELLO', user.email);
    return { authorizeUrl: this.trello.authorizeUrl(`${this.base()}/connect/trello/callback?state=${state}`) };
  }

  /** Returns the "Add to Slack" link to open in the browser. */
  @Post('orgs/:orgId/connections/slack/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  async startSlack(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    const state = await this.connections.createState(orgId, 'SLACK', user.email);
    return { authorizeUrl: this.slack.authorizeUrl(state, `${this.base()}/connect/slack/callback`) };
  }

  @Delete('orgs/:orgId/connections/:provider')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  async disconnect(@Param('orgId') orgId: string, @Param('provider') provider: string) {
    const p = provider.toUpperCase();
    if (p !== 'TRELLO' && p !== 'SLACK') throw new BadRequestException('provider must be trello or slack');
    await this.connections.remove(orgId, p as Provider);
    return { ok: true };
  }

  /**
   * Trello sends the user back here with the token in the URL fragment (#token=...),
   * which only the browser can read. This small page reads it and finishes the connection.
   */
  @Get('connect/trello/callback')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  trelloCallbackPage(@Query('state') state: string): string {
    const safeState = String(state ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    return page(
      'Connecting Trello…',
      `<p id="msg">Connecting your Trello account…</p>
<script>
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const msg = document.getElementById('msg');
  if (!token) { msg.textContent = 'Trello did not return a token. Close this tab and try again.'; return; }
  const res = await fetch('/connect/trello/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: '${safeState}', token })
  });
  const body = await res.json().catch(() => ({}));
  msg.textContent = res.ok ? '✅ Trello connected as ' + body.account + '. You can close this tab.' : '❌ ' + (body.message || 'Could not connect Trello');
  history.replaceState(null, '', location.pathname);
})();
</script>`,
    );
  }

  @Post('connect/trello/complete')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async trelloComplete(@Body() body: TrelloCompleteDto) {
    const st = await this.connections.consumeState(body?.state, 'TRELLO');
    if (!body?.token || !/^[A-Za-z0-9]{32,128}$/.test(body.token)) throw new BadRequestException('Invalid Trello token');
    const me = await this.trello.withToken(body.token).getMe();
    await this.connections.save(st.organizationId, 'TRELLO', {
      externalId: me.id,
      externalName: `${me.fullName} (@${me.username})`,
      token: body.token,
      scopes: 'read,write',
      connectedBy: st.userEmail,
    });
    return { ok: true, account: me.fullName };
  }

  /** Slack sends the user back here with ?code=…&state=… after "Add to Slack". */
  @Get('connect/slack/callback')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async slackCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') error?: string): Promise<string> {
    if (error) return page('Slack', `<p>❌ Slack returned: ${escapeHtml(error)}. Close this tab and try again.</p>`);
    try {
      const st = await this.connections.consumeState(state, 'SLACK');
      const r = await this.slack.exchangeCode(code, `${this.base()}/connect/slack/callback`);
      await this.connections.save(st.organizationId, 'SLACK', {
        externalId: r.teamId,
        externalName: r.teamName,
        token: r.token,
        botUserId: r.botUserId,
        scopes: r.scopes,
        connectedBy: st.userEmail,
      });
      return page('Slack connected', `<p>✅ Task Sync was added to the Slack workspace <b>${escapeHtml(r.teamName)}</b>. You can close this tab.</p>`);
    } catch (err) {
      return page('Slack', `<p>❌ ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;line-height:1.5;color:#1c1c1a}</style>
</head><body><h1 style="font-size:20px">Task Sync</h1>${body}</body></html>`;
}
