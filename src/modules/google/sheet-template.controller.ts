import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SHEET_TABS } from './sheet-template';
import { templateCsv, templateXlsx } from './sheet-template-file';

const TAB_NAMES = SHEET_TABS.map((t) => t.title.toLowerCase());

/** Public: the sample sheet holds only column headers, nothing private. */
@ApiTags('Sheets')
@Controller('sheet-template')
export class SheetTemplateController {
  @Get()
  @ApiOperation({
    summary: 'Download the sample Google Sheet (headers only)',
    description:
      'For using your own sheet instead of sheet "new". Default: an .xlsx with the Tasks, History and Import tabs; ' +
      'in Google Sheets use File → Import → Upload (or upload it to Drive and open it with Google Sheets). ' +
      'format=csv&tab=tasks|history|import gives one tab\'s header row as CSV.',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['xlsx', 'csv'] })
  @ApiQuery({ name: 'tab', required: false, enum: TAB_NAMES, description: 'Only with format=csv (default: tasks)' })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')
  download(@Res() res: Response, @Query('format') format = 'xlsx', @Query('tab') tab = 'tasks'): void {
    const f = String(format).toLowerCase();
    if (f === 'xlsx') {
      res
        .status(200)
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="taskvane-sheet-template.xlsx"',
        })
        .send(templateXlsx());
      return;
    }
    if (f !== 'csv') throw new BadRequestException('format must be xlsx or csv');
    const csv = templateCsv(String(tab));
    if (csv === undefined) throw new BadRequestException(`tab must be one of: ${TAB_NAMES.join(', ')}`);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="taskvane-${String(tab).toLowerCase()}-template.csv"`,
      })
      .send(csv);
  }
}
