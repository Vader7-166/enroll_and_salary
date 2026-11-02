// Nightly NFR-07…NFR-13 benchmark (task 3.3): runs every benchmark script, keeps its JSON line, and writes one
// report with the machine configuration to .local/benchmarks/<date>-<sha>.json (+ latest.json).
// A threshold miss marks that NFR FAIL and makes the run exit 1. NFR-11 comes from the payroll run suite's drill-down subtest.
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');

const root = resolve(__dirname, '..');
const run = (script, args = []) => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8', env: process.env, timeout: 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  // The scripts print one JSON object (single or multi line) as their result; take the last one.
  let data = null;
  const start = result.stdout?.lastIndexOf('\n{') ?? -1;
  for (const candidate of [result.stdout?.slice(start + 1), result.stdout?.slice(result.stdout.indexOf('{'))]) {
    try { data = JSON.parse(candidate); break; } catch {}
  }
  return { script, exit: result.status, seconds: (Date.now() - started) / 1000, data, tail: output.trim().split('\n').slice(-6).join('\n') };
};

const runs = {
  payroll: run('benchmark-payroll-engine.cjs', ['3000']),
  attendance: run('benchmark-attendance.cjs', ['2500']),
  // Shift plans approved for two whole periods (add-caching-layer): every import reprocesses them all.
  attendanceMonth: run('benchmark-attendance-month.cjs', ['1100']),
  payslips: run('benchmark-payslips.cjs'),
  reports: run('benchmark-reports.cjs', ['3000']),
};
// NFR-11 is measured inside the payroll run suite (it needs a computed sheet with traced lines).
const drill = (() => {
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--test', join(root, 'backend/test/payroll-run.test.cjs')], { cwd: root, encoding: 'utf8', env: process.env, timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const line = (result.stdout ?? '').split('\n').find(text => text.includes('NFR11_RESULT '));
  return { script: 'backend/test/payroll-run.test.cjs (NFR-11 subtest)', exit: result.status, seconds: (Date.now() - started) / 1000, data: line ? JSON.parse(line.slice(line.indexOf('NFR11_RESULT ') + 13)) : null };
})();
runs.drilldown = drill;
const status = (ok, measured = true) => !measured ? 'NOT_MEASURED' : ok ? 'PASS' : 'FAIL';
const a = runs.attendance.data;
const nfr = {
  'NFR-07': { limit: '≤ 15 phút / 3.000 NV / 4 cơ sở (engine, không gồm DB)', measured: runs.payroll.data?.seconds + ' s', status: status(runs.payroll.exit === 0 && runs.payroll.data?.passEngineOnly, Boolean(runs.payroll.data)) },
  'NFR-08': { limit: '≤ 5 phút / tệp một ngày ≈ 4.500 lượt', measured: a ? a.nfr08.ms + ' ms' : null, status: status(a?.nfr08.pass, Boolean(a)) },
  'NFR-08b': { limit: '≤ 60 s / một ngày quẹt 1.100 NV khi lịch ca đã duyệt cả hai kỳ (lần đầu và lần sau)', measured: runs.attendanceMonth.data ? `lần đầu ${runs.attendanceMonth.data.firstImport.ms} ms · lần sau ${runs.attendanceMonth.data.secondImport.ms} ms` : null, status: status(runs.attendanceMonth.exit === 0 && runs.attendanceMonth.data?.pass, Boolean(runs.attendanceMonth.data)) },
  'NFR-09': { limit: 'p95 ≤ 2 s (tổ) · ≤ 4 s (xưởng)', measured: a ? `${a.nfr09.teamP95Ms} / ${a.nfr09.workshopP95Ms} ms` : null, status: status(a?.nfr09.pass, Boolean(a)) },
  'NFR-10': { limit: '≤ 10 phút / 1.100 phiếu', measured: runs.payslips.data?.seconds + ' s', status: status(runs.payslips.exit === 0, Boolean(runs.payslips.data)) },
  'NFR-11': { limit: 'p95 ≤ 3 s drill-down một dòng lương', measured: drill.data ? `p95 ${drill.data.p95Ms} ms / ${drill.data.samples} lần (bảng lương kiểm thử)` : null, status: status(drill.data && drill.data.p95Ms <= drill.data.limitMs, Boolean(drill.data)) },
  'NFR-12': { limit: '≤ 2 phút báo cáo tháng 3.000 NV', measured: runs.reports.exit === 0 ? runs.reports.tail.split('\n').find(line => line.includes('ATTENDANCE_MONTHLY')) ?? null : null, status: status(runs.reports.exit === 0) },
  'NFR-13': { limit: '≤ 1 phút kiểm tra + trả kết quả tệp 10.000 dòng', measured: a ? `kiểm tra ${a.nfr13.validationRejectMs} ms · nhập + ghép đầy đủ ${a.nfr13.fullImportMs} ms` : null, status: status(a?.nfr13.pass, Boolean(a)) },
};
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() || null;
const report = {
  kind: 'HRTP_NIGHTLY_BENCHMARK', generatedAt: new Date().toISOString(), build: { sha, ci: Boolean(process.env.CI), runId: process.env.GITHUB_RUN_ID ?? null },
  machine: { node: process.version, platform: process.platform + ' ' + os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Number((os.totalmem() / 2 ** 30).toFixed(1)) },
  nfr, runs,
};
const dir = join(root, '.local/benchmarks');
mkdirSync(dir, { recursive: true });
const file = join(dir, report.generatedAt.slice(0, 10) + '-' + (sha?.slice(0, 7) ?? 'nogit') + '.json');
writeFileSync(file, JSON.stringify(report, null, 1));
writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 1));
for (const [id, row] of Object.entries(nfr)) console.log(`${id} ${row.status.padEnd(12)} ${row.measured ?? '—'}  (${row.limit})`);
console.log('Report: ' + file);
if (Object.values(nfr).some(row => row.status === 'FAIL')) process.exitCode = 1;
