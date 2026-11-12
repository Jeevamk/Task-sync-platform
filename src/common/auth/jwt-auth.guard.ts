import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthedRequest } from './auth-user';

/** Requires "Authorization: Bearer <login token>" from /auth/google (or /auth/dev-login). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      this.logger.debug(`No login token on ${req.method} ${req.path}`);
      throw new UnauthorizedException('Log in first (Authorization: Bearer <token>)');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token);
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch (err) {
      this.logger.debug(`Login token rejected on ${req.method} ${req.path}: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException('Login expired or invalid. Log in again.');
    }
  }
}
