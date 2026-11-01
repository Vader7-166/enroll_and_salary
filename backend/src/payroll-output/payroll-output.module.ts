import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { PayrollOutputAccess } from "./output-access";
import { PayrollOutputController } from "./payroll-output.controller";
import { PayslipsService } from "./payslips.service";
import { SalaryPaymentsService } from "./salary-payments.service";

@Module({ imports: [AuthModule, AuditModule, PayrollEventsModule], controllers: [PayrollOutputController], providers: [PayrollOutputAccess, PayslipsService, SalaryPaymentsService, ScopeService] })
export class PayrollOutputModule {}
