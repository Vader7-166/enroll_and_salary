// Task 6.2: verification_status changes only through real run evidence; every refusal leaves the manifest untouched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');

const root = resolve(__dirname, '../..');
const script = join(root, 'scripts/record-acceptance.cjs');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const status = (manifest, id) => JSON.parse(readFileSync(manifest, 'utf8')).requirements.find(row => row.id === id).verification_status;

function fixture() {
  const dir = mkdtempSync(join(os.tmpdir(), 'hrtp-record-'));
  const manifest = join(dir, 'manifest.json');
  copyFileSync(join(root, 'docs/config/hrtp-release-r1.json'), manifest);
  const write = (name, value) => { writeFileSync(join(dir, name), JSON.stringify(value)); return join(dir, name); };
  const run = (...extra) => spawnSync(process.execPath, [script, '--manifest', manifest, '--ledger-dir', join(dir, 'ledger'), ...extra], { encoding: 'utf8' });
  const result = (overrides = {}) => ({ kind: 'HRTP_ACCEPTANCE_RUN', generatedAt: new Date().toISOString(), build: { sha: head, dirty: false, ci: false }, config: { node: process.version }, totals: { fail: 1 },
    tests: [
      { file: 'payroll-engine.test.cjs', name: 'TC-I01', status: 'PASS' }, { file: 'payroll-run.test.cjs', name: 'run', status: 'PASS' },
      { file: 'payroll-lock.test.cjs', name: 'lock', status: 'FAIL' },
      { file: 'leave-requests.test.cjs', name: 'leave', status: 'PASS' },
    ],
    cases: [{ id: 'TC-K06', fr: ['FR-7.2.1'], status: 'PASS' }], ...overrides });
  return { dir, manifest, write, run, result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Without a result file, a dirty build, another build or a signature, nothing is recorded', () => {
  const f = fixture();
  try {
    const before = readFileSync(f.manifest, 'utf8');
    const cases = [
      [['--fr', 'FR-7.2.1', '--accepted-by', 'KT', '--mark-implemented'], /thiếu tệp kết quả/],
      [['--result', f.write('dirty.json', f.result({ build: { sha: head, dirty: true } })), '--accepted-by', 'KT', '--mark-implemented'], /chưa commit/],
      [['--result', f.write('other.json', f.result({ build: { sha: '0'.repeat(40), dirty: false } })), '--accepted-by', 'KT', '--mark-implemented'], /thuộc build 0000000/],
      [['--result', f.write('unsigned.json', f.result()), '--mark-implemented'], /người nghiệm thu/],
      [['--result', f.write('notimpl.json', f.result()), '--accepted-by', 'KT'], /NOT_IMPLEMENTED/],
      [['--result', f.write('fake.json', { kind: 'SOMETHING', tests: [] }), '--accepted-by', 'KT', '--mark-implemented'], /không phải kết quả/],
    ];
    for (const [args, message] of cases) {
      const outcome = f.run(...args);
      assert.equal(outcome.status, 1, args.join(' '));
      assert.match(outcome.stderr, message);
    }
    assert.equal(readFileSync(f.manifest, 'utf8'), before);
    assert.equal(status(f.manifest, 'FR-7.2.1'), 'NOT_EXECUTED');
  } finally { f.cleanup(); }
});

test('Real evidence records PASS, FAIL, BLOCKED and leaves unproven FRs NOT_EXECUTED with a signed ledger', () => {
  const f = fixture();
  try {
    const before = readFileSync(f.manifest, 'utf8');
    const outcome = f.run('--result', f.write('run.json', f.result()), '--accepted-by', 'Kế toán nghiệm thu', '--mark-implemented', '--fr', 'FR-7.2.1,FR-7.5.1,FR-2.1.3,FR-6.3.3,FR-X.4');
    assert.equal(outcome.status, 0, outcome.stderr + outcome.stdout);
    assert.equal(status(f.manifest, 'FR-7.2.1'), 'PASS', 'engine + run files and TC-K06 passed');
    assert.equal(status(f.manifest, 'FR-7.5.1'), 'FAIL', 'payroll-lock failed');
    assert.equal(status(f.manifest, 'FR-2.1.3'), 'BLOCKED', 'listed gap');
    assert.equal(status(f.manifest, 'FR-6.3.3'), 'PASS');
    assert.equal(status(f.manifest, 'FR-X.4'), 'NOT_EXECUTED', 'no restore drill evidence');
    assert.equal(status(f.manifest, 'FR-1.1.1'), 'NOT_EXECUTED', 'outside --fr');
    const changed = readFileSync(f.manifest, 'utf8').split('\n').filter((line, index) => line !== before.split('\n')[index]);
    assert.equal(changed.length, 5, 'only the implementation status line and four FR lines change');
    const [ledgerFile] = readdirSync(join(f.dir, 'ledger'));
    const ledger = JSON.parse(readFileSync(join(f.dir, 'ledger', ledgerFile), 'utf8'));
    assert.equal(ledger.acceptedBy, 'Kế toán nghiệm thu');
    assert.equal(ledger.run.build.sha, head);
    assert.deepEqual(ledger.decisions.find(item => item.fr === 'FR-7.5.1').failures, ['payroll-lock.test.cjs :: lock']);
    const scope = spawnSync('python3', ['-c', `import json,sys; d=json.load(open(sys.argv[1])); assert d['implementation_status']=='IMPLEMENTED'`, f.manifest]);
    assert.equal(scope.status, 0);
  } finally { f.cleanup(); }
});
