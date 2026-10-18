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

test('Shift scheduling on isolated PostgreSQL and HTTP API', { timeout: 120000 }, async t => {
  const name = 'hrtp_shift_' + randomUUID().replaceAll('-', '');
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
      const res = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const r = await request(path, cookie, body); assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r)); return r.body; }
    const cookies = {};
    for (const username of ['tt.bn', 'qd.bn', 'kt.all', 'kt.bn', 'ad.demo']) {
      const a = credentials.find(a => a.username === username);
      const r = await request('/auth/login', null, { username, password: a.password });
      assert.equal(r.status, 201); cookies[username] = r.cookie;
    }
    const tt = cookies['tt.bn'], qd = cookies['qd.bn'], ad = cookies['ad.demo'], kt = cookies['kt.all'];
    const context = await ok('/organization/context', kt);
    const source = context.units.find(u => u.code === 'NM-BN-D1-T1');
    const other = context.units.find(u => u.code === 'NM-BN-D1-T2');
    const remote = context.units.find(u => u.code === 'NM-NA-D1-T1');
    const company = context.units.find(u => u.code === 'COMPANY');
    const site = context.units.find(u => u.code === 'NM-BN');
    const fixtures = {};
    for (const code of ['NIGHT', 'WEEK', 'RACE', 'MEMBER', 'TRANSFER', 'LOCK', 'POLICY']) fixtures[code] = (await ok('/employees', kt, { code: 'SHIFT-' + code, fullName: 'Nhân sự kiểm chứng ca ' + code, gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: source.id })).employee;
    const foreign = (await ok('/employees', kt, { code: 'SHIFT-FOREIGN', fullName: 'Nhân sự tổ khác', gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: other.id })).employee;
    const shiftInput = { orgUnitId: company.id, code: 'A', name: 'Ca sáng', kind: 'DAY', startTime: '06:00', endTime: '14:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: true };
    let a, c, evening, plan;
    const filters = '?dateFrom=2026-11-01&dateTo=2026-11-30';
    function payload(employeeId, days, shiftId = a.id) { return { title: 'Lịch kiểm chứng', teamOrgUnitId: source.id, slots: days.map(workDate => ({ workDate, shiftId, employeeIds: [employeeId] })) }; }
    await t.test('Definition arithmetic, overnight flags, break boundaries and role separation', async () => {
      a = (await ok('/shifts/definitions', ad, shiftInput)).shift;
      assert.equal(a.workMinutes, 480); assert.equal(a.isNightShift, false);
      c = (await ok('/shifts/definitions', ad, { ...shiftInput, code: 'C', name: 'Ca đêm', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakMinutes: 45 })).shift;
      assert.equal(c.workMinutes, 480); assert.equal(c.isNightShift, true);
      evening = (await ok('/shifts/definitions', ad, { ...shiftInput, code: 'EVENING', name: 'Ca 18 giờ', kind: 'NIGHT', startTime: '18:00', endTime: '02:00', crossesMidnight: true, breakMinutes: 45 })).shift;
      const hc = (await ok('/shifts/definitions', ad, { ...shiftInput, code: 'HC', name: 'Hành chính', kind: 'ADMINISTRATIVE', startTime: '08:00', endTime: '17:00', breakMinutes: 60, paidBreak: false })).shift;
      assert.equal(hc.workMinutes, 480);
      for (const cookie of [tt, qd, kt]) assert.equal((await request('/shifts/definitions', cookie, { ...shiftInput, code: 'DENIED' })).status, 403);
      for (const change of [{ crossesMidnight: false }, { breakMinutes: 30 }, { breakStartOffset: 460 }, { breakStartOffset: 0 }]) assert.equal((await request('/shifts/definitions', ad, { ...shiftInput, ...c, id: undefined, revision: undefined, active: undefined, workMinutes: undefined, isNightShift: undefined, createdAt: undefined, code: 'INVALID', ...change })).status, 400);
      assert.equal((await request('/shifts/definitions', ad, { ...shiftInput, code: 'LONG', endTime: '15:00' })).status, 400);
      assert.equal((await request('/shifts/definitions/' + hc.id + '/update', ad, { ...shiftInput, code: 'HC', name: 'Đổi tên', kind: 'ADMINISTRATIVE', startTime: '08:00', endTime: '17:00', breakMinutes: 60, paidBreak: false, revision: 999 })).status, 409);
    });
    await t.test('Night shift belongs to its start date; only approved rows are official', async () => {
      plan = (await ok('/shifts/plans', tt, payload(fixtures.NIGHT.id, ['2026-11-01'], c.id))).plan;
      assert.equal(plan.status, 'DRAFT'); assert.equal(plan.entries[0].workDate, '2026-11-01');
      assert.equal(plan.entries[0].startAt, '2026-11-01T15:00:00.000Z');
      assert.equal(plan.entries[0].endAt, '2026-11-01T23:00:00.000Z');
      assert.equal((await ok('/shifts/official' + filters, tt)).items.some(e => e.employee.id === fixtures.NIGHT.id), false);
      for (const cookie of [ad, qd, kt]) assert.equal((await request('/shifts/plans', cookie, payload(fixtures.MEMBER.id, ['2026-11-01']))).status, 403);
    });
    await t.test('Adjacent night/morning and duplicate dates rejected atomically; exactly 12h rest accepted', async () => {
      const before = await db.shiftPlan.count();
      const blocked = await request('/shifts/plans', tt, payload(fixtures.NIGHT.id, ['2026-11-02']));
      assert.equal(blocked.status, 409); assert.match(blocked.body.message, /nghỉ chuyển ca/);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.NIGHT.id, ['2026-11-01']))).status, 409);
      assert.equal(await db.shiftPlan.count(), before);
      const next = (await ok('/shifts/plans', tt, payload(fixtures.NIGHT.id, ['2026-11-02'], evening.id))).plan;
      assert.equal(new Date(next.entries[0].startAt) - new Date(plan.entries[0].endAt), 12 * 3600000);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.NIGHT.id, ['2026-11-03']))).status, 409);
    });
    await t.test('Return needs reason; resubmit, stale revision, concurrent approval and immutable final state', async () => {
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
      assert.equal((await ok('/shifts/official' + filters, qd)).items.some(e => e.employee.id === fixtures.NIGHT.id), false);
      assert.equal((await request('/shifts/plans/' + plan.id + '/approve', tt, { revision: plan.revision })).status, 403);
      assert.equal((await request('/shifts/plans/' + plan.id + '/return', qd, { revision: plan.revision, reason: '   ' })).status, 400);
      plan = (await ok('/shifts/plans/' + plan.id + '/return', qd, { revision: plan.revision, reason: 'Điều chỉnh lịch' })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/update', tt, { ...payload(fixtures.NIGHT.id, ['2026-11-01'], c.id), title: 'Lịch sửa sau trả lại', revision: plan.revision })).plan;
      assert.equal(plan.status, 'DRAFT');
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
      assert.equal((await request('/shifts/plans/' + plan.id + '/approve', qd, { revision: 0 })).status, 409);
      const results = await Promise.all([1, 2].map(() => request('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision })));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      plan = results.find(r => r.status === 201).body.plan;
      assert.equal(plan.status, 'APPROVED');
      const official = (await ok('/shifts/official' + filters, tt)).items.filter(e => e.employee.id === fixtures.NIGHT.id);
      assert.equal(official.length, 1); assert.equal(official[0].workDate, '2026-11-01');
      assert.equal((await request('/shifts/plans/' + plan.id + '/update', tt, { ...payload(fixtures.NIGHT.id, ['2026-11-01'], c.id), revision: plan.revision })).status, 409);
      assert.equal((await request('/shifts/plans/' + plan.id + '/cancel', tt, { revision: plan.revision, reason: 'Không được hủy bản chính thức' })).status, 409);
      const detail = await ok('/shifts/plans/' + plan.id, qd);
      assert.deepEqual(detail.history.map(h => h.action), ['CREATE', 'SUBMIT', 'RETURN', 'UPDATE', 'SUBMIT', 'APPROVE']);
      assert.equal(detail.history[2].reason, 'Điều chỉnh lịch'); assert.equal(detail.history[0].snapshot.title, 'Lịch kiểm chứng');
      assert.equal(detail.history[3].snapshot.title, 'Lịch sửa sau trả lại');
      await assert.rejects(() => db.shiftPlanHistory.update({ where: { id: detail.history[0].id }, data: { reason: 'tamper' } }));
      assert.equal((await request('/shifts/definitions/' + c.id + '/update', ad, { ...shiftInput, code: 'C', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakMinutes: 45, revision: c.revision })).status, 409);
    });
    await t.test('48h week inclusive boundary, cross-plan accumulation and Monday reset', async () => {
      const week = Array.from({ length: 7 }, (_, i) => '2026-11-' + String(9 + i).padStart(2, '0'));
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.WEEK.id, week))).status, 409);
      const six = (await ok('/shifts/plans', tt, payload(fixtures.WEEK.id, week.slice(0, 6)))).plan;
      assert.equal(six.entries.reduce((sum, e) => sum + e.workMinutes, 0), 2880);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.WEEK.id, [week[6]]))).status, 409);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.WEEK.id, ['2026-11-16']))).status, 201);
    });
    await t.test('Foreign employee/unit, mixed batch rollback and dated eligibility', async () => {
      const body = payload(fixtures.MEMBER.id, ['2026-12-02']); body.slots[0].employeeIds.push(foreign.id);
      const before = await db.shiftSchedule.count();
      assert.equal((await request('/shifts/plans', tt, body)).status, 403);
      assert.equal(await db.shiftSchedule.count(), before);
      assert.equal((await request('/shifts/plans', tt, { ...payload(fixtures.MEMBER.id, ['2026-12-02']), teamOrgUnitId: remote.id })).status, 403);
      assert.equal((await request('/shifts/members?orgUnitId=' + remote.id + '&workDate=2026-12-02', tt)).status, 403);
      await db.employee.update({ where: { id: fixtures.MEMBER.id }, data: { hireDate: new Date('2026-12-03') } });
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.MEMBER.id, ['2026-12-02']))).status, 403);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.MEMBER.id, ['2026-02-30']))).status, 400);
      await db.employee.update({ where: { id: fixtures.MEMBER.id }, data: { hireDate: new Date('2026-01-01') } });
    });
    await t.test('Whole-unit expansion uses dated primary members; excluded rows cannot be read or mutated', async () => {
      const members = (await ok('/shifts/members?orgUnitId=' + source.id + '&workDate=2026-12-10', tt)).items;
      const team = (await ok('/shifts/plans', tt, { title: 'Toàn tổ', teamOrgUnitId: source.id, slots: [{ workDate: '2026-12-10', shiftId: a.id }] })).plan;
      assert.deepEqual(team.entries.map(e => e.employee.id).sort(), members.map(e => e.id).sort());
      const user = await db.userAccount.findUnique({ where: { username: 'tt.bn' } });
      await db.employeeExclusion.create({ data: { userAccountId: user.id, employeeId: fixtures.MEMBER.id, effectiveFrom: new Date('2026-01-01') } });
      assert.equal((await request('/shifts/plans/' + team.id, tt)).status, 403);
      assert.equal((await ok('/shifts/plans?dateFrom=2026-12-10&dateTo=2026-12-10', tt)).items.some(p => p.id === team.id), false);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.MEMBER.id, ['2026-12-11']))).status, 403);
      await db.employeeExclusion.deleteMany({ where: { userAccountId: user.id, employeeId: fixtures.MEMBER.id } });
    });
    await t.test('Concurrent overlapping plan creation commits at most one reservation', async () => {
      const results = await Promise.all([1, 2].map(i => request('/shifts/plans', tt, { ...payload(fixtures.RACE.id, ['2026-12-20']), title: 'Race ' + i })));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      assert.equal(await db.shiftSchedule.count({ where: { employeeId: fixtures.RACE.id, workDate: new Date('2026-12-20') } }), 1);
    });
    await t.test('Approval rechecks availability; return/cancel remains possible after definition retirement', async () => {
      const spare = (await ok('/shifts/definitions', ad, { ...shiftInput, code: 'SPARE' })).shift;
      let draft = (await ok('/shifts/plans', tt, payload(fixtures.MEMBER.id, ['2026-12-21'], spare.id))).plan;
      draft = (await ok('/shifts/plans/' + draft.id + '/submit', tt, { revision: draft.revision })).plan;
      await ok('/shifts/definitions/' + spare.id + '/active', ad, { revision: spare.revision, active: false });
      assert.equal((await request('/shifts/plans/' + draft.id + '/approve', qd, { revision: draft.revision })).status, 409);
      draft = (await ok('/shifts/plans/' + draft.id + '/return', qd, { revision: draft.revision, reason: 'Ca ngừng dùng' })).plan;
      assert.equal((await ok('/shifts/plans/' + draft.id + '/cancel', tt, { revision: draft.revision, reason: 'Lập lịch khác' })).plan.status, 'CANCELLED');
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.MEMBER.id, ['2026-12-21']))).status, 201);
    });
    await t.test('Pending/approved assignment cannot be invalidated by a personnel transfer', async () => {
      let draft = (await ok('/shifts/plans', tt, payload(fixtures.TRANSFER.id, ['2026-12-01']))).plan;
      draft = (await ok('/shifts/plans/' + draft.id + '/submit', tt, { revision: draft.revision })).plan;
      const result = await request('/employees/' + fixtures.TRANSFER.id + '/transfers', kt, { toOrgUnitId: other.id, effectiveFrom: '2026-11-30', decisionDate: '2026-11-29', decisionNumber: 'SHIFT-BLOCK-TRANSFER', reason: 'Không được làm sai lịch đã gửi' });
      assert.equal(result.status, 409, JSON.stringify(result)); assert.match(result.body.message, /lịch ca/);
    });
    await t.test('Ancestor frozen period blocks schedule; overnight ownership stays with start date', async () => {
      const draft = (await ok('/shifts/plans', tt, payload(fixtures.LOCK.id, ['2027-02-20']))).plan;
      let pending = (await ok('/shifts/plans', tt, payload(fixtures.LOCK.id, ['2027-02-21']))).plan;
      pending = (await ok('/shifts/plans/' + pending.id + '/submit', tt, { revision: pending.revision })).plan;
      const period = (await ok('/periods', ad, { code: 'SHIFT-LOCK', scopeOrgUnitId: site.id, month: '2027-02', dateFrom: '2027-02-01', dateTo: '2027-02-25' })).period;
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'LOCKED' } });
      assert.equal((await request('/shifts/plans/' + draft.id + '/update', tt, { ...payload(fixtures.LOCK.id, ['2027-01-28']), revision: draft.revision })).status, 409);
      assert.equal((await request('/shifts/plans/' + draft.id + '/cancel', tt, { revision: draft.revision, reason: 'Kỳ đã khóa' })).status, 409);
      assert.equal((await request('/shifts/plans/' + pending.id + '/return', qd, { revision: pending.revision, reason: 'Kỳ đã khóa' })).status, 409);
      assert.equal((await ok('/shifts/plans/' + draft.id, tt)).plan.entries[0].workDate, '2027-02-20');
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.LOCK.id, ['2027-02-25'], c.id))).status, 409);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.LOCK.id, ['2027-01-31'], c.id))).status, 201);
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    });
    await t.test('Removed employees in historical snapshots retain current scope protection after transfer', async () => {
      let historical = (await ok('/shifts/plans', tt, payload(fixtures.RACE.id, ['2026-11-22']))).plan;
      historical = (await ok('/shifts/plans/' + historical.id + '/update', tt, { ...payload(fixtures.MEMBER.id, ['2026-11-22']), revision: historical.revision })).plan;
      await ok('/employees/' + fixtures.RACE.id + '/transfers', kt, { toOrgUnitId: other.id, effectiveFrom: '2026-10-18', decisionDate: '2026-10-17', decisionNumber: 'SHIFT-HISTORY-TRANSFER', reason: 'Kiểm chứng phạm vi lịch sử' });
      assert.equal((await request('/shifts/plans/' + historical.id, tt)).status, 403);
      const permitted = await ok('/shifts/plans/' + historical.id, kt);
      assert.equal(permitted.history[0].snapshot.entries[0].employee.id, fixtures.RACE.id);
      assert.equal(permitted.plan.entries[0].employee.id, fixtures.MEMBER.id);
    });
    await t.test('Site rule overrides global rule by work date without relaxing legal floors', async () => {
      const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId: site.id }, select: { siteId: true } });
      await db.legalParameter.create({ data: { paramCode: 'SHIFT_MIN_REST_MINUTES', scopeKey: 'SITE:' + version.siteId, subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '900', unit: 'minute', effectiveFrom: new Date('2026-12-01'), effectiveTo: new Date('2026-12-01'), documentEffectiveDate: new Date('2026-12-01'), legalBasis: 'Nghỉ chuyển ca 15 giờ theo chính sách kiểm chứng' } });
      await ok('/shifts/plans', tt, payload(fixtures.POLICY.id, ['2026-12-01'], c.id));
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.POLICY.id, ['2026-12-02'], evening.id))).status, 409);
      assert.equal((await request('/shifts/plans', tt, payload(fixtures.POLICY.id, ['2026-12-02'], c.id))).status, 201);
    });
  } finally {
    if (server && server.exitCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill(); await stopped; }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
