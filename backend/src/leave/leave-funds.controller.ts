import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { LeaveFundsService } from "./leave-funds.service";
import { AdjustLeaveDto, LeaveFundAsOfDto, LeaveFundQueryDto, RecalculateLeaveDto, TransferLeaveDto } from "./leave-funds.dto";

@Controller("leave")
@UseGuards(SessionGuard)
export class LeaveFundsController {
  constructor(private readonly funds: LeaveFundsService) {}
  @Get("employees") employees(@Req() request: AuthRequest, @Query() query: LeaveFundQueryDto) {
    return this.funds.employees(request.user, query);
  }
  @Get("balances") list(@Req() request: AuthRequest, @Query() query: LeaveFundQueryDto) {
    return this.funds.list(request.user, query);
  }
  @Get("balances/:employeeId/:year") detail(@Req() request: AuthRequest, @Param("employeeId", new ParseUUIDPipe()) employeeId: string, @Param("year", ParseIntPipe) year: number, @Query() query: LeaveFundAsOfDto) {
    return this.funds.detail(request.user, employeeId, year, query.asOf);
  }
  @Post("balances/:employeeId/:year/recalculate") recalculate(@Req() request: AuthRequest, @Param("employeeId", new ParseUUIDPipe()) employeeId: string, @Param("year", ParseIntPipe) year: number, @Body() dto: RecalculateLeaveDto) {
    return this.funds.recalculate(request.user, employeeId, year, dto, request.ip);
  }
  @Post("balances/:employeeId/:year/adjust") adjust(@Req() request: AuthRequest, @Param("employeeId", new ParseUUIDPipe()) employeeId: string, @Param("year", ParseIntPipe) year: number, @Body() dto: AdjustLeaveDto) {
    return this.funds.adjust(request.user, employeeId, year, dto, request.ip);
  }
  @Post("balances/:employeeId/:year/carry") carry(@Req() request: AuthRequest, @Param("employeeId", new ParseUUIDPipe()) employeeId: string, @Param("year", ParseIntPipe) year: number, @Body() dto: TransferLeaveDto) {
    return this.funds.transfer(request.user, employeeId, year, "CARRY", dto, request.ip);
  }
  @Post("balances/:employeeId/:year/advance") advance(@Req() request: AuthRequest, @Param("employeeId", new ParseUUIDPipe()) employeeId: string, @Param("year", ParseIntPipe) year: number, @Body() dto: TransferLeaveDto) {
    return this.funds.transfer(request.user, employeeId, year, "ADVANCE", dto, request.ip);
  }
}
