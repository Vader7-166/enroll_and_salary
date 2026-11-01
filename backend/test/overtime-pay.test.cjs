const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
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
const date = value => new Date(value + 'T00:00:00.000Z');
const at = (day, time) => new Date(day + 'T' + time + '+07:00');

test('Overtime pay buckets on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_ot_pay_' + randomUUID().replaceAll('-', '');
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient(), url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let db, server, logs = '';
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 90000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port;
    await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((ready, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out\n' + logs)), 20000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited ' + code + '\n' + logs)); });
      const poll = async () => {
        try { if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok) { clearTimeout(timeout); ready(); return; } } catch {}
        setTimeout(poll, 100);
      };
      poll();
    });
    async function request(path, cookie, body) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, body: type.includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) {
      const result = await request(path, cookie, body);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    async function login(username) {
      const account = credentials.find(value => value.username === username);
      const result = await request('/auth/login', null, { username, password: account.password });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(login));
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshop = unit('NM-BN-D1'), team = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const ttActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });

    const people = {};
    for (const code of ['WEEKEND', 'NIGHT', 'DAY']) {
      people[code] = await db.employee.create({ data: { code: 'OTP-' + tag + '-' + code, fullName: 'Nhân sự OT hệ số ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
    }
    const dayShift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'OTP-D-' + tag, name: 'Ca ngày OT hệ số', kind: 'DAY', startTime: '08:00', endTime: '16:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 0, paidBreak: false, workMinutes: 480, isNightShift: false } });
    const nightShift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'OTP-C-' + tag, name: 'Ca C OT hệ số', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakStartOffset: 240, breakMinutes: 0, paidBreak: true, workMinutes: 480, isNightShift: true } });
    const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch OT hệ số', status: 'APPROVED', createdById: ttActor.id } });
    // 2026-10-03 Saturday (weekday), 2026-10-04 Sunday (weekly rest), 2026-10-05 Monday.
    await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: people.NIGHT.id, workDate: date('2026-10-05'), shiftId: nightShift.id, startAt: at('2026-10-05', '22:00:00'), endAt: at('2026-10-06', '06:00:00'), workMinutes: 480 } });
    await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: people.DAY.id, workDate: date('2026-10-05'), shiftId: dayShift.id, startAt: at('2026-10-05', '08:00:00'), endAt: at('2026-10-05', '16:00:00'), workMinutes: 480 } });
    const cutoffPolicy = await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } });
    const period = await db.businessPeriod.create({ data: { code: 'OTP-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date('2026-10-03'), dateTo: date('2026-10-05'), cutoffDay: 25, cutoffPolicyId: cutoffPolicy.id, status: 'OPEN' } });
    async function approved(code, workDate, startAt, endAt) {
      return db.overtimeRequest.create({ data: { teamOrgUnitId: team.id, title: 'OT hệ số ' + code, workDate: date(workDate), startAt, endAt, requestedMinutes: (endAt - startAt) / 60000, reason: 'Fixture OT đã duyệt', status: 'APPROVED', createdById: ttActor.id, members: { create: { employeeId: people[code].id, consentReference: 'OTP-CONSENT-' + code } } } });
    }
    await approved('WEEKEND', '2026-10-03', at('2026-10-03', '20:00:00'), at('2026-10-04', '02:00:00'));
    await approved('DAY', '2026-10-05', at('2026-10-05', '16:00:00'), at('2026-10-05', '18:00:00'));
    const line = (code, day, time, direction) => [people[code].code, day, time, 'OTP-DEVICE-' + tag, direction].join(',');
    const form = new FormData();
    form.set('file', new Blob([[
      line('WEEKEND', '2026-10-03', '20:00:00', 'IN'), line('WEEKEND', '2026-10-04', '02:00:00', 'OUT'),
      line('NIGHT', '2026-10-05', '21:40:00', 'IN'), line('NIGHT', '2026-10-06', '06:15:00', 'OUT'),
      line('DAY', '2026-10-05', '08:00:00', 'IN'), line('DAY', '2026-10-05', '18:00:00', 'OUT'),
    ].join('\n')], { type: 'text/csv' }), 'ot-pay.csv');
    form.set('siteId', site.id); form.set('referencePeriodId', period.id);
    await ok('/attendance/imports', ad, form);
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
    const bucketsUrl = '/overtime-pay/buckets?periodId=' + period.id;
    const summary = items => items.map(item => [item.employee.code.split('-').at(-1), item.kind, item.dayType, item.isNight, Number(item.rate), Number(item.minutes)]).sort((a, b) => a.join().localeCompare(b.join()));

    await t.test('Only KT/QD read buckets; TT and AD are refused', async () => {
      assert.equal((await request(bucketsUrl, tt)).status, 403);
      assert.equal((await request(bucketsUrl, ad)).status, 403);
      assert.equal((await request(bucketsUrl, qd)).status, 200);
    });

    let draft;
    await t.test('Open period yields DRAFT buckets with 150/210/270, night allowance and weekday OT', async () => {
      draft = await ok(bucketsUrl, kt);
      assert.equal(draft.sourceStatus, 'DRAFT');
      assert.equal(draft.materialized, false);
      assert.deepEqual(draft.errors, []);
      assert.deepEqual(summary(draft.items), [
        ['DAY', 'OT', 'THUONG', false, 1.5, 120],
        ['NIGHT', 'NIGHT_REGULAR', 'THUONG', true, 0.3, 480],
        ['WEEKEND', 'OT', 'NGHI_TUAN', true, 2.7, 120],
        ['WEEKEND', 'OT', 'THUONG', false, 1.5, 120],
        ['WEEKEND', 'OT', 'THUONG', true, 2.1, 120],
      ]);
      assert.ok(draft.items.every(item => item.sourceStatus === 'DRAFT'));
      const night = draft.items.find(item => item.isNight && item.dayType === 'THUONG' && item.kind === 'OT');
      assert.deepEqual([night.rateBreakdown.dayRate, night.rateBreakdown.nightAllowance, night.rateBreakdown.addonRate, night.rateBreakdown.daytimeRate], ['1.5', '0.3', '0.2', '1.5']);
      assert.equal(await db.overtimePayBucket.count(), 0, 'draft buckets are never persisted');
    });

    await t.test('Exclusion hides an employee from KT but not from QD', async () => {
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: ktActor.id, employeeId: people.NIGHT.id, effectiveFrom: date('2026-01-01') } });
      try {
        assert.ok(!(await ok(bucketsUrl, kt)).items.some(item => item.employeeId === people.NIGHT.id));
        assert.ok((await ok(bucketsUrl, qd)).items.some(item => item.employeeId === people.NIGHT.id));
      } finally { await db.employeeExclusion.delete({ where: { id: exclusion.id } }); }
      assert.equal((await ok(bucketsUrl + '&employeeId=' + people.DAY.id, kt)).items.length, 1);
    });

    await t.test('KT rate preview derives 222% / 210% when only weekday OT moves to 160%', async () => {
      assert.equal((await request('/overtime-pay/rate-preview', qd, { orgUnitId: team.id, workDate: '2026-10-05', intervals: [{ startAt: '2026-10-05T13:00:00.000Z', endAt: '2026-10-05T17:00:00.000Z' }] })).status, 403);
      const withDay = await ok('/overtime-pay/rate-preview', kt, { orgUnitId: team.id, workDate: '2026-10-05', overrides: { OT_RATE_WEEKDAY: '1.6' }, intervals: [{ startAt: '2026-10-05T13:00:00.000Z', endAt: '2026-10-05T17:00:00.000Z' }] });
      assert.deepEqual(withDay.buckets.map(b => [b.isNight, Number(b.rate)]), [[false, 1.6], [true, 2.22]]);
      const nightOnly = await ok('/overtime-pay/rate-preview', kt, { orgUnitId: team.id, workDate: '2026-10-05', overrides: { OT_RATE_WEEKDAY: '1.6' }, intervals: [{ startAt: '2026-10-05T15:00:00.000Z', endAt: '2026-10-05T17:00:00.000Z' }] });
      assert.deepEqual(nightOnly.buckets.map(b => Number(b.rate)), [2.1]);
      const sunday = await ok('/overtime-pay/rate-preview', kt, { orgUnitId: team.id, workDate: '2026-10-04', overrides: { OT_RATE_WEEKDAY: '1.6' }, intervals: [{ startAt: '2026-10-04T15:00:00.000Z', endAt: '2026-10-04T17:00:00.000Z' }] });
      assert.deepEqual(sunday.buckets.map(b => [b.dayType, Number(b.rate)]), [['NGHI_TUAN', 2.7]]);
      const holiday = await ok('/overtime-pay/rate-preview', kt, { orgUnitId: team.id, workDate: '2026-09-02', intervals: [{ startAt: '2026-09-02T15:00:00.000Z', endAt: '2026-09-02T17:00:00.000Z' }] });
      assert.deepEqual(holiday.buckets.map(b => [b.dayType, Number(b.rate)]), [['LE_TET', 3.9]]);
    });

    await t.test('TC-B01..B03: comp-time conversion is refused, audited, and changes nothing', async () => {
      const before = { actual: await db.overtimeActual.findMany({ orderBy: { id: 'asc' } }), operations: await db.leaveOperation.count(), ledger: await db.leaveLedgerEntry.count() };
      const refused = await request('/overtime-pay/comp-time-requests', kt, { employeeId: people.DAY.id, workDate: '2026-10-05', hours: '2' });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, 'COMP_TIME_DISABLED');
      assert.deepEqual(refused.body.details, { conversionRatio: null, expiresAt: null, reducesOtPayment: false, reducesActualHours: false });
      assert.deepEqual(await db.overtimeActual.findMany({ orderBy: { id: 'asc' } }), before.actual);
      assert.equal(await db.leaveOperation.count(), before.operations);
      assert.equal(await db.leaveLedgerEntry.count(), before.ledger);
      const dayActual = before.actual.find(row => row.employeeId === people.DAY.id);
      assert.equal(Number(dayActual.actualMinutes), 120);
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'overtime_comp_time_request' }, orderBy: { id: 'desc' } });
      assert.equal(audit.result, 'REJECTED');
      assert.equal(audit.newValue.code, 'COMP_TIME_DISABLED');
      const compensatory = await db.leaveType.findFirstOrThrow({ where: { code: 'COMPENSATORY' }, include: { versions: true } });
      assert.ok(compensatory.versions.some(version => version.active), 'holiday comp leave type keeps working independently');
      const after = await ok(bucketsUrl, kt);
      assert.deepEqual(summary(after.items), summary(draft.items), 'OT buckets and pay basis are unchanged');
    });

    await t.test('Locking the period freezes segments; buckets materialize once from the snapshot', async () => {
      let review = (await ok('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt));
      if (review.coverage?.sourceHash !== review.collection.sourceHash) {
        await ok('/attendance/team-confirmations/coverage', ad, { periodId: period.id, teamOrgUnitId: team.id, revision: review.coverage?.revision ?? 0, sourceHash: review.collection.sourceHash, coveredFrom: review.collection.from, coveredUntil: review.collection.until, batchIds: review.collection.requiredBatchIds, reference: 'Biên bản nguồn ' + tag, reason: 'AD đối soát đủ lô nguồn' });
        review = await ok('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt);
      }
      assert.equal(review.canConfirm, true, JSON.stringify(review.blockers));
      await ok('/attendance/team-confirmations', tt, { periodId: period.id, teamOrgUnitId: team.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT xác nhận' });
      const closure = await ok('/attendance/workshop-closures/review?periodId=' + period.id + '&workshopOrgUnitId=' + workshop.id, qd);
      assert.equal(closure.canClose, true, JSON.stringify(closure.blockers));
      await ok('/attendance/workshop-closures', qd, { periodId: period.id, workshopOrgUnitId: workshop.id, revision: closure.revision, sourceHash: closure.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'QĐ chốt xưởng' });
      const lockReview = await ok('/attendance/period-locks/review?periodId=' + period.id, kt);
      assert.equal(lockReview.canLock, true, JSON.stringify(lockReview.blockers));
      const locked = await ok('/attendance/period-locks', kt, { periodId: period.id, revision: lockReview.revision, sourceHash: lockReview.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'KT khóa kỳ' });
      const event = await db.attendancePeriodLockEvent.findUniqueOrThrow({ where: { id: locked.id } });
      assert.equal(event.snapshot.payrollTime.schemaVersion, 1);
      assert.ok(event.snapshot.payrollTime.overtime.some(row => row.segments.length));

      const first = await ok(bucketsUrl, kt);
      assert.equal(first.sourceStatus, 'LOCKED');
      assert.equal(first.materialized, true);
      assert.equal(first.sourceHash, event.sourceHash);
      assert.deepEqual(summary(first.items), summary(draft.items));
      const stored = await db.overtimePayBucket.findMany();
      assert.equal(stored.length, 5);
      assert.ok(stored.every(row => row.sourceStatus === 'LOCKED' && row.lockEventId === event.id && row.sourceHash === event.sourceHash));
      const second = await ok(bucketsUrl, qd);
      assert.deepEqual(summary(second.items), summary(first.items));
      assert.equal(await db.overtimePayBucket.count(), 5, 'reads never duplicate materialized buckets');
      await assert.rejects(db.overtimePayBucket.update({ where: { id: stored[0].id }, data: { rate: '9' } }), /immutable/);
      await assert.rejects(db.overtimePayBucket.delete({ where: { id: stored[0].id } }), /immutable/);
    });

    await t.test('A legacy lock snapshot without segments returns OT_SEGMENTS_UNAVAILABLE', async () => {
      const remote = unit('NM-NA');
      const remotePolicy = await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: remote.id, policyKey: 'CUTOFF_DAY' } });
      const legacy = await db.businessPeriod.create({ data: { code: 'OTP-LEGACY-' + tag, scopeOrgUnitId: remote.id, periodType: 'ATTENDANCE', dateFrom: date('2026-08-26'), dateTo: date('2026-09-25'), cutoffDay: 25, cutoffPolicyId: remotePolicy.id, status: 'LOCKED', revision: 1 } });
      await db.attendancePeriodLockEvent.create({ data: { periodId: legacy.id, revision: 1, action: 'LOCK', sourceHash: 'a'.repeat(64), note: 'Khóa trước khi có segment', snapshot: { schemaVersion: 1, accessItems: [] }, actorId: ktActor.id } });
      const response = await request('/overtime-pay/buckets?periodId=' + legacy.id, kt);
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'OT_SEGMENTS_UNAVAILABLE');
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
