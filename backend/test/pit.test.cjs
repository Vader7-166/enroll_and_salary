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

test('Personal income tax on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_pit_' + randomUUID().replaceAll('-', '');
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
    async function person(code, { residency = 'RESIDENT', contractType = 'INDEFINITE', endDate = null, dependents = 0 } = {}) {
      const employee = await db.employee.create({ data: { code: 'TX-' + tag + '-' + code, fullName: 'Thuế ' + code, gender: 'OTHER', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: unit('NM-BN-D1-T1').id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: contractType, status: 'ACTIVE', startDate: date('2025-12-01'), endDate: endDate ? date(endDate) : null, signedDate: date('2025-11-20'), salaryCipher: cipherText(key, '20000000'), salaryBasis: 'MONTHLY', insuranceEligible: contractType === 'INDEFINITE' } });
      if (residency) await db.taxProfile.create({ data: { employeeId: employee.id, residency, reason: 'Kiểm thử', dataStatus: 'SIMULATION', effectiveFrom: date('2025-01-01') } });
      for (let index = 0; index < dependents; index += 1) await db.employeeDependent.create({ data: { employeeId: employee.id, dependentKey: randomUUID(), version: 1, fullName: 'NPT ' + index, relationship: 'Con', deductionFromMonth: '2026-01', evidenceReference: 'GKS', reason: 'Kiểm thử', dataStatus: 'SIMULATION' } });
      return employee;
    }
    const salary = amount => [{ sourceRef: 'salary', kind: 'SALARY', amountPaid: amount }];

    await t.test('Only KT reads rulesets; seeded 2025 and 2026 sets carry the legal values', async () => {
      assert.equal((await request('/pit/rulesets', tt)).status, 403);
      assert.equal((await request('/pit/rulesets', ad)).status, 403);
      const rulesets = (await ok('/pit/rulesets', kt)).items;
      const r26 = rulesets.find(r => r.code === 'RES-PROG-2026'), r25 = rulesets.find(r => r.code === 'RES-PROG-2025');
      assert.deepEqual(r26.brackets.filter(b => b.basis === 'MONTH').map(b => [b.upper, b.rate]), [['10000000', '0.05'], ['30000000', '0.1'], ['60000000', '0.2'], ['100000000', '0.3'], [null, '0.35']]);
      assert.deepEqual([r26.settings.selfDeduction, r26.settings.dependentDeduction, r26.exemptionMode], ['15500000', '6200000', 'ELIGIBLE_PAYMENT']);
      assert.equal(r25.brackets.filter(b => b.basis === 'MONTH').length, 7);
      assert.deepEqual([r25.settings.selfDeduction, r25.settings.dependentDeduction, r25.exemptionMode], ['11000000', '4400000', 'PREMIUM_ONLY']);
    });

    await t.test('A new ruleset version closes the open one; overlap and missing basis are refused', async () => {
      const r26 = (await ok('/pit/rulesets', kt)).items.find(r => r.code === 'RES-PROG-2026');
      const body = { code: 'RES-PROG-2027', subject: 'RESIDENT_PROGRESSIVE', exemptionMode: 'ELIGIBLE_PAYMENT', settings: r26.settings, brackets: r26.brackets.map(({ upper, ...rest }) => upper === null ? rest : { ...rest, upper }), status: 'SIMULATION', effectiveFrom: '2027-01-01' };
      assert.equal((await request('/pit/rulesets', kt, body)).body.code, 'TAX_LEGAL_BASIS_REQUIRED');
      const added = await ok('/pit/rulesets', kt, { ...body, legalBasis: 'Văn bản mô phỏng 2027' });
      assert.equal(added.closedCode, 'RES-PROG-2026');
      const closed = await db.taxRuleset.findUniqueOrThrow({ where: { code: 'RES-PROG-2026' } });
      assert.equal(closed.effectiveTo.toISOString().slice(0, 10), '2026-12-31');
      const overlap = await request('/pit/rulesets', kt, { ...body, code: 'RES-PROG-X', legalBasis: 'Chồng', effectiveFrom: '2026-06-01' });
      assert.equal(overlap.status, 409); assert.equal(overlap.body.code, 'EFFECTIVE_OVERLAP');
      const gap = await request('/pit/rulesets', kt, { ...body, code: 'RES-PROG-BAD', legalBasis: 'Biểu lỗi', effectiveFrom: '2028-01-01', brackets: body.brackets.filter(b => b.bracketNo !== 2) });
      assert.equal(gap.body.code, 'TAX_BRACKETS_INVALID');
      await assert.rejects(db.taxRuleset.update({ where: { id: closed.id }, data: { legalBasis: 'Sửa' } }), /immutable/);
    });

    await t.test('TC-T03 / UAT-26 for an employee: profile, contract and dependents drive the progressive branch', async () => {
      const employee = await person('T03', { dependents: 1 });
      const result = await ok('/pit/preview', kt, { employeeId: employee.id, paymentDate: '2026-02-05', paymentDateStatus: 'ACTUAL', items: salary('70000000'), deductions: { insurance: '3300000' } });
      assert.deepEqual([result.branch, result.dependents, result.assessableIncome, result.tax, result.context.ruleset.code], ['PROGRESSIVE', 1, '45000000', '5500000', 'RES-PROG-2026']);
      const january = await ok('/pit/preview', kt, { employeeId: employee.id, paymentDate: '2026-01-09', paymentDateStatus: 'PROJECTED', items: salary('70000000'), deductions: { insurance: '3300000' } });
      assert.deepEqual([january.context.taxPeriod, january.context.paymentDateStatus, january.context.ruleset.code], ['2026-01', 'PROJECTED', 'RES-PROG-2026']);
    });

    await t.test('Branches: short contract → 10%, non-resident → 20%, missing profile is refused', async () => {
      const short = await person('SHORT', { contractType: 'FIXED_TERM', endDate: '2026-01-31' });
      const flat = await ok('/pit/preview', kt, { employeeId: short.id, paymentDate: '2026-02-05', paymentDateStatus: 'ACTUAL', items: [{ sourceRef: 'p', kind: 'OTHER_TAXABLE', amountPaid: '5000000' }], deductions: { insurance: '0' } });
      assert.deepEqual([flat.branch, flat.tax], ['FLAT_10', '500000']);
      const foreign = await person('NR', { residency: 'NON_RESIDENT', dependents: 1 });
      const nr = await ok('/pit/preview', kt, { employeeId: foreign.id, paymentDate: '2026-08-05', paymentDateStatus: 'ACTUAL', items: salary('20000000'), deductions: { insurance: '0' } });
      assert.deepEqual([nr.branch, nr.tax, nr.context.ruleset.code], ['NON_RESIDENT_20', '4000000', 'NONRES-2026H2']);
      const none = await person('NONE', { residency: null });
      const missing = await request('/pit/preview', kt, { employeeId: none.id, paymentDate: '2026-02-05', paymentDateStatus: 'ACTUAL', items: salary('10000000'), deductions: { insurance: '0' } });
      assert.equal(missing.status, 409); assert.equal(missing.body.code, 'TAX_PROFILE_MISSING');
    });

    await t.test('TC-T09: meal norm follows its own effective dates (payment-date parameter)', async () => {
      const meal = paymentDate => ok('/pit/preview', kt, { subject: 'RESIDENT_PROGRESSIVE', paymentDate, paymentDateStatus: 'ACTUAL', items: [{ sourceRef: 'meal', kind: 'MEAL', amountPaid: '1500000' }], deductions: { insurance: '0' }, dependents: 0 });
      const june = await meal('2026-06-30'), july = await meal('2026-07-01');
      assert.deepEqual([june.exemptions.exempt, june.exemptions.taxable], ['730000', '770000']);
      assert.deepEqual([july.exemptions.exempt, july.exemptions.taxable], ['1200000', '300000']);
    });

    await t.test('UAT-13: gross-up of NET 20.000.000 đ converges within 1 đồng', async () => {
      const employee = await person('GROSS');
      const result = await ok('/pit/gross-up-preview', kt, { employeeId: employee.id, net: '20000000', paymentDate: '2026-10-05' });
      assert.ok(Math.abs(Number(result.difference)) <= 1, JSON.stringify(result));
      assert.equal(result.ruleset, 'RES-PROG-2026');
    });

    await t.test('Withholding ledger: one draft per payment, locked rows never overwritten, adjustments link the original', async () => {
      const employee = await person('LEDGER');
      const body = { employeeId: employee.id, paymentKey: 'PAY-' + tag + '-1', paymentDate: '2026-02-05', paymentDateStatus: 'ACTUAL', items: salary('30000000'), deductions: { insurance: '2100000' } };
      const first = await ok('/pit/withholdings', kt, body);
      const second = await ok('/pit/withholdings', kt, { ...body, items: salary('31000000') });
      assert.equal(second.id, first.id); assert.equal(second.revision, 2);
      assert.equal(await db.taxWithholding.count({ where: { employeeId: employee.id } }), 1);
      const stored = await db.taxWithholding.findUniqueOrThrow({ where: { id: first.id } });
      assert.ok(stored.detailCipher.startsWith('v1.') && !stored.detailCipher.includes('31000000'));
      assert.equal(await db.taxExemptionLine.count({ where: { withholdingId: first.id } }), 1);
      await db.taxWithholding.update({ where: { id: first.id }, data: { status: 'LOCKED' } });
      const overwrite = await request('/pit/withholdings', kt, body);
      assert.equal(overwrite.status, 409); assert.equal(overwrite.body.code, 'WITHHOLDING_LOCKED');
      const filed = await ok('/pit/withholdings/' + first.id + '/file', kt, {});
      assert.equal(filed.filingStatus, 'FILED');
      await assert.rejects(db.taxWithholding.update({ where: { id: first.id }, data: { reason: 'Sửa' } }), /immutable/);
      const { paymentKey: _key, ...adjustBody } = body;
      const adjustment = await ok('/pit/withholdings/' + first.id + '/adjustments', kt, { ...adjustBody, items: salary('32000000'), reason: 'Bổ sung thu nhập đã chi' });
      assert.equal(adjustment.originalWithholdingId, first.id);
      const listed = await ok('/pit/withholdings?employeeId=' + employee.id, kt);
      assert.deepEqual(listed.items.map(item => [item.filingStatus, item.originalWithholdingId === null]), [['FILED', true], ['NOT_FILED', false]]);
      assert.equal(listed.items[0].tax, filed.tax, 'original amount is untouched');
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
