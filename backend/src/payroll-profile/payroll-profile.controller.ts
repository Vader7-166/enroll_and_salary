import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Matches } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { BankAccountDto, DependentCountQueryDto, DependentDto, DependentVersionDto, IdentityDto, SpecialStatusDto, TaxProfileDto } from "./payroll-profile.dto";
import { PayrollProfileService } from "./payroll-profile.service";

class AsOfQueryDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf!: string; }

@Controller()
@UseGuards(SessionGuard)
export class PayrollProfileController {
  constructor(private readonly profiles: PayrollProfileService) {}
  @Get("payroll-profile/banks") banks() { return this.profiles.banks(); }
  @Get("employees/:id/payroll-profile") profile(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.profiles.profile(request.user, id, request.ip); }
  @Post("employees/:id/payroll-profile/identity") identity(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: IdentityDto) { return this.profiles.saveIdentity(request.user, id, dto, request.ip); }
  @Post("employees/:id/payroll-profile/bank-accounts") bank(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BankAccountDto) { return this.profiles.addBankAccount(request.user, id, dto, request.ip); }
  @Post("employees/:id/payroll-profile/tax-profiles") tax(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: TaxProfileDto) { return this.profiles.addTaxProfile(request.user, id, dto, request.ip); }
  @Post("employees/:id/payroll-profile/special-statuses") special(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: SpecialStatusDto) { return this.profiles.addSpecialStatus(request.user, id, dto, request.ip); }
  @Post("employees/:id/payroll-profile/dependents") dependent(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: DependentDto) { return this.profiles.addDependent(request.user, id, dto, request.ip); }
  @Post("employees/:id/payroll-profile/dependents/:key/versions") dependentVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Param("key", new ParseUUIDPipe()) key: string, @Body() dto: DependentVersionDto) { return this.profiles.addDependentVersion(request.user, id, key, dto, request.ip); }
  @Get("employees/:id/payroll-profile/dependents/count") count(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: DependentCountQueryDto) { return this.profiles.dependentCount(request.user, id, query.month, request.ip); }
  @Get("employees/:id/payroll-profile/at") at(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: AsOfQueryDto) { return this.profiles.statusesAt(request.user, id, query.asOf, request.ip); }
}
