import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { maskEmail, shortId } from '../../common/logging/redact';
import { PrismaService } from '../../prisma/prisma.service';

export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly google = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** The web app sends the Google ID token from "Sign in with Google"; we check it with Google. */
  async loginWithGoogle(idToken: string): Promise<LoginResult> {
    const audience = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (!audience) {
      this.logger.error('Google sign-in attempted but GOOGLE_OAUTH_CLIENT_ID is not set');
      throw new UnauthorizedException('GOOGLE_OAUTH_CLIENT_ID is not set on the server');
    }
    if (!idToken) throw new UnauthorizedException('idToken is required');
    let payload;
    try {
      payload = (await this.google.verifyIdToken({ idToken, audience })).getPayload();
    } catch (err) {
      this.logger.warn(`Google sign-in rejected: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException('Google sign-in could not be verified');
    }
    if (!payload?.email || !payload.email_verified) {
      this.logger.warn(`Google sign-in rejected: email not verified (${maskEmail(payload?.email)})`);
      throw new UnauthorizedException('Google account email is not verified');
    }

    const user = await this.prisma.user.upsert({
      where: { email: payload.email.toLowerCase() },
      create: { email: payload.email.toLowerCase(), name: payload.name ?? payload.email, googleSub: payload.sub },
      update: { name: payload.name ?? undefined, googleSub: payload.sub },
    });
    this.logger.log(`Google sign-in: ${maskEmail(user.email)} (user ${shortId(user.id)})`);
    return this.issue(user);
  }

  /** Local testing only (ALLOW_DEV_LOGIN=true and not production): log in by email without Google. */
  async devLogin(email: string, name?: string): Promise<LoginResult> {
    const allowed = this.config.get<boolean>('ALLOW_DEV_LOGIN') && this.config.get('NODE_ENV') !== 'production';
    if (!allowed) {
      this.logger.warn(`Dev login refused for ${maskEmail(email)}: disabled on this server`);
      throw new ForbiddenException('Dev login is disabled');
    }
    const clean = String(email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(clean)) throw new UnauthorizedException('A valid email is required');
    const user = await this.prisma.user.upsert({
      where: { email: clean },
      create: { email: clean, name: name?.trim() || clean },
      update: name?.trim() ? { name: name.trim() } : {},
    });
    this.logger.log(`Dev login: ${maskEmail(user.email)} (user ${shortId(user.id)})`);
    return this.issue(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { organization: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: user.memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
    };
  }

  private async issue(user: { id: string; email: string; name: string }): Promise<LoginResult> {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }
}
