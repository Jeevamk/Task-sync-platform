/** The event saved in the outbox (see TasksService.enqueueEvent). */
export interface TaskEventPayload {
  eventId: string;
  type: string;
  occurredAt: string;
  project: { id: string; organizationId: string; name: string; sheetId: string; slackChannelId: string };
  task: {
    id: string;
    key: string;
    title: string;
    description: string | null;
    status: string;
    statusLabel: string;
    assignee: { name: string; slackUserId: string | null } | null;
    labels: string[];
    dueDate: string | null;
    pickedUpAt: string | null;
    startedAt: string | null;
    readyForTestingAt: string | null;
    completedAt: string | null;
    reopenCount: number;
    progressNotes: string | null;
    trelloCardId: string;
    trelloUrl: string;
    slackThreadTs: string | null;
  };
  change: {
    field: string;
    from: string | null;
    to: string | null;
    fromLabel: string | null;
    toLabel: string | null;
    source: string;
    actor: string | null;
    reason?: string | null;
    violation?: boolean;
  };
}

export interface DeliveryPlan {
  /** Tasks tab: column header -> value (only these cells are written) */
  taskRow: Record<string, string | number>;
  /** History tab: column header -> value */
  historyRow: Record<string, string>;
  /** Slack: the parent message (new task) and/or the line for the thread */
  slack: { parentText: string; threadText: string | null; broadcast: boolean };
}

const TZ = 'Asia/Kolkata';
const fmt = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) : '';
const SOURCE: Record<string, string> = { TRELLO: 'Trello', SHEET: 'Sheet', SLACK: 'Slack', SYSTEM: 'System' };

/** Turns one task event into the sheet rows and the Slack text (same output as the old n8n "Prepare" node). */
export function buildDeliveryPlan(e: TaskEventPayload): DeliveryPlan {
  const t = e.task;
  const c = e.change;
  const source = SOURCE[c.source] ?? c.source;
  const actor = c.actor || 'Someone';
  const who = t.assignee ? (t.assignee.slackUserId ? `<@${t.assignee.slackUserId}>` : t.assignee.name) : '_unassigned_';

  const taskRow: Record<string, string | number> = {
    'Task ID': t.key,
    'Trello Card ID': t.trelloCardId,
    Title: t.title,
    Description: t.description ?? '',
    Status: t.statusLabel,
    Assignee: t.assignee?.name ?? '',
    'Labels / Priority': (t.labels ?? []).join(', '),
    'Due Date': t.dueDate ?? '',
    'Picked Up At': fmt(t.pickedUpAt),
    'Started At': fmt(t.startedAt),
    'Ready for Testing At': fmt(t.readyForTestingAt),
    'Completed At': fmt(t.completedAt),
    'Reopen Count': t.reopenCount,
    'Trello URL': t.trelloUrl,
    'Last Updated': fmt(e.occurredAt),
    'Last Updated By': `${c.actor || 'System'} (${source})`,
  };
  if (e.type === 'task.created') taskRow['Created At'] = fmt(e.occurredAt);
  if (e.type === 'task.note_added') taskRow['Progress Notes'] = t.progressNotes ?? '';

  const historyRow = {
    Timestamp: fmt(e.occurredAt),
    'Task ID': t.key,
    Field: c.field,
    'Old Value': c.field === 'description' ? '(previous description)' : (c.fromLabel ?? ''),
    'New Value': c.field === 'description' ? '(description updated)' : (c.toLabel ?? ''),
    'Changed By': c.actor || 'System',
    Source: source,
  };

  const header = `*${t.key} · ${t.title}*\nStatus: *${t.statusLabel}* · Assignee: ${who}\n<${t.trelloUrl}|Open Trello card>`;
  let line: string | null;
  let broadcast = false;
  switch (e.type) {
    case 'task.created':
      line = null;
      break;
    case 'task.status_changed':
      line = `${actor} moved this from *${c.fromLabel}* → *${c.toLabel}* (via ${source})`;
      if (c.reason === 'reopened') line = `🔁 Reopened: ${line}`;
      if (t.status === 'READY_FOR_TESTING') line += `\n🧪 Ready for testing — QA, please pick it up.`;
      if (t.status === 'COMPLETED') line += `\n✅ Completed. Nice work ${who}!`;
      if (c.violation) line += `\n⚠️ This move is not allowed by the team rules — coordinator, please check.`;
      broadcast = ['READY_FOR_TESTING', 'COMPLETED'].includes(t.status) || c.reason === 'reopened';
      break;
    case 'task.assigned':
      line = `👤 ${who} is now working on this (assigned by ${actor}).`;
      break;
    case 'task.unassigned':
      line = `👤 ${c.fromLabel || 'The assignee'} was removed from this task.`;
      break;
    case 'task.note_added':
      line = `📝 Progress note from ${actor}: “${t.progressNotes}”`;
      break;
    case 'task.archived':
      line = `🗄️ Task archived by ${actor}.`;
      break;
    case 'task.updated':
      line =
        c.field === 'description'
          ? `📝 Description updated by ${actor}`
          : `✏️ ${c.field} changed: ${c.fromLabel ?? '—'} → ${c.toLabel ?? '—'} (by ${actor})`;
      break;
    default:
      line = `✏️ ${c.field} changed (by ${actor})`;
  }

  return {
    taskRow,
    historyRow,
    slack: { parentText: line ? `${header}\n${line}` : header, threadText: line, broadcast },
  };
}
