import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SheetSecretGuard } from '../../common/guards/sheet-secret.guard';
import { CardImportService, ImportRequest } from './card-import.service';

/** Called by the Apps Script inside the Google Sheet. */
@Controller('webhooks/sheets')
@UseGuards(SheetSecretGuard)
export class SheetsController {
  constructor(private readonly importer: CardImportService) {}

  /** Create Trello cards from the rows of the Import tab. */
  @Post('import')
  @HttpCode(200)
  importCards(@Body() body: ImportRequest) {
    return this.importer.importRows(body);
  }
}
