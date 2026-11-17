import { Global, Module } from '@nestjs/common';
import { GoogleOAuthClient } from './google-oauth.client';
import { SheetSetupService } from './sheet-setup.service';
import { SheetTemplateController } from './sheet-template.controller';
import { SheetsClient } from './sheets.client';

/** Google: the service account that writes every sheet, plus "Connect Google" to create new sheets, and the sample sheet download. */
@Global()
@Module({
  controllers: [SheetTemplateController],
  providers: [SheetsClient, GoogleOAuthClient, SheetSetupService],
  exports: [SheetsClient, GoogleOAuthClient, SheetSetupService],
})
export class GoogleModule {}
