import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreatePayrollConfigurationDto, CreatePayrollConfigurationVersionDto, PayrollConfigurationDetailQueryDto, PayrollConfigurationQueryDto, PreviewContextQueryDto, PreviewPayrollConfigurationDto } from "./payroll-configuration.dto";
import { PayrollConfigurationService } from "./payroll-configuration.service";

@Controller("payroll-configuration")
@UseGuards(SessionGuard)
export class PayrollConfigurationController {
  constructor(private readonly configurations: PayrollConfigurationService) {}
  @Get("context") context(@Req() request: AuthRequest) { return this.configurations.context(request.user); }
  @Get("preview-context") previewContext(@Req() request: AuthRequest, @Query() query: PreviewContextQueryDto) { return this.configurations.previewContext(request.user, query); }
  @Post("preview") preview(@Req() request: AuthRequest, @Body() dto: PreviewPayrollConfigurationDto) { return this.configurations.preview(request.user, dto); }
  @Get() list(@Req() request: AuthRequest, @Query() query: PayrollConfigurationQueryDto) { return this.configurations.list(request.user, query); }
  @Get(":id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: PayrollConfigurationDetailQueryDto) { return this.configurations.detail(request.user, id, query); }
  @Post() create(@Req() request: AuthRequest, @Body() dto: CreatePayrollConfigurationDto) { return this.configurations.create(request.user, dto, request.ip); }
  @Post(":id/versions") createVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreatePayrollConfigurationVersionDto) { return this.configurations.createVersion(request.user, id, dto, request.ip); }
}
