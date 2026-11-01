import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";
import { SessionGuard } from "../../auth/session.guard";
import type { AuthRequest } from "../../auth/auth.types";
import { AbsenceRateService } from "../absence-rate/absence-rate.service";
import { SicknessMaternityService, type RecordInput } from "./sickness-maternity.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class BenefitPaymentDto { @IsInt() @Min(1) revision!: number; @Matches(/^\d{1,15}$/) amount!: string; @Matches(DATE) paidDate!: string; @IsString() @Matches(/\S/) @MaxLength(200) reference!: string; }
export class BenefitQueryDto { @IsOptional() @IsUUID() employeeId?: string; @IsOptional() @Matches(/^\d{4}$/) year?: string; }
export class AbsenceQueryDto { @IsUUID() workshopOrgUnitId!: string; @Matches(DATE) dateFrom!: string; @Matches(DATE) dateTo!: string; }

@Controller("leave")
@UseGuards(SessionGuard)
export class SicknessMaternityController {
  constructor(private readonly records: SicknessMaternityService, private readonly absence: AbsenceRateService) {}
  @Get("sickness-maternity") list(@Req() r: AuthRequest, @Query() q: BenefitQueryDto) { return this.records.list(r.user, q); }
  @Post("sickness-maternity") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5_242_880, files: 1, fields: 12 } }))
  create(@Req() r: AuthRequest, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: RecordInput) { return this.records.create(r.user, file, body, r.ip); }
  @Get("sickness-maternity/:id") detail(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.records.detail(r.user, id); }
  @Post("sickness-maternity/:id/payment") pay(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: BenefitPaymentDto) { return this.records.pay(r.user, id, d, r.ip); }
  @Get("sickness-maternity/:id/evidence")
  async evidence(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    const file = await this.records.evidence(r.user, id, r.ip);
    return new StreamableFile(file.content, { type: file.contentType, disposition: "attachment; filename*=UTF-8''" + encodeURIComponent(file.fileName), length: file.content.length });
  }
  @Get("absence-rate") absenceRate(@Req() r: AuthRequest, @Query() q: AbsenceQueryDto) { return this.absence.rate(r.user, q); }
}
