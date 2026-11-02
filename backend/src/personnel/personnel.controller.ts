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
import type { AuthRequest } from "../auth/auth.types";
import { SessionGuard } from "../auth/session.guard";
import {
  AssignmentQueryDto,
  CreateContractAnnexDto,
  CreateContractDto,
  CreateTransferDto,
} from "./personnel.dto";
import { PersonnelService } from "./personnel.service";

@Controller("employees")
@UseGuards(SessionGuard)
export class PersonnelController {
  constructor(private readonly personnel: PersonnelService) {}

  @Get(":id/contracts")
  contracts(@Req() req: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.personnel.contracts(req.user, id, req.ip);
  }

  @Post(":id/contracts")
  createContract(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.personnel.createContract(req.user, id, dto, req.ip);
  }

  @Post(":id/contracts/:contractId/activate")
  activateContract(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("contractId", new ParseUUIDPipe()) contractId: string,
  ) {
    return this.personnel.activateContract(req.user, id, contractId, req.ip);
  }

  @Post(":id/contracts/:contractId/annexes")
  createAnnex(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("contractId", new ParseUUIDPipe()) contractId: string,
    @Body() dto: CreateContractAnnexDto,
  ) {
    return this.personnel.createAnnex(req.user, id, contractId, dto, req.ip);
  }

  @Get(":id/assignments")
  assignments(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: AssignmentQueryDto,
  ) {
    return this.personnel.assignments(req.user, id, query, req.ip);
  }

  @Post(":id/transfers")
  transfer(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.personnel.transfer(req.user, id, dto, req.ip);
  }
}
