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
}
