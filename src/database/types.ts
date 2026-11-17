/**
 * The shapes the database returns (MongoDB via Mongoose, see database.service.ts).
 * Every document has a UUID string `id` (stored as `_id`), so IDs in the API look the same as before.
 */

export const ROLES = ['DEV', 'QA', 'COORDINATOR'] as const;
export type Role = (typeof ROLES)[number];

/** Role of a logged-in user inside an organization (who may manage it). */
export const ORG_ROLES = ['OWNER', 'COORDINATOR'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Tools an organization connects with its own account (GOOGLE: only used to create the project sheet in the user's Drive). */
export const PROVIDERS = ['TRELLO', 'SLACK', 'GOOGLE'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TASK_STATUSES = ['TODO', 'ASSIGNED', 'IN_PROGRESS', 'READY_FOR_TESTING', 'COMPLETED', 'ARCHIVED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EVENT_TYPES = [
  'CREATED',
  'ASSIGNED',
  'UNASSIGNED',
  'STATUS_CHANGED',
  'NOTE_ADDED',
  'BLOCKED',
  'UNBLOCKED',
  'QA_PASSED',
  'QA_FAILED',
  'DUE_CHANGED',
  'TITLE_CHANGED',
  'DESCRIPTION_CHANGED',
  'ARCHIVED',
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const EVENT_SOURCES = ['TRELLO', 'SHEET', 'SLACK', 'SYSTEM'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const OUTBOX_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** A customer (team or company). Everything below belongs to one organization. */
export interface Organization {
  id: string;
  name: string;
  createdAt: Date;
}

/** A person who logs in to Taskvane (Google sign-in or dev login). */
export interface User {
  id: string;
  email: string;
  name: string;
  googleSub: string | null;
  createdAt: Date;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: OrgRole;
  createdAt: Date;
}

/** An organization's own Trello, Slack or Google account. The token is stored ENCRYPTED. */
export interface Connection {
  id: string;
  organizationId: string;
  provider: Provider;
  /** Trello: member ID of the person who connected. Slack: workspace (team) ID. Google: account `sub`. */
  externalId: string;
  externalName: string;
  /** Slack only: the bot's user ID in that workspace. */
  botUserId: string | null;
  encryptedToken: string;
  scopes: string | null;
  connectedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Short-lived value that ties an OAuth "Connect" redirect back to the organization that started it. */
export interface OAuthState {
  id: string;
  state: string;
  organizationId: string;
  provider: Provider;
  userEmail: string;
  expiresAt: Date;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  trelloBoardId: string;
  trelloWebhookId: string | null;
  /** Trello list ID -> TaskStatus, e.g. { "64a1...": "IN_PROGRESS" } */
  listMap: Record<string, TaskStatus>;
  sheetId: string;
  slackChannelId: string;
  coordinatorId: string | null;
  /** Stuck limits, summary time, time zone, AI summary on/off. */
  settings: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  trelloMemberId: string | null;
  slackUserId: string | null;
  role: Role;
  active: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  taskKey: string;
  trelloCardId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  progressNotes: string | null;
  blocker: string | null;
  dueDate: Date | null;
  priority: string | null;
  labels: string[];
  pickedUpAt: Date | null;
  startedAt: Date | null;
  readyForTestingAt: Date | null;
  completedAt: Date | null;
  reopenCount: number;
  sheetRow: number | null;
  slackThreadTs: string | null;
  /** Increases on every change. */
  version: number;
  updatedAt: Date;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  actorId: string | null;
  source: EventSource;
  reason: string | null;
  /** True when a change made directly in Trello broke a rule. */
  violation: boolean;
  createdAt: Date;
}

/** Duplicate check: one document per incoming event already handled (unique on source + externalId). */
export interface ProcessedEvent {
  id: string;
  source: EventSource;
  externalId: string;
  processedAt: Date;
}

/** Events waiting to be delivered to the sheet, Slack and n8n (outbox pattern). */
export interface OutboxEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  /** Which delivery steps already succeeded, e.g. { "sheet": true, "history": true }, so a retry never repeats them. */
  progress: Record<string, boolean>;
  createdAt: Date;
}

export interface SyncError {
  id: string;
  projectId: string | null;
  taskId: string | null;
  step: string;
  error: string;
  payload: Record<string, unknown> | null;
  resolved: boolean;
  createdAt: Date;
}
