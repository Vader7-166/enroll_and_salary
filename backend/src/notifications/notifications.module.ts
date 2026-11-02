import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DailyJobs } from "./daily-jobs.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, DailyJobs],
  exports: [NotificationsService, DailyJobs],
})
export class NotificationsModule {
  constructor(notifications: NotificationsService, jobs: DailyJobs) {
    jobs.register("notification-purge", () => notifications.purge());
  }
}
