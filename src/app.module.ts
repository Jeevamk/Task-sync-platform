import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ErrorReasonFilter } from './common/logging/error-reason.filter';
import { createValidationPipe } from './common/validation/validation.pipe';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/token-crypto.service';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectionsCoreModule } from './modules/connections/connections.module';
import { ConnectionsApiModule } from './modules/connections/connections-api.module';
import { TrelloModule } from './modules/trello/trello.module';
import { SlackModule } from './modules/slack/slack.client';
import { GoogleModule } from './modules/google/sheets.client';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TeamModule } from './modules/team/team.module';
import { HealthModule } from './modules/health/health.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { InternalModule } from './modules/internal/internal.module';
import { SheetsModule } from './modules/sheets/sheets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // core (global)
    PrismaModule,
    CryptoModule,
    AuthModule,
    ConnectionsCoreModule,
    TrelloModule,
    SlackModule,
    GoogleModule,
    DeliveryModule,
    OutboxModule,
    TasksModule,
    // HTTP APIs
    OrgsModule,
    ConnectionsApiModule,
    ProjectsModule,
    TeamModule,
    HealthModule,
    WebhooksModule,
    SheetsModule,
    InternalModule,
  ],
  providers: [
    // Checks every request body against its DTO (registered here so it also applies in tests and on Vercel).
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Records why a request failed, so the request log line shows the reason, not just "400".
    { provide: APP_FILTER, useClass: ErrorReasonFilter },
  ],
})
export class AppModule {}
