import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CompTimeRequestDto, OvertimePayBucketQueryDto, RatePreviewDto } from "./overtime-pay.dto";
import { OvertimePayService } from "./overtime-pay.service";

@Controller("overtime-pay")
@UseGuards(SessionGuard)
export class OvertimePayController {
  constructor(private readonly overtimePay: OvertimePayService) {}
  @Get("buckets") buckets(@Req() request: AuthRequest, @Query() query: OvertimePayBucketQueryDto) { return this.overtimePay.buckets(request.user, query); }
  @Post("rate-preview") ratePreview(@Req() request: AuthRequest, @Body() dto: RatePreviewDto) { return this.overtimePay.ratePreview(request.user, dto); }
  @Post("comp-time-requests") compTime(@Req() request: AuthRequest, @Body() dto: CompTimeRequestDto) { return this.overtimePay.compTimeRequest(request.user, dto, request.ip); }
}
