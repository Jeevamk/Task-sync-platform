import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

const ProjectId = () => Param('projectId', new ParseUUIDPipe());

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgAccessGuard)
@Controller('orgs/:orgId')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** Boards the connected Trello account can see (for the "Add project" form). */
  @Get('trello/boards')
  boards(@Param('orgId') orgId: string) {
    return this.projects.boards(orgId);
  }

  /** Channels in the connected Slack workspace (for the "Add project" form). */
  @Get('slack/channels')
  channels(@Param('orgId') orgId: string) {
    return this.projects.channels(orgId);
  }

  @Get('projects')
  list(@Param('orgId') orgId: string) {
    return this.projects.list(orgId);
  }

  @Post('projects')
  create(@Param('orgId') orgId: string, @Body() body: CreateProjectDto) {
    return this.projects.create(orgId, body);
  }

  @Get('projects/:projectId')
  get(@Param('orgId') orgId: string, @ProjectId() projectId: string) {
    return this.projects.get(orgId, projectId);
  }

  @Get('projects/:projectId/board-members')
  boardMembers(@Param('orgId') orgId: string, @ProjectId() projectId: string) {
    return this.projects.boardMembers(orgId, projectId);
  }

  /** Re-register the Trello webhook, e.g. after the server address changed. */
  @Post('projects/:projectId/webhook')
  webhook(@Param('orgId') orgId: string, @ProjectId() projectId: string) {
    return this.projects.registerWebhook(orgId, projectId);
  }

  /** Import open cards again (cards already known are skipped). */
  @Post('projects/:projectId/import')
  import(@Param('orgId') orgId: string, @ProjectId() projectId: string) {
    return this.projects.importCards(orgId, projectId);
  }

  /** Stop syncing this project (data is kept). */
  @Delete('projects/:projectId')
  deactivate(@Param('orgId') orgId: string, @ProjectId() projectId: string) {
    return this.projects.deactivate(orgId, projectId);
  }
}
