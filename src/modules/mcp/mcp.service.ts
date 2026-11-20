import { Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user';
import { OrgsService } from '../orgs/orgs.service';
import { McpAccessService } from './mcp-access.service';

/** Tool results go back to the AI as JSON text. */
export function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** The `orgId` argument shared by every organization tool. */
const orgIdSchema = z.uuid().describe('Organization id, from list_organizations');

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly orgs: OrgsService,
    private readonly access: McpAccessService,
  ) {}

  /**
   * Answers one MCP request (stateless Streamable HTTP): a new server and transport per request,
   * so every tool runs as `user` and nothing is kept between requests (fits Vercel).
   */
  async handleRequest(user: AuthUser, req: Request, res: Response): Promise<void> {
    const server = this.buildServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body); // Nest has already parsed the JSON body
    } catch (err) {
      this.logger.error(`MCP request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  }

  /** The MCP server and its tools for one user. */
  private buildServer(user: AuthUser): McpServer {
    const server = new McpServer({ name: 'taskvane', version: '0.3.0' });

    server.registerTool(
      'list_organizations',
      {
        title: 'List organizations',
        description: 'Organizations you belong to, with your role. Other tools need the organization id from here.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => asJson(await this.orgs.listForUser(user.id)),
    );

    server.registerTool(
      'get_organization',
      {
        title: 'Get organization',
        description:
          'Overview of one organization: which services are connected (Trello, Slack, Google), ' +
          'how many projects and team members it has, and the email to share Google Sheets with.',
        inputSchema: { orgId: orgIdSchema },
        annotations: { readOnlyHint: true },
      },
      async ({ orgId }) => {
        await this.access.requireMember(user, orgId);
        return asJson(await this.orgs.overview(orgId));
      },
    );

    return server;
  }
}
