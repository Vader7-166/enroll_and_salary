import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { resolveAuditScope } from './audit-scope';

export interface AuditEvent {
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
  result: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  ipAddress?: string;
  /** Org unit the record belongs to; resolved from the entity when omitted (FR-1.6.4). */
  scopeOrgUnitId?: string | null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}

export interface AuditHashFields {
  actorId: string | null; entityType: string; entityId: string; action: string; result: string; occurredAt: Date;
  oldValue: unknown; newValue: unknown; ipAddress: string | null; prevHash: string; scopeOrgUnitId: string | null;
}

/** Record hash over the canonical fields; the scope joins the hash only when present so pre-scope records still verify. */
export function auditRecordHash(fields: AuditHashFields): string {
  const body = { actorId: fields.actorId, entityType: fields.entityType, entityId: fields.entityId, action: fields.action, result: fields.result,
    occurredAt: fields.occurredAt.toISOString(), oldValue: fields.oldValue ?? null, newValue: fields.newValue ?? null, ipAddress: fields.ipAddress,
    prevHash: fields.prevHash, scopeOrgUnitId: fields.scopeOrgUnitId ?? undefined };
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const append = async (db: Prisma.TransactionClient) => {
      const scopeOrgUnitId = event.scopeOrgUnitId !== undefined ? event.scopeOrgUnitId : await resolveAuditScope(db, event);
      // All writers serialize the read-tail + append sequence within their transaction.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210471)::text AS lock`;
      const tail = await db.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { recordHash: true } });
      const occurredAt = new Date();
      const prevHash = tail?.recordHash ?? '0'.repeat(64);
      // Round-trip through JSON so the hash covers exactly what jsonb stores (Dates become strings, undefined drops).
      const oldValue = event.oldValue === undefined ? null : JSON.parse(JSON.stringify(event.oldValue));
      const newValue = event.newValue === undefined ? null : JSON.parse(JSON.stringify(event.newValue));
      const fields = { actorId: event.actorId ?? null, entityType: event.entityType, entityId: event.entityId, action: event.action,
        result: event.result, occurredAt, oldValue, newValue, ipAddress: event.ipAddress ?? null, prevHash, scopeOrgUnitId };
      const recordHash = auditRecordHash(fields);
      await db.auditLog.create({ data: { ...fields, recordHash,
        oldValue: oldValue ?? Prisma.JsonNull, newValue: newValue ?? Prisma.JsonNull } });
    };
    if (tx) await append(tx);
    else await this.prisma.$transaction(append);
  }
}
