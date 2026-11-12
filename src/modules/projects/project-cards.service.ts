import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { norm, toTrelloDue } from '../trello/card-fields';
import { TrelloClient } from '../trello/trello.client';
import { CreateCardDto, CreatedCardDto } from './dto/create-card.dto';

/**
 * Creates a Trello card on a project's board.
 * Everything is checked against the board first, so a bad list/member/label is a clear 400, not a Trello error.
 * The card is NOT saved here: Trello's webhook reports it and the normal sync records it (sheet, Slack).
 */
@Injectable()
export class ProjectCardsService {
  private readonly logger = new Logger(ProjectCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trello: TrelloClient,
  ) {}

  async create(organizationId: string, projectId: string, input: CreateCardDto): Promise<CreatedCardDto> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.active) throw new BadRequestException('This project is not active, so its board is not synced');

    const trello = await this.trello.forOrg(organizationId);
    const [lists, labels, members] = await Promise.all([
      trello.getBoardLists(project.trelloBoardId),
      trello.getBoardLabels(project.trelloBoardId),
      trello.getBoardMembers(project.trelloBoardId),
    ]);
    const openLists = lists.filter((l) => !l.closed);

    // Members: Trello IDs that are on the board.
    const memberIds = [...new Set(input.memberIds ?? [])];
    const unknownMembers = memberIds.filter((id) => !members.some((m) => m.id === id));
    if (unknownMembers.length) {
      const onBoard = members.map((m) => `${m.fullName} (${m.id})`).join(', ') || '(none)';
      throw new BadRequestException(`Not members of this board: ${unknownMembers.join(', ')}. Board members: ${onBoard}`);
    }

    // List: by name, or Assigned (with members) / To Do.
    const listMap = (project.listMap ?? {}) as Record<string, TaskStatus>;
    const listIdFor = (status: TaskStatus) => Object.entries(listMap).find(([, s]) => s === status)?.[0];
    let list: { id: string; name: string } | undefined;
    if (input.list) {
      list = openLists.find((l) => norm(l.name) === norm(input.list!));
      if (!list) throw new BadRequestException(`List "${input.list}" not found. Lists: ${openLists.map((l) => l.name).join(', ')}`);
    } else {
      const wanted = (memberIds.length && listIdFor('ASSIGNED')) || listIdFor('TODO');
      list = openLists.find((l) => l.id === wanted) ?? openLists[0];
      if (!list) throw new BadRequestException('The board has no open lists');
    }

    // Labels: by name, all must exist.
    const labelNames = [...new Set((input.labels ?? []).map((n) => n.trim()).filter(Boolean))];
    const pickedLabels = labelNames.map((name) => ({ name, label: labels.find((l) => norm(l.name) === norm(name)) }));
    const unknownLabels = pickedLabels.filter((p) => !p.label).map((p) => `"${p.name}"`);
    if (unknownLabels.length) {
      const onBoard = labels.map((l) => l.name).filter(Boolean).join(', ') || '(none)';
      throw new BadRequestException(`Labels not on the board: ${unknownLabels.join(', ')}. Labels: ${onBoard}`);
    }

    // Due date.
    let due: string | undefined;
    if (input.dueDate) {
      due = toTrelloDue(input.dueDate) ?? undefined;
      if (!due) throw new BadRequestException(`dueDate "${input.dueDate}" must look like 2026-11-20 or 2026-11-20T10:00:00Z`);
    }

    const card = await trello
      .createCard({
        idList: list.id,
        name: input.title,
        desc: input.description?.trim() || undefined,
        due,
        idMembers: memberIds,
        idLabels: pickedLabels.map((p) => p.label!.id),
        pos: input.position,
      })
      .catch((err: Error) => {
        throw new BadRequestException(`Trello did not create the card: ${err.message}`);
      });

    this.logger.log(`[${project.name}] Created Trello card ${card.id} in "${list.name}" via the API`);
    return {
      id: card.id,
      url: card.shortUrl,
      list: list.name,
      members: memberIds.map((id) => members.find((m) => m.id === id)!.fullName),
      labels: pickedLabels.map((p) => p.label!.name),
      due,
      note: 'The card syncs to the sheet and Slack as soon as Trello reports it (a few seconds)',
    };
  }
}
