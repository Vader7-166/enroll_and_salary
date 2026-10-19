const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');

function vietnamBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function addDays(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test('Account administration: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_accounts_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = {
    ...process.env,
    DATABASE_URL: url.href,
    SEED_ALLOW_ISOLATED: 'true',
    SEED_DATASET: 'foundation',
    DEMO_ACCOUNTS_FILE: credentialsPath,
  };
  let server, db, serverLogs = '';

  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [
      [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      ['prisma/seed.cjs'],
    ]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const seeded = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const credentials = Object.fromEntries(seeded.map(account => [account.username, account.password]));
    const listener = net.createServer();
    await new Promise(resolveListener => listener.listen(0, '127.0.0.1', resolveListener));
    const port = listener.address().port;
    await new Promise(resolveListener => listener.close(resolveListener));
    server = spawn(process.execPath, ['dist/main.js'], {
      cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => { serverLogs += chunk; });
    server.stderr.on('data', chunk => { serverLogs += chunk; });
    await new Promise((ready, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out\n' + serverLogs)), 20000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited ' + code + '\n' + serverLogs)); });
      const poll = async () => {
        try {
          const response = await fetch('http://127.0.0.1:' + port + '/api/health');
          if (response.ok) { clearTimeout(timeout); ready(); return; }
        } catch {}
        setTimeout(poll, 100);
      };
      poll();
    });

    async function request(path, cookie, body) {
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: response.status, body: parsed, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) {
      const response = await request(path, cookie, body);
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response) + (response.status >= 500 ? '\n' + serverLogs : ''));
      return response.body;
    }
    async function login(username, password) {
      const response = await request('/auth/login', undefined, { username, password });
      assert.equal(response.status, 201, JSON.stringify(response));
      assert.ok(response.cookie, 'login must set a session cookie');
      return response;
    }
    async function makeUsable(username, temporary, permanent) {
      const forced = await login(username, temporary);
      assert.equal(forced.body.user.requiresPasswordChange, true);
      const changed = await request('/auth/change-password', forced.cookie, { currentPassword: temporary, newPassword: permanent });
      assert.equal(changed.status, 201, JSON.stringify(changed));
      return (await login(username, permanent)).cookie;
    }
    function assignment(roleCode, scopeOrgUnitId, effectiveFrom = today, effectiveTo = null) {
      return { roleCode, scopeOrgUnitId, effectiveFrom, effectiveTo };
    }
    function payload(username, assignments, password = 'TempPass!2026', extras = {}) {
      return { username, displayName: 'Tài khoản ' + username, password, assignments, exclusions: [], reason: 'Kiểm thử quản trị tài khoản', ...extras };
    }

    const today = vietnamBusinessDate();
    const tomorrow = addDays(today, 1);
    const ad = await login('ad.demo', credentials['ad.demo']);
    const adCookie = ad.cookie;
    const context = await ok('/auth/accounts/context', adCookie);
    assert.equal(context.asOf, today, 'context uses the Vietnamese business date');
    const unit = code => {
      const value = context.units.find(item => item.code === code);
      assert.ok(value, 'seed unit ' + code + ' is available');
      return value;
    };
    const bnSite = unit('NM-BN');
    const bnDepartment = unit('NM-BN-D1');
    const bnTeam = unit('NM-BN-D1-T1');
    const remoteTeam = unit('NM-NA-D1-T1');
    const employee = context.employees.find(item => item.code !== 'VIP-DEMO') || context.employees[0];
    assert.ok(employee, 'seed employee is available');

    await t.test('preserves seeded login and only AD may administer accounts', async () => {
      const seededLogin = await login('tt.bn', credentials['tt.bn']);
      assert.equal(seededLogin.body.user.username, 'tt.bn');
      for (const username of ['tt.bn', 'qd.bn', 'kt.all']) {
        const cookie = username === 'tt.bn' ? seededLogin.cookie : (await login(username, credentials[username])).cookie;
        const response = await request('/auth/accounts', cookie);
        assert.equal(response.status, 403, username + ' must not see account administration');
      }
    });

    await t.test('enforces role scope types and effective temporal bounds', async () => {
      for (const [username, grant] of [
        ['invalid.tt', assignment('TT', bnDepartment.id)],
        ['invalid.qd', assignment('QD', bnTeam.id)],
        ['invalid.ad', assignment('AD', bnDepartment.id)],
      ]) {
        const response = await request('/auth/accounts', adCookie, payload(username, [grant]));
        assert.equal(response.status, 400, username + ' role must reject invalid organizational type');
      }
      const badDates = await request('/auth/accounts', adCookie, payload('invalid.dates', [assignment('TT', bnTeam.id, tomorrow, today)]));
      assert.equal(badDates.status, 400, 'effective end before start is rejected');
      const duplicate = await request('/auth/accounts', adCookie, payload('invalid.duplicate', [assignment('TT', bnTeam.id), assignment('TT', bnTeam.id)]));
      assert.equal(duplicate.status, 400, 'overlapping same role and scope is rejected');
      const validQd = await ok('/auth/accounts', adCookie, payload('valid.qd', [assignment('QD', bnDepartment.id)]));
      assert.equal(validQd.account.assignments[0].roleCode, 'QD', 'QD grant is accepted at department scope');
    });

    const managed = (await ok('/auth/accounts', adCookie, payload('managed.account', [assignment('TT', bnTeam.id)], 'TempPass!2026', {
      employeeId: employee.id,
      exclusions: [{ employeeId: employee.id, effectiveFrom: tomorrow }],
    }))).account;
    const historicalGrant = await db.roleAssignment.create({ data: { userAccountId: managed.id, roleCode: 'TT', scopeOrgUnitId: bnTeam.id, effectiveFrom: new Date(addDays(today, -2) + 'T00:00:00.000Z'), effectiveTo: new Date(addDays(today, -1) + 'T00:00:00.000Z') } });
    assert.equal(managed.requiresPasswordChange, true);
    assert.equal(managed.assignments[0].effectiveFrom, today);
    assert.equal(managed.exclusions[0].effectiveFrom, tomorrow);

    await t.test('temporary credentials restrict API, password change revokes session, history rejects reuse', async () => {
      const forced = await login('managed.account', 'TempPass!2026');
      assert.equal(forced.body.user.requiresPasswordChange, true);
      for (const [path, body] of [
        ['/auth/accounts', undefined],
        ['/employees', undefined],
        ['/auth/accounts/context', undefined],
      ]) {
        const response = await request(path, forced.cookie, body);
        assert.equal(response.status, 403, path + ' is blocked while password change is required');
      }
      const changed = await request('/auth/change-password', forced.cookie, { currentPassword: 'TempPass!2026', newPassword: 'ChangedPass!2026' });
      assert.equal(changed.status, 201, JSON.stringify(changed));
      assert.equal((await request('/auth/me', forced.cookie)).status, 401, 'password change revokes the temporary session');
      assert.equal((await request('/auth/login', undefined, { username: 'managed.account', password: 'TempPass!2026' })).status, 401, 'old password is invalid');
      const fresh = await login('managed.account', 'ChangedPass!2026');
      const reused = await request('/auth/change-password', fresh.cookie, { currentPassword: 'ChangedPass!2026', newPassword: 'TempPass!2026' });
      assert.equal(reused.status, 400, 'password history rejects reuse');
    });

    await t.test('updates atomically enforce revision, dated exclusions, and preserve past rows', async () => {
      const before = (await ok('/auth/accounts', adCookie)).items.find(item => item.id === managed.id);
      assert.ok(before);
      const update = {
        revision: before.revision,
        displayName: 'Tài khoản đã cập nhật',
        employeeId: employee.id,
        assignments: before.assignments.map(({ roleCode, scopeOrgUnitId, effectiveFrom, effectiveTo }) => ({ roleCode, scopeOrgUnitId, effectiveFrom, effectiveTo })),
        exclusions: [{ employeeId: employee.id, effectiveFrom: today, effectiveTo: null }],
        reason: 'Cập nhật hiệu lực loại trừ',
      };
      const updated = (await ok('/auth/accounts/' + managed.id + '/update', adCookie, update)).account;
      assert.equal(updated.exclusions[0].effectiveFrom, today);
      const preservedHistorical = updated.assignments.find(item => item.id === historicalGrant.id);
      assert.ok(preservedHistorical, 'expired scope grant remains displayed and retained');
      assert.equal(preservedHistorical.effectiveFrom, addDays(today, -2));
      assert.equal(preservedHistorical.effectiveTo, addDays(today, -1));
      const stale = await request('/auth/accounts/' + managed.id + '/update', adCookie, { ...update, displayName: 'Bản ghi cũ' });
      assert.equal(stale.status, 409, 'concurrent stale revision is rejected');
      const overlappingExclusion = await request('/auth/accounts/' + managed.id + '/update', adCookie, {
        ...update, revision: updated.revision,
        exclusions: [
          { employeeId: employee.id, effectiveFrom: today },
          { employeeId: employee.id, effectiveFrom: tomorrow },
        ],
      });
      assert.equal(overlappingExclusion.status, 400, 'overlapping exclusions are rejected');
    });

    await t.test('site administrator cannot manage remote or future out-of-scope grants', async () => {
      const siteAdmin = (await ok('/auth/accounts', adCookie, payload('site.admin', [assignment('AD', bnSite.id)], 'TempPass!2026'))).account;
      const siteCookie = await makeUsable('site.admin', 'TempPass!2026', 'SiteAdminPass!2026');
      const crossScope = (await ok('/auth/accounts', adCookie, payload('future.remote', [
        assignment('TT', bnTeam.id), assignment('TT', remoteTeam.id, tomorrow),
      ]))).account;
      const list = await ok('/auth/accounts', siteCookie);
      assert.equal(list.items.some(item => item.id === crossScope.id), false, 'any future foreign grant hides account');
      const denied = await request('/auth/accounts', siteCookie, payload('site.remote.denied', [assignment('TT', remoteTeam.id)]));
      assert.equal(denied.status, 403, 'site AD cannot create remote assignment');
      const own = await request('/auth/accounts/' + siteAdmin.id + '/status', siteCookie, { revision: siteAdmin.revision, status: 'DISABLED', reason: 'Không được tự thao tác' });
      assert.equal(own.status, 403, 'administrator cannot manage self');
    });

    await t.test('reset, lock/unlock and revoke invalidate sessions', async () => {
      let record = (await ok('/auth/accounts', adCookie)).items.find(item => item.id === managed.id);
      const userCookie = (await login('managed.account', 'ChangedPass!2026')).cookie;
      const reset = await ok('/auth/accounts/' + managed.id + '/password', adCookie, {
        revision: record.revision, password: 'ResetPass!2026', reason: 'Đặt lại mật khẩu kiểm thử',
      });
      assert.equal((await request('/auth/me', userCookie)).status, 401, 'password reset revokes all sessions');
      assert.equal((await login('managed.account', 'ResetPass!2026')).body.user.requiresPasswordChange, true);
      record = reset.account;
      const disabled = await ok('/auth/accounts/' + managed.id + '/status', adCookie, { revision: record.revision, status: 'DISABLED', reason: 'Khóa kiểm thử' });
      assert.equal(disabled.account.status, 'DISABLED');
      const disabledLogin = await request('/auth/login', undefined, { username: 'managed.account', password: 'ResetPass!2026' });
      assert.equal(disabledLogin.status, 401);
      const enabled = await ok('/auth/accounts/' + managed.id + '/status', adCookie, { revision: disabled.account.revision, status: 'ACTIVE', reason: 'Mở khóa kiểm thử' });
      const temporary = await login('managed.account', 'ResetPass!2026');
      const revoke = await ok('/auth/accounts/' + managed.id + '/revoke', adCookie, { reason: 'Thu hồi phiên kiểm thử' });
      assert.equal(revoke.ok, true);
      assert.equal((await request('/auth/me', temporary.cookie)).status, 401, 'revoke invalidates session');
      assert.equal(enabled.account.status, 'ACTIVE');
    });

    await t.test('an expiring administrator cannot delegate authority past its own end date', async () => {
      const company = context.units.find(u => u.type === 'COMPANY');
      await ok('/auth/accounts', adCookie, payload('expiring.admin', [assignment('AD', company.id, today, today)]));
      const limitedCookie = await makeUsable('expiring.admin', 'TempPass!2026', 'AnotherAdmin!2026');
      const denied = await request('/auth/accounts', limitedCookie, payload('beyond.authority', [assignment('TT', bnTeam.id)]));
      assert.equal(denied.status, 403);
      const accepted = await ok('/auth/accounts', limitedCookie, payload('bounded.authority', [assignment('TT', bnTeam.id, today, today)]));
      assert.equal(accepted.account.assignments[0].effectiveTo, today);
    });

    await t.test('future and expired grants do not authorize business APIs', async () => {
      const created = (await ok('/auth/accounts', adCookie, payload('dated.account', [assignment('TT', bnTeam.id, tomorrow)]))).account;
      const cookie = await makeUsable('dated.account', 'TempPass!2026', 'DatedUserPass!2026');
      assert.deepEqual((await ok('/auth/me', cookie)).user.roles, []);
      assert.equal((await request('/employees', cookie)).status, 403);
      await db.roleAssignment.updateMany({ where: { userAccountId: created.id }, data: { effectiveFrom: new Date(today + 'T00:00:00Z') } });
      assert.deepEqual((await ok('/auth/me', cookie)).user.roles, ['TT']);
      const yesterday = new Date(addDays(today, -1) + 'T00:00:00Z');
      await db.roleAssignment.updateMany({ where: { userAccountId: created.id }, data: { effectiveFrom: yesterday, effectiveTo: yesterday } });
      assert.deepEqual((await ok('/auth/me', cookie)).user.roles, []);
      assert.equal((await request('/employees', cookie)).status, 403);
    });

    await t.test('password expiry restricts an existing session until a successful change', async () => {
      const created = (await ok('/auth/accounts', adCookie, payload('expiry.account', [assignment('TT', bnTeam.id)]))).account;
      const cookie = await makeUsable('expiry.account', 'TempPass!2026', 'ExpiryUserPass!2026');
      await db.userAccount.update({ where: { id: created.id }, data: { passwordChangedAt: new Date(Date.now() - (context.policy.maxAgeDays + 1) * 86400000) } });
      assert.equal((await ok('/auth/me', cookie)).user.requiresPasswordChange, true);
      assert.equal((await request('/employees', cookie)).body.code, 'PASSWORD_CHANGE_REQUIRED');
      await ok('/auth/change-password', cookie, { currentPassword: 'ExpiryUserPass!2026', newPassword: 'FreshExpiryPass!2026' });
      assert.equal((await request('/auth/me', cookie)).status, 401);
      assert.equal((await login('expiry.account', 'FreshExpiryPass!2026')).body.user.requiresPasswordChange, false);
    });

    await t.test('account mutations audit changes and reasons without password material', async () => {
      const auditRows = await db.auditLog.findMany({ where: { entityType: 'UserAccount', entityId: managed.id }, select: { action: true, oldValue: true, newValue: true } });
      const created = auditRows.find(r => r.action === 'CREATE_ACCOUNT');
      assert.equal(created.newValue.account.username, 'managed.account');
      assert.equal(created.newValue.reason, 'Kiểm thử quản trị tài khoản');
      const updated = auditRows.find(r => r.action === 'UPDATE_ACCOUNT');
      assert.equal(updated.oldValue.displayName, 'Tài khoản managed.account');
      assert.equal(updated.newValue.account.displayName, 'Tài khoản đã cập nhật');
      const serialized = JSON.stringify(auditRows);
      for (const secret of ['TempPass!2026', 'ChangedPass!2026', 'ResetPass!2026', 'scrypt$', 'passwordHash']) assert.equal(serialized.includes(secret), false);
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(resolveExit => server.once('exit', resolveExit)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
