import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CancelBatchDto, CreateBatchDto, CreateTemplateDto, MarkPaidDto } from "./payroll-output.dto";
import { PayslipsService } from "./payslips.service";
import { SalaryPaymentsService } from "./salary-payments.service";

const attachment = (name: string) => `attachment; filename="${name}"`;

@Controller("payroll")
@UseGuards(SessionGuard)
export class PayrollOutputController {
  constructor(private readonly payslips: PayslipsService, private readonly payments: SalaryPaymentsService) {}
  @Get("sheets/:id/payslips") list(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payslips.list(request.user, id); }
  @Post("sheets/:id/payslips/exports") startExport(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payslips.startExport(request.user, id, request.ip); }
  @Get("sheets/:id/payslips/:employeeId") view(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("employeeId", new ParseUUIDPipe()) employeeId: string) { return this.payslips.view(request.user, id, employeeId, request.ip); }
  @Get("sheets/:id/payslips/:employeeId/pdf") async pdf(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("employeeId", new ParseUUIDPipe()) employeeId: string) {
    const { file, name } = await this.payslips.pdf(request.user, id, employeeId, request.ip);
    return new StreamableFile(file, { type: "application/pdf", disposition: attachment(name) });
  }
  @Get("payslip-exports/:id") exportStatus(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payslips.exportStatus(request.user, id); }
  @Get("payslip-exports/:id/download") async download(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    const { file, name } = await this.payslips.download(request.user, id, request.ip);
    return new StreamableFile(file, { type: "application/zip", disposition: attachment(name) });
  }
  @Get("bank-templates") templates(@Req() request: AuthRequest) { return this.payments.templates(request.user); }
  @Post("bank-templates") createTemplate(@Req() request: AuthRequest, @Body() dto: CreateTemplateDto) { return this.payments.createTemplate(request.user, dto, request.ip); }
  @Get("payment-batches") batches(@Req() request: AuthRequest) { return this.payments.batches(request.user); }
  @Post("payment-batches") createBatch(@Req() request: AuthRequest, @Body() dto: CreateBatchDto) { return this.payments.createBatch(request.user, request.sessionId, dto, request.ip); }
  @Get("payment-batches/:id") batch(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.payments.batch(request.user, id); }
  @Get("payment-batches/:id/file") async file(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Headers("x-reauth-token") token?: string) {
    const { file, name, type } = await this.payments.file(request.user, request.sessionId, id, token, request.ip);
    return new StreamableFile(file, { type, disposition: attachment(name) });
  }
  @Post("payment-batches/:id/paid") paid(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: MarkPaidDto) { return this.payments.markPaid(request.user, id, dto, request.ip); }
  @Post("payment-batches/:id/cancel") cancel(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CancelBatchDto) { return this.payments.cancel(request.user, id, dto, request.ip); }
}
