// Builds docs/acceptance/fr-coverage.md: every M requirement of the R1 manifest → BFD function → modules/changes →
// automated test files (and how many test cases they hold) → direct FR mentions → open gaps.
// Evidence only: a row being mapped does not change `verification_status`; that is scripts/record-acceptance.cjs's job.
//   node scripts/fr-coverage.cjs           write the table
//   node scripts/fr-coverage.cjs --check   exit 1 when an M requirement has no function or no existing test file
const { readFileSync, readdirSync, statSync, writeFileSync, existsSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/config/hrtp-release-r1.json'), 'utf8'));
const map = JSON.parse(readFileSync(join(root, 'docs/acceptance/function-map.json'), 'utf8'));
const acceptance = JSON.parse(readFileSync(join(root, 'docs/acceptance/acceptance-map.json'), 'utf8'));
const testDir = join(root, 'backend/test');

const descriptions = new Map();
for (const line of readFileSync(join(root, 'docs/07-yeu-cau-chuc-nang.md'), 'utf8').split('\n')) {
  const match = /^\| (FR-(?:\d+\.\d+\.\d+|X\.\d+)) \| (.+?) \| [MSC] \|/.exec(line);
  if (match) descriptions.set(match[1], match[2].replace(/\*\*/g, '').replace(/\|/g, '/'));
}

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some(ext => name.endsWith(ext))) out.push(path);
  }
  return out;
}
const mentions = new Map();
for (const file of [...walk(join(root, 'backend/src'), ['.ts']), ...walk(testDir, ['.cjs']), ...walk(join(root, 'openspec'), ['.md'])]) {
  for (const id of new Set(readFileSync(file, 'utf8').match(/FR-\d+(?:\.\d+)+/g) ?? [])) mentions.set(id, [...(mentions.get(id) ?? []), relative(root, file)]);
}
const caseCount = file => existsSync(join(testDir, file)) ? (readFileSync(join(testDir, file), 'utf8').match(/\btest\(['"`]/g) ?? []).length : 0;
const uatByFr = new Map();
for (const item of acceptance.cases) for (const fr of item.fr ?? []) uatByFr.set(fr, [...(uatByFr.get(fr) ?? []), item.id]);

const rows = [], problems = [];
for (const requirement of manifest.requirements.filter(row => row.priority === 'M')) {
  // FR-10.0.x and FR-X.n carry no BFD cell in the manifest: they map by their own prefix.
  const key = requirement.bfd ?? requirement.id.replace(/^FR-/, '').split('.').slice(0, 2).join('.');
  const fn = map.functions[key];
  const tests = fn?.tests ?? [];
  const missingFiles = [...tests.filter(file => !existsSync(join(testDir, file))), ...(fn?.evidence ?? []).filter(file => !existsSync(join(root, file)))];
  if (fn && !tests.length && !(fn.evidence ?? []).length) problems.push(requirement.id + ': no test or evidence file');
  const gap = map.gaps?.[requirement.id];
  if (!fn) problems.push(requirement.id + ': BFD ' + requirement.bfd + ' has no implementation mapping');
  if (missingFiles.length) problems.push(requirement.id + ': missing test files ' + missingFiles.join(', '));
  const direct = (mentions.get(requirement.id) ?? []).length;
  const state = !fn || missingFiles.length ? 'GAP' : gap ? 'PARTIAL' : 'MAPPED';
  rows.push({ ...requirement, bfd: key, fn, tests, direct, gap, state, uat: uatByFr.get(requirement.id) ?? [] });
}

const count = state => rows.filter(row => row.state === state).length;
const cell = text => String(text).replace(/\n/g, ' ');
const lines = [
  '# Đối chiếu FR mức M → triển khai → kiểm thử (R1)',
  '',
  '> Tệp sinh tự động bởi `node scripts/fr-coverage.cjs` từ `docs/config/hrtp-release-r1.json`, `docs/07-yeu-cau-chuc-nang.md` và `docs/acceptance/function-map.json`. Không sửa tay.',
  '> "MAPPED" nghĩa là có mô-đun và tệp kiểm thử tự động cho chức năng BFD chứa FR; **không** đồng nghĩa đã nghiệm thu. Trạng thái nghiệm thu chỉ đổi qua `scripts/record-acceptance.cjs` với bằng chứng chạy thật.',
  '',
  `Tổng: **${rows.length}** FR M · MAPPED ${count('MAPPED')} · PARTIAL ${count('PARTIAL')} · GAP ${count('GAP')}`,
  '',
  '| FR | Yêu cầu | BFD | Nhóm NT | Mô-đun / nguồn | Kiểm thử tự động (số ca) / bằng chứng | UAT/TC | Nhắc trực tiếp | Trạng thái |',
  '|---|---|---|---|---|---|---|---|---|',
];
for (const row of rows) {
  const tests = [...row.tests.map(file => '`' + file + '` (' + caseCount(file) + ')'), ...(row.fn?.evidence ?? []).map(file => '`' + file + '`')].join('<br>');
  const status = row.state + (row.gap ? ' — ' + row.gap : '');
  lines.push(`| ${row.id} | ${cell((descriptions.get(row.id) ?? '').slice(0, 140))} | ${row.bfd} | ${row.acceptance_group} | ${cell((row.fn?.modules ?? []).join(', '))}<br><sub>${cell(row.fn?.source ?? '')}</sub> | ${tests || '—'} | ${row.uat.join(', ') || '—'} | ${row.direct || '—'} | ${status} |`);
}
lines.push('', '## Khoảng trống', '');
const open = rows.filter(row => row.state !== 'MAPPED');
if (!open.length) lines.push('Không có.');
for (const row of open) lines.push(`- **${row.id}** (${row.state}): ${row.gap ?? 'chưa có ánh xạ triển khai/kiểm thử'} → change \`add-r1-gap-closure\`.`);
lines.push('');

if (process.argv.includes('--check')) {
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`FR coverage: ${rows.length} M requirements mapped (${count('PARTIAL')} partial).`);
} else {
  writeFileSync(join(root, 'docs/acceptance/fr-coverage.md'), lines.join('\n'));
  console.log(`docs/acceptance/fr-coverage.md: ${rows.length} FR (MAPPED ${count('MAPPED')}, PARTIAL ${count('PARTIAL')}, GAP ${count('GAP')})`);
}
