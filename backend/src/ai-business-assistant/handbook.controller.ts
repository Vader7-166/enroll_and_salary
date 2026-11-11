import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { BusinessAssistantService } from "./assistant.service";

@Controller("handbook")
@UseGuards(SessionGuard)
export class HandbookController {
  constructor(private readonly assistant: BusinessAssistantService) {}

  @Get()
  catalog(@Req() request: AuthRequest) {
    return this.assistant.handbookCatalog(request.user);
  }
}
