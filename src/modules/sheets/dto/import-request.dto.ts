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

  @ApiProperty({ description: 'Stable ID of the row (written by the Apps Script), so a row is never created twice' })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'Fix login button' })
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'To Do', description: 'List name; empty = Assigned (with an assignee) or To Do' })
  @IsOptional()
  @IsString()
  list?: string;

  @ApiPropertyOptional({ description: 'Team member name or email' })
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
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
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'sheetId is required' })
  sheetId!: string;

  @ApiPropertyOptional({ description: 'Google account of the person who clicked Import; must be a COORDINATOR' })
  @IsOptional()
  @IsString() // not IsEmail: Apps Script sends "" when Google hides the user's email
  editorEmail?: string;

  @ApiProperty({ type: [ImportRowDto] })
  @IsArray({ message: 'rows must be a list' })
  @ArrayMaxSize(MAX_IMPORT_ROWS, { message: `At most ${MAX_IMPORT_ROWS} rows per import` })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

/** What happened to one row. */
export interface ImportRowResult {
  rowNumber: number;
  ok: boolean;
  status: 'created' | 'already-created' | 'error';
  cardUrl?: string;
  warnings?: string[];
  error?: string;
}
