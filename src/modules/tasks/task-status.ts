import { Role, TaskStatus } from '@prisma/client';

/** How each status is shown in the sheet and in Slack. */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To Do',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  READY_FOR_TESTING: 'Ready for Testing',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

/** Left-to-right order of the board. Used to detect a task moving backwards (reopened). */
const ORDER: Partial<Record<TaskStatus, number>> = {
  TODO: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  READY_FOR_TESTING: 3,
  COMPLETED: 4,
};

export function isBackward(from: TaskStatus, to: TaskStatus): boolean {
  const a = ORDER[from];
  const b = ORDER[to];
  return a !== undefined && b !== undefined && b < a;
}

/** "ASSIGNEE" means: the person currently assigned to the task, whatever their role. */
type Who = Role | 'ASSIGNEE';

/**
 * Allowed moves and who may make them (Technical Documentation, "Task state machine").
 * Moves made directly in Trello cannot be blocked; breaking a rule there is recorded as a violation.
 */
const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskStatus, Who[]>>> = {
  TODO: { ASSIGNED: ['COORDINATOR', 'DEV'], IN_PROGRESS: ['COORDINATOR', 'DEV'] },
  ASSIGNED: { TODO: ['COORDINATOR', 'ASSIGNEE'], IN_PROGRESS: ['ASSIGNEE', 'COORDINATOR'] },
  IN_PROGRESS: { READY_FOR_TESTING: ['ASSIGNEE', 'COORDINATOR'], ASSIGNED: ['ASSIGNEE', 'COORDINATOR'] },
  READY_FOR_TESTING: { COMPLETED: ['QA', 'COORDINATOR'], IN_PROGRESS: ['QA', 'COORDINATOR'] },
  COMPLETED: { IN_PROGRESS: ['QA', 'COORDINATOR'] },
  ARCHIVED: {},
};

export function isMoveAllowed(
  from: TaskStatus,
  to: TaskStatus,
  actor: { role: Role; isAssignee: boolean } | null,
): boolean {
  if (from === to) return true;
  const allowed = TRANSITIONS[from]?.[to];
  if (!allowed || !actor) return false;
  return allowed.includes(actor.role) || (actor.isAssignee && allowed.includes('ASSIGNEE'));
}
