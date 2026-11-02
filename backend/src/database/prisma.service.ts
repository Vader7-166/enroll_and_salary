import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { queryMetrics } from '../common/cache/query-metrics';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const metrics = config.get<string>('QUERY_METRICS') === 'true';
    super({ datasourceUrl: config.getOrThrow<string>('DATABASE_URL'), ...(metrics ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}) });
    if (metrics) {
      const client = this as unknown as { $on(event: 'query', listener: (event: Prisma.QueryEvent) => void): void };
      client.$on('query', (event) => { queryMetrics.queries++; queryMetrics.queryMs += event.duration; });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
