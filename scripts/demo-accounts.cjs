#!/usr/bin/env node
// LOCAL DEMO ONLY. Ensures the standard demo accounts exist and gives EVERY account the same password (DEMO_PASSWORD in
// .env), so a class or a friend can log in as any role. Refuses anything but the local hrtp_demo database.
//   npm run demo:accounts
// Passwords stay hashed in the database like any other; the shared value is also written to .local/demo-accounts.json
// (git-ignored), which npm run demo:payroll reads. Never use on an operational database.
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = resolve(__dirname, '..');
for (const file of [resolve(root, '.env'), resolve(root, 'backend/.env')]) if (existsSync(file)) process.loadEnvFile(file);
const password = process.env.DEMO_PASSWORD;
const databaseUrl = process.env.DATABASE_URL || (process.env.POSTGRES_PASSWORD && `postgresql://hrtp_demo:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:${process.env.DB_PORT || 5434}/hrtp_demo`);

function fail(message) { console.error('demo:accounts — ' + message); process.exit(1); }
if (!password) fail('đặt DEMO_PASSWORD trong .env (ví dụ DEMO_PASSWORD=Hrtp@Demo2026).');
// Same rules as PasswordPolicyService defaults, so the password also works for the change-password screen.
if (password.length < 12 || password.length > 128 || !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password) || !/[0-9]/.test(password) || !/[^\p{L}\p{N}\s]/u.test(password))
  fail('DEMO_PASSWORD cần 12–128 ký tự, có chữ hoa, chữ thường, chữ số và ký tự đặc biệt.');
if (!databaseUrl) fail('không tìm thấy DATABASE_URL (backend/.env) hoặc POSTGRES_PASSWORD (.env).');
const url = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/hrtp_demo') fail('chỉ chạy với CSDL demo local hrtp_demo, không phải ' + url.hostname + url.pathname + '.');

// Same roles and scopes as the non-Docker seed (backend/prisma/seed.cjs), so every workflow can be demonstrated.
const DEMO_ACCOUNTS = [
  { username: 'tt.bn', role: 'TT', scope: 'NM-BN-D1-T1', name: 'Tổ trưởng mô phỏng Bắc Ninh' },
  { username: 'qd.bn', role: 'QD', scope: 'NM-BN-D1', name: 'Quản đốc mô phỏng Bắc Ninh' },
  { username: 'kt.all', role: 'KT', scope: 'COMPANY', name: 'Kế toán mô phỏng toàn công ty' },
  { username: 'kt.bn', role: 'KT', scope: 'NM-BN', name: 'Kế toán mô phỏng Bắc Ninh' },
  { username: 'ad.demo', role: 'AD', scope: 'COMPANY', name: 'Quản trị mô phỏng' },
];

(async () => {
  const { hashPassword } = require(resolve(root, 'backend/dist/auth/password.js'));
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const hash = await hashPassword(password);
    const now = new Date();
    const created = [];
    await db.$transaction(async tx => {
      for (const account of DEMO_ACCOUNTS) {
        const scope = await tx.orgUnit.findUnique({ where: { code: account.scope }, include: { versions: { orderBy: { effectiveFrom: 'asc' }, take: 1 } } });
        if (!scope) throw new Error('Thiếu đơn vị ' + account.scope + ' — chạy seed trước.');
        const from = scope.versions[0].effectiveFrom;
        let user = await tx.userAccount.findUnique({ where: { username: account.username }, include: { assignments: true } });
        if (!user) {
          user = await tx.userAccount.create({ data: { username: account.username, displayName: account.name, passwordHash: hash }, include: { assignments: true } });
          created.push(account.username);
        }
        // Demo grants start when the scope starts, like the seed, so historical periods and payroll are reachable.
        const grant = user.assignments.find(a => a.roleCode === account.role && a.scopeOrgUnitId === scope.id);
        if (!grant) await tx.roleAssignment.create({ data: { userAccountId: user.id, roleCode: account.role, scopeOrgUnitId: scope.id, effectiveFrom: from } });
        else if (grant.effectiveFrom > from) await tx.roleAssignment.update({ where: { id: grant.id }, data: { effectiveFrom: from } });
      }
      // Every account (demo accounts, the env admin and any account created in the UI) gets the shared password.
      await tx.userAccount.updateMany({ data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: now, failedLogins: 0, lockedUntil: null } });
      await tx.webSession.deleteMany({});
    }, { timeout: 60000 });
    const accounts = await db.userAccount.findMany({ orderBy: { username: 'asc' }, select: { username: true, displayName: true, status: true, assignments: { select: { roleCode: true } } } });
    mkdirSync(resolve(root, '.local'), { recursive: true });
    writeFileSync(resolve(root, '.local/demo-accounts.json'), JSON.stringify({ context: 'LOCAL_DEMO_SHARED_PASSWORD', password,
      accounts: accounts.map(a => ({ username: a.username, displayName: a.displayName, roles: a.assignments.map(r => r.roleCode), status: a.status, password })) }, null, 2) + '\n', { mode: 0o600 });
    console.log('Tạo mới: ' + (created.join(', ') || 'không') + '. Đặt mật khẩu chung cho ' + accounts.length + ' tài khoản; mọi phiên cũ đã bị thu hồi.');
    for (const a of accounts) console.log('  ' + a.username.padEnd(12) + ' ' + a.assignments.map(r => r.roleCode).join(',').padEnd(6) + ' ' + a.status);
    console.log('Mật khẩu: ' + password + '  (lưu ở .local/demo-accounts.json)');
  } finally { await db.$disconnect(); }
})().catch(error => fail(error.message));
