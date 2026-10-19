import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { effectiveAt, ScopeService } from '../organization/scope.service';
import type { AuthUser } from './auth.types';
import { businessDate } from './business-date';
import { CreateAccountDto, UpdateAccountDto, AccountStatusDto, ResetPasswordDto, AccountDetailsDto } from './accounts.dto';
import { PasswordPolicyService } from './password-policy.service';

const accountInclude = {
  assignments: { include: { scopeOrgUnit: { include: { versions: { orderBy: { effectiveFrom: 'desc' as const } } } } } },
  exclusions: { include: { employee: { select: { id: true, code: true, fullName: true } } } },
  employee: { select: { id: true, status: true, terminationDate: true } },
} satisfies Prisma.UserAccountInclude;
type Account = Prisma.UserAccountGetPayload<{ include: typeof accountInclude }>;
type Range = { effectiveFrom: Date; effectiveTo: Date | null };
type Grant = Range & { roleCode: 'TT' | 'QD' | 'KT' | 'AD'; scopeOrgUnitId: string };
type Exclusion = Range & { employeeId: string };
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const active = (r: Range, day: Date) => r.effectiveFrom <= day && (!r.effectiveTo || r.effectiveTo >= day);
const grantKey = (r: Grant) => [r.roleCode, r.scopeOrgUnitId, dayText(r.effectiveFrom)].join(':');
const exclusionKey = (r: Exclusion) => [r.employeeId, dayText(r.effectiveFrom)].join(':');
function date(value: string) {
  const d = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(d.getTime()) || dayText(d) !== value) throw new BadRequestException('Ngày hiệu lực không hợp lệ.');
  return d;
}
function range(row: { effectiveFrom: string; effectiveTo?: string | null }): Range {
  const r = { effectiveFrom: date(row.effectiveFrom), effectiveTo: row.effectiveTo ? date(row.effectiveTo) : null };
  if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  return r;
}
function overlaps<T extends Range>(rows: T[], key: (row: T) => string) {
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (key(a) === key(b) && (!a.effectiveTo || a.effectiveTo >= b.effectiveFrom) && (!b.effectiveTo || b.effectiveTo >= a.effectiveFrom))
      throw new BadRequestException({ code: 'OVERLAPPING_EFFECTIVITY', message: 'Các khoảng hiệu lực cùng vai trò/đơn vị hoặc cùng nhân sự loại trừ không được trùng nhau.' });
  }
}
// Retain past facts; removing a current grant ends it yesterday rather than erasing history.
function preserveHistory<T extends Range>(rows: T[], previous: T[], key: (r: T) => string, today: Date): T[] {
  const result = [...rows];
  for (const old of previous) {
    const match = result.find(r => key(r) === key(old));
    if (old.effectiveTo && old.effectiveTo < today) {
      if (!match || match.effectiveTo?.getTime() !== old.effectiveTo.getTime()) throw new ConflictException({ code: 'HISTORY_IMMUTABLE', message: 'Không được sửa hoặc xóa khoảng hiệu lực đã kết thúc.' });
    } else if (old.effectiveFrom < today && !match) {
      result.push({ ...old, effectiveTo: new Date(today.getTime() - 86400000) });
    }
  }
  for (const row of rows) {
    const old = previous.find(r => key(r) === key(row));
    if (row.effectiveFrom < today && !old) throw new BadRequestException('Không được cấp quyền hoặc loại trừ hồi tố.');
    if (old && (!old.effectiveTo || old.effectiveTo >= today) && row.effectiveTo && row.effectiveTo < today)
      throw new BadRequestException('Khoảng đang hiệu lực chỉ được kết thúc từ hôm nay.');
  }
  return result;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly passwords: PasswordPolicyService) {}

  private async adminScope(db: Prisma.TransactionClient, user: AuthUser) {
    const today = businessDate();
    const actor = await db.userAccount.findUnique({ where: { id: user.id }, include: { assignments: { include: { role: true } }, employee: true } });
    if (!actor || actor.status !== 'ACTIVE' || actor.employee?.status === 'TERMINATED' ||
      (actor.employee?.terminationDate && actor.employee.terminationDate <= today) || this.passwords.state(actor).requiresPasswordChange)
      throw new ForbiddenException('Tài khoản quản trị không còn khả dụng.');
    const versions = await db.orgUnitVersion.findMany({ include: { orgUnit: true } });
    const scopes = new Map<number, ReturnType<ScopeService['load']>>();
    const on = (day: Date) => {
      let promise = scopes.get(day.getTime());
      if (!promise) {
        const assignments = actor.assignments.filter(r => active(r, day));
        const current: AuthUser = { ...user, permissions: [...new Set(assignments.flatMap(r => r.role.permissions))], assignments: assignments.map(r => ({ roleCode: r.roleCode, scopeOrgUnitId: r.scopeOrgUnitId, scopeName: '' })) };
        promise = this.scope.load(current, 'accounts.manage', db, day);
        scopes.set(day.getTime(), promise);
      }
      return promise;
    };
    const current = await on(today);
    const changes = [...versions, ...actor.assignments].flatMap(r => [r.effectiveFrom.getTime(), ...(r.effectiveTo ? [r.effectiveTo.getTime() + 86400000] : [])]);
    const dates = (from: Date, to: Date | null) => [...new Set([from.getTime(), ...changes.filter(t => t > from.getTime() && (!to || t <= to.getTime()))])].sort((a,b) => a-b).map(t => new Date(t));
    const covers = async (unit: string, r: Range) => {
      if (!current.allowed.has(unit)) return false;
      if (r.effectiveTo && r.effectiveTo < today) return true;
      for (const day of dates(r.effectiveFrom < today ? today : r.effectiveFrom, r.effectiveTo)) {
        try { if (!(await on(day)).allowed.has(unit)) return false; } catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
      }
      return true;
    };
    const employeeVisibility = new Map<string, Promise<boolean>>();
    const visibleEmployee = (id: string) => {
      let found = employeeVisibility.get(id);
      if (!found) {
        found = db.employee.findFirst({ where: { id, assignments: { some: { isPrimary: true, ...effectiveAt(today), orgUnitId: { in: [...current.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } }, select: { id: true } }).then(e => e !== null);
        employeeVisibility.set(id, found);
      }
      return found;
    };
    return { today, current, on, dates, covers, versions, visibleEmployee };
  }

  private serialize(a: Account, sessionCount: number) {
    const today = businessDate();
    return {
      id: a.id, username: a.username, displayName: a.displayName, employeeId: a.employeeId, status: a.status, revision: a.revision,
      roles: [...new Set(a.assignments.filter(r => active(r, today)).map(r => r.roleCode))].sort(),
      sessionCount, lockedUntil: a.lockedUntil?.toISOString() ?? null, passwordChangedAt: a.passwordChangedAt.toISOString(), ...this.passwords.state(a),
      assignments: a.assignments.sort((x,y) => x.effectiveFrom.getTime()-y.effectiveFrom.getTime()).map(r => {
        const v = r.scopeOrgUnit.versions.find(v => active(v, today)) ?? r.scopeOrgUnit.versions.find(v => active(v, r.effectiveFrom)) ?? r.scopeOrgUnit.versions[0];
        return { id: r.id, roleCode: r.roleCode, scopeOrgUnitId: r.scopeOrgUnitId, scopeCode: r.scopeOrgUnit.code, scopeName: v?.name ?? r.scopeOrgUnit.code, scopeType: v?.type ?? null, effectiveFrom: dayText(r.effectiveFrom), effectiveTo: r.effectiveTo ? dayText(r.effectiveTo) : null };
      }),
      exclusions: a.exclusions.map(r => ({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.code, employeeName: r.employee.fullName, effectiveFrom: dayText(r.effectiveFrom), effectiveTo: r.effectiveTo ? dayText(r.effectiveTo) : null })),
    };
  }

  private async manageable(a: Account, s: Awaited<ReturnType<AccountsService['adminScope']>>) {
    if (!a.assignments.length) return s.current.versions.some(v => v.type === 'COMPANY');
    for (const grant of a.assignments) if (!await s.covers(grant.scopeOrgUnitId, grant)) return false;
    const identities = [...new Set([...(a.employeeId ? [a.employeeId] : []), ...a.exclusions.map(r => r.employeeId)])];
    for (const id of identities) if (!await s.visibleEmployee(id)) return false;
    return true;
  }
  private async target(db: Prisma.TransactionClient, user: AuthUser, id: string, s: Awaited<ReturnType<AccountsService['adminScope']>>, revision?: number, allowSelf = false) {
    await db.$queryRaw`SELECT id FROM user_account WHERE id = ${id}::uuid FOR UPDATE`;
    const a = await db.userAccount.findUnique({ where: { id }, include: accountInclude });
    if (!a || !await this.manageable(a, s)) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy tài khoản trong phạm vi quản trị.' });
    if (!allowSelf && id === user.id) throw new ForbiddenException({ code: 'SELF_MANAGEMENT_DENIED', message: 'Không được tự sửa quyền, khóa hoặc đặt lại mật khẩu. Dùng chức năng đổi mật khẩu cá nhân.' });
    if (revision !== undefined && a.revision !== revision) throw new ConflictException({ code: 'REVISION_CONFLICT', message: 'Tài khoản đã thay đổi. Tải lại trước khi lưu.' });
    return a;
  }
  private async transaction<T>(run: (db: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      // Serialize account administration, including concurrent last-admin changes.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
      return run(db);
    }, { timeout: 30000 });
  }
  async context(user: AuthUser) {
    const s = await this.adminScope(this.prisma, user);
    const units = s.current.versions.map(v => {
      const path: string[] = [v.name]; let parent = v.parentId; const seen = new Set([v.orgUnitId]);
      while (parent && !seen.has(parent)) { seen.add(parent); const p = s.current.versions.find(p => p.orgUnitId === parent); if (!p) break; path.unshift(p.name); parent = p.parentId; }
      return { id: v.orgUnitId, code: v.orgUnit.code, name: v.name, type: v.type, level: v.level, parentId: v.parentId, siteId: v.siteId, pathLabel: path.join(' / ') };
    }).sort((a,b) => a.pathLabel.localeCompare(b.pathLabel, 'vi'));
    const employees = await this.prisma.employee.findMany({ where: { status: { not: 'TERMINATED' }, assignments: { some: { isPrimary: true, ...effectiveAt(s.today), orgUnitId: { in: [...s.current.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(s.today) } } }, select: { id: true, code: true, fullName: true }, orderBy: { code: 'asc' } });
    const roles = await this.prisma.role.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } });
    return { asOf: dayText(s.today), units, employees, roles, policy: this.passwords.policy };
  }
  async accounts(user: AuthUser) {
    const s = await this.adminScope(this.prisma, user);
    const now = new Date();
    const accounts = await this.prisma.userAccount.findMany({ include: { ...accountInclude, _count: { select: { sessions: { where: { expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } } } } } }, orderBy: { username: 'asc' } });
    const items = [];
    for (const a of accounts) if (await this.manageable(a, s)) items.push(this.serialize(a, a._count.sessions));
    return { items };
  }

  private async details(db: Prisma.TransactionClient, user: AuthUser, dto: AccountDetailsDto, s: Awaited<ReturnType<AccountsService['adminScope']>>, old?: Account) {
    const displayName = dto.displayName.trim(); const reason = dto.reason.trim();
    if (!displayName || reason.length < 3) throw new BadRequestException('Nhập tên hiển thị và lý do có ít nhất 3 ký tự.');
    const assignments = preserveHistory(dto.assignments.map(r => ({ roleCode: r.roleCode, scopeOrgUnitId: r.scopeOrgUnitId, ...range(r) })), old?.assignments ?? [], grantKey, s.today);
    const exclusions = preserveHistory(dto.exclusions.map(r => ({ employeeId: r.employeeId, ...range(r) })), old?.exclusions ?? [], exclusionKey, s.today);
    overlaps(assignments, r => r.roleCode + ':' + r.scopeOrgUnitId); overlaps(exclusions, r => r.employeeId);
    for (const r of assignments) {
      if (!await s.covers(r.scopeOrgUnitId, r)) throw new ForbiddenException('Phạm vi hoặc toàn bộ khoảng hiệu lực cấp quyền vượt quyền quản trị.');
      if (r.effectiveTo && r.effectiveTo < s.today) continue;
      for (const day of s.dates(r.effectiveFrom < s.today ? s.today : r.effectiveFrom, r.effectiveTo)) {
        const v = s.versions.find(v => v.orgUnitId === r.scopeOrgUnitId && active(v, day));
        if (!v || (r.roleCode === 'TT' && v.type !== 'TEAM') || (r.roleCode === 'QD' && v.type !== 'DEPARTMENT') || (r.roleCode === 'AD' && !['COMPANY','SITE'].includes(v.type)))
          throw new BadRequestException('Vai trò không phù hợp cấp đơn vị: TT ở tổ, QĐ ở phân xưởng/phòng ban, AD ở công ty/cơ sở.');
      }
    }
    const employeeIds = [...new Set([...(dto.employeeId ? [dto.employeeId] : []), ...exclusions.filter(r => !r.effectiveTo || r.effectiveTo >= s.today).map(r => r.employeeId)])];
    const employees = await db.employee.findMany({ where: { id: { in: employeeIds } }, include: { assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id, ...effectiveAt(s.today) } } } });
    for (const id of employeeIds) {
      const e = employees.find(e => e.id === id);
      if (!e || e.exclusions.length || !e.assignments.some(r => active(r, s.today) && s.current.allowed.has(r.orgUnitId))) throw new ForbiddenException('Nhân sự liên kết hoặc loại trừ ngoài phạm vi quản trị.');
      if (dto.employeeId === id && (e.status === 'TERMINATED' || (e.terminationDate && e.terminationDate <= s.today))) throw new BadRequestException('Không liên kết tài khoản cho nhân sự đã nghỉ việc.');
      for (const r of exclusions.filter(r => r.employeeId === id && (!r.effectiveTo || r.effectiveTo >= s.today))) {
        const changes = e.assignments.flatMap(a => [a.effectiveFrom.getTime(), ...(a.effectiveTo ? [a.effectiveTo.getTime() + 86400000] : [])]);
        const start = r.effectiveFrom < s.today ? s.today : r.effectiveFrom;
        const days = [...new Set([...s.dates(start, r.effectiveTo).map(d => d.getTime()), ...changes.filter(t => t >= start.getTime() && (!r.effectiveTo || t <= r.effectiveTo.getTime()))])];
        for (const t of days) {
          const a = e.assignments.find(a => active(a, new Date(t)));
          if (!a || !await s.covers(a.orgUnitId, { effectiveFrom: new Date(t), effectiveTo: new Date(t) })) throw new ForbiddenException('Khoảng hiệu lực loại trừ có nhân sự ngoài phạm vi quản trị.');
        }
      }
    }
    return { displayName, employeeId: dto.employeeId ?? null, reason, assignments, exclusions };
  }
  private async saveGrants(db: Prisma.TransactionClient, id: string, assignments: Grant[], exclusions: Exclusion[], old?: Account) {
    const grantIds: string[] = [], exclusionIds: string[] = [];
    for (const r of assignments) {
      const previous = old?.assignments.find(a => grantKey(a) === grantKey(r));
      const saved = previous ? await db.roleAssignment.update({ where: { id: previous.id }, data: { effectiveTo: r.effectiveTo } }) : await db.roleAssignment.create({ data: { userAccountId: id, roleCode: r.roleCode, scopeOrgUnitId: r.scopeOrgUnitId, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo } });
      grantIds.push(saved.id);
    }
    for (const r of exclusions) {
      const previous = old?.exclusions.find(a => exclusionKey(a) === exclusionKey(r));
      const saved = previous ? await db.employeeExclusion.update({ where: { id: previous.id }, data: { effectiveTo: r.effectiveTo } }) : await db.employeeExclusion.create({ data: { userAccountId: id, employeeId: r.employeeId, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo } });
      exclusionIds.push(saved.id);
    }
    await db.roleAssignment.deleteMany({ where: { userAccountId: id, id: { notIn: grantIds } } });
    await db.employeeExclusion.deleteMany({ where: { userAccountId: id, id: { notIn: exclusionIds } } });
  }
  private async protectLastAdmin(db: Prisma.TransactionClient) {
    const today = businessDate();
    const accounts = await db.userAccount.findMany({ where: { status: 'ACTIVE', OR: [{ employeeId: null }, { employee: { status: { not: 'TERMINATED' } } }] }, include: { employee: true, assignments: { where: { roleCode: 'AD' }, include: { scopeOrgUnit: { include: { versions: { where: { type: 'COMPANY' } } } } } } } });
    const intervals = accounts.flatMap(a => a.assignments.flatMap(r => r.scopeOrgUnit.versions.map(v => ({ from: Math.max(today.getTime(), r.effectiveFrom.getTime(), v.effectiveFrom.getTime()), to: Math.min(r.effectiveTo?.getTime() ?? Infinity, v.effectiveTo?.getTime() ?? Infinity, a.employee?.terminationDate ? a.employee.terminationDate.getTime() - 86400000 : Infinity) }))));
    const boundaries = [...new Set([today.getTime(), ...intervals.flatMap(r => [r.from, ...(Number.isFinite(r.to) ? [r.to + 86400000] : [])])])];
    if (boundaries.some(t => t >= today.getTime() && !intervals.some(r => r.from <= t && r.to >= t))) throw new ConflictException({ code: 'LAST_ADMIN_REQUIRED', message: 'Phải duy trì ít nhất một Admin công ty đang hoạt động, kể cả sau các ngày quyền hết hiệu lực.' });
  }
  private async finish(db: Prisma.TransactionClient, user: AuthUser, id: string, action: string, reason: string, old?: Account, ipAddress?: string) {
    const a = await db.userAccount.findUniqueOrThrow({ where: { id }, include: accountInclude });
    const revoked = await db.webSession.deleteMany({ where: { userAccountId: id } });
    const account = this.serialize(a, 0);
    await this.audit.record({ actorId: user.id, entityType: 'UserAccount', entityId: id, action, result: 'SUCCESS', ...(old ? { oldValue: this.serialize(old, 0) } : {}), newValue: { account, reason, revokedSessionCount: revoked.count }, ipAddress }, db);
    return { account };
  }
  async create(user: AuthUser, dto: CreateAccountDto, ipAddress?: string) {
    return this.transaction(async db => {
      const s = await this.adminScope(db, user); const data = await this.details(db, user, dto, s);
      if (await db.userAccount.findUnique({ where: { username: dto.username }, select: { id: true } })) throw new ConflictException({ code: 'USERNAME_EXISTS', message: 'Tên đăng nhập đã tồn tại.' });
      const passwordHash = await this.passwords.hashNew(dto.password);
      const a = await db.userAccount.create({ data: { username: dto.username, displayName: data.displayName, employeeId: data.employeeId, passwordHash, mustChangePassword: true } });
      await this.saveGrants(db, a.id, data.assignments, data.exclusions);
      await this.passwords.remember(db, a.id, passwordHash);
      return this.finish(db, user, a.id, 'CREATE_ACCOUNT', data.reason, undefined, ipAddress);
    });
  }
  async update(user: AuthUser, id: string, dto: UpdateAccountDto, ipAddress?: string) {
    return this.transaction(async db => {
      const s = await this.adminScope(db, user); const old = await this.target(db, user, id, s, dto.revision);
      const data = await this.details(db, user, dto, s, old);
      await db.userAccount.update({ where: { id }, data: { displayName: data.displayName, employeeId: data.employeeId, revision: { increment: 1 } } });
      await this.saveGrants(db, id, data.assignments, data.exclusions, old); await this.protectLastAdmin(db);
      return this.finish(db, user, id, 'UPDATE_ACCOUNT', data.reason, old, ipAddress);
    });
  }
  async status(user: AuthUser, id: string, dto: AccountStatusDto, ipAddress?: string) {
    return this.transaction(async db => {
      const s = await this.adminScope(db, user); const old = await this.target(db, user, id, s, dto.revision);
      if (dto.reason.trim().length < 3) throw new BadRequestException('Nhập lý do có ít nhất 3 ký tự.');
      if (dto.status === 'ACTIVE' && (old.employee?.status === 'TERMINATED' || (old.employee?.terminationDate && old.employee.terminationDate <= s.today))) throw new BadRequestException('Không mở tài khoản của nhân sự đã nghỉ việc.');
      await db.userAccount.update({ where: { id }, data: { status: dto.status, failedLogins: 0, lockedUntil: null, revision: { increment: 1 } } });
      await this.protectLastAdmin(db);
      return this.finish(db, user, id, dto.status === 'ACTIVE' ? 'UNLOCK_ACCOUNT' : 'LOCK_ACCOUNT', dto.reason.trim(), old, ipAddress);
    });
  }
  async resetPassword(user: AuthUser, id: string, dto: ResetPasswordDto, ipAddress?: string) {
    return this.transaction(async db => {
      const s = await this.adminScope(db, user); const old = await this.target(db, user, id, s, dto.revision);
      if (dto.reason.trim().length < 3) throw new BadRequestException('Nhập lý do có ít nhất 3 ký tự.');
      const current = await db.userAccount.findUniqueOrThrow({ where: { id } });
      const passwordHash = await this.passwords.hashNew(dto.password, db, id, current.passwordHash);
      await db.userAccount.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, revision: { increment: 1 } } });
      await this.passwords.remember(db, id, passwordHash, current);
      return this.finish(db, user, id, 'RESET_PASSWORD', dto.reason.trim(), old, ipAddress);
    });
  }
  async revokeSessions(user: AuthUser, id: string, ipAddress?: string) {
    await this.transaction(async db => {
      const s = await this.adminScope(db, user); const old = await this.target(db, user, id, s, undefined, true);
      await db.userAccount.update({ where: { id }, data: { revision: { increment: 1 } } });
      await this.finish(db, user, id, 'REVOKE_SESSIONS', 'Admin thu hồi toàn bộ phiên đăng nhập.', old, ipAddress);
    });
  }
}
