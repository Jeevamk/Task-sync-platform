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
  /** Board ID, short code, or board link, or "new" to create a board */
  trelloBoard: string;
  /** With trelloBoard "new": board name (default: project name) */
  newBoardName?: string;
  /** With trelloBoard "new": Trello workspace to create it in */
  trelloWorkspaceId?: string;
  /** Extra lists (e.g. "Backlog") created if missing, placed before the workflow lists; not linked to a status */
  extraLists?: string[];
  /** Sheet link or ID */
  sheet: string;
  slackChannelId: string;
  /** Optional: list names on the board, if they differ from the defaults */
  lists?: Partial<Record<keyof typeof DEFAULT_LISTS, string>>;
  /** Create lists that are not on the board yet, instead of failing */
  createMissingLists?: boolean;
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
    const createBoard = String(input.trelloBoard ?? '').trim().toLowerCase() === 'new';
    const listNames = { ...DEFAULT_LISTS, ...(input.lists ?? {}) };
    const extraLists = this.checkListNames(listNames, input.extraLists);

    // 1. Trello board (with the organization's token = proves they can access it)
    const trello = await this.trello.forOrg(organizationId);
    let existingBoard: { id: string; name: string; url: string } | null = null;
    if (!createBoard) {
      existingBoard = await trello.getBoard(parseBoard(input.trelloBoard)).catch(() => {
        throw new BadRequestException('Trello board not found, or the connected Trello account is not a member of it');
      });
      if (await this.prisma.project.findUnique({ where: { trelloBoardId: existingBoard.id } })) {
        throw new ConflictException('This board is already used by a project');
      }
    }

    // 2. Google Sheet shared with the service account, with a Tasks tab
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

    // 3. Slack channel in the organization's own workspace
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

    // 4. Only now change anything in Trello, once the sheet and channel checked out.
    let board = existingBoard;
    if (!board) {
      const boardName = String(input.newBoardName ?? '').trim() || name;
      board = await trello.createBoard(boardName, input.trelloWorkspaceId?.trim() || undefined).catch((err: Error) => {
        throw new BadRequestException(`Could not create the Trello board: ${err.message}`);
      });
      warnings.push(`Created the Trello board "${board.name}": ${board.url}`);
      await this.addTeamToBoard(trello, organizationId, board.id, warnings);
    }
    // Lists → statuses (by name); a new board always gets every list.
    const listMap = await this.buildListMap(trello, board.id, listNames, createBoard || input.createMissingLists === true, warnings);
    await this.ensureExtraLists(trello, board.id, extraLists, warnings);

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
      project: { id: project.id, name: project.name, board: board.name, boardUrl: board.url, sheet: sheet.title, slackChannel: `#${channel.name}` },
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

  private async buildListMap(
    trello: TrelloApi,
    boardId: string,
    names: Record<string, string>,
    createMissing: boolean,
    warnings: string[],
  ): Promise<Record<string, TaskStatus>> {
    const lists = (await trello.getBoardLists(boardId)).filter((l) => !l.closed);
    const map: Record<string, TaskStatus> = {};
    const missing: string[] = [];
    // Object order = workflow order (To Do → … → Completed), so created lists end up in that order.
    for (const [status, name] of Object.entries(names)) {
      let found = lists.find((l) => l.name.trim().toLowerCase() === String(name).trim().toLowerCase());
      if (!found && createMissing) {
        found = await trello.createList(boardId, String(name).trim()).catch((err: Error) => {
          throw new BadRequestException(`Could not create the list "${name}" on the board: ${err.message}`);
        });
        lists.push(found);
        warnings.push(`Created the list "${found.name}" on the board`);
      }
      if (found) map[found.id] = status as TaskStatus;
      else missing.push(`"${name}"`);
    }
    if (missing.length) {
      throw new BadRequestException(
        `The board is missing these lists: ${missing.join(', ')}. Lists on the board: ${lists.map((l) => l.name).join(', ') || '(none)'}. ` +
          'Rename them in Trello, send "lists" with your names, or send "createMissingLists": true.',
      );
    }
    return map;
  }

  /**
   * Each status needs its own list (otherwise a move could not tell them apart),
   * and extra lists must not reuse a status list's name. Returns the cleaned extra list names.
   */
  private checkListNames(names: Record<string, string>, extra: unknown): string[] {
    const seen = new Map<string, string>();
    for (const [status, listName] of Object.entries(names)) {
      const key = String(listName ?? '').trim().toLowerCase();
      if (!key) throw new BadRequestException(`List name for ${status} is empty`);
      if (seen.has(key)) {
        throw new BadRequestException(`"${listName}" is used for both ${seen.get(key)} and ${status}: each status needs its own list`);
      }
      seen.set(key, status);
    }
    if (extra === undefined || extra === null) return [];
    if (!Array.isArray(extra)) throw new BadRequestException('extraLists must be a list of names, e.g. ["Backlog"]');
    const out: string[] = [];
    for (const raw of extra) {
      const n = String(raw ?? '').trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) {
        const owner = seen.get(key);
        if (owner === 'extra') continue; // listed twice: create once
        throw new BadRequestException(`Extra list "${n}" has the same name as the ${owner} list`);
      }
      seen.set(key, 'extra');
      out.push(n);
    }
    return out;
  }

  /** Extra lists (not linked to a status) go to the left of the board, in the order given. */
  private async ensureExtraLists(trello: TrelloApi, boardId: string, extra: string[], warnings: string[]): Promise<void> {
    if (!extra.length) return;
    const existing = new Set((await trello.getBoardLists(boardId)).filter((l) => !l.closed).map((l) => l.name.trim().toLowerCase()));
    // 'top' puts each new list first, so create them in reverse to keep ["Backlog", "Ideas"] in that order.
    for (const n of [...extra].reverse()) {
      if (existing.has(n.toLowerCase())) continue;
      await trello.createList(boardId, n, 'top').catch((err: Error) => {
        throw new BadRequestException(`Could not create the list "${n}" on the board: ${err.message}`);
      });
      warnings.push(`Created the extra list "${n}" on the board (cards there are not tracked)`);
    }
  }

  /** New board: add every active team member whose Trello account is known, so they can move cards. */
  private async addTeamToBoard(trello: TrelloApi, organizationId: string, boardId: string, warnings: string[]): Promise<void> {
    const members = await this.prisma.teamMember.findMany({
      where: { organizationId, active: true },
      select: { name: true, trelloMemberId: true },
    });
    const added: string[] = [];
    for (const m of members) {
      if (!m.trelloMemberId) {
        warnings.push(`${m.name} has no Trello username in the team, so was not added to the new board`);
        continue;
      }
      await trello
        .addBoardMember(boardId, m.trelloMemberId)
        .then(() => added.push(m.name))
        .catch((err: Error) => warnings.push(`Could not add ${m.name} to the board: ${err.message}`));
    }
    if (added.length) warnings.push(`Added to the board: ${added.join(', ')}`);
  }
}
