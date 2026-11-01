import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { SocialInsuranceController } from "./social-insurance.controller";
import { SocialInsuranceService } from "./social-insurance.service";
import { InsuranceChangesController } from "./changes/insurance-changes.controller";
import { InsuranceChangesService } from "./changes/insurance-changes.service";
import { C12Service } from "./c12/c12.service";

@Module({ imports: [AuthModule, AuditModule, PayrollEventsModule], controllers: [SocialInsuranceController, InsuranceChangesController], providers: [SocialInsuranceService, InsuranceChangesService, C12Service, ScopeService], exports: [SocialInsuranceService, InsuranceChangesService] })
export class SocialInsuranceModule {}
