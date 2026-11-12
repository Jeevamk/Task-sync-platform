import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 'Tasks' -> 'Tasks'!  (quotes are always safe, also for names with spaces) */
export function tabRef(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** Accepts a sheet link or a bare ID. */
export function parseSheetId(input: string): string | null {
  const s = String(input ?? '').trim();
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null;
}

export class SheetsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Google Sheets API as the Task Sync service account.
 * Each customer shares their sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor; no Google login needed.
 */
@Injectable()
export class SheetsClient {
  private readonly logger = new Logger('GoogleSheets');
  private readonly auth: JWT;
  readonly serviceAccountEmail: string;

  constructor(config: ConfigService) {
    this.serviceAccountEmail = config.getOrThrow<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    this.auth = new JWT({
      email: this.serviceAccountEmail,
      key: config.getOrThrow<string>('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  /** Title and tab names; fails with a clear message if the sheet is not shared with us. */
  async describe(sheetId: string): Promise<{ title: string; tabs: string[] }> {
    const r = await this.request<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
      'GET',
      `/${sheetId}?fields=properties.title,sheets.properties.title`,
    );
    const tabs = r.sheets.map((s) => s.properties.title);
    this.logger.debug(`Sheet ${sheetId}: "${r.properties.title}", tabs ${tabs.join(', ')}`);
    return { title: r.properties.title, tabs };
  }

  async getHeaders(sheetId: string, tab: string): Promise<string[]> {
    const r = await this.request<{ values?: string[][] }>('GET', `/${sheetId}/values/${encodeURIComponent(`${tabRef(tab)}!1:1`)}`);
    return (r.values?.[0] ?? []).map((h) => String(h).trim());
  }

  /** Row number (1-based) where column `colIndex` equals `value`, plus the first empty row after the data. */
  async findRow(sheetId: string, tab: string, colIndex: number, value: string): Promise<{ row: number | null; nextRow: number }> {
    const col = columnLetter(colIndex);
    const r = await this.request<{ values?: string[][] }>(
      'GET',
      `/${sheetId}/values/${encodeURIComponent(`${tabRef(tab)}!${col}2:${col}`)}?majorDimension=COLUMNS`,
    );
    const cells = r.values?.[0] ?? [];
    const idx = cells.findIndex((c) => String(c).trim() === value);
    let last = cells.length;
    while (last > 0 && !String(cells[last - 1] ?? '').trim()) last--;
    return { row: idx === -1 ? null : idx + 2, nextRow: last + 2 };
  }

  /** Write single cells only, so other columns (formulas, notes typed by people) are never touched. */
  async updateCells(sheetId: string, tab: string, row: number, cells: { col: number; value: string | number }[]): Promise<void> {
    if (!cells.length) return;
    this.logger.debug(`Sheet ${sheetId}: write ${cells.length} cells in ${tab} row ${row}`);
    await this.request('POST', `/${sheetId}/values:batchUpdate`, {
      valueInputOption: 'USER_ENTERED',
      data: cells.map((c) => ({ range: `${tabRef(tab)}!${columnLetter(c.col)}${row}`, values: [[c.value]] })),
    });
  }

  async appendRow(sheetId: string, tab: string, values: (string | number)[]): Promise<void> {
    this.logger.debug(`Sheet ${sheetId}: append a row to ${tab}`);
    await this.request(
      'POST',
      `/${sheetId}/values/${encodeURIComponent(`${tabRef(tab)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { values: [values] },
    );
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now();
    const { token } = await this.auth.getAccessToken().catch((err: Error) => {
      this.logger.error(`Could not get a Google access token for ${this.serviceAccountEmail}: ${err.message}`);
      throw err;
    });
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    // Path without the query: sheet ID and range only, never secrets.
    this.logger.verbose(`${method} ${path.split('?')[0]} -> ${res.status} ${Date.now() - started}ms`);
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        /* keep raw text */
      }
      if (res.status === 403 || res.status === 404) {
        msg = `${msg} — share the sheet with ${this.serviceAccountEmail} as Editor`;
      }
      this.logger.warn(`${method} ${path.split('?')[0]} failed: ${res.status} ${msg}`);
      throw new SheetsError(`Google Sheets ${res.status}: ${msg}`, res.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}

@Global()
@Module({ providers: [SheetsClient], exports: [SheetsClient] })
export class GoogleModule {}
