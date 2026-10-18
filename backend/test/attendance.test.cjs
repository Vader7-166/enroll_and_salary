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

test('Attendance imports, routing and access on PostgreSQL and real HTTP', { timeout: 150000 }, async t => {
  const name = 'hrtp_attendance_' + randomUUID().replaceAll('-', '');
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
      let logs = ''; const timer = setTimeout(() => reject(new Error('Readiness: ' + logs)), 15000);
      const receive = chunk => { logs += chunk; if (logs.includes('API ready at')) { clearTimeout(timer); ready(); } };
      server.stdout.on('data', receive); server.stderr.on('data', receive);
      server.once('exit', code => { clearTimeout(timer); reject(new Error('API exited ' + code + ': ' + logs)); });
    });
    async function request(path, cookie, body) {
      const form = body instanceof FormData;
      const res = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const r = await request(path, cookie, body); assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r)); return r.body; }
    const cookies = {};
    for (const username of ['tt.bn', 'qd.bn', 'kt.all', 'kt.bn', 'ad.demo']) {
      const a = credentials.find(a => a.username === username);
      cookies[username] = (await request('/auth/login', null, { username, password: a.password })).cookie;
    }
    const tt = cookies['tt.bn'], qd = cookies['qd.bn'], ad = cookies['ad.demo'], kt = cookies['kt.all'];
    const context = await ok('/organization/context', kt);
    const source = context.units.find(u => u.code === 'NM-BN-D1-T1');
    const other = context.units.find(u => u.code === 'NM-BN-D1-T2');
    const remote = context.units.find(u => u.code === 'NM-NA-D1-T1');
    const company = context.units.find(u => u.code === 'COMPANY');
    const siteUnit = context.units.find(u => u.code === 'NM-BN');
    const site = await db.site.findUnique({ where: { code: 'NM-BN' } });
    const people = {};
    for (const [code, unit] of [['NIGHT', source], ['MISSING', source], ['HC', source], ['WAIT', source], ['OTHER', other], ['REMOTE', remote]]) people[code] = (await ok('/employees', kt, { code: 'PUNCH-' + code, fullName: 'Nhân sự chấm công ' + code, gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: unit.id })).employee;
    const c = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'PC', name: 'Ca đêm', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true })).shift;
    const hc = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'PHC', name: 'Hành chính', kind: 'ADMINISTRATIVE', startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 60, paidBreak: false })).shift;
    async function plan(employee, dates, shift = c, unit = source, approve = true) {
      let p = (await ok('/shifts/plans', tt, { title: 'Lịch công ' + employee.code, teamOrgUnitId: unit.id, slots: dates.map(workDate => ({ workDate, shiftId: shift.id, employeeIds: [employee.id] })) })).plan;
      if (approve) { p = (await ok('/shifts/plans/' + p.id + '/submit', tt, { revision: p.revision })).plan; p = (await ok('/shifts/plans/' + p.id + '/approve', qd, { revision: p.revision })).plan; }
      return p;
    }
    await plan(people.NIGHT, ['2026-10-10', '2026-10-25', '2026-10-26']);
    await plan(people.MISSING, ['2026-10-12']);
    await plan(people.HC, ['2026-10-10'], hc);
    let draft = await plan(people.WAIT, ['2026-10-14'], c, source, false);
    const october = (await ok('/periods', ad, { code: 'ATT-OCT', scopeOrgUnitId: siteUnit.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
    await ok('/periods/' + october.id + '/open', ad, { revision: october.revision });
    const november = (await ok('/periods', ad, { code: 'ATT-NOV', scopeOrgUnitId: siteUnit.id, month: '2026-11', dateFrom: '2026-10-26', dateTo: '2026-11-25' })).period;
    function csv(rows) { return rows.map(r => r.join(',')).join('\n'); }
    async function upload(text, cookie = ad, extra = {}) {
      const form = new FormData(); form.set('file', new Blob([text]), extra.filename || 'punch.csv'); form.set('siteId', site.id); form.set('referencePeriodId', extra.periodId || october.id); if (extra.profileId) form.set('profileId', extra.profileId);
      return request('/attendance/imports', cookie, form);
    }
    function row(code, date, time, direction, device = 'MAY01') { return [people[code].code, date, time, device, direction]; }
    const initial = csv([row('NIGHT', '2026-10-10', '21:58:00', 'IN'), row('NIGHT', '2026-10-10', '22:02:00', 'IN'), row('NIGHT', '2026-10-11', '06:00:00', 'OUT'), row('NIGHT', '2026-10-11', '06:04:00', 'OUT'), row('MISSING', '2026-10-12', '22:00:00', 'IN'), row('HC', '2026-10-10', '08:10:00', 'IN'), row('HC', '2026-10-10', '16:50:00', 'OUT')]);
    let firstBatch, nightDay;
    await t.test('Reject whole batch on invalid date, foreign site or unknown employee; importer role is enforced', async () => {
      const before = await db.rawPunch.count();
      const bad = await upload(csv([row('NIGHT', '2026-10-10', '22:00:00', 'IN'), ['UNKNOWN', '2026-10-10', '22:00:00', 'MAY01', 'IN'], row('REMOTE', '2026-10-10', '22:00:00', 'IN'), row('NIGHT', '2026-02-30', '22:00:00', 'IN')]));
      assert.equal(bad.status, 201); assert.equal(bad.body.batch.status, 'REJECTED');
      assert.deepEqual(bad.body.batch.errors.map(e => e.row).sort(), [2, 3, 4]);
      assert.equal(await db.rawPunch.count(), before);
      assert.equal((await upload(initial, tt)).status, 403);
      assert.equal((await request('/attendance/process', kt, { siteId: site.id, referencePeriodId: october.id })).status, 403);
    });
    await t.test('Real import pairs overnight, preserves suppressed logs and computes unpaid break/late/early', async () => {
      const res = await upload(initial); assert.equal(res.status, 201, JSON.stringify(res.body)); firstBatch = res.body.batch;
      assert.equal(firstBatch.summary.inserted, 7); assert.equal(firstBatch.summary.processed, 7);
      const board = await ok('/attendance/board?periodId=' + october.id, tt);
      nightDay = board.items.find(d => d.employee.id === people.NIGHT.id && d.workDate === '2026-10-10');
      assert.equal(nightDay.workedMinutes, 480); assert.equal(nightDay.nightMinutes, 480); assert.equal(nightDay.dayMinutes, 0); assert.equal(nightDay.workUnits, '1');
      assert.equal(nightDay.checkInAt, '2026-10-10T14:58:00.000Z'); assert.equal(nightDay.checkOutAt, '2026-10-10T23:04:00.000Z');
      const missing = board.items.find(d => d.employee.id === people.MISSING.id);
      assert.equal(missing.status, 'ERR'); assert.ok(missing.flags.includes('MISSING_OUT')); assert.equal(missing.workedMinutes, 0); assert.equal(missing.checkOutAt, null);
      const office = board.items.find(d => d.employee.id === people.HC.id);
      assert.equal(office.workedMinutes, 460); assert.equal(office.dayMinutes, 460); assert.equal(office.lateMinutes, 10); assert.equal(office.earlyMinutes, 10);
      const detail = await ok('/attendance/days/' + nightDay.id, tt);
      assert.equal(detail.punches.filter(p => p.state === 'SUPPRESSED').length, 2);
      for (const punch of detail.punches.filter(p => p.state === "PROCESSED")) assert.equal(punch.reason, null);
      assert.deepEqual(detail.segments.map(s => s.calendarDate), ['2026-10-10', '2026-10-11']);
      assert.equal(detail.punches[0].rowNumber, 1); assert.equal(detail.punches[0].batchId, firstBatch.id);
    });
    await t.test('Exact repeated records do not rewrite days and raw records reject UPDATE/DELETE', async () => {
      const before = await db.dailyAttendance.findUnique({ where: { id: nightDay.id } });
      const repeated = await upload(initial);
      assert.equal(repeated.body.batch.summary.inserted, 0); assert.equal(repeated.body.batch.summary.duplicates, 7);
      assert.deepEqual(await db.dailyAttendance.findUnique({ where: { id: nightDay.id } }), before);
      await assert.rejects(db.$executeRaw`UPDATE raw_punch SET device_code='OTHER' WHERE batch_id=${firstBatch.id}::uuid`, error => error.meta?.code === "42501");
      await assert.rejects(db.$executeRaw`DELETE FROM raw_punch WHERE batch_id=${firstBatch.id}::uuid`, error => error.meta?.code === "42501");
    });
    await t.test('Draft shifts queue logs; approval + explicit processing recovers without raw edits', async () => {
      const queued = await upload(csv([row('WAIT', '2026-10-14', '22:00:00', 'IN'), row('WAIT', '2026-10-15', '06:00:00', 'OUT')]));
      assert.equal(queued.body.batch.summary.waiting, 2);
      assert.equal(await db.dailyAttendance.count({ where: { employeeId: people.WAIT.id } }), 0);
      draft = (await ok('/shifts/plans/' + draft.id + '/submit', tt, { revision: draft.revision })).plan;
      await ok('/shifts/plans/' + draft.id + '/approve', qd, { revision: draft.revision });
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: october.id });
      const d = (await ok('/attendance/board?periodId=' + october.id, tt)).items.find(d => d.employee.id === people.WAIT.id);
      assert.equal(d.workedMinutes, 480); assert.equal(d.workDate, '2026-10-14');
    });
    await t.test('Mixed cutoff file routes Oct25 night into old period; planned destination waits then processes on open', async () => {
      const mixed = await upload(csv([row('NIGHT', '2026-10-25', '22:00:00', 'IN'), row('NIGHT', '2026-10-26', '06:00:00', 'OUT'), row('NIGHT', '2026-10-26', '22:00:00', 'IN'), row('NIGHT', '2026-10-27', '06:00:00', 'OUT')]));
      assert.equal(mixed.body.batch.summary.processed, 2); assert.equal(mixed.body.batch.summary.waiting, 2);
      const old = (await ok('/attendance/board?periodId=' + october.id, tt)).items.find(d => d.workDate === '2026-10-25');
      assert.equal(old.workedMinutes, 480); assert.equal(old.periodId, october.id);
      assert.equal(await db.dailyAttendance.count({ where: { periodId: november.id } }), 0);
      await ok('/periods/' + november.id + '/open', ad, { revision: november.revision });
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: november.id });
      const next = (await ok('/attendance/board?periodId=' + november.id, tt)).items.find(d => d.workDate === '2026-10-26');
      assert.equal(next.workedMinutes, 480); assert.equal(next.periodId, november.id);
    });
    await t.test('Locked destination retains late log, leaves result unchanged and does not block adjacent open period', async () => {
      await db.businessPeriod.update({ where: { id: october.id }, data: { status: 'LOCKED', revision: { increment: 1 } } });
      const before = await db.dailyAttendance.findMany({ where: { periodId: october.id }, orderBy: { id: 'asc' } });
      const late = await upload(csv([row('NIGHT', '2026-10-25', '22:01:00', 'IN'), row('NIGHT', '2026-10-27', '06:10:00', 'OUT')]));
      assert.equal(late.status, 201, JSON.stringify(late.body)); assert.equal(late.body.batch.summary.late, 1); assert.equal(late.body.batch.summary.processed, 1);
      assert.deepEqual(await db.dailyAttendance.findMany({ where: { periodId: october.id }, orderBy: { id: 'asc' } }), before);
      const logs = await ok('/attendance/imports/' + late.body.batch.id, ad);
      assert.equal(logs.punches.find(p => p.state === 'LATE').reason, 'PERIOD_LOCKED');
      await assert.rejects(db.$executeRaw`UPDATE daily_attendance SET worked_minutes=0,day_minutes=0,night_minutes=0 WHERE id=${nightDay.id}::uuid`, /PERIOD_STATE_CONFLICT/);
      const again = await upload(csv([row('NIGHT', '2026-10-25', '22:01:00', 'IN')]));
      assert.equal(again.body.batch.summary.late, 0); assert.equal(again.body.batch.summary.duplicates, 1);
    });
    await t.test('Historical exclusions and current assignment constrain day detail and aggregate counts', async () => {
      const account = await db.userAccount.findUnique({ where: { username: 'tt.bn' } });
      await db.employeeExclusion.create({ data: { userAccountId: account.id, employeeId: people.NIGHT.id, effectiveFrom: new Date('2026-10-10'), effectiveTo: new Date('2026-10-10') } });
      assert.equal((await request('/attendance/days/' + nightDay.id, tt)).status, 404);
      const filtered = await ok('/attendance/board?periodId=' + october.id, tt);
      assert.equal(filtered.items.some(d => d.id === nightDay.id), false);
      assert.equal(filtered.summary.days, filtered.total);
      assert.equal((await request('/attendance/imports', tt)).status, 403);
      assert.equal((await request('/attendance/board?periodId=' + october.id, null)).status, 401);
      await db.orgAssignment.updateMany({ where: { employeeId: people.HC.id }, data: { effectiveTo: new Date('2026-10-11') } });
      await db.orgAssignment.create({ data: { employeeId: people.HC.id, orgUnitId: remote.id, isPrimary: true, allocationRatio: 100, effectiveFrom: new Date('2026-10-12') } });
      const after = await ok('/attendance/board?periodId=' + october.id, tt);
      assert.equal(after.items.some(d => d.employee.id === people.HC.id), false);
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
