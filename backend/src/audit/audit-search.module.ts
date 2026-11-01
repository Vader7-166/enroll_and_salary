import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DailyJobs } from "../notifications/daily-jobs.service";
import { ScopeService } from "../organization/scope.service";
import { AuditSearchController } from "./audit-search.controller";
import { AuditSearchService } from "./audit-search.service";

@Module({
  imports: [AuthModule],
  controllers: [AuditSearchController],
  providers: [AuditSearchService, ScopeService],
})
export class AuditSearchModule {
  constructor(search: AuditSearchService, jobs: DailyJobs) {
    jobs.register("audit-integrity", () => search.verifyChain("SCHEDULED"));
  }
}
