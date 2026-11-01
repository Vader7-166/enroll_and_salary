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

test('Salary decisions on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_salary_dec_' + randomUUID().replaceAll('-', '');
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
    const [tt, kt, ktbn, ad] = await Promise.all(['tt.bn', 'kt.all', 'kt.bn', 'ad.demo'].map(login));
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    await db.orgUnitVersion.updateMany({ where: { orgUnitId: unit('NM-BN-D1').id }, data: { costCenterCode: 'CC-BN-D1' } });
    await db.orgUnitVersion.updateMany({ where: { orgUnitId: unit('NM-NA-D1').id }, data: { costCenterCode: 'CC-NA-D1' } });
    async function person(code, unitCode, salary) {
      const employee = await db.employee.create({ data: { code: 'SD-' + tag + '-' + code, fullName: 'Quyết định lương ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: unit(unitCode).id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: date('2026-01-01'), signedDate: date('2025-12-20'), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true } });
      return employee;
    }
    const decision = (overrides = {}) => ({ decisionNumber: 'QĐ-' + randomUUID().slice(0, 6), decisionDate: '2026-10-05', effectiveFrom: '2026-10-15', reason: 'Điều chỉnh lương', legalBasis: 'Quy chế lương mô phỏng', lines: [{ amount: '9000000', salaryBasis: 'MONTHLY' }], ...overrides });
    const P = await person('P02', 'NM-BN-D1-T1', '8000000');
    const timeline = async (id, from = '2026-09-26', to = '2026-10-25') => ok('/employees/' + id + '/salary-timeline?from=' + from + '&to=' + to, kt);

    await t.test('Without decisions the contract is the single CONTRACT segment', async () => {
      const result = await timeline(P.id);
      assert.deepEqual(result.segments.map(s => [s.source, s.from, s.to, s.amount]), [['CONTRACT', '2026-09-26', '2026-10-25', '8000000']]);
      assert.equal((await request('/employees/' + P.id + '/salary-timeline?from=2026-09-26&to=2026-10-25', tt)).status, 403);
    });

    let first;
    await t.test('TC-P02: a mid-period raise splits the period into two rate segments; same-day duplicate is refused', async () => {
      first = await ok('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P02-1' }));
      assert.deepEqual(first.retroCandidates, []);
      const result = await timeline(P.id);
      assert.deepEqual(result.segments.map(s => [s.source, s.from, s.to, s.amount, s.reference]), [['CONTRACT', '2026-09-26', '2026-10-14', '8000000', 'HD-P02'], ['DECISION', '2026-10-15', '2026-10-25', '9000000.00', 'QĐ-P02-1']]);
      const duplicate = await request('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P02-2', lines: [{ amount: '9500000', salaryBasis: 'MONTHLY' }] }));
      assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'SALARY_DECISION_DUPLICATE_DATE'); assert.equal(duplicate.body.details.decisionNumber, 'QĐ-P02-1');
      const earlier = await request('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P02-3', effectiveFrom: '2026-10-01' }));
      assert.equal(earlier.body.code, 'SALARY_DECISION_OUT_OF_ORDER');
      const below = await request('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P02-4', effectiveFrom: '2026-11-01', lines: [{ amount: '4000000', salaryBasis: 'MONTHLY' }] }));
      assert.equal(below.body.code, 'BELOW_REGIONAL_MINIMUM');
      const next = await ok('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P02-5', effectiveFrom: '2026-11-01', lines: [{ amount: '9500000', salaryBasis: 'MONTHLY' }] }));
      const rows = await db.employeeSalary.findMany({ where: { employeeId: P.id }, orderBy: { effectiveFrom: 'asc' } });
      assert.deepEqual(rows.map(r => [r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null]), [['2026-10-15', '2026-10-31'], ['2026-11-01', null]]);
      assert.ok(rows.every(r => r.amountCipher.startsWith('v1.') && !r.amountCipher.includes('9000000')));
      assert.ok(next.decision.id);
      await assert.rejects(db.salaryDecision.update({ where: { id: first.decision.id }, data: { reason: 'Sửa' } }), /immutable/);
      await assert.rejects(db.employeeSalary.update({ where: { id: rows[0].id }, data: { effectiveTo: date('2026-10-20') } }), /immutable/);
      const listed = await ok('/employees/' + P.id + '/salary-decisions', kt);
      assert.deepEqual(listed.items.map(item => item.decisionNumber), ['QĐ-P02-5', 'QĐ-P02-1']);
    });

    await t.test('Component lines are independent of the agreed salary', async () => {
      const component = await db.salaryComponent.create({ data: { orgUnitId: unit('COMPANY').id, code: 'SD_PC_' + tag, versions: { create: { name: 'Phụ cấp trách nhiệm', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'TAXABLE', isOtBase: false, isProrated: true, displayOrder: 10, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
      await ok('/employees/' + P.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-PC', effectiveFrom: '2026-10-01', lines: [{ componentId: component.id, amount: '500000', salaryBasis: 'MONTHLY' }] }));
      const result = await timeline(P.id);
      assert.deepEqual(result.segments.filter(s => s.componentId).map(s => [s.componentCode, s.from, s.to, s.amount]), [['SD_PC_' + tag, '2026-10-01', '2026-10-25', '500000.00']]);
      assert.equal(result.segments.filter(s => !s.componentId).length, 2);
    });

    await t.test('TC-P07: mid-period transfer yields two unit segments with region and cost center', async () => {
      const T = await person('P07', 'NM-BN-D1-T1', '8000000');
      await ok('/employees/' + T.id + '/transfers', kt, { toOrgUnitId: unit('NM-NA-D1-T1').id, effectiveFrom: '2026-10-10', decisionNumber: 'ĐC-P07', decisionDate: '2026-10-01', reason: 'Điều chuyển' });
      const result = await timeline(T.id);
      assert.deepEqual(result.units.map(u => [u.orgUnitCode, u.wageRegionCode, u.costCenterCode, u.from, u.to, u.days]), [
        ['NM-BN-D1-T1', 'I', 'CC-BN-D1', '2026-09-26', '2026-10-09', 14],
        ['NM-NA-D1-T1', 'III', 'CC-NA-D1', '2026-10-10', '2026-10-25', 16],
      ]);
    });

    await t.test('UAT-11: a decision back-dated into two locked payroll periods creates retro candidates without touching them', async () => {
      const F = await person('U11', 'NM-BN-D1-T1', '8000000');
      const site = unit('NM-BN');
      const periods = {};
      for (const [code, from, to, status] of [['08', '2026-07-26', '2026-08-25', 'LOCKED'], ['09', '2026-08-26', '2026-09-25', 'LOCKED'], ['10', '2026-09-26', '2026-10-25', 'OPEN']]) {
        periods[code] = await db.payrollPeriod.create({ data: { code: 'PL-' + tag + '-' + code, siteOrgUnitId: site.id, dateFrom: date(from), dateTo: date(to) } });
        if (status === 'LOCKED') periods[code] = await db.payrollPeriod.update({ where: { id: periods[code].id }, data: { status } });
      }
      const created = await ok('/employees/' + F.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-U11', effectiveFrom: '2026-08-01', lines: [{ amount: '8800000', salaryBasis: 'MONTHLY' }] }));
      assert.deepEqual(created.retroCandidates.map(r => r.code).sort(), ['PL-' + tag + '-08', 'PL-' + tag + '-09']);
      const listed = await ok('/salary-decisions/retro-candidates?status=PENDING', kt);
      const mine = listed.items.filter(item => item.employee.id === F.id);
      assert.deepEqual(mine.map(item => item.payrollPeriod.code).sort(), ['PL-' + tag + '-08', 'PL-' + tag + '-09']);
      assert.deepEqual((await db.payrollPeriod.findMany({ where: { id: { in: [periods['08'].id, periods['09'].id] } } })).map(p => p.status), ['LOCKED', 'LOCKED']);
      const dismissed = await ok('/salary-decisions/retro-candidates/' + mine[0].id + '/dismiss', kt, { note: 'Đã đối chiếu, không ảnh hưởng' });
      assert.equal(dismissed.status, 'DISMISSED');
      assert.equal((await request('/salary-decisions/retro-candidates/' + mine[0].id + '/dismiss', kt, { note: 'Lần hai' })).status, 409);
    });

    await t.test('TC-P08: cross-region transfer with a lower agreed salary needs a reasoned confirmation either way round', async () => {
      const G = await person('P08A', 'NM-BN-D1-T1', '9000000');
      await ok('/employees/' + G.id + '/salary-decisions', kt, decision({ decisionNumber: 'QĐ-P08A', effectiveFrom: '2026-11-01', lines: [{ amount: '7000000', salaryBasis: 'MONTHLY' }] }));
      const transfer = { toOrgUnitId: unit('NM-NA-D1-T1').id, effectiveFrom: '2026-11-01', decisionNumber: 'ĐC-P08A', decisionDate: '2026-10-20', reason: 'Điều chuyển Nghệ An' };
      const refused = await request('/employees/' + G.id + '/transfers', kt, transfer);
      assert.equal(refused.status, 409); assert.equal(refused.body.code, 'CROSS_REGION_SALARY_DECREASE');
      assert.deepEqual([refused.body.details.warnings[0].fromRegion, refused.body.details.warnings[0].toRegion], ['I', 'III']);
      await ok('/employees/' + G.id + '/transfers', kt, { ...transfer, salaryWarningReason: 'Người lao động đồng ý theo biên bản thỏa thuận' });
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'personnel_transfer' }, orderBy: { id: 'desc' } });
      assert.equal(audit.newValue.salaryWarningReason, 'Người lao động đồng ý theo biên bản thỏa thuận');

      const H = await person('P08B', 'NM-BN-D1-T1', '9000000');
      await ok('/employees/' + H.id + '/transfers', kt, { ...transfer, decisionNumber: 'ĐC-P08B' });
      const lower = decision({ decisionNumber: 'QĐ-P08B', effectiveFrom: '2026-11-01', lines: [{ amount: '7000000', salaryBasis: 'MONTHLY' }] });
      const warned = await request('/employees/' + H.id + '/salary-decisions', kt, lower);
      assert.equal(warned.status, 409); assert.equal(warned.body.code, 'CROSS_REGION_SALARY_DECREASE');
      const saved = await ok('/employees/' + H.id + '/salary-decisions', kt, { ...lower, warningAcknowledgement: 'Thỏa thuận giảm lương theo vùng mới' });
      assert.equal(saved.warnings[0].code, 'CROSS_REGION_SALARY_DECREASE');
      const row = await db.salaryDecision.findUniqueOrThrow({ where: { id: saved.decision.id } });
      assert.equal(row.warningAcknowledgement, 'Thỏa thuận giảm lương theo vùng mới');
    });

    await t.test('Scope: KT of another site cannot decide salaries', async () => {
      const remote = await person('NA', 'NM-NA-D1-T1', '6000000');
      assert.equal((await request('/employees/' + remote.id + '/salary-decisions', ktbn, decision({ decisionNumber: 'QĐ-NA' }))).status, 403);
      assert.equal((await request('/employees/' + remote.id + '/salary-decisions', ad, decision({ decisionNumber: 'QĐ-NA' }))).status, 403);
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
