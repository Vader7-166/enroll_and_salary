import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreatePlanDto, CreateShiftDto, MembersQueryDto, PlanActionDto, PlanQueryDto, ShiftActiveDto, ShiftQueryDto, UpdatePlanDto, UpdateShiftDto } from "./shifts.dto";
import { ShiftsService } from "./shifts.service";
@Controller("shifts")
@UseGuards(SessionGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}
  @Get("definitions") definitions(@Req() r: AuthRequest, @Query() q: ShiftQueryDto) { return this.shifts.definitions(r.user, q); }
  @Post("definitions") createDefinition(@Req() r: AuthRequest, @Body() d: CreateShiftDto) { return this.shifts.createDefinition(r.user, d, r.ip); }
  @Post("definitions/:id/update") updateDefinition(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: UpdateShiftDto) { return this.shifts.updateDefinition(r.user, id, d, r.ip); }
  @Post("definitions/:id/active") active(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: ShiftActiveDto) { return this.shifts.setActive(r.user, id, d, r.ip); }
  @Get("members") members(@Req() r: AuthRequest, @Query() q: MembersQueryDto) { return this.shifts.members(r.user, q); }
  @Get("plans") plans(@Req() r: AuthRequest, @Query() q: PlanQueryDto) { return this.shifts.plans(r.user, q); }
  @Get("official") official(@Req() r: AuthRequest, @Query() q: PlanQueryDto) { return this.shifts.official(r.user, q); }
  @Get("plans/:id") plan(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.shifts.plan(r.user, id); }
  @Post("plans") createPlan(@Req() r: AuthRequest, @Body() d: CreatePlanDto) { return this.shifts.createPlan(r.user, d, r.ip); }
  @Post("plans/:id/update") updatePlan(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: UpdatePlanDto) { return this.shifts.updatePlan(r.user, id, d, r.ip); }
  @Post("plans/:id/submit") submit(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: PlanActionDto) { return this.shifts.transition(r.user, id, "SUBMIT", d, r.ip); }
  @Post("plans/:id/approve") approve(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: PlanActionDto) { return this.shifts.transition(r.user, id, "APPROVE", d, r.ip); }
  @Post("plans/:id/return") returnPlan(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: PlanActionDto) { return this.shifts.transition(r.user, id, "RETURN", d, r.ip); }
  @Post("plans/:id/cancel") cancel(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: PlanActionDto) { return this.shifts.transition(r.user, id, "CANCEL", d, r.ip); }
}
