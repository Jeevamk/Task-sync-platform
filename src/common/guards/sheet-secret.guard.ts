import { CanActivate, ExecutionContext, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { safeEqual } from './internal-api-key.guard';

/** Requests from the Google Sheet's Apps Script must carry  X-Sync-Secret: <SHEET_SYNC_SECRET>. */
@Injectable()
export class SheetSecretGuard implements CanActivate {
  private readonly logger = new Logger(SheetSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('SHEET_SYNC_SECRET');
    if (!expected) {
      this.logger.error('Sheet import called but SHEET_SYNC_SECRET is not set');
      throw new ServiceUnavailableException('SHEET_SYNC_SECRET is not set in the backend .env');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const got = req.header('x-sync-secret');
    if (got && safeEqual(got, expected)) return true;
    this.logger.warn(`Rejected sheet request: ${got ? 'wrong' : 'no'} X-Sync-Secret (from ${req.ip})`);
    throw new UnauthorizedException('Missing or invalid X-Sync-Secret');
  }
}
