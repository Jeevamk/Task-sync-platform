import { Module } from '@nestjs/common';
import { BoardSetupService } from './board-setup.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, BoardSetupService],
})
export class ProjectsModule {}
