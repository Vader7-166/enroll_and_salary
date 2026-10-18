import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ScopeService } from "../organization/scope.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
@Module({ imports: [AuthModule, AuditModule, SettingsModule], controllers: [AttendanceController], providers: [AttendanceService, ScopeService] })
export class AttendanceModule {}
