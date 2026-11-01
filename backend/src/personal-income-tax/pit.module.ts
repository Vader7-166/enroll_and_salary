import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollProfileModule } from "../payroll-profile/payroll-profile.module";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { PitController } from "./pit.controller";
import { PitService } from "./pit.service";
import { TaxFinalizationController } from "./finalization/finalization.controller";
import { TaxFinalizationService } from "./finalization/finalization.service";

@Module({ imports: [AuthModule, AuditModule, PayrollProfileModule, PayrollEventsModule], controllers: [PitController, TaxFinalizationController], providers: [PitService, TaxFinalizationService, ScopeService], exports: [PitService] })
export class PitModule {}
