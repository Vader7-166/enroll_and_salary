const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { existsSync, readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const Decimal = require('decimal.js');
const { cipherText, plainText } = require('../dist/common/data-crypto.js');
const { payslipView } = require('../dist/payroll-output/payslip-renderer.js');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const date = value => new Date(value + 'T00:00:00.000Z');

test('UAT-21: the payslip prints each organisational segment with its work units', () => {
  const employee = { employeeId: 'e', code: 'NV1', fullName: 'Điều chuyển', status: 'OK', totals: { gross: '10', insuranceEmployee: '0', unionFee: '0', tax: '0', deductions: '0', adjustments: '0', net: '10' },
    units: [{ orgUnitCode: 'T1', orgUnitName: 'Tổ 1', from: '2026-10-01', to: '2026-10-15', workUnits: '11' }, { orgUnitCode: 'T3', orgUnitName: 'Tổ 3', from: '2026-10-16', to: '2026-10-31', workUnits: '13.5' }],
    lines: [{ lineNo: 1, lineType: 'MAIN', label: 'Lương', componentCode: 'L', quantity: '24.5', amount: '10' }, { lineNo: 2, lineType: 'ADJUSTMENT', label: 'Truy lĩnh', componentCode: 'RETRO', sourceReference: 'Kỳ gốc PL-09', amount: '0' }] };
  const view = payslipView({ period: { code: 'PL-10', dateFrom: '2026-10-01', dateTo: '2026-10-31', expectedPaymentDate: null }, employees: [employee] }, employee, { siteName: 'S', companyName: 'C', snapshotHash: 'h' });
  assert.deepEqual(view.units.map(unit => [unit.orgUnit, unit.workUnits]), [['T1 — Tổ 1', '11'], ['T3 — Tổ 3', '13.5']]);
  assert.equal(view.sections.find(section => section.title.startsWith('Điều chỉnh')).rows[0].detail, 'Kỳ gốc PL-09');
  assert.match(view.sections[0].rows[0].detail, /24,5 công/);
});

test('Payslips, payment files, actual payment date and late-payment compensation on isolated PostgreSQL and real HTTP', { timeout: 600000 }, async t => {
  const name = 'hrtp_payroll_output_' + randomUUID().replaceAll('-', '');
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
    async function request(path, cookie, body, headers = {}) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...headers, ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, type, body: type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body, headers) {
      const result = await request(path, cookie, body, headers);
      assert.ok(result.status >= 200 && result.status < 300, path + ' ' + JSON.stringify(result.type.includes('json') ? result.body : result.status) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    const password = username => credentials.find(account => account.username === username).password;
    async function login(username) {
      const result = await request('/auth/login', null, { username, password: password(username) });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    const [tt, qd, kt, ktbn, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'kt.bn', 'ad.demo'].map(login));
    const reauth = async (cookie = kt, username = 'kt.all') => (await ok('/auth/reauthenticate', cookie, { password: password(username) })).token;
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshop = unit('NM-BN-D1'), team = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const [ttActor, ktActor] = await Promise.all(['tt.bn', 'kt.all'].map(username => db.userAccount.findUniqueOrThrow({ where: { username } })));
    const timeComponent = await db.salaryComponent.create({ data: { orgUnitId: company.id, code: 'PO_LUONG_TG_' + tag, versions: { create: { name: 'Lương thời gian', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, displayOrder: 1, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2025-01-01'), createdById: ktActor.id } } } });
    const people = {};
    for (const [code, salary] of [['A', '13000000'], ['B', '7800000'], ['C', '9000000']]) {
      const employee = await db.employee.create({ data: { code: 'PO-' + tag + '-' + code, fullName: 'Phiếu lương ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2025-01-01'), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2025-01-01'), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: date('2025-01-01'), signedDate: date('2024-12-20'), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true } });
      await db.taxProfile.create({ data: { employeeId: employee.id, residency: 'RESIDENT', reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2025-01-01') } });
      await db.employeePayPlan.create({ data: { employeeId: employee.id, versions: { create: { name: 'Lương thời gian', payMode: 'MONTHLY', status: 'SIMULATION', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2025-01-01'), createdById: ktActor.id, lines: [{ componentId: timeComponent.id, role: 'BASE', sourceType: 'TIME', formulaCode: 'LUONG_TG', sourceReference: 'Hợp đồng', allocation: 'INDIVIDUAL' }] } } } });
      people[code] = employee;
    }
    const shift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'PO-D-' + tag, name: 'Ca ngày phiếu lương', kind: 'DAY', startTime: '08:00', endTime: '16:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 0, paidBreak: true, workMinutes: 480, isNightShift: false } });
    const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch phiếu lương', status: 'APPROVED', createdById: ttActor.id } });
    const policy = await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } });

    /** Schedules, punches, imports and processes one attendance period, then locks it through TT → QĐ → KT. */
    async function attendancePeriod(code, workDays) {
      const lines = [];
      for (const person of Object.values(people)) for (const day of workDays) {
        await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: person.id, workDate: date(day), shiftId: shift.id, startAt: new Date(day + 'T08:00:00+07:00'), endAt: new Date(day + 'T16:00:00+07:00'), workMinutes: 480 } });
        lines.push([person.code, day, '08:00:00', 'PO-DEV-' + tag, 'IN'].join(','), [person.code, day, '16:00:00', 'PO-DEV-' + tag, 'OUT'].join(','));
      }
      const period = await db.businessPeriod.create({ data: { code: code + '-' + tag, scopeOrgUnitId: siteUnit.id, periodType: 'ATTENDANCE', dateFrom: date(workDays[0]), dateTo: date(workDays.at(-1)), cutoffDay: 25, cutoffPolicyId: policy.id, status: 'OPEN' } });
      const form = new FormData();
      form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), code + '.csv'); form.set('siteId', site.id); form.set('referencePeriodId', period.id);
      await ok('/attendance/imports', ad, form);
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
      let review = await ok('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt);
      if (review.coverage?.sourceHash !== review.collection.sourceHash) {
        await ok('/attendance/team-confirmations/coverage', ad, { periodId: period.id, teamOrgUnitId: team.id, revision: review.coverage?.revision ?? 0, sourceHash: review.collection.sourceHash, coveredFrom: review.collection.from, coveredUntil: review.collection.until, batchIds: review.collection.requiredBatchIds, reference: 'Biên bản ' + tag, reason: 'Đủ nguồn' });
        review = await ok('/attendance/team-confirmations/review?periodId=' + period.id + '&teamOrgUnitId=' + team.id, tt);
      }
      assert.equal(review.canConfirm, true, JSON.stringify(review.blockers));
      await ok('/attendance/team-confirmations', tt, { periodId: period.id, teamOrgUnitId: team.id, revision: review.revision, sourceHash: review.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'TT xác nhận' });
      const closure = await ok('/attendance/workshop-closures/review?periodId=' + period.id + '&workshopOrgUnitId=' + workshop.id, qd);
      await ok('/attendance/workshop-closures', qd, { periodId: period.id, workshopOrgUnitId: workshop.id, revision: closure.revision, sourceHash: closure.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'QĐ chốt' });
      const lock = await ok('/attendance/period-locks/review?periodId=' + period.id, kt);
      assert.equal(lock.canLock, true, JSON.stringify(lock.blockers));
      await ok('/attendance/period-locks', kt, { periodId: period.id, revision: lock.revision, sourceHash: lock.sourceHash, reviewed: true, acknowledgeWarnings: true, note: 'KT khóa' });
      return period;
    }
    async function calculate(payrollPeriod) {
      const started = await ok('/payroll/runs', kt, { payrollPeriodId: payrollPeriod.id });
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const view = await ok('/payroll/runs/' + started.run.id, kt);
        if (view.run.status !== 'RUNNING') { assert.equal(view.run.status, 'COMPLETED', JSON.stringify(view)); break; }
        await new Promise(done => setTimeout(done, 100));
      }
      return ok('/payroll/sheets?payrollPeriodId=' + payrollPeriod.id, kt);
    }
    async function approve(view) {
      const compliance = await ok('/payroll/sheets/' + view.sheet.id + '/compliance', kt);
      for (const detail of compliance.items.find(item => item.code === 'CP-08').details) await ok('/payroll/sheets/' + view.sheet.id + '/compliance/acknowledge', kt, { code: 'CP-08', employeeId: detail.employeeId, reason: 'Kỳ dài hơn kỳ trước' });
      const current = (await ok('/payroll/sheets/' + view.sheet.id + '/history', kt)).revision;
      return ok('/payroll/sheets/' + view.sheet.id + '/approve', kt, { revision: current });
    }
    const lockSheet = async (sheetId, revision) => ok('/payroll/sheets/' + sheetId + '/lock', kt, { revision, reauthToken: await reauth() });
    const snapshotOf = async sheetId => JSON.parse(plainText(key, (await db.payrollSnapshot.findUniqueOrThrow({ where: { sheetId } })).contentCipher));

    await attendancePeriod('PO-ATT1', ['2026-10-05', '2026-10-06', '2026-10-07']);
    const period1 = await db.payrollPeriod.create({ data: { code: 'PO-P1-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-05'), dateTo: date('2026-10-07'), expectedPaymentDate: date('2025-12-31'), isInitial: true } });
    let sheet1 = await calculate(period1);
    const approved1 = await approve(sheet1);
    const vcb = (await ok('/payroll/bank-templates', kt)).items.find(item => item.bankCode === 'VCB' && item.current);

    await t.test('UAT-01: an unlocked period refuses payslips and payment files', async () => {
      for (const path of ['/payroll/sheets/' + sheet1.sheet.id + '/payslips', '/payroll/sheets/' + sheet1.sheet.id + '/payslips/' + people.A.id + '/pdf']) {
        const refused = await request(path, kt);
        assert.equal(refused.status, 409); assert.equal(refused.body.code, 'PAYROLL_NOT_LOCKED');
      }
      const batch = await request('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: vcb.id, reauthToken: await reauth() });
      assert.equal(batch.status, 409); assert.equal(batch.body.code, 'PAYROLL_NOT_LOCKED');
      assert.equal((await request('/payroll/sheets/' + sheet1.sheet.id + '/payslips', tt)).status, 403);
      assert.equal(await db.payslip.count(), 0);
      await lockSheet(sheet1.sheet.id, approved1.revision);
    });

    const snapshot1 = await db.payrollSnapshot.findUniqueOrThrow({ where: { sheetId: sheet1.sheet.id } });
    const content1 = await snapshotOf(sheet1.sheet.id);
    const netOf = (content, person) => content.employees.find(row => row.employeeId === person.id).totals.net;
    const expectedPassword = person => person.code + '0901' + '01011990';
    for (const [person, id] of [[people.A, '001090000901'], [people.C, '001090001901']]) await ok('/employees/' + person.id + '/payroll-profile/identity', kt, { revision: 0, documentType: 'CCCD', idNumber: id, dataStatus: 'SIMULATION', reason: 'Kiểm thử phiếu lương' });

    await t.test('Single payslip is an AES-256 password PDF from the snapshot, audited, password never stored; missing identity fails alone', async () => {
      const file = await request('/payroll/sheets/' + sheet1.sheet.id + '/payslips/' + people.A.id + '/pdf', kt);
      assert.equal(file.status, 200); assert.equal(file.type, 'application/pdf');
      assert.equal(file.body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(file.body.includes('/Encrypt') && file.body.includes('/AESV3'), 'PDF is encrypted with AES-256');
      const issued = await db.payslip.findFirstOrThrow({ where: { employeeId: people.A.id, channel: 'SINGLE' } });
      assert.deepEqual([issued.status, issued.snapshotHash], ['ISSUED', snapshot1.contentHash]);
      const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'EXPORT_PAYSLIP', result: 'SUCCESS' } });
      for (const stored of [issued, audit].map(row => JSON.stringify(row, (_, value) => typeof value === 'bigint' ? String(value) : value))) assert.ok(!stored.includes(expectedPassword(people.A)), 'password is not persisted');
      const missing = await request('/payroll/sheets/' + sheet1.sheet.id + '/payslips/' + people.B.id + '/pdf', kt);
      assert.equal(missing.status, 409); assert.equal(missing.body.code, 'PAYSLIP_PASSWORD_DATA_MISSING');
      assert.equal((await db.payslip.findFirstOrThrow({ where: { employeeId: people.B.id } })).status, 'FAILED');
    });

    await t.test('Print view carries mandatory sections and work units per segment', async () => {
      const { payslip } = await ok('/payroll/sheets/' + sheet1.sheet.id + '/payslips/' + people.A.id, kt);
      assert.equal(payslip.employee.fullName, 'Phiếu lương A');
      assert.deepEqual(payslip.units.map(row => row.workUnits), ['3']);
      assert.deepEqual(payslip.sections.map(section => section.title.split(' ')[0]), ['Thu', 'Bảo', 'Thuế', 'Khấu', 'Điều']);
      assert.equal(payslip.net, netOf(content1, people.A));
      assert.ok(await db.auditLog.findFirst({ where: { action: 'PRINT_PAYSLIP' } }));
    });

    await t.test('Bulk export: progress, per-file error, encrypted one-time archive, business data unchanged (NFR-43)', async () => {
      const before = { lines: await db.payrollLine.count(), revision: (await db.payrollSheet.findUniqueOrThrow({ where: { id: sheet1.sheet.id } })).revision };
      const started = await ok('/payroll/sheets/' + sheet1.sheet.id + '/payslips/exports', kt, {});
      let status;
      for (let attempt = 0; attempt < 600; attempt += 1) {
        status = await ok('/payroll/payslip-exports/' + started.export.id, kt);
        if (status.export.status !== 'RUNNING') break;
        await new Promise(done => setTimeout(done, 100));
      }
      assert.deepEqual([status.export.status, status.export.progressDone, status.export.errorCount], ['COMPLETED', 3, 1]);
      assert.deepEqual(status.errors.map(row => [row.employee.code, row.code]), [[people.B.code, 'PAYSLIP_PASSWORD_DATA_MISSING']]);
      const job = await db.payslipExport.findUniqueOrThrow({ where: { id: started.export.id } });
      assert.notEqual(readFileSync(job.archivePath).subarray(0, 2).toString(), 'PK', 'archive at rest is encrypted');
      assert.equal((await request('/payroll/payslip-exports/' + job.id + '/download', ktbn)).status, 403);
      const download = await request('/payroll/payslip-exports/' + job.id + '/download', kt);
      assert.equal(download.status, 200);
      const zip = await JSZip.loadAsync(download.body);
      assert.deepEqual(Object.keys(zip.files).sort(), ['DANH_SACH_LOI.csv', `phieu-luong-${period1.code}-${people.A.code}.pdf`, `phieu-luong-${period1.code}-${people.C.code}.pdf`].sort());
      assert.match(await zip.file('DANH_SACH_LOI.csv').async('string'), new RegExp(people.B.code + ',PAYSLIP_PASSWORD_DATA_MISSING'));
      assert.ok((await zip.file(`phieu-luong-${period1.code}-${people.C.code}.pdf`).async('nodebuffer')).includes('/AESV3'));
      const again = await request('/payroll/payslip-exports/' + job.id + '/download', kt);
      assert.equal(again.status, 409); assert.equal(again.body.code, 'PAYSLIP_EXPORT_NOT_AVAILABLE');
      assert.equal(existsSync(job.archivePath), false);
      assert.equal(await db.payslip.count({ where: { exportId: job.id, status: 'ISSUED' } }), 2);
      assert.deepEqual({ lines: await db.payrollLine.count(), revision: (await db.payrollSheet.findUniqueOrThrow({ where: { id: sheet1.sheet.id } })).revision }, before);
      assert.equal((await db.payrollSnapshot.findUniqueOrThrow({ where: { sheetId: sheet1.sheet.id } })).contentHash, snapshot1.contentHash);
      await assert.rejects(db.payslip.updateMany({ data: { status: 'FAILED' } }), /append-only/);
    });

    let bidv;
    await t.test('A new bank layout is configuration only; an invalid layout is refused', async () => {
      const invalid = await request('/payroll/bank-templates', kt, { bankCode: 'BIDV', name: 'Thiếu số tiền', fileType: 'CSV', columns: [{ field: 'ACCOUNT_NUMBER', header: 'TK' }], splitBySite: false, status: 'SIMULATION', reason: 'Thử' });
      assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'BANK_TEMPLATE_INVALID');
      const created = await ok('/payroll/bank-templates', kt, { bankCode: 'BIDV', name: 'BIDV CSV mô phỏng', fileType: 'CSV', columns: [{ field: 'SEQ', header: 'STT' }, { field: 'EMPLOYEE_CODE', header: 'Ma NV' }, { field: 'ACCOUNT_NUMBER', header: 'So TK' }, { field: 'BENEFICIARY_NAME', header: 'Ten', format: 'UPPER_ASCII' }, { field: 'AMOUNT', header: 'So tien', format: 'INTEGER' }, { field: 'DESCRIPTION', header: 'Noi dung' }], splitBySite: false, status: 'SIMULATION', reason: 'Thêm ngân hàng chi lương' });
      assert.equal(created.version, 1);
      bidv = (await ok('/payroll/bank-templates', kt)).items.find(item => item.id === created.id);
      assert.equal(bidv.current, true);
      assert.equal((await request('/payroll/bank-templates', tt)).status, 403);
    });

    let batch1;
    await t.test('Payment file: re-authentication, bank account required, exact net pay (BR-60), exported is not paid', async () => {
      const noToken = await request('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: bidv.id, reauthToken: 'x' });
      assert.equal(noToken.status, 403); assert.equal(noToken.body.code, 'REAUTH_REQUIRED');
      const token = await reauth();
      const missing = await request('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: bidv.id, reauthToken: token });
      assert.equal(missing.status, 409); assert.equal(missing.body.code, 'BANK_ACCOUNT_MISSING');
      assert.equal(missing.body.details.employees.length, 3);
      for (const [index, person] of Object.values(people).entries()) await ok('/employees/' + person.id + '/payroll-profile/bank-accounts', kt, { bankCode: 'BIDV', accountNumber: '1200' + tag.replace(/\D/g, '1').slice(0, 4) + index, accountHolder: 'Phiếu lương ' + 'ABC'[index], effectiveFrom: '2025-01-01', dataStatus: 'SIMULATION', reason: 'Tài khoản nhận lương' });
      const first = await ok('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: bidv.id, reauthToken: token, note: 'Lô thử' });
      assert.equal((await request('/payroll/payment-batches/' + first.batch.id + '/cancel', kt, { revision: first.batch.revision, reason: 'Sai ghi chú' })).status, 201);
      assert.equal(await db.salaryPaymentItem.count({ where: { batchId: first.batch.id, active: true } }), 0);
      batch1 = await ok('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: bidv.id, reauthToken: token });
      assert.deepEqual([batch1.batch.status, batch1.batch.itemCount, batch1.batch.dueDate], ['EXPORTED', 3, '2025-12-31']);
      assert.equal(batch1.batch.total, Object.values(people).reduce((sum, person) => sum.plus(netOf(content1, person)), new Decimal(0)).toString());
      const duplicate = await request('/payroll/payment-batches', kt, { sheetIds: [sheet1.sheet.id], templateId: bidv.id, reauthToken: token });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'PAYMENT_NOTHING_TO_EXPORT');
      assert.equal((await request('/payroll/payment-batches/' + batch1.batch.id + '/file', kt)).status, 403);
      const file = await request('/payroll/payment-batches/' + batch1.batch.id + '/file', kt, undefined, { 'x-reauth-token': token });
      assert.equal(file.status, 200); assert.match(file.type, /text\/csv/);
      const rows = file.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n').map(line => line.split(','));
      assert.deepEqual(rows[0], ['STT', 'Ma NV', 'So TK', 'Ten', 'So tien', 'Noi dung']);
      for (const person of Object.values(people)) assert.equal(rows.find(row => row[1] === person.code)[4], new Decimal(netOf(content1, person)).toFixed(0), 'net pay, no fee deducted');
      assert.equal(rows.find(row => row[1] === people.A.code)[3], 'PHIEU LUONG A');
      assert.deepEqual([...new Set((await db.taxWithholding.findMany({ where: { payrollPeriodId: period1.id } })).map(row => row.paymentDateStatus))], ['PROJECTED']);
    });

    const rate = '0.005';
    const compensation = person => new Decimal(netOf(content1, person)).times(20).times(rate).div(365).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString();
    await t.test('Actual payment 20 days late: compensation per formula, ACTUAL tax dates and TAX_CONTEXT_CHANGED on a tax-year change', async () => {
      const paid = await ok('/payroll/payment-batches/' + batch1.batch.id + '/paid', kt, { paidDate: '2026-01-20', revision: batch1.batch.revision, note: 'Chi muộn' });
      assert.deepEqual([paid.batch.status, paid.batch.lateDays, paid.result.graceDays], ['PAID', 20, 15]);
      assert.deepEqual(paid.result.compensations.map(row => [row.employee.code, row.amount]).sort(), Object.values(people).map(person => [person.code, compensation(person)]).sort());
      assert.equal(paid.result.lateWarning, null);
      const withholdings = await db.taxWithholding.findMany({ where: { payrollPeriodId: period1.id } });
      assert.deepEqual([...new Set(withholdings.map(row => [row.paymentDateStatus, row.contextFlag, row.paymentDate.toISOString().slice(0, 10)].join('|')))], ['ACTUAL|TAX_CONTEXT_CHANGED|2026-01-20']);
      assert.equal((await db.payrollSheet.findUniqueOrThrow({ where: { id: sheet1.sheet.id } })).status, 'LOCKED');
      const again = await request('/payroll/payment-batches/' + batch1.batch.id + '/paid', kt, { paidDate: '2026-01-21', revision: paid.batch.revision });
      assert.equal(again.status, 409); assert.equal(again.body.code, 'PAYMENT_BATCH_NOT_EXPORTED');
      await assert.rejects(db.salaryPaymentBatch.update({ where: { id: batch1.batch.id }, data: { note: 'sửa' } }), /immutable/);
    });

    await t.test('The next period carries a separate compensation line naming the origin period; a delay ≤ 15 days only warns', async () => {
      await attendancePeriod('PO-ATT2', ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
      const period2 = await db.payrollPeriod.create({ data: { code: 'PO-P2-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-08'), dateTo: date('2026-10-23'), expectedPaymentDate: date('2026-10-26') } });
      const sheet2 = await calculate(period2);
      const row = sheet2.items.find(item => item.employee.id === people.A.id);
      const lines = (await ok('/payroll/sheets/' + sheet2.sheet.id + '/employees/' + people.A.id, kt)).lines;
      const adjustment = lines.find(line => line.lineType === 'ADJUSTMENT');
      assert.deepEqual([adjustment.label, adjustment.componentCode, adjustment.amount], ['Đền bù chậm trả lương kỳ ' + period1.code, 'LATE_PAYMENT_COMPENSATION', compensation(people.A)]);
      assert.equal(row.totals.adjustments, compensation(people.A));
      const trace = await ok('/payroll/lines/' + adjustment.id + '/trace', kt);
      assert.match(trace.trace.explanation, /20 ngày chậm × 0.005\/năm ÷ 365/);
      const approved2 = await approve(sheet2);
      await lockSheet(sheet2.sheet.id, approved2.revision);
      assert.deepEqual([...new Set((await db.payrollAdjustment.findMany()).map(item => item.appliedPayrollPeriodId))], [period2.id]);
      const content2 = await snapshotOf(sheet2.sheet.id);
      assert.equal(content2.employees.find(item => item.employeeId === people.A.id).lines.find(line => line.lineType === 'ADJUSTMENT').sourceReference, 'Kỳ gốc ' + period1.code);
      await assert.rejects(db.payrollAdjustment.updateMany({ data: { label: 'sửa' } }), /immutable/);
      const { payslip } = await ok('/payroll/sheets/' + sheet2.sheet.id + '/payslips/' + people.A.id, kt);
      assert.deepEqual(payslip.sections.find(section => section.title.startsWith('Điều chỉnh')).rows.map(item => item.detail), ['Kỳ gốc ' + period1.code]);
      const token = await reauth();
      const batch2 = await ok('/payroll/payment-batches', kt, { sheetIds: [sheet2.sheet.id], templateId: vcb.id, reauthToken: token });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await request('/payroll/payment-batches/' + batch2.batch.id + '/file', kt, undefined, { 'x-reauth-token': token })).body);
      const sheet = workbook.worksheets[0];
      const amounts = new Map(); sheet.eachRow((excelRow, index) => { if (index > 1) amounts.set(excelRow.getCell(7).value, excelRow.getCell(4).value); });
      for (const person of Object.values(people)) assert.equal(amounts.get(person.code), Number(netOf(content2, person)));
      const paid = await ok('/payroll/payment-batches/' + batch2.batch.id + '/paid', kt, { paidDate: '2026-10-29', revision: batch2.batch.revision });
      assert.deepEqual([paid.batch.lateDays, paid.result.compensations.length], [3, 0]);
      assert.match(paid.result.lateWarning, /3 ngày/);
      assert.equal(await db.payrollAdjustment.count(), 3);
      assert.deepEqual([...new Set((await db.taxWithholding.findMany({ where: { payrollPeriodId: period2.id } })).map(item => item.contextFlag))], [null]);
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
