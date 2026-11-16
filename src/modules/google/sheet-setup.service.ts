import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleOAuthClient } from './google-oauth.client';
import { SHEET_TABS } from './sheet-template';
import { SheetsClient } from './sheets.client';

/**
 * sheet: "new" — creates the project sheet in the user's OWN Drive (they own it),
 * then shares it with the Taskvane service account, which does all the writing afterwards.
 */
@Injectable()
export class SheetSetupService {
  private readonly logger = new Logger(SheetSetupService.name);

  constructor(
    private readonly google: GoogleOAuthClient,
    private readonly sheets: SheetsClient,
  ) {}

  async createProjectSheet(organizationId: string, title: string): Promise<{ id: string; url: string; title: string }> {
    const token = await this.google.accessTokenForOrg(organizationId);

    // 1. The spreadsheet with its tabs and a bold, frozen header row in each.
    const created = await this.call<{ spreadsheetId: string; spreadsheetUrl: string }>(token, 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', {
      properties: { title },
      sheets: SHEET_TABS.map((tab, index) => ({
        properties: { sheetId: index, title: tab.title, index, gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: tab.headers.map((h) => ({
                  userEnteredValue: { stringValue: h },
                  userEnteredFormat: { textFormat: { bold: true } },
                })),
              },
            ],
          },
        ],
      })),
    });
    this.logger.log(`Created sheet "${title}" (${created.spreadsheetId}) in the user's Drive`);

    // 2. Share it with the service account (drive.file allows this on files Taskvane created).
    await this.call(
      token,
      'POST',
      `https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}/permissions?sendNotificationEmail=false`,
      { role: 'writer', type: 'user', emailAddress: this.sheets.serviceAccountEmail },
    ).catch((err: Error) => {
      throw new BadRequestException(
        `The sheet was created (${created.spreadsheetUrl}) but could not be shared with ${this.sheets.serviceAccountEmail}: ${err.message}. ` +
          'Share it by hand as Editor, then create the project with that sheet link.',
      );
    });
    this.logger.debug(`Sheet ${created.spreadsheetId} shared with the service account`);

    return { id: created.spreadsheetId, url: created.spreadsheetUrl, title };
  }

  private async call<T = unknown>(token: string, method: string, url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        /* keep raw text */
      }
      // URL without query; never the token.
      this.logger.warn(`${method} ${url.split('?')[0]} failed: ${res.status} ${msg}`);
      if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
        msg += ' (enable the Google Sheets API and Google Drive API in the Google Cloud project)';
      }
      throw new BadRequestException(`Google ${res.status}: ${msg}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}
