import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateLeaveRequestDto, LeaveRequestActionDto, LeaveRequestQueryDto, SubmitLeaveRequestDto, UpdateLeaveRequestDto } from "./leave-requests.dto";
import { LeaveRequestsService } from "./leave-requests.service";
@Controller("leave/requests")
@UseGuards(SessionGuard)
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: LeaveRequestQueryDto) { return this.requests.list(req.user, query); }
  @Post("preview") preview(@Req() req: AuthRequest, @Body() dto: CreateLeaveRequestDto) { return this.requests.preview(req.user, dto); }
  @Get(":id") detail(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.requests.detail(req.user, id); }
  @Post() create(@Req() req: AuthRequest, @Body() dto: CreateLeaveRequestDto) { return this.requests.create(req.user, dto, req.ip); }
  @Post(":id/update") update(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: UpdateLeaveRequestDto) { return this.requests.update(req.user, id, dto, req.ip); }
  @Post(":id/submit") submit(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: SubmitLeaveRequestDto) { return this.requests.submit(req.user, id, dto, req.ip); }
  @Post(":id/approve") approve(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: LeaveRequestActionDto) { return this.requests.transition(req.user, id, "APPROVE", dto, req.ip); }
  @Post(":id/return") returnRequest(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: LeaveRequestActionDto) { return this.requests.transition(req.user, id, "RETURN", dto, req.ip); }
  @Post(":id/reject") reject(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: LeaveRequestActionDto) { return this.requests.transition(req.user, id, "REJECT", dto, req.ip); }
  @Post(":id/cancel") cancel(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: LeaveRequestActionDto) { return this.requests.transition(req.user, id, "CANCEL", dto, req.ip); }
}
