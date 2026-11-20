import { Controller, Delete, Get, HttpException, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard, ReadTokenAllowed } from '../../common/auth/jwt-auth.guard';
import { McpService } from './mcp.service';

@ApiTags('MCP')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @ReadTokenAllowed() // each tool checks the token's scope itself
  @ApiOperation({ summary: 'MCP endpoint (Streamable HTTP, stateless) for Claude and other MCP clients' })
  handle(@CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response): Promise<void> {
    return this.mcp.handleRequest(user, req, res);
  }

  // Stateless server: no event stream (GET) or sessions to end (DELETE).
  @Get()
  get(): never {
    throw new HttpException('Use POST for MCP requests', HttpStatus.METHOD_NOT_ALLOWED);
  }

  @Delete()
  remove(): never {
    throw new HttpException('This MCP server has no sessions', HttpStatus.METHOD_NOT_ALLOWED);
  }
}
