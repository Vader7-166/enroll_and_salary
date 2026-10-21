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

test('Actual OT reconciliation on isolated PostgreSQL and HTTP', { timeout: 150000 }, async t => {
  const name = 'hrtp_actual_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let server, db, serverLogs = "";
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const accounts = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(r => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port; await new Promise(r => listener.close(r));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(new Error("Readiness: " + serverLogs)), 15000);
      const receive = chunk => { serverLogs += chunk; if (serverLogs.includes("API ready at")) { clearTimeout(timer); ready(); } };
      server.stdout.on('data', receive); server.stderr.on('data', receive);
      server.once("exit", code => { clearTimeout(timer); reject(new Error("API exited " + code + ": " + serverLogs)); });
    });
    async function request(path, cookie, body) {
      const form = body instanceof FormData;
      const res = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const r = await request(path, cookie, body); assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r) + (r.status >= 500 ? "\n" + serverLogs : "")); return r.body; }
    const cookies = {};
    for (const username of ['tt.bn', 'qd.bn', 'kt.all', 'ad.demo']) {
      const a = accounts.find(a => a.username === username);
      cookies[username] = (await request('/auth/login', null, { username, password: a.password })).cookie;
    }
    const tt = cookies['tt.bn'], qd = cookies['qd.bn'], kt = cookies['kt.all'], ad = cookies['ad.demo'];
    const context = await ok('/organization/context', kt);
    const source = context.units.find(u => u.code === 'NM-BN-D1-T1');
    const other = context.units.find(u => u.code === 'NM-BN-D1-T2');
    const remote = context.units.find(u => u.code === 'NM-NA-D1-T1');
    const company = context.units.find(u => u.code === 'COMPANY');
    const siteUnit = context.units.find(u => u.code === 'NM-BN');
    const site = await db.site.findUnique({ where: { code: 'NM-BN' } });
    const author = await db.userAccount.findUnique({ where: { username: 'tt.bn' } });
    const people = {};
    for (const [code, unit] of [['NIGHT', source], ['PARTIAL', source], ['MISSING', source], ['PENDING', source], ['NONE', source], ['YEAR', source], ['OTHER', other]]) {
      people[code] = (await ok('/employees', kt, { code: 'ACT-' + code, fullName: 'Nhân sự đối chiếu ' + code, gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: unit.id })).employee;
    }
    const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'ACT-N', name: 'Ca đêm đối chiếu', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true })).shift;
    let plan = (await ok('/shifts/plans', tt, { title: 'Ca đêm có OT nối tiếp', teamOrgUnitId: source.id, slots: [{ workDate: '2026-09-30', shiftId: shift.id, employeeIds: [people.NIGHT.id] }] })).plan;
    plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
    await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision });
    async function period(code, month, dateFrom, dateTo) {
      const p = (await ok('/periods', ad, { code, scopeOrgUnitId: siteUnit.id, month, dateFrom, dateTo })).period;
      return (await ok('/periods/' + p.id + '/open', ad, { revision: p.revision })).period;
    }
    const october = await period('ACT-OCT', '2026-10', '2026-09-26', '2026-10-25');
    const january = await period('ACT-JAN', '2027-01', '2026-12-26', '2027-01-25');
    // Historical approvals are fixtures: the live workflow intentionally forbids retroactive approval.
    async function approved(code, workDate, startAt, endAt, status = 'APPROVED', unit = source) {
      return db.overtimeRequest.create({ data: { teamOrgUnitId: unit.id, title: 'OT đối chiếu ' + code, workDate: new Date(workDate), startAt: new Date(startAt + '+07:00'), endAt: new Date(endAt + '+07:00'), requestedMinutes: (Date.parse(endAt + '+07:00') - Date.parse(startAt + '+07:00')) / 60000, reason: 'Fixture đối chiếu chứng từ đã duyệt', status, createdById: author.id, members: { create: { employeeId: people[code].id, consentReference: 'CONSENT-' + code } } } });
    }
    await approved('NIGHT', '2026-09-30', '2026-10-01T06:00:00', '2026-10-01T08:00:00');
    await approved('PARTIAL', '2026-10-04', '2026-10-04T20:00:00', '2026-10-04T23:00:00');
    await approved('MISSING', '2026-10-05', '2026-10-05T17:00:00', '2026-10-05T19:00:00');
    await approved('PENDING', '2026-10-06', '2026-10-06T17:00:00', '2026-10-06T19:00:00', 'PENDING');
    await approved('OTHER', '2026-10-04', '2026-10-04T17:00:00', '2026-10-04T19:00:00', 'APPROVED', other);
    await approved('YEAR', '2026-12-31', '2026-12-31T21:00:00', '2027-01-01T01:00:00');
    const line = (code, date, time, direction) => [people[code].code, date, time, 'MAY-OT', direction].join(',');
    async function upload(lines, periodId = october.id, cookie = ad) {
      const form = new FormData(); form.set('file', new Blob([lines.join('\n')]), 'actual.csv'); form.set('siteId', site.id); form.set('referencePeriodId', periodId);
      return ok('/attendance/imports', cookie, form);
    }
    let night, partial, missing, none, pending, foreign, year;
    await t.test('Import extends overnight exit to approved OT without adding regular minutes', async () => {
      const { batch } = await upload([
        line('NIGHT', '2026-09-30', '22:00:00', 'IN'), line('NIGHT', '2026-10-01', '08:10:00', 'OUT'),
        line('PARTIAL', '2026-10-04', '20:10:00', 'IN'), line('PARTIAL', '2026-10-04', '22:50:00', 'OUT'),
        line('MISSING', '2026-10-05', '17:00:00', 'IN'),
        line('PENDING', '2026-10-06', '17:00:00', 'IN'), line('PENDING', '2026-10-06', '19:00:00', 'OUT'),
        line('NONE', '2026-10-07', '10:00:00', 'IN'), line('NONE', '2026-10-07', '12:00:00', 'OUT'),
        line('OTHER', '2026-10-04', '17:00:00', 'IN'), line('OTHER', '2026-10-04', '19:00:00', 'OUT'),
      ]);
      assert.notEqual(batch.status, 'REJECTED', JSON.stringify(batch));
      const board = await ok('/attendance/overtime-actuals?periodId=' + october.id + '&pageSize=100', tt);
      night = board.items.find(r => r.employee.id === people.NIGHT.id && r.workDate === '2026-09-30');
      assert.deepEqual(board.items.filter(r => r.employee.id === people.NIGHT.id).map(r => r.workDate), ["2026-09-30"]);
      partial = board.items.find(r => r.employee.id === people.PARTIAL.id);
      missing = board.items.find(r => r.employee.id === people.MISSING.id);
      pending = board.items.find(r => r.employee.id === people.PENDING.id);
      none = board.items.find(r => r.employee.id === people.NONE.id);
      assert.deepEqual([night.requestedMinutes, night.approvedMinutes, night.actualMinutes, night.eligibleMinutes, night.dayMinutes, night.nightMinutes, night.unapprovedMinutes], [120, 120, 130, 120, 120, 0, 10]);
      assert.ok(night.flags.includes('UNAPPROVED_WORK'));
      const regular = (await ok('/attendance/board?periodId=' + october.id, tt)).items.find(r => r.employee.id === people.NIGHT.id);
      assert.equal(regular.workedMinutes, 480); assert.equal(regular.nightMinutes, 480); assert.equal(regular.workUnits, '1'); assert.equal(regular.status, 'OK');
      assert.equal(regular.checkOutAt, '2026-10-01T01:10:00.000Z');
    });
    await t.test('Partial actual time splits day/night; missing and nonapproved work never get eligibility', async () => {
      assert.deepEqual([partial.approvedMinutes, partial.actualMinutes, partial.eligibleMinutes, partial.dayMinutes, partial.nightMinutes, partial.unworkedApprovedMinutes], [180, 160, 160, 110, 50, 20]);
      assert.ok(partial.flags.includes('APPROVED_NOT_WORKED'));
      assert.equal(missing.actualMinutes, 0); assert.equal(missing.eligibleMinutes, 0); assert.ok(missing.flags.includes('MISSING_OUT'));
      const md = await ok('/attendance/overtime-actuals/' + missing.id, tt);
      assert.equal(md.pairs[0].checkOutAt, null);
      assert.deepEqual([pending.requestedMinutes, pending.approvedMinutes, pending.actualMinutes, pending.eligibleMinutes], [120, 0, 120, 0]);
      assert.deepEqual([none.requestedMinutes, none.approvedMinutes, none.actualMinutes, none.eligibleMinutes], [0, 0, 120, 0]);
      assert.ok(none.flags.includes('UNAPPROVED_WORK'));
      const detail = await ok('/attendance/overtime-actuals/' + night.id, tt);
      assert.equal(detail.requests[0].consentReference, 'CONSENT-NIGHT');
      assert.equal(detail.requests[0].status, 'APPROVED');
      assert.deepEqual(detail.punches.map(p => [p.direction, p.deviceCode, p.rowNumber]), [['IN', 'MAY-OT', 1], ['OUT', 'MAY-OT', 2]]);
      assert.equal(detail.punches[0].source[0], people.NIGHT.code);
      assert.deepEqual(detail.segments.map(s => [s.calendarDate, s.minutes, s.eligible]), [['2026-10-01', 120, true], ['2026-10-01', 10, false]]);
      assert.deepEqual((await ok('/attendance/overtime-actuals/' + night.id, tt)), detail);
    });
    await t.test('Cross-year segments retain business date, exact calendar dates and eligible day/night totals', async () => {
      await upload([line('YEAR', '2026-12-31', '21:00:00', 'IN'), line('YEAR', '2027-01-01', '01:00:00', 'OUT')], january.id);
      year = (await ok('/attendance/overtime-actuals?periodId=' + january.id, tt)).items.find(r => r.employee.id === people.YEAR.id);
      assert.equal(year.workDate, '2026-12-31'); assert.equal(year.periodId, january.id); assert.equal(year.eligibleMinutes, 240);
      assert.deepEqual([year.dayMinutes, year.nightMinutes], [60, 180]);
      const detail = await ok('/attendance/overtime-actuals/' + year.id, tt);
      assert.deepEqual(detail.segments.map(s => [s.calendarDate, s.kind, s.minutes]), [['2026-12-31', 'DAY', 60], ['2026-12-31', 'NIGHT', 120], ['2027-01-01', 'NIGHT', 60]]);
    });
    await t.test('Board/detail/search/aggregate/exceptions all honor current and historical scope', async () => {
      assert.equal((await request('/attendance/overtime-actuals?periodId=' + october.id, null)).status, 401);
      const accounting = await ok('/attendance/overtime-actuals?periodId=' + october.id + '&pageSize=100', kt);
      foreign = accounting.items.find(r => r.employee.id === people.OTHER.id);
      assert.equal((await request('/attendance/overtime-actuals/' + foreign.id, tt)).status, 404);
      const own = await ok('/attendance/overtime-actuals?periodId=' + october.id + '&pageSize=100', tt);
      assert.equal(own.items.some(r => r.id === foreign.id), false);
      assert.equal(own.summary.eligibleMinutes, own.items.reduce((s, r) => s + r.eligibleMinutes, 0));
      const filtered = await ok('/attendance/overtime-actuals?periodId=' + october.id + '&exceptionsOnly=true&search=ACT-PARTIAL', tt);
      assert.deepEqual(filtered.items.map(r => r.id), [partial.id]); assert.equal(filtered.summary.eligibleMinutes, 160);
      assert.equal((await request('/attendance/process', tt, { siteId: site.id, referencePeriodId: october.id })).status, 403);
      await db.employeeExclusion.create({ data: { userAccountId: author.id, employeeId: people.PARTIAL.id, effectiveFrom: new Date('2026-10-04'), effectiveTo: new Date('2026-10-04') } });
      assert.equal((await request('/attendance/overtime-actuals/' + partial.id, tt)).status, 404);
      assert.equal((await ok('/attendance/overtime-actuals?periodId=' + october.id + '&search=ACT-PARTIAL', tt)).total, 0);
      await db.orgAssignment.updateMany({ where: { employeeId: people.NONE.id }, data: { effectiveTo: new Date('2026-10-08') } });
      await db.orgAssignment.create({ data: { employeeId: people.NONE.id, orgUnitId: remote.id, isPrimary: true, allocationRatio: 100, effectiveFrom: new Date('2026-10-09') } });
      assert.equal((await request('/attendance/overtime-actuals/' + none.id, tt)).status, 404);
    });
    await t.test('Closed target and locked ancestor retain exact results while preserving late raw input', async () => {
      const before = await db.overtimeActual.findUnique({ where: { id: night.id } });
      await db.businessPeriod.update({ where: { id: october.id }, data: { status: 'CLOSED' } });
      await assert.rejects(db.overtimeActual.update({ where: { id: night.id }, data: { eligibleMinutes: 119, dayMinutes: 119, unapprovedMinutes: 11, unworkedApprovedMinutes: 1 } }), /PERIOD_STATE_CONFLICT/);
      const { batch } = await upload([line('NIGHT', '2026-10-01', '08:15:00', 'OUT')]);
      assert.equal(batch.summary.inserted, 1);
      assert.deepEqual(await db.overtimeActual.findUnique({ where: { id: night.id } }), before);
      await db.businessPeriod.update({ where: { id: october.id }, data: { status: 'OPEN' } });
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: october.id });
      const after = await ok('/attendance/overtime-actuals/' + night.id, tt);
      assert.equal(after.actual.eligibleMinutes, 120); assert.equal(after.actual.actualMinutes, 135);
      assert.equal(after.punches.some(p => p.punchedAt === '2026-10-01T01:15:00.000Z'), true);
      const lockedBefore = await db.overtimeActual.findUniqueOrThrow({ where: { id: night.id } });
      const ancestor = await db.businessPeriod.create({ data: { code: "ACT-ANCESTOR", scopeOrgUnitId: company.id, periodType: "ATTENDANCE", dateFrom: new Date("2026-09-26"), dateTo: new Date("2026-10-25"), cutoffDay: 25, cutoffPolicyId: october.cutoffPolicyId, status: "LOCKED" } });
      await assert.rejects(db.overtimeActual.delete({ where: { id: night.id } }), /PERIOD_STATE_CONFLICT/);
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: october.id });
      assert.deepEqual(await db.overtimeActual.findUnique({ where: { id: night.id } }), lockedBefore);
    });
    await t.test("End-calendar-day locks and exclusions protect a cross-year business-date result", async () => {
      const before = await db.overtimeActual.findUnique({ where: { id: year.id } });
      const lock = await db.businessPeriod.create({ data: { code: "ACT-END-DAY", scopeOrgUnitId: company.id, periodType: "ATTENDANCE", dateFrom: new Date("2027-01-01"), dateTo: new Date("2027-01-01"), cutoffDay: 25, cutoffPolicyId: january.cutoffPolicyId, status: "LOCKED" } });
      await assert.rejects(db.overtimeActual.update({ where: { id: year.id }, data: { flags: ["CHANGED"] } }), /PERIOD_STATE_CONFLICT/);
      await upload([line("YEAR", "2027-01-01", "01:05:00", "OUT")], january.id);
      assert.deepEqual(await db.overtimeActual.findUnique({ where: { id: year.id } }), before);
      await db.employeeExclusion.create({ data: { userAccountId: author.id, employeeId: people.YEAR.id, effectiveFrom: new Date("2027-01-01"), effectiveTo: new Date("2027-01-01") } });
      assert.equal((await request("/attendance/overtime-actuals/" + year.id, tt)).status, 404);
      assert.equal((await ok("/attendance/overtime-actuals?periodId=" + january.id + "&search=ACT-YEAR", tt)).total, 0);
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
