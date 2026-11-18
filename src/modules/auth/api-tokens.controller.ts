import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ApiTokensService } from './api-tokens.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/**
 * Personal access tokens, for MCP clients (Claude Desktop, Claude Code) and scripts.
 * Managing tokens needs the normal login token: a personal access token cannot create, list or revoke tokens,
 * so a leaked read-only token can never give itself more rights.
 */
@ApiTags('Login')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  /** Creates a token. The `token` value is shown only in this response: copy it now. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateApiTokenDto) {
    loginTokenOnly(user);
    return this.tokens.create(user.id, body);
  }

  /** Your tokens (active, expired and revoked), newest first. Never includes the token values. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    loginTokenOnly(user);
    return this.tokens.list(user.id);
  }

  /** Revokes a token: it stops working immediately. */
  @Delete(':tokenId')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param('tokenId', new ParseUUIDPipe({ version: '4' })) tokenId: string) {
    loginTokenOnly(user);
    return this.tokens.revoke(user.id, tokenId);
  }
}

function loginTokenOnly(user: AuthUser): void {
  if (user.via !== 'login') throw new ForbiddenException('Manage tokens while logged in (with your login token), not with a personal access token');
}
