import { BadRequestException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';

/** Statuses that have a Trello list. ARCHIVED has none: a card is archived, not moved. */
export type WorkflowStatus = Exclude<TaskStatus, 'ARCHIVED'>;

/** Default list name for each status, in workflow order (left to right on the board). */
export const DEFAULT_LISTS: Record<WorkflowStatus, string> = {
  TODO: 'To Do',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  READY_FOR_TESTING: 'Ready for Testing',
  COMPLETED: 'Completed',
};

/** Board link → short code: https://trello.com/b/AbC12xYz/name → AbC12xYz. Anything else is returned as is. */
export function parseBoard(input: string): string {
  const s = String(input ?? '').trim();
  return s.match(/trello\.com\/b\/([A-Za-z0-9]+)/)?.[1] ?? s;
}

/** Case- and space-insensitive name comparison. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Checks the list names before anything is created:
 * - every status has a name, and no two statuses share a list (a move could not tell them apart);
 * - extra lists don't reuse a status list's name.
 * Returns the cleaned extra list names (trimmed, empty and repeated names removed).
 */
export function validateListNames(statusLists: Record<string, string>, extraLists: unknown): string[] {
  const usedBy = new Map<string, string>(); // lower-case name → who uses it

  for (const [status, listName] of Object.entries(statusLists)) {
    const key = String(listName ?? '').trim().toLowerCase();
    if (!key) throw new BadRequestException(`List name for ${status} is empty`);
    if (usedBy.has(key)) {
      throw new BadRequestException(`"${listName}" is used for both ${usedBy.get(key)} and ${status}: each status needs its own list`);
    }
    usedBy.set(key, status);
  }

  if (extraLists === undefined || extraLists === null) return [];
  if (!Array.isArray(extraLists)) throw new BadRequestException('extraLists must be a list of names, e.g. ["Backlog"]');

  const extras: string[] = [];
  for (const raw of extraLists) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const owner = usedBy.get(name.toLowerCase());
    if (owner === 'extra') continue; // listed twice: create once
    if (owner) throw new BadRequestException(`Extra list "${name}" has the same name as the ${owner} list`);
    usedBy.set(name.toLowerCase(), 'extra');
    extras.push(name);
  }
  return extras;
}
