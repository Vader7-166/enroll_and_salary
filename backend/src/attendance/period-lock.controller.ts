import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { AttendancePeriodLockDto, AttendancePeriodLockQuery, AttendancePeriodReturnDto } from "./period-lock.dto";
import { AttendancePeriodLockService } from "./period-lock.service";

@Controller("attendance/period-locks")
@UseGuards(SessionGuard)
export class AttendancePeriodLockController {
  constructor(private readonly locks: AttendancePeriodLockService) {}

  @Get("review")
  review(@Req() request: AuthRequest, @Query() query: AttendancePeriodLockQuery) {
    return this.locks.review(request.user, query.periodId);
  }

  @Post()
  lock(@Req() request: AuthRequest, @Body() dto: AttendancePeriodLockDto) {
    return this.locks.lock(request.user, dto, request.ip);
  }

  @Post("return")
  returned(@Req() request: AuthRequest, @Body() dto: AttendancePeriodReturnDto) {
    return this.locks.return(request.user, dto, request.ip);
  }
}
