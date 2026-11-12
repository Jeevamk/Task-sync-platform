import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

/** Most rows one import may send. */
export const MAX_IMPORT_ROWS = 100;

/**
 * One row from the sheet's Import tab.
 * Only the SHAPE is checked here. Row content (empty title, unknown assignee, …) is checked per row
 * by the import service, so one bad row is reported in the sheet instead of failing the whole import.
 */
export class ImportRowDto {
  @ApiProperty({ example: 5, description: 'Row number in the sheet (used in the result)' })
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @ApiProperty({
    example: 'row-7f3a9c',
    description: 'Stable ID of the row (written by the Apps Script), so a row is never created twice. Use a new key for each new card',
  })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'Fix login button' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'The login button does nothing on Safari' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'To Do', description: 'List name; empty = Assigned (with an assignee) or To Do' })
  @IsOptional()
  @IsString()
  list?: string;

  @ApiPropertyOptional({ example: 'Jeeva', description: 'Team member name or email (needs a Trello username in the team list)' })
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'YYYY-MM-DD, due at 18:00 India time' })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'High, Frontend', description: 'Comma-separated label names' })
  @IsOptional()
  @IsString()
  labels?: string;
}

/** Body of POST /webhooks/sheets/import (sent by the sheet's Apps Script). */
export class ImportRequestDto {
  @ApiProperty({
    example: '1Qqwr8bXyZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
    description: 'ID of the Google Sheet linked to the project (the part after /d/ in its link)',
  })
  @IsString()
  @IsNotEmpty({ message: 'sheetId is required' })
  sheetId!: string;

  @ApiPropertyOptional({
    example: 'coordinator@example.com',
    description: 'Google account of the person who clicked Import; must be a COORDINATOR in the team list',
  })
  @IsOptional()
  @IsString() // not IsEmail: Apps Script sends "" when Google hides the user's email
  editorEmail?: string;

  @ApiProperty({ type: [ImportRowDto], description: `1 to ${MAX_IMPORT_ROWS} rows` })
  @IsArray({ message: 'rows must be a list' })
  @ArrayMaxSize(MAX_IMPORT_ROWS, { message: `At most ${MAX_IMPORT_ROWS} rows per import` })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

/** What happened to one row. */
export class ImportRowResult {
  @ApiProperty({ example: 5 }) rowNumber!: number;
  @ApiProperty({ example: true }) ok!: boolean;
  @ApiProperty({ enum: ['created', 'already-created', 'error'], example: 'created' }) status!: 'created' | 'already-created' | 'error';
  @ApiPropertyOptional({ example: 'https://trello.com/c/AbCd1234' }) cardUrl?: string;
  @ApiPropertyOptional({ example: ['label "Urgent" not on the board'] }) warnings?: string[];
  @ApiPropertyOptional({ example: 'Assignee "Ravi" is not in the team list' }) error?: string;
}

/** Response of POST /webhooks/sheets/import. */
export class ImportResponseDto {
  @ApiProperty({ example: 1 }) created!: number;
  @ApiProperty({ example: 0 }) failed!: number;
  @ApiProperty({ type: [ImportRowResult] }) results!: ImportRowResult[];
}
