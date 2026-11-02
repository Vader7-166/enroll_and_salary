// add-caching-layer: the shared reference cache must never serve data older than the reader's snapshot.
// Two API instances share one isolated database, both with the cache on (default).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { withServer } = require('./http-harness.cjs');

const backend = resolve(__dirname, '..');

async function secondInstance(url) {
  const listener = net.createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...process.env, DATABASE_URL: url, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Instance B not ready: ' + logs)), 20000);
    const receive = chunk => { logs += chunk; if (logs.includes('API ready at')) { clearTimeout(timer); ready(); } };
    server.stdout.on('data', receive); server.stderr.on('data', receive);
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Instance B exited ' + code + ': ' + logs)); });
  });
  const request = async (path, cookie, body) => {
    const res = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  return { server, request };
}

test('Reference cache: versioned invalidation across instances, transactions and manual SQL', { timeout: 240000 }, async t => {
  await withServer('reference_cache', async ({ db, request, ok, login, password, url }) => {
    const { CACHE_SOURCE_TABLES } = require('../dist/common/cache/reference-cache.service.js');
    const versions = async () => Object.fromEntries((await db.$queryRaw`SELECT name, version::text AS version FROM cache_version`).map(r => [r.name, r.version]));
    const b = await secondInstance(url);
    try {
      await t.test('every registered source table bumps its group; triggers and registry match exactly', async () => {
        const triggers = await db.$queryRaw`SELECT c.relname AS "table", (regexp_match(pg_get_triggerdef(t.oid), $$bump_cache_version\\('([^']+)'\\)$$))[1] AS "group"
          FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%bump_cache_version%' ORDER BY 1`;
        assert.deepEqual(Object.fromEntries(triggers.map(r => [r.table, r.group])), Object.fromEntries(Object.entries(CACHE_SOURCE_TABLES).sort()));
        for (const [table, group] of Object.entries(CACHE_SOURCE_TABLES)) {
          const before = await versions();
          // A statement-level trigger fires even when no row matches: proves the trigger, not the data.
          await db.$executeRawUnsafe(`UPDATE ${table} SET id = id WHERE false`).catch(async () => db.$executeRawUnsafe(`UPDATE ${table} SET code = code WHERE false`));
          const after = await versions();
          assert.notEqual(after[group], before[group], table + ' must bump ' + group);
          for (const other of Object.keys(before).filter(name => name !== group)) assert.equal(after[other], before[other], table + ' must not bump ' + other);
        }
      });

      await t.test('a rolled-back version is never reused by a later commit', async () => {
        const [, inside] = await db.$transaction([db.$executeRawUnsafe(`UPDATE site_policy SET id = id WHERE false`), db.$queryRaw`SELECT version::text AS v FROM cache_version WHERE name = 'site-policies'`]).then(r => [r[0], r[1][0].v]);
        let rolledBack;
        await db.$transaction(async tx => {
          await tx.$executeRawUnsafe(`UPDATE site_policy SET id = id WHERE false`);
          rolledBack = (await tx.$queryRaw`SELECT version::text AS v FROM cache_version WHERE name = 'site-policies'`)[0].v;
          throw new Error('rollback');
        }).catch(error => assert.equal(error.message, 'rollback'));
        assert.equal((await versions())['site-policies'], inside, 'rollback restores the committed version');
        await db.$executeRawUnsafe(`UPDATE site_policy SET id = id WHERE false`);
        assert.notEqual((await versions())['site-policies'], rolledBack, 'the next commit gets a fresh sequence value');
      });

      const ad = await login('ad.demo');
      const adB = (await b.request('/auth/login', null, { username: 'ad.demo', password: password('ad.demo') })).cookie;
      const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
      const workshop = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1' } });
      const resolvePath = '/settings/policies/resolve?' + new URLSearchParams({ orgUnitId: team.id, asOf: '2027-01-15', policyKey: 'CUTOFF_DAY' });

      await t.test('instance B serves the new site policy right after instance A commits it', async () => {
        const before = await b.request(resolvePath, adB);
        assert.equal(before.status, 200, JSON.stringify(before.body));
        assert.equal((await b.request(resolvePath, adB)).body.value, before.body.value, 'warm cache on B');
        const value = before.body.value === 20 ? 21 : 20;
        await ok('/settings/policies', ad, { orgUnitId: workshop.id, policyKey: 'CUTOFF_DAY', value, status: 'SIMULATION', decisionReference: 'CACHE-TEST-01', effectiveFrom: '2027-01-01' });
        const after = await b.request(resolvePath, adB);
        assert.equal(after.body.value, value); assert.equal(after.body.sourceOrgUnitId, workshop.id);
        const earlier = await b.request('/settings/policies/resolve?' + new URLSearchParams({ orgUnitId: team.id, asOf: '2026-12-31', policyKey: 'CUTOFF_DAY' }), adB);
        assert.equal(earlier.body.value, before.body.value, 'dates before the new version keep the old value');
      });

      await t.test('manual SQL on the org tree is visible to the next request on both instances', async () => {
        const kt = await login('kt.all');
        const ktB = (await b.request('/auth/login', null, { username: 'kt.all', password: password('kt.all') })).cookie;
        const name = (body) => body.units.find(unit => unit.id === team.id).name;
        const original = name(await ok('/organization/context', kt));
        assert.equal(name((await b.request('/organization/context', ktB)).body), original);
        await db.$executeRaw`UPDATE org_unit_version SET name = name || ' (đổi tên)' WHERE org_unit_id = ${team.id}::uuid AND effective_to IS NULL`;
        assert.equal(name(await ok('/organization/context', kt)), original + ' (đổi tên)');
        assert.equal(name((await b.request('/organization/context', ktB)).body), original + ' (đổi tên)');
        await db.$executeRaw`UPDATE org_unit_version SET name = ${original} WHERE org_unit_id = ${team.id}::uuid AND effective_to IS NULL`;
      });

      await t.test('API responses stay no-store and a revoked session fails on the next request', async () => {
        const kt = await login('kt.all');
        const response = await request('/organization/context', kt);
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        const account = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
        await ok('/auth/accounts/' + account.id + '/revoke', ad, {});
        assert.equal((await request('/organization/context', kt)).status, 401);
      });
    } finally { b.server.kill(); }
  });
});
