import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({ imports: [AuthModule], controllers: [ReportsController], providers: [ReportsService, ScopeService] })
export class ReportsModule {}
