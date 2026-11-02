import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { PayrollActionDto, PayrollBatchDto, PayrollConfirmedQueryDto, PayrollListQueryDto, PayrollPeriodDto } from "./payroll-inputs.dto";
import { PayrollInputsService } from "./payroll-inputs.service";

@Controller("payroll-inputs")
@UseGuards(SessionGuard)
export class PayrollInputsController {
  constructor(private readonly inputs: PayrollInputsService) {}
  @Get("context") context(@Req() request: AuthRequest) { return this.inputs.context(request.user); }
  @Get("periods") periods(@Req() request: AuthRequest) { return this.inputs.periods(request.user); }
  @Post("periods") createPeriod(@Req() request: AuthRequest, @Body() dto: PayrollPeriodDto) { return this.inputs.createPeriod(request.user, dto, request.ip); }
  @Get("template") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=payroll-inputs-template.csv") template(@Req() request: AuthRequest) { return new StreamableFile(this.inputs.template(request.user)); }
  @Post("import") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5_242_880, files: 1, fields: 1, fieldSize: 100_000 } }))
  import(@Req() request: AuthRequest, @UploadedFile() file: Express.Multer.File | undefined, @Body("metadata") metadata: string) { return this.inputs.importCsv(request.user, file, metadata, request.ip); }
  @Get("confirmed") confirmed(@Req() request: AuthRequest, @Query() query: PayrollConfirmedQueryDto) { return this.inputs.confirmed(request.user, query.payrollPeriodId); }
  @Get() list(@Req() request: AuthRequest, @Query() query: PayrollListQueryDto) { return this.inputs.list(request.user, query); }
  @Post() create(@Req() request: AuthRequest, @Body() dto: PayrollBatchDto) { return this.inputs.create(request.user, dto, request.ip); }
  @Get(":id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.inputs.detail(request.user, id); }
  @Post(":id/validate") validate(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: PayrollActionDto) { return this.inputs.validate(request.user, id, dto, request.ip); }
  @Post(":id/confirm") confirm(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: PayrollActionDto) { return this.inputs.confirm(request.user, id, dto, request.ip); }
  @Post(":id/return") returned(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: PayrollActionDto) { return this.inputs.returned(request.user, id, dto, request.ip); }
  @Post(":id/evidence") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5_242_880, files: 1, fields: 0 } }))
  upload(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @UploadedFile() file?: Express.Multer.File) { return this.inputs.upload(request.user, id, file, request.ip); }
  @Get(":id/evidence/:evidenceId") async evidence(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("evidenceId", new ParseUUIDPipe()) evidenceId: string) { const file = await this.inputs.evidence(request.user, id, evidenceId, request.ip); return new StreamableFile(file.content, { type: file.contentType, disposition: "attachment; filename*=UTF-8''" + encodeURIComponent(file.fileName), length: file.size }); }
}
