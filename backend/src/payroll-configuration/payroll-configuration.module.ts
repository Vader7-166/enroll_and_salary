import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { SalaryComponentsModule } from "../salary-components/salary-components.module";
import { PayrollConfigurationController } from "./payroll-configuration.controller";
import { PayrollConfigurationService } from "./payroll-configuration.service";

@Module({ imports: [AuthModule, DatabaseModule, AuditModule, SalaryComponentsModule], controllers: [PayrollConfigurationController], providers: [PayrollConfigurationService] })
export class PayrollConfigurationModule {}
