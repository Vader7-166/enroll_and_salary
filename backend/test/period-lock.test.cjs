const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const date = value => new Date(value + 'T00:00:00.000Z');
const workDate = '2026-09-10';
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
};
const sha256 = value => createHash('sha256').update(canonical(value)).digest('hex');

test('Attendance period lock: isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_period_lock_' + randomUUID().replaceAll('-', '');
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
      assert.ok(account, 'fixture account ' + username);
      const result = await request('/auth/login', null, { username, password: account.password });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(login));
    const context = await ok('/organization/context', ad);
    const unit = code => { const found = context.units.find(row => row.code === code); assert.ok(found, 'fixture unit ' + code); return found; };
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshopOne = unit('NM-BN-D1'), teamOne = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const [ttActor, qdActor] = await Promise.all(['tt.bn', 'qd.bn'].map(username => db.userAccount.findUniqueOrThrow({ where: { username } })));

    const blockTwo = await db.orgUnit.create({ data: { code: 'PL-' + tag + '-B2', versions: { create: { parentId: siteUnit.id, siteId: site.id, name: 'Khối khóa kỳ hai ' + tag, type: 'BLOCK', level: 3, effectiveFrom: date('2026-01-01') } } } });
    const workshopTwo = await db.orgUnit.create({ data: { code: 'PL-' + tag + '-D2', versions: { create: { parentId: blockTwo.id, siteId: site.id, name: 'Xưởng khóa kỳ hai ' + tag, type: 'DEPARTMENT', level: 4, effectiveFrom: date('2026-01-01') } } } });
    const teamTwo = await db.orgUnit.create({ data: { code: 'PL-' + tag + '-D2-T1', versions: { create: { parentId: workshopTwo.id, siteId: site.id, name: 'Tổ khóa kỳ hai ' + tag, type: 'TEAM', level: 5, effectiveFrom: date('2026-01-01') } } } });
    await Promise.all([
      db.roleAssignment.create({ data: { userAccountId: ttActor.id, roleCode: 'TT', scopeOrgUnitId: teamTwo.id, effectiveFrom: date('2026-01-01') } }),
      db.roleAssignment.create({ data: { userAccountId: qdActor.id, roleCode: 'QD', scopeOrgUnitId: workshopTwo.id, effectiveFrom: date('2026-01-01') } }),
    ]);
    const shift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'PL-DAY-' + tag, name: 'Ca ngày khóa kỳ ' + tag, kind: 'DAY', startTime: '08:00', endTime: '16:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 0, paidBreak: false, workMinutes: 480, isNightShift: false } });
    const teams = [teamOne, teamTwo];
    const employees = [], schedules = [];
    for (const [index, team] of teams.entries()) {
      const employee = await db.employee.create({ data: { code: 'PL-' + tag + '-' + index, fullName: 'Nhân sự khóa kỳ ' + index, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch khóa kỳ ' + index, status: 'APPROVED', createdById: ttActor.id } });
      schedules.push(await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: employee.id, workDate: date(workDate), shiftId: shift.id, startAt: new Date(workDate + 'T08:00:00+07:00'), endAt: new Date(workDate + 'T16:00:00+07:00'), workMinutes: 480 } }));
      employees.push(employee);
    }
    const period = await db.businessPeriod.create({ data: { code: 'PL-SEP-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date(workDate), dateTo: date(workDate), cutoffDay: 25, cutoffPolicyId: (await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } })).id, status: 'OPEN' } });
        for (const [index, team] of teams.entries()) await db.overtimeRequest.create({ data: { teamOrgUnitId: team.id, title: 'OT khóa kỳ ' + index, workDate: date(workDate), startAt: new Date(workDate + 'T16:00:00+07:00'), endAt: new Date(workDate + 'T17:00:00+07:00'), requestedMinutes: 60, reason: 'OT có căn cứ thực tế', status: 'APPROVED', createdById: ttActor.id, members: { create: { employeeId: employees[index].id, consentReference: 'PL-CONSENT-' + index } } } });
    const upload = async lines => {
      const form = new FormData();
      form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'period-lock.csv'); form.set('siteId', site.id); form.set('referencePeriodId', period.id);
      return request('/attendance/imports', ad, form);
    };
    const imported = await upload(employees.flatMap(employee => [[employee.code, workDate, '08:00:00', 'PL-DEVICE-' + tag, 'IN'].join(','), [employee.code, workDate, '17:00:00', 'PL-DEVICE-' + tag, 'OUT'].join(',')]));
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });

    const lockReview = cookie => request('/attendance/period-locks/review?periodId=' + period.id, cookie);
    const lockPayload = review => ({ periodId: period.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'KT đã rà soát nguồn khóa kỳ' });
    const returnPayload = (review, reason) => ({ periodId: period.id, revision: review.revision, sourceHash: review.sourceHash, reason });
    const teamReview = team => request('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt);
    const coveragePayload = (team, review) => ({ periodId: period.id, teamOrgUnitId: team.id, revision: review.coverage?.revision ?? 0, sourceHash: review.collection.sourceHash, coveredFrom: review.collection.from, coveredUntil: review.collection.until, batchIds: review.collection.requiredBatchIds, reference: 'Biên bản nguồn khóa kỳ ' + tag, reason: 'AD đối soát đủ lô nguồn và cửa sổ ca' });
    const confirmPayload = (team, review) => ({ periodId: period.id, teamOrgUnitId: team.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT xác nhận công trước khóa kỳ' });
    async function confirm(team) {
      let response = await teamReview(team); assert.equal(response.status, 200, JSON.stringify(response.body)); let review = response.body;
      if (review.coverage?.sourceHash !== review.collection.sourceHash) { const coverage = await request('/attendance/team-confirmations/coverage', ad, coveragePayload(team, review)); assert.equal(coverage.status, 201, JSON.stringify(coverage.body)); response = await teamReview(team); review = response.body; }
      assert.equal(review.canConfirm, true, JSON.stringify(review.blockers));
      const confirmed = await request('/attendance/team-confirmations', tt, confirmPayload(team, review)); assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
      return confirmed.body;
    }
    const workshopReview = workshopId => request('/attendance/workshop-closures/review?periodId=' + period.id + '&workshopOrgUnitId=' + workshopId, qd);
    async function close(workshopId) {
      const reviewed = await workshopReview(workshopId); assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
      assert.equal(reviewed.body.canClose, true, JSON.stringify(reviewed.body.blockers));
      const closed = await request('/attendance/workshop-closures', qd, { periodId: period.id, workshopOrgUnitId: workshopId, revision: reviewed.body.revision, sourceHash: reviewed.body.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'QĐ đã chốt xưởng trước khóa kỳ' });
      assert.equal(closed.status, 201, JSON.stringify(closed.body));
      return closed.body;
    }

    await t.test('only KT reads or commands locks; OPEN cannot be locked', async () => {
      const review = await lockReview(kt); assert.equal(review.status, 200, JSON.stringify(review.body));
      assert.equal(review.body.period.status, 'OPEN'); assert.equal(review.body.canLock, false);
      for (const cookie of [ad, tt, qd]) {
        assert.equal((await lockReview(cookie)).status, 403);
        assert.equal((await request('/attendance/period-locks', cookie, lockPayload(review.body))).status, 403);
        assert.equal((await request('/attendance/period-locks/return', cookie, { ...returnPayload(review.body, 'Không có quyền trả kỳ'), revision: 1 })).status, 403);
      }
      assert.equal((await request('/attendance/period-locks', kt, lockPayload(review.body))).status, 409);
      const ktRole = await db.role.findUniqueOrThrow({ where: { code: "KT" } });
      try {
        await db.role.update({ where: { code: "KT" }, data: { permissions: ktRole.permissions.filter(permission => permission !== "attendance.lock") } });
        const readonlyKt = await login("kt.all");
        assert.equal((await lockReview(readonlyKt)).status, 200, "KT with attendance.read can review without lock permission");
        assert.equal((await request("/attendance/period-locks", readonlyKt, lockPayload(review.body))).status, 403);
        assert.equal((await request("/attendance/period-locks/return", readonlyKt, returnPayload(review.body, "Chỉ đọc"))).status, 403);
      } finally {
        await db.role.update({ where: { code: "KT" }, data: { permissions: ktRole.permissions } });
      }
    });

    await t.test('collection, confirmation, and frozen workshop freshness gate a CLOSED lock review', async () => {
      await confirm(teamOne);
      const waiting = await workshopReview(workshopOne.id);
      assert.equal(waiting.body.canClose, true, JSON.stringify(waiting.body.blockers));
      await close(workshopOne.id);
      let beforeAll = await lockReview(kt);
      assert.equal(beforeAll.body.canLock, false);
      assert.ok(beforeAll.body.blockers.length, 'unconfirmed second workshop blocks a whole-period lock');
      await confirm(teamTwo);
      await close(workshopTwo.id);
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'CLOSED');
      const periodClosed = (await lockReview(kt)).body;
            assert.equal((await request('/attendance/period-locks/return', kt, returnPayload(periodClosed, ''))).status, 400);
            assert.equal((await request('/attendance/period-locks/return', kt, { ...returnPayload(periodClosed, 'Bản cũ'), revision: periodClosed.revision - 1 })).status, 409);
            assert.equal((await request('/attendance/period-locks/return', kt, { ...returnPayload(periodClosed, 'Nguồn cũ'), sourceHash: '0'.repeat(64) })).status, 409);
            const periodReturned = await request('/attendance/period-locks/return', kt, returnPayload(periodClosed, 'KT trả kỳ để bổ sung căn cứ trước khi khóa'));
            assert.equal(periodReturned.status, 201, JSON.stringify(periodReturned.body));
            assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'OPEN');
            const closeAgain = (await workshopReview(workshopOne.id)).body;
            const workshopReturned = await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshopOne.id, revision: closeAgain.revision, sourceHash: closeAgain.sourceHash, reason: 'Kích hoạt lại trạng thái CLOSED sau trả kỳ KT' });
            assert.equal(workshopReturned.status, 201, JSON.stringify(workshopReturned.body));
            await close(workshopOne.id);
            assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'CLOSED');
            const staleImport = await upload([[employees[0].code, workDate, '08:01:00', 'PL-LATE-' + tag, 'IN'].join(',')]);
      assert.equal(staleImport.status, 201, JSON.stringify(staleImport.body));
      const stale = await lockReview(kt);
      assert.equal(stale.status, 200, JSON.stringify(stale.body)); assert.equal(stale.body.canLock, false);
      assert.ok(stale.body.blockers.length, 'a raw-only import makes the CLOSED workshop source stale rather than trusting its stored CLOSED state');
    });

    await t.test('QD return requires a reason and must precede source changes and re-close', async () => {
      let closed = await workshopReview(workshopOne.id); assert.equal(closed.body.state, 'STALE');
      assert.equal((await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshopOne.id, revision: closed.body.revision, sourceHash: closed.body.sourceHash, reason: '' })).status, 400);
      const periodReview = (await lockReview(kt)).body;
            const periodReturned = await request('/attendance/period-locks/return', kt, returnPayload(periodReview, 'KT mở kỳ để QĐ trả xưởng nguồn thay đổi'));
            assert.equal(periodReturned.status, 201, JSON.stringify(periodReturned.body));
            const returned = await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshopOne.id, revision: closed.body.revision, sourceHash: closed.body.sourceHash, reason: 'Bổ sung lượt quẹt, cần xác nhận lại nguồn công' });
      assert.equal(returned.status, 201, JSON.stringify(returned.body));
      await assert.rejects(db.shiftSchedule.update({ where: { id: schedules[1].id }, data: { startAt: new Date(workDate + 'T07:55:00+07:00') } }), /WORKSHOP_CLOSED_RETURN_REQUIRED/, 'other closed workshop remains protected until it is explicitly returned');
      const secondClosed = (await workshopReview(workshopTwo.id)).body;
      const secondTeam = (await teamReview(teamTwo)).body;
      const frozenProcessing = await db.punchProcessing.findMany({ where: { scheduleId: schedules[1].id }, orderBy: { punchId: "asc" } });
      const frozenDay = await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedules[1].id } });
      await db.shiftSchedule.update({ where: { id: schedules[0].id }, data: { startAt: new Date(workDate + "T07:55:00+07:00") } });
      await ok("/attendance/process", ad, { siteId: site.id, referencePeriodId: period.id });
      assert.deepEqual(await db.punchProcessing.findMany({ where: { scheduleId: schedules[1].id }, orderBy: { punchId: "asc" } }), frozenProcessing, "processing another workshop preserves frozen raw routing and its timestamp");
      assert.deepEqual(await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedules[1].id } }), frozenDay, "other closed workshop attendance remains unchanged");
      const otherTeam = (await teamReview(teamTwo)).body;
      assert.equal(otherTeam.state, "CONFIRMED"); assert.equal(otherTeam.sourceHash, secondTeam.sourceHash);
      const otherWorkshop = (await workshopReview(workshopTwo.id)).body;
      assert.equal(otherWorkshop.state, "CLOSED"); assert.equal(otherWorkshop.sourceHash, secondClosed.sourceHash);
      await confirm(teamOne); await close(workshopOne.id);
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, "CLOSED");
    });

    await t.test('scope and exclusions deny the entire review including history rather than filtering it', async () => {
      const otherSite = await db.site.create({ data: { code: 'PL-' + tag + '-OTHER', name: 'Cơ sở KT phạm vi hẹp ' + tag, address: 'Cơ sở kiểm thử phạm vi hẹp', wageRegion: { connect: { code: site.wageRegionCode } } } });
            const otherSiteUnit = await db.orgUnit.create({ data: { code: 'PL-' + tag + '-OTHER', versions: { create: { parentId: company.id, siteId: otherSite.id, name: 'Cơ sở KT phạm vi hẹp ' + tag, type: 'SITE', level: 2, effectiveFrom: date('2026-01-01') } } } });
            const partialGrant = await db.roleAssignment.create({ data: { userAccountId: qdActor.id, roleCode: 'KT', scopeOrgUnitId: otherSiteUnit.id, effectiveFrom: date('2026-01-01') } });
      let scopedKt = await login('qd.bn');
            assert.equal((await lockReview(scopedKt)).status, 404, 'partial KT scope cannot see a partial period');
      await db.roleAssignment.update({ where: { id: partialGrant.id }, data: { scopeOrgUnitId: siteUnit.id } });
      scopedKt = await login('qd.bn');
            assert.equal((await lockReview(scopedKt)).status, 200, 'site-scoped KT can review every workshop');
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: qdActor.id, employeeId: employees[0].id, effectiveFrom: date(workDate), effectiveTo: date(workDate) } });
      scopedKt = await login('qd.bn');
            assert.equal((await lockReview(scopedKt)).status, 404, 'exclusions deny all frozen/source output, not just the employee row');
      await db.employeeExclusion.delete({ where: { id: exclusion.id } });
      await db.roleAssignment.delete({ where: { id: partialGrant.id } });
    });

    let locked;
    await t.test('locks canonical full evidence once and reports initialization/precedessor gates', async () => {
      const predecessor = await db.businessPeriod.create({ data: { code: 'PL-PREV-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date('2026-09-01'), dateTo: date('2026-09-09'), cutoffDay: 25, cutoffPolicyId: period.cutoffPolicyId, status: 'CLOSED' } });
      let review = await lockReview(kt); assert.equal(review.status, 200, JSON.stringify(review.body));
      assert.equal(review.body.canLock, false, 'an existing earlier un-locked period blocks sequence');
      assert.ok(review.body.blockers.length);
      await db.businessPeriod.delete({ where: { id: predecessor.id } });
      review = await lockReview(kt); assert.equal(review.body.canLock, true, JSON.stringify(review.body.blockers));
      assert.equal(review.body.initialization, true); assert.equal(review.body.previousPeriod, null);
      assert.equal(review.body.summary.workshops, 2); assert.equal(review.body.summary.closedWorkshops, 2);
      let lockReviewBody = review.body;
            const competing = await Promise.all([request('/attendance/period-locks', kt, lockPayload(lockReviewBody)), request('/attendance/period-locks/return', kt, returnPayload(lockReviewBody, 'Trả kỳ đồng thời với lệnh khóa để kiểm chứng tuần tự hóa'))]);
      assert.deepEqual(competing.map(result => result.status).sort((left, right) => left - right), [201, 409], 'concurrent lock and return commit exactly one transition');
      const lockAttempt = competing[0].status === 201 ? competing[0] : null;
            if (lockAttempt) locked = lockAttempt.body;
            else {
              assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'OPEN');
              const workshop = (await workshopReview(workshopOne.id)).body;
              assert.equal((await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshopOne.id, revision: workshop.revision, sourceHash: workshop.sourceHash, reason: 'Khôi phục CLOSED sau cạnh tranh KT' })).status, 201);
              await close(workshopOne.id);
              lockReviewBody = (await lockReview(kt)).body; assert.equal(lockReviewBody.canLock, true, JSON.stringify(lockReviewBody.blockers));
              const retried = await request('/attendance/period-locks', kt, lockPayload(lockReviewBody)); assert.equal(retried.status, 201, JSON.stringify(retried.body)); locked = retried.body;
            }
      assert.ok(Number.isInteger(locked.revision) && locked.revision > 1); assert.equal(locked.sourceHash, lockReviewBody.sourceHash); assert.match(locked.occurredAt, /^20\d\d-/);
      const frozen = await lockReview(kt); assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
      assert.equal(frozen.body.period.status, 'LOCKED'); assert.equal(frozen.body.canReturn, false); assert.equal(frozen.body.canLock, false);
      assert.equal(frozen.body.history.filter(row => row.action === 'LOCK').length, 1);
            assert.ok(frozen.body.history.some(row => row.action === 'RETURN'), 'period return remains an immutable history event after lock');
      assert.equal(frozen.body.lockedSource.sourceHash, locked.sourceHash);
      const snapshot = frozen.body.lockedSource.snapshot;
      assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.period.id, period.id); assert.equal(snapshot.period.scopeOrgUnitId, siteUnit.id);
      assert.equal(snapshot.summary.workshops, 2); assert.equal(snapshot.workshops.length, 2); assert.equal(snapshot.teams.length, 2); assert.equal(snapshot.initialization, true); assert.equal(snapshot.previousPeriod, null);
      const evidence = snapshot.teams.find(row => row.team.id === teamOne.id);
      assert.ok(evidence && evidence.days.length === 1 && evidence.overtime.length >= 1, 'full TT evidence remains in the locked source');
      assert.equal(evidence.days[0].employee.id, employees[0].id); assert.equal(evidence.days[0].workedMinutes, 480); assert.equal(evidence.days[0].leave.minutes, 0);
      assert.equal(evidence.overtime[0].employeeId, employees[0].id); assert.equal(evidence.overtime[0].actualMinutes, 60); assert.equal(evidence.overtime[0].eligibleMinutes, 60);
      assert.ok(Array.isArray(snapshot.accessItems) && snapshot.accessItems.some(item => item.employeeId === employees[0].id && item.workDate === workDate));
      assert.equal(sha256(snapshot), locked.sourceHash, 'sourceHash is exactly the SHA-256 of the canonical lock payload');
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).revision, locked.revision);
    });

    await t.test('LOCKED period rejects stale commands, source writes, immutable-ledger tampering, and unlock paths', async () => {
      const frozen = (await lockReview(kt)).body;
      assert.equal((await request('/attendance/period-locks/return', kt, returnPayload(frozen, 'Không thể trả kỳ đã khóa'))).status, 409);
            assert.equal((await request('/attendance/period-locks/unlock', kt, returnPayload(frozen, 'Không có đường mở khóa'))).status, 404, 'HTTP exposes no unlock path');
      assert.equal((await request('/attendance/period-locks', kt, { ...lockPayload(frozen), revision: frozen.revision - 1 })).status, 409);
      assert.equal((await request('/attendance/period-locks', kt, { ...lockPayload(frozen), sourceHash: '0'.repeat(64) })).status, 409);
      await assert.rejects(db.shiftSchedule.update({ where: { id: schedules[0].id }, data: { startAt: new Date(workDate + 'T07:50:00+07:00') } }), /PERIOD_LOCKED|WORKSHOP_CLOSED_RETURN_REQUIRED/);
      await assert.rejects(db.employee.update({ where: { id: employees[0].id }, data: { terminationDate: date("2026-09-09") } }), /PERIOD_LOCKED|WORKSHOP_CLOSED_RETURN_REQUIRED/);
      await assert.rejects(db.legalParameter.create({ data: { paramCode: "OT_YEAR_MAX_MINUTES", scopeKey: "SITE:" + site.id, subjectType: "ALL", applicationBasis: "WORK_DATE", value: "12000", unit: "minute", effectiveFrom: date(workDate), documentEffectiveDate: date(workDate), legalBasis: "Nguồn kỳ đã khóa" } }), /PERIOD_LOCKED|WORKSHOP_CLOSED_RETURN_REQUIRED/);
      await assert.rejects(db.businessPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } }), /immutable/);
      await assert.rejects(db.businessPeriod.update({ where: { id: period.id }, data: { revision: locked.revision + 1 } }), /immutable/);
      await assert.rejects(db.$executeRaw`UPDATE attendance_period_lock_event SET note = 'changed' WHERE id = ${locked.id}::uuid`, /ledger is immutable/);
      await assert.rejects(db.$executeRaw`DELETE FROM attendance_period_lock_event WHERE id = ${locked.id}::uuid`, /ledger is immutable/);
      await assert.rejects(db.$executeRaw`TRUNCATE TABLE attendance_period_lock_event`, /ledger is immutable/);
      await assert.rejects(db.attendancePeriodLockEvent.create({ data: { periodId: period.id, revision: locked.revision + 1, action: "LOCK", sourceHash: "0".repeat(64), note: "Không được chèn nguồn khóa thay thế", snapshot: { tampered: true }, actorId: frozen.lockedSource.actor.id } }), /Unique constraint/);
      assert.deepEqual((await lockReview(kt)).body.lockedSource, frozen.lockedSource, "an append cannot replace the sole locked source");
      const before = JSON.parse(JSON.stringify(frozen.lockedSource));
      const frozenRoutes = await db.punchProcessing.findMany({ where: { periodId: period.id }, orderBy: { punchId: "asc" } });
      const futureEmployee = await db.employee.update({ where: { id: employees[0].id }, data: { terminationDate: date("2027-12-31") } });
      assert.equal(futureEmployee.terminationDate.toISOString().slice(0, 10), "2027-12-31");
      await db.legalParameter.create({ data: { paramCode: "OT_YEAR_MAX_MINUTES", scopeKey: "SITE:" + site.id, subjectType: "ALL", applicationBasis: "WORK_DATE", value: "12000", unit: "minute", effectiveFrom: date("2027-01-01"), documentEffectiveDate: date("2027-01-01"), legalBasis: "Phiên bản tương lai không đổi công đã khóa" } });
      assert.deepEqual((await lockReview(kt)).body.lockedSource, before, "future HR and policy versions leave the locked period source intact");
      const late = await upload([[employees[0].code, workDate, '08:02:00', 'PL-LOCKED-LATE-' + tag, 'IN'].join(',')]);
      assert.equal(late.status, 201, JSON.stringify(late.body));
      const after = (await lockReview(kt)).body;
      assert.deepEqual(after.lockedSource, before, 'late raw-only import never rewrites the locked snapshot or display');
      await ok("/attendance/process", ad, { siteId: site.id, referencePeriodId: period.id });
      assert.deepEqual(await db.punchProcessing.findMany({ where: { punchId: { in: frozenRoutes.map(row => row.punchId) } }, orderBy: { punchId: "asc" } }), frozenRoutes, "a late import and reprocessing preserve all existing frozen routing evidence");
      const latePunch = await db.rawPunch.findFirstOrThrow({ where: { deviceCode: "PL-LOCKED-LATE-" + tag }, include: { processing: true } });
      assert.equal(latePunch.processing.state, "LATE");
      assert.deepEqual((await lockReview(kt)).body.lockedSource, before);
      const ktGrant = await db.roleAssignment.findFirstOrThrow({ where: { userAccountId: (await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } })).id, roleCode: 'KT', scopeOrgUnitId: company.id } });
      await db.roleAssignment.update({ where: { id: ktGrant.id }, data: { effectiveFrom: date('2026-10-01') } });
      assert.equal((await lockReview(kt)).status, 404, 'stored access items are re-authorized before a frozen source is serialized');
      await db.roleAssignment.update({ where: { id: ktGrant.id }, data: { effectiveFrom: date('2026-01-01') } });
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
