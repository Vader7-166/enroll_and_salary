import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import {
  CreateParameterDto,
  CreatePeriodDto,
  CreatePolicyDto,
  OpenPeriodDto,
  ParameterQueryDto,
  PeriodPreviewQueryDto,
  PolicyQueryDto,
  ResolvePolicyQueryDto,
} from "./settings.dto";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("parameters")
  listParameters(@Req() req: AuthRequest, @Query() query: ParameterQueryDto) {
    return this.settings.listParameters(req.user, query);
  }

  @Post("parameters")
  createParameter(@Req() req: AuthRequest, @Body() dto: CreateParameterDto) {
    return this.settings.createParameter(req.user, dto, req.ip);
  }

  @Get("policies/resolve")
  resolvePolicy(@Req() req: AuthRequest, @Query() query: ResolvePolicyQueryDto) {
    return this.settings.resolvePolicyForUser(req.user, query);
  }

  @Get("policies")
  listPolicies(@Req() req: AuthRequest, @Query() query: PolicyQueryDto) {
    return this.settings.listPolicies(req.user, query);
  }

  @Post("policies")
  createPolicy(@Req() req: AuthRequest, @Body() dto: CreatePolicyDto) {
    return this.settings.createPolicy(req.user, dto, req.ip);
  }
}

@Controller("periods")
@UseGuards(SessionGuard)
export class PeriodsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    return this.settings.listPeriods(req.user);
  }

  @Get("preview")
  preview(@Req() req: AuthRequest, @Query() query: PeriodPreviewQueryDto) {
    return this.settings.previewPeriod(req.user, query);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: CreatePeriodDto) {
    return this.settings.createPeriod(req.user, dto, req.ip);
  }

  @Post(":id/open")
  open(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: OpenPeriodDto,
  ) {
    return this.settings.openPeriod(req.user, id, dto, req.ip);
  }
}
