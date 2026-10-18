import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { AttendanceService } from "./attendance.service";
import { AttendanceBoardQuery, AttendanceImportDto, AttendancePageQuery, AttendanceProcessDto, AttendanceProfileDto, AttendancePunchQuery } from "./attendance.dto";
@Controller("attendance")
@UseGuards(SessionGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}
  @Get("context") context(@Req() r: AuthRequest) { return this.attendance.context(r.user); }
  @Post("profiles") profile(@Req() r: AuthRequest, @Body() d: AttendanceProfileDto) { return this.attendance.createProfile(r.user, d, r.ip); }
  @Post("imports")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3, fieldSize: 1024 } }))
  upload(@Req() r: AuthRequest, @Body() d: AttendanceImportDto, @UploadedFile() file?: Express.Multer.File) { return this.attendance.importFile(r.user, d, file, r.ip); }
  @Get("imports") imports(@Req() r: AuthRequest, @Query() q: AttendancePageQuery) { return this.attendance.imports(r.user, q); }
  @Get("imports/:id") batch(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.attendance.batch(r.user, id); }
  @Post("process") process(@Req() r: AuthRequest, @Body() d: AttendanceProcessDto) { return this.attendance.process(r.user, d, r.ip); }
  @Get("board") board(@Req() r: AuthRequest, @Query() q: AttendanceBoardQuery) { return this.attendance.board(r.user, q); }
  @Get("days/:id") day(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.attendance.day(r.user, id, r.ip); }
  @Get("punches") punches(@Req() r: AuthRequest, @Query() q: AttendancePunchQuery) { return this.attendance.punches(r.user, q); }
}
