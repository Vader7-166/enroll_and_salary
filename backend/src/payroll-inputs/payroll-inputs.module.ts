import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { PayrollConfigurationModule } from "../payroll-configuration/payroll-configuration.module";
import { PayrollInputsController } from "./payroll-inputs.controller";
import { PayrollInputsService } from "./payroll-inputs.service";

@Module({ imports: [AuthModule, DatabaseModule, AuditModule, PayrollConfigurationModule], controllers: [PayrollInputsController], providers: [PayrollInputsService], exports: [PayrollInputsService] })
export class PayrollInputsModule {}
