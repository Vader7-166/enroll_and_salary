import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PeriodsController, SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SettingsController, PeriodsController],
  providers: [SettingsService, ScopeService],
  exports: [SettingsService],
})
export class SettingsModule {}
