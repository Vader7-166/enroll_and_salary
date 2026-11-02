import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { WorkshopClosureService } from "./workshop-closure.service";
import { WorkshopClosureDto, WorkshopPeriodQuery, WorkshopReviewQuery, WorkshopReturnDto } from "./workshop-closure.dto";
@Controller("attendance/workshop-closures")
@UseGuards(SessionGuard)
export class WorkshopClosureController {
  constructor(private readonly closures: WorkshopClosureService) {}
  @Get("workshops") workshops(@Req() r:AuthRequest,@Query() q:WorkshopPeriodQuery) { return this.closures.workshops(r.user,q.periodId); }
  @Get("review") review(@Req() r:AuthRequest,@Query() q:WorkshopReviewQuery) { return this.closures.review(r.user,q); }
  @Post() close(@Req() r:AuthRequest,@Body() d:WorkshopClosureDto) { return this.closures.close(r.user,d,r.ip); }
  @Post("return") returned(@Req() r:AuthRequest,@Body() d:WorkshopReturnDto) { return this.closures.return(r.user,d,r.ip); }
}
