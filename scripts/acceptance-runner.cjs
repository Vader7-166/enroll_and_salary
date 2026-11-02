// Acceptance runner (FR-X.6): runs the automated suites behind UAT-01…28 + UAT-05b and the fixed TC set, then writes
// a JSON result with every test, every acceptance case, the FR it proves, the build SHA and the configuration.
//   node scripts/acceptance-runner.cjs            only the test files the acceptance map references
//   node scripts/acceptance-runner.cjs --all      every backend/test/*.test.cjs (full regression, same report)
//   ACCEPTANCE_CONCURRENCY=4 …                    parallel test files (each one builds its own database)
//   --files a.test.cjs,b.test.cjs                  a subset (cases outside it report NOT_RUN)
//   --out <file>                                  result path (default .local/acceptance/<sha>-<time>.json + latest.json)
// Exit code 1 when a test fails, or when a mapped test name no longer matches anything (the map drifted from the tests).
// Needs `npm run build --workspace backend` and a reachable PostgreSQL, like every integration test.
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');
const os = require('node:os');

const root = resolve(__dirname, '..');
const testDir = join(root, 'backend/test');
const map = JSON.parse(readFileSync(join(root, 'docs/acceptance/acceptance-map.json'), 'utf8'));
const args = process.argv.slice(2);
const all = args.includes('--all');
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const concurrency = Number(process.env.ACCEPTANCE_CONCURRENCY ?? 2);

const git = (...command) => { const result = spawnSync('git', command, { cwd: root, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : null; };
const only = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : null;
const files = only ?? (all
  ? readdirSync(testDir).filter(name => name.endsWith('.test.cjs')).sort()
  : [...new Set(map.cases.flatMap(item => item.tests.map(test => test.file)))].sort());

// Results come from scripts/acceptance-reporter.cjs (file + parent per test). The built-in JUnit reporter only records
// the test file on Node ≥ 23, so on the pinned Node 22 nothing matched the map.
const resultPath = join(os.tmpdir(), 'hrtp-acceptance-' + process.pid + '.jsonl');
const started = Date.now();
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=' + concurrency, '--test-reporter=' + join(__dirname, 'acceptance-reporter.cjs'), '--test-reporter-destination=' + resultPath,
  '--test-reporter=spec', '--test-reporter-destination=stdout', ...files.map(name => join(testDir, name))], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
const durationMs = Date.now() - started;

let lines = [];
try { lines = readFileSync(resultPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch {}
rmSync(resultPath, { force: true });
const tests = [];
for (const result of lines) {
  const file = basename(result.file ?? '');
  // Leaves are the mapped tests. A parent only matters when its own body (setup, cleanup, server start) failed after
  // its subtests: it becomes a SUITE failure that fails every case in the same file.
  // A file that fails to load reports one failure named after the file itself: treat it like a failed suite body.
  const fileFailure = result.status === 'FAIL' && !result.parent && result.file && basename(result.name) === file;
  if (!result.children && !fileFailure) tests.push({ file, suite: result.parent, name: result.name, status: result.status, durationMs: result.durationMs });
  else if (result.status === 'FAIL') tests.push({ file, suite: null, name: result.name, status: 'FAIL', durationMs: result.durationMs, level: 'SUITE' });
}

const cases = map.cases.map(item => {
  // A failed suite body (setup/cleanup) makes every case in that file fail too.
  const matched = item.tests.map(ref => ({ ...ref, results: tests.filter(test => test.file === ref.file && (test.name.includes(ref.name) || (test.suite ?? '').includes(ref.name) || test.level === 'SUITE')) }));
  const flat = matched.flatMap(ref => ref.results);
  const status = !item.tests.length ? 'NOT_AUTOMATED'
    : matched.some(ref => !files.includes(ref.file)) ? 'NOT_RUN'
    : matched.some(ref => !ref.results.length) ? 'MAP_DRIFT'
    : flat.some(test => test.status === 'FAIL') ? 'FAIL'
    : flat.every(test => test.status === 'PASS') ? 'PASS' : 'INCOMPLETE';
  return { id: item.id, title: item.title, group: item.group, fr: item.fr, status, tests: flat.map(test => ({ file: test.file, name: test.name, status: test.status })),
    unmatched: matched.filter(ref => !ref.results.length).map(ref => ref.file + ' :: ' + ref.name) };
});
const fr = {};
for (const item of cases) for (const id of item.fr) {
  const order = ['FAIL', 'MAP_DRIFT', 'NOT_RUN', 'INCOMPLETE', 'NOT_AUTOMATED', 'PASS'];
  fr[id] = fr[id] && order.indexOf(fr[id]) < order.indexOf(item.status) ? fr[id] : item.status;
}

async function postgresVersion() {
  try {
    process.loadEnvFile?.(join(root, 'backend/.env'));
  } catch {}
  try {
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    const [row] = await db.$queryRawUnsafe('SHOW server_version');
    await db.$disconnect();
    return row.server_version;
  } catch { return null; }
}

(async () => {
  const sha = git('rev-parse', 'HEAD');
  const count = status => tests.filter(test => test.status === status).length;
  const caseCount = status => cases.filter(item => item.status === status).length;
  const report = {
    kind: 'HRTP_ACCEPTANCE_RUN', version: 1, generatedAt: new Date().toISOString(), durationMs,
    build: { sha, shortSha: sha?.slice(0, 7) ?? null, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), ci: Boolean(process.env.CI), runId: process.env.GITHUB_RUN_ID ?? null },
    config: { node: process.version, platform: process.platform + ' ' + os.release(), postgres: await postgresVersion(), concurrency, mode: all ? 'ALL_SUITES' : 'ACCEPTANCE_SUITES', files,
      flags: { COMP_TIME_ENABLED: 'false (DEC-01, migrated parameter)', GEMINI: process.env.GEMINI_API_KEY ? 'configured' : 'stub only' } },
    totals: { tests: tests.length, pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), runnerExit: run.status,
      cases: cases.length, casesPass: caseCount('PASS'), casesFail: caseCount('FAIL'), casesNotAutomated: caseCount('NOT_AUTOMATED'), casesDrift: caseCount('MAP_DRIFT'), casesNotRun: caseCount('NOT_RUN') },
    cases, fr, tests,
  };
  const dir = join(root, '.local/acceptance');
  mkdirSync(dir, { recursive: true });
  const out = outArg ? resolve(outArg) : join(dir, (report.build.shortSha ?? 'nogit') + '-' + report.generatedAt.replace(/[:.]/g, '-') + '.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  if (!outArg) writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 1));
  console.log(`\nAcceptance: ${report.totals.pass}/${report.totals.tests} tests pass, ${report.totals.fail} fail · cases PASS ${report.totals.casesPass}/${cases.length}, FAIL ${report.totals.casesFail}, not automated ${report.totals.casesNotAutomated}, drift ${report.totals.casesDrift}`);
  for (const item of cases.filter(entry => !['PASS', 'NOT_AUTOMATED', 'NOT_RUN'].includes(entry.status))) console.log(`  ${item.status} ${item.id} ${item.title}${item.unmatched.length ? ' — unmatched: ' + item.unmatched.join('; ') : ''}`);
  console.log('Result: ' + out);
  if (run.status !== 0 || report.totals.fail || report.totals.casesDrift) process.exitCode = 1;
})();
