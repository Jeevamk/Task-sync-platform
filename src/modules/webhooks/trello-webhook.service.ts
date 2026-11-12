import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionsService } from '../connections/connections.service';
import { OutboxService } from '../outbox/outbox.service';
import { CardSnapshot, ChangeResult, TaskChange, TasksService } from '../tasks/tasks.service';
import { TrelloClient } from '../trello/trello.client';
import { runInBackground } from '../../common/background';
import { TrelloWebhookBody } from './dto/trello-webhook-body';

export type { TrelloWebhookBody } from './dto/trello-webhook-body';

/**
 * Every customer's board sends changes here. The board ID tells us which project
 * (and so which organization and whose Trello token) the change belongs to.
 */
@Injectable()
export class TrelloWebhookService {
  private readonly logger = new Logger(TrelloWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly trello: TrelloClient,
    private readonly connections: ConnectionsService,
    private readonly outbox: OutboxService,
  ) {}

  /** The exact URL Trello calls. It is part of the signature, so it must match the registered URL. */
  callbackUrl(): string {
    return `${this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '')}/webhooks/trello`;
  }

  /** Trello signs each request with YOUR app secret: Base64( HMAC-SHA1( appSecret, rawBody + callbackURL ) ). */
  isSignatureValid(rawBody: Buffer | undefined, header: string | undefined): boolean {
    if (!rawBody || !header) return false;
    const secret = this.config.getOrThrow<string>('TRELLO_APP_SECRET');
    const expected = createHmac('sha1', secret)
      .update(Buffer.concat([rawBody, Buffer.from(this.callbackUrl(), 'utf8')]))
      .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handle(body: TrelloWebhookBody): Promise<ChangeResult> {
    const action = body.action;
    const cardId = action?.data?.card?.id;
    const boardId = action?.data?.board?.id;
    if (!action || !cardId || !boardId) {
      this.logger.debug(`Ignored Trello ${action?.type ?? 'event'}: not a card action`);
      return { outcome: 'ignored', reason: 'not a card action' };
    }

    const project = await this.prisma.project.findUnique({ where: { trelloBoardId: boardId } });
    if (!project || !project.active) {
      // A webhook still exists for a board with no active project (e.g. project deleted): harmless.
      this.logger.warn(`Ignored Trello ${action.type} on board ${boardId}: no active project for this board`);
      return { outcome: 'ignored', reason: `board ${boardId} is not a registered project` };
    }

    const change = await this.toChange(action, project.organizationId);
    if (!change) {
      this.logger.debug(`[${project.name}] Ignored Trello ${action.type} on card ${cardId}: not tracked`);
      return { outcome: 'ignored', reason: `action ${action.type} not used` };
    }
    this.logger.debug(`[${project.name}] Trello ${action.type} on card ${cardId} by ${action.memberCreator?.fullName ?? action.idMemberCreator ?? 'unknown'}: ${change.kind}`);

    // New card for us? Fetch its details with the organization's own Trello token.
    let card: CardSnapshot | undefined;
    const known = await this.prisma.task.findUnique({ where: { trelloCardId: cardId }, select: { id: true } });
    if (!known) {
      this.logger.debug(`[${project.name}] Card ${cardId} is new to us: fetching its details`);
      const api = await this.trello.forOrg(project.organizationId);
      const c = await api.getCard(cardId);
      card = {
        name: c.name,
        description: c.desc,
        idList: c.idList,
        idShort: c.idShort,
        url: c.shortUrl,
        due: c.due,
        idMembers: c.idMembers,
        labels: c.labels.map((l: { name: string }) => l.name).filter(Boolean),
      };
    }

    const result = await this.tasks.applyChange({
      projectId: project.id,
      trelloCardId: cardId,
      source: 'TRELLO',
      externalId: action.id,
      actorTrelloId: action.idMemberCreator,
      actorName: action.memberCreator?.fullName,
      occurredAt: new Date(action.date),
      card,
      change,
    });

    this.logger.log(
      `[${project.name}] ${action.type} on card ${cardId}: ${result.outcome}` +
        `${result.eventType ? ` (${result.eventType})` : ''}${result.reason ? ` - ${result.reason}` : ''}`,
    );

    if (result.outcome === 'applied') this.outbox.flushSoon();
    if (result.moveCardToListId) {
      const listId = result.moveCardToListId;
      runInBackground('move card to Assigned', async () => (await this.trello.forOrg(project.organizationId)).moveCard(cardId, listId));
    }
    return result;
  }

  private async toChange(action: NonNullable<TrelloWebhookBody['action']>, organizationId: string): Promise<TaskChange | null> {
    const d = action.data ?? {};
    switch (action.type) {
      case 'createCard':
        return { kind: 'created' };

      case 'updateCard': {
        if (d.listAfter?.id) return { kind: 'moved', toListId: d.listAfter.id };
        const old = d.old ?? {};
        if ('closed' in old && d.card?.closed) return { kind: 'archived' };
        if ('name' in old && d.card?.name) return { kind: 'renamed', title: d.card.name };
        if ('due' in old) return { kind: 'due', due: d.card?.due ?? null };
        if ('desc' in old) return { kind: 'description', text: d.card?.desc ?? '' };
        return null;
      }

      case 'addMemberToCard':
        return d.idMember ? { kind: 'assigned', memberTrelloId: d.idMember, memberName: action.member?.fullName } : null;

      case 'removeMemberFromCard':
        return d.idMember ? { kind: 'unassigned', memberTrelloId: d.idMember } : null;

      case 'commentCard': {
        if (!d.text) return null;
        // Skip comments Task Sync writes itself (they start with "[Task Sync]").
        const conn = await this.connections.get(organizationId, 'TRELLO');
        if (conn && action.idMemberCreator === conn.externalId && d.text.startsWith('[Task Sync]')) return null;
        return { kind: 'comment', text: d.text };
      }

      default:
        return null;
    }
  }
}
