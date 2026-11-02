import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { OvertimeController } from "./overtime.controller";
import { OvertimeService } from "./overtime.service";
@Module({ imports: [AuthModule], controllers: [OvertimeController], providers: [OvertimeService, ScopeService] })
export class OvertimeModule {}
