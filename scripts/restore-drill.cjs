// Restore drill (FR-X.4, RTO ≤ 4 h): decrypt a backup from deploy/backup/backup.sh, restore it into a brand-new database,
// then prove it is usable: migrations complete, audit hash chain intact, every locked payroll snapshot and attendance
// lock still matches its stored hash. Writes a JSON result and a filled-in drill record (docs/acceptance/restore-drill-template.md).
//   node scripts/restore-drill.cjs [--file backups/hrtp-….dump.enc] [--keep] [--out-dir .local/restore-drills]
// Without --file the newest backup in BACKUP_DIR (default ./backups) is used.
// Env: BACKUP_ENCRYPTION_KEY (backup key), HR_DATA_KEY (+ HR_DATA_KEYS) to open snapshots, DATABASE_URL for the server the
// clean database is created on (the role needs CREATEDB), RESTORE_DRILL_OPERATOR for the record.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');
const os = require('node:os');

const root = resolve(__dirname, '..');
const envFile = join(root, 'backend/.env');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
const { PrismaClient } = require('@prisma/client');
const { auditRecordHash } = require('../backend/dist/audit/audit.service.js');
const { plainText } = require('../backend/dist/common/data-crypto.js');
const { sha256 } = require('../backend/dist/payroll/payroll-engine.js');

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const RTO_SECONDS = 4 * 3600;

// Same canonical form as AttendancePeriodLockService (keys sorted, Dates as ISO strings).
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => JSON.stringify(name) + ':' + canonical(item)).join(',') + '}';
}

/** libpq takes host/port/user/database; the password goes through PGPASSWORD, never the command line. */
function pgEnv(url) {
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) };
}
function run(command, commandArgs, env) {
  const result = spawnSync(command, commandArgs, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(command + ' failed: ' + (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 2000));
  return result.stdout;
}

async function main() {
  const backupDir = resolve(process.env.BACKUP_DIR ?? join(root, 'backups'));
  const file = option('--file') ? resolve(option('--file'))
    : (() => { const names = existsSync(backupDir) ? readdirSync(backupDir).filter(name => /^hrtp-\d{8}T\d{6}Z\.dump\.enc$/.test(name)).sort() : []; return names.length ? join(backupDir, names.at(-1)) : null; })();
  if (!file || !existsSync(file)) throw new Error('No backup file found (use --file or BACKUP_DIR).');
  if (!process.env.BACKUP_ENCRYPTION_KEY) throw new Error('BACKUP_ENCRYPTION_KEY is required.');
  const outDir = resolve(option('--out-dir') ?? join(root, '.local/restore-drills'));
  const started = Date.now();
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'VALID' : 'FAILED', detail }); return ok; };

  const sidecar = file + '.sha256';
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (existsSync(sidecar)) check('backup-file-sha256', readFileSync(sidecar, 'utf8').split(/\s+/)[0] === digest, digest);

  const work = join(os.tmpdir(), 'hrtp-restore-' + process.pid);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const dump = join(work, 'restore.dump');
  const source = new URL(process.env.DATABASE_URL);
  const target = new URL(source);
  const name = 'hrtp_restore_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '_' + process.pid;
  target.pathname = '/' + name;
  target.searchParams.set('socket_timeout', '600');
  const admin = new PrismaClient();
  let restored = null, timings = {};
  try {
    let at = Date.now();
    run('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-pass', 'env:BACKUP_ENCRYPTION_KEY', '-in', file, '-out', dump], process.env);
    timings.decryptSeconds = (Date.now() - at) / 1000;
    at = Date.now();
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', name, dump], pgEnv(target));
    timings.restoreSeconds = (Date.now() - at) / 1000;

    at = Date.now();
    restored = new PrismaClient({ datasourceUrl: target.href });
    const migrations = readdirSync(join(root, 'backend/prisma/migrations')).filter(entry => /^\d{14}_/.test(entry));
    const applied = await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    check('migrations', applied[0].n === migrations.length, applied[0].n + ' / ' + migrations.length + ' migrations applied');

    let expectedPrev = '0'.repeat(64), cursor = null, audited = 0, broken = null;
    for (;;) {
      const batch = await restored.auditLog.findMany({ where: cursor === null ? {} : { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: 2000 });
      if (!batch.length) break;
      for (const row of batch) {
        audited++;
        if (row.prevHash !== expectedPrev) { broken = row.id + ' CHAIN_BROKEN'; break; }
        if (auditRecordHash(row) !== row.recordHash) { broken = row.id + ' HASH_MISMATCH'; break; }
        expectedPrev = row.recordHash;
      }
      if (broken) break;
      cursor = batch.at(-1).id;
    }
    check('audit-hash-chain', !broken && audited > 0, broken ? 'broken at #' + broken : audited + ' records');

    const v1 = Buffer.from(process.env.HR_DATA_KEY ?? '', 'base64');
    const snapshots = await restored.payrollSnapshot.findMany({ select: { id: true, contentCipher: true, contentHash: true } });
    const badSnapshots = snapshots.filter(row => { try { return sha256(JSON.parse(plainText(v1, row.contentCipher, 'snapshot bảng lương'))) !== row.contentHash; } catch { return true; } });
    check('payroll-snapshot-hashes', !badSnapshots.length, snapshots.length + ' snapshot(s)' + (badSnapshots.length ? ', mismatched: ' + badSnapshots.map(row => row.id).join(', ') : ''));

    const locks = await restored.attendancePeriodLockEvent.findMany({ where: { action: 'LOCK' }, select: { id: true, sourceHash: true, snapshot: true } });
    const badLocks = locks.filter(row => createHash('sha256').update(canonical(row.snapshot)).digest('hex') !== row.sourceHash);
    check('attendance-lock-hashes', !badLocks.length, locks.length + ' locked period(s)' + (badLocks.length ? ', mismatched: ' + badLocks.map(row => row.id).join(', ') : ''));

    const counts = {};
    for (const table of ['employee', 'daily_attendance', 'payroll_sheet', 'payroll_snapshot', 'audit_log']) counts[table] = (await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
    timings.verifySeconds = (Date.now() - at) / 1000;

    const seconds = (Date.now() - started) / 1000;
    check('rto', seconds <= RTO_SECONDS, seconds.toFixed(1) + ' s (limit ' + RTO_SECONDS + ' s)');
    const status = checks.every(item => item.status === 'VALID') ? 'VALID' : 'FAILED';
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() || null;
    const operator = process.env.RESTORE_DRILL_OPERATOR || spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' }).stdout.trim() || os.userInfo().username;
    const report = { kind: 'HRTP_RESTORE_DRILL', status, performedAt: new Date().toISOString(), operator, build: sha, backup: { file: basename(file), bytes: readFileSync(file).length, sha256: digest },
      restoredDatabase: args.includes('--keep') ? name : name + ' (dropped)', rtoSeconds: Number(seconds.toFixed(1)), timings, counts, checks,
      machine: { node: process.version, platform: process.platform + ' ' + os.release(), cpu: os.cpus()[0]?.model, postgresClient: run('pg_restore', ['--version'], process.env).trim() } };
    mkdirSync(outDir, { recursive: true });
    const stem = join(outDir, 'restore-drill-' + report.performedAt.replace(/[:.]/g, '-'));
    writeFileSync(stem + '.json', JSON.stringify(report, null, 1));
    const template = readFileSync(join(root, 'docs/acceptance/restore-drill-template.md'), 'utf8');
    const filled = template.replace(/\{\{(\w+)\}\}/g, (_, key) => ({
      status: status === 'VALID' ? 'ĐẠT' : 'KHÔNG ĐẠT', performedAt: report.performedAt, operator, build: sha ?? '—', backupFile: report.backup.file, backupSha: digest, backupBytes: String(report.backup.bytes),
      rto: String(report.rtoSeconds), decrypt: String(timings.decryptSeconds), restore: String(timings.restoreSeconds), verify: String(timings.verifySeconds),
      checks: checks.map(item => `| ${item.name} | ${item.status === 'VALID' ? 'Đạt' : '**Không đạt**'} | ${item.detail} |`).join('\n'),
      counts: Object.entries(counts).map(([table, n]) => `| ${table} | ${n} |`).join('\n'), machine: `${report.machine.platform}, ${report.machine.cpu}, Node ${report.machine.node}, ${report.machine.postgresClient}`,
    })[key] ?? '');
    writeFileSync(stem + '.md', filled);
    console.log(JSON.stringify({ status, rtoSeconds: report.rtoSeconds, checks: checks.map(item => item.name + ':' + item.status), record: stem + '.md' }));
    if (status !== 'VALID') process.exitCode = 1;
  } finally {
    await restored?.$disconnect();
    if (!args.includes('--keep')) await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)').catch(() => {});
    await admin.$disconnect();
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
