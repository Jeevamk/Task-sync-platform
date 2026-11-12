import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrelloApi } from '../trello/trello.client';
import { sameName } from './project-lists';

export type Board = { id: string; name: string; url: string };

/**
 * Everything that CHANGES a Trello board while a project is set up:
 * creating the board, adding the team to it, and creating lists.
 * Messages for the customer are added to `notes` (they end up in the response's "warnings").
 */
@Injectable()
export class BoardSetupService {
  private readonly logger = new Logger(BoardSetupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Creates an empty board and adds the organization's team to it. */
  async createBoard(trello: TrelloApi, organizationId: string, name: string, workspaceId: string | undefined, notes: string[]): Promise<Board> {
    const board = await trello.createBoard(name, workspaceId).catch((err: Error) => {
      throw new BadRequestException(`Could not create the Trello board: ${err.message}`);
    });
    // Logged at once: if a later step fails, this says which board to delete before retrying.
    this.logger.log(`Created Trello board "${board.name}" (${board.id}) ${board.url}`);
    notes.push(`Created the Trello board "${board.name}": ${board.url}`);

    await this.addTeam(trello, organizationId, board.id, notes);
    return board;
  }

  /**
   * Finds the list for each status by name and returns { listId: status }.
   * With createMissing, lists that don't exist are created (in workflow order, at the right end).
   */
  async mapStatusLists(
    trello: TrelloApi,
    boardId: string,
    statusLists: Record<string, string>,
    createMissing: boolean,
    notes: string[],
  ): Promise<Record<string, TaskStatus>> {
    const lists = await this.openLists(trello, boardId);
    const listMap: Record<string, TaskStatus> = {};
    const missing: string[] = [];

    for (const [status, name] of Object.entries(statusLists)) {
      let list = lists.find((l) => sameName(l.name, name));
      if (!list && createMissing) {
        list = await this.createList(trello, boardId, name.trim(), 'bottom');
        lists.push(list);
        notes.push(`Created the list "${list.name}" on the board`);
      }
      if (list) listMap[list.id] = status as TaskStatus;
      else missing.push(`"${name}"`);
    }

    if (missing.length) {
      const onBoard = lists.map((l) => l.name).join(', ') || '(none)';
      throw new BadRequestException(
        `The board is missing these lists: ${missing.join(', ')}. Lists on the board: ${onBoard}. ` +
          'Rename them in Trello, send "lists" with your names, or send "createMissingLists": true.',
      );
    }
    return listMap;
  }

  /** Extra lists (not linked to a status, e.g. "Backlog") go to the LEFT of the board, in the order given. */
  async addExtraLists(trello: TrelloApi, boardId: string, names: string[], notes: string[]): Promise<void> {
    if (!names.length) return;
    const existing = await this.openLists(trello, boardId);

    // 'top' puts each new list first, so create them in reverse to keep ["Backlog", "Ideas"] in that order.
    for (const name of [...names].reverse()) {
      if (existing.some((l) => sameName(l.name, name))) continue;
      await this.createList(trello, boardId, name, 'top');
      notes.push(`Created the extra list "${name}" on the board (cards there are not tracked)`);
    }
  }

  /** Adds every active team member with a known Trello account, so they can move cards. */
  private async addTeam(trello: TrelloApi, organizationId: string, boardId: string, notes: string[]): Promise<void> {
    const members = await this.prisma.teamMember.findMany({
      where: { organizationId, active: true },
      select: { name: true, trelloMemberId: true },
    });

    const added: string[] = [];
    for (const member of members) {
      if (!member.trelloMemberId) {
        notes.push(`${member.name} has no Trello username in the team, so was not added to the new board`);
        continue;
      }
      try {
        await trello.addBoardMember(boardId, member.trelloMemberId);
        added.push(member.name);
      } catch (err) {
        notes.push(`Could not add ${member.name} to the board: ${(err as Error).message}`);
      }
    }
    if (added.length) notes.push(`Added to the board: ${added.join(', ')}`);
  }

  private async openLists(trello: TrelloApi, boardId: string) {
    return (await trello.getBoardLists(boardId)).filter((l) => !l.closed);
  }

  private async createList(trello: TrelloApi, boardId: string, name: string, pos: 'top' | 'bottom') {
    return trello.createList(boardId, name, pos).catch((err: Error) => {
      throw new BadRequestException(`Could not create the list "${name}" on the board: ${err.message}`);
    });
  }
}
