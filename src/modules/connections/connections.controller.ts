import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Logger, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Provider } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { errMsg } from '../../common/logging/redact';
import { ConnectFlowService } from './connect-flow.service';
import { escapeHtml, resultPage, trelloCallbackPage } from './connect-pages';
import { ConnectionsService } from './connections.service';
import { TrelloCompleteDto } from './dto/trello-complete.dto';

/** Connect each organization's OWN Trello and Slack. */
@ApiTags('Connections')
@Controller()
export class ConnectionsController {
  private readonly logger = new Logger(ConnectionsController.name);

  constructor(
    private readonly connections: ConnectionsService,
    private readonly connectFlow: ConnectFlowService,
  ) {}

  // ─────────── Called from Swagger / the web app (login required) ───────────

  @Get('orgs/:orgId/connections')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  status(@Param('orgId') orgId: string) {
    return this.connections.status(orgId);
  }

  /** Returns the link to open in the browser: Trello asks the user to allow Taskvane. */
  @Post('orgs/:orgId/connections/trello/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  startTrello(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.connectFlow.startTrello(orgId, user.email);
  }

  /** Returns the "Add to Slack" link to open in the browser. */
  @Post('orgs/:orgId/connections/slack/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgAccessGuard)
  startSlack(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.connectFlow.startSlack(orgId, user.email);
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

  // ─────────── Opened by the browser when Trello / Slack send the user back ───────────

  /** Trello's return address: a small page that reads the token from #token=… and finishes the connection. */
  @Get('connect/trello/callback')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  trelloCallback(@Query('state') state: string): string {
    return trelloCallbackPage(state);
  }

  /** Called by the page above. */
  @Post('connect/trello/complete')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  trelloComplete(@Body() body: TrelloCompleteDto) {
    return this.connectFlow.finishTrello(body?.state, body?.token);
  }

  /** Slack's return address, with ?code=…&state=… (or ?error=… if the user cancelled). */
  @Get('connect/slack/callback')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async slackCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') error?: string): Promise<string> {
    if (error) {
      // e.g. access_denied when the user clicked Cancel.
      this.logger.warn(`Slack connect cancelled or refused by Slack: ${error}`);
      return resultPage(false, `Slack returned: ${escapeHtml(error)}. Close this tab and try again.`);
    }
    try {
      const workspace = await this.connectFlow.finishSlack(code, state);
      return resultPage(true, `Taskvane was added to the Slack workspace <b>${escapeHtml(workspace)}</b>. You can close this tab.`);
    } catch (err) {
      // The user only sees this page, so the log is the only place the failure is recorded.
      this.logger.warn(`Slack connect failed: ${errMsg(err)}`);
      return resultPage(false, escapeHtml(err instanceof Error ? err.message : String(err)));
    }
  }
}
