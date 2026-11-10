import { Module } from '@nestjs/common';
import { TrelloWebhookController } from './trello-webhook.controller';
import { TrelloWebhookService } from './trello-webhook.service';

@Module({
  controllers: [TrelloWebhookController],
  providers: [TrelloWebhookService],
})
export class WebhooksModule {}
