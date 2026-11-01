const { test } = require('node:test');
const assert = require('node:assert/strict');
const { insuranceEligibility, insurableSalary, insuranceContribution, checkCp07 } = require('../dist/social-insurance/insurance-engine.js');

const eligibility = (overrides = {}) => insuranceEligibility({ month: '2026-10', contracts: [{ type: 'INDEFINITE', insuranceEligible: true }], statuses: [], unpaidLeaveDays: 0, unpaidLeaveThreshold: 14, ...overrides });
const caps = { BHXH: '46800000', BHYT: '46800000', BHTN: '106200000' };
const salary = (amount, overrides = {}) => insurableSalary({ components: [{ code: 'AGREED', name: 'Lương thỏa thuận', amount, insurable: true }], regionalMinimum: '5310000', trainedAddon: null, caps, ...overrides });
const rates = { BHXH: { id: 'r1', employeeRate: '0.08', employerRate: '0.175' }, BHYT: { id: 'r2', employeeRate: '0.015', employerRate: '0.03' }, BHTN: { id: 'r3', employeeRate: '0.01', employerRate: '0.01' }, KPCD: { id: 'r4', employeeRate: '0', employerRate: '0.02' } };
const contribution = (s, e = eligibility()) => insuranceContribution({ eligibility: e, salary: s, rates, unionFee: { rate: '0.01', cap: '234000', parameterIds: [] }, rounding: { scale: 0 } });
const byKind = result => Object.fromEntries(result.lines.map(line => [line.kind, [Number(line.employee), Number(line.employer)]]));

test('BR-48: standard rates on 10.000.000 đ give 800k / 150k / 100k employee shares', () => {
  const result = contribution(salary('10000000'));
  assert.deepEqual(byKind(result), { BHXH: [800000, 1750000], BHYT: [150000, 300000], BHTN: [100000, 100000], KPCD: [0, 200000], UNION_FEE: [100000, 0] });
  assert.equal(result.employeeTotal, '1150000');
  assert.equal(result.employerTotal, '2350000');
});

test('BR-47: below the regional floor clamps up and keeps before/after in the trace', () => {
  const s = salary('4000000');
  assert.equal(s.raw, '4000000');
  assert.equal(s.perKind.BHXH.value, '5310000');
  assert.equal(s.perKind.BHXH.floorApplied, true);
  const trained = salary('4000000', { trainedAddon: '0.07' });
  assert.equal(trained.perKind.BHXH.value, '5681700');
});

test('BR-47: caps apply per kind (BHXH/BHYT on base salary, BHTN on regional minimum)', () => {
  const s = salary('60000000');
  assert.deepEqual([s.perKind.BHXH.value, s.perKind.BHYT.value, s.perKind.BHTN.value], ['46800000', '46800000', '60000000']);
  assert.equal(s.perKind.BHXH.capApplied, true); assert.equal(s.perKind.BHTN.capApplied, false);
});

test('Non-insurable components never enter the insurable salary', () => {
  const s = insurableSalary({ components: [{ code: 'AGREED', name: 'Lương', amount: '8000000', insurable: true }, { code: 'AN_CA', name: 'Ăn ca', amount: '700000', insurable: false }], regionalMinimum: '5310000', trainedAddon: null, caps });
  assert.equal(s.raw, '8000000');
  assert.deepEqual(s.excluded, [{ code: 'AN_CA', amount: '700000' }]);
});

test('BR-50: union fee is 1% capped at the configured ceiling', () => {
  const result = contribution(salary('30000000'));
  const fee = result.lines.find(line => line.kind === 'UNION_FEE');
  assert.equal(fee.employee, '234000'); assert.equal(fee.capApplied, true);
});

test('BR-49: participation reasons by month', () => {
  assert.equal(eligibility({ contracts: [{ type: 'UNDER_ONE_MONTH', insuranceEligible: false }] }).reasonCode, 'CONTRACT_UNDER_1_MONTH');
  assert.equal(eligibility({ contracts: [{ type: 'PROBATION', insuranceEligible: false }] }).reasonCode, 'PROBATION_ONLY');
  assert.equal(eligibility({ contracts: [] }).reasonCode, 'NO_CONTRACT');
  assert.equal(eligibility({ unpaidLeaveDays: 14 }).reasonCode, 'UNPAID_LEAVE_14_DAYS');
  assert.equal(eligibility({ unpaidLeaveDays: 13 }).reasonCode, 'ELIGIBLE');
  assert.equal(eligibility({ statuses: ['PENSIONER'] }).reasonCode, 'RETIREE');
  const foreign = eligibility({ statuses: ['FOREIGN_WORKER'] });
  assert.deepEqual(foreign.eligible, { BHXH: true, BHYT: true, BHTN: false });
  assert.ok(!contribution(salary('10000000'), foreign).lines.some(line => line.kind === 'BHTN'));
  assert.deepEqual(contribution(salary('10000000'), eligibility({ statuses: ['PENSIONER'] })).lines, []);
});

test('CP-07 blocks a participating employee without insurable salary', () => {
  const empty = insurableSalary({ components: [], regionalMinimum: '5310000', trainedAddon: null, caps });
  assert.equal(checkCp07(eligibility(), empty).code, 'CP-07');
  assert.equal(checkCp07(eligibility(), null).severity, 'BLOCKING');
  assert.equal(checkCp07(eligibility(), salary('8000000')), null);
  assert.equal(checkCp07(eligibility({ contracts: [] }), empty), null);
});
