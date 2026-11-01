import { Controller, Get, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { AuditQueryDto } from "./audit-search.dto";
import { AuditSearchService } from "./audit-search.service";

@Controller("audit")
@UseGuards(SessionGuard)
export class AuditSearchController {
  constructor(private readonly search: AuditSearchService) {}

  @Get("logs") logs(@Req() request: AuthRequest, @Query() query: AuditQueryDto) { return this.search.search(request.user, query); }
  @Get("facets") facets(@Req() request: AuthRequest) { return this.search.facets(request.user); }

  @Get("logs/export")
  async export(@Req() request: AuthRequest, @Query() query: AuditQueryDto) {
    const file = await this.search.export(request.user, query, request.ip);
    return new StreamableFile(file, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"nhat-ky-kiem-toan.xlsx\"", length: file.length });
  }

  @Get("integrity-checks") checks(@Req() request: AuthRequest) { return this.search.checks(request.user); }
  @Post("integrity-checks") run(@Req() request: AuthRequest) { return this.search.runCheck(request.user, request.ip); }
}
