import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthController } from './health/health.controller';
import { PersonnelModule } from "./personnel/personnel.module";
import { SettingsModule } from "./settings/settings.module";
import { ShiftsModule } from "./shifts/shifts.module";
import { AttendanceModule } from "./attendance/attendance.module";
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule, AuditModule, AuthModule, EmployeesModule, PersonnelModule, SettingsModule, ShiftsModule, AttendanceModule],
  controllers: [HealthController],
})
export class AppModule {}
