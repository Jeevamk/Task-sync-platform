import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Session } from '../../database/database.service';
import { insertOne, isDuplicateKey } from '../../database/helpers';
import type { EventSource, Project, Task, TaskEventType, TaskStatus, TeamMember } from '../../database/types';
import { OutboxService } from '../outbox/outbox.service';
import { STATUS_LABEL, isBackward, isMoveAllowed } from './task-status';

type TaskWithAssignee = Task & { assignee: TeamMember | null };

/** Card details known at the time of the change (used when the task does not exist yet). */
export interface CardSnapshot {
  name: string;
  description?: string;
  idList: string;
  idShort: number;
  url: string;
  due?: string | null;
  idMembers?: string[];
  labels?: string[];
}

export type TaskChange =
  | { kind: 'created' }
  | { kind: 'moved'; toListId: string }
  | { kind: 'assigned'; memberTrelloId: string; memberName?: string }
  | { kind: 'unassigned'; memberTrelloId: string }
  | { kind: 'renamed'; title: string }
  | { kind: 'description'; text: string }
  | { kind: 'due'; due: string | null }
  | { kind: 'archived' }
  | { kind: 'comment'; text: string };

export interface ChangeInput {
  projectId: string;
  trelloCardId: string;
  source: EventSource;
  /** Unique ID of the incoming event (e.g. Trello action ID), used to skip duplicates. */
  externalId: string;
  actorTrelloId?: string;
  actorName?: string;
  occurredAt: Date;
  card?: CardSnapshot;
  change: TaskChange;
}

export interface ChangeResult {
  outcome: 'applied' | 'duplicate' | 'no-change' | 'ignored';
  taskId?: string;
  eventType?: string;
  /** Follow-up actions to run after the transaction (e.g. move the card to "Assigned"). */
  moveCardToListId?: string;
  reason?: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  /** The single place where a task changes. */
  async applyChange(input: ChangeInput): Promise<ChangeResult> {
    const started = Date.now();
    try {
      const result = await this.db.transaction((session) => this.applyInTx(session, input));
      this.logger.debug(
        `${input.source} ${input.change.kind} on card ${input.trelloCardId}: ${result.outcome}` +
          `${result.eventType ? ` -> ${result.eventType}` : ''}${result.reason ? ` (${result.reason})` : ''} in ${Date.now() - started}ms`,
      );
      return result;
    } catch (err) {
      if (isDuplicateKey(err, 'externalId')) {
        // Trello retried, or two deliveries raced: already handled once, safe to skip.
        this.logger.debug(`Duplicate ${input.source} event ${input.externalId} skipped`);
        return { outcome: 'duplicate', reason: `event ${input.externalId} already processed` };
      }
      this.logger.error(
        `Could not apply ${input.source} ${input.change.kind} on card ${input.trelloCardId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  private async applyInTx(session: Session, input: ChangeInput): Promise<ChangeResult> {
    // 1. Duplicate check: a second delivery of the same event fails on the unique index (error 11000).
    await insertOne(this.db.processedEvents, { source: input.source, externalId: input.externalId }, session);

    const project = await this.db.projects.findOne({ _id: input.projectId }, null, { session });
    if (!project) throw new Error(`Project ${input.projectId} not found`);
    const listMap = (project.listMap ?? {}) as Record<string, TaskStatus>;
    const actor = input.actorTrelloId
      ? await this.findMember(session, project.organizationId, input.actorTrelloId)
      : null;

    // 2. Find the task, or create it if this card is new to us.
    const found = await this.db.tasks.findOne({ trelloCardId: input.trelloCardId }, null, { session });
    let task = found ? await this.withAssignee(session, found) : null;

    if (!task) {
      if (!input.card) {
        return { outcome: 'ignored', reason: 'unknown card and no card details' };
      }
      task = await this.createTask(session, project, listMap, input);
      await insertOne(
        this.db.taskEvents,
        {
          taskId: task.id,
          type: 'CREATED',
          field: 'status',
          newValue: task.status,
          actorId: actor?.id ?? null,
          source: input.source,
          createdAt: input.occurredAt,
        },
        session,
      );
      await this.enqueueEvent(session, 'task.created', project, task, {
        field: 'status',
        from: null,
        to: task.status,
        source: input.source,
        actor: actor?.name ?? input.actorName ?? null,
      });
      return { outcome: 'applied', taskId: task.id, eventType: 'task.created' };
    }

    if (input.change.kind === 'created') {
      return { outcome: 'no-change', taskId: task.id, reason: 'task already exists' };
    }

    // 3. Work out what changes.
    const now = input.occurredAt;
    const data: Partial<Task> = {};
    /** Counters raised with $inc. The version goes up on every change. */
    const inc: { version: number; reopenCount?: number } = { version: 1 };
    let eventType: TaskEventType;
    let outboxType: string;
    let field: string;
    let oldValue: string | null = null;
    let newValue: string | null = null;
    let violation = false;
    let moveCardToListId: string | undefined;
    let reason: string | null = null;

    switch (input.change.kind) {
      case 'moved': {
        const to = listMap[input.change.toListId];
        if (!to) return { outcome: 'ignored', taskId: task.id, reason: 'list is not mapped to a status' };
        if (to === task.status) return { outcome: 'no-change', taskId: task.id };

        const from = task.status;
        violation = !isMoveAllowed(from, to, actor ? { role: actor.role, isAssignee: actor.id === task.assigneeId } : null);
        Object.assign(data, this.timestampsFor(task, from, to, now));
        if (isBackward(from, to)) inc.reopenCount = 1;
        data.status = to;

        // Moving to In Progress with nobody assigned: the person who moved it takes it (F2).
        if (to === 'IN_PROGRESS' && !task.assigneeId && actor) {
          data.assigneeId = actor.id;
          data.pickedUpAt = task.pickedUpAt ?? now;
        }
        eventType = 'STATUS_CHANGED';
        outboxType = 'task.status_changed';
        field = 'status';
        oldValue = from;
        newValue = to;
        if (isBackward(from, to)) reason = 'reopened';
        break;
      }

      case 'assigned': {
        const member = await this.findMember(session, project.organizationId, input.change.memberTrelloId);
        if (!member) {
          this.logger.warn(`Trello member ${input.change.memberTrelloId} is not in team_members; assignment kept in Trello only`);
        }
        if (member && member.id === task.assigneeId) return { outcome: 'no-change', taskId: task.id };
        data.assigneeId = member?.id ?? task.assigneeId;
        data.pickedUpAt = task.pickedUpAt ?? now;

        // Taking a task in To Do moves it to Assigned (F1), if the board has that list.
        if (task.status === 'TODO') {
          const assignedListId = Object.entries(listMap).find(([, s]) => s === 'ASSIGNED')?.[0];
          if (assignedListId) {
            data.status = 'ASSIGNED';
            moveCardToListId = assignedListId;
          }
        }
        eventType = 'ASSIGNED';
        outboxType = 'task.assigned';
        field = 'assignee';
        oldValue = task.assignee?.name ?? null;
        newValue = member?.name ?? input.change.memberName ?? input.change.memberTrelloId;
        break;
      }

      case 'unassigned': {
        const member = await this.findMember(session, project.organizationId, input.change.memberTrelloId);
        if (!member || member.id !== task.assigneeId) return { outcome: 'no-change', taskId: task.id };
        data.assigneeId = null;
        eventType = 'UNASSIGNED';
        outboxType = 'task.unassigned';
        field = 'assignee';
        oldValue = member.name;
        break;
      }

      case 'renamed': {
        if (input.change.title === task.title) return { outcome: 'no-change', taskId: task.id };
        data.title = input.change.title;
        eventType = 'TITLE_CHANGED';
        outboxType = 'task.updated';
        field = 'title';
        oldValue = task.title;
        newValue = input.change.title;
        break;
      }

      case 'description': {
        const text = input.change.text.trim();
        if (text === (task.description ?? '')) return { outcome: 'no-change', taskId: task.id };
        data.description = text || null;
        eventType = 'DESCRIPTION_CHANGED';
        outboxType = 'task.updated';
        field = 'description';
        oldValue = task.description;
        newValue = text || null;
        break;
      }

      case 'due': {
        const due = input.change.due ? new Date(input.change.due) : null;
        data.dueDate = due;
        eventType = 'DUE_CHANGED';
        outboxType = 'task.updated';
        field = 'dueDate';
        oldValue = task.dueDate?.toISOString().slice(0, 10) ?? null;
        newValue = due?.toISOString().slice(0, 10) ?? null;
        break;
      }

      case 'archived': {
        if (task.status === 'ARCHIVED') return { outcome: 'no-change', taskId: task.id };
        data.status = 'ARCHIVED';
        eventType = 'ARCHIVED';
        outboxType = 'task.archived';
        field = 'status';
        oldValue = task.status;
        newValue = 'ARCHIVED';
        break;
      }

      case 'comment': {
        data.progressNotes = input.change.text;
        eventType = 'NOTE_ADDED';
        outboxType = 'task.note_added';
        field = 'progressNotes';
        oldValue = task.progressNotes;
        newValue = input.change.text;
        break;
      }
    }

    // 4. Save the task (version goes up on every change), the history row and the outbox event.
    const saved = await this.db.tasks.findOneAndUpdate({ _id: task.id }, { $set: data, $inc: inc }, { new: true, session });
    const updated = await this.withAssignee(session, saved!);

    await insertOne(
      this.db.taskEvents,
      {
        taskId: task.id,
        type: eventType,
        field,
        oldValue,
        newValue,
        actorId: actor?.id ?? null,
        source: input.source,
        reason,
        violation,
        createdAt: input.occurredAt,
      },
      session,
    );

    await this.enqueueEvent(session, outboxType, project, updated, {
      field,
      from: oldValue,
      to: newValue,
      source: input.source,
      actor: actor?.name ?? input.actorName ?? null,
      reason,
      violation,
    });

    if (violation) {
      this.logger.warn(`Rule broken in Trello on ${updated.taskKey}: ${oldValue} -> ${newValue} by ${actor?.name ?? input.actorName ?? 'unknown'}`);
    }
    return { outcome: 'applied', taskId: task.id, eventType: outboxType, moveCardToListId };
  }

  private async createTask(
    session: Session,
    project: Project,
    listMap: Record<string, TaskStatus>,
    input: ChangeInput,
  ): Promise<TaskWithAssignee> {
    const card = input.card!;
    const status = listMap[card.idList] ?? 'TODO';
    let assigneeId: string | null = null;
    for (const trelloId of card.idMembers ?? []) {
      const m = await this.findMember(session, project.organizationId, trelloId);
      if (m) {
        assigneeId = m.id;
        break;
      }
    }
    const now = input.occurredAt;
    const created = await insertOne(
      this.db.tasks,
      {
        projectId: project.id,
        taskKey: `TASK-${card.idShort}`,
        trelloCardId: input.trelloCardId,
        title: card.name,
        description: card.description?.trim() || null,
        status,
        assigneeId,
        dueDate: card.due ? new Date(card.due) : null,
        labels: card.labels ?? [],
        pickedUpAt: assigneeId ? now : null,
        startedAt: ['IN_PROGRESS', 'READY_FOR_TESTING', 'COMPLETED'].includes(status) ? now : null,
        readyForTestingAt: ['READY_FOR_TESTING', 'COMPLETED'].includes(status) ? now : null,
        completedAt: status === 'COMPLETED' ? now : null,
      },
      session,
    );
    return this.withAssignee(session, created);
  }

  private findMember(session: Session, organizationId: string, trelloMemberId: string) {
    return this.db.teamMembers.findOne({ organizationId, trelloMemberId }, null, { session });
  }

  /** The task plus its assignee (the team member), as the outbox event needs it. */
  private async withAssignee(session: Session, task: Task): Promise<TaskWithAssignee> {
    const assignee = task.assigneeId ? await this.db.teamMembers.findOne({ _id: task.assigneeId }, null, { session }) : null;
    return { ...task, assignee };
  }

  /** Timestamp fields that change when a task moves between statuses (the reopen count is raised by the caller). */
  private timestampsFor(task: Task, from: TaskStatus, to: TaskStatus, now: Date): Partial<Task> {
    const data: Partial<Task> = {};
    if (to === 'ASSIGNED' && !task.pickedUpAt) data.pickedUpAt = now;
    if (to === 'IN_PROGRESS' && !task.startedAt) data.startedAt = now;
    if (to === 'READY_FOR_TESTING') data.readyForTestingAt = now;
    if (to === 'COMPLETED') data.completedAt = now;
    if (isBackward(from, to) && from === 'COMPLETED') data.completedAt = null;
    return data;
  }

  /** Build the event n8n receives (see "Events and n8n workflows" in the Technical Documentation). */
  private async enqueueEvent(
    session: Session,
    type: string,
    project: Project,
    task: TaskWithAssignee,
    change: {
      field: string;
      from: string | null;
      to: string | null;
      source: EventSource;
      actor: string | null;
      reason?: string | null;
      violation?: boolean;
    },
  ): Promise<void> {
    const label = (v: string | null) => (v && v in STATUS_LABEL ? STATUS_LABEL[v as TaskStatus] : v);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);

    await this.outbox.enqueue(session, type, {
      occurredAt: new Date().toISOString(),
      project: {
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        sheetId: project.sheetId,
        slackChannelId: project.slackChannelId,
      },
      task: {
        id: task.id,
        key: task.taskKey,
        title: task.title,
        description: task.description,
        status: task.status,
        statusLabel: STATUS_LABEL[task.status],
        assignee: task.assignee
          ? { name: task.assignee.name, slackUserId: task.assignee.slackUserId }
          : null,
        labels: task.labels,
        dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
        pickedUpAt: iso(task.pickedUpAt),
        startedAt: iso(task.startedAt),
        readyForTestingAt: iso(task.readyForTestingAt),
        completedAt: iso(task.completedAt),
        reopenCount: task.reopenCount,
        progressNotes: task.progressNotes,
        trelloCardId: task.trelloCardId,
        trelloUrl: `https://trello.com/c/${task.trelloCardId}`,
        slackThreadTs: task.slackThreadTs,
        version: task.version,
      },
      change: {
        ...change,
        fromLabel: change.field === 'status' ? label(change.from) : change.from,
        toLabel: change.field === 'status' ? label(change.to) : change.to,
      },
    });
  }
}
