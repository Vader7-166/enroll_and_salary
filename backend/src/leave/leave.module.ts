import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { LeaveAccessService } from "./leave-access.service";
import { LeaveCatalogController } from "./leave-catalog.controller";
import { LeaveCatalogService } from "./leave-catalog.service";
import { LeaveFundsController } from "./leave-funds.controller";
import { LeaveFundsService } from "./leave-funds.service";
import { LeaveRequestsController } from "./leave-requests.controller";
import { LeaveRequestsService } from "./leave-requests.service";
import { AttendanceModule } from "../attendance/attendance.module";
import { SettingsModule } from "../settings/settings.module";
import { AbsenceRateService } from "./absence-rate/absence-rate.service";
import { SicknessMaternityController } from "./sickness-maternity/sickness-maternity.controller";
import { SicknessMaternityService } from "./sickness-maternity/sickness-maternity.service";

@Module({
  imports: [AuthModule, AttendanceModule, SettingsModule],
  controllers: [SicknessMaternityController, LeaveCatalogController, LeaveFundsController, LeaveRequestsController],
  providers: [ScopeService, LeaveAccessService, LeaveCatalogService, LeaveFundsService, LeaveRequestsService, SicknessMaternityService, AbsenceRateService],
})
export class LeaveModule {}
