import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { OvertimePayModule } from "../overtime-pay/overtime-pay.module";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { PitModule } from "../personal-income-tax/pit.module";
import { SocialInsuranceModule } from "../social-insurance/social-insurance.module";
import { PayrollController } from "./payroll.controller";
import { PayrollService } from "./payroll.service";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollAdjustmentsController } from "./payroll-adjustments.controller";
import { BonusService } from "./bonus/bonus.service";
import { RetroService } from "./retro/retro.service";
import { DailyJobs } from "../notifications/daily-jobs.service";

@Module({ imports: [AuthModule, AuditModule, OvertimePayModule, SocialInsuranceModule, PitModule, PayrollEventsModule], controllers: [PayrollController, PayrollAdjustmentsController], providers: [PayrollService, PayrollApprovalService, BonusService, RetroService, ScopeService], exports: [PayrollService] })
export class PayrollModule {
  constructor(approval: PayrollApprovalService, jobs: DailyJobs) {
    jobs.register("payroll-payment-due", () => approval.notifyPaymentsDue());
  }
}
