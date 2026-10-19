const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { businessDate } = require('../dist/auth/business-date');
process.loadEnvFile(resolve(__dirname, '../.env'));
const root = resolve(__dirname, '../..'), backend = resolve(root, 'backend');
const today = businessDate(), year = today.getUTCFullYear(), previousYear = year - 1;
const text = date => date.toISOString().slice(0, 10);
const yearEnd = value => `${value}-12-31`;
const date = value => new Date(value + 'T00:00:00.000Z');
const tomorrow = text(new Date(today.getTime() + 86400000));

test('Leave catalog and annual funds: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_leave_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient(), url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let db, server, logs = '';
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    // Fixture history predates the seed's 2026 organization; expand its valid coverage atomically.
    await db.$transaction(async tx => {
      await tx.orgUnitVersion.updateMany({ data: { effectiveFrom: date('2020-01-01') } });
      await tx.roleAssignment.updateMany({ data: { effectiveFrom: date('2020-01-01') } });
    });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error(logs)); }, 20000);
      server.once("exit", code => { finished = true; clearTimeout(timeout); reject(new Error("API exited " + code + "\n" + logs)); });
      const poll = async () => { if (finished) return; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { finished = true; clearTimeout(timeout); ready(); return; } } catch {} if (!finished) setTimeout(poll, 100); }; poll();
    });
    async function request(path, cookie, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) {
      const result = await request(path, cookie, body);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    async function login(username) {
      const account = credentials.find(value => value.username === username);
      return (await request('/auth/login', null, { username, password: account.password })).cookie;
    }
    const [ad, kt, tt, qd] = await Promise.all(['ad.demo', 'kt.all', 'tt.bn', 'qd.bn'].map(login));
    const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
    const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const remoteTeam = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-NA-D1-T1' } });
    const main = await db.employee.create({ data: { code: 'LEAVE-MAIN', fullName: 'Nhân sự quỹ phép chính', gender: 'FEMALE', dob: date('1990-01-01'), hireDate: date(`${previousYear - 5}-01-01`), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2020-01-01'), allocationRatio: '100', isPrimary: true } } } });
    const remote = await db.employee.create({ data: { code: 'LEAVE-REMOTE', fullName: 'Nhân sự quỹ phép ngoài phạm vi', gender: 'MALE', dob: date('1990-01-01'), hireDate: date('2020-01-01'), assignments: { create: { orgUnitId: remoteTeam.id, effectiveFrom: date('2020-01-01'), allocationRatio: '100', isPrimary: true } } } });
    const joiner = await db.employee.create({ data: { code: 'LEAVE-JOINER', fullName: 'Nhân sự vào giữa năm', gender: 'FEMALE', dob: date('2000-01-01'), hireDate: date(`${previousYear}-06-16`), assignments: { create: { orgUnitId: team.id, effectiveFrom: date(`${previousYear}-06-16`), allocationRatio: '100', isPrimary: true } } } });
    const zero = await db.employee.create({ data: { code: "LEAVE-ZERO", fullName: "Nhân sự không có tháng đủ điều kiện", gender: "FEMALE", dob: date("1990-01-01"), hireDate: date("2020-01-01"), assignments: { create: { orgUnitId: team.id, effectiveFrom: date("2020-01-01"), allocationRatio: "100", isPrimary: true } } } });
    const typeInput = { name: 'Nghỉ kiểm chứng', active: true, isPaid: true, countsAsWorkday: true, deductsAnnualQuota: false, siPaid: false, requiresDocument: true, maxDays: '3.00', attendanceSymbol: 'R', status: 'SIMULATION', decisionReference: 'DEC-03-LEAVE', reason: 'Thiết lập loại nghỉ kiểm chứng', effectiveFrom: '2020-01-01' };
    const policyInput = { name: 'Chính sách kiểm chứng có hạn chuyển cuối năm', normalDays: 12, hazardousDays: 14, extremeDays: 16, carryLimitDays: '5.00', carryExpiryMonth: 12, carryExpiryDay: 31, advanceLimitDays: '3.00', status: 'SIMULATION', decisionReference: 'DEC-03-LEAVE-POLICY', reason: 'Fixture kiểm tra chuyển phép trước hạn', effectiveFrom: '2020-01-01' };
    const fundPath = (employee, fundYear = previousYear) => `/leave/balances/${employee.id}/${fundYear}`;
    async function detail(employee = main, fundYear = previousYear, cookie = kt, suffix = '') { return (await ok(fundPath(employee, fundYear) + suffix, cookie)).balance; }
    function action(revision, effectiveDate, extra = {}) { return { requestId: randomUUID(), revision, effectiveDate, reason: 'Đối soát quỹ phép LEAVE-TEST', reference: 'BB-PHEP-TEST', ...extra }; }
    let leaveType, policy;

    await t.test('catalog enforces configuration rights, legal floors and contradictory flags', async () => {
      assert.equal((await request('/leave/types', tt, { orgUnitId: site.id, code: 'LEAVE_TEST', ...typeInput })).status, 403);
      assert.equal((await request('/leave/policies', kt, { orgUnitId: site.id, ...policyInput })).status, 403);
      assert.equal((await request('/leave/types', ad, { orgUnitId: site.id, code: 'BAD', ...typeInput, siPaid: true })).status, 400);
      assert.equal((await request('/leave/policies', ad, { orgUnitId: site.id, ...policyInput, normalDays: 11 })).status, 400);
      leaveType = (await ok('/leave/types', ad, { orgUnitId: site.id, code: 'LEAVE_TEST', ...typeInput })).item;
      policy = (await ok('/leave/policies', ad, { orgUnitId: site.id, ...policyInput })).item;
      assert.ok((await ok('/leave/types?asOf=' + text(today), tt)).items.some(item => item.id === leaveType.id));
      assert.equal((await request('/leave/balances?year=' + year, ad)).status, 403, 'AD manages configuration, not employee funds');
      assert.equal((await request('/leave/employees?year=' + year, ad)).status, 403);
    });
    await t.test('type successor preserves effective history and rejects stale revisions or rewriting version data', async () => {
      const changed = (await ok('/leave/types/' + leaveType.id + '/versions', ad, { ...typeInput, revision: leaveType.revision, effectiveFrom: tomorrow, name: 'Nghỉ kiểm chứng mới', active: false })).item;
      assert.equal(changed.versions.find(version => version.effectiveFrom === '2020-01-01').effectiveTo, text(today));
      assert.equal(changed.versions.find(version => version.effectiveFrom === '2020-01-01').name, typeInput.name);
      assert.equal((await request('/leave/types/' + leaveType.id + '/versions', ad, { ...typeInput, revision: leaveType.revision, effectiveFrom: `${year + 1}-12-31` })).status, 409);
      await assert.rejects(db.leaveTypeVersion.update({ where: { id: leaveType.versions[0].id }, data: { name: 'Ghi đè lịch sử' } }));
      await assert.rejects(db.leaveTypeVersion.update({ where: { id: leaveType.versions[0].id }, data: { name: "Đổi tên khi rút ngắn kỳ", effectiveTo: date(`${previousYear}-12-30`) } }));
    });
    await t.test('confirmed months prorate employment and repeated calculation does not add entitlement', async () => {
      const bad = await request(fundPath(joiner) + '/recalculate', kt, action(0, yearEnd(previousYear), { workingCondition: 'NORMAL', eligibleMonths: [1] }));
      assert.equal(bad.status, 400);
      const calculatedJoiner = (await ok(fundPath(joiner) + '/recalculate', kt, action(0, yearEnd(previousYear), { workingCondition: 'EXTREME', eligibleMonths: [6, 7, 8, 9, 10, 11, 12] }))).balance;
      assert.equal(calculatedJoiner.entitledDays, '9.33');
      const input = action(0, yearEnd(previousYear), { workingCondition: 'NORMAL', eligibleMonths: Array.from({ length: 12 }, (_, index) => index + 1) });
      const first = await ok(fundPath(main) + '/recalculate', kt, input);
      assert.deepEqual([first.balance.entitledDays, first.balance.availableDays, first.balance.calculation.seniorityDays], ['13.00', '13.00', 1]);
      const replay = await ok(fundPath(main) + '/recalculate', kt, input);
      assert.equal(replay.operationId, first.operationId); assert.equal(replay.replayed, true);
      const repeatedInput = { ...input, requestId: randomUUID(), revision: first.balance.revision };
      const repeated = await ok(fundPath(main) + "/recalculate", kt, repeatedInput);
      assert.equal(repeated.unchanged, true); assert.equal(repeated.balance.entries.length, 1);
      const repeatedReplay = await ok(fundPath(main) + "/recalculate", kt, repeatedInput);
      assert.equal(repeatedReplay.replayed, true);
      assert.equal(repeatedReplay.unchanged, true);
      assert.equal(repeatedReplay.balance.revision, first.balance.revision);
      assert.equal((await request(fundPath(main) + "/recalculate", kt, { ...repeatedInput, reference: "Sửa nội dung sau thao tác không đổi quỹ" })).status, 409);
      assert.equal((await request(fundPath(main) + '/recalculate', kt, { ...input, workingCondition: 'EXTREME' })).status, 409, 'same request ID cannot be reused with different content');
    });
    await t.test("zero qualifying months and changed zero-delta snapshots remain auditable without fabricated days", async () => {
      const first = (await ok(fundPath(zero) + "/recalculate", kt, action(0, yearEnd(previousYear), { workingCondition: "NORMAL", eligibleMonths: [] }))).balance;
      assert.equal(first.entitledDays, "0.00");
      assert.deepEqual(first.entries.map(entry => [entry.kind, entry.days]), [["ENTITLEMENT", "0.00"]]);
      const changed = (await ok(fundPath(zero) + "/recalculate", kt, action(first.revision, yearEnd(previousYear), { workingCondition: "EXTREME", eligibleMonths: [] }))).balance;
      assert.equal(changed.entitledDays, "0.00");
      assert.equal(changed.calculation.workingCondition, "EXTREME");
      assert.deepEqual(changed.entries.map(entry => [entry.kind, entry.days]), [["RECALCULATION", "0.00"], ["ENTITLEMENT", "0.00"]]);
    });
    await t.test("mid-month exclusions block grants and survive removal of months from the latest calculation", async () => {
      const account = await db.userAccount.findUniqueOrThrow({ where: { username: "kt.all" } });
      const exclusionData = { userAccountId: account.id, employeeId: zero.id, effectiveFrom: date(`${previousYear}-06-10`), effectiveTo: date(`${previousYear}-06-11`) };
      const excluded = await db.employeeExclusion.create({ data: exclusionData });
      const before = await detail(zero);
      const rejected = await request(fundPath(zero) + "/recalculate", kt, action(before.revision, yearEnd(previousYear), { workingCondition: "NORMAL", eligibleMonths: [6] }));
      assert.equal(rejected.status, 404, "checking only month end must not bypass an exclusion inside the month");
      assert.equal((await detail(zero)).revision, before.revision);
      await db.employeeExclusion.delete({ where: { id: excluded.id } });
      const granted = (await ok(fundPath(zero) + "/recalculate", kt, action(before.revision, yearEnd(previousYear), { workingCondition: "NORMAL", eligibleMonths: [6] }))).balance;
      const cleared = (await ok(fundPath(zero) + "/recalculate", kt, action(granted.revision, yearEnd(previousYear), { workingCondition: "NORMAL", eligibleMonths: [] }))).balance;
      assert.deepEqual(cleared.calculation.eligibleMonths, []);
      await db.employeeExclusion.create({ data: exclusionData });
      assert.equal((await request(fundPath(zero), kt)).status, 404, "historical operation snapshots retain their original access boundaries");
      assert.ok((await ok("/leave/balances?year=" + previousYear, kt)).items.every(item => item.employee.id !== zero.id));
    });
    await t.test('adjustments require funds-management rights and concurrent revisions apply only once', async () => {
      const before = await detail();
      assert.equal((await request(fundPath(main) + '/adjust', tt, action(before.revision, yearEnd(previousYear), { days: '1' }))).status, 403);
      assert.equal((await request(fundPath(main) + '/adjust', qd, action(before.revision, yearEnd(previousYear), { days: '1' }))).status, 403);
      const results = await Promise.all([request(fundPath(main) + '/adjust', kt, action(before.revision, yearEnd(previousYear), { days: '1' })), request(fundPath(main) + '/adjust', kt, action(before.revision, yearEnd(previousYear), { days: '1' }))]);
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      const after = await detail(); assert.equal(after.availableDays, '14.00');
      assert.equal((await request(fundPath(main) + '/adjust', kt, action(after.revision, yearEnd(previousYear), { days: '-20' }))).status, 409);
      assert.equal((await detail()).availableDays, '14.00');
    });
    await t.test('carry posts equal source/target entries atomically, caps transfers and retains expired rights', async () => {
      const source = await detail(), target = await detail(main, year);
      const payload = action(source.revision, text(today), { targetRevision: target.revision, days: '5' });
      const transferred = await ok(fundPath(main) + '/carry', kt, payload);
      assert.deepEqual([transferred.balance.availableDays, transferred.targetBalance.availableDays, transferred.targetBalance.carriedDays], ['9.00', '5.00', '5.00']);
      const repeated = await ok(fundPath(main) + '/carry', kt, payload); assert.equal(repeated.replayed, true);
      const sourceAfter = await detail(), targetAfter = await detail(main, year);
      assert.equal((await request(fundPath(main) + '/carry', kt, action(sourceAfter.revision, text(today), { targetRevision: targetAfter.revision, days: '0.01' }))).status, 409);
      assert.deepEqual([(await detail()).revision, (await detail(main, year)).revision], [sourceAfter.revision, targetAfter.revision]);
      const expired = await detail(main, year, kt, `?asOf=${year + 1}-01-01`);
      assert.deepEqual([expired.availableDays, expired.expiredCarryDays, expired.reconciliationDays, expired.carriedDays], ['0.00', '5.00', '5.00', '5.00']);
      const operationEntries = await db.leaveLedgerEntry.findMany({ where: { operationId: transferred.operationId } });
      assert.deepEqual(operationEntries.map(entry => entry.days.toString()).sort(), ['-5', '5']);
    });
    await t.test('advance debits next-year allowance, is capped, and stale target revision rolls back both funds', async () => {
      const source = await detail(main, year), target = await detail(main, year + 1);
      const payload = action(source.revision, text(today), { targetRevision: target.revision, days: '3' });
      const advanced = await ok(fundPath(main, year) + '/advance', kt, payload);
      assert.deepEqual([advanced.balance.availableDays, advanced.balance.advanceDays, advanced.targetBalance.annualDays, advanced.targetBalance.availableDays], ['8.00', '3.00', '-3.00', '0.00']);
      const current = await detail(main, year), future = await detail(main, year + 1);
      assert.equal((await request(fundPath(main, year) + '/advance', kt, action(current.revision, text(today), { targetRevision: future.revision, days: '0.01' }))).status, 409);
      assert.equal((await request(fundPath(main, year) + '/advance', kt, action(current.revision, text(today), { targetRevision: 0, days: '0.01' }))).status, 409);
      assert.deepEqual([(await detail(main, year)).revision, (await detail(main, year + 1)).revision], [current.revision, future.revision]);
    });
    await t.test('fund history survives policy succession and ledger/operation rows are immutable', async () => {
      const before = await detail();
      const changed = (await ok('/leave/policies/' + policy.id + '/versions', ad, { ...policyInput, revision: policy.revision, effectiveFrom: tomorrow, normalDays: 14, hazardousDays: 16, extremeDays: 18 })).item;
      assert.equal(changed.versions.find(version => version.id === policy.versions[0].id).effectiveTo, text(today));
      const persisted = await detail(); assert.deepEqual(persisted.calculation, before.calculation); assert.equal(persisted.entitledDays, '13.00');
      const ledger = await db.leaveLedgerEntry.findFirstOrThrow({ where: { balanceId: persisted.id } });
      await assert.rejects(db.leaveLedgerEntry.update({ where: { id: ledger.id }, data: { days: '999' } }));
      await assert.rejects(db.leaveLedgerEntry.delete({ where: { id: ledger.id } }));
      await assert.rejects(db.leaveOperation.update({ where: { id: ledger.operationId }, data: { reason: 'Sửa lịch sử' } }));
      const audit = await db.auditLog.findMany({ where: { entityType: 'annual_leave_balance', entityId: persisted.id }, orderBy: { id: 'asc' } });
      assert.deepEqual(audit.map(row => row.action), ['RECALCULATE', 'ADJUST', 'CARRY']);
      assert.equal(audit[2].newValue.reason, 'Đối soát quỹ phép LEAVE-TEST');
    });
    await t.test("site configuration authority cannot outlive its dated grant or reach the company", async () => {
      const original = await db.userAccount.findUniqueOrThrow({ where: { username: "ad.demo" } });
      const scopedAdmin = await db.userAccount.create({ data: { username: "leave.site.admin", displayName: "Admin cơ sở có thời hạn", passwordHash: original.passwordHash, assignments: { create: { roleCode: "AD", scopeOrgUnitId: site.id, effectiveFrom: today, effectiveTo: date(tomorrow) } } } });
      const scopedLogin = await request("/auth/login", null, { username: scopedAdmin.username, password: credentials.find(account => account.username === "ad.demo").password });
      assert.equal(scopedLogin.status, 201);
      const openEnded = { ...typeInput, orgUnitId: site.id, code: "LIMITED_OPEN", effectiveFrom: text(today) };
      assert.equal((await request("/leave/types", scopedLogin.cookie, openEnded)).status, 403, "an expiring AD cannot publish an open-ended policy");
      const bounded = { ...openEnded, code: "LIMITED_BOUNDED", effectiveTo: tomorrow };
      assert.equal((await request("/leave/types", scopedLogin.cookie, { ...bounded, orgUnitId: company.id })).status, 403);
      const saved = await ok("/leave/types", scopedLogin.cookie, bounded);
      assert.equal(saved.item.versions[0].effectiveTo, tomorrow);
    });
    await t.test("repeated seed preserves custom versions and the exact funds ledger", async () => {
      const before = await detail();
      const originalType = await db.leaveType.findUniqueOrThrow({ where: { id: leaveType.id }, include: { versions: { orderBy: { effectiveFrom: "asc" } } } });
      const result = spawnSync(process.execPath, ["prisma/seed.cjs"], { cwd: backend, env, encoding: "utf8", timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.deepEqual(await detail(), before);
      assert.deepEqual(await db.leaveType.findUniqueOrThrow({ where: { id: leaveType.id }, include: { versions: { orderBy: { effectiveFrom: "asc" } } } }), originalType);
    });
    await t.test('read access enforces current exclusions and historical/current unit scopes without list leakage', async () => {
      assert.ok((await ok('/leave/balances?year=' + previousYear, tt)).items.some(item => item.employee.id === main.id));
      assert.ok([403, 404].includes((await request(fundPath(remote), tt)).status));
      const author = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });
      await db.employeeExclusion.create({ data: { userAccountId: author.id, employeeId: main.id, effectiveFrom: today } });
      assert.ok([403, 404].includes((await request(fundPath(main), tt)).status), 'today exclusion protects a historical fund');
      assert.equal((await ok('/leave/balances?year=' + previousYear, tt)).items.some(item => item.employee.id === main.id), false);
      assert.equal((await ok('/leave/employees?year=' + previousYear + '&search=LEAVE-MAIN', tt)).total, 0);
      assert.equal((await request(fundPath(main), null)).status, 401);
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
