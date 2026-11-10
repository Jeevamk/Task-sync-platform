import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { safeEqual } from './internal-api-key.guard';

/** Requests from the Google Sheet's Apps Script must carry  X-Sync-Secret: <SHEET_SYNC_SECRET>. */
@Injectable()
export class SheetSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('SHEET_SYNC_SECRET');
    if (!expected) throw new ServiceUnavailableException('SHEET_SYNC_SECRET is not set in the backend .env');
    const got = context.switchToHttp().getRequest<Request>().header('x-sync-secret');
    if (got && safeEqual(got, expected)) return true;
    throw new UnauthorizedException('Missing or invalid X-Sync-Secret');
  }
}
