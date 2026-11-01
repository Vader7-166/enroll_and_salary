import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { SalaryDecisionsController } from "./salary-decisions.controller";
import { SalaryDecisionsService } from "./salary-decisions.service";

@Module({ imports: [AuthModule, AuditModule, PayrollEventsModule], controllers: [SalaryDecisionsController], providers: [SalaryDecisionsService, ScopeService], exports: [SalaryDecisionsService] })
export class SalaryDecisionsModule {}
