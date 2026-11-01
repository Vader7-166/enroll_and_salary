import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollProfileController } from "./payroll-profile.controller";
import { PayrollProfileService } from "./payroll-profile.service";

@Module({ imports: [AuthModule, AuditModule], controllers: [PayrollProfileController], providers: [PayrollProfileService, ScopeService], exports: [PayrollProfileService] })
export class PayrollProfileModule {}
