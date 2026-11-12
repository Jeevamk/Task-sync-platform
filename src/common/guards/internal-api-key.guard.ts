import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Protects /internal endpoints.
 * Accepts either  X-Api-Key: <INTERNAL_API_KEY>  (n8n)
 * or              Authorization: Bearer <CRON_SECRET>  (Vercel Cron).
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = req.header('x-api-key');
    const auth = req.header('authorization');

    const expectedKey = this.config.getOrThrow<string>('INTERNAL_API_KEY');
    if (apiKey && safeEqual(apiKey, expectedKey)) return true;

    const cronSecret = this.config.get<string>('CRON_SECRET');
    if (cronSecret && auth && safeEqual(auth, `Bearer ${cronSecret}`)) return true;

    // Never log the key itself: only whether one was sent.
    this.logger.warn(`Rejected ${req.method} ${req.path}: ${apiKey || auth ? 'wrong' : 'no'} API key (from ${req.ip})`);
    throw new UnauthorizedException('Missing or invalid API key');
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
