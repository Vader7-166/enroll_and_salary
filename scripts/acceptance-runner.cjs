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

const xmlPath = join(os.tmpdir(), 'hrtp-acceptance-' + process.pid + '.xml');
// JUnit drops a parent test whose own body fails after passing subtests (failures="0"); TAP keeps it as `not ok`.
const tapPath = join(os.tmpdir(), 'hrtp-acceptance-' + process.pid + '.tap');
const started = Date.now();
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=' + concurrency, '--test-reporter=junit', '--test-reporter-destination=' + xmlPath,
  '--test-reporter=tap', '--test-reporter-destination=' + tapPath, '--test-reporter=spec', '--test-reporter-destination=stdout', ...files.map(name => join(testDir, name))], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
const durationMs = Date.now() - started;

const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (tag, name) => { const match = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return match ? unescape(match[1]) : null; };
let xml = '';
try { xml = readFileSync(xmlPath, 'utf8'); } catch {}
rmSync(xmlPath, { force: true });
const tests = [];
for (const match of xml.matchAll(/<(testcase|testsuite)\s[^>]*>/g)) {
  const tag = match[0];
  if (match[1] === 'testsuite') continue;
  const rest = xml.slice(match.index + tag.length, match.index + tag.length + 200);
  const skipped = !tag.endsWith('/>') && /^\s*<skipped/.test(rest);
  tests.push({ file: basename(attr(tag, 'file') ?? ''), suite: attr(tag, 'classname'), name: attr(tag, 'name'),
    status: attr(tag, 'failure') !== null ? 'FAIL' : skipped ? 'SKIP' : 'PASS', durationMs: Math.round(Number(attr(tag, 'time') ?? 0) * 1000) });
}
let tap = '';
try { tap = readFileSync(tapPath, 'utf8'); } catch {}
rmSync(tapPath, { force: true });
for (const match of tap.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)) {
  const name = match[1].trim();
  if (tests.some(test => test.name === name && test.status === 'FAIL')) continue;
  // A suite-level failure (setup, cleanup, server start): attribute it to the file of its subtests.
  const child = tests.find(test => test.suite === name);
  tests.push({ file: child?.file ?? '', suite: null, name, status: 'FAIL', durationMs: 0, level: 'SUITE' });
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
