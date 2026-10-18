import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";

import { ScopeService } from "../organization/scope.service";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";
@Module({ imports: [AuthModule], controllers: [ShiftsController], providers: [ShiftsService, ScopeService] })
export class ShiftsModule {}
