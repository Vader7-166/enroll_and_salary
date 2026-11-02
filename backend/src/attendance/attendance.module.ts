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
import { WorkshopClosureController } from "./workshop-closure.controller";
import { WorkshopClosureService } from "./workshop-closure.service";
import { AttendancePeriodLockController } from "./period-lock.controller";
import { AttendancePeriodLockService } from "./period-lock.service";
@Module({ imports: [AuthModule, AuditModule, SettingsModule], controllers: [AttendanceController, CorrectionsController, TeamConfirmationController, WorkshopClosureController, AttendancePeriodLockController], providers: [AttendanceService, CorrectionsService, TeamConfirmationService, WorkshopClosureService, AttendancePeriodLockService, LeaveAccessService, ScopeService], exports: [AttendanceService] })
export class AttendanceModule {}
