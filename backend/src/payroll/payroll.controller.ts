import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { AcknowledgeDto, ApproveDto, LockDto, PeriodQueryDto, ReturnDto, StartRunDto } from "./payroll.dto";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollService } from "./payroll.service";

@Controller("payroll")
@UseGuards(SessionGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService, private readonly approval: PayrollApprovalService) {}
  @Post("sheets/:id/approve") approve(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: ApproveDto) { return this.approval.approve(request.user, id, dto, request.ip); }
  @Post("sheets/:id/return-to-draft") returnToDraft(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: ReturnDto) { return this.approval.returnToDraft(request.user, id, dto, request.ip); }
  @Post("sheets/:id/lock") lock(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: LockDto) { return this.approval.lock(request.user, request.sessionId, id, dto, request.ip); }
  @Get("sheets/:id/history") history(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.approval.history(request.user, id); }
  @Get("sheets/:id/compliance-report.pdf") async report(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return new StreamableFile(await this.approval.complianceReport(request.user, id, request.ip), { type: "application/pdf", disposition: "attachment; filename=\"compliance-report.pdf\"" }); }
  @Get("periods") periods(@Req() request: AuthRequest) { return this.payroll.periods(request.user); }
  @Post("runs") start(@Req() request: AuthRequest, @Body() dto: StartRunDto) { return this.payroll.startRun(request.user, dto, request.ip); }
  @Get("runs") runs(@Req() request: AuthRequest, @Query() query: PeriodQueryDto) { return this.payroll.runs(request.user, query.payrollPeriodId); }
  @Get("runs/:id") run(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payroll.run(request.user, id); }
  @Post("runs/:id/cancel") cancel(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payroll.cancel(request.user, id, request.ip); }
  @Get("sheets") sheetByPeriod(@Req() request: AuthRequest, @Query() query: PeriodQueryDto) { return this.payroll.sheetByPeriod(request.user, query.payrollPeriodId); }
  @Get("sheets/:id") sheet(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payroll.sheet(request.user, id); }
  @Get("sheets/:id/employees/:employeeId") employee(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("employeeId", new ParseUUIDPipe()) employeeId: string) { return this.payroll.employeeLines(request.user, id, employeeId, request.ip); }
  @Get("sheets/:id/compliance") compliance(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payroll.compliance(request.user, id); }
  @Post("sheets/:id/compliance/acknowledge") acknowledge(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: AcknowledgeDto) { return this.payroll.acknowledge(request.user, id, dto, request.ip); }
  @Get("lines/:id/trace") trace(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payroll.trace(request.user, id, request.ip); }
}
