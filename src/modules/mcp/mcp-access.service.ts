import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user';
import { maskEmail, shortId } from '../../common/logging/redact';
import { DatabaseService } from '../../database/database.service';
import type { OrgRole } from '../../database/types';

/**
 * Access checks for MCP tools. A tool gets the organization from its arguments (there is no
 * /orgs/:orgId in the URL), so OrgAccessGuard cannot run; tools call these checks instead.
 * They throw a plain Error: the MCP server turns it into a tool error the AI can read and act on.
 */
@Injectable()
export class McpAccessService {
  private readonly logger = new Logger(McpAccessService.name);

  constructor(private readonly db: DatabaseService) {}

  /** The user must be a member of the organization (same rule as OrgAccessGuard). Returns their role. */
  async requireMember(user: AuthUser, orgId: string): Promise<OrgRole> {
    const membership = await this.db.memberships.findOne({ userId: user.id, organizationId: orgId });
    if (!membership) {
      this.logger.warn(`${maskEmail(user.email)} tried to use org ${shortId(orgId)} over MCP without being a member`);
      throw new Error('Organization not found, or you are not a member of it. Use list_organizations to see yours.');
    }
    return membership.role;
  }

  /**
   * Every tool that changes data must call this first. POST /mcp lets `read` tokens in (see
   * @ReadTokenAllowed on McpController), so this is the only thing keeping them read-only.
   * The login token (JWT) and `read+write` tokens pass.
   */
  requireWrite(user: AuthUser): void {
    if (user.via === 'token' && user.scope !== 'read+write') {
      this.logger.warn(`Read-only token ${shortId(user.tokenId)} refused for a write tool over MCP`);
      throw new Error('This access token is read-only. Use a token with scope "read+write" to make changes.');
    }
  }

  /** The user must be a member of the organization with one of `roles` (e.g. only an OWNER may remove members). */
  async requireRole(user: AuthUser, orgId: string, roles: readonly OrgRole[]): Promise<OrgRole> {
    const role = await this.requireMember(user, orgId);
    if (!roles.includes(role)) {
      this.logger.warn(`${maskEmail(user.email)} (${role}) refused in org ${shortId(orgId)} over MCP: needs ${roles.join(' or ')}`);
      throw new Error(`Only ${roles.join(' or ')} members of this organization can do that. Your role is ${role}.`);
    }
    return role;
  }

  /** For write tools: the token may write, and the user has one of `roles` in the organization. */
  async requireWriteRole(user: AuthUser, orgId: string, roles: readonly OrgRole[]): Promise<OrgRole> {
    this.requireWrite(user);
    return this.requireRole(user, orgId, roles);
  }
}
