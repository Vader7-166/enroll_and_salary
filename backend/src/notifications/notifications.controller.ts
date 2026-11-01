import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { MarkReadDto, NotificationQueryDto } from "./notifications.dto";
import { NotificationsService } from "./notifications.service";
import { DailyJobs } from "./daily-jobs.service";

@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly jobs: DailyJobs) {}

  @Get() list(@Req() request: AuthRequest, @Query() query: NotificationQueryDto) { return this.notifications.list(request.user, query); }
  @Get("unread-count") async unread(@Req() request: AuthRequest) { return { unread: await this.notifications.unreadCount(request.user) }; }
  @Post("read") read(@Req() request: AuthRequest, @Body() dto: MarkReadDto) { return this.notifications.markRead(request.user, dto.all ? "ALL" : dto.ids ?? []); }

  /** Runs the daily jobs now (operations / acceptance runs); same work as the 02:00 schedule. */
  @Post("daily-jobs/run")
  runDailyJobs(@Req() request: AuthRequest) {
    if (!request.user.roles.includes("AD") || !request.user.permissions.includes("settings.manage")) throw new ForbiddenException("Chỉ quản trị hệ thống được chạy tác vụ định kỳ.");
    return this.jobs.runAll();
  }
}
