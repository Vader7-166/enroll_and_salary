import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateOvertimeDto, OvertimeActionDto, OvertimeMembersQueryDto, OvertimeQueryDto, UpdateOvertimeDto } from "./overtime.dto";
import { OvertimeService } from "./overtime.service";
@Controller("overtime")
@UseGuards(SessionGuard)
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}
  @Get("context") context(@Req() r: AuthRequest) { return this.overtime.context(r.user); }
  @Get("members") members(@Req() r: AuthRequest, @Query() q: OvertimeMembersQueryDto) { return this.overtime.members(r.user, q); }
  @Get("requests") list(@Req() r: AuthRequest, @Query() q: OvertimeQueryDto) { return this.overtime.list(r.user, q); }
  @Get("requests/:id") detail(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.overtime.detail(r.user, id); }
  @Post("requests") create(@Req() r: AuthRequest, @Body() d: CreateOvertimeDto) { return this.overtime.create(r.user, d, r.ip); }
  @Post("requests/:id/update") update(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: UpdateOvertimeDto) { return this.overtime.update(r.user, id, d, r.ip); }
  @Post("requests/:id/submit") submit(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: OvertimeActionDto) { return this.overtime.transition(r.user, id, "SUBMIT", d, r.ip); }
  @Post("requests/:id/approve") approve(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: OvertimeActionDto) { return this.overtime.transition(r.user, id, "APPROVE", d, r.ip); }
  @Post("requests/:id/return") returnRequest(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: OvertimeActionDto) { return this.overtime.transition(r.user, id, "RETURN", d, r.ip); }
  @Post("requests/:id/reject") reject(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: OvertimeActionDto) { return this.overtime.transition(r.user, id, "REJECT", d, r.ip); }
  @Post("requests/:id/cancel") cancel(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: OvertimeActionDto) { return this.overtime.transition(r.user, id, "CANCEL", d, r.ip); }
}
