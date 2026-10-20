import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { ScopeService } from "../organization/scope.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { CorrectionsController } from "./corrections.controller";
import { CorrectionsService } from "./corrections.service";
import { LeaveAccessService } from "../leave/leave-access.service";
import { TeamConfirmationController } from "./team-confirmation.controller";
import { TeamConfirmationService } from "./team-confirmation.service";
@Module({ imports: [AuthModule, AuditModule, SettingsModule], controllers: [AttendanceController, CorrectionsController, TeamConfirmationController], providers: [AttendanceService, CorrectionsService, TeamConfirmationService, LeaveAccessService, ScopeService], exports: [AttendanceService] })
export class AttendanceModule {}
