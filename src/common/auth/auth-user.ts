import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiTokenScope } from '../../database/types';

export interface AuthUser {
  id: string;
  email: string;
  /** How the request logged in: the login token (JWT) from /auth/google, or a personal access token (tv_pat_…). */
  via: 'login' | 'token';
  /** Only for personal access tokens: which token, and what it may do. */
  tokenId?: string;
  scope?: ApiTokenScope;
}

export type AuthedRequest = Request & { user?: AuthUser; orgRole?: 'OWNER' | 'COORDINATOR' };

/** The logged-in user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user!;
});
