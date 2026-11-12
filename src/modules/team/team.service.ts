import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { errMsg, maskEmail, shortId } from '../../common/logging/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { SlackClient } from '../slack/slack.client';
import { TrelloClient } from '../trello/trello.client';
import { TEAM_ROLES, TeamMemberDto } from './dto/team-member.dto';

/** The people who move cards, per organization. Their Trello and Slack IDs are looked up automatically. */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trello: TrelloClient,
    private readonly slack: SlackClient,
  ) {}

  list(orgId: string) {
    return this.prisma.teamMember.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  }

  /** Adds a member, or updates the one with the same email. `notes` tell the caller what was matched. */
  async upsert(orgId: string, body: TeamMemberDto) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const name = String(body?.name ?? '').trim();
    if (!email || !name) throw new BadRequestException('name and email are required');
    if (!TEAM_ROLES.includes(body.role)) throw new BadRequestException('role must be DEV, QA or COORDINATOR');

    const notes: string[] = [];
    const trelloMemberId = await this.findTrelloMember(orgId, body.trello, notes);
    const slackUserId = body.slackUserId?.trim() || (await this.findSlackUser(orgId, email, notes));

    // Only overwrite the IDs we actually found, so a failed lookup never erases a working one.
    const data = {
      name,
      role: body.role,
      active: true,
      ...(trelloMemberId ? { trelloMemberId } : {}),
      ...(slackUserId ? { slackUserId } : {}),
    };
    const member = await this.prisma.teamMember.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, ...data },
      update: data,
    });

    this.logger.log(
      `Org ${shortId(orgId)}: team member ${name} <${maskEmail(email)}> saved as ${body.role} ` +
        `(Trello ${member.trelloMemberId ? 'linked' : 'not linked'}, Slack ${member.slackUserId ? 'linked' : 'not linked'})`,
    );
    return { member, notes };
  }

  /** Soft delete: the member stays in history but is no longer active. */
  async deactivate(orgId: string, memberId: string) {
    const result = await this.prisma.teamMember.updateMany({ where: { id: memberId, organizationId: orgId }, data: { active: false } });
    this.logger.log(`Org ${shortId(orgId)}: team member ${shortId(memberId)} deactivated (${result.count} updated)`);
    return { ok: true };
  }

  /** Trello username → member ID. Fails if a username was given but doesn't exist. */
  private async findTrelloMember(orgId: string, username: string | undefined, notes: string[]): Promise<string | null> {
    const clean = username?.trim().replace(/^@+/, '') ?? ''; // accept "@name" as copied from Trello
    if (!clean) return null;

    const api = await this.trello.forOrg(orgId);
    const member = await api.getMember(clean).catch((err: unknown) => {
      this.logger.warn(`Org ${shortId(orgId)}: Trello lookup of "${clean}" failed: ${errMsg(err)}`);
      return null;
    });
    if (!member) throw new BadRequestException(`Trello user "${clean}" not found (use the username from trello.com/u/<username>)`);

    notes.push(`Trello: ${member.fullName} (@${member.username})`);
    return member.id;
  }

  /** Email → Slack user ID. Never fails: without it, messages use the person's name instead of an @mention. */
  private async findSlackUser(orgId: string, email: string, notes: string[]): Promise<string | null> {
    const api = await this.slack.forOrg(orgId).catch(() => null); // Slack not connected yet
    const user = api
      ? await api.lookupUserByEmail(email).catch((err: unknown) => {
          this.logger.warn(`Org ${shortId(orgId)}: Slack lookup of ${maskEmail(email)} failed: ${errMsg(err)}`);
          return null;
        })
      : null;

    if (!user) {
      notes.push('Slack: not found by email (mentions will use the name)');
      return null;
    }
    notes.push(`Slack: found ${user.name} by email`);
    return user.id;
  }
}
