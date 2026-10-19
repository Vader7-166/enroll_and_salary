import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ScopeService } from "../organization/scope.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { CorrectionsController } from "./corrections.controller";
import { CorrectionsService } from "./corrections.service";
@Module({ imports: [AuthModule, AuditModule, SettingsModule], controllers: [AttendanceController, CorrectionsController], providers: [AttendanceService, CorrectionsService, ScopeService] })
export class AttendanceModule {}
