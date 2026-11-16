import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { ConnectionsService } from '../connections/connections.service';

/**
 * "Connect Google": the user's OWN Google account, used only to create the project sheet in their Drive.
 * drive.file = we can only see files Taskvane created, nothing else in their Drive.
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];

@Injectable()
export class GoogleOAuthClient {
  private readonly logger = new Logger(GoogleOAuthClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly connections: ConnectionsService,
  ) {}

  /** "Connect Google" link. offline + consent so Google always returns a refresh token. */
  authorizeUrl(state: string, redirectUri: string): string {
    return this.client(redirectUri).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  /** Exchange the code from Google's redirect for a refresh token and the account's email. */
  async exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; sub: string; email: string; scopes: string }> {
    if (!code) throw new BadRequestException('Google did not return a code');
    const client = this.client(redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      this.logger.warn('Google connect: no refresh token returned');
      throw new BadRequestException('Google did not return a refresh token. Remove Taskvane at myaccount.google.com/permissions and connect again.');
    }
    if (!tokens.scope?.includes('drive.file')) {
      throw new BadRequestException('Please allow Taskvane to create files in your Google Drive (tick the Drive box), then connect again.');
    }
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token ?? '', audience: this.clientId() });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new BadRequestException('Google did not return the account email');
    this.logger.log(`Google connect OK (scopes ${tokens.scope})`);
    return { refreshToken: tokens.refresh_token, sub: payload.sub, email: payload.email, scopes: tokens.scope ?? '' };
  }

  /** A fresh access token for the organization's connected Google account. */
  async accessTokenForOrg(organizationId: string): Promise<string> {
    const refreshToken = await this.connections.getToken(organizationId, 'GOOGLE');
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    const { token } = await client.getAccessToken().catch((err: Error) => {
      this.logger.warn(`Google token refresh failed: ${err.message}`);
      throw new BadRequestException('The Google connection stopped working. Connect Google again.');
    });
    if (!token) throw new BadRequestException('The Google connection stopped working. Connect Google again.');
    return token;
  }

  /** Throws a readable error if the server has no Google OAuth client set up. */
  assertConfigured(): void {
    if (!this.clientId() || !this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET')) {
      this.logger.error('Connect Google needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET');
      throw new BadRequestException('Connect Google is not set up on this server (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)');
    }
  }

  private client(redirectUri?: string): OAuth2Client {
    this.assertConfigured();
    return new OAuth2Client({ clientId: this.clientId(), clientSecret: this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET'), redirectUri });
  }

  private clientId(): string {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') ?? '';
  }
}
