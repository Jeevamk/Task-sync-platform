import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { TeamMemberDto } from './dto/team-member.dto';
import { TeamService } from './team.service';

@ApiTags('Team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgAccessGuard)
@Controller('orgs/:orgId/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@Param('orgId') orgId: string) {
    return this.team.list(orgId);
  }

  /** Add or update a member (matched by email). */
  @Post()
  upsert(@Param('orgId') orgId: string, @Body() body: TeamMemberDto) {
    return this.team.upsert(orgId, body);
  }

  /** Deactivate a member (kept in history). */
  @Delete(':memberId')
  remove(@Param('orgId') orgId: string, @Param('memberId', new ParseUUIDPipe()) memberId: string) {
    return this.team.deactivate(orgId, memberId);
  }
}
