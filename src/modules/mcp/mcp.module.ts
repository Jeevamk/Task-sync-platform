import { Module } from '@nestjs/common';
import { OrgsModule } from '../orgs/orgs.module';
import { McpAccessService } from './mcp-access.service';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [OrgsModule],
  controllers: [McpController],
  providers: [McpService, McpAccessService],
})
export class McpModule {}
