import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @ApiProperty({ example: 'Website Revamp' }) name!: string;
  @ApiProperty({
    example: 'new',
    description: 'Board link, short code or ID, or "new" to create a fresh board with all the lists',
  })
  trelloBoard!: string;
  @ApiPropertyOptional({ example: 'Website Revamp', description: 'Only with trelloBoard "new": the board name (default: the project name)' })
  newBoardName?: string;
  @ApiPropertyOptional({ description: 'Only with trelloBoard "new": Trello workspace ID to create the board in (default: your default workspace)' })
  trelloWorkspaceId?: string;
  @ApiProperty({ example: 'https://docs.google.com/spreadsheets/d/1Qqwr…/edit', description: 'Sheet link or ID' })
  sheet!: string;
  @ApiProperty({ example: 'C0123456789', description: 'From GET …/slack/channels' }) slackChannelId!: string;
  @ApiPropertyOptional({
    example: ['Backlog'],
    description: 'Extra lists created if missing, placed before "To Do". Not linked to a status: cards there are not tracked',
  })
  extraLists?: string[];
  @ApiPropertyOptional({
    description: 'Only if your list names differ from: To Do, Assigned, In Progress, Ready for Testing, Completed. Example: { "IN_PROGRESS": "Doing" }',
  })
  lists?: Record<string, string>;
  @ApiPropertyOptional({
    example: false,
    description: 'true = create any missing lists on the board (in workflow order) instead of failing. Always on for trelloBoard "new"',
  })
  createMissingLists?: boolean;
}

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgAccessGuard)
@Controller('orgs/:orgId')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('trello/boards')
  boards(@Param('orgId') orgId: string) {
    return this.projects.boards(orgId);
  }

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
  get(@Param('orgId') orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.projects.get(orgId, projectId);
  }

  @Get('projects/:projectId/board-members')
  boardMembers(@Param('orgId') orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.projects.boardMembers(orgId, projectId);
  }

  /** Re-register the Trello webhook, e.g. after the server address changed. */
  @Post('projects/:projectId/webhook')
  webhook(@Param('orgId') orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.projects.registerWebhook(orgId, projectId);
  }

  @Post('projects/:projectId/import')
  import(@Param('orgId') orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.projects.importCards(orgId, projectId);
  }

  @Delete('projects/:projectId')
  deactivate(@Param('orgId') orgId: string, @Param('projectId', new ParseUUIDPipe()) projectId: string) {
    return this.projects.deactivate(orgId, projectId);
  }
}
