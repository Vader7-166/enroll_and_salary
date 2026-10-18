import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";
import { ScopeService } from "../organization/scope.service";
import { OrganizationController } from "../organization/organization.controller";
@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, OrganizationController],
  providers: [EmployeesService, ScopeService],
})
export class EmployeesModule {}
