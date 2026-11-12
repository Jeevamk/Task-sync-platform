import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@ApiTags('Login')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Log in with the ID token from "Sign in with Google". */
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

  /** The logged-in user and their organizations. */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
