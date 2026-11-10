import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { FlushResult, OutboxService } from '../outbox/outbox.service';

/** For Vercel Cron and admins only (X-Api-Key or Bearer CRON_SECRET). */
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalApiKeyGuard)
export class InternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Vercel Cron calls GET; you can call POST by hand. */
  @Get('outbox/flush')
  flushByCron(): Promise<FlushResult> {
    return this.outbox.flushPending();
  }

  @Post('outbox/flush')
  flushByHand(): Promise<FlushResult> {
    return this.outbox.flushPending();
  }

  @Get('outbox/status')
  async status(): Promise<Record<string, number>> {
    const groups = await this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(groups.map((g: { status: string; _count: { _all: number } }) => [g.status, g._count._all]));
  }
}
