import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateLeavePolicyDto, CreateLeavePolicyVersionDto, CreateLeaveTypeDto, CreateLeaveTypeVersionDto, LeaveCatalogQueryDto } from "./leave-catalog.dto";
import { LeaveCatalogService } from "./leave-catalog.service";

@Controller("leave")
@UseGuards(SessionGuard)
export class LeaveCatalogController {
  constructor(private readonly catalog: LeaveCatalogService) {}
  @Get("context") context(@Req() request: AuthRequest) { return this.catalog.context(request.user); }
  @Get("types") types(@Req() request: AuthRequest, @Query() query: LeaveCatalogQueryDto) { return this.catalog.types(request.user, query); }
  @Get("policies") policies(@Req() request: AuthRequest, @Query() query: LeaveCatalogQueryDto) { return this.catalog.policies(request.user, query); }
  @Post("types") createType(@Req() request: AuthRequest, @Body() dto: CreateLeaveTypeDto) { return this.catalog.createType(request.user, dto, request.ip); }
  @Post("types/:id/versions") createTypeVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreateLeaveTypeVersionDto) { return this.catalog.createTypeVersion(request.user, id, dto, request.ip); }
  @Post("policies") createPolicy(@Req() request: AuthRequest, @Body() dto: CreateLeavePolicyDto) { return this.catalog.createPolicy(request.user, dto, request.ip); }
  @Post("policies/:id/versions") createPolicyVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreateLeavePolicyVersionDto) { return this.catalog.createPolicyVersion(request.user, id, dto, request.ip); }
}
