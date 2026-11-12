import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export type CheckResult = { status: 'up' | 'down' | 'not-configured'; error?: string };

export interface HealthReport {
  status: 'ok' | 'error';
  checks: { database: CheckResult; n8n: CheckResult };
  outbox?: Record<string, number>;
  time: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthReport> {
    const n8nBase = this.config.get<string>('N8N_BASE_URL');
    const [database, n8n] = await Promise.all([
      this.run(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      n8nBase
        ? this.run(async () => {
            const res = await fetch(`${n8nBase.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          })
        : Promise.resolve<CheckResult>({ status: 'not-configured' }),
    ]);

    let outbox: Record<string, number> | undefined;
    if (database.status === 'up') {
      const groups = await this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } });
      outbox = Object.fromEntries(groups.map((g: { status: string; _count: { _all: number } }) => [g.status, g._count._all]));
    }

    if (database.status === 'down') this.logger.error(`Health: database is down: ${database.error}`);
    if (n8n.status === 'down') this.logger.warn(`Health: n8n is down: ${n8n.error}`);

    // n8n is optional now (delivery happens in the backend), so only the database decides "ok".
    return { status: database.status === 'up' ? 'ok' : 'error', checks: { database, n8n }, outbox, time: new Date().toISOString() };
  }

  private async run(fn: () => Promise<void>): Promise<CheckResult> {
    try {
      await fn();
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : String(err) };
    }
  }
}
