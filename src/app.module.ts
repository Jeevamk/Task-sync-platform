import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
})
export class AppModule {}
