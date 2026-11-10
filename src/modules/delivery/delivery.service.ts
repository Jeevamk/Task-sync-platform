import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsClient } from '../google/sheets.client';
import { SlackClient } from '../slack/slack.client';
import { buildDeliveryPlan, TaskEventPayload } from './messages';

/** Steps already done for an event; a retry continues where it stopped, so nothing is written twice. */
export type DeliveryProgress = { sheet?: boolean; history?: boolean; slack?: boolean; n8n?: boolean };

/**
 * Sends one task event to the customer's own tools:
 *  1. Tasks tab row (insert or update, only the cells we own)
 *  2. History tab row
 *  3. Slack: parent message for a new task, otherwise a reply in its thread (customer's own Slack workspace)
 *  4. Optional: forward to your own n8n (N8N_EVENT_WEBHOOK_URL), signed
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsClient,
    private readonly slack: SlackClient,
    private readonly config: ConfigService,
  ) {}

  async deliver(event: TaskEventPayload, progress: DeliveryProgress, saveProgress: (p: DeliveryProgress) => Promise<void>): Promise<void> {
    const plan = buildDeliveryPlan(event);
    const done = { ...progress };
    const step = async (name: keyof DeliveryProgress, work: () => Promise<void>) => {
      if (done[name]) return;
      await work();
      done[name] = true;
      await saveProgress(done);
    };

    await step('sheet', () => this.upsertTaskRow(event.project.sheetId, plan.taskRow));
    await step('history', () => this.appendHistory(event.project.sheetId, plan.historyRow));
    await step('slack', () => this.postToSlack(event, plan.slack));
    if (this.config.get<string>('N8N_EVENT_WEBHOOK_URL')) {
      await step('n8n', () => this.forwardToN8n(event));
    }
  }

  private async upsertTaskRow(sheetId: string, row: Record<string, string | number>): Promise<void> {
    const headers = await this.sheets.getHeaders(sheetId, 'Tasks');
    const keyCol = headers.indexOf('Task ID');
    if (keyCol === -1) throw new Error('The Tasks tab has no "Task ID" header in row 1');
    const found = await this.sheets.findRow(sheetId, 'Tasks', keyCol, String(row['Task ID']));
    const target = found.row ?? found.nextRow;
    const cells = Object.entries(row)
      .map(([name, value]) => ({ col: headers.indexOf(name), value }))
      .filter((c) => c.col !== -1);
    await this.sheets.updateCells(sheetId, 'Tasks', target, cells);
  }

  private async appendHistory(sheetId: string, row: Record<string, string>): Promise<void> {
    const headers = await this.sheets.getHeaders(sheetId, 'History');
    if (!headers.length) return; // no History tab headers: skip quietly
    await this.sheets.appendRow(sheetId, 'History', headers.map((h) => row[h] ?? ''));
  }

  private async postToSlack(event: TaskEventPayload, text: { parentText: string; threadText: string | null; broadcast: boolean }): Promise<void> {
    // Read the thread at send time: an earlier event may have just created it.
    const task = await this.prisma.task.findUnique({ where: { id: event.task.id }, select: { slackThreadTs: true } });
    const threadTs = task?.slackThreadTs ?? null;
    if (threadTs && !text.threadText) return;

    const api = await this.slack.forOrg(event.project.organizationId);
    if (threadTs) {
      await api.postMessage({
        channel: event.project.slackChannelId,
        text: text.threadText!,
        thread_ts: threadTs,
        ...(text.broadcast ? { reply_broadcast: true } : {}),
      });
      return;
    }
    const posted = await api.postMessage({ channel: event.project.slackChannelId, text: text.parentText });
    await this.prisma.task.updateMany({ where: { id: event.task.id, slackThreadTs: null }, data: { slackThreadTs: posted.ts } });
  }

  private async forwardToN8n(event: TaskEventPayload): Promise<void> {
    const url = this.config.getOrThrow<string>('N8N_EVENT_WEBHOOK_URL');
    const secret = this.config.get<string>('N8N_EVENT_SIGNING_SECRET') ?? '';
    const body = JSON.stringify(event);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        'X-Event-Id': event.eventId,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`n8n responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
