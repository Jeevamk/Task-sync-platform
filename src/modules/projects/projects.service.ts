import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { errMsg } from '../../common/logging/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSheetId, SheetsClient } from '../google/sheets.client';
import { OutboxService } from '../outbox/outbox.service';
import { SlackClient, SlackError } from '../slack/slack.client';
import { TasksService } from '../tasks/tasks.service';
import { TrelloApi, TrelloClient } from '../trello/trello.client';
import { Board, BoardSetupService } from './board-setup.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { DEFAULT_LISTS, parseBoard, validateListNames } from './project-lists';

// Kept here as well, so existing imports (and the unit tests) keep working.
export { DEFAULT_LISTS, parseBoard } from './project-lists';

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
    private readonly boardSetup: BoardSetupService,
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────── Read ───────────────────────────

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
    const project = await this.get(organizationId, projectId);
    return (await this.trello.forOrg(organizationId)).getBoardMembers(project.trelloBoardId);
  }

  // ─────────────────────────── Create ───────────────────────────

  /**
   * Creates a project from the customer's own board, sheet and Slack channel.
   * Everything is CHECKED first; Trello is only changed once the sheet and channel are fine,
   * so a failed request never leaves a half-made board behind.
   */
  async create(organizationId: string, input: CreateProjectDto) {
    const started = Date.now();
    const what = `project "${String(input?.name ?? '').trim()}" for org ${organizationId}`;
    this.logger.log(`Creating ${what} (board: ${this.wantsNewBoard(input) ? 'new' : 'existing'})`);

    try {
      const result = await this.createProject(organizationId, input);
      for (const note of result.warnings) this.logger.warn(`${what}: ${note}`);
      this.logger.log(
        `Created ${what} in ${Date.now() - started}ms: id ${result.project.id}, board ${result.project.boardUrl}, ` +
          `${result.imported.imported} cards imported, webhook ${result.webhook ? 'registered' : 'NOT registered'}`,
      );
      return result;
    } catch (err) {
      // Customer input problems (4xx) are warnings; anything else is a real failure with a stack trace.
      const isInputProblem = err instanceof BadRequestException || err instanceof ConflictException;
      if (isInputProblem) this.logger.warn(`Could not create ${what}: ${errMsg(err)}`);
      else this.logger.error(`Could not create ${what}: ${errMsg(err)}`, (err as Error)?.stack);
      throw err;
    }
  }

  private async createProject(organizationId: string, input: CreateProjectDto) {
    const notes: string[] = []; // returned to the customer as "warnings"
    const name = String(input?.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');

    const statusLists = { ...DEFAULT_LISTS, ...(input.lists ?? {}) };
    const extraLists = validateListNames(statusLists, input.extraLists);
    const trello = await this.trello.forOrg(organizationId);

    // 1. Check everything (nothing is changed yet)
    const existingBoard = this.wantsNewBoard(input) ? null : await this.checkExistingBoard(trello, input.trelloBoard);
    const sheet = await this.checkSheet(input.sheet, notes);
    const channel = await this.checkSlackChannel(organizationId, input.slackChannelId);

    // 2. Set up the Trello board
    const board: Board =
      existingBoard ??
      (await this.boardSetup.createBoard(
        trello,
        organizationId,
        String(input.newBoardName ?? '').trim() || name,
        input.trelloWorkspaceId?.trim() || undefined,
        notes,
      ));
    const createMissing = !existingBoard || input.createMissingLists === true; // a new board always gets every list
    const listMap = await this.boardSetup.mapStatusLists(trello, board.id, statusLists, createMissing, notes);
    await this.boardSetup.addExtraLists(trello, board.id, extraLists, notes);

    // 3. Save
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name,
        trelloBoardId: board.id,
        listMap,
        sheetId: sheet.id,
        slackChannelId: channel.id,
        settings: (input.settings ?? {}) as Prisma.InputJsonValue,
      },
    });

    // 4. Start syncing: webhook + existing cards
    const webhook = await this.registerWebhook(organizationId, project.id).catch((err: Error) => {
      notes.push(`Trello webhook not registered yet: ${err.message}. Fix it, then call POST …/projects/${project.id}/webhook`);
      return null;
    });
    const imported = await this.importCards(organizationId, project.id);

    return {
      project: {
        id: project.id,
        name: project.name,
        board: board.name,
        boardUrl: board.url,
        sheet: sheet.title,
        slackChannel: `#${channel.name}`,
      },
      webhook,
      imported,
      warnings: notes,
    };
  }

  private wantsNewBoard(input: CreateProjectDto): boolean {
    return String(input?.trelloBoard ?? '').trim().toLowerCase() === 'new';
  }

  /** The board exists, the connected Trello account can see it, and no other project uses it. */
  private async checkExistingBoard(trello: TrelloApi, boardInput: string): Promise<Board> {
    const board = await trello.getBoard(parseBoard(boardInput)).catch(() => {
      throw new BadRequestException('Trello board not found, or the connected Trello account is not a member of it');
    });
    if (await this.prisma.project.findUnique({ where: { trelloBoardId: board.id } })) {
      throw new ConflictException('This board is already used by a project');
    }
    this.logger.debug(`Board OK: "${board.name}" (${board.id})`);
    return board;
  }

  /** The sheet is shared with our service account, has a Tasks tab with a "Task ID" column, and no other project uses it. */
  private async checkSheet(sheetInput: string, notes: string[]): Promise<{ id: string; title: string }> {
    const sheetId = parseSheetId(sheetInput);
    if (!sheetId) throw new BadRequestException('sheet must be a Google Sheets link or ID');
    if (await this.prisma.project.findUnique({ where: { sheetId } })) {
      throw new ConflictException('This sheet is already used by a project');
    }

    const sheet = await this.sheets.describe(sheetId).catch((err: Error) => {
      throw new BadRequestException(err.message);
    });
    if (!sheet.tabs.includes('Tasks')) throw new BadRequestException('The sheet needs a "Tasks" tab (copy the Taskvane template)');

    const headers = await this.sheets.getHeaders(sheetId, 'Tasks');
    if (!headers.includes('Task ID')) throw new BadRequestException('The Tasks tab needs a "Task ID" header in row 1');
    if (!sheet.tabs.includes('History')) notes.push('No "History" tab: change history will not be written to the sheet');

    this.logger.debug(`Sheet OK: "${sheet.title}" (${sheetId}), tabs: ${sheet.tabs.join(', ')}`);
    return { id: sheetId, title: sheet.title };
  }

  /** The channel exists in the organization's Slack workspace and the bot can post in it. */
  private async checkSlackChannel(organizationId: string, channelId: string) {
    const slack = await this.slack.forOrg(organizationId);
    const channel = await slack.channelInfo(String(channelId ?? '').trim()).catch((err: unknown) => {
      const code = err instanceof SlackError ? err.code : String(err);
      throw new BadRequestException(
        code === 'channel_not_found' ? 'Slack channel not found. For a private channel, first type /invite @Taskvane in it.' : `Slack: ${code}`,
      );
    });
    if (channel.is_private && !channel.is_member) {
      throw new BadRequestException(`Invite the bot to #${channel.name} first: /invite @Taskvane`);
    }
    this.logger.debug(`Slack channel OK: #${channel.name} (${channel.id})`);
    return channel;
  }

  // ─────────────────────────── Sync ───────────────────────────

  /** (Re)registers the Trello webhook to this server's current address (PUBLIC_BASE_URL). */
  async registerWebhook(organizationId: string, projectId: string) {
    const project = await this.get(organizationId, projectId);
    const trello = await this.trello.forOrg(organizationId);
    const callback = `${this.config.getOrThrow<string>('PUBLIC_BASE_URL').replace(/\/$/, '')}/webhooks/trello`;

    // Remove old webhooks for this board (e.g. registered with an earlier ngrok address).
    const oldHooks = (await trello.listWebhooks()).filter((h) => h.idModel === project.trelloBoardId);
    for (const hook of oldHooks) {
      try {
        await trello.deleteWebhook(hook.id);
        this.logger.debug(`[${project.name}] Removed old Trello webhook ${hook.id}`);
      } catch (err) {
        this.logger.warn(`[${project.name}] Could not remove old Trello webhook ${hook.id}: ${errMsg(err)}`);
      }
    }

    // Trello calls the callback (HEAD) before accepting it: this fails if ngrok / the server is not reachable.
    const hook = await trello.createWebhook(callback, project.trelloBoardId, `Taskvane – ${project.name}`).catch((err: Error) => {
      this.logger.warn(`[${project.name}] Trello webhook registration to ${callback} failed: ${err.message}`);
      throw err;
    });
    await this.prisma.project.update({ where: { id: project.id }, data: { trelloWebhookId: hook.id } });
    this.logger.log(`[${project.name}] Trello webhook ${hook.id} registered -> ${callback}`);
    return { id: hook.id, callback };
  }

  /** Imports every open card as a task. Safe to repeat: known cards are skipped. */
  async importCards(organizationId: string, projectId: string): Promise<{ imported: number; skipped: number }> {
    const project = await this.get(organizationId, projectId);
    const trello = await this.trello.forOrg(organizationId);
    const cards = (await trello.getBoardCards(project.trelloBoardId)).sort((a, b) => a.idShort - b.idShort);

    let imported = 0;
    let skipped = 0;
    for (const card of cards) {
      const result = await this.tasks.applyChange({
        projectId: project.id,
        trelloCardId: card.id,
        source: 'SYSTEM',
        externalId: `import:${card.id}`,
        occurredAt: new Date(),
        card: {
          name: card.name,
          description: card.desc,
          idList: card.idList,
          idShort: card.idShort,
          url: card.shortUrl,
          due: card.due,
          idMembers: card.idMembers,
          labels: card.labels.map((l) => l.name).filter(Boolean),
        },
        change: { kind: 'created' },
      });
      if (result.outcome === 'applied') imported++;
      else skipped++;
    }

    this.outbox.flushSoon();
    this.logger.log(`[${project.name}] Imported cards: ${imported} new, ${skipped} skipped (of ${cards.length} open cards)`);
    return { imported, skipped };
  }

  /** Stops syncing: removes the Trello webhook and marks the project inactive. Data is kept. */
  async deactivate(organizationId: string, projectId: string) {
    const project = await this.get(organizationId, projectId);

    if (project.trelloWebhookId) {
      try {
        const trello = await this.trello.forOrg(organizationId);
        await trello.deleteWebhook(project.trelloWebhookId);
      } catch (err) {
        this.logger.warn(`[${project.name}] Could not remove Trello webhook ${project.trelloWebhookId}: ${errMsg(err)}`);
      }
    }

    await this.prisma.project.update({ where: { id: project.id }, data: { active: false, trelloWebhookId: null } });
    this.logger.log(`[${project.name}] Project ${project.id} deactivated (sync stopped, data kept)`);
    return { ok: true };
  }
}
