import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { AdjustWithholdingDto, GrossUpDto, PitPreviewDto, SaveWithholdingDto, TaxRulesetDto, WithholdingQueryDto } from "./pit.dto";
import { PitService } from "./pit.service";

@Controller("pit")
@UseGuards(SessionGuard)
export class PitController {
  constructor(private readonly pit: PitService) {}
  @Get("rulesets") rulesets(@Req() request: AuthRequest) { return this.pit.rulesets(request.user); }
  @Post("rulesets") addRuleset(@Req() request: AuthRequest, @Body() dto: TaxRulesetDto) { return this.pit.addRuleset(request.user, dto, request.ip); }
  @Post("preview") preview(@Req() request: AuthRequest, @Body() dto: PitPreviewDto) { return this.pit.preview(request.user, dto); }
  @Post("gross-up-preview") grossUp(@Req() request: AuthRequest, @Body() dto: GrossUpDto) { return this.pit.grossUpPreview(request.user, dto); }
  @Get("withholdings") withholdings(@Req() request: AuthRequest, @Query() query: WithholdingQueryDto) { return this.pit.withholdings(request.user, query); }
  @Post("withholdings") save(@Req() request: AuthRequest, @Body() dto: SaveWithholdingDto) { return this.pit.saveWithholding(request.user, dto, request.ip); }
  @Post("withholdings/:id/file") file(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.pit.file(request.user, id, request.ip); }
  @Post("withholdings/:id/adjustments") adjust(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: AdjustWithholdingDto) { return this.pit.adjust(request.user, id, dto, request.ip); }
}
