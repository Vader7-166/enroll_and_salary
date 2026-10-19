import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthRequest } from './auth.types';
import { SessionGuard } from './session.guard';
import { ChangePasswordDto } from './accounts.dto';
import { PasswordPolicyService } from './password-policy.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService, private readonly passwords: PasswordPolicyService) {}
  @Post('login')
  async login(@Body() body: { username?: unknown; password?: unknown }, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { token, user } = await this.auth.login(body?.username, body?.password, request.ip);
    response.cookie('hrtp_session', token, this.cookieOptions());
    return { user };
  }
  @Get('me') @UseGuards(SessionGuard)
  me(@Req() request: AuthRequest) { return { user: request.user }; }
  @Get('password-policy') @UseGuards(SessionGuard)
  policy() { return { policy: this.passwords.policy }; }
  @Post('change-password') @UseGuards(SessionGuard)
  async changePassword(@Body() body: ChangePasswordDto, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.changePassword(request.user, body, request.ip);
    response.clearCookie('hrtp_session', this.cookieOptions());
    return { ok: true };
  }
  @Post('logout') @UseGuards(SessionGuard)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.sessionId, request.user.id, request.ip);
    response.clearCookie('hrtp_session', this.cookieOptions());
    return { ok: true };
  }
  private cookieOptions() {
    const value = this.config.get<string | boolean>('COOKIE_SECURE');
    return { httpOnly: true, sameSite: 'strict' as const, path: '/api', secure: value === true || value === 'true' || value === '1' };
  }
}
