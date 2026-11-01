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
import { OvertimeModule } from "./overtime/overtime.module";
import { LeaveModule } from "./leave/leave.module";
import { SalaryComponentsModule } from "./salary-components/salary-components.module";
import { PayrollConfigurationModule } from "./payroll-configuration/payroll-configuration.module";
import { EmployeePayPlansModule } from "./employee-pay-plans/employee-pay-plans.module";
import { PayrollInputsModule } from "./payroll-inputs/payroll-inputs.module";
import { OvertimePayModule } from "./overtime-pay/overtime-pay.module";
import { PayrollProfileModule } from "./payroll-profile/payroll-profile.module";
import { SalaryDecisionsModule } from "./salary-decisions/salary-decisions.module";
import { SocialInsuranceModule } from "./social-insurance/social-insurance.module";
import { PitModule } from "./personal-income-tax/pit.module";
import { PayrollModule } from "./payroll/payroll.module";
import { PayrollOutputModule } from "./payroll-output/payroll-output.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AuditSearchModule } from "./audit/audit-search.module";
import { WelfareModule } from "./welfare/welfare.module";
import { ReportsModule } from "./reports/reports.module";
import { BusinessAssistantModule } from "./ai-business-assistant/assistant.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule, AuditModule, NotificationsModule, AuthModule, EmployeesModule, PersonnelModule, SettingsModule, ShiftsModule, AttendanceModule, OvertimeModule, LeaveModule, SalaryComponentsModule, PayrollConfigurationModule, EmployeePayPlansModule, PayrollInputsModule, OvertimePayModule, PayrollProfileModule, SalaryDecisionsModule, SocialInsuranceModule, PitModule, PayrollModule, PayrollOutputModule, AuditSearchModule, WelfareModule, ReportsModule, BusinessAssistantModule],
  controllers: [HealthController],
})
export class AppModule {}
