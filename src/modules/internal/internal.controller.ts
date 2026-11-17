import { Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { DatabaseService } from '../../database/database.service';
import { FlushResult, OutboxService } from '../outbox/outbox.service';

/** For Vercel Cron and admins only (X-Api-Key or Bearer CRON_SECRET). */
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalApiKeyGuard)
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  /** Vercel Cron calls GET; you can call POST by hand. */
  @Get('outbox/flush')
  flushByCron(): Promise<FlushResult> {
    this.logger.log('Outbox flush requested by cron');
    return this.outbox.flushPending();
  }

  @Post('outbox/flush')
  flushByHand(): Promise<FlushResult> {
    this.logger.log('Outbox flush requested by hand');
    return this.outbox.flushPending();
  }

  @Get('outbox/status')
  status(): Promise<Record<string, number>> {
    return this.db.outboxCounts();
  }
}
