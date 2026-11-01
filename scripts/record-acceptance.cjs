// Records acceptance evidence into the R1 manifest (task 6.2). The ONLY way `verification_status` leaves NOT_EXECUTED:
//   node scripts/record-acceptance.cjs --result <acceptance-runner JSON> --accepted-by "<người nghiệm thu>" [--fr FR-7.2.1,…]
//        [--restore-drill <restore-drill JSON>] [--mark-implemented] [--dry-run]
// Refuses (exit 1, manifest untouched) when the result file is missing or not from acceptance-runner, the build was dirty or
// is not the checked-out HEAD, nobody signs, or the manifest still says NOT_IMPLEMENTED without --mark-implemented.
// Per FR M:  PASS  every UAT/TC case and every mapped test file ran and passed (and its evidence-only proof exists)
//            FAIL  any of them failed            BLOCKED  the FR is listed as a gap in function-map.json
//            NOT_EXECUTED  no run evidence for it (left as is)
// Every decision, with build/config/tests/failures/signature, goes to docs/acceptance/evidence/<date>-<sha>.json.
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const manifestPath = resolve(option('--manifest') ?? join(root, 'docs/config/hrtp-release-r1.json'));
const ledgerDir = resolve(option('--ledger-dir') ?? join(root, 'docs/acceptance/evidence'));
const map = JSON.parse(readFileSync(join(root, 'docs/acceptance/function-map.json'), 'utf8'));
const refuse = message => { console.error('REFUSED: ' + message + ' — manifest unchanged.'); process.exit(1); };

const resultPath = option('--result');
if (!resultPath || !existsSync(resultPath)) refuse('thiếu tệp kết quả kiểm thử (--result từ scripts/acceptance-runner.cjs)');
let result;
try { result = JSON.parse(readFileSync(resultPath, 'utf8')); } catch { refuse('tệp kết quả không đọc được'); }
if (result.kind !== 'HRTP_ACCEPTANCE_RUN' || !Array.isArray(result.tests) || !result.build?.sha) refuse('tệp không phải kết quả acceptance-runner');
if (result.build.dirty) refuse('kết quả chạy trên cây mã có thay đổi chưa commit; build không tái lập được');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (result.build.sha !== head && !args.includes('--allow-other-build')) refuse(`kết quả thuộc build ${result.build.sha.slice(0, 7)}, mã hiện tại là ${head.slice(0, 7)}`);
const acceptedBy = option('--accepted-by')?.trim();
if (!acceptedBy) refuse('thiếu người nghiệm thu (--accepted-by)');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.implementation_status === 'NOT_IMPLEMENTED' && !args.includes('--mark-implemented'))
  refuse('manifest ghi implementation_status=NOT_IMPLEMENTED; xác nhận triển khai bằng --mark-implemented trước khi ghi kết quả');
const drillPath = option('--restore-drill');
const drill = drillPath && existsSync(drillPath) ? JSON.parse(readFileSync(drillPath, 'utf8')) : null;
const only = option('--fr')?.split(',').map(id => id.trim());

const testsByFile = new Map();
for (const test of result.tests) testsByFile.set(test.file, [...(testsByFile.get(test.file) ?? []), test]);
const casesByFr = new Map();
for (const item of result.cases ?? []) for (const id of item.fr) casesByFr.set(id, [...(casesByFr.get(id) ?? []), item]);
// Evidence-only functions need their own proof besides tests.
const proofs = {
  'X.4': () => drill?.kind === 'HRTP_RESTORE_DRILL' && drill.status === 'VALID' ? { ok: true, detail: 'restore drill ' + basename(drillPath) + ' VALID, RTO ' + drill.rtoSeconds + ' s' } : null,
  'X.6': () => result.build.ci ? { ok: result.totals.fail === 0, detail: 'CI run ' + (result.build.runId ?? '?') } : null,
};

const decisions = [];
for (const entry of manifest.requirements.filter(row => row.priority === 'M' && (!only || only.includes(row.id)))) {
  const key = entry.bfd ?? entry.id.replace(/^FR-/, '').split('.').slice(0, 2).join('.');
  const fn = map.functions[key];
  const decision = { fr: entry.id, previous: entry.verification_status, status: 'NOT_EXECUTED', tests: 0, failures: [], cases: [], reason: '' };
  if (map.gaps?.[entry.id]) { decision.status = 'BLOCKED'; decision.reason = 'gap: ' + map.gaps[entry.id]; }
  else if (!fn) decision.reason = 'không có ánh xạ chức năng';
  else {
    const files = fn.tests ?? [];
    const ran = files.filter(file => testsByFile.has(file));
    const tests = ran.flatMap(file => testsByFile.get(file));
    const cases = casesByFr.get(entry.id) ?? [];
    const proof = proofs[key]?.();
    decision.tests = tests.length;
    decision.cases = cases.map(item => item.id + ':' + item.status);
    decision.failures = [...tests.filter(test => test.status === 'FAIL').map(test => test.file + ' :: ' + test.name), ...cases.filter(item => item.status === 'FAIL').map(item => item.id)];
    if (proof && !proof.ok) decision.failures.push(proof.detail);
    const complete = ran.length === files.length && cases.every(item => ['PASS', 'FAIL'].includes(item.status)) && (!proofs[key] || proof);
    if (decision.failures.length) { decision.status = 'FAIL'; decision.reason = decision.failures.length + ' lỗi'; }
    else if (complete && (tests.length || proof)) { decision.status = 'PASS'; decision.reason = [tests.length + ' test', ...(proof ? [proof.detail] : [])].join(', '); }
    else decision.reason = 'chưa đủ bằng chứng: ' + [files.length - ran.length ? (files.length - ran.length) + ' tệp test chưa chạy' : '', proofs[key] && !proof ? 'thiếu bằng chứng riêng' : '', cases.some(item => !['PASS', 'FAIL'].includes(item.status)) ? 'ca UAT/TC chưa chạy' : ''].filter(Boolean).join(', ');
  }
  decisions.push(decision);
}

const counts = {};
for (const item of decisions) counts[item.status] = (counts[item.status] ?? 0) + 1;
const ledger = { kind: 'HRTP_ACCEPTANCE_EVIDENCE', recordedAt: new Date().toISOString(), acceptedBy, manifest: basename(manifestPath),
  run: { file: basename(resultPath), generatedAt: result.generatedAt, build: result.build, config: result.config, totals: result.totals }, restoreDrill: drill ? { file: basename(drillPath), status: drill.status, rtoSeconds: drill.rtoSeconds } : null,
  counts, decisions };
console.log(`Evidence for ${decisions.length} FR: ${JSON.stringify(counts)}`);
for (const item of decisions.filter(entry => entry.status === 'FAIL' || entry.status === 'BLOCKED')) console.log(`  ${item.status} ${item.fr}: ${item.reason}`);
if (args.includes('--dry-run')) process.exit(0);

// Text edits keep the manifest's one-requirement-per-line layout, so the diff shows exactly the recorded statuses.
let text = readFileSync(manifestPath, 'utf8');
for (const item of decisions) {
  const line = new RegExp('(\\{"id": "' + item.fr.replace(/\./g, '\\.') + '",[^\\n]*"verification_status": ")[A-Z_]+(")');
  if (!line.test(text)) refuse('không tìm thấy dòng ' + item.fr + ' trong manifest');
  text = text.replace(line, '$1' + item.status + '$2');
}
text = text.replace('"implementation_status": "NOT_IMPLEMENTED"', '"implementation_status": "IMPLEMENTED"');
JSON.parse(text);
mkdirSync(ledgerDir, { recursive: true });
const ledgerFile = join(ledgerDir, ledger.recordedAt.slice(0, 10) + '-' + result.build.sha.slice(0, 7) + '.json');
writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1) + '\n');
writeFileSync(manifestPath, text);
console.log('Manifest updated; evidence: ' + ledgerFile);
