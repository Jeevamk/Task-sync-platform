import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { SheetsClient } from '../google/sheets.client';

class CreateOrgDto {
  @ApiProperty({ example: 'Acme Dev Team' })
  name!: string;
}

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly sheets: SheetsClient,
  ) {}

  /** Create a workspace for your team; you become its OWNER. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateOrgDto) {
    const name = String(body?.name ?? '').trim();
    if (name.length < 2) throw new BadRequestException('name is required');
    const org = await this.prisma.organization.create({
      data: { name, memberships: { create: { userId: user.id, role: 'OWNER' } } },
    });
    return { id: org.id, name: org.name, role: 'OWNER' };
  }

  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.membership.findMany({ where: { userId: user.id }, include: { organization: true } });
    return rows.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }));
  }

  /** Overview: connections, projects, and the email customers must share their sheet with. */
  @Get(':orgId')
  @UseGuards(OrgAccessGuard)
  async overview(@Param('orgId') orgId: string) {
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
