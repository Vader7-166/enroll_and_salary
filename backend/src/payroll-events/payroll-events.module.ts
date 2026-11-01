import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PayrollSourceEvents } from "./payroll-source-events.service";

@Module({ imports: [AuditModule], providers: [PayrollSourceEvents], exports: [PayrollSourceEvents] })
export class PayrollEventsModule {}
