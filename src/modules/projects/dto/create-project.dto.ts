import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsStatusListMap } from '../../../common/validation/is-status-list-map';
import { trim } from '../../../common/validation/transforms';
import { DEFAULT_LISTS, WorkflowStatus } from '../project-lists';

const STATUSES = Object.keys(DEFAULT_LISTS);

/** Body of POST /orgs/:orgId/projects. */
export class CreateProjectDto {
  @ApiProperty({ example: 'Website Revamp' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'new',
    description: 'Board link, short code or ID, or "new" to create a fresh board with all the lists',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'trelloBoard is required: a board link, or "new"' })
  trelloBoard!: string;

  @ApiPropertyOptional({
    example: 'Website Revamp',
    description: 'Only with trelloBoard "new": the board name (default: the project name)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  newBoardName?: string;

  @ApiPropertyOptional({
    description: 'Only with trelloBoard "new": Trello workspace ID to create the board in (default: your default workspace)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  trelloWorkspaceId?: string;

  @ApiProperty({ example: 'https://docs.google.com/spreadsheets/d/1Qqwr…/edit', description: 'Sheet link or ID' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'sheet is required: the Google Sheet link' })
  sheet!: string;

  @ApiProperty({ example: 'C0123456789', description: 'From GET …/slack/channels' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'slackChannelId is required (get it from GET /orgs/{orgId}/slack/channels)' })
  slackChannelId!: string;

  @ApiPropertyOptional({
    example: ['Backlog'],
    description: 'Extra lists created if missing, placed before "To Do". Not linked to a status: cards there are not tracked',
  })
  @IsOptional()
  @IsArray({ message: 'extraLists must be a list of names, e.g. ["Backlog"]' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  extraLists?: string[];

  @ApiPropertyOptional({
    type: Object,
    description:
      'Only if your list names differ from: To Do, Assigned, In Progress, Ready for Testing, Completed. ' +
      'Example: { "IN_PROGRESS": "Doing" }',
  })
  @IsOptional()
  @IsStatusListMap(STATUSES)
  lists?: Partial<Record<WorkflowStatus, string>>;

  @ApiPropertyOptional({
    example: false,
    description: 'true = create any missing lists on the board (in workflow order) instead of failing. Always on for trelloBoard "new"',
  })
  @IsOptional()
  @IsBoolean({ message: 'createMissingLists must be true or false' })
  createMissingLists?: boolean;

  @ApiPropertyOptional({ type: Object, description: 'Optional project settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
