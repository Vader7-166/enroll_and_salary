import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OriginGuard } from './origin.guard';
import { SessionGuard } from './session.guard';
import { ScopeService } from '../organization/scope.service';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { PasswordPolicyService } from './password-policy.service';

@Module({
  controllers: [AuthController, AccountsController],
  providers: [
    ScopeService,
    AccountsService,
    PasswordPolicyService,
    AuthService,
    SessionGuard,
    OriginGuard,
    { provide: APP_GUARD, useExisting: OriginGuard },
  ],
  exports: [AuthService, SessionGuard, OriginGuard],
})
export class AuthModule {}
