import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { ShiftRotationController } from "./rotation.controller";
import { ShiftRotationService } from "./rotation.service";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";
import { ShiftSwapService } from "./swap.service";

@Module({ imports: [AuthModule, AttendanceModule], controllers: [ShiftRotationController, ShiftsController], providers: [ShiftsService, ShiftRotationService, ShiftSwapService, ScopeService] })
export class ShiftsModule {}
