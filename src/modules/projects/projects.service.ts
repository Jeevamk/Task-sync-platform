import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSheetId, SheetsClient } from '../google/sheets.client';
import { OutboxService } from '../outbox/outbox.service';
import { SlackClient, SlackError } from '../slack/slack.client';
import { TasksService } from '../tasks/tasks.service';
import { TrelloApi, TrelloClient } from '../trello/trello.client';

export const DEFAULT_LISTS: Record<Exclude<TaskStatus, 'ARCHIVED'>, string> = {
  TODO: 'To Do',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  READY_FOR_TESTING: 'Ready for Testing',
  COMPLETED: 'Completed',
};

export interface CreateProjectInput {
  name: string;
  /** Board ID, short code, or board link */
  trelloBoard: string;
  /** Sheet link or ID */
  sheet: string;
  slackChannelId: string;
  /** Optional: list names on the board, if they differ from the defaults */
  lists?: Partial<Record<keyof typeof DEFAULT_LISTS, string>>;
  settings?: Record<string, unknown>;
}

/** Board link → short code: https://trello.com/b/AbC12xYz/name → AbC12xYz */
export function parseBoard(input: string): string {
  const s = String(input ?? '').trim();
  return s.match(/trello\.com\/b\/([A-Za-z0-9]+)/)?.[1] ?? s;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trello: TrelloClient,
    private readonly slack: SlackClient,
    private readonly sheets: SheetsClient,
    private readonly tasks: TasksService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  list(organizationId: string) {
    return this.prisma.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { tasks: true } } },
    });
  }

  async get(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** Pickers for the "Add project" form. */
  async boards(organizationId: string) {
    return (await this.trello.forOrg(organizationId)).getMyBoards();
  }

  async channels(organizationId: string) {
    return (await this.slack.forOrg(organizationId)).listChannels();
  }

  async boardMembers(organizationId: string, projectId: string) {
    const p = await this.get(organizationId, projectId);
    return (await this.trello.forOrg(organizationId)).getBoardMembers(p.trelloBoardId);
  }

  /**
   * F0: create a project from the customer's own board, sheet and Slack channel.
   * Checks everything first, so the customer gets a clear message instead of silent failures later.
   */
  async create(organizationId: string, input: CreateProjectInput) {
    const warnings: string[] = [];
    const name = String(input?.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');

    // 1. Trello board (with the organization's token = proves they can access it)
    const trello = await this.trello.forOrg(organizationId);
    const board = await trello.getBoard(parseBoard(input.trelloBoard)).catch(() => {
      throw new BadRequestException('Trello board not found, or the connected Trello account is not a member of it');
    });
    if (await this.prisma.project.findUnique({ where: { trelloBoardId: board.id } })) {
      throw new ConflictException('This board is already used by a project');
    }

    // 2. Lists → statuses (by name)
    const listMap = await this.buildListMap(trello, board.id, { ...DEFAULT_LISTS, ...(input.lists ?? {}) });

    // 3. Google Sheet shared with the service account, with a Tasks tab
    const sheetId = parseSheetId(input.sheet);
    if (!sheetId) throw new BadRequestException('sheet must be a Google Sheets link or ID');
    if (await this.prisma.project.findUnique({ where: { sheetId } })) throw new ConflictException('This sheet is already used by a project');
    const sheet = await this.sheets.describe(sheetId).catch((err: Error) => {
      throw new BadRequestException(err.message);
    });
    if (!sheet.tabs.includes('Tasks')) throw new BadRequestException('The sheet needs a "Tasks" tab (copy the Task Sync template)');
    const headers = await this.sheets.getHeaders(sheetId, 'Tasks');
    if (!headers.includes('Task ID')) throw new BadRequestException('The Tasks tab needs a "Task ID" header in row 1');
    if (!sheet.tabs.includes('History')) warnings.push('No "History" tab: change history will not be written to the sheet');

    // 4. Slack channel in the organization's own workspace
    const slack = await this.slack.forOrg(organizationId);
    const channel = await slack.channelInfo(String(input.slackChannelId ?? '').trim()).catch((err: unknown) => {
      const code = err instanceof SlackError ? err.code : String(err);
      throw new BadRequestException(
        code === 'channel_not_found'
          ? 'Slack channel not found. For a private channel, first type /invite @Task Sync in it.'
          : `Slack: ${code}`,
      );
    });
    if (channel.is_private && !channel.is_member) {
      throw new BadRequestException(`Invite the bot to #${channel.name} first: /invite @Task Sync`);
    }

    // 5. Save
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name,
        trelloBoardId: board.id,
        listMap,
        sheetId,
        slackChannelId: channel.id,
        settings: (input.settings ?? {}) as Prisma.InputJsonValue,
      },
    });

    // 6. Trello webhook + import existing cards
    const webhook = await this.registerWebhook(organizationId, project.id).catch((err: Error) => {
      warnings.push(`Trello webhook not registered yet: ${err.message}. Fix it, then call POST …/projects/${project.id}/webhook`);
      return null;
    });
    const imported = await this.importCards(organizationId, project.id);

    this.logger.log(`Project "${name}" created for org ${organizationId}: ${imported.imported} cards imported`);
    return {
      project: { id: project.id, name: project.name, board: board.name, sheet: sheet.title, slackChannel: `#${channel.name}` },
      webhook,
      imported,
      warnings,
    };
  }

  /** (Re)register the Trello webhook to this server's current address. */
  async registerWebhook(organizationId: string, projectId: string) {
    const project = await this.get(organizationId, projectId);
    const trello = await this.trello.forOrg(organizationId);
    const callback = `${this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '')}/webhooks/trello`;

    for (const h of (await trello.listWebhooks()).filter((h) => h.idModel === project.trelloBoardId)) {
      await trello.deleteWebhook(h.id).catch(() => undefined);
    }
    const hook = await trello.createWebhook(callback, project.trelloBoardId, `Task Sync – ${project.name}`);
    await this.prisma.project.update({ where: { id: project.id }, data: { trelloWebhookId: hook.id } });
    return { id: hook.id, callback };
  }

  /** Import every open card as a task (safe to repeat: known cards are skipped). */
  async importCards(organizationId: string, projectId: string): Promise<{ imported: number; skipped: number }> {
    const project = await this.get(organizationId, projectId);
    const trello = await this.trello.forOrg(organizationId);
    const cards = await trello.getBoardCards(project.trelloBoardId);
    let imported = 0;
    let skipped = 0;
    for (const c of cards.sort((a, b) => a.idShort - b.idShort)) {
      const r = await this.tasks.applyChange({
        projectId: project.id,
        trelloCardId: c.id,
        source: 'SYSTEM',
        externalId: `import:${c.id}`,
        occurredAt: new Date(),
        card: {
          name: c.name,
          description: c.desc,
          idList: c.idList,
          idShort: c.idShort,
          url: c.shortUrl,
          due: c.due,
          idMembers: c.idMembers,
          labels: c.labels.map((l) => l.name).filter(Boolean),
        },
        change: { kind: 'created' },
      });
      if (r.outcome === 'applied') imported++;
      else skipped++;
    }
    this.outbox.flushSoon();
    return { imported, skipped };
  }

  /** Stop syncing: remove the Trello webhook and mark the project inactive (data is kept). */
  async deactivate(organizationId: string, projectId: string) {
    const project = await this.get(organizationId, projectId);
    if (project.trelloWebhookId) {
      const trello = await this.trello.forOrg(organizationId).catch(() => null);
      await trello?.deleteWebhook(project.trelloWebhookId).catch(() => undefined);
    }
    await this.prisma.project.update({ where: { id: project.id }, data: { active: false, trelloWebhookId: null } });
    return { ok: true };
  }

  private async buildListMap(trello: TrelloApi, boardId: string, names: Record<string, string>): Promise<Record<string, TaskStatus>> {
    const lists = (await trello.getBoardLists(boardId)).filter((l) => !l.closed);
    const map: Record<string, TaskStatus> = {};
    const missing: string[] = [];
    for (const [status, name] of Object.entries(names)) {
      const found = lists.find((l) => l.name.trim().toLowerCase() === String(name).trim().toLowerCase());
      if (found) map[found.id] = status as TaskStatus;
      else missing.push(`"${name}"`);
    }
    if (missing.length) {
      throw new BadRequestException(
        `The board is missing these lists: ${missing.join(', ')}. Lists on the board: ${lists.map((l) => l.name).join(', ')}. ` +
          'Rename them in Trello, or send "lists" with your names.',
      );
    }
    return map;
  }
}
