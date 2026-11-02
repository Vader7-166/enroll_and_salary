const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { selectTaxContext, splitExemptions, progressiveTax, withhold, grossUp, netCalculator } = require('../dist/personal-income-tax/pit-engine.js');

const brackets = (rows) => rows.flatMap(([lower, upper, rate], index) => [
  { basis: 'MONTH', bracketNo: index + 1, lower: String(lower), upper: upper === null ? null : String(upper), rate },
  { basis: 'YEAR', bracketNo: index + 1, lower: String(lower * 12), upper: upper === null ? null : String(upper * 12), rate },
]);
const M = 1_000_000;
const rulesets = [
  { id: 'p25', code: 'RES-PROG-2025', subject: 'RESIDENT_PROGRESSIVE', exemptionMode: 'PREMIUM_ONLY', effectiveFrom: '2020-07-01', effectiveTo: '2025-12-31', settings: { selfDeduction: '11000000', dependentDeduction: '4400000', voluntaryPensionCapMonth: '1000000' },
    brackets: brackets([[0, 5 * M, '0.05'], [5 * M, 10 * M, '0.10'], [10 * M, 18 * M, '0.15'], [18 * M, 32 * M, '0.20'], [32 * M, 52 * M, '0.25'], [52 * M, 80 * M, '0.30'], [80 * M, null, '0.35']]), legalBasis: 'NQ 954/2020; TT 111/2013', status: 'SIMULATION' },
  { id: 'p26', code: 'RES-PROG-2026', subject: 'RESIDENT_PROGRESSIVE', exemptionMode: 'ELIGIBLE_PAYMENT', effectiveFrom: '2026-01-01', effectiveTo: null, settings: { selfDeduction: '15500000', dependentDeduction: '6200000', voluntaryPensionCapMonth: '1000000' },
    brackets: brackets([[0, 10 * M, '0.05'], [10 * M, 30 * M, '0.10'], [30 * M, 60 * M, '0.20'], [60 * M, 100 * M, '0.30'], [100 * M, null, '0.35']]), legalBasis: 'Luật 109/2025; NQ 110/2025', status: 'SIMULATION' },
  { id: 'f25', code: 'RES-FLAT10-2025', subject: 'RESIDENT_FLAT_10', exemptionMode: 'PREMIUM_ONLY', effectiveFrom: '2015-01-01', effectiveTo: '2025-12-31', settings: { rate: '0.1', threshold: '2000000', belowThresholdOnRequestOnly: false }, brackets: [], legalBasis: 'TT 111/2013', status: 'SIMULATION' },
  { id: 'f26', code: 'RES-FLAT10-2026', subject: 'RESIDENT_FLAT_10', exemptionMode: 'ELIGIBLE_PAYMENT', effectiveFrom: '2026-01-01', effectiveTo: null, settings: { rate: '0.1', threshold: '5000000', belowThresholdOnRequestOnly: true }, brackets: [], legalBasis: 'NĐ 253/2026 Điều 50', status: 'SIMULATION' },
  { id: 'n25', code: 'NONRES-2025', subject: 'NON_RESIDENT', exemptionMode: 'PREMIUM_ONLY', effectiveFrom: '2015-01-01', effectiveTo: '2026-06-30', settings: { rate: '0.2' }, brackets: [], legalBasis: 'TT 111/2013', status: 'SIMULATION' },
  { id: 'n26', code: 'NONRES-2026H2', subject: 'NON_RESIDENT', exemptionMode: 'ELIGIBLE_PAYMENT', effectiveFrom: '2026-07-01', effectiveTo: null, settings: { rate: '0.2' }, brackets: [], legalBasis: 'NĐ 253/2026 Điều 64, 69', status: 'SIMULATION' },
];
const context = (paymentDate, subject = 'RESIDENT_PROGRESSIVE') => selectTaxContext({ rulesets, subject, paymentDate, paymentDateStatus: 'ACTUAL' });
const options = { commitment: false, voluntaryRequest: false };

test('TC-T01: 45.000.000 đ assessable → 8.000.000 đ (2025) and 5.500.000 đ (2026)', () => {
  assert.equal(progressiveTax('45000000', context('2025-12-20').ruleset.brackets).tax, '8000000');
  assert.equal(progressiveTax('45000000', context('2026-01-09').ruleset.brackets).tax, '5500000');
});

test('TC-T02: holiday OT 600.000 đ — 2025 taxes 200k / exempts 400k; 2026 exempts all', () => {
  const ot = [{ sourceRef: 'ot', kind: 'OT', amountPaid: '600000', basePortion: '200000', eligibleAmount: '600000', evidenceRef: 'BB-OT' }];
  const y25 = splitExemptions(ot, context('2025-12-20').ruleset.exemptionMode, null);
  assert.deepEqual([y25.taxable, y25.exempt], ['200000', '400000']);
  const y26 = splitExemptions(ot, context('2026-01-09').ruleset.exemptionMode, null);
  assert.deepEqual([y26.taxable, y26.exempt], ['0', '600000']);
});

test('TC-T03 / UAT-26: 70M taxable, 3.3M insurance, 1 dependent → deductions 21.7M, assessable 45M, tax 5.5M', () => {
  const result = withhold(context('2026-02-05'), [{ sourceRef: 'salary', kind: 'SALARY', amountPaid: '70000000' }], null, { insurance: '3300000', dependents: 1 }, options);
  assert.equal(new Decimal(result.deductions.self).plus(result.deductions.dependents).toString(), '21700000');
  assert.equal(result.assessableIncome, '45000000');
  assert.equal(result.tax, '5500000');
  assert.equal(result.deductions.total, '25000000', 'each deduction counted once');
});

test('TC-T04 / TC-T05: payment date picks the tax period; replay keeps the filed snapshot', () => {
  const january = context('2026-01-09');
  assert.deepEqual([january.taxPeriod, january.ruleset.code, january.ruleset.exemptionMode], ['2026-01', 'RES-PROG-2026', 'ELIGIBLE_PAYMENT']);
  const filed = context('2025-12-31');
  const replay = selectTaxContext({ rulesets, subject: 'RESIDENT_PROGRESSIVE', paymentDate: '2026-03-01', paymentDateStatus: 'ACTUAL', mode: 'REPLAY_FILED', filed });
  assert.equal(replay.ruleset.code, 'RES-PROG-2025');
  assert.throws(() => selectTaxContext({ rulesets: [...rulesets, { ...rulesets[1], id: 'dup' }], subject: 'RESIDENT_PROGRESSIVE', paymentDate: '2026-02-01', paymentDateStatus: 'ACTUAL' }), error => error.code === 'TAX_RULESET_INVALID');
  assert.throws(() => selectTaxContext({ rulesets, subject: 'RESIDENT_PROGRESSIVE', paymentDate: '2019-01-01', paymentDateStatus: 'ACTUAL' }), error => error.code === 'TAX_RULESET_INVALID');
});

test('TC-T06: regular night shift 800k base + 240k allowance is split once', () => {
  const night = [
    { sourceRef: 'night-base', kind: 'NIGHT_BASE_PORTION', amountPaid: '800000', eligibleAmount: '800000', evidenceRef: 'BC-DEM' },
    { sourceRef: 'night-allowance', kind: 'NIGHT_ALLOWANCE', amountPaid: '240000', eligibleAmount: '240000', evidenceRef: 'BC-DEM' },
  ];
  const y25 = splitExemptions(night, 'PREMIUM_ONLY', null);
  assert.deepEqual([y25.taxable, y25.exempt], ['800000', '240000']);
  const y26 = splitExemptions(night, 'ELIGIBLE_PAYMENT', null);
  assert.deepEqual([y26.taxable, y26.exempt], ['0', '1040000']);
  assert.throws(() => splitExemptions([...night, { sourceRef: 'night-base', kind: 'SALARY', amountPaid: '800000' }], 'ELIGIBLE_PAYMENT', null), error => error.code === 'TAX_INCOME_DUPLICATE_SOURCE');
});

test('TC-T07: only the verified 450.000 đ of 600.000 đ OT is exempt; no evidence → exception', () => {
  const partial = splitExemptions([{ sourceRef: 'ot', kind: 'OT', amountPaid: '600000', eligibleAmount: '450000', evidenceRef: 'BB' }], 'ELIGIBLE_PAYMENT', null);
  assert.deepEqual([partial.exempt, partial.taxable, partial.exceptions.length], ['450000', '150000', 0]);
  const missing = splitExemptions([{ sourceRef: 'ot', kind: 'OT', amountPaid: '600000' }], 'ELIGIBLE_PAYMENT', null);
  assert.deepEqual([missing.exempt, missing.taxable, missing.exceptions[0].code], ['0', '600000', 'TAX_EXEMPTION_EVIDENCE_MISSING']);
});

test('TC-T08: 10% per payment against the 2M (2025) / 5M (2026) threshold', () => {
  const pay = amount => [{ sourceRef: 'p', kind: 'OTHER_TAXABLE', amountPaid: amount }];
  assert.equal(withhold(context('2025-06-01', 'RESIDENT_FLAT_10'), pay('3000000'), null, { insurance: '0', dependents: 2 }, options).tax, '300000');
  assert.equal(withhold(context('2026-06-01', 'RESIDENT_FLAT_10'), pay('3000000'), null, { insurance: '0', dependents: 2 }, options).tax, '0');
  assert.equal(withhold(context('2026-06-01', 'RESIDENT_FLAT_10'), pay('5000000'), null, { insurance: '0', dependents: 2 }, options).tax, '500000');
  assert.equal(withhold(context('2026-06-01', 'RESIDENT_FLAT_10'), pay('3000000'), null, { insurance: '0', dependents: 0 }, { commitment: false, voluntaryRequest: true }).tax, '300000');
  const committed = withhold(context('2026-06-01', 'RESIDENT_FLAT_10'), pay('6000000'), null, { insurance: '0', dependents: 0 }, { commitment: true, voluntaryRequest: false });
  assert.deepEqual([committed.tax, committed.notes], ['0', ['COMMITMENT_ON_FILE']]);
});

test('TC-T09: meal allowance uses the norm in force on each payment date', () => {
  const meal = [{ sourceRef: 'meal', kind: 'MEAL', amountPaid: '1500000' }];
  const june = splitExemptions(meal, 'ELIGIBLE_PAYMENT', '730000');
  assert.deepEqual([june.exempt, june.taxable], ['730000', '770000']);
  const july = splitExemptions(meal, 'ELIGIBLE_PAYMENT', '1200000');
  assert.deepEqual([july.exempt, july.taxable], ['1200000', '300000']);
  assert.equal(splitExemptions(meal, 'ELIGIBLE_PAYMENT', null).exceptions[0].code, 'TAX_MEAL_NORM_MISSING');
});

test('TC-T11: 2026 bracket boundaries and the first extra đồng', () => {
  const b = context('2026-03-01').ruleset.brackets;
  assert.deepEqual(['0', '10000000', '30000000', '60000000', '100000000'].map(value => progressiveTax(value, b).tax), ['0', '500000', '2500000', '8500000', '20500000']);
  assert.deepEqual(['10000001', '30000001', '60000001', '100000001'].map(value => progressiveTax(value, b).raw), ['500000.1', '2500000.2', '8500000.3', '20500000.35']);
});

test('TC-T12: non-resident pays 20% without family deductions', () => {
  const result = withhold(context('2026-08-01', 'NON_RESIDENT'), [{ sourceRef: 's', kind: 'SALARY', amountPaid: '20000000' }], null, { insurance: '1000000', dependents: 2 }, options);
  assert.deepEqual([result.tax, result.branch, result.deductions.total], ['4000000', 'NON_RESIDENT_20', '0']);
});

test('TC-T13: unused leave pay exempt in 2026 only with evidence', () => {
  const leave = [{ sourceRef: 'leave', kind: 'UNUSED_LEAVE', amountPaid: '2000000', eligibleAmount: '2000000', evidenceRef: 'BLLĐ 113.3 + NĐ 253 Đ26.2' }];
  assert.equal(splitExemptions(leave, 'ELIGIBLE_PAYMENT', null).exempt, '2000000');
  assert.equal(splitExemptions([{ ...leave[0], evidenceRef: null }], 'ELIGIBLE_PAYMENT', null).exceptions[0].code, 'TAX_EXEMPTION_EVIDENCE_MISSING');
  assert.equal(splitExemptions(leave, 'PREMIUM_ONLY', null).taxable, '2000000');
});

const insurance = [{ kind: 'BHXH', employeeRate: '0.08', cap: '46800000' }, { kind: 'BHYT', employeeRate: '0.015', cap: '46800000' }, { kind: 'BHTN', employeeRate: '0.01', cap: '106200000' }];
test('TC-P03 / UAT-13: NET 20.000.000 đ grosses up within 1 đồng', () => {
  const net = netCalculator({ context: context('2026-10-05'), dependents: 0, insurance, insuranceFloor: '5310000' });
  const result = grossUp('20000000', net);
  assert.ok(new Decimal(result.difference).abs().lte(1), JSON.stringify(result));
  assert.ok(net(new Decimal(result.gross)).minus(20000000).abs().lte(1));
});

test('NFR-04: 50 NET levels across every 2025 and 2026 bracket converge within 1 đồng', () => {
  for (const paymentDate of ['2025-10-05', '2026-10-05']) {
    for (let index = 0; index < 50; index += 1) {
      const target = 5_000_000 + index * 3_100_000 + (index % 7) * 13_579;
      const net = netCalculator({ context: context(paymentDate), dependents: index % 3, insurance, insuranceFloor: '5310000' });
      const result = grossUp(String(target), net);
      assert.ok(new Decimal(result.difference).abs().lte(1), paymentDate + ' ' + target + ' ' + JSON.stringify(result));
    }
  }
  assert.throws(() => grossUp('20000000', () => new Decimal(0)), error => error.code === 'GROSS_UP_NOT_CONVERGED');
});
