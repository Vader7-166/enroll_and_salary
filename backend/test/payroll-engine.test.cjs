const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateEmployee } = require('../dist/payroll/payroll-engine.js');
const { compileFormula } = require('../dist/payroll-configuration/formula-engine.js');

const formula = (expression, values) => compileFormula(expression).evaluate(new Map(Object.entries(values))).toString();
const component = (code, flags = {}) => ({ isInsurable: false, taxClassification: 'TAXABLE', isOtBase: false, isProrated: false, componentType: 'EARNING', code, name: code, ...flags });
const days = (count, from = 1) => Array.from({ length: count }, (_, index) => ({ workDate: '2026-10-' + String(from + index).padStart(2, '0'), workUnits: '1', workedMinutes: 480, status: 'OK', correctionId: null }));
const unit = (overrides = {}) => ({ orgUnitId: 'u1', orgUnitCode: 'NM-BN-D1-T1', orgUnitName: 'Tổ 1', siteId: 's1', wageRegionCode: 'I', costCenterCode: 'CC-BN', from: '2026-10-01', to: '2026-10-31', days: 31, minimumMonth: { id: 'mw-I', value: '5310000' }, minimumHour: { id: 'mh-I', value: '25500' }, ...overrides });
const params = { standardWorkdays: { id: 'p-std', value: '26' }, deductionMaxNetRatio: { id: 'p-30', value: '0.3' }, varianceThreshold: { id: 'p-var', value: '0.2' }, otMonthMaxMinutes: { id: 'p-ot', value: '2400' }, probationMinRatio: { id: 'p-prob', value: '0.85' }, roundingScale: 0 };
function context(overrides = {}) {
  return {
    employee: { id: 'e1', code: 'NV001', fullName: 'Nhân viên', hireDate: '2026-01-01', terminationDate: null },
    period: { id: 'pp', code: 'PL-10', dateFrom: '2026-10-01', dateTo: '2026-10-31', paymentDate: '2026-11-05', month: '2026-10' },
    planVersions: [{ id: 'plan', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'TIME', role: 'BASE', sourceType: 'TIME', formulaCode: 'LUONG_TG', allocation: 'INDIVIDUAL' }] }],
    components: { TIME: component('LUONG_TG', { isInsurable: true, isOtBase: true, isProrated: true }) },
    inputs: [], salary: [{ componentId: null, componentCode: null, componentName: 'Lương thỏa thuận', from: '2026-10-01', to: '2026-10-31', amount: '13000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD-1' }],
    units: [unit()], attendance: { available: true, days: days(24), regularMinutes: String(24 * 480), lockHashes: ['lock-hash'] },
    buckets: [], bucketHash: null, contracts: [], previousGross: null, params, ...overrides,
  };
}
const hooks = (taxRate = '0') => ({
  insurance: async () => ({ eligible: { BHXH: false, BHYT: false, BHTN: false }, reasonCode: 'NO_CONTRACT', insurableRaw: null, cp07: null, lines: [], trace: {} }),
  tax: async items => ({ tax: String(Math.round(items.reduce((total, item) => total + Number(item.amountPaid), 0) * Number(taxRate))), branch: 'PROGRESSIVE', rulesetId: 'r', rulesetCode: 'R', taxPeriod: '2026-11', exceptions: [], trace: {} }),
});
const input = (componentId, inputType, amount, overrides = {}) => ({ id: 'in-' + componentId + '-' + amount, componentId, inputType, valueState: 'PRESENT', amount, allocatedAmount: null, workFrom: '2026-10-01', workTo: '2026-10-31', inputHash: 'h-' + componentId + '-' + amount, batchId: 'b1', businessReference: 'REF-' + componentId, teamAllocationKey: null, formulaCode: 'F_' + componentId, bindingVersions: ['v-' + componentId], provenance: 'SIMULATION', ...overrides });
const plan = (lines) => [{ id: 'plan', payMode: 'PRODUCT', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines }];
const main = result => result.lines.filter(line => ['MAIN', 'ALLOWANCE', 'BONUS', 'OT'].includes(line.lineType)).reduce((total, line) => total + Number(line.amount), 0);

test('FIX-01: 13.000.000 đ × 24 paid units (23 worked + 1 paid leave) ÷ 26 = 12.000.000 đ', async () => {
  const result = await calculateEmployee(context(), hooks());
  assert.equal(result.status, 'OK', JSON.stringify(result.errors));
  const line = result.lines.find(item => item.lineType === 'MAIN');
  assert.equal(line.amount, '12000000');
  assert.equal(line.trace.segments[0].quantity, '24');
  assert.ok(line.sources.some(source => source.sourceType === 'ATTENDANCE_LOCK'));
});

test('FIX-02: prorated 1.000.000 đ allowance at 13/26 paid units = 500.000 đ', async () => {
  const result = await calculateEmployee(context({
    planVersions: [{ id: 'plan', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'PC', role: 'ADDITIONAL', sourceType: 'ALLOWANCE', formulaCode: 'PC', allocation: 'INDIVIDUAL' }] }],
    components: { PC: component('PC_TRACH_NHIEM', { isProrated: true }) },
    salary: [{ componentId: 'PC', componentCode: 'PC_TRACH_NHIEM', componentName: 'Phụ cấp', from: '2026-10-01', to: '2026-10-31', amount: '1000000', salaryBasis: 'MONTHLY', source: 'DECISION', sourceId: 'qd', reference: 'QĐ' }],
    attendance: { available: true, days: days(13), regularMinutes: String(13 * 480), lockHashes: [] },
  }), hooks());
  assert.equal(result.lines.find(item => item.lineType === 'ALLOWANCE').amount, '500000');
});

test('TC-I01: FIX-03…FIX-08 from confirmed inputs computed by the formula engine', async () => {
  const cases = [
    ['FIX-03', 'PRODUCT', [formula('SAN_LUONG * DON_GIA', { SAN_LUONG: '500', DON_GIA: '2000' })], 1000000],
    ['FIX-04', 'PRODUCT', [formula('SAN_LUONG * DON_GIA', { SAN_LUONG: '100', DON_GIA: '2000' }), formula('SAN_LUONG * DON_GIA', { SAN_LUONG: '100', DON_GIA: '2500' })], 450000],
    ['FIX-05', 'PIECEWORK', [formula('GIA_KHOAN * TY_LE_MOC', { GIA_KHOAN: '10000000', TY_LE_MOC: '0.4' })], 4000000],
    ['FIX-06', 'COMMISSION', [formula('(DOANH_SO - HOAN) * TY_LE', { DOANH_SO: '100000000', HOAN: '10000000', TY_LE: '0.02' })], 1800000],
    ['FIX-07', 'THREE_P', [formula('P1 + P2 + P3 * TY_LE_KPI', { P1: '8000000', P2: '2000000', P3: '3000000', TY_LE_KPI: '0.8' })], 12400000],
    ['FIX-08', 'BONUS', [formula('MUC_TIEU * TY_LE', { MUC_TIEU: '5000000', TY_LE: '0.8' })], 4000000],
  ];
  for (const [code, sourceType, amounts, expected] of cases) {
    const result = await calculateEmployee(context({
      planVersions: plan([{ componentId: 'C', role: sourceType === 'BONUS' ? 'ADDITIONAL' : 'BASE', sourceType, formulaCode: 'F', allocation: 'INDIVIDUAL' }]),
      components: { C: component(code) },
      inputs: amounts.map((amount, index) => input('C', sourceType, amount, { id: code + '-' + index, inputHash: code + '-' + index, workFrom: index ? '2026-10-16' : '2026-10-01', workTo: index ? '2026-10-31' : '2026-10-15' })),
      salary: [],
    }), hooks());
    assert.equal(result.status, 'OK', code + ' ' + JSON.stringify(result.errors));
    assert.equal(main(result), expected, code);
  }
});

test('FIX-05 / TC-I03: the same confirmed source counted twice pays once', async () => {
  const line = input('C', 'PIECEWORK', '4000000');
  const result = await calculateEmployee(context({ planVersions: plan([{ componentId: 'C', role: 'BASE', sourceType: 'PIECEWORK', formulaCode: 'F', allocation: 'INDIVIDUAL' }]), components: { C: component('KHOAN') }, inputs: [line, { ...line, id: 'copy' }], salary: [] }), hooks());
  assert.equal(main(result), 4000000);
});

test('FIX-09 / TC-I10: hourly rate 10.000.000 ÷ 100 normal hours = 100.000 đ; 2 OT hours at 150% = 300.000 đ', async () => {
  const bucket = { employeeId: 'e1', orgUnitId: 'u1', workDate: '2026-10-05', kind: 'OT', dayType: 'THUONG', isNight: false, hasDayOt: true, minutes: '120', rate: '1.5', rateBreakdown: { parameters: [] } };
  const result = await calculateEmployee(context({
    inputs: [input('TIME', 'TIME', '10000000')],
    attendance: { available: true, days: days(13), regularMinutes: String(100 * 60), lockHashes: [] },
    buckets: [bucket], bucketHash: 'bh',
  }), hooks());
  assert.deepEqual(result.hourlyRate, { numerator: '10000000', denominatorHours: '100', rate: '100000' });
  const ot = result.lines.find(line => line.lineType === 'OT');
  assert.equal(ot.amount, '300000');
  assert.equal(ot.trace.buckets[0].hours, '2');
});

test('TC-I02: MISSING blocks the employee; CONFIRMED_ZERO pays 0 with a source; NOT_APPLICABLE must match the plan', async () => {
  const productPlan = plan([{ componentId: 'C', role: 'BASE', sourceType: 'PRODUCT', formulaCode: 'F', allocation: 'INDIVIDUAL' }]);
  const missing = await calculateEmployee(context({ planVersions: productPlan, components: { C: component('SP') }, inputs: [], salary: [] }), hooks());
  assert.deepEqual([missing.status, missing.errors[0].code], ['ERROR', 'PAYROLL_INPUT_MISSING']);
  const zero = await calculateEmployee(context({ planVersions: productPlan, components: { C: component('SP') }, inputs: [input('C', 'PRODUCT', '0', { valueState: 'CONFIRMED_ZERO' })], salary: [] }), hooks());
  assert.equal(zero.status, 'OK'); assert.equal(main(zero), 0);
  assert.equal(zero.lines.find(line => line.lineType === 'MAIN').sources[0].sourceType, 'PAYROLL_INPUT_LINE');
  const wrongNa = await calculateEmployee(context({ planVersions: productPlan, components: { C: component('SP') }, inputs: [input('C', 'PRODUCT', null, { valueState: 'NOT_APPLICABLE' })], salary: [] }), hooks());
  assert.equal(wrongNa.errors[0].code, 'PAYROLL_INPUT_CONFLICT');
});

test('TC-I07: overlapping sources for the same component are a conflict, not a sum', async () => {
  const result = await calculateEmployee(context({
    planVersions: plan([{ componentId: 'C', role: 'BASE', sourceType: 'PRODUCT', formulaCode: 'F', allocation: 'INDIVIDUAL' }]), components: { C: component('SP') },
    inputs: [input('C', 'PRODUCT', '1000000', { batchId: 'b1', inputHash: 'x1' }), input('C', 'PRODUCT', '1200000', { batchId: 'b2', inputHash: 'x2' })], salary: [],
  }), hooks());
  assert.equal(result.errors[0].code, 'PAYROLL_SOURCE_DUPLICATE');
});

test('TC-I08: team piecework pays each member the confirmed allocation, total 4.000.000 đ', async () => {
  const teamPlan = plan([{ componentId: 'K', role: 'BASE', sourceType: 'PIECEWORK', formulaCode: 'F', allocation: 'CONFIRMED_TEAM_ALLOCATION' }]);
  let total = 0;
  for (const [employee, share] of [['A', '2500000'], ['B', '1500000']]) {
    const result = await calculateEmployee(context({ employee: { id: employee, code: employee, fullName: employee, hireDate: '2026-01-01', terminationDate: null }, planVersions: teamPlan, components: { K: component('KHOAN_TO') }, salary: [],
      inputs: [input('K', 'PIECEWORK', '4000000', { teamAllocationKey: 'TO-1', allocatedAmount: share, inputHash: 'k-' + employee })] }), hooks());
    total += main(result);
  }
  assert.equal(total, 4000000);
});

test('TC-P01 / P01b / P01c: CP-01 compares each segment with its regional minimum', async () => {
  const salary = amount => [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-31', amount, salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }];
  const bn = await calculateEmployee(context({ salary: salary('5000000') }), hooks());
  const cp01 = bn.violations.find(v => v.code === 'CP-01');
  assert.equal(cp01.severity, 'BLOCKING'); assert.match(cp01.message, /NĐ 293\/2025/);
  const hna = await calculateEmployee(context({ salary: salary('5000000'), units: [unit({ wageRegionCode: 'II', minimumMonth: { id: 'mw-II', value: '4730000' } })] }), hooks());
  assert.ok(!hna.violations.some(v => v.code === 'CP-01'));
  const na = await calculateEmployee(context({ salary: salary('4000000'), units: [unit({ wageRegionCode: 'III', minimumMonth: { id: 'mw-III', value: '4140000' } })] }), hooks());
  assert.equal(na.violations.find(v => v.code === 'CP-01').details.region, 'III');
});

test('TC-P02: a raise on the 15th yields two rate segments in the time pay trace', async () => {
  const result = await calculateEmployee(context({
    salary: [
      { componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-14', amount: '13000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' },
      { componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-15', to: '2026-10-31', amount: '15600000', salaryBasis: 'MONTHLY', source: 'DECISION', sourceId: 'qd', reference: 'QĐ' },
    ],
    attendance: { available: true, days: days(26), regularMinutes: String(26 * 480), lockHashes: [] },
  }), hooks());
  const line = result.lines.find(item => item.lineType === 'MAIN');
  assert.deepEqual(line.trace.segments.map(s => [s.from, s.quantity, s.amount]), [['2026-10-01', '14', '7000000'], ['2026-10-15', '12', '7200000']]);
  assert.equal(line.amount, '14200000');
});

test('TC-P07: mid-period transfer checks each region and splits cost by days', async () => {
  const result = await calculateEmployee(context({
    salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-31', amount: '5000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }],
    units: [unit({ to: '2026-10-09', days: 9 }), unit({ orgUnitId: 'u2', orgUnitCode: 'NM-NA-D1-T1', wageRegionCode: 'III', costCenterCode: 'CC-NA', from: '2026-10-10', days: 22, minimumMonth: { id: 'mw-III', value: '4140000' } })],
  }), hooks());
  assert.deepEqual(result.violations.filter(v => v.code === 'CP-01').map(v => v.details.region), ['I']);
  assert.deepEqual(result.costAllocation.map(c => [c.costCenterCode, c.days]), [['CC-BN', 9], ['CC-NA', 22]]);
});

test('TC-P06: two runs on identical sources are identical including the source hash', async () => {
  const first = await calculateEmployee(context(), hooks('0.05'));
  const second = await calculateEmployee(context(), hooks('0.05'));
  assert.deepEqual(second, first);
});

test('CP-04 / CP-05: deductions above 30% after insurance and tax, and negative net, are blocking', async () => {
  const deduction = input('D', 'DEDUCTION', '5000000');
  const result = await calculateEmployee(context({ components: { TIME: component('LUONG_TG', { isInsurable: true, isOtBase: true, isProrated: true }), D: component('BOI_THUONG', { componentType: 'DEDUCTION' }) }, inputs: [deduction] }), hooks());
  const cp04 = result.violations.find(v => v.code === 'CP-04');
  assert.equal(cp04.severity, 'BLOCKING'); assert.equal(cp04.details.cap, '3600000');
  const negative = await calculateEmployee(context({ components: { TIME: component('LUONG_TG', { isProrated: true }), D: component('TAM_UNG', { componentType: 'DEDUCTION' }) }, inputs: [input('D', 'DEDUCTION', '15000000')] }), hooks());
  assert.ok(negative.violations.some(v => v.code === 'CP-05'));
  const none = await calculateEmployee(context({ salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-31', amount: '1000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }] }), { ...hooks(), insurance: async () => ({ eligible: { BHXH: true, BHYT: true, BHTN: true }, reasonCode: 'ELIGIBLE', insurableRaw: '1000000', cp07: null, lines: [{ kind: 'BHXH', base: '5310000', employee: '424800', employer: '0', rateId: 'r' }], trace: {} }) });
  assert.ok(!none.violations.some(v => v.code === 'CP-04'), 'no deduction means no CP-04 even when net after insurance is negative');
});

test('CP-08 is a warning against the previous period gross', async () => {
  const result = await calculateEmployee(context({ previousGross: '9000000' }), hooks());
  const cp08 = result.violations.find(v => v.code === 'CP-08');
  assert.equal(cp08.severity, 'WARNING');
  assert.ok(!(await calculateEmployee(context({ previousGross: '11500000' }), hooks())).violations.some(v => v.code === 'CP-08'));
});

test('No plan or no locked attendance isolates the employee with a specific code', async () => {
  assert.equal((await calculateEmployee(context({ planVersions: [] }), hooks())).errors[0].code, 'PAY_PLAN_MISSING');
  assert.equal((await calculateEmployee(context({ attendance: { available: false, days: [], regularMinutes: '0', lockHashes: [] } }), hooks())).errors[0].code, 'PAYROLL_INPUT_MISSING');
});
