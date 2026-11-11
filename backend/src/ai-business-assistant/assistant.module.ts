import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BusinessAssistantController } from "./assistant.controller";
import { HandbookController } from "./handbook.controller";
import { BusinessAssistantService } from "./assistant.service";

@Module({ imports: [AuthModule], controllers: [BusinessAssistantController, HandbookController], providers: [BusinessAssistantService] })
export class BusinessAssistantModule {}
