import { Module } from '@nestjs/common';
import { SheetsController } from './sheets.controller';
import { CardImportService } from './card-import.service';

@Module({
  controllers: [SheetsController],
  providers: [CardImportService],
})
export class SheetsModule {}
