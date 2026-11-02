import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateSalaryComponentDto, CreateSalaryComponentVersionDto, SalaryComponentQueryDto } from "./salary-components.dto";
import { SalaryComponentsService } from "./salary-components.service";

@Controller("salary-components")
@UseGuards(SessionGuard)
export class SalaryComponentsController {
  constructor(private readonly components: SalaryComponentsService) {}
  @Get("context") context(@Req() request: AuthRequest) { return this.components.context(request.user); }
  @Get() list(@Req() request: AuthRequest, @Query() query: SalaryComponentQueryDto) { return this.components.list(request.user, query); }
  @Get(":id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: SalaryComponentQueryDto) { return this.components.detail(request.user, id, query); }
  @Post() create(@Req() request: AuthRequest, @Body() dto: CreateSalaryComponentDto) { return this.components.create(request.user, dto, request.ip); }
  @Post(":id/versions") createVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreateSalaryComponentVersionDto) { return this.components.createVersion(request.user, id, dto, request.ip); }
}
