const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const ExcelJS = require('exceljs');

const backend = resolve(__dirname, '..');
const build = resolve(__dirname, '.attendance-parser-build');
let parseAttendanceFile;
let validateMapping;

const mapping = {
  columns: { employeeCode: 0, date: 1, time: 2, deviceCode: 3, direction: 4 },
  delimiter: ',',
  encoding: 'utf8',
  skipRows: 0,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm:ss',
};

before(() => {
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
    '--outDir', build, '--rootDir', 'src', '--strict', '--esModuleInterop',
    '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'ES2023', '--skipLibCheck',
    'src/attendance/import-parser.ts',
  ], { cwd: backend, stdio: 'inherit' });
  ({ parseAttendanceFile, validateMapping } = require(resolve(build, 'attendance/import-parser.js')));
});

after(() => rmSync(build, { recursive: true, force: true }));

test('attendance CSV parsing preserves source values and converts Vietnam time to UTC', async () => {
  const input = Buffer.from('\uFEFF0012,2026-01-02,08:09:10,DEVICE-01,Vào\nE2,2026-01-02,18:00:00,DEVICE-02,AUTO\n');
  const result = await parseAttendanceFile(input, 'punches.csv', mapping);

  assert.deepEqual(result, {
    totalRows: 2,
    errors: [],
    rows: [
      {
        row: 1,
        employeeCode: '0012',
        punchedAt: '2026-01-02T01:09:10.000Z',
        deviceCode: 'DEVICE-01',
        direction: 'IN',
        source: ['0012', '2026-01-02', '08:09:10', 'DEVICE-01', 'Vào'],
      },
      {
        row: 2,
        employeeCode: 'E2',
        punchedAt: '2026-01-02T11:00:00.000Z',
        deviceCode: 'DEVICE-02',
        direction: 'AUTO',
        source: ['E2', '2026-01-02', '18:00:00', 'DEVICE-02', 'AUTO'],
      },
    ],
  });
});

test('attendance XLSX parses serial date and time cells and preserves leading-zero text', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Máy chấm công');
  sheet.addRow(['0007', 46024, 0.5, 'DEV-XLSX', 'Ra']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const result = await parseAttendanceFile(buffer, 'punches.XLSX', mapping);
  assert.deepEqual(result.rows, [{
    row: 1,
    employeeCode: '0007',
    punchedAt: '2026-01-02T05:00:00.000Z',
    deviceCode: 'DEV-XLSX',
    direction: 'OUT',
    source: ['0007', '46024', '0.5', 'DEV-XLSX', 'Ra'],
  }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalRows, 1);
});

test('attendance parser reports invalid dates alongside other row errors', async () => {
  const result = await parseAttendanceFile(
    Buffer.from('EMP,2026-02-29,25:61:00,,unknown\n'),
    'invalid-date.csv',
    mapping,
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.totalRows, 1);
  assert.deepEqual(result.errors.map(({ row, code }) => ({ row, code })), [
    { row: 1, code: 'INVALID_DATE' },
    { row: 1, code: 'INVALID_TIME' },
    { row: 1, code: 'EMPTY_DEVICE_CODE' },
    { row: 1, code: 'INVALID_DIRECTION' },
  ]);
});

test('attendance parser rejects malformed CSV, mapped formulas, and oversized files', async () => {
  await assert.rejects(
    parseAttendanceFile(Buffer.from('EMP,"2026-01-01\n'), 'broken.csv', mapping),
    { name: 'BadRequestException' },
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.getCell('A1').value = { formula: '"E1"', result: 'E1' };
  sheet.getCell('B1').value = '2026-01-01';
  sheet.getCell('C1').value = '08:00:00';
  sheet.getCell('D1').value = 'DEV';
  sheet.getCell('E1').value = 'IN';
  const formulaResult = await parseAttendanceFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'formula.xlsx', mapping);
  assert.equal(formulaResult.rows.length, 0);
  assert.ok(formulaResult.errors.some(error => error.code === 'FORMULA_CELL'));

  await assert.rejects(
    parseAttendanceFile(Buffer.alloc(10 * 1024 * 1024 + 1), 'too-large.csv', mapping),
    { name: 'BadRequestException' },
  );
});

test('mapping rejects duplicate columns and strict UTF-8 rejects invalid byte sequences', async () => {
  assert.throws(() => validateMapping({ ...mapping, columns: { ...mapping.columns, date: 0 } }), { name: 'BadRequestException' });
  await assert.rejects(parseAttendanceFile(Buffer.from([0xc3, 0x28]), 'invalid.csv', mapping), { name: 'BadRequestException' });
});
