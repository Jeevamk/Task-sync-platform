import { Module } from '@nestjs/common';
import { ConnectFlowService } from './connect-flow.service';
import { ConnectionsController } from './connections.controller';

/** The HTTP side of connections (the stored tokens live in the global ConnectionsCoreModule). */
@Module({
  controllers: [ConnectionsController],
  providers: [ConnectFlowService],
})
export class ConnectionsApiModule {}
