import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { SlackClient } from '../slack/slack.client';
import { TrelloClient } from '../trello/trello.client';

class TeamMemberDto {
  @ApiProperty({ example: 'Athira' }) name!: string;
  @ApiProperty({ example: 'athira@company.com' }) email!: string;
  @ApiProperty({ enum: ['DEV', 'QA', 'COORDINATOR'] }) role!: Role;
  @ApiPropertyOptional({ example: 'athira123', description: 'Trello username (or member ID); found automatically' })
  trello?: string;
  @ApiPropertyOptional({ example: 'U0123456789', description: 'Leave empty: found in Slack by email' })
  slackUserId?: string;
}

/** The people who move cards, per organization. Their Trello/Slack IDs are looked up automatically. */
@ApiTags('Team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgAccessGuard)
@Controller('orgs/:orgId/team')
export class TeamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trello: TrelloClient,
    private readonly slack: SlackClient,
  ) {}

  @Get()
  list(@Param('orgId') orgId: string) {
    return this.prisma.teamMember.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  }

  /** Add or update a member (matched by email). */
  @Post()
  async upsert(@Param('orgId') orgId: string, @Body() body: TeamMemberDto) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const name = String(body?.name ?? '').trim();
    if (!email || !name) throw new BadRequestException('name and email are required');
    if (!['DEV', 'QA', 'COORDINATOR'].includes(body.role)) throw new BadRequestException('role must be DEV, QA or COORDINATOR');

    const notes: string[] = [];
    let trelloMemberId: string | null = null;
    if (body.trello?.trim()) {
      const api = await this.trello.forOrg(orgId);
      const m = await api.getMember(body.trello.trim()).catch(() => null);
      if (!m) throw new BadRequestException(`Trello user "${body.trello}" not found`);
      trelloMemberId = m.id;
      notes.push(`Trello: ${m.fullName} (@${m.username})`);
    }

    let slackUserId = body.slackUserId?.trim() || null;
    if (!slackUserId) {
      const api = await this.slack.forOrg(orgId).catch(() => null);
      const u = api ? await api.lookupUserByEmail(email).catch(() => null) : null;
      if (u) {
        slackUserId = u.id;
        notes.push(`Slack: found ${u.name} by email`);
      } else notes.push('Slack: not found by email (mentions will use the name)');
    }

    const data = { name, role: body.role, active: true, ...(trelloMemberId ? { trelloMemberId } : {}), ...(slackUserId ? { slackUserId } : {}) };
    const member = await this.prisma.teamMember.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, ...data },
      update: data,
    });
    return { member, notes };
  }

  @Delete(':memberId')
  async remove(@Param('orgId') orgId: string, @Param('memberId', new ParseUUIDPipe()) memberId: string) {
    await this.prisma.teamMember.updateMany({ where: { id: memberId, organizationId: orgId }, data: { active: false } });
    return { ok: true };
  }
}
