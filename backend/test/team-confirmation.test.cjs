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
const date = value => new Date(value + 'T00:00:00.000Z');
const workDate = '2026-09-10';

test('Team confirmation: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_team_confirmation_' + randomUUID().replaceAll('-', '');
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
      assert.ok(account, 'fixture account ' + username);
      const result = await request('/auth/login', null, { username, password: account.password });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(login));
    const context = await ok('/organization/context', kt);
    const unit = code => {
      const found = context.units.find(row => row.code === code);
      assert.ok(found, 'fixture unit ' + code);
      return found;
    };
    const team = unit('NM-BN-D1-T1'), company = unit('COMPANY'), siteUnit = unit('NM-BN');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const actor = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });
    const employee = await db.employee.create({ data: {
      code: 'CONF-MAIN', fullName: 'Nhân sự xác nhận công', gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'),
      assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } },
    } });
    const night = await db.shiftDefinition.create({ data: {
      orgUnitId: company.id, code: 'CONF-NIGHT', name: 'Ca đêm xác nhận công', kind: 'NIGHT', startTime: '22:00', endTime: '06:00',
      crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true, workMinutes: 480, isNightShift: true,
    } });
    const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch xác nhận công tháng 9', status: 'APPROVED', createdById: actor.id } });
    const schedule = await db.shiftSchedule.create({ data: {
      planId: plan.id, employeeId: employee.id, workDate: date(workDate), shiftId: night.id,
      startAt: new Date(workDate + 'T22:00:00+07:00'), endAt: new Date('2026-09-11T06:00:00+07:00'), workMinutes: 480,
    } });
    let period = await db.businessPeriod.create({ data: {
      code: 'CONF-SEP-' + randomUUID().slice(0, 8), scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE',
      dateFrom: date(workDate), dateTo: date(workDate), cutoffDay: 25,
      cutoffPolicyId: (await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } })).id, status: 'OPEN',
    } });
    async function upload(lines) {
      const form = new FormData();
      form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'team-confirmation.csv');
      form.set('siteId', site.id); form.set('referencePeriodId', period.id);
      return ok('/attendance/imports', ad, form);
    }
    const source = await upload([
      [employee.code, workDate, '22:05:00', 'CONF-DEVICE', 'IN'].join(','),
      [employee.code, '2026-09-11', '06:00:00', 'CONF-DEVICE', 'OUT'].join(','),
    ]);
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
    const review = async cookie => request('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, cookie);
    const reviewed = async cookie => {
      const result = await review(cookie);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    };
    const coveragePayload = r => ({ periodId: period.id, teamOrgUnitId: team.id, revision: r.coverage?.revision ?? 0, sourceHash: r.collection.sourceHash,
      coveredFrom: r.collection.from, coveredUntil: r.collection.until, batchIds: r.collection.requiredBatchIds,
      reference: 'Biên bản đối soát nguồn CONF-SEP', reason: 'AD xác nhận đủ file máy chấm công và cửa sổ thu log' });
    const confirmPayload = r => ({ periodId: period.id, teamOrgUnitId: team.id, revision: r.revision, sourceHash: r.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT đã rà soát công, OT, nghỉ và giải trình' });

    await t.test('fresh evidence requires explicit AD coverage and includes the overnight collection window', async () => {
      const fresh = await reviewed(tt);
      assert.equal(fresh.canConfirm, false);
      assert.ok(fresh.blockers.some(issue => issue.code === 'SOURCE_COVERAGE_MISSING'));
      assert.ok(new Date(fresh.collection.until) >= new Date('2026-09-10T23:00:00.000Z'), 'collection covers the 06:00 overnight checkout');
      assert.deepEqual(fresh.collection.requiredBatchIds, [source.batch.id]);
      for (const [cookie, path, payload] of [[tt, '/attendance/team-confirmations/coverage', coveragePayload(fresh)], [qd, '/attendance/team-confirmations/coverage', coveragePayload(fresh)], [kt, '/attendance/team-confirmations/coverage', coveragePayload(fresh)], [ad, '/attendance/team-confirmations', confirmPayload(fresh)], [qd, '/attendance/team-confirmations', confirmPayload(fresh)], [kt, '/attendance/team-confirmations', confirmPayload(fresh)]])
        assert.equal((await request(path, cookie, payload)).status, 403, 'only AD can attest source coverage and only TT can confirm');
      const coverage = await request('/attendance/team-confirmations/coverage', ad, coveragePayload(fresh));
      assert.equal(coverage.status, 201, JSON.stringify(coverage.body));
      assert.equal(coverage.body.revision, 1);
      assert.equal((await request('/attendance/team-confirmations/coverage', ad, coveragePayload(fresh))).status, 409, 'stale coverage revision cannot append another attestation');
    });

    await t.test('changed OT evidence cannot pass review with unchanged minute totals', async () => {
      const original = await db.overtimeActual.findUniqueOrThrow({ where: { employeeId_orgUnitId_workDate: { employeeId: employee.id, orgUnitId: team.id, workDate: date(workDate) } } });
      try {
        await db.overtimeActual.update({ where: { id: original.id }, data: { evidence: { ...original.evidence, rules: { values: {}, parameterIds: {} } } } });
        const changed = await reviewed(tt);
        assert.equal(changed.canConfirm, false);
        assert.ok(changed.blockers.some(issue => issue.code === 'STALE_OVERTIME'));
      } finally {
        await db.overtimeActual.update({ where: { id: original.id }, data: { evidence: original.evidence } });
      }
    });

    let confirmation;
    await t.test('TT confirmation records immutable actor/time/revision snapshot and competing writes commit once', async () => {
      const ready = await reviewed(tt);
      assert.equal(ready.canConfirm, true, JSON.stringify(ready.blockers));
      assert.ok(ready.warnings.some(issue => issue.code === 'ATTENDANCE_EXCEPTION'));
      assert.equal((await request('/attendance/team-confirmations', tt, { ...confirmPayload(ready), acknowledgeWarnings: false })).status, 400);
      assert.equal((await request('/attendance/team-confirmations', tt, { ...confirmPayload(ready), reviewed: false })).status, 400);
      const results = await Promise.all([request('/attendance/team-confirmations', tt, confirmPayload(ready)), request('/attendance/team-confirmations', tt, confirmPayload(ready))]);
      assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [201, 409]);
      confirmation = results.find(result => result.status === 201).body;
      assert.equal(confirmation.revision, 1);
      assert.match(confirmation.confirmedAt, /^2026-|^20\d\d-/);
      const row = await db.attendanceTeamConfirmation.findUniqueOrThrow({ where: { periodId_teamOrgUnitId_revision: { periodId: period.id, teamOrgUnitId: team.id, revision: 1 } } });
      assert.equal(row.actorId, actor.id); assert.equal(row.sourceHash, ready.sourceHash);
      assert.equal(row.snapshot.reviewed, true); assert.equal(row.snapshot.acknowledgeWarnings, true);
      await assert.rejects(db.attendanceTeamConfirmation.update({ where: { id: row.id }, data: { note: 'sửa trái phép' } }));
      await assert.rejects(db.attendanceTeamConfirmation.delete({ where: { id: row.id } }));
      const after = await reviewed(tt);
      assert.equal(after.state, 'CONFIRMED'); assert.equal(after.history.length, 1);
      assert.equal((await request('/attendance/team-confirmations', tt, confirmPayload(after))).status, 409, 'same reviewed revision cannot be confirmed twice');
      const renewedCoverage = await request('/attendance/team-confirmations/coverage', ad, coveragePayload(after));
      assert.equal(renewedCoverage.status, 201, JSON.stringify(renewedCoverage.body));
      const afterCoverage = await reviewed(tt);
      assert.equal(afterCoverage.state, 'STALE', 'a newer AD source attestation invalidates the TT confirmation snapshot');
      assert.equal(afterCoverage.coverage.revision, 2);
    });

    await t.test('unresolved source records and unexplained ERR block rather than partially confirming', async () => {
      const leaveType = await db.leaveType.findUniqueOrThrow({ where: { orgUnitId_code: { orgUnitId: company.id, code: 'UNPAID' } } });
      const leave = (await ok('/leave/requests', tt, { employeeId: employee.id, leaveTypeId: leaveType.id, dateFrom: workDate, dateTo: workDate, unit: 'HOUR', startAt: workDate + 'T22:00:00+07:00', endAt: '2026-09-10T23:00:00+07:00', reason: 'Đơn nghỉ đang chờ xác nhận', documentReference: 'DON-CONF-PENDING' })).item;
      const pendingLeave = (await ok('/leave/requests/' + leave.id + '/submit', tt, { revision: leave.revision })).item;
      let blocked = await reviewed(tt);
      assert.ok(blocked.blockers.some(issue => issue.code === 'UNRESOLVED_LEAVE'));
      await db.leaveRequest.update({ where: { id: pendingLeave.id }, data: { status: 'REJECTED' } });
      const overtime = await db.overtimeRequest.create({ data: { teamOrgUnitId: team.id, title: 'OT đang chờ xác nhận', workDate: date(workDate), startAt: new Date('2026-09-11T06:00:00+07:00'), endAt: new Date('2026-09-11T07:00:00+07:00'), requestedMinutes: 60, reason: 'Nguồn chờ', status: 'PENDING', createdById: actor.id, members: { create: { employeeId: employee.id, consentReference: 'CONSENT-CONF' } } } });
      const correction = await db.attendanceCorrection.create({ data: { periodId: period.id, kind: 'CORRECTION', status: 'PENDING', revision: 1, reason: 'Giải trình đang chờ', warnings: [], createdById: actor.id, items: { create: { periodId: period.id, employeeId: employee.id, orgUnitId: team.id, workDate: date(workDate), sourceDates: [date(workDate)], intervals: [{ startAt: workDate + 'T22:00:00+07:00', endAt: '2026-09-11T06:00:00+07:00' }] } } } });
      blocked = await reviewed(tt);
      assert.ok(blocked.blockers.some(issue => issue.code === 'UNRESOLVED_OVERTIME'));
      assert.ok(blocked.blockers.some(issue => issue.code === 'UNRESOLVED_CORRECTION'));
      const day = await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedule.id } });
      await db.dailyAttendance.update({ where: { id: day.id }, data: { status: 'ERR' } });
      blocked = await reviewed(tt);
      assert.ok(blocked.blockers.some(issue => issue.code === 'UNEXPLAINED_ERROR'));
      await db.dailyAttendance.update({ where: { id: day.id }, data: { status: day.status } });
      await db.overtimeRequest.update({ where: { id: overtime.id }, data: { status: 'CANCELLED' } });
      await db.attendanceCorrection.update({ where: { id: correction.id }, data: { status: 'REJECTED' } });
    });

    await t.test('current and historical exclusions deny the whole review instead of hiding affected evidence', async () => {
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: actor.id, employeeId: employee.id, effectiveFrom: date(workDate), effectiveTo: date(workDate) } });
      assert.equal((await review(tt)).status, 404, 'an excluded employee makes the whole review unreadable rather than omitting that employee');
      await db.employeeExclusion.delete({ where: { id: exclusion.id } });
      for (const day of ['2026-09-11', require('../dist/auth/business-date').businessDate().toISOString().slice(0, 10)]) {
        const sourceExclusion = await db.employeeExclusion.create({ data: { userAccountId: actor.id, employeeId: employee.id, effectiveFrom: date(day), effectiveTo: date(day) } });
        assert.equal((await review(tt)).status, 404, 'current and overnight source-day exclusions deny whole review');
        await db.employeeExclusion.delete({ where: { id: sourceExclusion.id } });
      }
      const grant = await db.roleAssignment.findFirstOrThrow({ where: { userAccountId: actor.id, roleCode: 'TT', scopeOrgUnitId: team.id } });
      await db.roleAssignment.update({ where: { id: grant.id }, data: { effectiveFrom: date('2026-10-01') } });
      assert.equal((await review(tt)).status, 404, 'current permission cannot silently omit historical team days');
      await db.roleAssignment.update({ where: { id: grant.id }, data: { effectiveFrom: date('2026-01-01') } });
    });

    await t.test('source changes stale prior confirmation for raw, schedule, leave, correction and OT evidence', async () => {
      await db.shiftSchedule.update({ where: { id: schedule.id }, data: { startAt: new Date(workDate + 'T21:45:00+07:00') } });
      const stale = await reviewed(tt);
      assert.equal(stale.state, 'STALE');
      assert.ok(stale.blockers.some(issue => issue.code === 'STALE_ATTENDANCE'));
      assert.ok(stale.blockers.some(issue => issue.code === 'SOURCE_COVERAGE_MISSING'));
      await db.shiftSchedule.update({ where: { id: schedule.id }, data: { startAt: schedule.startAt } });
      const approvedLeave = await db.leaveRequest.create({ data: { employeeId: employee.id, leaveTypeId: (await db.leaveType.findUniqueOrThrow({ where: { orgUnitId_code: { orgUnitId: company.id, code: 'UNPAID' } } })).id, createdById: actor.id, status: 'APPROVED', revision: 1, dateFrom: date(workDate), dateTo: date(workDate), unit: 'HOUR', startAt: new Date(workDate + 'T22:00:00+07:00'), endAt: new Date('2026-09-10T23:00:00+07:00'), reason: 'Nghỉ đã duyệt đổi nguồn', snapshot: { lines: [{ orgUnitId: team.id, workDate, scheduleId: schedule.id, minutes: 60, paidMinutes: 0, countedUnits: '0.125', symbols: ['K'], startAt: workDate + 'T22:00:00+07:00', endAt: '2026-09-10T23:00:00+07:00' }] } } });
      let changed = await reviewed(tt);
      assert.ok(changed.blockers.some(issue => issue.code === 'STALE_ATTENDANCE'), 'approved leave changed after processing is detected');
      const correctionDraft = (await ok('/attendance/corrections', tt, { periodId: period.id, kind: 'CORRECTION', reason: 'Giải trình đã duyệt đổi nguồn', evidenceReference: 'BB-CONF-STALE', items: [{ employeeId: employee.id, orgUnitId: team.id, workDate, intervals: [{ startAt: workDate + 'T22:05:00+07:00', endAt: '2026-09-11T06:00:00+07:00' }], excuseLateEarly: false }] })).correction;
      const correctionPending = (await ok('/attendance/corrections/' + correctionDraft.id + '/submit', tt, { revision: correctionDraft.revision })).correction;
      await ok('/attendance/corrections/' + correctionPending.id + '/approve', qd, { revision: correctionPending.revision });
      changed = await reviewed(tt);
      assert.equal(changed.state, 'STALE', 'an approved correction after TT confirmation changes its evidence snapshot');
      const approvedOt = await db.overtimeRequest.create({ data: { teamOrgUnitId: team.id, title: 'OT đã duyệt đổi nguồn', workDate: date(workDate), startAt: new Date('2026-09-11T06:00:00+07:00'), endAt: new Date('2026-09-11T07:00:00+07:00'), requestedMinutes: 60, reason: 'Nguồn OT mới', status: 'APPROVED', createdById: actor.id, members: { create: { employeeId: employee.id, consentReference: 'CONSENT-CONF-APPROVED' } } } });
      changed = await reviewed(tt);
      assert.ok(changed.blockers.some(issue => issue.code === 'STALE_OVERTIME'));
      await db.rawPunch.create({ data: { employeeId: employee.id, siteId: site.id, punchedAt: new Date('2026-09-10T14:30:00.000Z'), direction: 'IN', deviceCode: 'CONF-NEW', source: 'IMPORT', batchId: source.batch.id, rowNumber: 99 } });
      changed = await reviewed(tt);
      assert.equal(changed.state, 'STALE');
      assert.ok(changed.blockers.some(issue => issue.code === 'UNROUTED_PUNCH'));
      await db.leaveRequest.update({ where: { id: approvedLeave.id }, data: { status: 'CANCELLED' } });
      await db.overtimeRequest.update({ where: { id: approvedOt.id }, data: { status: 'CANCELLED' } });
    });

    await t.test('CLOSED or LOCKED period denies confirmation and coverage writes', async () => {
      for (const status of ['CLOSED', 'LOCKED']) {
        await db.businessPeriod.update({ where: { id: period.id }, data: { status } });
        const frozen = await reviewed(tt);
        assert.ok(frozen.blockers.some(issue => issue.code === 'PERIOD_NOT_OPEN'));
        assert.equal((await request('/attendance/team-confirmations', tt, confirmPayload(frozen))).status, 409);
        assert.equal((await request('/attendance/team-confirmations/coverage', ad, coveragePayload(frozen))).status, 409);
      }
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
