import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DatabaseService, Session } from '../../database/database.service';
import { insertOne } from '../../database/helpers';
import { runInBackground } from '../../common/background';
import { DeliveryProgress, DeliveryService } from '../delivery/delivery.service';
import { TaskEventPayload } from '../delivery/messages';

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
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryService,
  ) {}

  onModuleInit(): void {
    const every = this.config.get<number>('OUTBOX_POLL_MS', 0);
    if (every > 0 && !process.env.VERCEL) {
      this.timer = setInterval(
        () =>
          void this.flushPending().catch((err: unknown) =>
            this.logger.error(`Outbox poll failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        every,
      );
      this.timer.unref();
      this.logger.log(`Local outbox polling every ${every} ms`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.logger.log('Outbox polling stopped');
    }
  }

  /** Save an event inside the caller's transaction (pass its session). */
  async enqueue(session: Session, type: string, payload: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    await insertOne(this.db.outboxEvents, { _id: id, type, payload: { eventId: id, type, ...payload } }, session);
    this.logger.debug(`Queued ${type} event ${id}`);
    return id;
  }

  /** Deliver pending events soon, without delaying the HTTP response. */
  flushSoon(): void {
    runInBackground('outbox flush', () => this.flushPending());
  }

  async flushPending(limit = 25): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, retried: 0, failed: 0 };
    if (this.flushing) {
      this.logger.verbose('Outbox flush already running: will run again when it finishes');
      this.flushAgain = true;
      return result;
    }
    this.flushing = true;
    try {
      const due = await this.db.outboxEvents.find(
        { status: 'PENDING', nextAttemptAt: { $lte: new Date() } },
        null,
        { sort: { createdAt: 1 }, limit },
      );
      if (due.length) this.logger.debug(`Outbox: ${due.length} event(s) due`);

      for (const event of due) {
        // Claim it only if nobody else did since we read it (same attempts value), and lease it for a minute.
        const claimed = await this.db.outboxEvents.updateOne(
          { _id: event.id, status: 'PENDING', attempts: event.attempts },
          { $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) } },
        );
        if (claimed.modifiedCount === 0) {
          this.logger.debug(`Event ${event.id} already taken by another worker`);
          continue;
        }

        const attempt = event.attempts + 1;
        const started = Date.now();
        try {
          await this.delivery.deliver(
            event.payload as unknown as TaskEventPayload,
            (event.progress ?? {}) as DeliveryProgress,
            async (progress) => {
              await this.db.outboxEvents.updateOne({ _id: event.id }, { $set: { progress } });
            },
          );
          await this.db.outboxEvents.updateOne({ _id: event.id }, { $set: { status: 'SENT', sentAt: new Date(), lastError: null } });
          this.logger.debug(`Event ${event.id} (${event.type}) delivered on attempt ${attempt} in ${Date.now() - started}ms`);
          result.sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const payload = event.payload as { project?: { id?: string }; task?: { id?: string } };
          if (attempt >= MAX_ATTEMPTS) {
            await this.db.transaction(async (session) => {
              await this.db.outboxEvents.updateOne({ _id: event.id }, { $set: { status: 'FAILED', lastError: message } }, { session });
              await insertOne(
                this.db.syncErrors,
                {
                  step: 'deliver',
                  error: message,
                  payload: event.payload,
                  projectId: payload.project?.id ?? null,
                  taskId: payload.task?.id ?? null,
                },
                session,
              );
            });
            this.logger.error(`Event ${event.id} (${event.type}) failed permanently: ${message}`);
            result.failed++;
          } else {
            const delay = Math.min(5_000 * 2 ** (attempt - 1), 30 * 60_000);
            await this.db.outboxEvents.updateOne({ _id: event.id }, { $set: { lastError: message, nextAttemptAt: new Date(Date.now() + delay) } });
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
