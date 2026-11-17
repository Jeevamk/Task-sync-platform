import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose, { ClientSession, Connection, Model, Schema } from 'mongoose';
import {
  ConnectionSchema,
  MembershipSchema,
  OAuthStateSchema,
  OrganizationSchema,
  OutboxEventSchema,
  ProcessedEventSchema,
  ProjectSchema,
  SyncErrorSchema,
  TaskEventSchema,
  TaskSchema,
  TeamMemberSchema,
  UserSchema,
} from './schemas';
import type {
  Connection as ConnectionDoc,
  Membership,
  OAuthState,
  Organization,
  OutboxEvent,
  OutboxStatus,
  ProcessedEvent,
  Project,
  SyncError,
  Task,
  TaskEvent,
  TeamMember,
  User,
} from './types';

/** The session of the surrounding transaction, or undefined when there is none (pass it on to every query inside). */
export type Session = ClientSession | undefined;

/**
 * MongoDB (Mongoose). Set MONGODB_URI, e.g. mongodb+srv://user:pass@cluster.mongodb.net/taskvane (Atlas)
 * or mongodb://localhost:27017/taskvane (a local MongoDB server).
 *
 * Transactions need a replica set (Atlas always is one). On a single standalone server they are switched
 * off with a warning: everything still works, but a crash in the middle of a change can leave it half done.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  /** Created closed; opened in onModuleInit (so building the app, e.g. for the OpenAPI export, never connects). */
  readonly connection: Connection = mongoose.createConnection();
  private transactionsSupported = false;

  readonly organizations = this.model<Organization>('Organization', OrganizationSchema);
  readonly users = this.model<User>('User', UserSchema);
  readonly memberships = this.model<Membership>('Membership', MembershipSchema);
  readonly connections = this.model<ConnectionDoc>('Connection', ConnectionSchema);
  readonly oauthStates = this.model<OAuthState>('OAuthState', OAuthStateSchema);
  readonly projects = this.model<Project>('Project', ProjectSchema);
  readonly teamMembers = this.model<TeamMember>('TeamMember', TeamMemberSchema);
  readonly tasks = this.model<Task>('Task', TaskSchema);
  readonly taskEvents = this.model<TaskEvent>('TaskEvent', TaskEventSchema);
  readonly processedEvents = this.model<ProcessedEvent>('ProcessedEvent', ProcessedEventSchema);
  readonly outboxEvents = this.model<OutboxEvent>('OutboxEvent', OutboxEventSchema);
  readonly syncErrors = this.model<SyncError>('SyncError', SyncErrorSchema);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.config.getOrThrow<string>('MONGODB_URI');
    const dbName = this.config.get<string>('MONGODB_DB') || databaseNameIn(uri) || 'taskvane';
    const started = Date.now();
    try {
      await this.connection.openUri(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 });
    } catch (err) {
      this.logger.error(`Could not connect to MongoDB (check MONGODB_URI, and on Atlas the IP access list): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    // Unique indexes enforce the duplicate checks, so make sure they exist before the first request (no-op when they do).
    await Promise.all(this.allModels().map((m) => m.createIndexes()));

    const hello = await this.connection.db!.admin().command({ hello: 1 });
    this.transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
    if (!this.transactionsSupported) {
      this.logger.warn('MongoDB is a standalone server: transactions are off. Use Atlas or a replica set in production.');
    }
    this.logger.log(`Connected to MongoDB "${dbName}" in ${Date.now() - started}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
    this.logger.log('Disconnected from MongoDB');
  }

  /** Runs `work` in one transaction: all of its writes happen, or none. Pass the session to every query inside. */
  async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    if (!this.transactionsSupported) return work(undefined);
    return this.connection.transaction((session) => work(session));
  }

  async ping(): Promise<void> {
    await this.connection.db!.admin().ping();
  }

  /** Number of outbox events per status, e.g. { PENDING: 2, SENT: 40 }. */
  async outboxCounts(): Promise<Partial<Record<OutboxStatus, number>>> {
    const groups = await this.outboxEvents.aggregate<{ _id: OutboxStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    return Object.fromEntries(groups.map((g) => [g._id, g.n]));
  }

  private model<T>(name: string, schema: Schema): Model<T> {
    // Do NOT write connection.model<T>(name, schema): with mongoose 8's typings that overload sends tsc into
    // endless type expansion (it runs out of memory and the build/deploy dies). Casting the untyped model is cheap.
    return this.connection.model(name, schema) as unknown as Model<T>;
  }

  private allModels(): Model<unknown>[] {
    return [
      this.organizations,
      this.users,
      this.memberships,
      this.connections,
      this.oauthStates,
      this.projects,
      this.teamMembers,
      this.tasks,
      this.taskEvents,
      this.processedEvents,
      this.outboxEvents,
      this.syncErrors,
    ] as Model<unknown>[];
  }
}

/** "mongodb+srv://u:p@host/taskvane?x=y" → "taskvane" (undefined when the URI names no database). */
function databaseNameIn(uri: string): string | undefined {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/.exec(uri);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
