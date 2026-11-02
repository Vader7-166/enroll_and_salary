import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { InsurancePreviewDto, InsuranceRateDto, InsuranceRateQueryDto } from "./social-insurance.dto";
import { SocialInsuranceService } from "./social-insurance.service";

@Controller("social-insurance")
@UseGuards(SessionGuard)
export class SocialInsuranceController {
  constructor(private readonly insurance: SocialInsuranceService) {}
  @Get("rates") rates(@Req() request: AuthRequest, @Query() query: InsuranceRateQueryDto) { return this.insurance.rates(request.user, query); }
  @Post("rates") addRate(@Req() request: AuthRequest, @Body() dto: InsuranceRateDto) { return this.insurance.addRate(request.user, dto, request.ip); }
  @Post("preview") preview(@Req() request: AuthRequest, @Body() dto: InsurancePreviewDto) { return this.insurance.preview(request.user, dto); }
}
