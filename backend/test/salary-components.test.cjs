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
const date = value => new Date(value + 'T00:00:00.000Z');
const text = value => value.toISOString().slice(0, 10);
const today = text(businessDate());
const after = days => text(new Date(date(today).getTime() + days * 86400000));

test('Salary components: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_components_' + randomUUID().replaceAll('-', '');
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
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error(logs)); }, 20000);
      server.once('exit', code => { finished = true; clearTimeout(timeout); reject(new Error('API exited ' + code + '\n' + logs)); });
      const poll = async () => { if (finished) return; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { finished = true; clearTimeout(timeout); ready(); return; } } catch {} if (!finished) setTimeout(poll, 100); }; poll();
    });
    async function request(path, cookie, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const result = await request(path, cookie, body); assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result) + (result.status >= 500 ? '\n' + logs : '')); return result.body; }
    async function login(username) { const account = credentials.find(value => value.username === username); return (await request('/auth/login', null, { username, password: account.password })).cookie; }
    const [kt, local, tt, qd, ad] = await Promise.all(['kt.all', 'kt.bn', 'tt.bn', 'qd.bn', 'ad.demo'].map(login));
    const [company, site, remote, team] = await Promise.all(['COMPANY', 'NM-BN', 'NM-NA', 'NM-BN-D1-T1'].map(code => db.orgUnit.findUniqueOrThrow({ where: { code } })));
    const path = '/salary-components';
    const input = { name: 'Phụ cấp kiểm chứng', componentType: 'EARNING', active: true, isInsurable: true, taxClassification: 'NON_TAXABLE', isOtBase: false, isProrated: true, displayOrder: 12, status: 'SIMULATION', classificationBasis: 'Bộ mô phỏng phân loại độc lập; không dùng chi trả thật.', decisionReference: 'DEC-03-COMPONENT', reason: 'Tạo danh mục kiểm chứng', effectiveFrom: today };
    let shared, own, outside;
    const detail = async (id, asOf = today, cookie = kt) => (await ok(path + '/' + id + '?asOf=' + asOf, cookie)).item;

    await t.test('only authorized KT can read or mutate; read-only KT cannot write', async () => {
      assert.equal((await request(path + '/context')).status, 401);
      for (const cookie of [tt, qd, ad]) {
        assert.equal((await request(path, cookie)).status, 403);
        assert.equal((await request(path + '/context', cookie)).status, 403);
        assert.equal((await request(path, cookie, { ...input, orgUnitId: site.id, code: 'DENIED' })).status, 403);
      }
      const role = await db.role.findUniqueOrThrow({ where: { code: 'KT' } });
      try {
        await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions.filter(value => value !== 'payroll.components.manage') } });
        const context = await ok(path + '/context', local);
        assert.deepEqual(context.managementUnits, []);
        assert.equal((await request(path, local, { ...input, orgUnitId: site.id, code: 'READ_ONLY' })).status, 403);
      } finally { await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions } }); }
    });

    await t.test('component kinds and independent classifications survive storage without coercion', async () => {
      shared = (await ok(path, kt, { ...input, orgUnitId: company.id, code: 'COMMON' })).item;
      own = (await ok(path, local, { ...input, orgUnitId: site.id, code: 'COMMON', name: 'Khấu trừ theo thỏa thuận', componentType: 'DEDUCTION', isInsurable: false, taxClassification: 'TAXABLE', isOtBase: true, isProrated: false })).item;
      outside = (await ok(path, kt, { ...input, orgUnitId: remote.id, code: 'EMPLOYER', componentType: 'EMPLOYER_COST', taxClassification: 'CONDITIONAL' })).item;
      const actual = await detail(shared.id);
      assert.deepEqual([actual.activeVersion.componentType, actual.activeVersion.isInsurable, actual.activeVersion.taxClassification, actual.activeVersion.isOtBase, actual.activeVersion.isProrated], ['EARNING', true, 'NON_TAXABLE', false, true]);
      assert.deepEqual([own.activeVersion.componentType, own.activeVersion.isInsurable, own.activeVersion.taxClassification, own.activeVersion.isOtBase, own.activeVersion.isProrated], ['DEDUCTION', false, 'TAXABLE', true, false]);
      assert.equal((await detail(outside.id)).activeVersion.taxClassification, 'CONDITIONAL');
      assert.equal(outside.activeVersion.componentType, 'EMPLOYER_COST');
    });

    await t.test('site KT reads shared company catalog but cannot change it or see another site', async () => {
      const context = await ok(path + '/context', local);
      assert.deepEqual(context.managementUnits.map(unit => unit.id), [site.id]);
      assert.deepEqual(new Set(context.units.map(unit => unit.id)), new Set([company.id, site.id]));
      const visible = (await ok(path, local)).items;
      assert.deepEqual(new Set(visible.map(item => item.id)), new Set([shared.id, own.id]));
      assert.equal(visible.find(item => item.id === shared.id).canManage, false);
      assert.equal(visible.find(item => item.id === own.id).canManage, true);
      assert.equal((await request(path + '/' + outside.id, local)).status, 404);
      assert.equal((await request(path + '?orgUnitId=' + remote.id, local)).status, 404);
      assert.equal((await request(path + '/' + shared.id + '/versions', local, { ...input, revision: 1, effectiveFrom: after(1) })).status, 404);
      assert.equal((await request(path, local, { ...input, orgUnitId: company.id, code: 'FORBIDDEN' })).status, 404);
      assert.equal((await request(path, kt, { ...input, orgUnitId: team.id, code: 'WRONG_LEVEL' })).status, 400);
    });

    await t.test('dates, required evidence, enums and duplicate codes fail without a partial catalog', async () => {
      for (const patch of [{ effectiveFrom: '2026-02-30' }, { effectiveTo: '1900-01-01' }, { name: '  ' }, { classificationBasis: '\t' }, { decisionReference: '' }, { reason: ' ' }, { taxClassification: 'EXEMPT_FOREVER' }, { isInsurable: 'false' }, { displayOrder: -1 }, { displayOrder: 1.5 }, { code: 'lower' }]) {
        const result = await request(path, kt, { ...input, orgUnitId: site.id, code: 'INVALID', ...patch });
        assert.equal(result.status, 400, JSON.stringify(result));
      }
      assert.equal(await db.salaryComponent.findUnique({ where: { orgUnitId_code: { orgUnitId: site.id, code: 'INVALID' } } }), null);
      assert.equal((await request(path, local, { ...input, orgUnitId: site.id, code: 'COMMON' })).status, 409);
      assert.equal((await request(path + '?asOf=2026-02-30', kt)).status, 400);
    });

    await t.test('future successor preserves prior classifications and resolves exact inclusive date boundaries', async () => {
      assert.equal((await request(path + '/' + shared.id + '/versions', kt, { ...input, revision: 1, effectiveFrom: today })).status, 400);
      const next = { ...input, name: 'Phụ cấp từ phiên bản kế tiếp', isInsurable: false, taxClassification: 'CONDITIONAL', isOtBase: true, isProrated: false, active: false, revision: 1, effectiveFrom: after(1) };
      const changed = (await ok(path + '/' + shared.id + '/versions', kt, next)).item;
      assert.equal(changed.revision, 2);
      const old = changed.versions.find(version => version.id === shared.activeVersion.id);
      assert.deepEqual([old.name, old.isInsurable, old.taxClassification, old.isOtBase, old.isProrated, old.effectiveTo], [input.name, true, 'NON_TAXABLE', false, true, today]);
      assert.equal((await detail(shared.id, today)).activeVersion.id, old.id);
      assert.deepEqual([(await detail(shared.id, after(1))).activeVersion.name, (await detail(shared.id, after(1))).activeVersion.active], [next.name, false]);
      assert.equal((await request(path + '/' + shared.id + '/versions', kt, { ...next, effectiveFrom: after(2) })).status, 409);
      assert.equal((await request(path + '/' + shared.id + '/versions', kt, { ...next, revision: 2 })).status, 400);
      const bounded = (await ok(path, local, { ...input, orgUnitId: site.id, code: 'BOUNDED', effectiveTo: after(1) })).item;
      assert.equal((await detail(bounded.id, after(1))).activeVersion.id, bounded.activeVersion.id);
      assert.equal((await detail(bounded.id, after(2))).activeVersion, null);
    });

    await t.test('scope checks cover intervening grant gaps, not only interval endpoints', async () => {
      const account = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.bn' } });
      const grant = await db.roleAssignment.findFirstOrThrow({ where: { userAccountId: account.id, roleCode: 'KT' } });
      let future;
      try {
        await db.roleAssignment.update({ where: { id: grant.id }, data: { effectiveTo: date(today) } });
        future = await db.roleAssignment.create({ data: { userAccountId: account.id, roleCode: 'KT', scopeOrgUnitId: site.id, effectiveFrom: date(after(3)) } });
        assert.equal((await request(path + '/' + own.id + '?asOf=' + after(1), local)).status, 404);
        assert.equal((await request(path, local, { ...input, code: 'GRANT_GAP', orgUnitId: site.id, effectiveTo: after(4) })).status, 404);
        assert.equal(await db.salaryComponent.findUnique({ where: { orgUnitId_code: { orgUnitId: site.id, code: 'GRANT_GAP' } } }), null);
      } finally {
        if (future) await db.roleAssignment.delete({ where: { id: future.id } });
        await db.roleAssignment.update({ where: { id: grant.id }, data: { effectiveTo: grant.effectiveTo } });
      }
    });

    await t.test('competing revisions yield one successor and one conflict with atomic audit', async () => {
      const current = await detail(shared.id);
      const responses = await Promise.all(['A', 'B'].map((suffix, index) => request(path + '/' + shared.id + '/versions', kt, { ...input, revision: current.revision, effectiveFrom: after(5), name: 'Bản cạnh tranh ' + suffix, displayOrder: 20 + index })));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const winner = responses.find(response => response.status === 201).body.item;
      const final = await detail(shared.id, after(5));
      assert.equal(final.revision, 3);
      assert.equal(final.versions.length, 3);
      assert.equal(final.activeVersion.name, winner.versions[0].name);
      assert.equal(final.activeVersion.displayOrder, winner.versions[0].displayOrder);
      assert.equal(final.versions[1].effectiveTo, after(4));
      const audit = await db.auditLog.findMany({ where: { entityType: 'salary_component', entityId: shared.id }, orderBy: { id: 'asc' } });
      assert.deepEqual(audit.map(entry => entry.action), ['CREATE', 'CREATE_VERSION', 'CREATE_VERSION']);
      assert.equal(audit[2].newValue.item.versions[0].id, final.activeVersion.id);
      assert.equal(audit[2].actorId, final.activeVersion.createdBy.id);
    });

    await t.test('database guards reject history overwrite, deletion, truncation and unpaired validity edits', async () => {
      const before = await detail(shared.id, after(5));
      const version = before.versions[0];
      for (const data of [{ name: 'Ghi đè' }, { taxClassification: 'CONDITIONAL' }, { isInsurable: false }, { createdById: (await db.userAccount.findUniqueOrThrow({ where: { username: 'ad.demo' } })).id }, { effectiveFrom: date(after(6)) }]) {
        await assert.rejects(db.salaryComponentVersion.update({ where: { id: version.id }, data }), /immutable/);
      }
      await assert.rejects(db.salaryComponentVersion.update({ where: { id: version.id }, data: { effectiveTo: date(after(8)) } }), /successor/);
      await assert.rejects(db.salaryComponentVersion.delete({ where: { id: version.id } }), /immutable/);
      await assert.rejects(db.salaryComponent.update({ where: { id: shared.id }, data: { code: 'REWRITE' } }), /immutable/);
      await assert.rejects(db.salaryComponent.delete({ where: { id: shared.id } }), /immutable/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "salary_component_version"'), /immutable/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "salary_component" CASCADE'), /immutable/);
      const stored = await db.salaryComponentVersion.findUniqueOrThrow({ where: { id: version.id } });
      const { id, createdAt, createdById, ...fields } = stored;
      await assert.rejects(db.salaryComponentVersion.create({ data: { ...fields, createdById, effectiveFrom: date(after(6)) } }), /no_overlap/);
      assert.deepEqual(await detail(shared.id, after(5)), before);
    });
  } finally {
    if (server) { server.kill(); await new Promise(done => server.exitCode !== null ? done() : server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
