import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthRequest } from './auth.types';
import { SessionGuard } from './session.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() body: { username?: unknown; password?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token, user } = await this.auth.login(body?.username, body?.password, request.ip);
    response.cookie('hrtp_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      secure: this.cookieSecure(),
    });
    return { user };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthRequest) {
    return { user: request.user };
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.sessionId, request.user.id, request.ip);
    response.clearCookie('hrtp_session', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      secure: this.cookieSecure(),
    });
    return { ok: true };
  }

  @Get('accounts')
  @UseGuards(SessionGuard)
  accounts(@Req() request: AuthRequest) {
    return this.auth.accounts(request.user);
  }

  @Post('accounts/:id/revoke')
  @UseGuards(SessionGuard)
  async revoke(@Param('id') id: string, @Req() request: AuthRequest) {
    if (!isUuid(id)) {
      throw new BadRequestException({ code: 'INVALID_ACCOUNT_ID', message: 'Account ID must be a UUID.' });
    }
    await this.auth.revokeSessions(request.user, id, request.ip);
    return { ok: true };
  }

  private cookieSecure(): boolean {
    const value = this.config.get<string | boolean>('COOKIE_SECURE');
    return value === true || value === 'true' || value === '1';
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
