const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entitlementCalculation, completedServiceYears, fundTotals, carryExpiry, spendableAnnual } = require('../dist/leave/leave-fund-engine');
const date = value => new Date(value + 'T00:00:00.000Z');
function calculate(condition, count, overrides = {}) {
  return entitlementCalculation({
    year: 2026, hireDate: date('2026-01-01'), terminationDate: null, effectiveDate: date('2026-12-31'), workingCondition: condition,
    months: Array.from({ length: count }, (_, index) => ({ month: index + 1, policyVersionId: 'policy-' + index, policyOrgUnitId: 'company', status: 'SIMULATION', decisionReference: 'DEC-03', normalDays: 12, hazardousDays: 14, extremeDays: 16 })), accessDates: [], ...overrides,
  });
}
function entry(kind, bucket, days, effectiveDate, expiresAt = null) {
  return { kind, bucket, days, operation: { effectiveDate: date(effectiveDate) }, expiresAt: expiresAt ? date(expiresAt) : null };
}
test('prorates 12/14/16 day entitlements by confirmed months without monthly rounding loss', () => {
  assert.equal(calculate('NORMAL', 6).entitledDays, '6.00');
  assert.equal(calculate('HAZARDOUS', 6).entitledDays, '7.00');
  assert.equal(calculate('EXTREME', 6).entitledDays, '8.00');
  assert.equal(calculate('EXTREME', 5).entitledDays, '6.67');
  assert.equal(calculate('NORMAL', 0).entitledDays, '0.00');
});
test('adds seniority only on completed five-year anniversaries and stops at termination', () => {
  const input = { hireDate: date('2021-07-01'), effectiveDate: date('2026-06-30') };
  assert.deepEqual([calculate('NORMAL', 6, input).seniorityDays, calculate('NORMAL', 6, input).entitledDays], [0, '6.00']);
  const anniversary = calculate('NORMAL', 6, { ...input, effectiveDate: date('2026-07-01') });
  assert.deepEqual([anniversary.serviceYears, anniversary.seniorityDays, anniversary.entitledDays], [5, 1, '6.50']);
  const terminated = calculate('NORMAL', 6, { ...input, effectiveDate: date('2026-12-31'), terminationDate: date('2026-06-30') });
  assert.deepEqual([terminated.serviceYears, terminated.entitledDays], [4, '6.00']);
  assert.equal(completedServiceYears(date('2020-02-29'), date('2025-02-28')), 4);
  assert.equal(completedServiceYears(date('2020-02-29'), date('2025-03-01')), 5);
});
test('weights effective monthly policies instead of applying the last policy to the whole year', () => {
  const initial = calculate('NORMAL', 12);
  const months = initial.months.map(month => ({ ...month, normalDays: month.month <= 6 ? 12 : 24 }));
  const result = calculate('NORMAL', 12, { months });
  assert.equal(result.entitledDays, '18.00');
  assert.deepEqual(result.months.map(month => month.baseDays), [12, 12, 12, 12, 12, 12, 24, 24, 24, 24, 24, 24]);
});
test('expiry is inclusive, excludes expired carry from spendable days, and retains it for reconciliation', () => {
  const entries = [entry('ENTITLEMENT', 'ANNUAL', '12', '2026-01-01'), entry('CARRY_IN', 'CARRY', '5', '2026-01-01', '2026-03-31'), entry('ADVANCE_IN', 'ADVANCE', '3', '2026-01-02'), entry('CARRY_OUT', 'ANNUAL', '-4', '2026-01-03')];
  const onExpiry = fundTotals(entries, 2026, date('2026-03-31'));
  assert.deepEqual([onExpiry.annualDays, onExpiry.availableDays, onExpiry.expiredCarryDays], ['8.00', '16.00', '0.00']);
  const afterExpiry = fundTotals(entries, 2026, date('2026-04-01'));
  assert.deepEqual([afterExpiry.availableDays, afterExpiry.expiredCarryDays, afterExpiry.reconciliationDays, afterExpiry.carriedDays], ['11.00', '5.00', '5.00', '5.00']);
  assert.equal(fundTotals(entries, 2026, date('2027-01-01')).reconciliationDays, '13.00');
});
test('future-year advance debt offsets the later grant without creating negative available leave', () => {
  const debt = entry('ADVANCE_OUT', 'ANNUAL', '-2', '2026-10-01');
  assert.deepEqual([fundTotals([debt], 2027, date('2026-10-02')).annualDays, fundTotals([debt], 2027, date('2026-10-02')).availableDays], ['-2.00', '0.00']);
  const granted = fundTotals([debt, entry('ENTITLEMENT', 'ANNUAL', '12', '2027-01-01')], 2027, date('2027-01-01'));
  assert.deepEqual([granted.availableDays, granted.entitledDays, granted.advancedToPreviousDays], ['10.00', '12.00', '2.00']);
});
test('backdated debits use the lowest later annual balance and do not spend carry or advance', () => {
  const entries = [entry('ENTITLEMENT', 'ANNUAL', '6', '2026-01-01'), entry('ADJUSTMENT', 'ANNUAL', '-5', '2026-02-01'), entry('ADJUSTMENT', 'ANNUAL', '5', '2026-03-01'), entry('ADVANCE_IN', 'ADVANCE', '3', '2026-01-01'), entry('CARRY_IN', 'CARRY', '5', '2026-01-01', '2026-12-31')];
  assert.equal(spendableAnnual(entries, 2026, date('2026-01-15'), date('2026-04-01')).toFixed(2), '1.00');
  assert.equal(spendableAnnual(entries, 2026, date('2026-03-02'), date('2026-04-01')).toFixed(2), '6.00');
});
test('clamps configured leap-day carry expiry only in non-leap years', () => {
  assert.equal(carryExpiry(2026, 2, 29).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(carryExpiry(2028, 2, 29).toISOString().slice(0, 10), '2028-02-29');
});
