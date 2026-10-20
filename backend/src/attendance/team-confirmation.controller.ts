import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { TeamConfirmationService } from "./team-confirmation.service";
import { SourceCoverageDto, TeamConfirmationDto, TeamPeriodQuery, TeamReviewQuery } from "./team-confirmation.dto";
@Controller("attendance/team-confirmations")
@UseGuards(SessionGuard)
export class TeamConfirmationController {
  constructor(private readonly confirmations: TeamConfirmationService) {}
  @Get("teams") teams(@Req() r: AuthRequest,@Query() q: TeamPeriodQuery) {return this.confirmations.teams(r.user,q.periodId);}
  @Get("review") review(@Req() r: AuthRequest,@Query() q: TeamReviewQuery) {return this.confirmations.review(r.user,q);}
  @Post("coverage") coverage(@Req() r: AuthRequest,@Body() d: SourceCoverageDto) {return this.confirmations.coverage(r.user,d,r.ip);}
  @Post() confirm(@Req() r: AuthRequest,@Body() d: TeamConfirmationDto) {return this.confirmations.confirm(r.user,d,r.ip);}
}
