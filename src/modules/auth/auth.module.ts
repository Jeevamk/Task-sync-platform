import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgAccessGuard } from '../../common/auth/org-access.guard';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController, ApiTokensController],
  // ApiTokensService is exported because JwtAuthGuard (used by every module's controllers) needs it.
  providers: [AuthService, ApiTokensService, JwtAuthGuard, OrgAccessGuard],
  exports: [ApiTokensService, JwtAuthGuard, OrgAccessGuard],
})
export class AuthModule {}
