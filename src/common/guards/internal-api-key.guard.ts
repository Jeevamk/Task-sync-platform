import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = req.header('x-api-key');
    const auth = req.header('authorization');

    const expectedKey = this.config.getOrThrow<string>('INTERNAL_API_KEY');
    if (apiKey && safeEqual(apiKey, expectedKey)) return true;

    const cronSecret = this.config.get<string>('CRON_SECRET');
    if (cronSecret && auth && safeEqual(auth, `Bearer ${cronSecret}`)) return true;

    throw new UnauthorizedException('Missing or invalid API key');
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
