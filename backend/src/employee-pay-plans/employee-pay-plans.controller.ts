import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateEmployeePayPlanDto, CreateEmployeePayPlanVersionDto, EmployeePayPlanCatalogueQueryDto, EmployeePayPlanDetailQueryDto, EmployeePayPlanEmployeeQueryDto, EmployeePayPlanQueryDto } from "./employee-pay-plans.dto";
import { EmployeePayPlansService } from "./employee-pay-plans.service";

@Controller("employee-pay-plans")
@UseGuards(SessionGuard)
export class EmployeePayPlansController {
  constructor(private readonly plans: EmployeePayPlansService) {}

  @Get("context") context(@Req() request: AuthRequest) { return this.plans.context(request.user); }
  @Get("employees") employees(@Req() request: AuthRequest, @Query() query: EmployeePayPlanEmployeeQueryDto) { return this.plans.employees(request.user, query); }
  @Get("catalogue") catalogue(@Req() request: AuthRequest, @Query() query: EmployeePayPlanCatalogueQueryDto) { return this.plans.catalogue(request.user, query); }
  @Get() list(@Req() request: AuthRequest, @Query() query: EmployeePayPlanQueryDto) { return this.plans.list(request.user, query); }
  @Get(":id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: EmployeePayPlanDetailQueryDto) { return this.plans.detail(request.user, id, query); }
  @Post() create(@Req() request: AuthRequest, @Body() dto: CreateEmployeePayPlanDto) { return this.plans.create(request.user, dto, request.ip); }
  @Post(":id/versions") createVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreateEmployeePayPlanVersionDto) { return this.plans.createVersion(request.user, id, dto, request.ip); }
}
