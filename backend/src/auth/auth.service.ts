import { randomBytes, createHash } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, EmployeeStatus, Prisma, RoleCode } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { businessDate } from './business-date';
import type { AuthUser } from './auth.types';
import { verifyPassword } from './password';
import { ScopeService } from '../organization/scope.service';

const AUTH_FAILURE = { code: 'AUTH_INVALID', message: 'Invalid username or password.' };
const SESSION_FAILURE = { code: 'AUTH_REQUIRED', message: 'Authentication is required.' };
const ACCOUNT_FAILURE = { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is unavailable.' };

type LoginResult = { token: string; user: AuthUser };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async login(usernameInput: unknown, passwordInput: unknown, ipAddress?: string): Promise<LoginResult> {
    const username = this.loginUsername(usernameInput);
    const password = this.loginPassword(passwordInput);
    const now = new Date();
    const account = await this.prisma.userAccount.findUnique({
      where: { username },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        lockedUntil: true,
      },
    });

    const locked = account?.lockedUntil !== null && account?.lockedUntil !== undefined && account.lockedUntil > now;
    const passwordMatches = account && account.status === AccountStatus.ACTIVE && !locked
      ? await verifyPassword(password, account.passwordHash)
      : false;
    if (!account || account.status !== AccountStatus.ACTIVE || locked || !passwordMatches) {
      await this.recordFailedLogin(account?.id, username, ipAddress);
      throw new UnauthorizedException(AUTH_FAILURE);
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const absoluteExpiresAt = new Date(now.getTime() + this.absoluteLifetimeMs());
    const expiresAt = this.idleExpiry(now, absoluteExpiresAt);

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM user_account WHERE id = ${account.id}::uuid FOR UPDATE`;
      const current = await tx.userAccount.findUnique({
        where: { id: account.id },
        select: { status: true, lockedUntil: true },
      });
      if (!current || current.status !== AccountStatus.ACTIVE || (current.lockedUntil !== null && current.lockedUntil > now)) {
        throw new UnauthorizedException(AUTH_FAILURE);
      }
      const user = await this.currentUser(account.id, expiresAt, tx);

      await tx.userAccount.update({
        where: { id: account.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
      await tx.webSession.create({
        data: {
          tokenHash,
          userAccountId: account.id,
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          absoluteExpiresAt,
        },
      });
      await this.audit.record(
        {
          actorId: account.id,
          entityType: 'UserAccount',
          entityId: account.id,
          action: 'LOGIN',
          result: 'SUCCESS',
          ipAddress,
        },
        tx,
      );
      return user;
    });

    return { token, user };
  }

  async authenticate(token: string): Promise<{ sessionId: string; user: AuthUser }> {
    const now = new Date();
    const session = await this.prisma.webSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: {
        id: true,
        userAccountId: true,
        expiresAt: true,
        absoluteExpiresAt: true,
      },
    });
    if (!session || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      throw new UnauthorizedException(SESSION_FAILURE);
    }

    const expiresAt = this.idleExpiry(now, session.absoluteExpiresAt);
    const touched = await this.prisma.webSession.updateMany({
      where: {
        id: session.id,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: { lastSeenAt: now, expiresAt },
    });
    if (touched.count !== 1) throw new UnauthorizedException(SESSION_FAILURE);

    return { sessionId: session.id, user: await this.currentUser(session.userAccountId, expiresAt) };
  }

  async logout(sessionId: string, actorId: string, ipAddress?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.webSession.deleteMany({ where: { id: sessionId, userAccountId: actorId } });
      await this.audit.record(
        {
          actorId,
          entityType: 'WebSession',
          entityId: sessionId,
          action: 'LOGOUT',
          result: 'SUCCESS',
          ipAddress,
        },
        tx,
      );
    });
  }

  async accounts(user: AuthUser): Promise<{ items: AccountSummary[] }> {
    this.requireAccountsManage(user);
    const asOf = businessDate();
    const now = new Date();
    const accounts = await this.prisma.userAccount.findMany({
      where: await this.managedAccountWhere(user),
      orderBy: { username: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        status: true,
        lockedUntil: true,
        assignments: {
          where: this.effectiveWhere(asOf),
          select: { roleCode: true },
        },
        _count: {
          select: {
            sessions: {
              where: {
                expiresAt: { gt: now },
                absoluteExpiresAt: { gt: now },
              },
            },
          },
        },
      },
    });

    return {
      items: accounts.map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        status: account.status,
        roles: [...new Set(account.assignments.map((assignment) => assignment.roleCode))],
        sessionCount: account._count.sessions,
        lockedUntil: account.lockedUntil?.toISOString() ?? null,
      })),
    };
  }

  async revokeSessions(user: AuthUser, accountId: string, ipAddress?: string): Promise<void> {
    this.requireAccountsManage(user);
    await this.prisma.$transaction(async (tx) => {
      const account = await tx.userAccount.findFirst({
        where: { AND: [{ id: accountId }, await this.managedAccountWhere(user, tx)] },
        select: { id: true },
      });
      if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Account was not found.' });

      const deleted = await tx.webSession.deleteMany({ where: { userAccountId: accountId } });
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'UserAccount',
          entityId: accountId,
          action: 'REVOKE_SESSIONS',
          result: 'SUCCESS',
          newValue: { revokedSessionCount: deleted.count },
          ipAddress,
        },
        tx,
      );
    });
  }

  private async currentUser(accountId: string, expiresAt: Date, db: Prisma.TransactionClient = this.prisma): Promise<AuthUser> {
    const asOf = businessDate();
    const account = await db.userAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        username: true,
        displayName: true,
        status: true,
        employee: { select: { status: true } },
        assignments: {
          where: {
            ...this.effectiveWhere(asOf),
            scopeOrgUnit: {
              versions: { some: this.effectiveWhere(asOf) },
            },
          },
          include: {
            role: { select: { permissions: true } },
            scopeOrgUnit: {
              select: {
                versions: {
                  where: this.effectiveWhere(asOf),
                  select: { name: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!account) throw new UnauthorizedException(SESSION_FAILURE);
    if (account.status !== AccountStatus.ACTIVE || account.employee?.status === EmployeeStatus.TERMINATED) {
      throw new ForbiddenException(ACCOUNT_FAILURE);
    }

    const assignments = account.assignments.flatMap((assignment) => {
      const scopeName = assignment.scopeOrgUnit.versions[0]?.name;
      return scopeName
        ? [{ roleCode: assignment.roleCode, scopeOrgUnitId: assignment.scopeOrgUnitId, scopeName }]
        : [];
    });
    const permissions = [...new Set(account.assignments.flatMap((assignment) => assignment.role.permissions))].sort();
    const roles = [...new Set(assignments.map((assignment) => assignment.roleCode))].sort() as RoleCode[];

    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      roles,
      permissions,
      assignments,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async recordFailedLogin(accountId: string | undefined, username: string, ipAddress: string | undefined): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (accountId) await tx.$queryRaw`SELECT id FROM user_account WHERE id = ${accountId}::uuid FOR UPDATE`;
      const now = new Date();
      const account = accountId
        ? await tx.userAccount.findUnique({
            where: { id: accountId },
            select: { id: true, status: true, failedLogins: true, lockedUntil: true },
          })
        : null;
      let entityId = `username:${username}`;
      let newValue: Prisma.InputJsonValue | undefined;

      if (account) {
        entityId = account.id;
        if (account.status === AccountStatus.ACTIVE && (!account.lockedUntil || account.lockedUntil <= now)) {
          const priorFailures = account.lockedUntil && account.lockedUntil <= now ? 0 : account.failedLogins;
          const failedLogins = priorFailures + 1;
          const lockedUntil = failedLogins >= this.lockoutAttempts()
            ? new Date(now.getTime() + this.lockoutLifetimeMs())
            : null;
          await tx.userAccount.update({
            where: { id: account.id },
            data: { failedLogins, lockedUntil },
          });
          newValue = { failedLogins, lockedUntil: lockedUntil?.toISOString() ?? null };
        }
      }

      await this.audit.record(
        {
          actorId: account?.id,
          entityType: 'UserAccount',
          entityId,
          action: 'LOGIN',
          result: 'FAILURE',
          newValue,
          ipAddress,
        },
        tx,
      );
    });
  }

  private async managedAccountWhere(user: AuthUser, db: Prisma.TransactionClient = this.prisma): Promise<Prisma.UserAccountWhereInput> {
    const scope = await this.scope.load(user, 'accounts.manage', db);
    const ids = [...scope.allowed];
    return { AND: [
      { assignments: { some: { ...this.effectiveWhere(scope.asOf), scopeOrgUnitId: { in: ids } } } },
      { assignments: { none: { ...this.effectiveWhere(scope.asOf), scopeOrgUnitId: { notIn: ids } } } },
    ] };
  }

  private requireAccountsManage(user: AuthUser): void {
    if (!user.permissions.includes('accounts.manage')) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Accounts management permission is required.' });
    }
  }

  private effectiveWhere(asOf: Date) {
    return {
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    };
  }

  private loginUsername(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 64) {
      throw new UnauthorizedException(AUTH_FAILURE);
    }
    return value.trim();
  }

  private loginPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) {
      throw new UnauthorizedException(AUTH_FAILURE);
    }
    return value;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.idleLifetimeMs(), absoluteExpiresAt.getTime()));
  }

  private idleLifetimeMs(): number {
    return this.positiveConfig('AUTH_IDLE_MINUTES', 15) * 60_000;
  }

  private absoluteLifetimeMs(): number {
    return this.positiveConfig('AUTH_ABSOLUTE_HOURS', 8) * 60 * 60_000;
  }

  private lockoutLifetimeMs(): number {
    return this.positiveConfig('AUTH_LOCK_MINUTES', 15) * 60_000;
  }

  private lockoutAttempts(): number {
    return this.positiveConfig('AUTH_MAX_FAILURES', 5);
  }

  private positiveConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}

export interface AccountSummary {
  id: string;
  username: string;
  displayName: string;
  status: AccountStatus;
  roles: RoleCode[];
  sessionCount: number;
  lockedUntil: string | null;
}
