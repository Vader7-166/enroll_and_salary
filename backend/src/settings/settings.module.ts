import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PeriodsController, SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { DailyJobs } from "../notifications/daily-jobs.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SettingsController, PeriodsController],
  providers: [SettingsService, ScopeService],
  exports: [SettingsService],
})
export class SettingsModule {
  constructor(settings: SettingsService, jobs: DailyJobs) {
    jobs.register("parameter-expiry", () => settings.notifyExpiringParameters());
  }
}
