const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { withServer, day } = require('./http-harness.cjs');
const { cipherText } = require('../dist/common/data-crypto.js');
const { annualSettlement } = require('../dist/personal-income-tax/finalization/annual-tax.js');

const YEAR_2026 = [[0, 120000000, '0.05'], [120000000, 360000000, '0.10'], [360000000, 720000000, '0.20'], [720000000, 1200000000, '0.30'], [1200000000, null, '0.35']]
  .map(([lower, upper, rate], index) => ({ basis: 'YEAR', bracketNo: index + 1, lower: String(lower), upper: upper === null ? null : String(upper), rate }));
const MONTH_2026 = [[0, 10000000, '0.05'], [10000000, 30000000, '0.10'], [30000000, 60000000, '0.20'], [60000000, 100000000, '0.30'], [100000000, null, '0.35']]
  .map(([lower, upper, rate], index) => ({ basis: 'MONTH', bracketNo: index + 1, lower: String(lower), upper: upper === null ? null : String(upper), rate }));
const ruleset = { code: 'RES-PROG-2026', settings: { selfDeduction: '15500000', dependentDeduction: '6200000', voluntaryPensionCapMonth: '1000000' }, brackets: [...MONTH_2026, ...YEAR_2026] };
const fact = (taxable, tax, extra = {}) => ({ id: randomUUID(), paymentKey: randomUUID(), paymentDate: '2026-07-10', rulesetCode: 'RES-PROG-2026', branch: 'PROGRESSIVE', filingStatus: 'FILED',
  taxable, exempt: '0', insurance: '0', voluntaryPension: '0', charity: '0', medicalEducation: '0', tax, ...extra });

test('Annual tax uses the YEAR brackets on the year total (540.000.000 → 66.000.000), never a monthly rate', () => {
  const result = annualSettlement({ rows: [fact(String(540000000 + 186000000), '50000000')], ruleset, selfMonths: 12, dependentMonths: 0 });
  assert.deepEqual([result.deductions.self, result.assessableIncome, result.annualTax], ['186000000', '540000000', '66000000'], '6M + 24M + 36M');
  assert.deepEqual([result.withheld, result.difference, result.direction], ['50000000', '16000000', 'PAYABLE']);
  const refund = annualSettlement({ rows: [fact('300000000', '20000000', { insurance: '20000000' })], ruleset, selfMonths: 12, dependentMonths: 9 });
  assert.deepEqual([refund.deductions.dependents, refund.assessableIncome, refund.annualTax, refund.direction], ['55800000', '38200000', '1910000', 'REFUND']);
  assert.equal(annualSettlement({ rows: [fact('100000000', '0', { voluntaryPension: '20000000' })], ruleset, selfMonths: 12, dependentMonths: 0 }).deductions.voluntaryPension, '12000000', 'pension capped at 12 × monthly cap');
});

test('Annual PIT finalization on real HTTP: payment-year grouping, TC-T10 transition, authorization, blocking checks, export', { timeout: 600000 }, async t => {
  await withServer('tax_finalization', async ({ db, request, ok, login }) => {
    const [kt, tt] = await Promise.all(['kt.all', 'tt.bn'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const rulesets = Object.fromEntries((await db.taxRuleset.findMany()).map(row => [row.code, row]));
    assert.equal(await db.pitBracket.count({ where: { rulesetId: rulesets['RES-PROG-2026'].id, basis: 'YEAR' } }), 5, 'year brackets seeded for 2026');
    assert.equal(await db.pitBracket.count({ where: { rulesetId: rulesets['RES-PROG-2025'].id, basis: 'YEAR' } }), 7, 'and for 2025');
    const tag = randomUUID().slice(0, 6).toUpperCase();
    async function person(code, profile) {
      const employee = await db.employee.create({ data: { code: 'QT-' + tag + '-' + code, fullName: 'Quyết toán ' + code, gender: 'OTHER', dob: day('1988-01-01'), hireDate: day('2026-01-05'),
        assignments: { create: { orgUnitId: team.id, effectiveFrom: day('2026-01-05'), allocationRatio: '100', isPrimary: true } } } });
      if (profile) await db.taxProfile.create({ data: { employeeId: employee.id, residency: profile.residency ?? 'RESIDENT', finalizationAuthorized: profile.authorized, reason: 'Hồ sơ thuế', dataStatus: 'SIMULATION', effectiveFrom: day('2025-01-01') } });
      return employee;
    }
    async function withholding(employee, paymentDate, taxable, tax, extra = {}) {
      const code = extra.ruleset ?? (paymentDate < '2026-01-01' ? 'RES-PROG-2025' : 'RES-PROG-2026');
      const detail = { branch: extra.branch ?? 'PROGRESSIVE', exemptions: { taxable, exempt: extra.exempt ?? '0', lines: [], exceptions: [] }, taxableIncome: taxable,
        deductions: { self: '15500000', dependents: '0', insurance: extra.insurance ?? '0', voluntaryPension: '0', charity: '0', medicalEducation: '0' }, assessableIncome: '0', tax, rawTax: tax, brackets: [], notes: [] };
      return db.taxWithholding.create({ data: { employeeId: employee.id, paymentKey: extra.paymentKey ?? 'pay:' + randomUUID(), paymentDate: day(paymentDate), paymentDateStatus: extra.status ?? 'ACTUAL', taxPeriod: paymentDate.slice(0, 7),
        subject: extra.subject ?? 'RESIDENT_PROGRESSIVE', branch: extra.branch ?? 'PROGRESSIVE', rulesetId: rulesets[code].id, status: 'LOCKED', filingStatus: extra.filing ?? 'FILED', contextFlag: extra.contextFlag ?? null,
        originalWithholdingId: extra.original ?? null, reason: extra.original ? 'Điều chỉnh khoản chi' : null, detailCipher: cipherText(key, JSON.stringify(detail)) } });
    }
    const main = await person('A', { authorized: true });
    const dec2025 = await withholding(main, '2026-01-09', '20000000', '500000', { insurance: '1050000', paymentKey: 'payroll:PL-2025-12:' + main.id });
    const march = await withholding(main, '2026-03-10', '25000000', '900000', { insurance: '1050000' });
    const july = await withholding(main, '2026-07-10', '30000000', '1400000', { insurance: '1050000', filing: 'NOT_FILED' });
    await withholding(main, '2025-12-31', '18000000', '450000', { insurance: '1000000' });
    await db.employeeDependent.create({ data: { employeeId: main.id, dependentKey: randomUUID(), version: 1, fullName: 'Con', relationship: 'CHILD', deductionFromMonth: '2026-04', evidenceReference: 'Giấy khai sinh', reason: 'NPT', dataStatus: 'SIMULATION' } });
    const notAuthorized = await person('B', { authorized: false });
    await withholding(notAuthorized, '2026-05-10', '15000000', '100000');
    const projected = await person('C', { authorized: true });
    await withholding(projected, '2026-04-10', '15000000', '100000');
    await withholding(projected, '2026-12-28', '15000000', '100000', { status: 'PROJECTED', filing: 'NOT_FILED' });
    const flat = await person('D', { authorized: true });
    await withholding(flat, '2026-06-10', '6000000', '600000', { subject: 'RESIDENT_FLAT_10', branch: 'FLAT_10', ruleset: 'RES-FLAT10-2026' });
    const before = await db.taxWithholding.findMany({ where: { employeeId: main.id }, orderBy: { id: 'asc' } });
    let draft;

    await t.test('Run 2026: grouped by payment year, YEAR brackets, transition lines, authorization list', async () => {
      assert.equal((await request('/pit/finalizations/run', tt, { year: 2026 })).status, 403);
      const run = await ok('/pit/finalizations/run', kt, { year: 2026 });
      const reasons = Object.fromEntries(run.ineligible.map(row => [row.employee.id, row.reason]));
      assert.deepEqual([reasons[notAuthorized.id], reasons[flat.id], reasons[main.id], reasons[projected.id]], ['NOT_AUTHORIZED', 'NON_PROGRESSIVE_INCOME', undefined, undefined]);
      draft = run.items.find(item => item.employee.id === main.id);
      const summary = draft.summary;
      assert.equal(summary.payments, 3, 'December 2025 pay paid on 09/01/2026 belongs to 2026; the 31/12/2025 payment does not');
      assert.deepEqual([summary.taxableIncome, summary.selfMonths, summary.dependentMonths, summary.deductions.self, summary.deductions.dependents, summary.deductions.insurance], ['75000000', 12, 9, '186000000', '55800000', '3150000']);
      assert.deepEqual([summary.assessableIncome, summary.annualTax, summary.withheld, summary.difference, summary.direction], ['0', '0', '2800000', '-2800000', 'REFUND']);
      assert.equal(summary.rulesetCode, 'RES-PROG-2026');
      const detail = await ok('/pit/finalizations/' + draft.id, kt);
      const lines = detail.lines.map(line => [line.kind, line.withholdingId]);
      assert.deepEqual(lines.filter(([kind]) => kind === 'WITHHELD_ORIGINAL').map(([, id]) => id).sort(), [dec2025.id, march.id].sort(), 'first-half 2026 payments keep their filed snapshot');
      assert.deepEqual(lines.filter(([kind]) => kind === 'WITHHELD').map(([, id]) => id), [july.id]);
      assert.equal(detail.lines.find(line => line.kind === 'SETTLEMENT').difference, '-2800000');
      assert.deepEqual(await db.taxWithholding.findMany({ where: { employeeId: main.id }, orderBy: { id: 'asc' } }), before, 'withholding records are never modified');
    });

    await t.test('Projected payment blocks completion; unchanged sources make no new version', async () => {
      const blocked = (await ok('/pit/finalizations?year=2026', kt)).items.find(item => item.employee.id === projected.id);
      assert.ok(blocked.issues.some(issue => issue.code === 'PROJECTED_PAYMENT_IN_YEAR' && issue.blocking));
      const refused = await request('/pit/finalizations/' + blocked.id + '/complete', kt, { sourceHash: blocked.sourceHash });
      assert.deepEqual([refused.status, refused.body.code], [409, 'PROJECTED_PAYMENT_IN_YEAR']);
      assert.equal((await db.annualTaxFinalization.findUniqueOrThrow({ where: { id: blocked.id } })).status, 'DRAFT');
      const again = await ok('/pit/finalizations/run', kt, { year: 2026 });
      assert.equal(again.created, 0);
      assert.equal(await db.annualTaxFinalization.count({ where: { employeeId: main.id, taxYear: 2026 } }), 1);
    });

    await t.test('Complete is final; a later source change creates a new version and leaves DONE intact', async () => {
      assert.equal((await request('/pit/finalizations/' + draft.id + '/complete', kt, { sourceHash: 'f'.repeat(64) })).body.code, 'STALE_REVISION');
      const done = await ok('/pit/finalizations/' + draft.id + '/complete', kt, { sourceHash: draft.sourceHash });
      assert.equal(done.finalization.status, 'DONE');
      await assert.rejects(() => db.annualTaxFinalization.update({ where: { id: draft.id }, data: { direction: 'NONE' } }), /TAX_FINALIZATION_IMMUTABLE/);
      await assert.rejects(() => db.annualTaxFinalizationLine.deleteMany({ where: { finalizationId: draft.id } }), /TAX_FINALIZATION_IMMUTABLE/);
      await withholding(main, '2026-08-10', '40000000', '3000000', { original: july.id, paymentKey: july.paymentKey, filing: 'NOT_FILED' });
      const rerun = await ok('/pit/finalizations/run', kt, { year: 2026 });
      const latest = rerun.items.find(item => item.employee.id === main.id);
      assert.deepEqual([latest.version, latest.status, latest.summary.payments, latest.summary.withheld], [2, 'DRAFT', 3, '4400000'], 'the adjustment supersedes the July record');
      assert.equal((await db.annualTaxFinalization.findUniqueOrThrow({ where: { id: draft.id } })).status, 'DONE');
      assert.equal((await request('/pit/finalizations/' + draft.id + '/complete', kt, { sourceHash: draft.sourceHash })).body.code, 'TAX_FINALIZATION_DONE');
    });

    await t.test('Year 2025 uses its own ruleset; export has the summary declaration and the appendix, audited', async () => {
      const run2025 = await ok('/pit/finalizations/run', kt, { year: 2025 });
      const old = run2025.items.find(item => item.employee.id === main.id);
      assert.deepEqual([old.summary.payments, old.summary.rulesetCode, old.summary.deductions.self], [1, 'RES-PROG-2025', '132000000']);
      const file = await request('/pit/finalizations/export?year=2026', kt);
      assert.equal(file.status, 200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file.body);
      assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['To khai tong hop', 'Phu luc ca nhan']);
      assert.match(String(book.worksheets[0].getRow(1).getCell(1).value), /DỰ THẢO/);
      const appendix = []; book.worksheets[1].eachRow((row, number) => { if (number > 1) appendix.push(row.values.slice(1)); });
      const mine = appendix.find(row => row[0] === main.code);
      assert.deepEqual([mine[3], mine[7], mine[13], mine[14]], [85000000, 9, 4400000, -4400000], 'latest version: income, NPT months, withheld, refund');
      assert.ok(!appendix.some(row => row[0] === notAuthorized.code), 'people who did not authorize are not in the draft');
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'annual_tax_finalization', action: 'EXPORT' } }));
    });
  });
});
