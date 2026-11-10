import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthService } from './auth.service';

class GoogleLoginDto {
  @ApiProperty({ description: 'ID token from Google Sign-In in the web app' })
  idToken!: string;
}

class DevLoginDto {
  @ApiProperty({ example: 'you@example.com' })
  email!: string;
  @ApiPropertyOptional({ example: 'Your Name' })
  name?: string;
}

@ApiTags('Login')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('google')
  @HttpCode(200)
  google(@Body() body: GoogleLoginDto) {
    return this.auth.loginWithGoogle(body?.idToken);
  }

  /** Only when ALLOW_DEV_LOGIN=true and NODE_ENV is not production. */
  @Post('dev-login')
  @HttpCode(200)
  devLogin(@Body() body: DevLoginDto) {
    return this.auth.devLogin(body?.email, body?.name);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
