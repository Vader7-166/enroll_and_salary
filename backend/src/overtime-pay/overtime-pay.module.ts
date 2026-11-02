import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { LeaveAccessService } from "../leave/leave-access.service";
import { ScopeService } from "../organization/scope.service";
import { SettingsModule } from "../settings/settings.module";
import { OvertimePayController } from "./overtime-pay.controller";
import { OvertimePayService } from "./overtime-pay.service";

@Module({ imports: [AuthModule, AuditModule, SettingsModule], controllers: [OvertimePayController], providers: [OvertimePayService, LeaveAccessService, ScopeService], exports: [OvertimePayService] })
export class OvertimePayModule {}
