import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateSalaryDecisionDto, RetroCandidateActionDto, RetroCandidateQueryDto, SalaryTimelineQueryDto } from "./salary-decisions.dto";
import { SalaryDecisionsService } from "./salary-decisions.service";

@Controller()
@UseGuards(SessionGuard)
export class SalaryDecisionsController {
  constructor(private readonly decisions: SalaryDecisionsService) {}
  @Get("employees/:id/salary-decisions") list(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.decisions.list(request.user, id); }
  @Post("employees/:id/salary-decisions") create(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CreateSalaryDecisionDto) { return this.decisions.create(request.user, id, dto, request.ip); }
  @Get("employees/:id/salary-timeline") timeline(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: SalaryTimelineQueryDto) { return this.decisions.timeline(request.user, id, query.from, query.to); }
  @Get("salary-decisions/retro-candidates") retro(@Req() request: AuthRequest, @Query() query: RetroCandidateQueryDto) { return this.decisions.retroCandidates(request.user, query); }
  @Post("salary-decisions/retro-candidates/:id/dismiss") dismiss(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: RetroCandidateActionDto) { return this.decisions.dismissRetroCandidate(request.user, id, dto, request.ip); }
}
