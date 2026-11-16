import { Global, Module } from '@nestjs/common';
import { GoogleOAuthClient } from './google-oauth.client';
import { SheetSetupService } from './sheet-setup.service';
import { SheetsClient } from './sheets.client';

/** Google: the service account that writes every sheet, plus "Connect Google" to create new sheets. */
@Global()
@Module({
  providers: [SheetsClient, GoogleOAuthClient, SheetSetupService],
  exports: [SheetsClient, GoogleOAuthClient, SheetSetupService],
})
export class GoogleModule {}
