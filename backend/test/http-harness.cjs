// Isolated PostgreSQL database + migrated/seeded schema + real API server, shared by the integration tests.
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

/**
 * Drops an isolated test database. DROP … WITH (FORCE) can outlast the 3 s socket timeout of DATABASE_URL while other
 * suites run in parallel, so this uses its own connection with a long timeout and retries before reporting the error.
 */
async function dropDatabase(name) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('socket_timeout', '120');
  const client = new PrismaClient({ datasourceUrl: url.href });
  try {
    for (let attempt = 1; ; attempt++) {
      try { await client.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)'); return; }
      catch (error) { if (attempt === 3) throw error; await new Promise(done => setTimeout(done, 1000 * attempt)); }
    }
  } finally { await client.$disconnect(); }
}

async function withServer(prefix, work, options = {}) {
  const name = 'hrtp_' + prefix + '_' + randomUUID().replaceAll('-', '');
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
    let port;
    /** Starts (or restarts, e.g. with a rotated key ring) the API server on the same database. */
    async function start(extra = {}) {
      if (server) { const stopped = new Promise(done => server.once('exit', done)); server.kill(); await stopped; }
      const listener = net.createServer();
      await new Promise(done => listener.listen(0, '127.0.0.1', done));
      port = listener.address().port;
      await new Promise(done => listener.close(done));
      server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, ...(options.env ?? {}), ...extra, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.on('data', chunk => { logs += chunk; });
      server.stderr.on('data', chunk => { logs += chunk; });
      const current = server;
      await new Promise((ready, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server startup timed out\n' + logs)), 20000);
        const exited = code => { clearTimeout(timeout); reject(new Error('Server exited ' + code + '\n' + logs)); };
        current.once('exit', exited);
        const poll = async () => {
          try { if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok) { clearTimeout(timeout); current.off('exit', exited); ready(); return; } } catch {}
          setTimeout(poll, 100);
        };
        poll();
      });
    }
    await start();
    async function request(path, cookie, body, method) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get('content-type') || '';
      return { status: response.status, headers: response.headers,
        body: type.includes('application/json') ? await response.json() : type.includes('text') ? await response.text() : Buffer.from(await response.arrayBuffer()),
        cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body, method) {
      const result = await request(path, cookie, body, method);
      assert.ok(result.status >= 200 && result.status < 300, path + ' ' + result.status + ' ' + JSON.stringify(result.body) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    const password = username => credentials.find(account => account.username === username).password;
    async function login(username, secret = password(username)) {
      const result = await request('/auth/login', null, { username, password: secret });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return result.cookie;
    }
    /** Adds an account with one role assignment, reusing a seeded account's password hash. */
    async function account(username, roleCode, scopeCode, like = 'ad.demo') {
      const source = await db.userAccount.findUniqueOrThrow({ where: { username: like } });
      const scope = await db.orgUnit.findUniqueOrThrow({ where: { code: scopeCode }, include: { versions: { orderBy: { effectiveFrom: 'asc' }, take: 1 } } });
      await db.userAccount.create({ data: { username, displayName: username, passwordHash: source.passwordHash,
        assignments: { create: { roleCode, scopeOrgUnitId: scope.id, effectiveFrom: scope.versions[0].effectiveFrom } } } });
      return login(username, password(like));
    }
    return await work({ db, request, ok, login, password, account, logs: () => logs, url: url.href, env, restart: start });
  } finally {
    server?.kill();
    await db?.$disconnect();
    await dropDatabase(name);
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
}

const day = value => new Date(value + 'T00:00:00.000Z');
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (value, days) => { const date = day(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

module.exports = { withServer, dropDatabase, day, today, addDays };
