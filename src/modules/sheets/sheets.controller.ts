import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { SheetSecretGuard } from '../../common/guards/sheet-secret.guard';
import { CardImportService } from './card-import.service';
import { ImportRequestDto } from './dto/import-request.dto';

/** Called by the Apps Script inside the Google Sheet. */
@Controller('webhooks/sheets')
@UseGuards(SheetSecretGuard)
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(private readonly importer: CardImportService) {}

  /** Create Trello cards from the rows of the Import tab. */
  @Post('import')
  @HttpCode(200)
  importCards(@Body() body: ImportRequestDto) {
    this.logger.log(`Import requested from the sheet's Apps Script: sheet ${body?.sheetId ?? '?'}, ${body?.rows?.length ?? 0} rows`);
    return this.importer.importRows(body);
  }
}
