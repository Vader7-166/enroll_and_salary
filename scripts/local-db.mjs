import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const statePath = join(local, 'postgres.json');
const envPath = join(root, 'backend', '.env');
const { values, positionals } = parseArgs({ options: { bin: { type: 'string' } }, allowPositionals: true });
const command = positionals[0];
if (!['setup', 'start', 'stop', 'status'].includes(command)) {
  throw new Error('Usage: node scripts/local-db.mjs setup|start|stop|status [--bin PATH]');
}

function run(config, program, args, options = {}) {
  const executable = config.bin ? join(config.bin, program + (process.platform === 'win32' ? '.exe' : '')) : program;
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw new Error('Cannot run ' + program + '. Supply --bin with the PostgreSQL 18 bin directory. ' + result.error.message);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(program + ' failed: ' + result.stdout + result.stderr);
  }
  return result;
}

function isRunning(config) {
  const result = run(config, 'pg_ctl', ['status', '-D', config.data], { allowFailure: true });
  if (![0, 3].includes(result.status)) throw new Error('Cannot inspect the demo cluster: ' + result.stdout + result.stderr);
  return result.status === 0;
}

function start(config) {
  if (isRunning(config)) {
    console.log('Demo PostgreSQL is already running on 127.0.0.1:' + config.port);
    return;
  }
  // File-backed stdio prevents Windows postmaster handles from keeping a pipe open.
  const controlLog = openSync(join(local, 'postgres-control.log'), 'a');
  try {
    run(config, 'pg_ctl', ['start', '-D', config.data, '-l', join(local, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + config.port, '-w', '-t', '30'], { stdio: ['ignore', controlLog, controlLog] });
  } finally {
    closeSync(controlLog);
  }
  console.log('Demo PostgreSQL started on 127.0.0.1:' + config.port);
}

try {
  mkdirSync(local, { recursive: true });
  let config = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined;
  if (command === 'setup') {
    if (!config) {
      if (existsSync(envPath)) throw new Error('backend/.env already exists. It was not changed. Configure that database yourself, or move your own file before setting up a separate demo cluster.');
      const bin = values.bin ?? process.env.PG_BIN ?? '';
      config = { bin: bin ? resolve(bin) : '', data: join(local, 'pgdata'), port: 5433 };
      const version = run(config, 'postgres', ['--version']).stdout.trim();
      if (!/PostgreSQL\) 18\./.test(version)) throw new Error('PostgreSQL 18 is required; found ' + version);
      if (existsSync(config.data)) throw new Error('Unmanaged .local/pgdata exists; refusing to change it.');
      config.version = version;
      const password = randomBytes(24).toString('hex');
      const url = 'postgresql://hrtp_demo:' + password + '@127.0.0.1:5433/hrtp_demo?schema=public&connection_limit=5&connect_timeout=3&pool_timeout=3&socket_timeout=3';
      writeFileSync(envPath, 'DATABASE_URL="' + url + '"\nHOST=127.0.0.1\nPORT=3000\n', { flag: 'wx', mode: 0o600 });
      writeFileSync(statePath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    }
    const env = readFileSync(envPath, 'utf8');
    const match = /^DATABASE_URL="([^"\r\n]+)"/m.exec(env);
    if (!match) throw new Error('Managed backend/.env must contain a quoted DATABASE_URL.');
    const url = new URL(match[1]);
    if (url.hostname !== '127.0.0.1' || url.port !== String(config.port) || url.pathname !== '/hrtp_demo' || url.username !== 'hrtp_demo') {
      throw new Error('backend/.env no longer targets the managed demo cluster; refusing to modify it.');
    }
    const password = decodeURIComponent(url.password);
    if (!existsSync(join(config.data, 'PG_VERSION'))) {
      const passwordFile = join(local, 'initdb-password');
      writeFileSync(passwordFile, password, { flag: 'wx', mode: 0o600 });
      try {
        run(config, 'initdb', ['-D', config.data, '-U', 'hrtp_demo', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile=' + passwordFile]);
      } finally {
        rmSync(passwordFile, { force: true });
      }
    }
    start(config);
    const connection = ['-h', '127.0.0.1', '-p', String(config.port), '-U', 'hrtp_demo', '--no-password'];
    const dbEnv = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '3' };
    const found = run(config, 'psql', [...connection, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'hrtp_demo'"], { env: dbEnv });
    if (found.stdout.trim() !== '1') run(config, 'createdb', [...connection, 'hrtp_demo'], { env: dbEnv });
    if (!/^HR_DATA_KEY=/m.test(env)) {
      const query = sql => run(config, "psql", [...connection, "-d", "hrtp_demo", "-tAc", sql], { env: dbEnv }).stdout.trim();
      if (query("SELECT to_regclass('public.employment_contract') IS NOT NULL") === "t" && query("SELECT EXISTS (SELECT 1 FROM employment_contract)") === "t") {
        throw new Error("HR_DATA_KEY is missing but encrypted contracts exist. Restore the original key from backup; refusing to generate a replacement.");
      }
      writeFileSync(envPath, env.trimEnd() + "\nHR_DATA_KEY=" + randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
    }
    console.log(config.version + '; database hrtp_demo ready. Credentials are in ignored backend/.env.');
  } else {
    if (!config) throw new Error('No managed demo cluster. Run npm run db:setup -- --bin PATH first.');
    if (command === 'start') start(config);
    if (command === 'status') {
      const running = isRunning(config);
      console.log('Demo PostgreSQL: ' + (running ? 'running' : 'stopped') + ' (127.0.0.1:' + config.port + ')');
      if (!running) process.exitCode = 1;
    }
    if (command === 'stop') {
      if (isRunning(config)) run(config, 'pg_ctl', ['stop', '-D', config.data, '-m', 'fast', '-w', '-t', '30']);
      console.log('Demo PostgreSQL stopped. Existing Windows PostgreSQL service is unchanged.');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
