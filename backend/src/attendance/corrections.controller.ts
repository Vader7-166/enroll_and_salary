import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { CorrectionsService } from "./corrections.service";
import { CorrectionActionDto, CorrectionQueryDto, CorrectionTargetQueryDto, CreateCorrectionDto, UpdateCorrectionDto } from "./correction.dto";
@Controller("attendance/corrections")
@UseGuards(SessionGuard)
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}
  @Get() list(@Req() r:AuthRequest,@Query() q:CorrectionQueryDto){return this.corrections.list(r.user,q);}
  @Get("targets") targets(@Req() r:AuthRequest,@Query() q:CorrectionTargetQueryDto){return this.corrections.targets(r.user,q);}
  @Get(":id") detail(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string){return this.corrections.detail(r.user,id);}
  @Post() create(@Req() r:AuthRequest,@Body() d:CreateCorrectionDto){return this.corrections.create(r.user,d,r.ip);}
  @Post(":id/update") update(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Body() d:UpdateCorrectionDto){return this.corrections.update(r.user,id,d,r.ip);}
  @Post(":id/submit") submit(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Body() d:CorrectionActionDto){return this.corrections.action(r.user,id,"submit",d,r.ip);}
  @Post(":id/approve") approve(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Body() d:CorrectionActionDto){return this.corrections.action(r.user,id,"approve",d,r.ip);}
  @Post(":id/return") return(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Body() d:CorrectionActionDto){return this.corrections.action(r.user,id,"return",d,r.ip);}
  @Post(":id/reject") reject(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Body() d:CorrectionActionDto){return this.corrections.action(r.user,id,"reject",d,r.ip);}
  @Post(":id/evidence") @UseInterceptors(FileInterceptor("file",{limits:{fileSize:5242880,files:1,fields:0}}))
  upload(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@UploadedFile() file?:Express.Multer.File){return this.corrections.upload(r.user,id,file,r.ip);}
  @Get(":id/evidence/:evidenceId") async evidence(@Req() r:AuthRequest,@Param("id",new ParseUUIDPipe()) id:string,@Param("evidenceId",new ParseUUIDPipe()) evidenceId:string){
    const file=await this.corrections.evidence(r.user,id,evidenceId,r.ip);
    return new StreamableFile(Buffer.from(file.content),{type:file.contentType,disposition:"attachment; filename*=UTF-8''"+encodeURIComponent(file.fileName),length:file.size});
  }
}
