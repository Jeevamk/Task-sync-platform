import { Global, Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';

@Global()
@Module({ providers: [ConnectionsService], exports: [ConnectionsService] })
export class ConnectionsCoreModule {}
