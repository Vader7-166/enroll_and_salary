import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class PasswordPolicyService {
  readonly policy;
  constructor(config: ConfigService) {
    const integer = (key: string, fallback: number, min: number, max: number) => {
      const n = Number(config.get(key) ?? fallback);
      if (!Number.isInteger(n) || n < min || n > max) throw new Error(key + ' không hợp lệ.');
      return n;
    };
    const flag = (key: string) => {
      const value = config.get<string | boolean>(key) ?? true;
      if ([true, 'true', '1'].includes(value)) return true;
      if ([false, 'false', '0'].includes(value)) return false;
      throw new Error(key + ' không hợp lệ.');
    };
    this.policy = {
      minLength: integer('AUTH_PASSWORD_MIN_LENGTH', 12, 8, 128),
      requireUppercase: flag('AUTH_PASSWORD_REQUIRE_UPPERCASE'),
      requireLowercase: flag('AUTH_PASSWORD_REQUIRE_LOWERCASE'),
      requireNumber: flag('AUTH_PASSWORD_REQUIRE_NUMBER'),
      requireSymbol: flag('AUTH_PASSWORD_REQUIRE_SYMBOL'),
      historyCount: integer('AUTH_PASSWORD_HISTORY_COUNT', 5, 1, 24),
      maxAgeDays: integer('AUTH_PASSWORD_MAX_AGE_DAYS', 90, 0, 3650),
    };
  }
  state(account: { mustChangePassword: boolean; passwordChangedAt: Date }, now = new Date()) {
    const expiresAt = this.policy.maxAgeDays ? new Date(account.passwordChangedAt.getTime() + this.policy.maxAgeDays * 86400000) : null;
    return { requiresPasswordChange: account.mustChangePassword || (expiresAt !== null && expiresAt <= now), passwordExpiresAt: expiresAt?.toISOString() ?? null };
  }
  async hashNew(password: string, db?: Prisma.TransactionClient, accountId?: string, currentHash?: string): Promise<string> {
    const p = this.policy;
    if (password.length < p.minLength || password.length > 128 ||
      (p.requireUppercase && !/\p{Lu}/u.test(password)) ||
      (p.requireLowercase && !/\p{Ll}/u.test(password)) ||
      (p.requireNumber && !/[0-9]/.test(password)) ||
      (p.requireSymbol && !/[^\p{L}\p{N}\s]/u.test(password))) {
      throw new BadRequestException({ code: 'PASSWORD_POLICY', message: 'Mật khẩu không đáp ứng chính sách độ dài và độ phức tạp.' });
    }
    if (db && accountId && currentHash) {
      const rows = await db.passwordHistory.findMany({ where: { userAccountId: accountId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.historyCount });
      const hashes = [currentHash, ...rows.map(r => r.passwordHash).filter(h => h !== currentHash)].slice(0, p.historyCount);
      for (const hash of hashes) if (await verifyPassword(password, hash)) {
        throw new BadRequestException({ code: 'PASSWORD_REUSED', message: 'Không được dùng lại mật khẩu trong lịch sử gần đây.' });
      }
    }
    return hashPassword(password);
  }
  async remember(db: Prisma.TransactionClient, accountId: string, hash: string, previous?: { passwordHash: string; passwordChangedAt: Date }) {
    if (previous && !await db.passwordHistory.findFirst({ where: { userAccountId: accountId, passwordHash: previous.passwordHash }, select: { id: true } })) {
      await db.passwordHistory.create({ data: { userAccountId: accountId, passwordHash: previous.passwordHash, createdAt: previous.passwordChangedAt } });
    }
    await db.passwordHistory.create({ data: { userAccountId: accountId, passwordHash: hash } });
  }
}
