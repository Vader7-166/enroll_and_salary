import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PayrollEventsModule } from "../payroll-events/payroll-events.module";
import { WelfareController } from "./welfare.controller";
import { WelfareService } from "./welfare.service";

@Module({ imports: [AuthModule, PayrollEventsModule], controllers: [WelfareController], providers: [WelfareService, ScopeService] })
export class WelfareModule {}
