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

test('HR foundation on fresh PostgreSQL and actual HTTP API', { timeout: 120000 }, async (t) => {
  const name = 'hrtp_verify_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let server, db;
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(r => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port; await new Promise(r => listener.close(r));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((ready, reject) => {
      let logs = ''; const timer = setTimeout(() => reject(new Error('API readiness: ' + logs)), 15000);
      const receive = chunk => { logs += chunk; if (logs.includes('API ready at')) { clearTimeout(timer); ready(); } };
      server.stdout.on('data', receive); server.stderr.on('data', receive);
      server.once('exit', code => { clearTimeout(timer); reject(new Error('API exited ' + code + ': ' + logs)); });
    });
    async function request(path, cookie, body) {
      const res = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    const sessions = {};
    for (const username of ['tt.bn', 'qd.bn', 'kt.bn', 'kt.all', 'ad.demo']) {
      const account = credentials.find(a => a.username === username);
      const result = await request('/auth/login', null, { username, password: account.password });
      assert.equal(result.status, 201, JSON.stringify(result.body)); sessions[username] = result.cookie;
    }
    const kt = sessions['kt.all'], ad = sessions['ad.demo'], tt = sessions['tt.bn'], ktbn = sessions['kt.bn'];
    const context = (await request('/organization/context', kt)).body;
    const source = context.units.find(u => u.code === 'NM-BN-D1-T1');
    const other = context.units.find(u => u.code === 'NM-BN-D1-T2');
    const remote = context.units.find(u => u.code === 'NM-NA-D1-T1');
    const site = context.units.find(u => u.code === 'NM-BN');
    let employee, contract;
    async function employeeFixture(code, unit = source) {
      const result = await request('/employees', kt, { code, fullName: 'Nhân sự hồi quy', gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: unit.id });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.body.employee;
    }
    const payload = { number: 'VERIFY-CONTRACT-1', type: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', signedDate: '2026-01-01', salary: '9000000', salaryBasis: 'MONTHLY' };
    await t.test('KT creates employee and encrypted contract; unrelated roles cannot read salary', async () => {
      const created = await request('/employees', kt, { code: 'VERIFY-HR', fullName: 'Nhân sự kiểm chứng', gender: 'OTHER', dob: '1980-01-01', hireDate: '2026-01-01', orgUnitId: source.id });
      assert.equal(created.status, 201, JSON.stringify(created.body)); employee = created.body.employee;
      const result = await request(`/employees/${employee.id}/contracts`, kt, payload);
      assert.equal(result.status, 201, JSON.stringify(result.body)); contract = result.body.contract;
      assert.equal(contract.salary, '9000000'); assert.equal(contract.status, 'DRAFT');
      const stored = await db.employmentContract.findUnique({ where: { id: contract.id } });
      assert.ok(stored.salaryCipher && !stored.salaryCipher.includes(payload.salary));
      for (const cookie of [tt, sessions['qd.bn'], ad]) assert.equal((await request(`/employees/${employee.id}/contracts`, cookie)).status, 403);
      const below = await request(`/employees/${employee.id}/contracts`, kt, { ...payload, number: 'BELOW-FLOOR', salary: '1000' });
      assert.equal(below.status, 400, JSON.stringify(below.body));
    });
    await t.test('Concurrent activation rejects inclusive date overlap; annex content is encrypted', async () => {
      const second = await request(`/employees/${employee.id}/contracts`, kt, { ...payload, number: 'VERIFY-CONTRACT-2' });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const outcomes = await Promise.all([contract.id, second.body.contract.id].map(id => request(`/employees/${employee.id}/contracts/${id}/activate`, kt, {})));
      assert.deepEqual(outcomes.map(r => r.status).sort(), [201, 409]);
      contract = outcomes.find(r => r.status === 201).body.contract;
      const annex = await request(`/employees/${employee.id}/contracts/${contract.id}/annexes`, kt, { number: 'VERIFY-ANNEX', effectiveFrom: '2026-02-01', signedDate: '2026-01-30', content: 'Điều khoản kiểm chứng bảo mật' });
      assert.equal(annex.status, 201, JSON.stringify(annex.body));
      const row = await db.contractAnnex.findUnique({ where: { id: annex.body.annex.id } });
      assert.ok(!JSON.stringify(row).includes('Điều khoản kiểm chứng bảo mật'));
      const read = await request(`/employees/${employee.id}/contracts`, kt);
      assert.equal(read.body.items.find(c => c.id === contract.id).annexes[0].content, 'Điều khoản kiểm chứng bảo mật');
      const audit = await db.auditLog.findMany({ where: { entityId: contract.id }, select: { oldValue: true, newValue: true } });
      assert.ok(!JSON.stringify(audit).includes('9000000'));
    });
    await t.test('Probation ratio, duration and invalid calendar dates enforce legal boundaries', async () => {
      const base = { ...payload, type: 'PROBATION', number: 'VERIFY-TRIAL', endDate: '2026-03-01', salary: '8500000', officialSalary: '10000000', probationClass: 'TECHNICAL' };
      const valid = await request(`/employees/${employee.id}/contracts`, kt, base);
      assert.equal(valid.status, 201, JSON.stringify(valid.body));
      for (const patch of [
        { number: 'TRIAL-LOW', salary: '8499999' },
        { number: 'TRIAL-LONG', endDate: '2026-03-02' },
        { number: 'WORKER-LONG', probationClass: 'WORKER', endDate: '2026-01-31' },
        { number: 'BAD-DATE', signedDate: '2026-02-30' },
      ]) assert.equal((await request(`/employees/${employee.id}/contracts`, kt, { ...base, ...patch })).status, 400);
    });
    await t.test('A third active fixed-term contract is forbidden', async () => {
      const second = await request(`/employees/${employee.id}/contracts`, kt, { ...payload, number: "FIXED-SECOND", startDate: "2027-01-01", endDate: "2027-12-31", signedDate: "2026-01-01" });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.equal((await request(`/employees/${employee.id}/contracts/${second.body.contract.id}/activate`, kt, {})).status, 201);
      const third = await request(`/employees/${employee.id}/contracts`, kt, { ...payload, number: "FIXED-THIRD", startDate: "2028-01-01", endDate: "2028-12-31", signedDate: "2026-01-01" });
      const result = third.status === 201 ? await request(`/employees/${employee.id}/contracts/${third.body.contract.id}/activate`, kt, {}) : third;
      assert.ok([400, 409].includes(result.status), JSON.stringify(result.body));
      assert.equal(await db.employmentContract.count({ where: { employeeId: employee.id, type: 'FIXED_TERM', status: 'ACTIVE' } }), 2);
    });
    await t.test('Effective transfer preserves both date boundaries and removes moved-out scope access', async () => {
      const move = await request(`/employees/${employee.id}/transfers`, kt, { toOrgUnitId: other.id, effectiveFrom: '2026-03-01', decisionNumber: 'VERIFY-MOVE-1', decisionDate: '2026-02-27', reason: 'Điều chuyển kiểm chứng' });
      assert.equal(move.status, 201, JSON.stringify(move.body));
      const before = await request(`/employees/${employee.id}/assignments?asOf=2026-02-28`, kt);
      const after = await request(`/employees/${employee.id}/assignments?asOf=2026-03-01`, kt);
      assert.equal(before.body.currentOrgUnitId, source.id); assert.equal(after.body.currentOrgUnitId, other.id);
      assert.ok([403, 404].includes((await request(`/employees/${employee.id}/assignments?asOf=2026-02-28`, tt)).status));
      const cross = await request(`/employees/${employee.id}/transfers`, ktbn, { toOrgUnitId: remote.id, effectiveFrom: '2026-04-01', decisionNumber: 'VERIFY-DENIED', decisionDate: '2026-03-28', reason: 'Ngoài phạm vi' });
      assert.equal(cross.status, 403);
      const secondMove = await request(`/employees/${employee.id}/transfers`, kt, { toOrgUnitId: remote.id, effectiveFrom: '2026-04-01', decisionNumber: 'VERIFY-MOVE-2', decisionDate: '2026-03-28', reason: 'Đổi cơ sở' });
      assert.equal(secondMove.status, 201, JSON.stringify(secondMove.body));
      assert.ok([403, 404].includes((await request(`/employees/${employee.id}/contracts`, ktbn)).status));
      assert.equal((await request('/employees?search=VERIFY-HR', ktbn)).body.total, 0);
      const persisted = await request(`/employees/${employee.id}`, kt);
      assert.equal(persisted.body.employee.orgUnit.id, remote.id);
    });
    await t.test('Dated legal version preserves historical value and rejects backdated overlap', async () => {
      const result = await request('/settings/parameters', ad, { paramCode: 'MIN_WAGE_MONTH_I', scopeKey: 'GLOBAL', subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '6666666', unit: 'VND/month', effectiveFrom: '2027-01-01', documentEffectiveDate: '2027-01-01', legalBasis: 'Quyết định kiểm chứng có hiệu lực tương lai' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const history = await request('/settings/parameters?paramCode=MIN_WAGE_MONTH_I&asOf=2026-12-31', ad);
      const next = await request('/settings/parameters?paramCode=MIN_WAGE_MONTH_I&asOf=2027-01-01', ad);
      assert.equal(String(history.body.items[0].value), '5310000'); assert.equal(String(next.body.items[0].value), '6666666');
      const conflict = await request('/settings/parameters', ad, { ...result.body.parameter, id: undefined, createdAt: undefined, effectiveFrom: '2026-06-01', effectiveTo: '2027-02-01' });
      assert.ok([400, 409].includes(conflict.status));
      assert.equal((await request('/settings/parameters', kt)).status, 403);
    });
    await t.test('Nearest cutoff policy wins and day 31 is clamped in February', async () => {
      const department = context.units.find(u => u.code === 'NM-BN-D1');
      const result = await request('/settings/policies', ad, { orgUnitId: department.id, policyKey: 'CUTOFF_DAY', value: 31, status: 'SIMULATION', decisionReference: 'VERIFY-DECISION', effectiveFrom: '2027-02-01' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const resolved = await request(`/settings/policies/resolve?orgUnitId=${other.id}&asOf=2027-02-01&policyKey=CUTOFF_DAY`, ad);
      assert.equal(resolved.body.value, 31); assert.equal(resolved.body.sourceOrgUnitId, department.id);
      const preview = await request(`/periods/preview?scopeOrgUnitId=${other.id}&month=2027-02`, ad);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.dateFrom, '2027-02-01'); assert.equal(preview.body.dateTo, '2027-02-28');
      const historical = await request(`/settings/policies/resolve?orgUnitId=${other.id}&asOf=2027-01-31&policyKey=CUTOFF_DAY`, ad);
      assert.equal(historical.body.value, 25); assert.equal(historical.body.sourceOrgUnitId, site.id);
    });
    await t.test('A locked ancestor period blocks retrospective personnel changes', async () => {
      const created = await request('/periods', ad, { code: 'VERIFY-LOCKED', scopeOrgUnitId: site.id, month: '2026-03' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      await db.businessPeriod.update({ where: { id: created.body.period.id }, data: { status: 'LOCKED' } });
      const move = await request(`/employees/${employee.id}/transfers`, kt, { toOrgUnitId: source.id, effectiveFrom: '2026-03-15', decisionNumber: 'VERIFY-LOCKED-MOVE', decisionDate: '2026-03-14', reason: 'Không được sửa kỳ đã khóa' });
      assert.equal(move.status, 409, JSON.stringify(move.body));
      const after = await request(`/employees/${employee.id}/assignments?asOf=2026-03-15`, kt);
      assert.equal(after.body.currentOrgUnitId, other.id);
    });
    await t.test('Transfer checks the changed interval, but does not block an assignment ending before a frozen period', async () => {
      const fresh = await employeeFixture('VERIFY-LOCK-RANGE');
      const move = await request('/employees/' + fresh.id + '/transfers', kt, { toOrgUnitId: other.id, effectiveFrom: '2026-02-01', decisionNumber: 'RANGE-BLOCKED', decisionDate: '2026-01-31', reason: 'Khoảng thay đổi giao kỳ khóa tháng 3' });
      assert.equal(move.status, 409, JSON.stringify(move.body));
      const unchanged = await request('/employees/' + fresh.id + '/assignments?asOf=2026-03-01', kt);
      assert.equal(unchanged.body.currentOrgUnitId, source.id);
      assert.equal(await db.personnelTransfer.count({ where: { employeeId: fresh.id } }), 0);

      const bounded = await employeeFixture('VERIFY-BOUNDED-MOVE');
      await db.orgAssignment.updateMany({ where: { employeeId: bounded.id }, data: { effectiveTo: new Date('2026-01-31') } });
      await db.orgAssignment.create({ data: { employeeId: bounded.id, orgUnitId: remote.id, isPrimary: true, allocationRatio: '100', effectiveFrom: new Date('2026-02-01') } });
      const allowed = await request('/employees/' + bounded.id + '/transfers', kt, { toOrgUnitId: other.id, effectiveFrom: '2026-01-15', decisionNumber: 'BOUNDED-ALLOWED', decisionDate: '2026-01-15', reason: 'Không thay đổi phân công trong kỳ khóa' });
      assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
      assert.equal((await request('/employees/' + bounded.id + '/assignments?asOf=2026-01-31', kt)).body.currentOrgUnitId, other.id);
      assert.equal((await request('/employees/' + bounded.id + '/assignments?asOf=2026-02-01', kt)).body.currentOrgUnitId, remote.id);
    });
    await t.test('Frozen parameter protection respects site, region, inclusive boundaries and predecessor truncation', async () => {
      const common = { paramCode: 'PROBATION_MIN_RATIO', subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '0.86', unit: 'ratio', documentEffectiveDate: '2026-01-01', legalBasis: 'Tham số hồi quy phạm vi và khoảng hiệu lực' };
      const remoteSite = context.units.find(unit => unit.code === 'NM-NA');
      const separateSite = await request('/settings/parameters', ad, { ...common, scopeKey: 'SITE:' + remoteSite.siteId, effectiveFrom: '2026-03-01', effectiveTo: '2026-03-25' });
      assert.equal(separateSite.status, 201, JSON.stringify(separateSite.body));
      const before = await request('/settings/parameters', ad, { ...common, scopeKey: 'SITE:' + site.siteId, effectiveFrom: '2026-02-01', effectiveTo: '2026-02-25' });
      assert.equal(before.status, 201, JSON.stringify(before.body));
      const boundary = await request('/settings/parameters', ad, { ...common, scopeKey: 'SITE:' + site.siteId, effectiveFrom: '2026-02-26', effectiveTo: '2026-03-25' });
      assert.equal(boundary.status, 409, JSON.stringify(boundary.body));
      const separateRegion = await request('/settings/parameters', ad, { ...common, scopeKey: 'REGION:III', effectiveFrom: '2026-03-01', effectiveTo: '2026-03-25' });
      assert.equal(separateRegion.status, 201, JSON.stringify(separateRegion.body));
      const sameRegion = await request('/settings/parameters', ad, { ...common, scopeKey: 'REGION:I', effectiveFrom: '2026-03-01', effectiveTo: '2026-03-25' });
      assert.equal(sameRegion.status, 409, JSON.stringify(sameRegion.body));
      const truncation = await request('/settings/parameters', ad, { ...common, scopeKey: 'GLOBAL', effectiveFrom: '2026-02-01', effectiveTo: '2026-02-25' });
      assert.equal(truncation.status, 409, JSON.stringify(truncation.body));
      const global = (await request('/settings/parameters?scopeKey=GLOBAL&paramCode=PROBATION_MIN_RATIO&asOf=2026-03-01', ad)).body.items[0];
      assert.equal(global.value, '0.85'); assert.equal(global.effectiveTo, null);
    });
    await t.test('Custom periods reject dates before scope exists and valid dates remain listable and openable', async () => {
      const remoteSite = context.units.find(unit => unit.code === 'NM-NA');
      const invalid = await request('/periods', ad, { code: 'VERIFY-ORPHAN', scopeOrgUnitId: remoteSite.id, month: '2027-01', dateFrom: '2025-12-01', dateTo: '2025-12-31' });
      assert.equal(invalid.status, 403, JSON.stringify(invalid.body));
      assert.equal(await db.businessPeriod.count({ where: { code: 'VERIFY-ORPHAN' } }), 0);
      const valid = await request('/periods', ad, { code: 'VERIFY-CUSTOM', scopeOrgUnitId: remoteSite.id, month: '2027-05', dateFrom: '2027-04-02', dateTo: '2027-04-29' });
      assert.equal(valid.status, 201, JSON.stringify(valid.body));
      const listed = (await request('/periods', ad)).body.items.find(period => period.id === valid.body.period.id);
      assert.equal(listed.dateFrom, '2027-04-02'); assert.equal(listed.dateTo, '2027-04-29');
      const opened = await request('/periods/' + valid.body.period.id + '/open', ad, { revision: listed.revision });
      assert.equal(opened.status, 201, JSON.stringify(opened.body)); assert.equal(opened.body.period.status, 'OPEN');
    });
    await t.test('A decision after its effective date returns 400 without changing personnel; equal dates are valid', async () => {
      const fresh = await employeeFixture('VERIFY-DECISION-DATE');
      const common = { toOrgUnitId: other.id, effectiveFrom: '2026-06-01', decisionNumber: 'DECISION-DATE', reason: 'Kiểm chứng thứ tự ngày quyết định' };
      const invalid = await request('/employees/' + fresh.id + '/transfers', kt, { ...common, decisionDate: '2026-06-02' });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      assert.equal(await db.personnelTransfer.count({ where: { employeeId: fresh.id } }), 0);
      assert.equal((await request('/employees/' + fresh.id + '/assignments?asOf=2026-06-01', kt)).body.currentOrgUnitId, source.id);
      const valid = await request('/employees/' + fresh.id + '/transfers', kt, { ...common, decisionDate: '2026-06-01' });
      assert.equal(valid.status, 201, JSON.stringify(valid.body));
      assert.equal((await request('/employees/' + fresh.id + '/assignments?asOf=2026-06-01', kt)).body.currentOrgUnitId, other.id);
    });
    await t.test('Frozen transfer protection follows a parent change occurring after the transfer date', async () => {
      const fresh = await employeeFixture('VERIFY-PARENT-MOVE', remote);
      const department = context.units.find(unit => unit.code === 'NM-NA-D2');
      const version = await db.orgUnitVersion.findFirstOrThrow({ where: { orgUnitId: remote.id } });
      await db.orgUnitVersion.update({ where: { id: version.id }, data: { effectiveTo: new Date('2026-02-28') } });
      await db.orgUnitVersion.create({ data: { ...version, id: undefined, parentId: department.id, effectiveFrom: new Date('2026-03-01'), effectiveTo: null } });
      const period = await request('/periods', ad, { code: 'VERIFY-DATED-PARENT', scopeOrgUnitId: department.id, month: '2026-03' });
      assert.equal(period.status, 201, JSON.stringify(period.body));
      await db.businessPeriod.update({ where: { id: period.body.period.id }, data: { status: 'CLOSED' } });
      const target = context.units.find(unit => unit.code === 'NM-NA-D1-T2');
      const move = await request('/employees/' + fresh.id + '/transfers', kt, { toOrgUnitId: target.id, effectiveFrom: '2026-02-01', decisionNumber: 'PARENT-CHANGED', decisionDate: '2026-01-31', reason: 'Phải xét cây tổ chức tại kỳ đóng' });
      assert.equal(move.status, 409, JSON.stringify(move.body));
      assert.equal((await request('/employees/' + fresh.id + '/assignments?asOf=2026-03-01', kt)).body.currentOrgUnitId, remote.id);
    });
    await t.test('A scope gap inside a period blocks creation and opening even when its endpoints are valid', async () => {
      const version = await db.orgUnitVersion.findFirstOrThrow({ where: { orgUnitId: other.id } });
      await db.orgUnitVersion.update({ where: { id: version.id }, data: { effectiveTo: new Date('2026-08-09') } });
      await db.orgUnitVersion.create({ data: { ...version, id: undefined, effectiveFrom: new Date('2026-08-13'), effectiveTo: null } });
      const invalid = await request('/periods', ad, { code: 'VERIFY-GAP', scopeOrgUnitId: other.id, month: '2026-08', dateFrom: '2026-08-01', dateTo: '2026-08-31' });
      assert.equal(invalid.status, 403, JSON.stringify(invalid.body));
      assert.equal(await db.businessPeriod.count({ where: { code: 'VERIFY-GAP' } }), 0);
      const preview = await request('/periods/preview?scopeOrgUnitId=' + other.id + '&month=2026-08', ad);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      const legacy = await db.businessPeriod.create({ data: { code: 'VERIFY-LEGACY-GAP', scopeOrgUnitId: other.id, dateFrom: new Date('2026-08-01'), dateTo: new Date('2026-08-31'), cutoffDay: preview.body.cutoffDay, cutoffPolicyId: preview.body.cutoffPolicyId } });
      const opened = await request('/periods/' + legacy.id + '/open', ad, { revision: legacy.revision });
      assert.equal(opened.status, 403, JSON.stringify(opened.body));
      const unchanged = await db.businessPeriod.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.equal(unchanged.status, 'PLANNED'); assert.equal(unchanged.revision, 0);
    });
    await t.test('Cutoff inheritance previews correct dates; concurrent period overlap and stale open are rejected', async () => {
      const preview = await request(`/periods/preview?scopeOrgUnitId=${site.id}&month=2027-01`, ad);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.dateFrom, '2026-12-26'); assert.equal(preview.body.dateTo, '2027-01-25');
      const results = await Promise.all(['A', 'B'].map(suffix => request('/periods', ad, { code: 'VERIFY-PERIOD-' + suffix, scopeOrgUnitId: site.id, month: '2027-01' })));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      const period = results.find(r => r.status === 201).body.period;
      const open = await request(`/periods/${period.id}/open`, ad, { revision: period.revision });
      assert.equal(open.status, 201, JSON.stringify(open.body)); assert.equal(open.body.period.status, 'OPEN');
      const visibleToTeam = await request("/periods", tt);
      assert.equal(visibleToTeam.body.items.find(item => item.id === period.id)?.status, "OPEN");
      assert.equal((await request(`/periods/${period.id}/open`, ad, { revision: period.revision })).status, 409);
      const next = await request('/periods', ad, { code: 'VERIFY-NEXT', scopeOrgUnitId: site.id, month: '2027-02' });
      assert.equal(next.status, 201, JSON.stringify(next.body));
      assert.equal((await request(`/periods/${next.body.period.id}/open`, ad, { revision: next.body.period.revision })).status, 201);
      assert.equal((await request('/periods', tt, { code: 'FORBIDDEN', scopeOrgUnitId: site.id, month: '2027-03' })).status, 403);
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
