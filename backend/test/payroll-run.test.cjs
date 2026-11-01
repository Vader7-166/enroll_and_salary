const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { cipherText } = require('../dist/common/data-crypto.js');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const date = value => new Date(value + 'T00:00:00.000Z');
const at = (day, time) => new Date(day + 'T' + time + '+07:00');

test('Payroll run on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_payroll_' + randomUUID().replaceAll('-', '');
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
    const [tt, qd, kt, ktbn, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'kt.bn', 'ad.demo'].map(login));
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshop = unit('NM-BN-D1'), team = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const [ttActor, ktActor] = await Promise.all(['tt.bn', 'kt.all'].map(username => db.userAccount.findUniqueOrThrow({ where: { username } })));
    const timeComponent = await db.salaryComponent.create({ data: { orgUnitId: company.id, code: 'PR_LUONG_TG_' + tag, versions: { create: { name: 'Lương thời gian', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, displayOrder: 1, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
    const people = {};
    for (const [code, salary, withPlan] of [['A', '13000000', true], ['B', '5000000', true], ['C', '9000000', false]]) {
      const employee = await db.employee.create({ data: { code: 'PR-' + tag + '-' + code, fullName: 'Bảng lương ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: date('2026-01-01'), signedDate: date('2025-12-20'), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true } });
      await db.taxProfile.create({ data: { employeeId: employee.id, residency: 'RESIDENT', reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2026-01-01') } });
      if (withPlan) await db.employeePayPlan.create({ data: { employeeId: employee.id, versions: { create: { name: 'Lương thời gian', payMode: 'MONTHLY', status: 'SIMULATION', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id, lines: [{ componentId: timeComponent.id, role: 'BASE', sourceType: 'TIME', formulaCode: 'LUONG_TG', sourceReference: 'Hợp đồng', allocation: 'INDIVIDUAL' }] } } } });
      people[code] = employee;
    }
    const shift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'PR-D-' + tag, name: 'Ca ngày bảng lương', kind: 'DAY', startTime: '08:00', endTime: '16:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 0, paidBreak: true, workMinutes: 480, isNightShift: false } });
    const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch bảng lương', status: 'APPROVED', createdById: ttActor.id } });
    const workDays = ['2026-10-05', '2026-10-06', '2026-10-07'];
    const lines = [];
    for (const person of Object.values(people)) for (const day of workDays) {
      await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: person.id, workDate: date(day), shiftId: shift.id, startAt: new Date(day + 'T08:00:00+07:00'), endAt: new Date(day + 'T16:00:00+07:00'), workMinutes: 480 } });
      lines.push([person.code, day, '08:00:00', 'PR-DEV-' + tag, 'IN'].join(','), [person.code, day, person === people.A && day === '2026-10-05' ? '18:00:00' : '16:00:00', 'PR-DEV-' + tag, 'OUT'].join(','));
    }
    await db.overtimeRequest.create({ data: { teamOrgUnitId: team.id, title: 'OT bảng lương', workDate: date('2026-10-05'), startAt: new Date('2026-10-05T16:00:00+07:00'), endAt: new Date('2026-10-05T18:00:00+07:00'), requestedMinutes: 120, reason: 'OT có căn cứ', status: 'APPROVED', createdById: ttActor.id, members: { create: { employeeId: people.A.id, consentReference: 'PR-CONSENT' } } } });
    const policy = await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } });
    const attendancePeriod = await db.businessPeriod.create({ data: { code: 'PR-ATT-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date(workDays[0]), dateTo: date(workDays[2]), cutoffDay: 25, cutoffPolicyId: policy.id, status: 'OPEN' } });
    const form = new FormData();
    form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'payroll.csv'); form.set('siteId', site.id); form.set('referencePeriodId', attendancePeriod.id);
    await ok('/attendance/imports', ad, form);
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: attendancePeriod.id });
    const payrollPeriod = await db.payrollPeriod.create({ data: { code: 'PR-PL-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date(workDays[0]), dateTo: date(workDays[2]), expectedPaymentDate: date('2026-11-05') } });
    async function waitRun(runId) {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const view = await ok('/payroll/runs/' + runId, kt);
        if (view.run.status !== 'RUNNING') return view;
        await new Promise(done => setTimeout(done, 100));
      }
      throw new Error('Run did not finish');
    }

    await t.test('TC-K06: an unlocked attendance source refuses the run without lines', async () => {
      const refused = await request('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id });
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'PERIOD_NOT_LOCKED');
      assert.equal(refused.body.details.periods[0].status, 'OPEN');
      assert.equal(await db.payrollRun.count(), 0);
      assert.equal((await request('/payroll/runs', tt, { payrollPeriodId: payrollPeriod.id })).status, 403);
    });

    await t.test('Lock the attendance period through TT → QĐ → KT', async () => {
      let review = await ok('/attendance/team-confirmations/review?periodId=' + attendancePeriod.id + '&teamOrgUnitId=' + team.id, tt);
      if (review.coverage?.sourceHash !== review.collection.sourceHash) {
        await ok('/attendance/team-confirmations/coverage', ad, { periodId: attendancePeriod.id, teamOrgUnitId: team.id, revision: review.coverage?.revision ?? 0, sourceHash: review.collection.sourceHash, coveredFrom: review.collection.from, coveredUntil: review.collection.until, batchIds: review.collection.requiredBatchIds, reference: 'Biên bản ' + tag, reason: 'Đủ nguồn' });
        review = await ok('/attendance/team-confirmations/review?periodId=' + attendancePeriod.id + '&teamOrgUnitId=' + team.id, tt);
      }
      assert.equal(review.canConfirm, true, JSON.stringify(review.blockers));
      await ok('/attendance/team-confirmations', tt, { periodId: attendancePeriod.id, teamOrgUnitId: team.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT xác nhận' });
      const closure = await ok('/attendance/workshop-closures/review?periodId=' + attendancePeriod.id + '&workshopOrgUnitId=' + workshop.id, qd);
      await ok('/attendance/workshop-closures', qd, { periodId: attendancePeriod.id, workshopOrgUnitId: workshop.id, revision: closure.revision, sourceHash: closure.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'QĐ chốt' });
      const lock = await ok('/attendance/period-locks/review?periodId=' + attendancePeriod.id, kt);
      assert.equal(lock.canLock, true, JSON.stringify(lock.blockers));
      await ok('/attendance/period-locks', kt, { periodId: attendancePeriod.id, revision: lock.revision, sourceHash: lock.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'KT khóa' });
    });

    let first, sheet;
    await t.test('KT runs payroll: pipeline lines, isolated error, insurance and tax drafts', async () => {
      const started = await ok('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id });
      first = await waitRun(started.run.id);
      assert.equal(first.run.status, 'COMPLETED', JSON.stringify(first.run));
      assert.equal(first.run.progressTotal, 3); assert.equal(first.run.errorCount, 1);
      assert.deepEqual(first.errors.map(error => [error.employee.code, error.code]), [[people.C.code, 'PAY_PLAN_MISSING']]);
      sheet = (await ok('/payroll/sheets?payrollPeriodId=' + payrollPeriod.id, kt));
      const byCode = Object.fromEntries(sheet.items.map(item => [item.employee.code.split('-').at(-1), item]));
      assert.deepEqual([byCode.A.status, byCode.B.status, byCode.C.status], ['OK', 'OK', 'ERROR']);
      const detail = await ok('/payroll/sheets/' + sheet.sheet.id + '/employees/' + people.A.id, kt);
      const amount = type => detail.lines.filter(line => line.lineType === type).reduce((total, line) => total + Number(line.amount), 0);
      assert.equal(amount('MAIN'), 1500000);
      assert.equal(amount('OT'), 187500);
      assert.equal(amount('INSURANCE_EMPLOYEE'), 1365000);
      assert.equal(amount('UNION_FEE'), 130000);
      assert.equal(amount('TAX'), 0);
      assert.equal(amount('NET'), 1500000 + 187500 - 1365000 - 130000);
      assert.equal(byCode.A.hourlyRate.rate, '62500');
      assert.equal(await db.insuranceContribution.count({ where: { payrollPeriodId: payrollPeriod.id } }), 2);
      const withholdings = await db.taxWithholding.findMany({ where: { payrollPeriodId: payrollPeriod.id } });
      assert.deepEqual(withholdings.map(row => [row.paymentDateStatus, row.taxPeriod, row.status]).sort(), [['PROJECTED', '2026-11', 'DRAFT'], ['PROJECTED', '2026-11', 'DRAFT']]);
      const stored = await db.payrollEmployee.findFirstOrThrow({ where: { employeeId: people.A.id } });
      assert.ok(stored.netPayCipher.startsWith('v1.'));
    });

    await t.test('Compliance gates: CP-01 blocks B (vùng I), others clean; BLOCKING cannot be acknowledged', async () => {
      const compliance = await ok('/payroll/sheets/' + sheet.sheet.id + '/compliance', kt);
      const byCode = Object.fromEntries(compliance.items.map(item => [item.code, item]));
      assert.equal(compliance.items.length, 10);
      assert.equal(byCode['CP-01'].violationCount, 1);
      assert.equal(byCode['CP-01'].details[0].employeeId, people.B.id);
      assert.match(byCode['CP-01'].details[0].message, /5310000/);
      // A 3-day period still carries a full month of insurance at the regional floor, so B's net is negative.
      assert.deepEqual(byCode['CP-05'].details.map(item => item.employeeId), [people.B.id]);
      for (const code of ['CP-02', 'CP-03', 'CP-04', 'CP-06', 'CP-07', 'CP-08', 'CP-09']) assert.equal(byCode[code].violationCount, 0, code);
      const refused = await request('/payroll/sheets/' + sheet.sheet.id + '/compliance/acknowledge', kt, { code: 'CP-01', employeeId: people.B.id, reason: 'Ghi đè' });
      assert.equal(refused.status, 400); assert.equal(refused.body.code, 'COMPLIANCE_NOT_ACKNOWLEDGEABLE');
    });

    await t.test('Drill-down: OT line shows hourly rate, buckets, attendance days and punches', async () => {
      const lineRow = (await db.payrollLine.findMany({ where: { lineType: 'OT', payrollEmployee: { employeeId: people.A.id } } }))[0];
      const trace = await ok('/payroll/lines/' + lineRow.id + '/trace', kt);
      assert.equal(trace.line.amount, '187500');
      assert.deepEqual([trace.trace.hourlyRate.numerator, trace.trace.hourlyRate.denominatorHours], ['1500000', '24']);
      assert.equal(trace.trace.buckets[0].rate, '1.5');
      assert.equal(trace.attendance[0].workDate, '2026-10-05');
      assert.ok(trace.attendance[0].punches.length >= 1);
      assert.ok(trace.sources.some(source => source.sourceType === 'OVERTIME_PAY_BUCKETS'));
      const mainRow = (await db.payrollLine.findMany({ where: { lineType: 'MAIN', payrollEmployee: { employeeId: people.A.id } } }))[0];
      const mainTrace = await ok('/payroll/lines/' + mainRow.id + '/trace', kt);
      assert.equal(mainTrace.trace.segments[0].quantity, '3');
      assert.ok(mainTrace.sources.some(source => source.sourceType === 'ATTENDANCE_LOCK'));
    });

    await t.test('NFR-11: line drill-down p95 stays within 3 s', async () => {
      const lines = await db.payrollLine.findMany({ where: { lineType: { in: ['MAIN', 'OT', 'TAX', 'INSURANCE_EMPLOYEE'] } }, select: { id: true }, take: 8 });
      const times = [];
      for (let round = 0; round < 5; round++) for (const line of lines) { const started = Date.now(); await ok('/payroll/lines/' + line.id + '/trace', kt); times.push(Date.now() - started); }
      times.sort((a, b) => a - b);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      // Read by scripts/benchmark-nightly.cjs.
      console.log('NFR11_RESULT ' + JSON.stringify({ samples: times.length, lines: lines.length, p95Ms: p95, maxMs: times.at(-1), limitMs: 3000 }));
      assert.ok(p95 <= 3000, 'NFR-11 p95 ' + p95 + ' ms');
    });

    await t.test('TC-P06: re-running with the same sources reproduces hashes and amounts; drafts are updated, not duplicated', async () => {
      const before = await ok('/payroll/sheets/' + sheet.sheet.id + '/employees/' + people.A.id, kt);
      const started = await ok('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id });
      const second = await waitRun(started.run.id);
      assert.equal(second.run.sourceHash, first.run.sourceHash);
      const after = await ok('/payroll/sheets/' + sheet.sheet.id + '/employees/' + people.A.id, kt);
      assert.deepEqual(after.lines.map(line => [line.lineType, line.amount]), before.lines.map(line => [line.lineType, line.amount]));
      const refreshed = await ok('/payroll/sheets/' + sheet.sheet.id, kt);
      assert.equal(refreshed.sheet.calcCount, 2);
      assert.equal(await db.taxWithholding.count({ where: { payrollPeriodId: payrollPeriod.id } }), 2);
      assert.equal((await db.taxWithholding.findFirstOrThrow({ where: { employeeId: people.A.id } })).revision, 2);
      assert.equal(await db.payrollEmployee.count({ where: { sheetId: sheet.sheet.id } }), 3);
      assert.equal((await request('/payroll/runs/' + started.run.id + '/cancel', kt, {})).status, 409);
    });

    await t.test('Partial re-run touches only the listed employee', async () => {
      const aBefore = await db.payrollEmployee.findFirstOrThrow({ where: { employeeId: people.A.id } });
      const started = await ok('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id, employeeIds: [people.B.id] });
      const run = await waitRun(started.run.id);
      assert.equal(run.run.progressTotal, 1);
      assert.equal((await db.payrollEmployee.findFirstOrThrow({ where: { employeeId: people.A.id } })).id, aBefore.id);
      const compliance = await ok('/payroll/sheets/' + sheet.sheet.id + '/compliance', kt);
      assert.equal(compliance.items.find(item => item.code === 'CP-01').violationCount, 1, 'gates aggregate the whole sheet');
    });

    await t.test('Exclusion hides the employee from the sheet and denies drill-down with audit', async () => {
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: ktActor.id, employeeId: people.A.id, effectiveFrom: date('2026-01-01') } });
      try {
        const hidden = await ok('/payroll/sheets/' + sheet.sheet.id, kt);
        assert.ok(!hidden.items.some(item => item.employee.id === people.A.id));
        const lineRow = (await db.payrollLine.findMany({ where: { lineType: 'OT', payrollEmployee: { employeeId: people.A.id } } }))[0];
        assert.equal((await request('/payroll/lines/' + lineRow.id + '/trace', kt)).status, 403);
        assert.ok(await db.auditLog.findFirst({ where: { entityType: 'payroll_line', action: 'ACCESS_DENIED' } }));
        assert.ok((await ok('/payroll/sheets/' + sheet.sheet.id, ktbn)).items.some(item => item.employee.id === people.A.id), 'other KT in scope still sees it');
      } finally { await db.employeeExclusion.delete({ where: { id: exclusion.id } }); }
      assert.equal((await request('/payroll/sheets/' + sheet.sheet.id, ad)).status, 403);
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
