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

test('Workshop closure: isolated PostgreSQL and real HTTP', { timeout: 240000 }, async t => {
  const name = 'hrtp_workshop_closure_' + randomUUID().replaceAll('-', '');
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
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 60000 });
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
    const unit = code => {
      const found = context.units.find(row => row.code === code);
      assert.ok(found, 'fixture unit ' + code);
      return found;
    };
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshop = unit('NM-BN-D1'), firstTeam = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const ttActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });
    const qdActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'qd.bn' } });
    const secondTeam = await db.orgUnit.create({ data: { code: 'WC-' + tag + '-D1-T2', versions: { create: {
      parentId: workshop.id, siteId: site.id, name: 'Tổ chốt xưởng hai ' + tag, type: 'TEAM', level: 5, effectiveFrom: date('2026-01-01'),
    } } } });
    const pendingBlock = await db.orgUnit.create({ data: { code: 'WC-' + tag + '-B1', versions: { create: {
      parentId: siteUnit.id, siteId: site.id, name: 'Khối xưởng chờ ' + tag, type: 'BLOCK', level: 3, effectiveFrom: date('2026-01-01'),
    } } } });
    const pendingWorkshop = await db.orgUnit.create({ data: { code: 'WC-' + tag + '-D2', versions: { create: {
      parentId: pendingBlock.id, siteId: site.id, name: 'Xưởng còn chờ ' + tag, type: 'DEPARTMENT', level: 4, effectiveFrom: date('2026-01-01'),
    } } } });
    const pendingTeam = await db.orgUnit.create({ data: { code: 'WC-' + tag + '-D2-T1', versions: { create: {
      parentId: pendingWorkshop.id, siteId: site.id, name: 'Tổ xưởng còn chờ ' + tag, type: 'TEAM', level: 5, effectiveFrom: date('2026-01-01'),
    } } } });
    for (const scopeOrgUnitId of [secondTeam.id, pendingTeam.id]) await db.roleAssignment.create({ data: {
      userAccountId: ttActor.id, roleCode: 'TT', scopeOrgUnitId, effectiveFrom: date('2026-01-01'),
    } });
    const shift = await db.shiftDefinition.create({ data: {
      orgUnitId: company.id, code: 'WC-NIGHT-' + tag, name: 'Ca chốt xưởng ' + tag, kind: 'NIGHT', startTime: '22:00', endTime: '06:00',
      crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true, workMinutes: 480, isNightShift: true,
    } });
    const teams = [firstTeam, secondTeam, pendingTeam];
    const employees = [];
    const schedules = [];
    for (const [index, team] of teams.entries()) {
      const employee = await db.employee.create({ data: {
        code: 'WC-' + tag + '-' + index, fullName: 'Nhân sự chốt xưởng ' + index, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'),
        assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } },
      } });
      const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch chốt xưởng ' + tag + '-' + index, status: 'APPROVED', createdById: ttActor.id } });
      const schedule = await db.shiftSchedule.create({ data: {
        planId: plan.id, employeeId: employee.id, workDate: date(workDate), shiftId: shift.id,
        startAt: new Date(workDate + 'T22:00:00+07:00'), endAt: new Date('2026-09-11T06:00:00+07:00'), workMinutes: 480,
      } });
      employees.push(employee); schedules.push(schedule);
    }
    const period = await db.businessPeriod.create({ data: {
      code: 'WC-SEP-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date(workDate), dateTo: date(workDate), cutoffDay: 25,
      cutoffPolicyId: (await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } })).id, status: 'OPEN',
    } });
    async function importRequest(lines) {
      const form = new FormData();
      form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'workshop-closure.csv');
      form.set('siteId', site.id); form.set('referencePeriodId', period.id);
      return request('/attendance/imports', ad, form);
    }
    async function upload(lines) {
      const result = await importRequest(lines);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.body));
      return result.body;
    }
    await upload(employees.flatMap(employee => [
      [employee.code, workDate, '22:05:00', 'WC-DEVICE-' + tag, 'IN'].join(','),
      [employee.code, '2026-09-11', '06:00:00', 'WC-DEVICE-' + tag, 'OUT'].join(','),
    ]));
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
    const teamReview = team => request('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt);
    const reviewedTeam = async team => {
      const result = await teamReview(team);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    };
    const coveragePayload = (team, review) => ({ periodId: period.id, teamOrgUnitId: team.id, revision: review.coverage?.revision ?? 0, sourceHash: review.collection.sourceHash,
      coveredFrom: review.collection.from, coveredUntil: review.collection.until, batchIds: review.collection.requiredBatchIds,
      reference: 'Biên bản đối soát chốt xưởng ' + tag, reason: 'AD đã đối soát đủ nguồn máy chấm công' });
    const confirmPayload = (team, review) => ({ periodId: period.id, teamOrgUnitId: team.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT đã xác nhận công để chốt xưởng' });
    async function confirmTeam(team) {
      let review = await reviewedTeam(team);
      if (review.coverage?.sourceHash !== review.collection.sourceHash) {
        const coverage = await request('/attendance/team-confirmations/coverage', ad, coveragePayload(team, review));
        assert.equal(coverage.status, 201, JSON.stringify(coverage.body));
        review = await reviewedTeam(team);
      }
      assert.equal(review.canConfirm, true, JSON.stringify(review.blockers));
      const confirmation = await request('/attendance/team-confirmations', tt, confirmPayload(team, review));
      assert.equal(confirmation.status, 201, JSON.stringify(confirmation.body));
      return confirmation.body;
    }
    const workshops = cookie => request('/attendance/workshop-closures/workshops?periodId=' + period.id, cookie);
    const workshopReview = (cookie, workshopOrgUnitId = workshop.id) => request('/attendance/workshop-closures/review?periodId=' + period.id + '&workshopOrgUnitId=' + workshopOrgUnitId, cookie);
    const closePayload = review => ({ periodId: period.id, workshopOrgUnitId: review.workshop.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'QĐ đã rà soát tổng hợp công xưởng' });
    const close = (cookie, review) => request('/attendance/workshop-closures', cookie, closePayload(review));

    await t.test('aggregates every team and does not close while one team remains unconfirmed', async () => {
      const visible = await workshops(qd);
      assert.equal(visible.status, 200, JSON.stringify(visible.body));
      assert.ok(visible.body.items.some(item => item.id === workshop.id));
      const initial = await workshopReview(qd);
      assert.equal(initial.status, 200, JSON.stringify(initial.body));
      assert.equal(initial.body.teams.length, 2);
      assert.deepEqual(initial.body.teams.map(item => item.team.id).sort(), [firstTeam.id, secondTeam.id].sort());
      assert.equal(initial.body.state, 'WAITING');
      assert.ok(initial.body.blockers.some(issue => issue.code === 'SOURCE_COVERAGE_MISSING'), 'missing AD collection coverage blocks the aggregate close');
      const day = await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedules[0].id } });
      await db.dailyAttendance.update({ where: { id: day.id }, data: { status: 'ERR' } });
      const errored = (await workshopReview(qd)).body;
      assert.ok(errored.blockers.some(issue => issue.code === 'UNEXPLAINED_ERROR'), 'an unexplained attendance error blocks the whole workshop rather than being omitted');
      await db.dailyAttendance.update({ where: { id: day.id }, data: { status: day.status } });
      assert.equal((await close(qd, initial.body)).status, 409);
      await confirmTeam(firstTeam);
      const oneConfirmed = (await workshopReview(qd)).body;
      assert.equal(oneConfirmed.teams.find(item => item.team.id === firstTeam.id).state, 'CONFIRMED');
      assert.equal(oneConfirmed.teams.find(item => item.team.id === secondTeam.id).state, 'WAITING');
      assert.equal((await close(qd, oneConfirmed)).status, 409);
    });

    await t.test('cross-checks use annual OT from earlier months and date-effective site limits', async () => {
      const historyPeriod = await db.businessPeriod.create({data:{code:'WC-HISTORY-'+tag,scopeOrgUnitId:siteUnit.id,periodType:'ATTENDANCE',dateFrom:date('2026-08-01'),dateTo:date('2026-08-31'),cutoffDay:25,cutoffPolicyId:period.cutoffPolicyId,status:'OPEN'}});
      const cap = await db.legalParameter.create({data:{paramCode:'OT_YEAR_MAX_MINUTES',scopeKey:'SITE:'+site.id,subjectType:'ALL',applicationBasis:'WORK_DATE',value:'480',unit:'minute',effectiveFrom:date('2026-09-01'),documentEffectiveDate:date('2026-09-01'),legalBasis:'Giới hạn năm chặt hơn cho kiểm chứng'}});
      const historical = [];
      for(const text of ['2026-08-10','2026-08-11']) historical.push(await db.overtimeActual.create({data:{employeeId:employees[0].id,orgUnitId:firstTeam.id,periodId:historyPeriod.id,workDate:date(text),sourceDates:[date(text)],requestedMinutes:240,approvedMinutes:240,actualMinutes:240,eligibleMinutes:240,dayMinutes:240,nightMinutes:0,unapprovedMinutes:0,unworkedApprovedMinutes:0,flags:[],evidence:{}}}));
      const atCap = (await workshopReview(qd)).body;
      assert.ok(atCap.warnings.some(row=>row.code==='XC-10'&&row.employeeId===employees[0].id),'OT outside the reviewed month still counts toward the year');
      await db.overtimeActual.update({where:{id:historical[1].id},data:{actualMinutes:239,eligibleMinutes:239,dayMinutes:239,unworkedApprovedMinutes:1}});
      const belowCap = (await workshopReview(qd)).body;
      assert.equal(belowCap.warnings.some(row=>row.code==='XC-10'),false);
      assert.notEqual(atCap.sourceHash,belowCap.sourceHash,'historical OT changes invalidate an old review token');
      await db.overtimeActual.deleteMany({where:{periodId:historyPeriod.id}});await db.legalParameter.delete({where:{id:cap.id}});
      const dailyCap=await db.legalParameter.create({data:{paramCode:'SHIFT_MAX_DAILY_MINUTES',scopeKey:'SITE:'+site.id,subjectType:'ALL',applicationBasis:'WORK_DATE',value:'400',unit:'minute',effectiveFrom:date(workDate),effectiveTo:date(workDate),documentEffectiveDate:date(workDate),legalBasis:'Giới hạn ngày theo hiệu lực'}});
      assert.ok((await workshopReview(qd)).body.warnings.some(row=>row.code==='XC-04'));
      await db.legalParameter.update({where:{id:dailyCap.id},data:{effectiveFrom:date('2026-09-11'),effectiveTo:date('2026-09-11')}});
      assert.equal((await workshopReview(qd)).body.warnings.some(row=>row.code==='XC-04'),false,'future-only site parameters must not replace effective global limits');
      await db.legalParameter.delete({where:{id:dailyCap.id}});
    });


    let firstClose;
    await t.test('only in-scope QD can close and concurrent close produces one immutable history row', async () => {
      await confirmTeam(secondTeam);
      const ready = (await workshopReview(qd)).body;
      assert.equal(ready.canClose, true, JSON.stringify(ready.blockers));
      for (const cookie of [tt, kt, ad]) assert.equal((await close(cookie, ready)).status, 403);
      assert.equal((await workshopReview(qd, pendingWorkshop.id)).status, 404, 'QD cannot review a workshop outside its granted scope');
      const attempts = await Promise.all([close(qd, ready), close(qd, ready)]);
      assert.deepEqual(attempts.map(result => result.status).sort((a, b) => a - b), [201, 409]);
      firstClose = attempts.find(result => result.status === 201).body;
      const closed = (await workshopReview(qd)).body;
      assert.equal(closed.state, 'CLOSED');
      assert.equal(closed.history.length, 1);
      assert.equal(closed.history[0].action, 'CLOSE');
      assert.equal(closed.history[0].revision, 1);
      assert.ok(closed.history[0].snapshot, 'history exposes the frozen close snapshot after scope checks');
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'OPEN', 'another workshop pending keeps the period open');
      await assert.rejects(db.$executeRawUnsafe('UPDATE attendance_workshop_closure SET note = $1 WHERE id = $2', 'tamper', firstClose.id));
      await assert.rejects(db.$executeRawUnsafe('DELETE FROM attendance_workshop_closure WHERE id = $1', firstClose.id));
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE attendance_workshop_closure'));
    });

    await t.test('exclusions do not leak frozen history and source changes stale a closed workshop', async () => {
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: qdActor.id, employeeId: employees[0].id, effectiveFrom: date(workDate), effectiveTo: date(workDate) } });
      assert.equal((await workshopReview(qd)).status, 404, 'a current exclusion denies the entire review before history is serialized');
      await db.employeeExclusion.delete({ where: { id: exclusion.id } });
      await assert.rejects(db.shiftSchedule.update({ where: { id: schedules[0].id }, data: { startAt: new Date(workDate + 'T21:55:00+07:00') } }), /WORKSHOP_CLOSED_RETURN_REQUIRED/, 'direct source edits require an explicit QD return while closed');
      await assert.rejects(db.employee.update({where:{id:employees[0].id},data:{terminationDate:date(workDate)}}), /WORKSHOP_CLOSED_RETURN_REQUIRED/);
      await assert.rejects(db.orgAssignment.updateMany({where:{employeeId:employees[0].id},data:{effectiveTo:date('2026-09-09')}}), /WORKSHOP_CLOSED_RETURN_REQUIRED/, 'moving the old assignment outside the period still changes frozen evidence');
      await assert.rejects(db.legalParameter.create({data:{paramCode:'OT_YEAR_MAX_MINUTES',scopeKey:'SITE:'+site.id,subjectType:'ALL',applicationBasis:'WORK_DATE',value:'480',unit:'minute',effectiveFrom:date(workDate),documentEffectiveDate:date(workDate),legalBasis:'Nguồn đã chốt'}}), /WORKSHOP_CLOSED_RETURN_REQUIRED/);
      const frozenDay=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedules[0].id}});
      await ok('/attendance/process',ad,{siteId:site.id,referencePeriodId:period.id});
      assert.deepEqual(await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedules[0].id}}),frozenDay,'processing does not rewrite a closed workshop while other workshops remain open');
      const imported = await upload([[employees[0].code, workDate, '22:06:00', 'WC-NEW-' + tag, 'IN'].join(',')]);
      assert.ok(imported.batch?.id);
      const stale = (await workshopReview(qd)).body;
      assert.equal(stale.state, 'STALE', 'a raw import invalidates rather than mutating the frozen close snapshot');
      assert.ok(stale.history[0].snapshot);
    });

    await t.test('return requires a reason, re-confirmation appends history, and final closure freezes the period', async () => {
      const stale = (await workshopReview(qd)).body;
      const missingReason = await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshop.id, revision: stale.revision, sourceHash: stale.sourceHash, reason: '' });
      assert.equal(missingReason.status, 400);
      const returned = await request('/attendance/workshop-closures/return', qd, { periodId: period.id, workshopOrgUnitId: workshop.id, revision: stale.revision, sourceHash: stale.sourceHash, reason: 'Bổ sung nguồn công mới cần rà soát lại' });
      assert.equal(returned.status, 201, JSON.stringify(returned.body));

      await db.shiftSchedule.update({ where: { id: schedules[0].id }, data: { startAt: new Date(workDate + 'T21:55:00+07:00') } });
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
      await confirmTeam(firstTeam);
      const reReady = (await workshopReview(qd)).body;
      assert.equal(reReady.state, 'RETURNED');
      assert.equal(reReady.canClose, true, JSON.stringify(reReady.blockers));
      assert.equal((await close(qd, reReady)).status, 201);
      const reClosed = (await workshopReview(qd)).body;
      assert.deepEqual(reClosed.history.map(item => item.action), ['CLOSE', 'RETURN', 'CLOSE']);
      assert.ok(reClosed.history[0].snapshot, 'the first immutable close snapshot remains available after re-close');

      await confirmTeam(pendingTeam);
      await db.roleAssignment.create({ data: { userAccountId: qdActor.id, roleCode: 'QD', scopeOrgUnitId: pendingWorkshop.id, effectiveFrom: date('2026-01-01') } });
      const finalReadyResponse = await workshopReview(qd, pendingWorkshop.id);
      assert.equal(finalReadyResponse.status, 200, JSON.stringify(finalReadyResponse.body));
      assert.equal(finalReadyResponse.body.canClose, true, JSON.stringify(finalReadyResponse.body.blockers));
      assert.equal((await close(qd, finalReadyResponse.body)).status, 201);
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, 'CLOSED');
      const readAfterClose = await reviewedTeam(firstTeam);
      assert.equal(readAfterClose.state, 'CONFIRMED', 'reading a closed period does not falsely stale a valid TT confirmation');
      const frozenDay = await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedules[0].id } });
      const lateImport = await importRequest([[employees[0].code, workDate, '22:07:00', 'WC-CLOSED-' + tag, 'IN'].join(',')]);
      assert.equal(lateImport.status, 201, JSON.stringify(lateImport.body));
      assert.deepEqual(await db.dailyAttendance.findUniqueOrThrow({ where: { scheduleId: schedules[0].id } }), frozenDay, 'closed-period import only records immutable raw evidence');
      assert.equal((await db.businessPeriod.findUniqueOrThrow({ where: { id: period.id } })).status, "CLOSED", "late evidence does not reopen the period; source freshness is reviewed separately by KT");
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
