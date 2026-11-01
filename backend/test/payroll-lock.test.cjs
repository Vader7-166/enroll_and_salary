const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readdirSync, readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { cipherText } = require('../dist/common/data-crypto.js');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const date = value => new Date(value + 'T00:00:00.000Z');
const at = (day, time) => new Date(day + 'T' + time + '+07:00');

test('Payroll approval and lock on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_payroll_lock_' + randomUUID().replaceAll('-', '');
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
    for (const [code, salary, withPlan] of [['A', '13000000', true], ['B', '7800000', true], ['C', '9000000', false]]) {
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

    const sheetUrl = id => '/payroll/sheets/' + id;
    async function runAndWait() {
      const started = await ok('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id });
      const view = await waitRun(started.run.id);
      assert.equal(view.run.status, 'COMPLETED', JSON.stringify(view.run));
      return (await ok('/payroll/sheets?payrollPeriodId=' + payrollPeriod.id, kt)).sheet;
    }
    const history = id => ok(sheetUrl(id) + '/history', kt);
    let sheet;

    await t.test('Approval is refused while an employee is in error, then succeeds and records totals and hash', async () => {
      sheet = await runAndWait();
      const refused = await request(sheetUrl(sheet.id) + '/approve', kt, { revision: sheet.revision });
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'PAYROLL_APPROVAL_BLOCKED');
      const errors = refused.body.details.issues.find(issue => issue.code === 'PAYROLL_EMPLOYEE_ERRORS');
      assert.deepEqual(errors.employees.map(employee => employee.code), [people.C.code]);
      await db.employeePayPlan.create({ data: { employeeId: people.C.id, versions: { create: { name: 'Lương thời gian', payMode: 'MONTHLY', status: 'SIMULATION', decisionReference: 'KT', reason: 'Bổ sung', effectiveFrom: date('2026-01-01'), createdById: ktActor.id, lines: [{ componentId: timeComponent.id, role: 'BASE', sourceType: 'TIME', formulaCode: 'LUONG_TG', sourceReference: 'Hợp đồng', allocation: 'INDIVIDUAL' }] } } } });
      sheet = await runAndWait();
      assert.equal((await request(sheetUrl(sheet.id) + '/approve', tt, { revision: sheet.revision })).status, 403);
      const approved = await ok(sheetUrl(sheet.id) + '/approve', kt, { revision: sheet.revision, note: 'Đã rà soát' });
      assert.equal(approved.status, 'APPROVED');
      const log = await history(sheet.id);
      assert.equal(log.items[0].action, 'APPROVE'); assert.equal(log.items[0].sourceHash, sheet.sourceHash);
      assert.equal(Number(log.items[0].totals.employees), 3);
      sheet = { ...sheet, revision: approved.revision };
    });

    await t.test('UAT-10: a source change after approval returns the sheet to DRAFT with an audited reason', async () => {
      const allowance = await db.salaryComponent.create({ data: { orgUnitId: company.id, code: 'PR_PC_' + tag, versions: { create: { name: 'Phụ cấp', componentType: 'EARNING', active: true, isInsurable: false, taxClassification: 'TAXABLE', isOtBase: false, isProrated: true, displayOrder: 2, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
      await ok('/employees/' + people.A.id + '/salary-decisions', kt, { decisionNumber: 'QĐ-PC-' + tag, decisionDate: '2026-10-01', effectiveFrom: '2026-10-05', reason: 'Sửa phụ cấp', legalBasis: 'Quy chế', lines: [{ componentId: allowance.id, amount: '600000', salaryBasis: 'MONTHLY' }] });
      const log = await history(sheet.id);
      assert.equal(log.status, 'DRAFT');
      assert.equal(log.items[0].action, 'AUTO_DRAFT'); assert.match(log.items[0].reason, /SALARY_DECISION/);
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'payroll_sheet', action: 'AUTO_DRAFT', entityId: sheet.id } }));
    });

    await t.test('Hash safety net: a silent source change is caught at lock time and the sheet goes back to DRAFT', async () => {
      sheet = await runAndWait();
      const approved = await ok(sheetUrl(sheet.id) + '/approve', kt, { revision: sheet.revision });
      const decision = await db.salaryDecision.create({ data: { employeeId: people.B.id, decisionNumber: 'QĐ-SILENT-' + tag, decisionDate: date('2026-10-01'), effectiveFrom: date('2026-10-05'), reason: 'Ghi thẳng DB', legalBasis: 'Kiểm thử', createdById: ktActor.id } });
      await db.employeeSalary.create({ data: { employeeId: people.B.id, decisionId: decision.id, componentId: null, amountCipher: cipherText(key, '8200000.00'), salaryBasis: 'MONTHLY', effectiveFrom: date('2026-10-05') } });
      const { token } = await ok('/auth/reauthenticate', kt, { password: credentials.find(a => a.username === 'kt.all').password });
      const refused = await request(sheetUrl(sheet.id) + '/lock', kt, { revision: approved.revision, reauthToken: token });
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'PAYROLL_SOURCE_CHANGED');
      const log = await history(sheet.id);
      assert.deepEqual([log.status, log.items[0].action], ['DRAFT', 'AUTO_DRAFT']);
      assert.equal(await db.payrollSnapshot.count(), 0);
    });

    let locked;
    await t.test('Lock needs re-authentication, the previous period locked, then writes an immutable snapshot', async () => {
      sheet = await runAndWait();
      const approved = await ok(sheetUrl(sheet.id) + '/approve', kt, { revision: sheet.revision });
      const missing = await request(sheetUrl(sheet.id) + '/lock', kt, { revision: approved.revision, reauthToken: 'x' });
      assert.equal(missing.status, 403); assert.equal(missing.body.code, 'REAUTH_REQUIRED');
      const wrong = await request('/auth/reauthenticate', kt, { password: 'Sai-mat-khau-1!' });
      assert.equal(wrong.status, 403); assert.equal(wrong.body.code, 'REAUTH_FAILED');
      const { token } = await ok('/auth/reauthenticate', kt, { password: credentials.find(a => a.username === 'kt.all').password });
      assert.equal((await request(sheetUrl(sheet.id) + '/lock', ktbn, { revision: approved.revision, reauthToken: token })).body.code, 'REAUTH_REQUIRED', 'token is bound to the issuing session');
      const previous = await db.payrollPeriod.create({ data: { code: 'PR-PREV-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-09-26'), dateTo: date('2026-10-04') } });
      const blocked = await request(sheetUrl(sheet.id) + '/lock', kt, { revision: approved.revision, reauthToken: token });
      assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'PREV_PERIOD_NOT_LOCKED');
      await db.payrollPeriod.update({ where: { id: previous.id }, data: { status: 'LOCKED' } });
      locked = await ok(sheetUrl(sheet.id) + '/lock', kt, { revision: approved.revision, reauthToken: token, note: 'Khóa kỳ' });
      assert.match(locked.snapshot.contentHash, /^[a-f0-9]{64}$/);
      assert.equal((await db.payrollPeriod.findUniqueOrThrow({ where: { id: payrollPeriod.id } })).status, 'LOCKED');
      assert.deepEqual([...new Set((await db.taxWithholding.findMany({ where: { payrollPeriodId: payrollPeriod.id } })).map(row => row.status))], ['LOCKED']);
      const log = await history(sheet.id);
      assert.deepEqual([log.status, log.items[0].action, log.snapshot.contentHash], ['LOCKED', 'LOCK', locked.snapshot.contentHash]);
      assert.equal(log.snapshot.compliance.length, 10);
    });

    await t.test('Locked rows are immutable in the database and the period cannot be relocked or recalculated', async () => {
      const line = await db.payrollLine.findFirstOrThrow({ where: { payrollEmployee: { sheetId: sheet.id } } });
      await assert.rejects(db.payrollLine.update({ where: { id: line.id }, data: { label: 'Sửa' } }), /immutable/);
      await assert.rejects(db.payrollEmployee.deleteMany({ where: { sheetId: sheet.id } }), /immutable/);
      await assert.rejects(db.insuranceContribution.deleteMany({ where: { payrollPeriodId: payrollPeriod.id } }), /immutable/);
      await assert.rejects(db.payrollSnapshot.updateMany({ data: { contentHash: 'f'.repeat(64) } }), /immutable/);
      await assert.rejects(db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'DRAFT' } }), /immutable/);
      assert.equal((await request(sheetUrl(sheet.id) + '/lock', kt, { revision: 99, reauthToken: 'x' })).body.code, 'REAUTH_REQUIRED');
      assert.equal((await request('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id })).body.code, 'PAYROLL_PERIOD_LOCKED');
    });

    await t.test('TC-I09: a later source change creates a retro candidate and never touches the locked sheet', async () => {
      const created = await ok('/employees/' + people.A.id + '/salary-decisions', kt, { decisionNumber: 'QĐ-RETRO-' + tag, decisionDate: '2026-10-20', effectiveFrom: '2026-10-06', reason: 'Tăng lương hồi tố', legalBasis: 'Quy chế', lines: [{ amount: '14000000', salaryBasis: 'MONTHLY' }] });
      assert.deepEqual(created.retroCandidates.map(row => row.code), [payrollPeriod.code]);
      const log = await history(sheet.id);
      assert.deepEqual([log.status, log.snapshot.contentHash], ['LOCKED', locked.snapshot.contentHash]);
    });

    await t.test('UAT-20: the compliance PDF is rebuilt from the snapshot and carries its hash', async () => {
      const response = await fetch('http://127.0.0.1:' + port + '/api' + sheetUrl(sheet.id) + '/compliance-report.pdf', { headers: { cookie: kt } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      const pdf = Buffer.from(await response.arrayBuffer());
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.includes('snapshot-sha256:' + locked.snapshot.contentHash));
      assert.ok(await db.auditLog.findFirst({ where: { action: 'EXPORT_COMPLIANCE_PDF' } }));
    });

    await t.test('Due warning lists open periods close to their payment date', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
      const inTwoDays = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86_400_000).toISOString().slice(0, 10);
      const soon = await db.payrollPeriod.create({ data: { code: 'PR-SOON-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-12-01'), dateTo: date('2026-12-15'), expectedPaymentDate: date(inTwoDays) } });
      const periods = (await ok('/payroll/periods', kt)).items;
      assert.deepEqual(periods.find(item => item.id === soon.id).dueWarning, { daysLeft: 2, overdue: false, threshold: 3 });
      assert.equal(periods.find(item => item.id === payrollPeriod.id).dueWarning, null, 'locked periods never warn');
    });

    await t.test('FR-X.4: an encrypted backup restores into a clean database with valid snapshot hashes and audit chain', async () => {
      const dir = resolve(root, '.local', name + '-backups'), records = resolve(root, '.local', name + '-drills');
      const backupKey = randomUUID() + randomUUID();
      const pg = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: name };
      try {
        const backup = spawnSync('sh', [resolve(root, 'deploy/backup/backup.sh')], { env: { ...pg, BACKUP_DIR: dir, BACKUP_ONCE: 'true', BACKUP_ENCRYPTION_KEY: backupKey }, encoding: 'utf8', timeout: 120000 });
        assert.equal(backup.status, 0, backup.stderr + backup.stdout);
        const file = readdirSync(dir).find(entry => entry.endsWith('.dump.enc'));
        assert.ok(!readFileSync(resolve(dir, file)).includes(Buffer.from('payroll_snapshot')), 'the dump is not readable without the key');
        const drill = key => spawnSync(process.execPath, [resolve(root, 'scripts/restore-drill.cjs'), '--file', resolve(dir, file), '--out-dir', records], { env: { ...env, BACKUP_ENCRYPTION_KEY: key }, encoding: 'utf8', timeout: 240000 });
        const result = drill(backupKey);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
        assert.equal(summary.status, 'VALID');
        const report = JSON.parse(readFileSync(summary.record.replace(/\.md$/, '.json'), 'utf8'));
        const detail = check => report.checks.find(item => item.name === check);
        assert.match(detail('payroll-snapshot-hashes').detail, /^[1-9]\d* snapshot/, 'the locked payroll snapshot was re-verified');
        assert.match(detail('attendance-lock-hashes').detail, /^[1-9]\d* locked/, 'the locked attendance period was re-verified');
        assert.equal(detail('audit-hash-chain').status, 'VALID');
        assert.equal(detail('backup-file-sha256').status, 'VALID');
        assert.match(readFileSync(summary.record, 'utf8'), /Kết luận \| \*\*ĐẠT\*\*/);
        assert.notEqual(drill('wrong-' + backupKey).status, 0, 'a wrong backup key cannot restore');
      } finally {
        rmSync(dir, { recursive: true, force: true }); rmSync(records, { recursive: true, force: true });
      }
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
