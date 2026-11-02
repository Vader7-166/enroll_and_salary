import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { PayrollConfigurationModule } from "../payroll-configuration/payroll-configuration.module";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { EmployeePayPlansController } from "./employee-pay-plans.controller";
import { EmployeePayPlansService } from "./employee-pay-plans.service";

@Module({
  imports: [AuthModule, DatabaseModule, AuditModule, PayrollConfigurationModule, PayrollEventsModule],
  controllers: [EmployeePayPlansController],
  providers: [EmployeePayPlansService],
})
export class EmployeePayPlansModule {}
