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
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CreateEmployeeDto, EmployeeQueryDto } from "./employee.dto";
import { EmployeesService } from "./employees.service";

@Controller("employees")
@UseGuards(SessionGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: EmployeeQueryDto) {
    return this.employees.list(req.user, query, req.ip);
  }
  @Get(":id") detail(
    @Req() req: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.employees.detail(req.user, id, req.ip);
  }
  @Post() create(@Req() req: AuthRequest, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(req.user, dto, req.ip);
  }
}
