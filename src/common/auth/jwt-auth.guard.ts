import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { shortId } from '../logging/redact';
import { API_TOKEN_PREFIX, ApiTokensService } from '../../modules/auth/api-tokens.service';
import type { AuthedRequest } from './auth-user';

const READ_TOKEN_ALLOWED = 'readTokenAllowed';
/** Methods a `read` personal access token may use on any route. */
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Lets a `read` personal access token call this non-GET route, because the route itself only reads
 * or checks the scope on its own (e.g. POST /mcp, where each tool decides).
 */
export const ReadTokenAllowed = () => SetMetadata(READ_TOKEN_ALLOWED, true);

/**
 * Requires "Authorization: Bearer <token>", either:
 * - the login token from /auth/google (or /auth/dev-login), or
 * - a personal access token (tv_pat_…) from POST /auth/tokens. A `read` token may only make GET requests.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly apiTokens: ApiTokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      this.logger.debug(`No login token on ${req.method} ${req.path}`);
      throw new UnauthorizedException('Log in first (Authorization: Bearer <token>)');
    }

    if (token.startsWith(API_TOKEN_PREFIX)) {
      const user = await this.apiTokens.authenticate(token);
      if (!user) {
        this.logger.debug(`Personal access token rejected on ${req.method} ${req.path}`);
        throw new UnauthorizedException('This access token is invalid, expired or revoked. Create a new one.');
      }
      const readOnlyOk = this.reflector.getAllAndOverride<boolean>(READ_TOKEN_ALLOWED, [context.getHandler(), context.getClass()]);
      if (user.scope === 'read' && !READ_METHODS.includes(req.method) && !readOnlyOk) {
        this.logger.warn(`Read-only token ${shortId(user.tokenId)} refused on ${req.method} ${req.path}`);
        throw new ForbiddenException('This access token is read-only. Use a token with scope "read+write" to make changes.');
      }
      req.user = user;
      return true;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token);
      req.user = { id: payload.sub, email: payload.email, via: 'login' };
      return true;
    } catch (err) {
      this.logger.debug(`Login token rejected on ${req.method} ${req.path}: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException('Login expired or invalid. Log in again.');
    }
  }
}
