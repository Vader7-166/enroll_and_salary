import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto, AccountStatusDto, ResetPasswordDto } from './accounts.dto';
import type { AuthRequest } from './auth.types';
import { SessionGuard } from './session.guard';

@Controller('auth/accounts')
@UseGuards(SessionGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}
  @Get('context') context(@Req() request: AuthRequest) { return this.accounts.context(request.user); }
  @Get() list(@Req() request: AuthRequest) { return this.accounts.accounts(request.user); }
  @Post() create(@Body() body: CreateAccountDto, @Req() request: AuthRequest) { return this.accounts.create(request.user, body, request.ip); }
  @Post(':id/update') update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateAccountDto, @Req() request: AuthRequest) { return this.accounts.update(request.user, id, body, request.ip); }
  @Post(':id/status') status(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AccountStatusDto, @Req() request: AuthRequest) { return this.accounts.status(request.user, id, body, request.ip); }
  @Post(':id/password') password(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ResetPasswordDto, @Req() request: AuthRequest) { return this.accounts.resetPassword(request.user, id, body, request.ip); }
  @Post(':id/revoke') async revoke(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthRequest) { await this.accounts.revokeSessions(request.user, id, request.ip); return { ok: true }; }
}
