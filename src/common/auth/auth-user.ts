import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthedRequest = Request & { user?: AuthUser; orgRole?: 'OWNER' | 'COORDINATOR' };

/** The logged-in user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user!;
});
