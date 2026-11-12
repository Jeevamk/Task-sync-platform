import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { CreateOrgDto } from './dto/create-org.dto';
import { OrgsService } from './orgs.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** Create a workspace for your team; you become its OWNER. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateOrgDto) {
    return this.orgs.create(user, body?.name);
  }

  /** Your organizations. */
  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.orgs.listForUser(user.id);
  }

  /** Overview: connections, projects, and the email customers must share their sheet with. */
  @Get(':orgId')
  @UseGuards(OrgAccessGuard)
  overview(@Param('orgId') orgId: string) {
    return this.orgs.overview(orgId);
  }
}
