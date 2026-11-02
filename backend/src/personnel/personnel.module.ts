import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { SocialInsuranceModule } from "../social-insurance/social-insurance.module";
import { PersonnelController } from "./personnel.controller";
import { PersonnelService } from "./personnel.service";
import { TerminationController } from "./termination.controller";
import { TerminationService } from "./termination.service";

@Module({
  imports: [AuthModule, PayrollEventsModule, SocialInsuranceModule],
  controllers: [PersonnelController, TerminationController],
  providers: [PersonnelService, TerminationService, ScopeService],
  exports: [TerminationService],
})
export class PersonnelModule {}
