import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ScopeService } from "../organization/scope.service";
import { PersonnelController } from "./personnel.controller";
import { PersonnelService } from "./personnel.service";

@Module({
  imports: [AuthModule],
  controllers: [PersonnelController],
  providers: [PersonnelService, ScopeService],
})
export class PersonnelModule {}
