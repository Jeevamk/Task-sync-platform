import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { maskEmail, shortId } from '../../common/logging/redact';
import { DatabaseService } from '../../database/database.service';
import { insertOne } from '../../database/helpers';
import { ConnectionsService } from '../connections/connections.service';
import { SheetsClient } from '../google/sheets.client';

/** Organizations = customer teams. Each one connects its own Trello, Slack and Google Sheet. */
@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly connections: ConnectionsService,
    private readonly sheets: SheetsClient,
  ) {}

  /** Creates an organization; the user who creates it becomes its OWNER. */
  async create(user: AuthUser, rawName: string) {
    const name = String(rawName ?? '').trim();
    if (name.length < 2) throw new BadRequestException('name is required');

    const org = await this.db.transaction(async (session) => {
      const created = await insertOne(this.db.organizations, { name }, session);
      await insertOne(this.db.memberships, { userId: user.id, organizationId: created.id, role: 'OWNER' }, session);
      return created;
    });
    this.logger.log(`Organization "${org.name}" (${shortId(org.id)}) created by ${maskEmail(user.email)}`);
    return { id: org.id, name: org.name, role: 'OWNER' };
  }

  /** Organizations the user belongs to. */
  async listForUser(userId: string) {
    const memberships = await this.db.memberships.find({ userId });
    const orgs = await this.db.organizations.find({ _id: { $in: memberships.map((m) => m.organizationId) } });
    return memberships.flatMap((m) => {
      const org = orgs.find((o) => o.id === m.organizationId);
      return org ? [{ id: org.id, name: org.name, role: m.role }] : [];
    });
  }

  /** Connections, counts, and the email customers must share their sheet with. */
  async overview(orgId: string) {
    const org = await this.db.organizations.findOne({ _id: orgId });
    if (!org) throw new NotFoundException('Organization not found');
    const [projects, teamMembers] = await Promise.all([
      this.db.projects.countDocuments({ organizationId: orgId }),
      this.db.teamMembers.countDocuments({ organizationId: orgId }),
    ]);
    return {
      id: org.id,
      name: org.name,
      connections: await this.connections.status(orgId),
      googleSheets: { shareWith: this.sheets.serviceAccountEmail, howTo: 'Share your tracker sheet with this email as Editor' },
      projects,
      teamMembers,
    };
  }
}
