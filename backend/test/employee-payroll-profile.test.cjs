const { test } = require('node:test');
const { dropDatabase } = require('./http-harness.cjs');
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
const at = (day, time) => new Date(day + 'T' + time + '+07:00');

test('Employee payroll profile on isolated PostgreSQL and real HTTP', { timeout: 300000 }, async t => {
  const name = 'hrtp_pay_profile_' + randomUUID().replaceAll('-', '');
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
    const people = {};
    for (const [code, unitCode, gender] of [['A', 'NM-BN-D1-T1', 'FEMALE'], ['B', 'NM-BN-D1-T1', 'MALE'], ['NA', 'NM-NA-D1-T1', 'MALE']]) {
      people[code] = await db.employee.create({ data: { code: 'PP-' + tag + '-' + code, fullName: 'Hồ sơ lương ' + code, gender, dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: unit(unitCode).id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
    }
    const base = id => '/employees/' + id + '/payroll-profile';
    const identity = (overrides = {}) => ({ revision: 0, documentType: 'CCCD', idNumber: '001090012345', taxCode: '0123456789', siBookNumber: '0123456789', emergencyContactName: 'Người thân', emergencyContactPhone: '0901234567', emergencyContactRelation: 'Vợ', dataStatus: 'SIMULATION', reason: 'KT nhập hồ sơ', ...overrides });

    await t.test('KT stores identifiers encrypted with blind indexes only', async () => {
      assert.equal((await request(base(people.A.id) + '/identity', tt, identity())).status, 403);
      assert.deepEqual(await ok(base(people.A.id) + '/identity', kt, identity()), { revision: 1 });
      const row = await db.employeeIdentity.findUniqueOrThrow({ where: { employeeId: people.A.id } });
      const raw = JSON.stringify(row);
      for (const clear of ['001090012345', '0123456789']) assert.ok(!raw.includes(clear), 'no clear identifier in ' + raw);
      assert.match(row.idNumberCipher, /^v1\./); assert.match(row.taxCodeHash, /^b1\.[a-f0-9]{64}$/);
      const history = await db.employeeIdentityHistory.findMany({ where: { employeeId: people.A.id } });
      assert.equal(history.length, 1); assert.ok(!JSON.stringify(history).includes('001090012345'));
      assert.equal((await request(base(people.A.id) + '/identity', kt, identity())).status, 409, 'stale revision');
    });

    await t.test('Duplicate tax code / SI book across employees is refused even with different formatting', async () => {
      const taxClash = await request(base(people.B.id) + '/identity', kt, identity({ idNumber: '001090099999', taxCode: '0123 456 789', siBookNumber: '9999999999' }));
      assert.equal(taxClash.status, 409); assert.equal(taxClash.body.code, 'DUPLICATE_TAX_CODE');
      const siClash = await request(base(people.B.id) + '/identity', kt, identity({ idNumber: '001090099999', taxCode: '9876543210', siBookNumber: '0123456789' }));
      assert.equal(siClash.body.code, 'DUPLICATE_SI_BOOK');
      const idClash = await request(base(people.B.id) + '/identity', kt, identity({ taxCode: '9876543210', siBookNumber: '9999999999' }));
      assert.equal(idClash.body.code, 'DUPLICATE_ID_NUMBER');
      assert.equal(await db.employeeIdentity.count({ where: { employeeId: people.B.id } }), 0);
      await ok(base(people.B.id) + '/identity', kt, identity({ idNumber: '001090099999', taxCode: '9876543210', siBookNumber: '9999999999' }));
    });

    await t.test('Out-of-scope KT is refused and audited', async () => {
      const before = await db.auditLog.count({ where: { entityType: 'employee_payroll_profile', action: 'ACCESS_DENIED', entityId: people.NA.id } });
      assert.equal((await request(base(people.NA.id) + '/identity', ktbn, identity({ idNumber: '001090077777', taxCode: '1111111111', siBookNumber: '2222222222' }))).status, 403);
      assert.equal((await request(base(people.NA.id), ktbn)).status, 403);
      assert.equal(await db.auditLog.count({ where: { entityType: 'employee_payroll_profile', action: 'ACCESS_DENIED', entityId: people.NA.id } }), before + 2);
    });

    await t.test('AD always gets masked identifiers; KT with sensitive permission sees full values; reads are audited', async () => {
      await ok(base(people.A.id) + '/bank-accounts', kt, { bankCode: 'VCB', accountNumber: '0011 0022 3344', accountHolder: 'HO SO LUONG A', effectiveFrom: '2026-01-01', dataStatus: 'SIMULATION', reason: 'Tài khoản nhận lương' });
      const masked = await ok(base(people.A.id), ad);
      assert.equal(masked.masked, true);
      assert.equal(masked.identity.idNumber, '********2345');
      assert.equal(masked.bankAccounts[0].accountNumber, '********3344');
      const full = await ok(base(people.A.id), kt);
      assert.equal(full.masked, false);
      assert.deepEqual([full.identity.idNumber, full.identity.taxCode, full.identity.siBookNumber, full.bankAccounts[0].accountNumber], ['001090012345', '0123456789', '0123456789', '001100223344']);
      const audits = await db.auditLog.findMany({ where: { entityType: 'employee_payroll_profile', action: 'VIEW_SENSITIVE', entityId: people.A.id }, orderBy: { id: 'asc' } });
      assert.deepEqual(audits.slice(-2).map(a => a.result), ['MASKED', 'ALLOWED']);
      assert.equal((await request(base(people.A.id), tt)).status, 403);
    });

    await t.test('Tax profile versions close the predecessor and refuse overlaps', async () => {
      await ok(base(people.A.id) + '/tax-profiles', kt, { residency: 'RESIDENT', finalizationAuthorized: true, effectiveFrom: '2026-01-01', dataStatus: 'SIMULATION', reason: 'Cư trú từ đầu năm' });
      const second = await ok(base(people.A.id) + '/tax-profiles', kt, { residency: 'NON_RESIDENT', finalizationAuthorized: false, effectiveFrom: '2026-07-01', dataStatus: 'SIMULATION', reason: 'Đổi cư trú' });
      const rows = await db.taxProfile.findMany({ where: { employeeId: people.A.id }, orderBy: { effectiveFrom: 'asc' } });
      assert.deepEqual(rows.map(r => [r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null]), [['2026-01-01', '2026-06-30'], ['2026-07-01', null]]);
      assert.ok(second.closedId);
      const overlap = await request(base(people.A.id) + '/tax-profiles', kt, { residency: 'RESIDENT', finalizationAuthorized: false, effectiveFrom: '2026-03-01', effectiveTo: '2026-04-30', dataStatus: 'SIMULATION', reason: 'Chồng' });
      assert.equal(overlap.status, 409); assert.equal(overlap.body.code, 'EFFECTIVE_OVERLAP');
      assert.equal(overlap.body.details.overlappingId, rows[0].id);
      const partial = await request(base(people.A.id) + '/tax-profiles', kt, { residency: 'RESIDENT', finalizationAuthorized: false, effectiveFrom: '2026-06-01', dataStatus: 'SIMULATION', reason: 'Chồng bản đã đóng' });
      assert.equal(partial.body.code, 'EFFECTIVE_OVERLAP');
      const missingCommitment = await request(base(people.A.id) + '/tax-profiles', kt, { residency: 'RESIDENT', commitmentReference: 'CK-01', finalizationAuthorized: false, effectiveFrom: '2026-09-01', dataStatus: 'SIMULATION', reason: 'Thiếu mẫu' });
      assert.equal(missingCommitment.body.code, 'COMMITMENT_INCOMPLETE');
      await assert.rejects(db.taxProfile.update({ where: { id: rows[0].id }, data: { residency: 'NON_RESIDENT' } }), /immutable/);
      await assert.rejects(db.taxProfile.delete({ where: { id: rows[0].id } }), /immutable/);
    });

    await t.test('Dependents need evidence, count by month and keep immutable versions', async () => {
      const dependent = { fullName: 'Con A', relationship: 'Con', deductionFromMonth: '2026-01', deductionToMonth: '2026-06', dataStatus: 'SIMULATION', reason: 'Đăng ký NPT' };
      const missing = await request(base(people.A.id) + '/dependents', kt, dependent);
      assert.equal(missing.status, 400); assert.equal(missing.body.code, 'DEPENDENT_EVIDENCE_REQUIRED');
      const created = await ok(base(people.A.id) + '/dependents', kt, { ...dependent, evidenceReference: 'Giấy khai sinh số 123' });
      const count = async month => (await ok(base(people.A.id) + '/dependents/count?month=' + month, kt)).count;
      assert.equal(await count('2026-06'), 1); assert.equal(await count('2026-07'), 0);
      await ok(base(people.A.id) + '/dependents/' + created.dependentKey + '/versions', kt, { ...dependent, deductionFromMonth: '2026-03', evidenceReference: 'Giấy khai sinh số 123', expectedVersion: 1, reason: 'Sửa tháng bắt đầu theo chứng từ' });
      assert.equal(await count('2026-02'), 0); assert.equal(await count('2026-03'), 1);
      const versions = await db.employeeDependent.findMany({ where: { dependentKey: created.dependentKey }, orderBy: { version: 'asc' } });
      assert.deepEqual(versions.map(v => [v.version, v.deductionFromMonth]), [[1, '2026-01'], [2, '2026-03']]);
      assert.equal((await request(base(people.A.id) + '/dependents/' + created.dependentKey + '/versions', kt, { ...dependent, evidenceReference: 'x', expectedVersion: 1 })).status, 409);
      await assert.rejects(db.employeeDependent.update({ where: { id: versions[0].id }, data: { fullName: 'Sửa' } }), /immutable/);
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'employee_dependent', action: 'CREATE_VERSION' } });
      assert.equal(audit.newValue.reason, 'Sửa tháng bắt đầu theo chứng từ');
      const invalid = await request(base(people.A.id) + '/dependents', kt, { ...dependent, deductionFromMonth: '2026-08', evidenceReference: 'x' });
      assert.equal(invalid.body.code, 'DEPENDENT_MONTHS_INVALID');
    });

    await t.test('Special statuses resolve at a business date', async () => {
      const foreign = await request(base(people.B.id) + '/special-statuses', kt, { statusType: 'FOREIGN_WORKER', reference: 'GPLĐ', effectiveFrom: '2026-01-01', dataStatus: 'SIMULATION', reason: 'Người nước ngoài' });
      assert.equal(foreign.body.code, 'WORK_PERMIT_REQUIRED');
      await ok(base(people.B.id) + '/special-statuses', kt, { statusType: 'FOREIGN_WORKER', workPermitNumber: 'GP-001', permitExpiry: '2027-12-31', reference: 'GPLĐ GP-001', effectiveFrom: '2026-01-01', effectiveTo: '2026-08-31', dataStatus: 'SIMULATION', reason: 'Người nước ngoài' });
      await ok(base(people.B.id) + '/special-statuses', kt, { statusType: 'PENSIONER', reference: 'QĐ hưởng lương hưu', effectiveFrom: '2026-09-01', dataStatus: 'SIMULATION', reason: 'Đã hưởng lương hưu' });
      const at = async day => (await ok(base(people.B.id) + '/at?asOf=' + day, kt)).specialStatuses.map(s => s.statusType);
      assert.deepEqual(await at('2026-08-15'), ['FOREIGN_WORKER']);
      assert.deepEqual(await at('2026-09-15'), ['PENSIONER']);
    });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
