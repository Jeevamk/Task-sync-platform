import { Global, Module } from '@nestjs/common';
import { TrelloClient } from './trello.client';

@Global()
@Module({ providers: [TrelloClient], exports: [TrelloClient] })
export class TrelloModule {}
