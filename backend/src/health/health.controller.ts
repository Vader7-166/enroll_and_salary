import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check() {
    let connected = false;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 AS result`;
      connected = rows[0]?.result === 1;
    } catch {
      // Expose availability, never database credentials or driver error details.
    }
    const health = {
      status: connected ? 'ok' : 'error',
      service: 'hrtp-api',
      database: { status: connected ? 'up' : 'down' },
      checkedAt: new Date().toISOString(),
    };
    if (!connected) throw new ServiceUnavailableException(health);
    return health;
  }
}
