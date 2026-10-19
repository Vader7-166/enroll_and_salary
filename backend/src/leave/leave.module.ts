import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { LeaveAccessService } from "./leave-access.service";
import { LeaveCatalogController } from "./leave-catalog.controller";
import { LeaveCatalogService } from "./leave-catalog.service";
import { LeaveFundsController } from "./leave-funds.controller";
import { LeaveFundsService } from "./leave-funds.service";
import { LeaveRequestsController } from "./leave-requests.controller";
import { LeaveRequestsService } from "./leave-requests.service";

@Module({
  imports: [AuthModule],
  controllers: [LeaveCatalogController, LeaveFundsController, LeaveRequestsController],
  providers: [ScopeService, LeaveAccessService, LeaveCatalogService, LeaveFundsService, LeaveRequestsService],
})
export class LeaveModule {}
