import { randomBytes, createHash } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, EmployeeStatus, Prisma, RoleCode } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { businessDate } from './business-date';
import type { AuthUser } from './auth.types';
import { verifyPassword } from './password';
import { PasswordPolicyService } from './password-policy.service';
import { ChangePasswordDto } from './accounts.dto';

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
    private readonly passwords: PasswordPolicyService,
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
        select: { status: true, lockedUntil: true, passwordHash: true },
      });
      if (!current || current.passwordHash !== account.passwordHash || current.status !== AccountStatus.ACTIVE || (current.lockedUntil !== null && current.lockedUntil > now)) {
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

  async changePassword(user: AuthUser, dto: ChangePasswordDto, ipAddress?: string) {
    await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM user_account WHERE id = ${user.id}::uuid FOR UPDATE`;
      const account = await db.userAccount.findUniqueOrThrow({ where: { id: user.id } });
      if (account.status !== AccountStatus.ACTIVE || !await verifyPassword(dto.currentPassword, account.passwordHash))
        throw new ForbiddenException({ code: 'CURRENT_PASSWORD_INVALID', message: 'Mật khẩu hiện tại không chính xác.' });
      const passwordHash = await this.passwords.hashNew(dto.newPassword, db, user.id, account.passwordHash);
      await db.userAccount.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), revision: { increment: 1 } } });
      await this.passwords.remember(db, user.id, passwordHash, account);
      const revoked = await db.webSession.deleteMany({ where: { userAccountId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: 'UserAccount', entityId: user.id, action: 'CHANGE_PASSWORD', result: 'SUCCESS', newValue: { revokedSessionCount: revoked.count }, ipAddress }, db);
    }, { timeout: 15000 });
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
        mustChangePassword: true,
        passwordChangedAt: true,
        employee: { select: { status: true, terminationDate: true } },
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
    if (account.status !== AccountStatus.ACTIVE || account.employee?.status === EmployeeStatus.TERMINATED || (account.employee?.terminationDate && account.employee.terminationDate <= asOf)) {
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
      ...this.passwords.state(account),
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

