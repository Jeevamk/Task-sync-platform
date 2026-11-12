import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { maskEmail } from '../../common/logging/redact';
import { PrismaService } from '../../prisma/prisma.service';
import { TrelloApi, TrelloClient } from '../trello/trello.client';
import { ImportRequestDto, ImportRowDto, ImportRowResult, MAX_IMPORT_ROWS } from './dto/import-request.dto';


@Injectable()
export class CardImportService {
  private readonly logger = new Logger(CardImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trello: TrelloClient,
  ) {}

  async importRows(req: ImportRequestDto): Promise<{ created: number; failed: number; results: ImportRowResult[] }> {
    if (!req?.sheetId || !Array.isArray(req.rows)) throw new BadRequestException('sheetId and rows are required');
    // Safety net: the DTO already checks this for HTTP requests.
    if (req.rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} rows per import`);

    // 1. Which project is this sheet for?
    const project = await this.prisma.project.findFirst({ where: { sheetId: req.sheetId, active: true } });
    if (!project) {
      this.logger.warn(`Sheet import refused: sheet ${req.sheetId} is not linked to an active project`);
      throw new NotFoundException('This sheet is not linked to an active project (check sheetId in config/project.json)');
    }

    // 2. Only coordinators of THIS organization may create cards.
    const email = (req.editorEmail ?? '').trim().toLowerCase();
    const editor = email
      ? await this.prisma.teamMember.findFirst({
          where: { organizationId: project.organizationId, email: { equals: email, mode: 'insensitive' } },
        })
      : null;
    if (!editor) {
      this.logger.warn(`[${project.name}] Sheet import refused: ${maskEmail(email) || 'no editor email'} is not in the team list`);
      throw new ForbiddenException(`${email || 'Your Google account'} is not in the team list`);
    }
    if (editor.role !== 'COORDINATOR') throw new ForbiddenException('Only a coordinator can create cards from the sheet');

    // 3. Load the board's lists, labels and the team once (with the organization's own Trello token).
    const trello = await this.trello.forOrg(project.organizationId);
    const [lists, labels, team] = await Promise.all([
      trello.getBoardLists(project.trelloBoardId),
      trello.getBoardLabels(project.trelloBoardId),
      this.prisma.teamMember.findMany({ where: { organizationId: project.organizationId, active: true } }),
    ]);
    const openLists = lists.filter((l: { closed: boolean }) => !l.closed);
    const listMap = (project.listMap ?? {}) as Record<string, TaskStatus>;
    const listIdFor = (status: TaskStatus) => Object.entries(listMap).find(([, s]) => s === status)?.[0];
    const todoListId = listIdFor('TODO') ?? openLists[0]?.id;
    const assignedListId = listIdFor('ASSIGNED');

    const results: ImportRowResult[] = [];
    for (const row of req.rows) {
      const r = await this.importOne(row, req.sheetId, trello, { openLists, labels, team, todoListId, assignedListId });
      if (r.status === 'error') this.logger.warn(`[${project.name}] Import row ${row.rowNumber} failed: ${r.error}`);
      results.push(r);
    }

    const created = results.filter((r) => r.status === 'created').length;
    const failed = results.filter((r) => r.status === 'error').length;
    this.logger.log(`[${project.name}] Sheet import by ${editor.name}: ${created} created, ${failed} failed, ${results.length - created - failed} already done`);
    return { created, failed, results };
  }

  private async importOne(
    row: ImportRowDto,
    sheetId: string,
    trello: TrelloApi,
    ctx: {
      openLists: { id: string; name: string }[];
      labels: { id: string; name: string }[];
      team: { name: string; email: string; trelloMemberId: string | null }[];
      todoListId?: string;
      assignedListId?: string;
    },
  ): Promise<ImportRowResult> {
    const base = { rowNumber: row.rowNumber };
    const title = String(row.title ?? '').trim();
    if (!title) return { ...base, ok: false, status: 'error', error: 'Title is empty' };
    if (!row.key) return { ...base, ok: false, status: 'error', error: 'Row Key is missing' };

    // Never create the same row twice.
    const externalId = `import:${sheetId}:${row.key}`;
    const done = await this.prisma.processedEvent.findUnique({
      where: { source_externalId: { source: 'SHEET', externalId } },
    });
    if (done) return { ...base, ok: true, status: 'already-created' };

    const warnings: string[] = [];
    const norm = (v: string) => v.trim().toLowerCase();

    // Assignee: by name or email from the team list.
    let memberId: string | undefined;
    if (row.assignee?.trim()) {
      const a = norm(row.assignee);
      const m = ctx.team.find((t) => norm(t.name) === a || norm(t.email) === a);
      if (!m) return { ...base, ok: false, status: 'error', error: `Assignee "${row.assignee}" is not in the team list` };
      if (!m.trelloMemberId) return { ...base, ok: false, status: 'error', error: `${m.name} has no Trello member ID in the team list` };
      memberId = m.trelloMemberId;
    }

    // List: by name; empty = Assigned (if an assignee is given) or To Do.
    let listId: string | undefined;
    if (row.list?.trim()) {
      listId = ctx.openLists.find((l) => norm(l.name) === norm(row.list!))?.id;
      if (!listId) {
        return { ...base, ok: false, status: 'error', error: `List "${row.list}" not found. Lists: ${ctx.openLists.map((l) => l.name).join(', ')}` };
      }
    } else {
      listId = (memberId && ctx.assignedListId) || ctx.todoListId;
    }
    if (!listId) return { ...base, ok: false, status: 'error', error: 'The board has no lists' };

    // Due date: YYYY-MM-DD, due at 18:00 India time.
    let due: string | undefined;
    if (row.dueDate?.trim()) {
      const d = row.dueDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ...base, ok: false, status: 'error', error: `Due Date "${d}" must look like 2026-11-20` };
      due = new Date(`${d}T18:00:00+05:30`).toISOString();
    }

    // Labels: comma-separated names; unknown ones are skipped with a warning.
    const idLabels: string[] = [];
    for (const name of (row.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const label = ctx.labels.find((l) => norm(l.name) === norm(name));
      if (label) idLabels.push(label.id);
      else warnings.push(`label "${name}" not on the board`);
    }

    try {
      const card = await trello.createCard({
        idList: listId,
        name: title,
        desc: row.description?.trim() || undefined,
        due,
        idMembers: memberId ? [memberId] : undefined,
        idLabels,
      });
      await this.prisma.processedEvent.create({ data: { source: 'SHEET', externalId } }).catch((err: unknown) => {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      });
      return { ...base, ok: true, status: 'created', cardUrl: card.shortUrl, warnings: warnings.length ? warnings : undefined };
    } catch (err) {
      return { ...base, ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }
}
