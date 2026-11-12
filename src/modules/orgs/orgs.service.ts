import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { maskEmail, shortId } from '../../common/logging/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { SheetsClient } from '../google/sheets.client';

/** Organizations = customer teams. Each one connects its own Trello, Slack and Google Sheet. */
@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly sheets: SheetsClient,
  ) {}

  /** Creates an organization; the user who creates it becomes its OWNER. */
  async create(user: AuthUser, rawName: string) {
    const name = String(rawName ?? '').trim();
    if (name.length < 2) throw new BadRequestException('name is required');

    const org = await this.prisma.organization.create({
      data: { name, memberships: { create: { userId: user.id, role: 'OWNER' } } },
    });
    this.logger.log(`Organization "${org.name}" (${shortId(org.id)}) created by ${maskEmail(user.email)}`);
    return { id: org.id, name: org.name, role: 'OWNER' };
  }

  /** Organizations the user belongs to. */
  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({ where: { userId }, include: { organization: true } });
    return memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }));
  }

  /** Connections, counts, and the email customers must share their sheet with. */
  async overview(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { _count: { select: { projects: true, teamMembers: true } } },
    });
    return {
      id: org.id,
      name: org.name,
      connections: await this.connections.status(orgId),
      googleSheets: { shareWith: this.sheets.serviceAccountEmail, howTo: 'Share your tracker sheet with this email as Editor' },
      projects: org._count.projects,
      teamMembers: org._count.teamMembers,
    };
  }
}
