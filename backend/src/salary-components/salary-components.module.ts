import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SalaryComponentsController } from "./salary-components.controller";
import { SalaryComponentsService } from "./salary-components.service";

@Module({ imports: [AuthModule], controllers: [SalaryComponentsController], providers: [SalaryComponentsService], exports: [SalaryComponentsService] })
export class SalaryComponentsModule {}
