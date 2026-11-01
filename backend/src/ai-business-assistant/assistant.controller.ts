import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { BusinessAssistantService } from "./assistant.service";

export class AskDto { @IsString() @MaxLength(2000) question!: string; @IsOptional() @Matches(/^[a-z-]{1,40}$/) pageKey?: string; }
export class PageDto { @IsOptional() @Matches(/^[a-z-]{1,40}$/) pageKey?: string; }

@Controller("ai/business-assistant")
@UseGuards(SessionGuard)
export class BusinessAssistantController {
  constructor(private readonly assistant: BusinessAssistantService) {}
  @Get("context") context(@Req() r: AuthRequest, @Query() q: PageDto) { return this.assistant.context(r.user, q.pageKey ?? null); }
  @Get("guide") guide(@Req() r: AuthRequest, @Query() q: PageDto) { return this.assistant.staticGuide(r.user, q.pageKey ?? null); }
  @Post("answers") answers(@Req() r: AuthRequest, @Body() d: AskDto) { return this.assistant.ask(r.user, r.sessionId, d); }
}
