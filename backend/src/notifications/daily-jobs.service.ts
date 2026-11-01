import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

type Job = () => Promise<unknown>;

// 02:00 in Asia/Ho_Chi_Minh (UTC+7, no DST).
const RUN_AT_UTC_HOUR = 19;
const JOB_LOCK = 8210480;

/**
 * In-process daily scheduler (audit chain check, parameter expiry, payment due, notification purge). Jobs run in
 * registration order under a session advisory lock so several API instances never run them concurrently.
 */
@Injectable()
export class DailyJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DailyJobs.name);
  private readonly jobs = new Map<string, Job>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  register(name: string, job: Job) { this.jobs.set(name, job); }

  onApplicationBootstrap() { this.schedule(); }
  onApplicationShutdown() { if (this.timer) clearTimeout(this.timer); }

  private schedule(now = new Date()) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_AT_UTC_HOUR));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    this.timer = setTimeout(() => void this.runAll().finally(() => this.schedule()), next.getTime() - now.getTime());
    this.timer.unref();
  }

  async runAll(): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const [lock] = await this.prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${JOB_LOCK}) AS locked`;
    if (!lock?.locked) return { skipped: "Another instance is running the daily jobs." };
    try {
      for (const [name, job] of this.jobs) {
        try { await job(); results[name] = "OK"; }
        catch (error) { results[name] = "FAILED"; this.logger.error("Daily job " + name + " failed: " + (error instanceof Error ? error.message : String(error))); }
      }
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${JOB_LOCK})::text AS unlocked`;
    }
    return results;
  }
}
