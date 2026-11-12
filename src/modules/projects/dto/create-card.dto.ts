import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { trim } from '../../../common/validation/transforms';

/** Body of POST /orgs/:orgId/projects/:projectId/cards. */
export class CreateCardDto {
  @ApiProperty({ example: 'Fix login button' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title is required' })
  @MaxLength(1000)
  title!: string;

  @ApiPropertyOptional({ example: 'The login button does nothing on Safari. Steps: open /login, click "Sign in".' })
  @IsOptional()
  @IsString()
  @MaxLength(16384) // Trello's limit
  description?: string;

  @ApiPropertyOptional({
    example: 'To Do',
    description: 'List name on the board. Default: the Assigned list when memberIds are given, otherwise To Do',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  list?: string;

  @ApiPropertyOptional({
    example: ['5f1b2c3d4e5f6a7b8c9d0e1f'],
    description: 'Trello member IDs to assign (from GET …/projects/{projectId}/board-members). They must be on the board',
  })
  @IsOptional()
  @IsArray({ message: 'memberIds must be a list of Trello member IDs' })
  @ArrayMaxSize(20)
  @Matches(/^[0-9a-f]{24}$/i, { each: true, message: 'each memberId must be a Trello member ID (24 characters, from …/board-members)' })
  memberIds?: string[];

  @ApiPropertyOptional({
    example: '2026-11-20',
    description: '"YYYY-MM-DD" (due at 18:00 India time) or a full time with zone, e.g. "2026-11-20T10:00:00Z"',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ example: ['High', 'Frontend'], description: 'Label names that exist on the board' })
  @IsOptional()
  @IsArray({ message: 'labels must be a list of label names, e.g. ["High"]' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  labels?: string[];

  @ApiPropertyOptional({ enum: ['top', 'bottom'], default: 'bottom', description: 'Where in the list the card goes' })
  @IsOptional()
  @IsIn(['top', 'bottom'])
  position?: 'top' | 'bottom';
}

/** Response of POST /orgs/:orgId/projects/:projectId/cards. */
export class CreatedCardDto {
  @ApiProperty({ example: '6734a1b2c3d4e5f6a7b8c9d0' }) id!: string;
  @ApiProperty({ example: 'https://trello.com/c/AbCd1234' }) url!: string;
  @ApiProperty({ example: 'To Do' }) list!: string;
  @ApiProperty({ example: ['Jeeva M K'] }) members!: string[];
  @ApiProperty({ example: ['High', 'Frontend'] }) labels!: string[];
  @ApiPropertyOptional({ example: '2026-11-20T12:30:00.000Z' }) due?: string;
  @ApiProperty({ example: 'The card syncs to the sheet and Slack as soon as Trello reports it (a few seconds)' }) note!: string;
}
