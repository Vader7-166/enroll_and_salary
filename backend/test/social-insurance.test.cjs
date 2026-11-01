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

test('Social insurance on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_insurance_' + randomUUID().replaceAll('-', '');
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
    const [tt, kt, ad] = await Promise.all(['tt.bn', 'kt.all', 'ad.demo'].map(login));
    const context = await ok('/organization/context', ad);
    const unit = code => context.units.find(row => row.code === code);
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    async function person(code, contract = {}) {
      const employee = await db.employee.create({ data: { code: 'BH-' + tag + '-' + code, fullName: 'Bảo hiểm ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: unit('NM-BN-D1-T1').id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      const { salary = '10000000', ...rest } = contract;
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: date('2026-01-01'), signedDate: date('2025-12-20'), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true, ...rest } });
      return employee;
    }
    const preview = (employee, month = '2026-10') => ok('/social-insurance/preview', kt, { employeeId: employee.id, month });
    const shares = result => Object.fromEntries(result.contribution.lines.map(line => [line.kind, [Number(line.employee), Number(line.employer)]]));

    await t.test('Only KT reads or manages rates', async () => {
      assert.equal((await request('/social-insurance/rates', tt)).status, 403);
      assert.equal((await request('/social-insurance/rates', ad)).status, 403);
      const rates = await ok('/social-insurance/rates?asOf=2026-10-01', kt);
      assert.deepEqual(rates.items.map(r => [r.insuranceType, r.employeeRate, r.employerRate]), [['BHXH', '0.08', '0.175'], ['BHYT', '0.015', '0.03'], ['BHTN', '0.01', '0.01'], ['KPCD', '0', '0.02']]);
    });

    await t.test('A new version closes the open one; missing basis and overlaps are refused', async () => {
      const body = { insuranceType: 'BHXH', employeeRate: '0.08', employerRate: '0.175', floorRegionalMinimum: true, capReference: 'BASE_SALARY', capMultiplier: '20', status: 'SIMULATION', effectiveFrom: '2027-01-01' };
      const missing = await request('/social-insurance/rates', kt, body);
      assert.equal(missing.status, 400); assert.equal(missing.body.code, 'INSURANCE_LEGAL_BASIS_REQUIRED');
      const added = await ok('/social-insurance/rates', kt, { ...body, legalBasis: 'Văn bản mô phỏng 2027' });
      const rows = await db.insuranceRate.findMany({ where: { insuranceType: 'BHXH' }, orderBy: { effectiveFrom: 'asc' } });
      assert.deepEqual(rows.map(r => [r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null]), [['2026-01-01', '2026-12-31'], ['2027-01-01', null]]);
      assert.equal(added.closedId, rows[0].id);
      const overlap = await request('/social-insurance/rates', kt, { ...body, legalBasis: 'Chồng', effectiveFrom: '2026-06-01' });
      assert.equal(overlap.status, 409); assert.equal(overlap.body.code, 'EFFECTIVE_OVERLAP'); assert.equal(overlap.body.details.overlappingId, rows[0].id);
      await assert.rejects(db.insuranceRate.update({ where: { id: rows[0].id }, data: { employeeRate: '0.1' } }), /immutable/);
    });

    await t.test('Standard employee: 800k / 150k / 100k, KPCĐ and union fee with parameter trace', async () => {
      const result = await preview(await person('STD'));
      assert.equal(result.eligibility.reasonCode, 'ELIGIBLE');
      assert.deepEqual(shares(result), { BHXH: [800000, 1750000], BHYT: [150000, 300000], BHTN: [100000, 100000], KPCD: [0, 200000], UNION_FEE: [100000, 0] });
      assert.equal(result.cp07, null);
      assert.equal(result.salary.floor, '5310000');
      assert.equal(result.salary.perKind.BHXH.cap, '46800000');
      assert.equal(result.parameters.regionalMinimum.value, '5310000');
    });

    await t.test('Floor with trained addon and non-insurable decision components', async () => {
      const low = await person('LOW', { salary: '4000000' });
      await db.employeeSpecialStatus.create({ data: { employeeId: low.id, statusType: 'VOCATIONAL_TRAINED', reference: 'Chứng chỉ nghề', reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2026-01-01') } });
      const component = await db.salaryComponent.create({ data: { orgUnitId: unit('COMPANY').id, code: 'BH_AN_CA_' + tag, versions: { create: { name: 'Hỗ trợ ăn ca', componentType: 'EARNING', active: true, isInsurable: false, taxClassification: 'CONDITIONAL', isOtBase: false, isProrated: false, displayOrder: 10, status: 'SIMULATION', classificationBasis: 'Kiểm thử', decisionReference: 'KT', reason: 'Kiểm thử', effectiveFrom: date('2026-01-01'), createdById: ktActor.id } } } });
      await ok('/employees/' + low.id + '/salary-decisions', kt, { decisionNumber: 'QĐ-AN-CA', decisionDate: '2026-09-25', effectiveFrom: '2026-10-01', reason: 'Hỗ trợ ăn ca', legalBasis: 'Quy chế', lines: [{ componentId: component.id, amount: '700000', salaryBasis: 'MONTHLY' }] });
      const result = await preview(low);
      assert.equal(result.salary.raw, '4000000');
      assert.deepEqual(result.salary.excluded, [{ code: 'BH_AN_CA_' + tag, amount: '700000.00' }]);
      assert.equal(result.salary.perKind.BHXH.value, '5681700');
      assert.equal(result.salary.perKind.BHXH.floorApplied, true);
    });

    await t.test('Participation reasons: short contract, unpaid leave ≥ 14 days, retiree', async () => {
      const short = await person('SHORT', { type: 'UNDER_ONE_MONTH', insuranceEligible: false, startDate: date('2026-10-01'), endDate: date('2026-10-20') });
      assert.equal((await preview(short)).eligibility.reasonCode, 'CONTRACT_UNDER_1_MONTH');
      const unpaid = await person('UNPAID');
      const leaveType = await db.leaveType.findFirstOrThrow({ where: { code: 'UNPAID' } });
      const lines = Array.from({ length: 14 }, (_, index) => ({ workDate: '2026-10-' + String(index + 1).padStart(2, '0'), isPaid: false, holiday: false, days: '1.00' }));
      await db.leaveRequest.create({ data: { employeeId: unpaid.id, leaveTypeId: leaveType.id, createdById: ktActor.id, status: 'APPROVED', dateFrom: date('2026-10-01'), dateTo: date('2026-10-14'), unit: 'DAY', reason: 'Nghỉ không lương', snapshot: { lines } } });
      const result = await preview(unpaid);
      assert.equal(result.eligibility.reasonCode, 'UNPAID_LEAVE_14_DAYS');
      assert.equal(result.unpaidLeaveDays, '14');
      assert.deepEqual(result.contribution.lines, []);
      const retiree = await person('RETIREE');
      await db.employeeSpecialStatus.create({ data: { employeeId: retiree.id, statusType: 'PENSIONER', reference: 'QĐ hưu', reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2026-09-01') } });
      assert.equal((await preview(retiree)).eligibility.reasonCode, 'RETIREE');
    });

    await t.test('CP-07 blocks a participant without a monthly insurable salary', async () => {
      const hourly = await person('HOURLY', { salary: '30000', salaryBasis: 'HOURLY' });
      const result = await preview(hourly);
      assert.equal(result.cp07.code, 'CP-07');
      assert.equal(result.contribution, null);
      assert.ok(result.missing.includes('HOURLY_AGREED_SALARY'));
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
