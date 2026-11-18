import { randomUUID } from 'crypto';
import { Schema, SchemaOptions } from 'mongoose';
import { plainDocuments } from './plain-documents';
import { API_TOKEN_SCOPES, EVENT_SOURCES, ORG_ROLES, OUTBOX_STATUSES, PROVIDERS, ROLES, TASK_EVENT_TYPES, TASK_STATUSES } from './types';

/**
 * MongoDB collections. Unique indexes do real work here:
 * they stop duplicate events (processed_events), double-linked boards/sheets (projects) and duplicate people (team_members).
 */

/** Every document's _id is a UUID string, so IDs in URLs and payloads stay the same as before. */
const uuid = { type: String, default: () => randomUUID() };
const optionalString = { type: String, default: null };
const optionalDate = { type: Date, default: null };
const now = { type: Date, default: () => new Date() };

/** minimize: false keeps empty objects ({}), e.g. a new project's listMap or an event's delivery progress. */
const options = (collection: string, extra: SchemaOptions<any> = {}): SchemaOptions<any> => ({ collection, versionKey: false, minimize: false, ...extra });

/** An optional field that must still be unique when set: two documents without it are fine. */
const whenSet = (field: string) => ({ partialFilterExpression: { [field]: { $type: 'string' } } });

export const OrganizationSchema = new Schema<any>({ _id: uuid, name: { type: String, required: true }, createdAt: now }, options('organizations'));

export const UserSchema = new Schema<any>(
  {
    _id: uuid,
    email: { type: String, required: true },
    name: { type: String, required: true },
    googleSub: optionalString,
    createdAt: now,
  },
  options('users'),
);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ googleSub: 1 }, { unique: true, ...whenSet('googleSub') });

export const MembershipSchema = new Schema<any>(
  {
    _id: uuid,
    userId: { type: String, required: true },
    organizationId: { type: String, required: true },
    role: { type: String, enum: ORG_ROLES, default: 'COORDINATOR' },
    createdAt: now,
  },
  options('memberships'),
);
MembershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
MembershipSchema.index({ organizationId: 1 });

export const ConnectionSchema = new Schema<any>(
  {
    _id: uuid,
    organizationId: { type: String, required: true },
    provider: { type: String, enum: PROVIDERS, required: true },
    externalId: { type: String, required: true },
    externalName: { type: String, required: true },
    botUserId: optionalString,
    encryptedToken: { type: String, required: true },
    scopes: optionalString,
    connectedBy: optionalString,
  },
  options('connections', { timestamps: true }),
);
ConnectionSchema.index({ organizationId: 1, provider: 1 }, { unique: true });
ConnectionSchema.index({ provider: 1, externalId: 1 });

export const OAuthStateSchema = new Schema<any>(
  {
    _id: uuid,
    state: { type: String, required: true },
    organizationId: { type: String, required: true },
    provider: { type: String, enum: PROVIDERS, required: true },
    userEmail: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  options('oauth_states'),
);
OAuthStateSchema.index({ state: 1 }, { unique: true });
// MongoDB deletes expired connect links by itself (the app also refuses them when it reads one).
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ProjectSchema = new Schema<any>(
  {
    _id: uuid,
    organizationId: { type: String, required: true },
    name: { type: String, required: true },
    trelloBoardId: { type: String, required: true },
    trelloWebhookId: optionalString,
    listMap: { type: Schema.Types.Mixed, default: () => ({}) },
    sheetId: { type: String, required: true },
    slackChannelId: { type: String, required: true },
    coordinatorId: optionalString,
    settings: { type: Schema.Types.Mixed, default: () => ({}) },
    active: { type: Boolean, default: true },
  },
  options('projects', { timestamps: true }),
);
ProjectSchema.index({ trelloBoardId: 1 }, { unique: true });
ProjectSchema.index({ sheetId: 1 }, { unique: true });
ProjectSchema.index({ organizationId: 1, createdAt: -1 });

export const TeamMemberSchema = new Schema<any>(
  {
    _id: uuid,
    organizationId: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    trelloMemberId: optionalString,
    slackUserId: optionalString,
    role: { type: String, enum: ROLES, default: 'DEV' },
    active: { type: Boolean, default: true },
  },
  options('team_members'),
);
TeamMemberSchema.index({ organizationId: 1, email: 1 }, { unique: true });
TeamMemberSchema.index({ organizationId: 1, trelloMemberId: 1 }, { unique: true, ...whenSet('trelloMemberId') });
TeamMemberSchema.index({ organizationId: 1, slackUserId: 1 }, { unique: true, ...whenSet('slackUserId') });

export const TaskSchema = new Schema<any>(
  {
    _id: uuid,
    projectId: { type: String, required: true },
    taskKey: { type: String, required: true },
    trelloCardId: { type: String, required: true },
    title: { type: String, required: true },
    description: optionalString,
    status: { type: String, enum: TASK_STATUSES, default: 'TODO' },
    assigneeId: optionalString,
    progressNotes: optionalString,
    blocker: optionalString,
    dueDate: optionalDate,
    priority: optionalString,
    labels: { type: [String], default: () => [] },
    pickedUpAt: optionalDate,
    startedAt: optionalDate,
    readyForTestingAt: optionalDate,
    completedAt: optionalDate,
    reopenCount: { type: Number, default: 0 },
    sheetRow: { type: Number, default: null },
    slackThreadTs: optionalString,
    version: { type: Number, default: 1 },
  },
  options('tasks', { timestamps: { createdAt: false, updatedAt: true } }),
);
TaskSchema.index({ trelloCardId: 1 }, { unique: true });
TaskSchema.index({ projectId: 1, taskKey: 1 }, { unique: true });
TaskSchema.index({ projectId: 1, status: 1 });

export const TaskEventSchema = new Schema<any>(
  {
    _id: uuid,
    taskId: { type: String, required: true },
    type: { type: String, enum: TASK_EVENT_TYPES, required: true },
    field: optionalString,
    oldValue: optionalString,
    newValue: optionalString,
    actorId: optionalString,
    source: { type: String, enum: EVENT_SOURCES, required: true },
    reason: optionalString,
    violation: { type: Boolean, default: false },
    createdAt: now,
  },
  options('task_events'),
);
TaskEventSchema.index({ taskId: 1, createdAt: 1 });

export const ProcessedEventSchema = new Schema<any>(
  {
    _id: uuid,
    source: { type: String, enum: EVENT_SOURCES, required: true },
    externalId: { type: String, required: true },
    processedAt: now,
  },
  options('processed_events'),
);
// The duplicate check: a second insert of the same event fails with error 11000.
ProcessedEventSchema.index({ source: 1, externalId: 1 }, { unique: true });

export const OutboxEventSchema = new Schema<any>(
  {
    _id: uuid,
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: OUTBOX_STATUSES, default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: now,
    sentAt: optionalDate,
    lastError: optionalString,
    progress: { type: Schema.Types.Mixed, default: () => ({}) },
    createdAt: now,
  },
  options('outbox_events'),
);
OutboxEventSchema.index({ status: 1, nextAttemptAt: 1 });

export const SyncErrorSchema = new Schema<any>(
  {
    _id: uuid,
    projectId: optionalString,
    taskId: optionalString,
    step: { type: String, required: true },
    error: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: null },
    resolved: { type: Boolean, default: false },
    createdAt: now,
  },
  options('sync_errors'),
);
SyncErrorSchema.index({ resolved: 1, createdAt: 1 });

export const ApiTokenSchema = new Schema<any>(
  {
    _id: uuid,
    userId: { type: String, required: true },
    name: { type: String, required: true },
    tokenHash: { type: String, required: true },
    prefix: { type: String, required: true },
    scope: { type: String, enum: API_TOKEN_SCOPES, default: 'read' },
    lastUsedAt: optionalDate,
    expiresAt: optionalDate,
    revokedAt: optionalDate,
    createdAt: now,
  },
  options('api_tokens'),
);
// Every request with a token looks it up by its hash.
ApiTokenSchema.index({ tokenHash: 1 }, { unique: true });
ApiTokenSchema.index({ userId: 1, createdAt: -1 });

// Reads return plain objects with `id` (see plain-documents.ts).
for (const schema of [
  OrganizationSchema,
  UserSchema,
  MembershipSchema,
  ConnectionSchema,
  OAuthStateSchema,
  ProjectSchema,
  TeamMemberSchema,
  TaskSchema,
  TaskEventSchema,
  ProcessedEventSchema,
  OutboxEventSchema,
  SyncErrorSchema,
  ApiTokenSchema,
]) {
  schema.plugin(plainDocuments);
}
