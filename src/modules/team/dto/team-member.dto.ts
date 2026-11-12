import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { trim, trimLower } from '../../../common/validation/transforms';

export const TEAM_ROLES: Role[] = ['DEV', 'QA', 'COORDINATOR'];

/** Body of POST /orgs/:orgId/team. A member is matched by email: sending the same email again updates them. */
export class TeamMemberDto {
  @ApiProperty({ example: 'Athira' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'athira@company.com', description: 'Use the same email as their Slack account' })
  @Transform(trimLower)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiProperty({ enum: TEAM_ROLES })
  @IsIn(TEAM_ROLES, { message: 'role must be DEV, QA or COORDINATOR' })
  role!: Role;

  @ApiPropertyOptional({ example: 'athira123', description: 'Trello username (with or without @) or member ID; looked up automatically' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  trello?: string;

  @ApiPropertyOptional({ example: 'U0123456789', description: 'Leave empty: found in Slack by email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  // Empty is allowed (= look it up by email); otherwise it must look like a Slack user ID.
  @Matches(/^$|^[UW][A-Z0-9]{6,}$/, { message: 'slackUserId must look like U0123456789 (or leave it empty)' })
  slackUserId?: string;
}
