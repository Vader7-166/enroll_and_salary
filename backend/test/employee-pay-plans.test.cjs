const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { businessDate } = require('../dist/auth/business-date');
process.loadEnvFile(resolve(__dirname, '../.env'));
const root = resolve(__dirname, '../..'), backend = resolve(root, 'backend');
const day = 86400000, date = value => new Date(value + 'T00:00:00Z');
const text = value => value.toISOString().slice(0, 10), today = text(businessDate());
const after = days => text(new Date(date(today).getTime() + days * day));

test('Employee pay plans: scoped composition and immutable effective history over real HTTP/PostgreSQL', { timeout: 240000 }, async t => {
  const name = 'hrtp_pay_plans_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient(), url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let db, server, logs = '';
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error(logs)); }, 20000);
      server.once('exit', code => { if (!finished) { finished = true; clearTimeout(timeout); reject(new Error('API exited ' + code + '\n' + logs)); } });
      const poll = async () => { if (finished) return; try { if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok) { finished = true; clearTimeout(timeout); ready(); return; } } catch {} if (!finished) setTimeout(poll, 100); }; poll();
    });
    async function request(path, cookie, body) {
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const response = await request(path, cookie, body); assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response) + (response.status >= 500 ? '\n' + logs : '')); return response.body; }
    async function login(username) { const account = credentials.find(row => row.username === username); return (await request('/auth/login', null, { username, password: account.password })).cookie; }
    const [kt, local, tt, qd, ad] = await Promise.all(['kt.all', 'kt.bn', 'tt.bn', 'qd.bn', 'ad.demo'].map(login));
    const [company, site, remote, localTeam, remoteTeam] = await Promise.all(['COMPANY', 'NM-BN', 'NM-NA', 'NM-BN-D1-T1', 'NM-NA-D1-T1'].map(code => db.orgUnit.findUniqueOrThrow({ where: { code } })));
    const employees = await db.employee.findMany({ where: { code: { startsWith: 'NM-BN-' } }, orderBy: { code: 'asc' } });
    const remoteEmployee = await db.employee.findFirstOrThrow({ where: { code: { startsWith: 'NM-NA-' } } });
    const path = '/employee-pay-plans';
    const common = { name: 'Phương án sản xuất có căn cứ', payMode: 'MONTHLY', status: 'SIMULATION', decisionReference: 'QD-PLAN-TEST', reason: 'Kiểm chứng phương án theo nhân viên', effectiveFrom: today };
    const componentInput = { name: 'Lương chính kiểm chứng', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: false, displayOrder: 10, status: 'SIMULATION', classificationBasis: 'Dữ liệu kiểm chứng độc lập, không phải kết luận pháp lý', decisionReference: 'QD-TEST', reason: 'Kiểm chứng phương án lương', effectiveFrom: after(-20) };
    async function component(code, extra = {}) { return (await ok('/salary-components', kt, { ...componentInput, orgUnitId: company.id, code, ...extra })).item; }
    const baseComponent = await component('PLAN_BASE');
    const bonusComponent = await component('PLAN_BONUS');
    const deductionComponent = await component('PLAN_DEDUCTION', { componentType: 'DEDUCTION' });
    const costComponent = await component('PLAN_COST', { componentType: 'EMPLOYER_COST' });
    const naComponent = await component('PLAN_NA');
    async function formula(code, componentId, extra = {}) { return (await ok('/payroll-configuration', kt, { name: code, kind: 'FORMULA', code, orgUnitId: company.id, unit: 'VND', active: true, status: 'SIMULATION', decisionReference: 'QD-FORMULA', reason: 'Nguồn kiểm chứng công thức', effectiveFrom: after(-20), componentId, expression: 'X', variables: [{ symbol: 'X', source: 'INPUT', reference: 'PAY_AMOUNT', unit: 'VND', min: '0' }], roundingMode: 'HALF_UP', roundingScale: 0, ...extra })).item; }
    const baseFormula = await formula('PLAN_BASE_FORMULA', baseComponent.id);
    const bonusFormula = await formula('PLAN_BONUS_FORMULA', bonusComponent.id, { expression: 'B * 0.03', variables: [{ symbol: 'B', source: 'FORMULA', reference: baseFormula.code, unit: 'VND' }] });
    const deductionFormula = await formula('PLAN_DEDUCTION_FORMULA', deductionComponent.id);
    const costFormula = await formula('PLAN_COST_FORMULA', costComponent.id);
    const line = (extra = {}) => ({ componentId: baseComponent.id, role: 'BASE', sourceType: 'TIME', formulaCode: baseFormula.code, sourceReference: 'QD-LUONG-THOI-GIAN', allocation: 'INDIVIDUAL', ...extra });
    const planInput = (employeeId, extra = {}) => ({ ...common, employeeId, lines: [line()], ...extra });
    const versionInput = (revision, extra = {}) => ({ ...common, lines: [line()], revision, effectiveFrom: after(2), ...extra });
    const detail = async (id, asOf = today, cookie = kt) => (await ok(path + '/' + id + '?asOf=' + asOf, cookie)).item;
    let initial;

    await t.test('KT-only authority, company catalog inheritance does not expose remote or excluded employees', async () => {
      assert.equal((await request(path + '/context')).status, 401);
      for (const cookie of [tt, qd, ad]) { assert.equal((await request(path + '/context', cookie)).status, 403); assert.equal((await request(path, cookie, planInput(employees[0].id))).status, 403); }
      const scoped = await ok(path + '/employees?orgUnitId=' + site.id, local);
      assert.equal(scoped.items.some(row => row.id === employees[0].id), true);
      assert.equal((await request(path + '/employees?orgUnitId=' + remote.id, local)).status, 404);
      assert.equal((await request(path, local, planInput(remoteEmployee.id))).status, 404);
      const actor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.bn' } });
      const exclusion = await db.employeeExclusion.create({ data: { userAccountId: actor.id, employeeId: employees[0].id, effectiveFrom: date(after(-5)) } });
      try {
        assert.equal((await ok(path + '/employees?search=' + encodeURIComponent(employees[0].code), local)).items.some(row => row.id === employees[0].id), false);
        assert.equal((await request(path, local, planInput(employees[0].id))).status, 404);
      } finally { await db.employeeExclusion.delete({ where: { id: exclusion.id } }); }
    });

    await t.test('employee catalogue inherits company formulas and cannot be used as a remote employee lookup', async () => {
      const catalogue = await ok(path + '/catalogue?employeeId=' + employees[0].id + '&asOf=' + today, local);
      assert.equal(catalogue.components.some(row => row.id === baseComponent.id), true);
      assert.equal(catalogue.formulae.some(row => row.code === baseFormula.code && row.componentId === baseComponent.id), true);
      assert.equal((await request(path + '/catalogue?employeeId=' + remoteEmployee.id + '&asOf=' + today, local)).status, 404);
    });

    await t.test('read-only KT retains scoped reads without gaining plan management', async () => {
      const role = await db.role.findUniqueOrThrow({ where: { code: 'KT' } });
      try {
        await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions.filter(permission => permission !== 'payroll.components.manage') } });
        const cookie = await login('kt.bn');
        const context = await ok(path + '/context', cookie);
        assert.equal(context.units.some(unit => unit.id === site.id), true);
        assert.deepEqual(context.managementUnits, []);
        assert.equal((await request(path, cookie, planInput(employees[0].id))).status, 403);
      } finally { await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions } }); }
    });

    await t.test('explicit main, additional, not-applicable and independent classifications are retained without computing salary', async () => {
      const lines = [line(), line({ componentId: bonusComponent.id, role: 'ADDITIONAL', sourceType: 'BONUS', formulaCode: bonusFormula.code, sourceReference: 'QD-LUONG-THOI-GIAN', separateDecisionReference: 'QD-THUONG-RIENG' }), line({ componentId: deductionComponent.id, role: 'ADDITIONAL', sourceType: 'DEDUCTION', formulaCode: deductionFormula.code, sourceReference: 'CHUNG-TU-TAM-UNG' }), line({ componentId: costComponent.id, role: 'ADDITIONAL', sourceType: 'EMPLOYER_COST', formulaCode: costFormula.code, sourceReference: 'QD-CHI-PHI' }), { componentId: naComponent.id, role: 'NOT_APPLICABLE', sourceType: 'ALLOWANCE', sourceReference: 'Không hưởng khoản này theo quyết định', allocation: 'INDIVIDUAL' }];
      initial = (await ok(path, local, planInput(employees[0].id, { lines }))).item;
      assert.equal(initial.employeeId, employees[0].id);
      assert.equal(initial.activeVersion.payMode, 'MONTHLY');
      assert.deepEqual(initial.activeVersion.lines, lines);
      const list = await ok(path + '?search=' + employees[0].code, local);
      assert.equal(list.items.some(row => row.id === initial.id && row.employeeId === employees[0].id), true);
      assert.equal((await request(path, kt, planInput(employees[0].id))).status, 409);
      assert.equal((await request(path + '/' + initial.id, tt)).status, 403);
    });

    await t.test('all seven pay modes bind an explicit single replacement main; team allocation is a referenced method, not received input', async () => {
      const cases = [['DAILY', 'TIME'], ['HOURLY', 'TIME'], ['PRODUCT', 'PRODUCT'], ['PIECEWORK', 'PIECEWORK'], ['COMMISSION', 'COMMISSION'], ['THREE_P', 'THREE_P']];
      for (const [index, [payMode, sourceType]] of cases.entries()) {
        const team = sourceType === 'PRODUCT' || sourceType === 'PIECEWORK';
        const item = (await ok(path, kt, planInput(employees[index + 1].id, { payMode, lines: [line({ sourceType, ...(team ? { allocation: 'CONFIRMED_TEAM_ALLOCATION', allocationReference: 'QD-PHAN-BO-' + payMode } : {}) })] }))).item;
        assert.equal(item.activeVersion.payMode, payMode);
        assert.equal(item.activeVersion.lines[0].sourceType, sourceType);
        if (team) assert.equal(item.activeVersion.lines[0].allocationReference, 'QD-PHAN-BO-' + payMode);
      }
    });

    const unused = employees[7].id;
    await t.test('double main, duplicate payout, mismatched types, shared performance and undeclared team allocations are rejected atomically', async () => {
      const invalid = [
        { lines: [] },
        { lines: [line(), line({ componentId: bonusComponent.id, formulaCode: bonusFormula.code })] },
        { lines: [line(), line({ role: 'ADDITIONAL', sourceType: 'ALLOWANCE', sourceReference: 'QD-OTHER' })] },
        { payMode: 'PRODUCT', lines: [line()] },
        { lines: [line({ componentId: deductionComponent.id, formulaCode: deductionFormula.code })] },
        { lines: [line(), line({ componentId: costComponent.id, role: 'ADDITIONAL', sourceType: 'ALLOWANCE', formulaCode: costFormula.code, sourceReference: 'QD-COST' })] },
        { lines: [line(), line({ componentId: bonusComponent.id, role: 'ADDITIONAL', sourceType: 'BONUS', formulaCode: bonusFormula.code, sourceReference: 'QD-LUONG-THOI-GIAN' })] },
        { lines: [line({ formulaCode: bonusFormula.code })] },
        { lines: [line(), line({ componentId: bonusComponent.id, role: 'ADDITIONAL', sourceType: 'COMMISSION', formulaCode: bonusFormula.code, sourceReference: 'QD-HOA-HONG' })] },
        { payMode: 'PIECEWORK', lines: [line({ sourceType: 'PIECEWORK', allocation: 'CONFIRMED_TEAM_ALLOCATION' })] },
        { lines: [line(), { componentId: naComponent.id, role: 'NOT_APPLICABLE', sourceType: 'ALLOWANCE', sourceReference: 'Không áp dụng', formulaCode: baseFormula.code, allocation: 'INDIVIDUAL' }] },
      ];
      for (const extra of invalid) assert.equal((await request(path, kt, planInput(unused, extra))).status, 400, JSON.stringify(extra));
      assert.equal((await ok(path + '?search=' + employees[7].code, kt)).items.some(row => row.employeeId === unused), false);
    });

    await t.test('invalid calendar dates, dates before hiring, empty basis and inverted intervals cannot become pay history', async () => {
      for (const extra of [{ effectiveFrom: '2026-02-30' }, { effectiveFrom: '1899-12-31' }, { effectiveFrom: '2020-01-01' }, { effectiveTo: after(-1) }, { decisionReference: '   ' }, { reason: '   ' }, { name: '   ' }]) assert.equal((await request(path, kt, planInput(unused, extra))).status, 400, JSON.stringify(extra));
    });

    await t.test('simulation cannot be promoted to confirmed business policy through the pay plan label', async () => {
      assert.equal((await request(path, kt, planInput(unused, { status: 'BUSINESS_CONFIRMED' }))).status, 400);
    });

    await t.test('all interval boundaries are checked for expired formulas and future component retargeting', async () => {
      const finite = await formula('PLAN_FINITE_FORMULA', baseComponent.id, { effectiveTo: after(3) });
      assert.equal((await request(path, kt, planInput(unused, { lines: [line({ formulaCode: finite.code })] }))).status, 400);
      const retarget = await formula('PLAN_RETARGET_FORMULA', baseComponent.id);
      const latest = retarget.versions[0];
      const { id, createdAt, createdBy, ...config } = latest;
      await ok('/payroll-configuration/' + retarget.id + '/versions', kt, { ...config, effectiveTo: undefined, revision: retarget.revision, effectiveFrom: after(4), componentId: bonusComponent.id });
      assert.equal((await request(path, kt, planInput(unused, { lines: [line({ formulaCode: retarget.code })] }))).status, 400);
      const bounded = (await ok(path, kt, planInput(unused, { effectiveTo: after(3), lines: [line({ formulaCode: retarget.code })] }))).item;
      assert.equal(bounded.activeVersion.effectiveTo, after(3));
      await ok(path + '/' + bounded.id + '/versions', kt, versionInput(bounded.revision, { effectiveFrom: after(6) }));
      assert.equal((await detail(bounded.id, after(4))).activeVersion, null);
      assert.equal((await detail(bounded.id, after(2))).activeVersion.effectiveTo, after(3));
    });

    await t.test('successors close prior ranges, preserve the original decision, and stale concurrent writes return 409', async () => {
      const before = await detail(initial.id);
      assert.equal((await request(path + '/' + initial.id + '/versions', kt, versionInput(before.revision, { effectiveFrom: today }))).status, 400);
      const results = await Promise.all(['A', 'B'].map(suffix => request(path + '/' + initial.id + '/versions', kt, versionInput(before.revision, { name: 'Quyết định kế tiếp ' + suffix }))));
      assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
      const changed = await detail(initial.id, after(2));
      assert.equal(changed.revision, before.revision + 1);
      assert.equal(changed.activeVersion.effectiveFrom, after(2));
      const historic = (await detail(initial.id, after(1))).activeVersion;
      assert.equal(historic.id, before.activeVersion.id);
      assert.equal(historic.effectiveTo, after(1));
      assert.deepEqual(historic.lines, before.activeVersion.lines);
      assert.equal(historic.decisionReference, before.activeVersion.decisionReference);
      assert.equal((await request(path + '/' + initial.id + '/versions', kt, versionInput(before.revision, { effectiveFrom: after(5) }))).status, 409);
    });

    await t.test('employee location and authorization are checked at changes inside the interval, not only the first day', async () => {
      const mover = await db.employee.create({ data: { code: 'PLAN-MOVER', fullName: 'Nhân viên chuyển cơ sở', gender: 'OTHER', dob: date('1995-01-01'), hireDate: date(after(-20)), assignments: { create: [{ orgUnitId: localTeam.id, isPrimary: true, allocationRatio: '100', effectiveFrom: date(after(-20)), effectiveTo: date(after(2)) }, { orgUnitId: remoteTeam.id, isPrimary: true, allocationRatio: '100', effectiveFrom: date(after(3)) }] } } });
      assert.equal((await request(path, local, planInput(mover.id))).status, 404);
      assert.equal((await request(path, kt, planInput(mover.id))).status, 400);
      const bounded = (await ok(path, local, planInput(mover.id, { effectiveTo: after(2) }))).item;
      assert.equal(bounded.activeVersion.effectiveTo, after(2));
      assert.equal((await request(path + '/' + bounded.id + '?asOf=' + after(3), local)).status, 404);
      const moved = (await ok(path + '/' + bounded.id + '/versions', kt, versionInput(bounded.revision, { effectiveFrom: after(3), decisionReference: 'QD-REMOTE-TRANSFER' }))).item;
      assert.equal((await detail(moved.id, after(3))).activeVersion.decisionReference, 'QD-REMOTE-TRANSFER');
      assert.equal((await detail(moved.id, today)).activeVersion.effectiveTo, after(2));
      assert.equal((await request(path + '/' + moved.id + '/versions', local, versionInput(moved.revision, { effectiveFrom: after(5) }))).status, 404);
    });

    await t.test('current access does not leak a historical plan from a different site', async () => {
      const mover = await db.employee.create({ data: { code: 'PLAN-HISTORY', fullName: 'Nhân viên có lịch sử khác cơ sở', gender: 'OTHER', dob: date('1995-01-01'), hireDate: date(after(-20)), assignments: { create: [{ orgUnitId: remoteTeam.id, isPrimary: true, allocationRatio: '100', effectiveFrom: date(after(-20)), effectiveTo: date(after(-5)) }, { orgUnitId: localTeam.id, isPrimary: true, allocationRatio: '100', effectiveFrom: date(after(-4)) }] } } });
      const secret = 'CONFIDENTIAL-REMOTE-SALARY-DECISION';
      const row = (await ok(path, kt, planInput(mover.id, { name: secret, decisionReference: secret, effectiveFrom: after(-15), effectiveTo: after(-6) }))).item;
      const history = await request(path + '/' + row.id, local);
      assert.ok([200, 404].includes(history.status));
      assert.equal(JSON.stringify(history.body).includes(secret), false);
      assert.equal(JSON.stringify((await request(path, local)).body).includes(secret), false);
    });

    await t.test('database guards prevent overlapping, identity changes, JSON history edits and destructive SQL', async () => {
      const stored = await db.employeePayPlan.findUniqueOrThrow({ where: { id: initial.id } });
      const version = await db.employeePayPlanVersion.findFirstOrThrow({ where: { payPlanId: initial.id }, orderBy: { effectiveFrom: 'desc' } });
      for (const data of [{ name: 'Ghi đè' }, { lines: [] }, { effectiveFrom: date(after(9)) }]) await assert.rejects(db.employeePayPlanVersion.update({ where: { id: version.id }, data }));
      await assert.rejects(db.employeePayPlanVersion.delete({ where: { id: version.id } }));
      await assert.rejects(db.employeePayPlan.update({ where: { id: stored.id }, data: { employeeId: remoteEmployee.id } }));
      await assert.rejects(db.employeePayPlan.delete({ where: { id: stored.id } }));
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "employee_pay_plan_version"'));
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "employee_pay_plan" CASCADE'));
      const { id, createdAt, ...fields } = version;
      await assert.rejects(db.employeePayPlanVersion.create({ data: { ...fields, effectiveFrom: date(after(8)) } }));
      assert.equal((await detail(initial.id, after(2))).activeVersion.id, version.id);
      const audit = await db.auditLog.findMany({ where: { entityId: initial.id } });
      assert.equal(audit.some(row => row.action === 'CREATE'), true);
      assert.equal(audit.some(row => row.action === 'CREATE_VERSION'), true);
    });
  } finally {
    if (server) { server.kill(); await new Promise(done => server.exitCode !== null ? done() : server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
