import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { BonusService } from "./bonus/bonus.service";
import { AllocationsDto, CancelBonusDto, ConfirmRetroDto, CreateBonusDto, RetroCalculateDto, RevisionDto, StatusQueryDto } from "./payroll-adjustments.dto";
import { RetroService } from "./retro/retro.service";

@Controller("payroll")
@UseGuards(SessionGuard)
export class PayrollAdjustmentsController {
  constructor(private readonly bonuses: BonusService, private readonly retro: RetroService) {}
  @Get("bonuses") list(@Req() request: AuthRequest) { return this.bonuses.list(request.user); }
  @Post("bonuses") create(@Req() request: AuthRequest, @Body() dto: CreateBonusDto) { return this.bonuses.create(request.user, dto, request.ip); }
  @Get("bonuses/:id") get(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.bonuses.get(request.user, id); }
  @Post("bonuses/:id/allocations") allocate(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: AllocationsDto) { return this.bonuses.addAllocations(request.user, id, dto, request.ip); }
  @Delete("bonuses/:id/allocations/:allocationId") remove(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("allocationId", new ParseUUIDPipe()) allocationId: string) { return this.bonuses.removeAllocation(request.user, id, allocationId, request.ip); }
  @Post("bonuses/:id/confirm") confirm(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: RevisionDto) { return this.bonuses.confirm(request.user, id, dto, request.ip); }
  @Post("bonuses/:id/cancel") cancel(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: CancelBonusDto) { return this.bonuses.cancel(request.user, id, dto, request.ip); }
  @Get("retro-candidates") candidates(@Req() request: AuthRequest, @Query() query: StatusQueryDto) { return this.retro.candidates(request.user, query.status); }
  @Post("retro-candidates/:id/calculate") calculate(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: RetroCalculateDto) { return this.retro.calculate(request.user, id, dto, request.ip); }
  @Get("retro-calculations/:id") calculation(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.retro.view(request.user, id); }
  @Post("retro-calculations/:id/confirm") confirmRetro(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: ConfirmRetroDto) { return this.retro.confirm(request.user, request.sessionId, id, dto, request.ip); }
  @Post("retro-calculations/:id/discard") discard(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.retro.discard(request.user, id); }
  @Get("adjustments") adjustments(@Req() request: AuthRequest, @Query() query: StatusQueryDto) { return this.retro.adjustments(request.user, query.status); }
}
