import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runInBackground } from '../../common/background';
import { DeliveryProgress, DeliveryService } from '../delivery/delivery.service';
import { TaskEventPayload } from '../delivery/messages';

type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 60_000;

export interface FlushResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Outbox pattern: the event is saved in the SAME transaction as the task change,
 * then delivered (Sheet, History, Slack) and retried until it succeeds.
 * Each finished step is remembered, so a retry never writes the same row or message twice.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private flushAgain = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryService,
  ) {}

  onModuleInit(): void {
    const every = this.config.get<number>('OUTBOX_POLL_MS', 0);
    if (every > 0 && !process.env.VERCEL) {
      this.timer = setInterval(() => void this.flushPending(), every);
      this.timer.unref();
      this.logger.log(`Local outbox polling every ${every} ms`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Save an event inside the caller's transaction. */
  async enqueue(tx: Tx, type: string, payload: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    await tx.outboxEvent.create({
      data: { id, type, payload: { eventId: id, type, ...payload } as Prisma.InputJsonValue },
    });
    return id;
  }

  /** Deliver pending events soon, without delaying the HTTP response. */
  flushSoon(): void {
    runInBackground('outbox flush', () => this.flushPending());
  }

  async flushPending(limit = 25): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, retried: 0, failed: 0 };
    if (this.flushing) {
      this.flushAgain = true;
      return result;
    }
    this.flushing = true;
    try {
      const due = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      for (const event of due) {
        const claimed = await this.prisma.outboxEvent.updateMany({
          where: { id: event.id, status: 'PENDING', attempts: event.attempts },
          data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) },
        });
        if (claimed.count === 0) continue;

        const attempt = event.attempts + 1;
        try {
          await this.delivery.deliver(
            event.payload as unknown as TaskEventPayload,
            (event.progress ?? {}) as DeliveryProgress,
            async (progress) => {
              await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { progress } });
            },
          );
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'SENT', sentAt: new Date(), lastError: null },
          });
          result.sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const payload = event.payload as { project?: { id?: string }; task?: { id?: string } };
          if (attempt >= MAX_ATTEMPTS) {
            await this.prisma.$transaction([
              this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'FAILED', lastError: message } }),
              this.prisma.syncError.create({
                data: {
                  step: 'deliver',
                  error: message,
                  payload: event.payload as Prisma.InputJsonValue,
                  projectId: payload.project?.id ?? null,
                  taskId: payload.task?.id ?? null,
                },
              }),
            ]);
            this.logger.error(`Event ${event.id} (${event.type}) failed permanently: ${message}`);
            result.failed++;
          } else {
            const delay = Math.min(5_000 * 2 ** (attempt - 1), 30 * 60_000);
            await this.prisma.outboxEvent.update({
              where: { id: event.id },
              data: { lastError: message, nextAttemptAt: new Date(Date.now() + delay) },
            });
            this.logger.warn(`Event ${event.id} attempt ${attempt} failed, retry in ${delay / 1000}s: ${message}`);
            result.retried++;
          }
        }
      }
    } finally {
      this.flushing = false;
    }
    if (this.flushAgain) {
      this.flushAgain = false;
      const more = await this.flushPending(limit);
      result.sent += more.sent;
      result.retried += more.retried;
      result.failed += more.failed;
    }
    if (result.sent || result.retried || result.failed) {
      this.logger.log(`Outbox: sent ${result.sent}, retry ${result.retried}, failed ${result.failed}`);
    }
    return result;
  }
}
