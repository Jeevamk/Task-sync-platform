import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { SheetSecretGuard } from '../../common/guards/sheet-secret.guard';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CardImportService } from './card-import.service';
import { ImportRequestDto, ImportResponseDto } from './dto/import-request.dto';

/** Called by the Apps Script inside the Google Sheet. */
@ApiTags('Sheets')
@ApiSecurity('sync-secret')
@Controller('webhooks/sheets')
@UseGuards(SheetSecretGuard)
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(private readonly importer: CardImportService) {}

  /** Create Trello cards from the rows of the Import tab. */
  @Post('import')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create Trello cards from sheet rows',
    description:
      'Called by the Apps Script in the Google Sheet. Needs the X-Sync-Secret header (use "Authorize" → sync-secret). ' +
      'Each row is handled on its own: a bad row is reported in "results" without failing the others. ' +
      'Sending the same "key" again never creates a second card.',
  })
  @ApiOkResponse({ type: ImportResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-Sync-Secret' })
  importCards(@Body() body: ImportRequestDto): Promise<ImportResponseDto> {
    this.logger.log(`Import requested from the sheet's Apps Script: sheet ${body?.sheetId ?? '?'}, ${body?.rows?.length ?? 0} rows`);
    return this.importer.importRows(body);
  }
}
