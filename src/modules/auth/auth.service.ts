import { ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { maskEmail, shortId } from '../../common/logging/redact';
import { DatabaseService } from '../../database/database.service';

export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly google = new OAuth2Client();

  constructor(
    private readonly db: DatabaseService,
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

    const user = await this.upsertUser(payload.email.toLowerCase(), payload.name, { googleSub: payload.sub });
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
    const user = await this.upsertUser(clean, name?.trim());
    this.logger.log(`Dev login: ${maskEmail(user.email)} (user ${shortId(user.id)})`);
    return this.issue(user);
  }

  async me(userId: string) {
    const user = await this.db.users.findOne({ _id: userId });
    if (!user) throw new NotFoundException('User not found');
    const memberships = await this.db.memberships.find({ userId });
    const orgs = await this.db.organizations.find({ _id: { $in: memberships.map((m) => m.organizationId) } });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: memberships.flatMap((m) => {
        const org = orgs.find((o) => o.id === m.organizationId);
        return org ? [{ id: org.id, name: org.name, role: m.role }] : [];
      }),
    };
  }

  /** Finds the user by email or creates them. A given name (and Google sub) is saved; without a name, a new user is named after the email. */
  private async upsertUser(email: string, name: string | undefined, extra: { googleSub?: string } = {}) {
    const user = await this.db.users.findOneAndUpdate(
      { email },
      {
        $set: { ...extra, ...(name ? { name } : {}) },
        $setOnInsert: { _id: randomUUID(), ...(name ? {} : { name: email }) },
      },
      { upsert: true, new: true },
    );
    return user!;
  }

  private async issue(user: { id: string; email: string; name: string }): Promise<LoginResult> {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }
}
