const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const Decimal = require('decimal.js');
const { cipherText } = require('../dist/common/data-crypto.js');
const { calculateEmployee } = require('../dist/payroll/payroll-engine.js');
const { computeBonus, p3Conflict } = require('../dist/payroll/bonus/bonus-rules.js');
const { retroDiff } = require('../dist/payroll/retro/retro-diff.js');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const date = value => new Date(value + 'T00:00:00.000Z');

function context(extra = {}) {
  return {
    employee: { id: 'e1', code: 'NV1', fullName: 'NV 1', hireDate: '2026-01-01', terminationDate: null },
    period: { id: 'p', code: 'PL-10', dateFrom: '2026-10-01', dateTo: '2026-10-26', paymentDate: '2026-11-05', month: '2026-10' },
    planVersions: [{ id: 'pl', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'T', role: 'BASE', sourceType: 'TIME', allocation: 'INDIVIDUAL' }] }],
    components: { T: { isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, componentType: 'EARNING', code: 'LUONG_TG', name: 'Lương thời gian' } },
    inputs: [], salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-26', amount: '10000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }],
    units: [{ orgUnitId: 'u', orgUnitCode: 'U', orgUnitName: 'U', siteId: 's', wageRegionCode: 'I', costCenterCode: 'CC', from: '2026-10-01', to: '2026-10-26', days: 26, minimumMonth: { id: 'm', value: '4960000' }, minimumHour: null }],
    attendance: { available: true, days: Array.from({ length: 26 }, (_, index) => ({ workDate: '2026-10-' + String(index + 1).padStart(2, '0'), workUnits: '1', workedMinutes: 480, status: 'OK', correctionId: null })), regularMinutes: String(26 * 480), lockHashes: ['h'] },
    buckets: [], bucketHash: null, contracts: [], previousGross: null,
    params: { standardWorkdays: { id: 's', value: '26' }, deductionMaxNetRatio: { id: 'd', value: '0.3' }, varianceThreshold: null, otMonthMaxMinutes: null, probationMinRatio: null, roundingScale: 0 },
    ...extra,
  };
}
function hooks(capture = {}) {
  return {
    insurance: async () => ({ eligible: {}, reasonCode: 'OK', insurableRaw: null, cp07: null, lines: [{ kind: 'BHXH', base: '10000000', employee: '800000', employer: '1750000', rateId: 'r' }], trace: {} }),
    tax: async (items, insurance) => { capture.items = items; capture.insurance = insurance; return { tax: '0', branch: 'PROGRESSIVE', rulesetId: 'r', rulesetCode: 'RES-PROG-2026', taxPeriod: '2026-11', exceptions: [], trace: {} }; },
  };
}
const bonusItem = (amount, extra = {}) => ({ id: 'b1', planCode: 'KPI-Q3', label: 'Thưởng KPI', amount, componentId: null, componentCode: null, taxClassification: 'TAXABLE', trace: {}, ...extra });

test('FIX-08: KPI bonus 5.000.000 × 80% = 4.000.000 as a BONUS earning; fixed salary untouched', async () => {
  const rule = { calculationMode: 'FORMULA', formula: 'TARGET * KPI_RATE', variables: [{ name: 'TARGET', defaultValue: '5000000' }, { name: 'KPI_RATE' }] };
  assert.equal(computeBonus(rule, { KPI_RATE: '0.8' }).amount, '4000000');
  assert.throws(() => computeBonus(rule, {}), error => error.code === 'BONUS_INPUT_MISSING');
  const plain = await calculateEmployee(context(), hooks());
  const capture = {};
  const withBonus = await calculateEmployee(context({ bonuses: [bonusItem('4000000')] }), hooks(capture));
  const bonus = withBonus.lines.find(line => line.lineType === 'BONUS');
  assert.deepEqual([bonus.amount, bonus.flags.isInsurable], ['4000000', false]);
  assert.equal(withBonus.lines.find(line => line.lineType === 'MAIN').amount, plain.lines.find(line => line.lineType === 'MAIN').amount);
  assert.equal(new Decimal(withBonus.totals.gross).minus(plain.totals.gross).toString(), '4000000');
  assert.ok(capture.items.some(item => item.kind === 'SALARY' && item.amountPaid === '4000000'), 'bonus is taxed in this payment');
  assert.equal(withBonus.lines.filter(line => line.lineType === 'DEDUCTION').length, 0);
  assert.notEqual(withBonus.sourceHash, plain.sourceHash);
});

test('Attendance score only scales the attendance bonus; it never deducts pay (FR-7.2.6, BR-45)', async () => {
  const rule = { calculationMode: 'FORMULA', formula: 'TARGET * ATTENDANCE_SCORE / 100', variables: [{ name: 'TARGET', defaultValue: '500000' }, { name: 'ATTENDANCE_SCORE' }] };
  assert.equal(computeBonus(rule, { ATTENDANCE_SCORE: '40' }).amount, '200000');
  assert.throws(() => computeBonus({ ...rule, formula: 'TARGET * (ATTENDANCE_SCORE - 100) / 100' }, { ATTENDANCE_SCORE: '40' }), error => error.code === 'BONUS_NEGATIVE');
  const low = await calculateEmployee(context({ bonuses: [bonusItem('200000')] }), hooks());
  const plain = await calculateEmployee(context(), hooks());
  assert.equal(low.lines.find(line => line.lineType === 'MAIN').amount, plain.lines.find(line => line.lineType === 'MAIN').amount);
  assert.deepEqual(low.lines.filter(line => ['DEDUCTION', 'ADJUSTMENT'].includes(line.lineType)), []);
});

test('TC-I07: KPI bonus sharing the P3 evaluation without its own decision is a double count', () => {
  const employee = { planLines: [{ sourceType: 'THREE_P', sourceReference: 'KPI-Q3' }], p3InputReferences: [] };
  assert.equal(p3Conflict({ kpiSourceReference: 'KPI-Q3', independentDecisionRef: null }, employee).code, 'BONUS_P3_DOUBLE_COUNT');
  assert.equal(p3Conflict({ kpiSourceReference: 'KPI-Q3', independentDecisionRef: 'QĐ-12' }, employee), null);
  assert.equal(p3Conflict({ kpiSourceReference: 'KPI-Q4', independentDecisionRef: null }, employee), null);
  assert.equal(p3Conflict({ kpiSourceReference: 'KPI-Q3', independentDecisionRef: null }, { planLines: [{ sourceType: 'TIME' }], p3InputReferences: ['KPI-Q3'] }), null);
  assert.equal(p3Conflict({ kpiSourceReference: 'EV-9', independentDecisionRef: null }, { planLines: [{ sourceType: 'THREE_P', sourceReference: 'x' }], p3InputReferences: ['EV-9'] }).code, 'BONUS_P3_DOUBLE_COUNT');
});

test('Retro pay in the open period: gross difference taxed now with the insurance difference deductible; diff per line', async () => {
  const capture = {};
  const result = await calculateEmployee(context({ adjustments: [{ id: 'a1', kind: 'RETRO_PAY', label: 'Truy lĩnh lương kỳ PL-08', amount: '1000', originPeriodCode: 'PL-08', explanation: 'x', taxable: { income: '300000', insuranceEmployee: '273000' } }] }), hooks(capture));
  const line = result.lines.find(item => item.lineType === 'ADJUSTMENT');
  assert.deepEqual([line.amount, line.sourceReference], ['1000', 'Kỳ gốc PL-08']);
  assert.ok(capture.items.some(item => item.sourceRef === 'ADJUSTMENT:a1' && item.amountPaid === '300000'));
  assert.equal(capture.insurance, '1073000');
  const diff = retroDiff({ totals: { gross: '100', insuranceEmployee: '10', unionFee: '1', insuranceEmployer: '20', tax: '0', deductions: '0', adjustments: '0', net: '89' }, lines: [{ lineType: 'MAIN', label: 'L', componentCode: 'L', amount: '100' }, { lineType: 'NET', label: 'N', componentCode: null, amount: '89' }] },
    { totals: { gross: '120', insuranceEmployee: '12', unionFee: '1', insuranceEmployer: '24', tax: '1', deductions: '0', adjustments: '0', net: '106' }, lines: [{ lineType: 'MAIN', label: 'L', componentCode: 'L', amount: '120' }, { lineType: 'NET', label: 'N', componentCode: null, amount: '106' }] });
  assert.deepEqual([diff.diff.gross, diff.diff.tax, diff.lines.map(item => [item.key, item.diff])], ['20', '1', [['MAIN|L', '20']]]);
});

test('Bonuses and retro adjustments on isolated PostgreSQL and real HTTP', { timeout: 600000 }, async t => {
  const name = 'hrtp_payroll_retro_' + randomUUID().replaceAll('-', '');
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
    async function request(path, cookie, body, method) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, body: type.includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body, method) {
      const result = await request(path, cookie, body, method);
      assert.ok(result.status >= 200 && result.status < 300, path + ' ' + JSON.stringify(result.body) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    const password = username => credentials.find(account => account.username === username).password;
    async function login(username) {
      const result = await request('/auth/login', null, { username, password: password(username) });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(login));
    const reauth = async () => (await ok('/auth/reauthenticate', kt, { password: password('kt.all') })).token;
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const company = unit('COMPANY'), siteUnit = unit('NM-BN'), workshop = unit('NM-BN-D1'), team = unit('NM-BN-D1-T1');
    const otherTeam = context.units.find(row => row.type === 'TEAM' && !row.code.startsWith('NM-BN'));
    assert.ok(otherTeam, 'a team at another site exists');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const [ttActor, ktActor] = await Promise.all(['tt.bn', 'kt.all'].map(username => db.userAccount.findUniqueOrThrow({ where: { username } })));
    const timeComponent = await db.salaryComponent.create({ data: { orgUnitId: company.id, code: 'RT_LUONG_TG_' + tag, versions: { create: { name: 'Lương thời gian', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, displayOrder: 1, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
    const p3Component = await db.salaryComponent.create({ data: { orgUnitId: company.id, code: 'RT_P3_' + tag, versions: { create: { name: 'Lương P3', componentType: 'EARNING', active: true, isInsurable: false, taxClassification: 'TAXABLE', isOtBase: false, isProrated: false, displayOrder: 2, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
    const people = {};
    async function person(code, salary, orgUnitId, lines) {
      const employee = await db.employee.create({ data: { code: 'RT-' + tag + '-' + code, fullName: 'Hồi tố ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: date('2026-01-01'), signedDate: date('2025-12-20'), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true } });
      await db.taxProfile.create({ data: { employeeId: employee.id, residency: 'RESIDENT', reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2026-01-01') } });
      await db.employeePayPlan.create({ data: { employeeId: employee.id, versions: { create: { name: 'Phương án', payMode: 'MONTHLY', status: 'SIMULATION', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id, lines } } } });
      return employee;
    }
    const timeLine = { componentId: timeComponent.id, role: 'BASE', sourceType: 'TIME', formulaCode: 'LUONG_TG', sourceReference: 'Hợp đồng', allocation: 'INDIVIDUAL' };
    people.A = await person('A', '13000000', team.id, [timeLine]);
    people.B = await person('B', '7800000', team.id, [timeLine]);
    const outsider = await person('D', '9000000', otherTeam.id, [timeLine, { componentId: p3Component.id, role: 'ADDITIONAL', sourceType: 'THREE_P', formulaCode: 'P3', sourceReference: 'KPI-Q3-' + tag, allocation: 'INDIVIDUAL' }]);
    const shift = await db.shiftDefinition.create({ data: { orgUnitId: company.id, code: 'RT-D-' + tag, name: 'Ca ngày hồi tố', kind: 'DAY', startTime: '08:00', endTime: '16:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 0, paidBreak: true, workMinutes: 480, isNightShift: false } });
    const plan = await db.shiftPlan.create({ data: { teamOrgUnitId: team.id, title: 'Lịch hồi tố', status: 'APPROVED', createdById: ttActor.id } });
    const policy = await db.sitePolicy.findFirstOrThrow({ where: { orgUnitId: siteUnit.id, policyKey: 'CUTOFF_DAY' } });

    async function attendancePeriod(code, workDays) {
      const lines = [];
      for (const person of [people.A, people.B]) for (const day of workDays) {
        await db.shiftSchedule.create({ data: { planId: plan.id, employeeId: person.id, workDate: date(day), shiftId: shift.id, startAt: new Date(day + 'T08:00:00+07:00'), endAt: new Date(day + 'T16:00:00+07:00'), workMinutes: 480 } });
        lines.push([person.code, day, '08:00:00', 'RT-DEV-' + tag, 'IN'].join(','), [person.code, day, '16:00:00', 'RT-DEV-' + tag, 'OUT'].join(','));
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
    async function approveAndLock(view) {
      const compliance = await ok('/payroll/sheets/' + view.sheet.id + '/compliance', kt);
      for (const detail of compliance.items.find(item => item.code === 'CP-08').details) await ok('/payroll/sheets/' + view.sheet.id + '/compliance/acknowledge', kt, { code: 'CP-08', employeeId: detail.employeeId, reason: 'Kỳ dài hơn' });
      const approved = await ok('/payroll/sheets/' + view.sheet.id + '/approve', kt, { revision: (await ok('/payroll/sheets/' + view.sheet.id + '/history', kt)).revision });
      return ok('/payroll/sheets/' + view.sheet.id + '/lock', kt, { revision: approved.revision, reauthToken: await reauth() });
    }
    const lines = async (sheetId, person) => (await ok('/payroll/sheets/' + sheetId + '/employees/' + person.id, kt)).lines;

    await attendancePeriod('RT-ATT8', ['2026-10-05', '2026-10-06', '2026-10-07']);
    const p08 = await db.payrollPeriod.create({ data: { code: 'RT-P08-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-05'), dateTo: date('2026-10-07'), expectedPaymentDate: date('2026-10-10'), isInitial: true } });
    const sheet08 = await calculate(p08); await approveAndLock(sheet08);
    await attendancePeriod('RT-ATT9', ['2026-10-08', '2026-10-09', '2026-10-12']);
    const p09 = await db.payrollPeriod.create({ data: { code: 'RT-P09-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-08'), dateTo: date('2026-10-12'), expectedPaymentDate: date('2026-10-14') } });
    const sheet09 = await calculate(p09); await approveAndLock(sheet09);
    const p10 = await db.payrollPeriod.create({ data: { code: 'RT-P10-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-13'), dateTo: date('2026-10-23'), expectedPaymentDate: date('2026-10-26') } });
    const p11 = await db.payrollPeriod.create({ data: { code: 'RT-P11-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-10-26'), dateTo: date('2026-10-28'), expectedPaymentDate: date('2026-10-31') } });
    const frozen = async () => Promise.all([sheet08, sheet09].map(async view => ({ hash: (await db.payrollSnapshot.findUniqueOrThrow({ where: { sheetId: view.sheet.id } })).contentHash, lines: await db.payrollLine.count({ where: { payrollEmployee: { sheetId: view.sheet.id } } }) })));
    const before = await frozen();

    let calculation;
    await t.test('TC-P09: a past raise touching two locked periods shows salary, insurance and tax differences per period; locked data unchanged', async () => {
      const created = await ok('/employees/' + people.A.id + '/salary-decisions', kt, { decisionNumber: 'QĐ-TANG-' + tag, decisionDate: '2026-10-20', effectiveFrom: '2026-10-05', reason: 'Tăng lương hồi tố', legalBasis: 'Quy chế', lines: [{ amount: '15600000', salaryBasis: 'MONTHLY' }] });
      assert.deepEqual(created.retroCandidates.map(row => row.code), [p08.code, p09.code]);
      const pending = (await ok('/payroll/retro-candidates?status=PENDING', kt)).items.filter(row => row.employee.id === people.A.id);
      assert.equal(pending.length, 2);
      assert.equal((await request('/payroll/retro-candidates/' + pending[0].id + '/calculate', tt, {})).status, 403);
      calculation = (await ok('/payroll/retro-candidates/' + pending[0].id + '/calculate', kt, {})).calculation;
      assert.deepEqual([calculation.status, calculation.target.code, calculation.periods.map(row => row.code)], ['CALCULATED', p10.code, [p08.code, p09.code]]);
      for (const row of calculation.periods) {
        assert.equal(row.diff.gross, '300000', '2.600.000 × 3 công ÷ 26');
        assert.ok(new Decimal(row.diff.insuranceEmployee).gt(0));
        assert.equal(row.adjustment.amount, new Decimal(row.diff.gross).minus(row.diff.insuranceEmployee).minus(row.diff.unionFee).toString());
        assert.ok(row.lines.some(line => line.lineType === 'MAIN' && line.diff === '300000'));
        assert.ok(row.taxPeriod);
      }
      assert.deepEqual(await frozen(), before);
      assert.equal(await db.payrollAdjustment.count({ where: { status: 'CONFIRMED' } }), 0);
    });

    await t.test('Not confirming discards the result: no adjustment, candidates still pending', async () => {
      await ok('/payroll/retro-calculations/' + calculation.id + '/discard', kt, {});
      assert.equal(await db.payrollAdjustment.count(), 0);
      assert.deepEqual([...new Set((await db.retroCandidate.findMany({ where: { employeeId: people.A.id } })).map(row => row.status))], ['PENDING']);
      assert.equal((await request('/payroll/retro-calculations/' + calculation.id + '/confirm', kt, { reauthToken: await reauth(), resultHash: calculation.resultHash })).body.code, 'RETRO_CALCULATION_DECIDED');
    });

    await t.test('UAT-11: confirmation with re-authentication books retro pay into the open period with its origin periods', async () => {
      const candidate = (await ok('/payroll/retro-candidates?status=PENDING', kt)).items.find(row => row.employee.id === people.A.id);
      calculation = (await ok('/payroll/retro-candidates/' + candidate.id + '/calculate', kt, {})).calculation;
      assert.equal((await request('/payroll/retro-calculations/' + calculation.id + '/confirm', kt, { reauthToken: 'x', resultHash: calculation.resultHash })).body.code, 'REAUTH_REQUIRED');
      assert.equal((await request('/payroll/retro-calculations/' + calculation.id + '/confirm', kt, { reauthToken: await reauth(), resultHash: 'a'.repeat(64) })).body.code, 'STALE_REVISION');
      const confirmed = (await ok('/payroll/retro-calculations/' + calculation.id + '/confirm', kt, { reauthToken: await reauth(), resultHash: calculation.resultHash })).calculation;
      assert.equal(confirmed.status, 'CONFIRMED');
      const adjustments = await db.payrollAdjustment.findMany({ where: { retroCalculationId: calculation.id }, include: { originPayrollPeriod: true } });
      assert.deepEqual(adjustments.map(row => [row.kind, row.status, row.targetPayrollPeriodId, row.originPayrollPeriod.code]).sort(), [['RETRO_PAY', 'CONFIRMED', p10.id, p08.code], ['RETRO_PAY', 'CONFIRMED', p10.id, p09.code]]);
      assert.deepEqual([...new Set((await db.retroCandidate.findMany({ where: { employeeId: people.A.id } })).map(row => row.status))], ['RESOLVED']);
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'retro_calculation', action: 'CONFIRM' } }));
      assert.deepEqual(await frozen(), before);
    });

    let kpi, attendance, later;
    await t.test('Bonus plans: formula allocation, duplicate refused, P3 double count blocks confirmation', async () => {
      const create = (code, extra) => ok('/payroll/bonuses', kt, { code: code + '-' + tag, bonusType: 'KPI', name: 'Thưởng ' + code, decisionReference: 'QĐ-' + code, earnFrom: '2026-07-01', earnTo: '2026-09-30', payPayrollPeriodId: p10.id, reason: 'Kiểm thử', ...extra });
      kpi = (await create('KPI', { independentDecisionRef: 'QĐ-THUONG-KPI', kpiSourceReference: 'KPI-Q3-' + tag, calculationMode: 'FORMULA', formula: 'TARGET * KPI_RATE', variables: [{ name: 'TARGET', defaultValue: '5000000' }, { name: 'KPI_RATE' }] })).plan;
      const allocated = await ok('/payroll/bonuses/' + kpi.id + '/allocations', kt, { items: [{ employeeId: people.A.id, inputs: { KPI_RATE: '0.8' } }] });
      assert.equal(allocated.allocations[0].amount, '4000000');
      const duplicate = await request('/payroll/bonuses/' + kpi.id + '/allocations', kt, { items: [{ employeeId: people.A.id, inputs: { KPI_RATE: '1' } }] });
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'BONUS_DUPLICATE_EMPLOYEE');
      kpi = (await ok('/payroll/bonuses/' + kpi.id + '/confirm', kt, { revision: allocated.plan.revision })).plan;
      assert.equal(kpi.status, 'CONFIRMED');
      attendance = (await create('CC', { bonusType: 'MONTHLY', calculationMode: 'FORMULA', formula: 'TARGET * ATTENDANCE_SCORE / 100', variables: [{ name: 'TARGET', defaultValue: '500000' }, { name: 'ATTENDANCE_SCORE' }] })).plan;
      const byUnit = await ok('/payroll/bonuses/' + attendance.id + '/allocations', kt, { orgUnitId: team.id, inputs: { ATTENDANCE_SCORE: '40' } });
      assert.deepEqual(byUnit.allocations.filter(row => [people.A.id, people.B.id].includes(row.employee.id)).map(row => [row.employee.code, row.amount]).sort(), [[people.A.code, '200000'], [people.B.code, '200000']]);
      for (const extra of byUnit.allocations.filter(row => ![people.A.id, people.B.id].includes(row.employee.id))) await ok('/payroll/bonuses/' + attendance.id + '/allocations/' + extra.id, kt, undefined, 'DELETE');
      const removed = await ok('/payroll/bonuses/' + attendance.id + '/allocations/' + byUnit.allocations.find(row => row.employee.id === people.A.id).id, kt, undefined, 'DELETE');
      await ok('/payroll/bonuses/' + attendance.id + '/confirm', kt, { revision: removed.plan.revision });
      later = (await ok('/payroll/bonuses', kt, { code: 'LATER-' + tag, bonusType: 'HOLIDAY', name: 'Thưởng kỳ sau', decisionReference: 'QĐ-LE', earnFrom: '2026-10-01', earnTo: '2026-10-31', payPayrollPeriodId: p11.id, calculationMode: 'AMOUNT', amount: '1000000', reason: 'Chi kỳ sau' })).plan;
      const laterAllocated = await ok('/payroll/bonuses/' + later.id + '/allocations', kt, { items: [{ employeeId: people.A.id }] });
      await ok('/payroll/bonuses/' + later.id + '/confirm', kt, { revision: laterAllocated.plan.revision });
      const shared = (await create('P3', { kpiSourceReference: 'KPI-Q3-' + tag, calculationMode: 'AMOUNT', amount: '1500000' })).plan;
      const conflicted = await ok('/payroll/bonuses/' + shared.id + '/allocations', kt, { items: [{ employeeId: outsider.id }] });
      assert.equal(conflicted.allocations[0].conflictCode, 'BONUS_P3_DOUBLE_COUNT');
      const blocked = await request('/payroll/bonuses/' + shared.id + '/confirm', kt, { revision: conflicted.plan.revision });
      assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'BONUS_P3_DOUBLE_COUNT');
      await assert.rejects(db.bonusAllocation.deleteMany({ where: { planId: kpi.id } }), /immutable/);
    });

    await t.test('Open period: BONUS lines before gross, separate retro lines naming origin periods, retro income taxed by this payment', async () => {
      await attendancePeriod('RT-ATT10', ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
      const sheet10 = await calculate(p10);
      const a = await lines(sheet10.sheet.id, people.A), b = await lines(sheet10.sheet.id, people.B);
      assert.deepEqual(a.filter(line => line.lineType === 'BONUS').map(line => [line.label, line.amount]), [['Thưởng KPI', '4000000']]);
      assert.deepEqual(b.filter(line => line.lineType === 'BONUS').map(line => line.amount), ['200000']);
      assert.equal(a.find(line => line.lineType === 'MAIN').amount, new Decimal('15600000').times(9).div(26).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString());
      assert.deepEqual([...a, ...b].filter(line => line.lineType === 'DEDUCTION'), []);
      const retro = a.filter(line => line.lineType === 'ADJUSTMENT');
      assert.deepEqual(retro.map(line => line.label).sort(), ['Truy lĩnh lương kỳ ' + p08.code, 'Truy lĩnh lương kỳ ' + p09.code]);
      const tax = await ok('/payroll/lines/' + a.find(line => line.lineType === 'TAX').id + '/trace', kt);
      assert.equal(tax.trace.items.filter(item => item.sourceRef.startsWith('ADJUSTMENT:')).map(item => item.amountPaid).join(), '300000,300000');
      assert.equal(tax.line.paramCode, 'RES-PROG-2026');
      const row = sheet10.items.find(item => item.employee.id === people.A.id);
      assert.equal(row.totals.adjustments, calculation.total.adjustment);
      await approveAndLock(sheet10);
      assert.deepEqual([...new Set((await db.payrollAdjustment.findMany({ where: { retroCalculationId: calculation.id } })).map(item => item.appliedPayrollPeriodId))], [p10.id]);
      assert.deepEqual(await frozen(), before);
    });

    await t.test('RETRO_SOURCE_UNAVAILABLE: a locked period without a snapshot is never estimated', async () => {
      const legacy = await db.payrollPeriod.create({ data: { code: 'RT-LEGACY-' + tag, siteOrgUnitId: siteUnit.id, dateFrom: date('2026-09-01'), dateTo: date('2026-09-30') } });
      await db.payrollPeriod.update({ where: { id: legacy.id }, data: { status: 'LOCKED' } });
      const created = await ok('/employees/' + people.B.id + '/salary-decisions', kt, { decisionNumber: 'QĐ-B-' + tag, decisionDate: '2026-10-25', effectiveFrom: '2026-09-15', reason: 'Tăng lương', legalBasis: 'Quy chế', lines: [{ amount: '8500000', salaryBasis: 'MONTHLY' }] });
      assert.ok(created.retroCandidates.some(row => row.code === 'RT-LEGACY-' + tag));
      const candidate = (await ok('/payroll/retro-candidates?status=PENDING', kt)).items.find(row => row.employee.id === people.B.id);
      const refused = await request('/payroll/retro-candidates/' + candidate.id + '/calculate', kt, {});
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'RETRO_SOURCE_UNAVAILABLE');
      assert.equal(await db.retroCalculation.count({ where: { employeeId: people.B.id } }), 0);
      assert.deepEqual(await frozen(), before);
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
