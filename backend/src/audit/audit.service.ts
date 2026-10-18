import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

export interface AuditEvent {
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
  result: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  ipAddress?: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const append = async (db: Prisma.TransactionClient) => {
      // All writers serialize the read-tail + append sequence within their transaction.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210471)::text AS lock`;
      const tail = await db.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { recordHash: true } });
      const occurredAt = new Date();
      const prevHash = tail?.recordHash ?? '0'.repeat(64);
      const body = { actorId: event.actorId ?? null, entityType: event.entityType, entityId: event.entityId,
        action: event.action, result: event.result, occurredAt: occurredAt.toISOString(),
        oldValue: event.oldValue ?? null, newValue: event.newValue ?? null, ipAddress: event.ipAddress ?? null, prevHash };
      const recordHash = createHash('sha256').update(canonicalJson(body)).digest('hex');
      await db.auditLog.create({ data: { ...body, occurredAt, recordHash,
        oldValue: event.oldValue ?? Prisma.JsonNull, newValue: event.newValue ?? Prisma.JsonNull } });
    };
    if (tx) await append(tx);
    else await this.prisma.$transaction(append);
  }
}
