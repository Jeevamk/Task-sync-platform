import { Module } from '@nestjs/common';
import { BoardSetupService } from './board-setup.service';
import { ProjectCardsService } from './project-cards.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, BoardSetupService, ProjectCardsService],
})
export class ProjectsModule {}
